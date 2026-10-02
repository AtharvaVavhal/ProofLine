# Proofline — Database Schema Specification

> **Trace the Evidence. Build the Case.**

| Field | Value |
|---|---|
| Product | **Proofline** |
| Document | Database Schema Specification |
| File | `docs/03-DATABASE-SCHEMA.md` |
| Version | 1.1 (targeted correction pass) |
| Status | Hackathon MVP. Specification only. Contains no code, no Prisma schema and no migrations. |
| Last updated | 2026-10-02 |
| Sources (authoritative) | `docs/01-PROOFLINE-MASTER-SPEC.md` v1.0 · `docs/02-PRODUCT-REQUIREMENTS.md` v1.0 · `docs/DECISIONS.md` v0.2 |
| Changes in 1.1 | Relationship-evidence reconciliation (§11.3); `Case.summary` vs. AI incident summary (§5.4); "user contact" as an intentionally limited field (§5.5); table inventory with justifications (§3.4); evidence-deletion behaviour labelled required vs. [SCHEMA-REC] (§24.6); urgency-on-deletion aligned with G-2 (§14.4). |
| Precedence | Where the sources differ, `DECISIONS.md` §7–§8 win (`DECISIONS.md` §1.3), then the PRD, then the Master Spec. |

### Labels used in this document

| Label | Meaning |
|---|---|
| **[PRODUCT]** | Behaviour required by the Master Spec, PRD or a resolved decision. The source is cited. |
| **[SCHEMA-REC]** | A schema design recommendation made here so the product behaviour can be implemented. It does not add product behaviour. |
| **[IMPL]** | An implementation detail that can change without changing the product. |
| **[DELEGATED]** | An item `DECISIONS.md` §11 delegates to this document (G-5 time handling, G-6 vocabularies, case reference format, urgency caching). Settled here. |

Requirement IDs (`FR-xxx`, `NFR-xx`, `GR-xx`), decision IDs (`OD-xx`, `AD-xx`, `G-x`, `R-x`) and PRD rule IDs (`S-x`, `EV-x`, `EX-x`, `TL-x`, `MI-x`, `RP-x`, `AU-x`, `SP-x`, `IN-x`) are used exactly as they appear in the sources.

---

## 1. Purpose and Scope

### 1.1 What this database stores

The PostgreSQL database holds **structured metadata and structured records** for the whole MVP flow:

```text
create case → upload evidence → store/fingerprint → process → extract facts/entities → correlate
→ scam analysis → timeline → contradictions/corrections → missing information → deterministic urgency
→ immediate actions → report generation → user review → integrity verification → audit history
```

### 1.2 Five categories of data

| Category | Examples | Where it lives | Trust level |
|---|---|---|---|
| **Database metadata / structured records** | users, cases, evidence metadata (type, size, SHA-256, storage key), states, runs | PostgreSQL | System of record |
| **Evidence binary objects** | original PNG/JPEG/PDF/TXT/EML bytes, canonical bytes of pasted text, generated report PDFs, export ZIPs | **Object storage**, encrypted at rest by the provider (FR-005, OD-05). The DB holds only `storage_key` references. | Immutable originals (EV-2) |
| **Derived processing outputs** | parsed source lines, extractions, entities, relationships, timeline events, scam signals, findings, actions, urgency, report snapshots | PostgreSQL | **Untrusted until validated.** Every key fact must carry provenance (GR-06, NFR-04). AI output is persisted only after schema validation (§10.5 of the spec) and, for identifiers, literal validation against source text (EX-2). |
| **User-confirmed / user-stated information** | follow-up answers, corrections, user-added events, case metadata, review confirmations, action status | PostgreSQL (`user_statements`, correction columns, `review_confirmations`) | Labelled as user-provided. Never presented as documentary evidence (FR-015). |
| **Audit records** | who did what, when, and the outcome | PostgreSQL (`audit_logs`), append-only, no foreign keys | **No evidence content, filenames, extracted values or PII** (FR-023, OD-11) |

### 1.3 What this database does NOT store

- Evidence originals or generated documents as binary data. These are in object storage (FR-005).
- OTP values and full card numbers. They are redacted before parsed text is persisted (§9.6, GR-09). **[SCHEMA-REC]**
- LLM candidate values that failed validation. Only counts are kept (EX-4). **[SCHEMA-REC]**
- Raw model reasoning (FR-024).
- Official contact channels (helpline numbers, portal URLs). These come from a curated static list in application configuration. The DB stores only channel **codes** (GR-14). **[SCHEMA-REC]**
- The synthetic manifest, benchmark expectations and fallback cache. These are committed files (AD-03, AD-06), not database rows.
- Job-queue internals. The queue library keeps its own schema outside this specification (OD-15).
- Anything on-chain. Blockchain is deferred (OD-06). Only a nullable reference column exists.

### 1.4 Relationships to other parts of the system

| Part | Relationship to the database |
|---|---|
| **Application architecture** (`04-…`) | One NestJS modular monolith (spec §18.1) is the only database client. API and worker run in one process (OD-15, OD-16). Each module owns the tables in §3.2. |
| **Object storage** | The DB stores `storage_key` and SHA-256. Bytes are written via signed upload, then hashed by the server at the "complete" step (OD-14). Objects are deleted **after** the DB transaction that deletes their rows commits (§24). |
| **AI processing** (`06-…`) | AI calls run inside agent steps (OD-12). Every step is recorded in `agent_steps`. AI outputs are persisted only into typed tables after validation. The **LLM is never the OCR source** (FR-007, OD-03). Source text comes only from `parse_results` / `source_lines`. |
| **Integrity verification** | `evidence_items.sha256` is the fingerprint recorded at ingestion and never changes (FR-004). Each verification is an immutable `integrity_verifications` row (FR-021). Blockchain is **not** required (OD-06). |

### 1.5 MVP scope

- Single-owner cases (OD-01).
- Email-OTP authentication (OD-04).
- Evidence types PNG, JPEG, PDF (text layer only), TXT, EML, pasted text and pasted URL (G-4, OD-03).
- Hard delete (OD-11).
- **Out of scope:** shared cases, phone OTP, scanned-PDF OCR, speech-to-text (OD-08), identity-document upload (OD-09), blockchain attestation (OD-06), mailbox synchronisation (N13), cross-case data (NFR-08, N14).

---

## 2. Database Technology Assumptions

| Topic | Specification | Label |
|---|---|---|
| Engine | **PostgreSQL 15+** (spec §19 "Decided"). Hosting provider is **deferred** (OD-13). The schema uses no vendor-specific extension beyond built-in `gen_random_uuid()`. | [PRODUCT] / [SCHEMA-REC] |
| ORM | **Prisma** is the chosen ORM (spec §19: "Decided per this specification's brief"). It is an implementation choice, not a source product requirement. Constructs Prisma cannot express (check constraints, partial unique indexes, triggers, views) are applied in raw-SQL migrations (§28). | [IMPL] |
| Primary keys | `uuid`, default `gen_random_uuid()` (random v4), on every table except pure join tables, which use composite primary keys. IDs never encode ownership or sequence. Human-readable IDs are separate columns (`case_reference`, `evidence_ref`). | [SCHEMA-REC] |
| Timestamps | **[DELEGATED G-5]** All instants are `timestamptz`, stored in UTC and **displayed in IST (Asia/Kolkata, +05:30)** (spec §14.2). Incident times read from evidence also keep their **original text** and a **precision** (§12). Server-set columns `created_at` / `updated_at` default to `now()`. | [DELEGATED] |
| Money | Amounts are stored as `bigint` minor units (paise) plus `char(3)` currency. Never floating point. | [SCHEMA-REC] |
| Hashes | `char(64)`, lowercase hex, `CHECK (col ~ '^[0-9a-f]{64}$')`. | [SCHEMA-REC] |
| JSONB | Used only for (a) type-specific metadata with no query needs (`source_metadata`, `attributes`), (b) step plans and summaries, (c) the report snapshot (AD-04), and (d) whitelisted audit metadata. **Never** used to hold provenance links. Those are relational (AD-02). Every JSONB column has a documented shape that the application validates. | [SCHEMA-REC] |
| Enums | PostgreSQL enum types (catalogue in §4.1). Adding a value is a migration. | [SCHEMA-REC] |
| Indexing | Driven by the query patterns in §21. No speculative indexes. Every foreign key used in cascades or "only source" queries is indexed. | [SCHEMA-REC] |
| Transactions | Every user action and its audit entry are written in **one transaction** (§19.4). Each agent step writes its outputs and its step status in one transaction. State transitions, evidence slot allocation and deletion take a `SELECT … FOR UPDATE` lock on the `cases` row. Default isolation is READ COMMITTED. | [PRODUCT] FR-023 / [SCHEMA-REC] |
| Delete semantics | **Hard delete** (OD-11). There are **no `deleted_at` columns**. Exceptions, all of which hold no evidence content: invalidated report rows (content removed, row kept for version numbering), voided review confirmations (kept as history), and audit rows (kept, no FK). | [PRODUCT] OD-11 |
| Isolation | **Case-scoped data model.** Every case-owned row carries `case_id NOT NULL`. Cross-table links use **composite foreign keys `(x_id, case_id)`**, so a child can never reference a parent in another case (§20). The application scopes every query by `case_id` and checks ownership (`cases.user_id`). | [PRODUCT] NFR-08, AU-5 / [SCHEMA-REC] |

---

## 3. Core Domain Model

### 3.1 Source entities and their mapping

| Source entity (spec §17) | Table(s) here | Notes |
|---|---|---|
| User | `users` | Email only (OD-04). |
| Case | `cases` | All source fields plus `case_reference`†, `location`† and derived columns. |
| Evidence | `evidence_items` (+ `parse_results`, `source_pages`, `source_lines`) | Source `metadata` is split into typed columns, plus a parse record for "parser info". |
| Extraction | `extractions` (+ `extraction_source_lines`) | Provenance location is relational (AD-02). |
| Entity | `entities` | Unique per case. |
| Relationship | `relationships` (+ `fact_sources`) | The source's `evidence_id` (the evidence supporting the relationship) is stored as **one-to-many supporting sources**. This is the same product concept implemented at schema level (§11.3). |
| TimelineEvent | `timeline_events` (+ `timeline_event_entities`) | All source and † fields. |
| ActionItem | `action_items` | |
| Report | `reports` (+ `review_confirmations`, `exports`, `export_evidence_items`) | Version-specific confirmation (R-1). |
| AuditLog | `audit_logs` | No foreign keys. Append-only. |

### 3.2 Supporting entities, each required by a cited source

| Table | Required by |
|---|---|
| `otp_challenges`, `sessions` | Spec §17 ("Auth sessions / OTP challenges … TO BE DEFINED"), FR-026, OD-04 |
| `parse_results`, `source_pages`, `source_lines` | FR-007 ("raw text with positional structure … line references"), AD-02 (`lineIds`), OD-03 §7.1 (page validation, failed pages) |
| `sensitive_detections` | GR-09 (OTP/card redaction), G-2 signal U2(a) "OTP value detected in evidence" |
| `extraction_source_lines` | AD-02 provenance `location.lineIds[]`. Gives FK integrity for "provenance must point to existing source". |
| `user_statements` | AD-02 (`USER_STATEMENT` SourceRef), FR-013, FR-015, PRD FR-001 ("treated as user-provided") |
| `fact_sources` | AD-02 uniform relational `SourceRef`. GR-06 / NFR-04 coverage checks. OD-11 "only source" deletion. |
| `timeline_event_entities` | FR-012 inputs (entities). G-2 U1 ("AMOUNT tied to … timeline event of type payment-initiated or debit-notification"). |
| `analysis_runs`, `agent_steps` | Spec §17 ("Analysis job / agent step records … TO BE DEFINED"), FR-006, FR-024, FR-027, AD-05, OD-12 |
| `scam_signals` | FR-010, AD-01 (primary + secondary labels, each cited). Case-level `scam_signals`† from spec §17 is normalised into rows. |
| `missing_information_items` | Spec §17 ("Missing-information / contradiction items and follow-up questions and answers … TO BE DEFINED"), FR-014, FR-015 |
| `urgency_assessments`, `urgency_reasons` | G-2 (`DECISIONS.md` §7.3), including rule version and traceable reasons |
| `review_confirmations` | FR-019, R-1 (confirmation is a separate record tied to a version and its checksum) |
| `exports`, `export_evidence_items` | FR-020, OD-07 ("exports record … feeds the audit log"). OD-11 (exports deleted on evidence deletion). |
| `integrity_verifications` | FR-021 (results, recorded vs. current hash). FR-018 (integrity status per item). |

No other tables are defined. There is no organisation/tenant table (N10), case-member table (OD-01), mailbox table (N13), attestation table (OD-06) or transcript table (OD-08).

### 3.3 Ownership and lifecycle summary

| Table | Owner / parent | Created | Changed | Removed |
|---|---|---|---|---|
| users | — | First successful OTP verification | Login time | Never (no account deletion in MVP) |
| otp_challenges | email | Code requested | Attempt count, consumed | Expiry cleanup **[IMPL]** |
| sessions | user | Login | last_seen, revoked | Expiry cleanup **[IMPL]** |
| cases | user | FR-001 | Status, metadata | Case deletion (FR-025) |
| evidence_items | case | Upload step 1 / paste | Status, fingerprint (once) | Evidence/case deletion; rejected or abandoned uploads |
| parse_results, source_pages, source_lines, sensitive_detections | evidence | Parse step | Replaced on retry | With evidence |
| extractions, extraction_source_lines | evidence | Extract step | Correction columns only | With evidence |
| user_statements | case (+ author) | Answer, correction, added event, metadata | Never (append-only) | With case |
| entities | case | Normalise/correlate step; user answer | Recanonicalised on correction | Orphan sweep; case deletion |
| relationships | case | Correlate step | — | Orphan sweep; case deletion |
| timeline_events, timeline_event_entities | case | Timeline step; user-added | Corrections, dismissal | Orphan sweep; case deletion |
| analysis_runs, agent_steps | case | Analyse, retry, re-entry, report generation | Status | With case |
| scam_signals | case | Scam-analysis step | Replaced per run | Next run; evidence deletion; case deletion |
| missing_information_items | case | Missing-info step | Answers, resolution | Evidence deletion (re-derived); case deletion |
| action_items | case | Actions step | User status | Next run (if no longer recommended); evidence deletion; case deletion |
| urgency_assessments, urgency_reasons | case | Rule engine | is_current flag | Evidence deletion (recomputed); case deletion |
| fact_sources | owner + target | With owner | — | Cascade from either side |
| reports | case | Report generation | Status | Content removed on invalidation; row on case deletion |
| review_confirmations | report | User confirms | Voided | With report/case |
| exports, export_evidence_items | report | User exports | Status | Evidence deletion; case deletion |
| integrity_verifications | evidence | User verifies | Never | With evidence |
| audit_logs | — (no FK) | Every audited action | Never | Never through the product |

### 3.4 Table inventory and justification (all 30 tables)

The schema has **30 tables** plus **2 derived views** (`entity_evidence_links`, `case_overview`) and **1 sequence** (`case_reference_seq`). An earlier summary of this document said "31 tables". That count was wrong. The specification itself defines exactly the 30 tables below.

Category key:
- **Core**: a core domain entity from spec §17.
- **Support**: supporting persistence required by a source.
- **Prov/Audit**: a provenance or audit structure.
- **Impl**: derived or implementation support needed to implement a cited requirement.

| # | Table | Purpose | Source requirement / decision | Category |
|---|---|---|---|---|
| 1 | `users` | Authenticated owner of cases | Spec §17 User; FR-026; OD-04 | Core |
| 2 | `otp_challenges` | One-time sign-in codes (hashed), expiry, attempt limits | Spec §17 "Auth sessions / OTP challenges" (TO BE DEFINED); FR-026; PRD AU-2; OD-04 | Support |
| 3 | `sessions` | Revocable, rotating sessions | Spec §17 (same); FR-026; PRD AU-3; OD-04 | Support |
| 4 | `cases` | One incident investigation | Spec §17 Case; FR-001; §6.4 | Core |
| 5 | `evidence_items` | Immutable original artifact metadata, fingerprint, status | Spec §17 Evidence; FR-002–FR-005; G-4 | Core |
| 6 | `parse_results` | Parser/engine metadata per item ("parser info") | Spec §17 Evidence `metadata` (parser info); FR-007; OD-03 | Support |
| 7 | `source_pages` | Per-page geometry and text-layer validation | FR-007 (page); OD-03 §7.1 (page validation, failed pages) | Support |
| 8 | `source_lines` | Source text with positional structure and stable line IDs | FR-007 ("raw text with positional structure … line references"); AD-02 (`lineIds`); G-4 (header/body locations) | Prov/Audit |
| 9 | `sensitive_detections` | Location (not value) of OTPs / card numbers | GR-09; FR-009; G-2 U2(a) "OTP value detected in evidence" | Support |
| 10 | `extractions` | One validated value found in one evidence item | Spec §17 Extraction; FR-008; GR-01–GR-05 | Core |
| 11 | `extraction_source_lines` | Relational form of provenance `location.lineIds[]` | AD-02; spec §12.2 (location); NFR-04 | Prov/Audit |
| 12 | `user_statements` | User-provided facts usable as provenance | AD-02 (`USER_STATEMENT`); FR-013; FR-015; PRD FR-001 | Prov/Audit |
| 13 | `entities` | Case-level canonical entities | Spec §17 Entity; FR-009; §12.3 | Core |
| 14 | `relationships` | Evidence-backed entity-to-entity edges | Spec §17 Relationship; §13.3; FR-011 | Core |
| 15 | `fact_sources` | Uniform relational SourceRef from every fact to its sources | AD-02 ("stored RELATIONALLY"); GR-06; NFR-04; OD-11 ("only source") | Prov/Audit |
| 16 | `timeline_events` | Incident events with precision, origin, corrections | Spec §17 TimelineEvent; FR-012; FR-013; §14 | Core |
| 17 | `timeline_event_entities` | Entities related to an event | FR-012 inputs (entities); G-2 U1 (amount tied to payment/debit event) | Impl |
| 18 | `analysis_runs` | Async analysis/report runs, status, plan, fallback flag | Spec §17 "Analysis job / agent step records" (TO BE DEFINED); FR-006; AD-05; OD-15 | Support |
| 19 | `agent_steps` | Per-step status, idempotency key, model metadata, fallback disclosure | Spec §17 (same); FR-006; FR-024; FR-027; OD-12 | Support |
| 20 | `scam_signals` | Primary/secondary labels with explanation and confidence | Spec §17 Case `scam_signals`†; FR-010; AD-01 | Support |
| 21 | `missing_information_items` | Missing fields, contradictions, questions, answers | Spec §17 "Missing-information / contradiction items … follow-up questions and answers" (TO BE DEFINED); FR-014; FR-015 | Support |
| 22 | `action_items` | Immediate-action checklist | Spec §17 ActionItem; FR-016 | Core |
| 23 | `urgency_assessments` | Deterministic urgency result with rule version | G-2 (`DECISIONS.md` §7.3); spec §21.1; urgency caching delegated to this document (`DECISIONS.md` §11) | Support |
| 24 | `urgency_reasons` | Ordered reasons, each traceable to sources | G-2 ("every reason links to its sources"; tie-breaking lists all signals) | Prov/Audit |
| 25 | `reports` | Versioned complaint draft (snapshot + PDF + checksums) | Spec §17 Report; FR-017; FR-018; AD-04; OD-07 | Core |
| 26 | `review_confirmations` | Confirmation tied to a report version and checksum | FR-019 (`review_confirmed_by/at`†); R-1 | Support |
| 27 | `exports` | Record of what was exported, from which version | FR-020 ("audit entry recording what was exported"); OD-07 ("exports record"); OD-11 (exports deleted on evidence deletion) | Support |
| 28 | `export_evidence_items` | Originals selected for a bundle | FR-020 inputs ("chosen evidence files"); OD-07 (`evidence/` with selected originals) | Impl |
| 29 | `integrity_verifications` | Immutable verification results | FR-021; FR-018 ("integrity status"); PRD IN-3–IN-6 | Support |
| 30 | `audit_logs` | Append-only, content-free activity record | Spec §17 AuditLog; FR-023; NFR-03; OD-11 | Core |

**Audit result:** every table has a justification in at least one source document or is necessary relational support for one. **No table is flagged as unsupported.** Count by category: Core 10 (the source entities), Support 13, Prov/Audit 5, Impl 2.

---

## 4. Entity-by-Entity Schema

### 4.0 Field-table legend

| Column | Values |
|---|---|
| **Null** | `N` = NOT NULL, `Y` = nullable |
| **Edit** | `U` = user-editable through the product · `S` = system-set · `S/I` = system-set once, then immutable · `C` = changed only through the correction mechanism (original preserved) |
| **AI** | `Y` = may be produced or influenced by an AI step · `N` = deterministic or user-supplied |
| **Sens** | `Y` = security-sensitive (PII, evidence-derived content, secrets). Never logged, never in audit metadata. |
| **Idx** | `PK` primary key · `UQ` unique · `IX` indexed · `FK` foreign key (indexed) · `–` none |

All tables have `id uuid PK DEFAULT gen_random_uuid()` unless stated otherwise. Rows also carry `created_at timestamptz NOT NULL DEFAULT now()`, and `updated_at` where the row is mutable. These columns are not repeated in every table.

### 4.1 Enum catalogue

| Enum | Values | Source |
|---|---|---|
| `user_auth_status` | `ACTIVE`, `DISABLED` | Spec §17 `auth_status`. Values are [SCHEMA-REC]. `DISABLED` has no product UI. |
| `case_status` | `NEW`, `INGESTING`, `EXTRACTED`, `ANALYZING`, `CORRELATED`, `TIMELINE_READY`, `ACTIONS_READY`, `REPORT_DRAFT`, `USER_REVIEW`, `EXPORTED` | Spec §6.4, PRD §6.3, R-1 (exact) |
| `incident_time_precision` | `EXACT`, `APPROXIMATE`, `UNKNOWN` | PRD FR-001 ("exact, approximate or unknown") |
| `scam_label` | `PHISHING`, `KYC_IMPERSONATION`, `FAKE_INVESTMENT`, `FAKE_JOB_OR_LOAN`, `UPI_FRAUD`, `ACCOUNT_TAKEOVER`, `DIGITAL_ARREST_IMPERSONATION`, `MARKETPLACE_FRAUD`, `UNKNOWN_OTHER` | FR-010, AD-01 |
| `evidence_type` | `PNG`, `JPEG`, `PDF`, `TXT`, `EML`, `TEXT`, `URL` | G-4 (files). FR-003 (pasted `text` / `url`). |
| `paste_kind` | `MESSAGE`, `CHAT_TRANSCRIPT`, `URL` | FR-003 input kind |
| `evidence_processing_status` | `UPLOADING`, `UPLOADED`, `PROCESSING`, `PROCESSED`, `FAILED` | PRD S-3, AD-05 (exact) |
| `evidence_failure_code` | `TRANSFER_FAILED`, `FINGERPRINT_FAILED`, `STORAGE_UNAVAILABLE`, `NO_READABLE_TEXT`, `OCR_FAILED`, `PDF_NO_TEXT_LAYER`, `EMAIL_UNPARSEABLE`, `EMAIL_ENCRYPTED`, `EXTRACTION_FAILED` | PRD §21. `DECISIONS.md` §7.1 (`PDF_NO_TEXT_LAYER`) and §7.4. Codes other than `PDF_NO_TEXT_LAYER` are [SCHEMA-REC]. |
| `upload_rejection_code` *(audit/API only; no column)* | `TYPE_NOT_SUPPORTED`, `CONTENT_TYPE_MISMATCH`, `EMPTY_FILE`, `FILE_TOO_LARGE`, `TOO_MANY_ITEMS`, `PDF_TOO_MANY_PAGES`, `PDF_ENCRYPTED`, `IMAGE_TOO_LARGE`, `TEXT_NOT_UTF8`, `TEXT_TOO_LONG`, `EMAIL_FORMAT_NOT_SUPPORTED` | G-4 (`DECISIONS.md` §7.4) |
| `parser_kind` | `IMAGE_OCR`, `PDF_TEXT_LAYER`, `PLAIN_TEXT`, `EMAIL_MIME`, `URL_STRING` | FR-007 routing (PRD) |
| `parse_status` | `SUCCEEDED`, `FAILED` | [SCHEMA-REC] |
| `line_location_kind` | `TEXT_LINE`, `EMAIL_HEADER`, `EMAIL_BODY_LINE` | G-4 ("provenance location = header name, or body line number") |
| `sensitive_kind` | `OTP`, `CARD_NUMBER` | GR-09 |
| `entity_type` | `PERSON`, `PHONE`, `EMAIL`, `URL`, `DOMAIN`, `UPI_ID`, `TRANSACTION`, `AMOUNT`, `BANK_OR_WALLET`, `ACCOUNT_HINT`, `SMS_SENDER_HEADER`, `MESSAGING_HANDLE`, `DATETIME` | Spec §12.3, PRD §10.1 (exact) |
| `extraction_method` | `OCR`, `PDF_TEXT`, `TEXT_PARSE`, `RULE`, `LLM`, `USER` | AD-02 (exact). `USER` is never used on `extractions` (§9). |
| `confidence_band` | `HIGH`, `MEDIUM`, `LOW` | AD-02 |
| `confidence_basis` | `SOURCE_VALIDATION`, `MODEL_JUDGEMENT` | AD-02 ("for identifiers … computed deterministically … LLM-reported confidence used only for judgements"). [SCHEMA-REC] names. |
| `normalization_status` | `NORMALIZED`, `NOT_NORMALIZED`, `NOT_APPLICABLE` | PRD FR-009 failure ("marked 'not normalised'") |
| `correction_status` | `UNMODIFIED`, `USER_CORRECTED` | Spec §14.1, PRD §13.1 |
| `statement_kind` | `CASE_METADATA`, `FOLLOW_UP_ANSWER`, `CORRECTION`, `ADDED_EVENT` | AD-02, PRD FR-001/013/015 |
| `relation_type` | `HOSTED_ON`, `SENT_LINK`, `REQUESTED_PAYMENT_TO`, `PAID_TO`, `AMOUNT_OF`, `DEBITED_FROM`, `MESSAGE_CONTAINED`, `CONTACTED_FROM` | **[DELEGATED G-6]** Spec §13.3 examples plus `DECISIONS.md` §7.2.5 R1–R7 (§11.4) |
| `timeline_event_type` | `MESSAGE_RECEIVED`, `MESSAGE_SENT`, `CALL`, `LINK_OPENED`, `CREDENTIAL_OTP_REQUEST`, `CREDENTIALS_OR_OTP_SHARED`, `PAYMENT_REQUESTED`, `PAYMENT_INITIATED`, `DEBIT_NOTIFICATION`, `OTHER` | **[DELEGATED G-6]** Spec §14.1 examples plus `DECISIONS.md` §7.2.6 T1–T9 and §7.3 event types (§12.3) |
| `timestamp_precision` | `EXACT`, `APPROXIMATE`, `INFERRED_ORDER_ONLY` | Spec §14.1, PRD §13.1 (exact) |
| `event_origin` | `AI_GENERATED`, `USER_ADDED` | Spec §14.1, PRD §13.1 |
| `run_kind` | `ANALYSIS`, `REPORT_GENERATION` | [SCHEMA-REC] (FR-024 shows the report step in the feed) |
| `run_status` | `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED` | AD-05 (exact) |
| `run_trigger` | `USER_START`, `USER_RETRY`, `ANSWER`, `CORRECTION`, `EVIDENCE_DELETION` | [SCHEMA-REC] (S-4 re-entry causes) |
| `step_name` | `PLAN`, `PARSE`, `EXTRACT`, `NORMALIZE`, `SCAM_ANALYSIS`, `CORRELATE`, `TIMELINE`, `MISSING_INFO`, `ACTIONS`, `URGENCY`, `REPORT` | FR-006, FR-024, OD-12. Names are [SCHEMA-REC]. |
| `step_status` | `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `SKIPPED` | [SCHEMA-REC] |
| `finding_kind` | `MISSING_FIELD`, `CONTRADICTION`, `MISSING_TIMESTAMP`, `MISSING_EVIDENCE` | PRD MI-1–MI-5 |
| `checklist_field` | `INCIDENT_DATETIME`, `INCIDENT_DETAILS`, `IDENTITY_DOCUMENT`, `BANK_WALLET_MERCHANT`, `TRANSACTION_ID_UTR`, `TRANSACTION_DATE`, `FRAUD_AMOUNT`, `RELEVANT_EVIDENCE`, `SUSPECT_DETAILS` | Spec §3.4, PRD §14.1 (the 9 NCRP rows) |
| `checklist_variant` | `FINANCIAL`, `ALL_INCIDENTS` | AD-01, PRD §14.1 |
| `finding_status` | `OPEN`, `RESOLVED`, `INFORMATIONAL` | PRD §14 ("keep ready" item = `INFORMATIONAL`). [SCHEMA-REC] names. |
| `finding_resolution` | `USER_ANSWER`, `USER_CORRECTION`, `NEW_EVIDENCE`, `NO_LONGER_APPLICABLE` | [SCHEMA-REC] |
| `question_status` | `NONE`, `OPEN`, `ANSWERED`, `SKIPPED` | FR-015, MI-6 |
| `action_status` | `TODO`, `DONE`, `NOT_APPLICABLE` | FR-016 (exact meaning) |
| `urgency_level` | `HIGH`, `MEDIUM`, `LOW` | G-2. "Not assessed yet" = **no row** (§14). |
| `urgency_signal` | `U1_FINANCIAL_LOSS`, `U2_CREDENTIAL_EXPOSURE` | G-2 |
| `report_status` | `GENERATING`, `GENERATED`, `FAILED`, `INVALIDATED` | [SCHEMA-REC] mapping FR-017, FR-025 (§17.3) |
| `report_invalidation_reason` | `EVIDENCE_DELETED` | FR-025, OD-11 |
| `confirmation_void_reason` | `CASE_CHANGED`, `REPORT_REGENERATED`, `EVIDENCE_DELETED` | FR-019, S-4, R-1 |
| `export_format` | `REPORT_PDF`, `ZIP_BUNDLE` | OD-07, PRD §18.2 |
| `export_status` | `GENERATING`, `READY`, `FAILED` | [SCHEMA-REC] |
| `verification_result` | `MATCH`, `MISMATCH`, `COULD_NOT_COMPLETE` | FR-021, PRD IN-4–IN-6 |
| `verification_failure_code` | `STORAGE_UNAVAILABLE`, `OBJECT_MISSING` | PRD IN-6. [SCHEMA-REC] codes. |
| `attestation_result` | `MATCH`, `MISMATCH`, `UNAVAILABLE` | FR-021 ("attestation unavailable"). **Used only if OD-06 is built.** |
| `fact_ref_kind` | `EXTRACTION`, `EVIDENCE`, `USER_STATEMENT` | AD-02 (exact) |
| `audit_actor_kind` | `USER`, `SYSTEM` | [SCHEMA-REC] |
| `audit_outcome` | `SUCCEEDED`, `FAILED`, `DENIED` | [SCHEMA-REC] |

### 4.2 `users`

Purpose: the authenticated person who owns cases (spec §17). Identity data is kept separate from evidence (NFR-02).

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description / provenance |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK | S/I | N | N | PK | |
| email | text | N | — | `CHECK (email = lower(email))`, length ≤ 254 | S/I | N | **Y** | UQ | Normalised, lower-cased sign-in email (OD-04). Never written to audit metadata. |
| name | text | Y | null | length ≤ 100 | U | N | **Y** | – | Source field `name`. Optional. |
| auth_status | user_auth_status | N | 'ACTIVE' | | S | N | N | – | Source field `auth_status`. |
| last_login_at | timestamptz | Y | null | | S | N | N | – | |
| created_at / updated_at | timestamptz | N | now() | | S | N | N | – | |

Phone is not stored (OD-04: email only in MVP).

### 4.3 `otp_challenges`

Purpose: one-time sign-in codes (FR-026, OD-04).

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK | S/I | N | N | PK | |
| email | text | N | — | lower-cased | S/I | N | **Y** | IX (with created_at) | Target email. A user row may not exist yet. |
| code_hash | text | N | — | | S/I | N | **Y** | – | Hash of the 6-digit code. **The code itself is never stored** (OD-04). |
| expires_at | timestamptz | N | — | `> created_at` | S/I | N | N | IX | ~10 minutes **[IMPL]** |
| attempt_count | smallint | N | 0 | `0 ≤ attempt_count ≤ max_attempts` | S | N | N | – | Limits wrong attempts (AU-2) |
| max_attempts | smallint | N | 5 | `> 0` | S/I | N | N | – | **[IMPL]** value |
| consumed_at | timestamptz | Y | null | | S | N | N | – | Single use (AU-2) |
| requester_fingerprint | text | Y | null | | S/I | N | **Y** | IX | HMAC of client IP, for rate limiting **[IMPL]**. Never a raw IP. |

### 4.4 `sessions`

Purpose: revocable sessions with rotation on login (FR-026, AU-3).

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK | S/I | N | N | PK | |
| user_id | uuid | N | — | FK users ON DELETE CASCADE | S/I | N | N | FK | |
| token_hash | text | N | — | | S/I | N | **Y** | UQ | Hash of the opaque cookie token. The raw token is never stored. |
| expires_at | timestamptz | N | — | `> created_at` | S/I | N | N | IX | |
| last_seen_at | timestamptz | Y | null | | S | N | N | – | |
| revoked_at | timestamptz | Y | null | | S | N | N | – | Logout or revoke. A session is valid iff `revoked_at IS NULL AND expires_at > now()`. |

### 4.5 `cases`

The complete Case model is in §5.

### 4.6 `evidence_items`

The complete Evidence model is in §6.

### 4.7 `parse_results`, `source_pages`, `source_lines`, `sensitive_detections`

These are specified in §7 (PDF), §8 (email) and §9 (provenance, redaction).

### 4.8 Other tables

`extractions` and `extraction_source_lines` (§9), `user_statements` (§9.5), `entities` (§10), `relationships` (§11), `fact_sources` (§11.2), `timeline_events` and `timeline_event_entities` (§12), `missing_information_items` (§13), `urgency_assessments` and `urgency_reasons` (§14), `analysis_runs`, `agent_steps` and `scam_signals` (§15), `action_items` (§16), `reports`, `review_confirmations`, `exports` and `export_evidence_items` (§17), `integrity_verifications` (§18), `audit_logs` (§19).

---

## 5. Case Model

### 5.1 `cases`

Purpose: one incident investigation (spec §17). Owned by exactly one user (OD-01). Visible only to its owner (FR-001).

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description / provenance |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; also `UNIQUE (id, user_id)` | S/I | N | N | PK | |
| user_id | uuid | N | — | FK users ON DELETE RESTRICT | S/I | N | N | FK, IX(user_id, updated_at DESC) | Owner. Set from the session, never from client input (PRD FR-001 validation). |
| case_reference | text | N | `'CF-' \|\| nextval('case_reference_seq')` | UQ; `CHECK (case_reference ~ '^CF-[0-9]{5,}$')` | S/I | N | N | UQ | **[DELEGATED]** Format `CF-` + number from a sequence starting at 10001 (spec mock `CF-10283`). |
| status | case_status | N | 'NEW' | Transitions per §23.1 | S | N | N | IX | Case state machine (spec §6.4, PRD §6.3, R-1) |
| status_changed_at | timestamptz | N | now() | | S | N | N | – | |
| incident_time | timestamptz | Y | null | | U | N | **Y** | – | User-provided incident time (FR-001). Provenance: a `user_statements` row of kind `CASE_METADATA` is written when set. |
| incident_time_precision | incident_time_precision | Y | null | Non-null iff `incident_time` provided, or `UNKNOWN` if the user says unknown | U | N | N | – | |
| contact_text | text | Y | null | length ≤ 200 | U | N | **Y** | – | "User contact" (FR-001). User-provided case metadata, stored as entered. **Intentionally limited field** (§5.5): no behaviour beyond storage, display and editing is defined for it. |
| location_text | text | Y | null | length ≤ 200 | U | N | **Y** | – | Optional location (spec §17 `location`†) |
| summary | text | Y | null | length ≤ 2000 **[IMPL]** | **U** | **N** | **Y** | – | Source field `Case.summary` (spec §17). Holds the **user's own case description**, the "optional short free-text description" of FR-001. User-provided and user-editable. **Never written by any AI step.** The AI-generated incident summary is stored separately in `reports.content` (§5.4). |
| incident_type | scam_label | Y | null | Must equal the current primary `scam_signals.label` (transaction invariant) | S | **Y** | N | – | Source field `incident_type` = primary label (AD-01). Null before analysis. |
| financial_loss_reported | boolean | Y | null | | S | N | N | – | AD-01 deterministic flag (= G-2 U1). Selects the checklist variant. Null before computed. |
| checklist_variant | checklist_variant | Y | null | `FINANCIAL` iff `financial_loss_reported` | S | N | N | – | Variant used by the last missing-info run (FR-014) |
| created_at / updated_at | timestamptz | N | now() | | S | N | N | – | |

### 5.2 How the requested case aspects are supported

| Aspect | Representation |
|---|---|
| Identity | `id`, `case_reference` |
| Ownership | `user_id`. Every case-owned table carries `case_id` and is reached only through an ownership check (§20). |
| Title / description | There is **no title field**: the source defines none, so none is added. The user's description is `summary` (source field `Case.summary`, FR-001), optional (§5.4). |
| Lifecycle / status | `status` (§23.1) |
| Timestamps | `created_at`, `updated_at`, `status_changed_at` |
| Analysis state | Derived from the latest `analysis_runs` row (QUEUED/RUNNING/SUCCEEDED/FAILED, failed step) (AD-05 S-2: no `FAILED` case state) |
| User review state | Derived. `status = USER_REVIEW` means awaiting review (R-1). **"Reviewed – version N"** = an un-voided `review_confirmations` row on the current report version (§17). |
| Urgency | Current `urgency_assessments` row (§14), or none = "Not assessed yet" |
| Report relationship | `reports.case_id`. The current version is derived (§17.2). There is no denormalised pointer, which avoids drift. **[SCHEMA-REC]** |
| Deletion / isolation | Hard delete cascades to every case-owned table (§24). Composite case FKs (§20). |

### 5.3 Derived view `case_overview` [SCHEMA-REC]

A read-only view per case: evidence counts by `processing_status` (for "N/N processed"), latest run status and failed step, current report version and status, active-confirmation flag, current urgency level and staleness (§14.4), and entity counts by type (the overview strip `PHONE 1 | URL 1 | UPI 1 | UTR 1`, spec §21.1). It is computed on read and not stored.

### 5.4 Case summary vs. AI incident summary

| | **User case summary** | **AI incident summary** |
|---|---|---|
| Stored in | `cases.summary` (source field `Case.summary`, spec §17) | `reports.content`, report section 1 "Incident summary" (AD-04, PRD §16.1). One per report version. |
| Written by | The user only (FR-001 "optional short free-text description") | The Report Generator, during report generation (FR-017). The only AI free-text in the report besides the signal explanation (AD-04). |
| User-editable | **Yes**, at any time (FR-001 "fields can be added or edited later") | **No direct edit.** The user changes the underlying facts (corrections, answers; FR-013/FR-015) and regenerates, which creates a new version. |
| Provenance | Is itself a user statement (a `user_statements` row of kind `CASE_METADATA` when set) | Every statement cites fact IDs (AD-04, GR-06) |
| Lifecycle | One value per case | Versioned with the report. Removed when the report is invalidated (FR-025). |

**Why they are separate:**
- The user's description is user-stated input, which must never be presented as, or overwritten by, AI output (FR-015 principle; GR-13).
- The AI summary is a versioned, provenance-checked output that the user reviews and confirms per version (FR-019, R-1).
- Storing the AI summary in `cases.summary` would overwrite user input, lose version binding, and blur user-stated and AI-derived content (NFR-07, GR-15).

**Invariant INV-C5 (APP):** no AI step writes `cases.summary`. The incident-summary step writes only to `reports.content`.

### 5.5 "User contact" — an intentionally limited field

FR-001 lists "user contact" as a case input. The Master Spec, PRD and `DECISIONS.md` define **no further behaviour** for it. The schema therefore treats `cases.contact_text` as follows:

- It is **user-provided case metadata**, optional, stored exactly as entered (length-limited), and editable by the owner.
- It is **not used** by MVP analysis, extraction, correlation, scam analysis, timeline, missing-information detection, urgency, action generation or report generation. It is not used by any communication, notification or authentication workflow.
- **No inference** is performed from it: no verification, no matching against evidence entities, no identity derivation, no messaging.
- Like all user-provided text, it is security-sensitive: never logged and never in audit metadata (§19.2).

This is a documentation of the source's existing scope, **not a new product decision**. If a later approved document defines a use for this field, that document will specify the behaviour.

---

## 6. Evidence Model

### 6.1 `evidence_items`

Purpose: an immutable original artifact, a file or pasted content (spec §12.1). Belongs to exactly one case.

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description / provenance |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | N | N | PK | |
| case_id | uuid | N | — | FK cases ON DELETE CASCADE | S/I | N | N | FK | |
| sequence_no | smallint | N | — | `CHECK (sequence_no BETWEEN 1 AND 20)`; `UNIQUE (case_id, sequence_no)` | S/I | N | N | UQ | Slot number. The **max 20 items per case is DB-enforced** by this check plus unique pair (G-4). Allocated as the lowest free slot under a case-row lock. |
| evidence_ref | text | N | generated: `'E' \|\| lpad(sequence_no::text, 2, '0')` | generated column | S/I | N | N | – | `E01`…`E20` (FR-018). After a deletion, a freed slot can be reused by a later item (§29). |
| evidence_type | evidence_type | N | — | | S/I | N | N | IX(case_id, evidence_type) | PNG, JPEG, PDF, TXT, EML (files) or TEXT, URL (pasted) |
| paste_kind | paste_kind | Y | null | `CHECK ((evidence_type IN ('TEXT','URL')) = (paste_kind IS NOT NULL))`; `evidence_type='URL' ⇒ paste_kind='URL'` | S/I | N | N | – | FR-003 input kind |
| label | text | Y | null | length ≤ 100 | U | N | **Y** | – | Optional user label (e.g., "bank SMS"). May contain PII, so it is excluded from audit. |
| original_filename | text | Y | null | Non-null for file types; null for TEXT/URL; length ≤ 255 | S/I | N | **Y** | – | As uploaded. Excluded from audit and logs (OD-11). |
| declared_content_type | text | Y | null | | S/I | N | N | – | MIME type declared by the browser |
| detected_content_type | text | Y | null | Must be one of `image/png`, `image/jpeg`, `application/pdf`, `text/plain`, `message/rfc822` once status ≠ UPLOADING | S/I | N | N | – | MIME detected from **content** (magic bytes / parse) (§16.3, G-4) |
| byte_size | bigint | Y | null | `CHECK (byte_size BETWEEN 1 AND 10485760)` | S/I | N | N | – | Size of stored bytes. **10 MB limit DB-enforced** (G-4). Non-null once status ≠ UPLOADING. |
| text_char_count | integer | Y | null | `CHECK (text_char_count BETWEEN 1 AND 20000)`; non-null iff type ∈ {TEXT, URL} | S/I | N | N | – | **20,000-character paste limit DB-enforced** (G-4) |
| page_count | smallint | Y | null | `CHECK (page_count BETWEEN 1 AND 20)`; non-null iff type = PDF and status ≠ UPLOADING | S/I | N | N | – | **20-page PDF limit DB-enforced** (G-4) |
| image_width / image_height | integer | Y | null | `> 0`; `CHECK (image_width::bigint * image_height <= 40000000)`; non-null iff type ∈ {PNG, JPEG} and status ≠ UPLOADING | S/I | N | N | – | **40 MP limit DB-enforced** (G-4) |
| storage_key | text | N | — | UQ | S/I | N | **Y** | UQ | Object key. Opaque; contains no filename or PII **[SCHEMA-REC]**. |
| sha256 | char(64) | Y | null | hex check; **immutable once set** (trigger); non-null iff status ≠ UPLOADING | S/I | N | N | IX(case_id, sha256) | Fingerprint of the original bytes, or of the canonical pasted bytes (FR-004, G-3). Computed by the server (OD-14). |
| uploaded_at | timestamptz | Y | null | non-null iff sha256 non-null | S/I | N | N | – | Ingestion timestamp (spec `uploaded_at`), set when the fingerprint is recorded |
| processing_status | evidence_processing_status | N | 'UPLOADING' | Transitions per §23.2 | S | N | N | IX(case_id, processing_status) | PRD S-3 |
| failure_code | evidence_failure_code | Y | null | non-null iff status = FAILED | S | N | N | – | |
| failure_retryable | boolean | Y | null | non-null iff status = FAILED; `failure_code='PDF_NO_TEXT_LAYER' ⇒ false` | S | N | N | – | `false` means Remove only (`DECISIONS.md` §7.1) |
| failure_detail | jsonb | Y | null | Shape per code, e.g. `{"pages_without_text":[2,3]}` | S | N | N | – | **No evidence content.** The user message is rendered from a fixed template keyed by `failure_code` and is not stored. |
| source_metadata | jsonb | N | '{}' | Shape per type (§6.3) | S | N | **Y** | – | Type-specific metadata (spec Evidence `metadata`) |
| attestation_ref | jsonb | Y | null | Must stay null unless OD-06 is enabled | S | N | N | – | Spec `attestation_ref`†: `{network, tx_hash, attested_at}`. **Optional. Unused in the MVP.** |
| created_at / updated_at | timestamptz | N | now() | | S | N | N | – | |

### 6.2 Limit enforcement responsibility (G-4)

| Limit | Browser (fast feedback) | Server, at upload confirmation (authoritative) | Database (backstop) |
|---|---|---|---|
| Type by content (PNG, JPEG, PDF, TXT, EML; TEXT/URL by paste) | Extension / MIME pre-check | **Magic-byte / parse detection**. Mismatch → reject (`CONTENT_TYPE_MISMATCH`). | `detected_content_type` check; `evidence_type` enum |
| 10 MB per file; no empty files | Size pre-check | Size of the stored object | `byte_size BETWEEN 1 AND 10485760` |
| Max 20 items per case | Count pre-check | Slot allocation under case lock | `sequence_no BETWEEN 1 AND 20` + `UNIQUE (case_id, sequence_no)` |
| PDF ≤ 20 pages; encrypted PDF rejected | — | Page count and encryption check | `page_count BETWEEN 1 AND 20` (encryption: app only) |
| Image ≤ 40 MP | — | Header dimensions | `image_width * image_height <= 40000000` |
| Pasted text ≤ 20,000 chars | Length pre-check | Length after canonicalisation | `text_char_count BETWEEN 1 AND 20000` |
| TXT valid UTF-8 | — | Decode check → reject `TEXT_NOT_UTF8` **[SCHEMA-REC: treated as type-by-content validation at confirmation]** | — |
| `.msg` / `.mbox` / other formats | Extension pre-check | Reject `EMAIL_FORMAT_NOT_SUPPORTED` / `TYPE_NOT_SUPPORTED` | enum (no such type) |
| Bucket-level size limit | — | — | Object storage bucket limit of 10 MB (`DECISIONS.md` §7.4, technical impact) |

**Rejected uploads leave no evidence row** (G-4). Rejection happens in the confirmation transaction: the row is deleted, an `EVIDENCE_REJECTED` audit entry is written with `upload_rejection_code` (no filename), and the stored object is deleted after commit. Rows left in `UPLOADING` beyond the signed-URL lifetime are removed by a cleanup job **[IMPL]**.

### 6.3 `source_metadata` shapes [SCHEMA-REC]

| evidence_type | Shape | Notes |
|---|---|---|
| PNG / JPEG | `{}` | Dimensions are columns |
| PDF | `{}` | Pages are in `source_pages` |
| TXT | `{"encoding":"utf-8","had_bom":bool}` | |
| EML | `{"attachments":[{"filename":text,"content_type":text,"size_bytes":int}], "body_part_used":"TEXT_PLAIN"\|"TEXT_HTML_CONVERTED"}` | §8. Attachment filenames are sensitive. |
| TEXT / URL | `{"canonicalization":"<G-3 rule id>"}` | Identifies the canonical-bytes rule used for the fingerprint (FR-004, G-3) |

### 6.4 Evidence deletion

See §24. In brief: hard delete; dependent derived data is removed or recomputed; reports are invalidated; the object is deleted after commit; an audit tombstone is written (FR-025, OD-11).

---

## 7. PDF Processing Representation

### 7.1 `parse_results` (all types; one per evidence item)

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | N | N | PK | |
| case_id | uuid | N | — | | S/I | N | N | – | |
| evidence_id | uuid | N | — | FK `(evidence_id, case_id)` → evidence_items ON DELETE CASCADE; **UQ (evidence_id)** | S/I | N | N | UQ | Latest parse only. A retry replaces it. |
| agent_step_id | uuid | Y | null | FK agent_steps ON DELETE SET NULL | S/I | N | N | – | Producing step |
| parser_kind | parser_kind | N | — | Must match evidence_type (PNG/JPEG→IMAGE_OCR, PDF→PDF_TEXT_LAYER, TXT/TEXT→PLAIN_TEXT, EML→EMAIL_MIME, URL→URL_STRING) | S/I | N | N | – | FR-007 routing. **No `LLM` parser kind exists. The LLM is never the OCR source** (OD-03). |
| engine / engine_version | text | N | — | | S/I | N | N | – | e.g., the OCR engine or PDF library (FR-007 "parser metadata") |
| status | parse_status | N | — | | S/I | N | N | – | |
| page_count | smallint | N | — | `BETWEEN 1 AND 20` | S/I | N | N | – | 1 for non-PDF |
| failure_code | evidence_failure_code | Y | null | non-null iff status = FAILED | S/I | N | N | – | |
| completed_at | timestamptz | N | now() | | S/I | N | N | – | |

### 7.2 `source_pages`

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| parse_result_id | uuid | N | — | FK ON DELETE CASCADE; **PK (parse_result_id, page_number)** | S/I | N | N | PK | |
| case_id | uuid | N | — | FK `(parse_result_id, case_id)` | S/I | N | N | – | |
| page_number | smallint | N | — | `BETWEEN 1 AND 20` | S/I | N | N | PK | 1-based |
| non_whitespace_char_count | integer | Y | null | `≥ 0`; non-null for PDF pages | S/I | N | N | – | Embedded-text size measured by the parser |
| has_usable_text_layer | boolean | Y | null | generated: `non_whitespace_char_count >= 10` (PDF only) | S/I | N | N | – | **OD-03 rule: a page qualifies only with ≥ 10 non-whitespace characters.** |
| width / height | integer | Y | null | | S/I | N | N | – | Page/image geometry, for bbox normalisation |

### 7.3 How OD-03 is recorded

| OD-03 requirement (`DECISIONS.md` §7.1) | Representation |
|---|---|
| PDF processed only if **every** page has a usable text layer | `PDF_TEXT_LAYER` parse succeeds only if all `source_pages.has_usable_text_layer = true` |
| Page count | `evidence_items.page_count`, `parse_results.page_count` |
| Page validation result | `source_pages.non_whitespace_char_count`, `has_usable_text_layer` |
| Failed page numbers | `source_pages` rows with `has_usable_text_layer = false`, copied into `evidence_items.failure_detail.pages_without_text` for the message |
| Whole item fails; reason | `evidence_items.processing_status = FAILED`, `failure_code = PDF_NO_TEXT_LAYER`; `parse_results.status = FAILED` |
| Guidance to upload pages as PNG/JPG | Fixed message template keyed by `PDF_NO_TEXT_LAYER` and `pages_without_text` (not stored as text) |
| Retry not offered | `failure_retryable = false` (CHECK) |
| **Nothing extracted from that PDF** | Invariant INV-E6: a PDF with `failure_code = PDF_NO_TEXT_LAYER` has **zero** `source_lines`, `extractions` and `sensitive_detections`, and is not cited by any `fact_sources`. Enforced in the parse transaction: lines are written only after all pages pass. |
| Mixed PDFs fail the same way | Same representation. All failing pages are listed. |
| No scanned-PDF OCR workflow | No parser kind, table or state exists for rasterising or OCR-ing PDFs |

### 7.4 `source_lines` (all parsed types)

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | N | N | PK | Stable **line ID** referenced by provenance (AD-02) |
| case_id | uuid | N | — | | S/I | N | N | – | |
| parse_result_id | uuid | N | — | FK `(parse_result_id, case_id)` ON DELETE CASCADE | S/I | N | N | FK | |
| evidence_id | uuid | N | — | FK `(evidence_id, case_id)` ON DELETE CASCADE | S/I | N | N | IX | Denormalised for "lines of evidence X" |
| page_number | smallint | N | — | FK `(parse_result_id, page_number)` → source_pages | S/I | N | N | – | |
| line_number | integer | N | — | `≥ 1`; `UNIQUE (parse_result_id, page_number, line_number)` | S/I | N | N | UQ | 1-based within the page (EML body lines use page 1) |
| location_kind | line_location_kind | N | 'TEXT_LINE' | | S/I | N | N | – | |
| header_name | text | Y | null | non-null iff `location_kind = EMAIL_HEADER`; ∈ {From, To, Cc, Reply-To, Return-Path, Subject, Date, Message-ID} | S/I | N | N | – | G-4 |
| text | text | N | — | **Redacted**: OTP and full card-number spans replaced with a fixed mask before insert (§9.6) | S/I | N | **Y** | – | Source text. Evidence-derived content. |
| bbox | jsonb | Y | null | `{x,y,w,h}`, each in 0–1 | S/I | N | N | – | Region (images; PDFs where available) |
| ocr_confidence | numeric(4,3) | Y | null | 0–1 | S/I | N | N | – | Engine confidence where available (FR-007) |

---

## 8. Email Evidence Model

Only single-message `.eml` files (RFC 5322 / MIME) are accepted (G-4). There is **no mailbox synchronisation model** (N13).

| Concern | Persisted where | Notes |
|---|---|---|
| Original `.eml` bytes | Object storage (`storage_key`), fingerprinted (`sha256`) | Unchanged original (EV-2) |
| Headers From, To, Cc, Reply-To, Return-Path, Subject, Date, Message-ID | `source_lines` with `location_kind = EMAIL_HEADER`, `header_name` set, text = header value (redacted) | Provenance location = header name (G-4) |
| Body | `source_lines` with `location_kind = EMAIL_BODY_LINE`, numbered lines. text/plain preferred, otherwise HTML converted to text. | `source_metadata.body_part_used`. HTML is never stored for rendering. |
| Links in body (incl. HTML link targets) | `extractions` of type `URL`/`DOMAIN` with provenance to body lines | **Never fetched or opened** (FR-003, FR-008). There is no fetch-status column, because no fetch exists. |
| Sender/recipient addresses | `extractions` of type `EMAIL` with provenance to header lines | |
| Attachments | `source_metadata.attachments[]` (filename, content_type, size_bytes) | **Listed, never processed.** No child evidence rows, no parse results. |
| Unparseable / encrypted | `evidence_items.FAILED` with `EMAIL_UNPARSEABLE` / `EMAIL_ENCRYPTED`, `failure_retryable = false` **[SCHEMA-REC]** | No lines or extractions |
| `.msg`, `.mbox`, other mailbox formats | Rejected at upload. No row (§6.2). | `EMAIL_FORMAT_NOT_SUPPORTED` in audit metadata |

---

## 9. Extraction and Provenance Model

### 9.1 Pipeline enforced by the schema

```text
evidence_items ──▶ parse_results / source_pages / source_lines   (OCR or parser only; never the LLM)
                         │  (redacted text, stable line IDs)
                         ▼
LLM or rule proposes candidate {field_type, value, line_ids}   (not persisted)
                         ▼
Validator: value occurs literally (after normalisation) in the referenced source_lines?
     no  ──▶ discarded; only a count is stored in agent_steps.output_summary (EX-4)
     yes ──▶ INSERT extractions + extraction_source_lines (same transaction)
```

### 9.2 `extractions`

Purpose: one value found in one evidence item, with its exact location (spec §12.1).

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description / provenance |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | N | N | PK | |
| case_id | uuid | N | — | | S/I | N | N | IX(case_id, field_type) | |
| evidence_id | uuid | N | — | FK `(evidence_id, case_id)` ON DELETE CASCADE | S/I | N | N | FK | **Source evidence.** Must have `processing_status ∈ {PROCESSING, PROCESSED}` at insert. |
| parse_result_id | uuid | N | — | FK `(parse_result_id, case_id)` ON DELETE CASCADE | S/I | N | N | – | The parse the value was validated against. Implies the text source (OCR / PDF text / text parse). |
| agent_step_id | uuid | Y | null | FK agent_steps ON DELETE SET NULL | S/I | N | N | – | Producing step (model metadata lives on the step) |
| field_type | entity_type | N | — | | S/I | partly | N | IX | Spec `field_type` |
| raw_value | text | N | — | **Must occur literally in the concatenated text of its referenced `source_lines`** (INV-X1) | S/I | **Y** (proposed) / validated | **Y** | – | Spec `raw_value`. Exactly as read. |
| normalized_value | text | Y | null | Required iff `normalization_status = NORMALIZED` | S/I | N | **Y** | – | Spec `normalized_value`. Rules in 07. |
| normalization_status | normalization_status | N | — | | S/I | N | N | – | `NOT_NORMALIZED` ⇒ `entity_id IS NULL` (FR-009 failure: not merged) |
| value_amount_minor | bigint | Y | null | non-null iff field_type = AMOUNT and NORMALIZED; `≥ 0` | S/I | N | N | – | Typed amount (paise) |
| value_currency | char(3) | Y | null | with amount | S/I | N | N | – | `INR` |
| value_datetime | timestamptz | Y | null | for DATETIME when normalised | S/I | N | N | – | |
| value_datetime_precision | timestamp_precision | Y | null | with value_datetime | S/I | N | N | – | e.g. "around 12:40 PM" → `APPROXIMATE` |
| source_label | text | Y | null | length ≤ 50 | S/I | N | N | – | Label as printed, e.g. "UPI Ref No", "Ref no" (spec §3.2) |
| attributes | jsonb | N | '{}' | Shape per field_type **[SCHEMA-REC]**: URL `{lexical_signals:[…]}` (FR-008 URL row; no maliciousness claim); PERSON `{context:"payer"\|"payee_display_name"\|"claimed_name"\|"other"}` | S/I | **Y** | **Y** | – | |
| method | extraction_method | N | — | `CHECK (method <> 'USER')` | S/I | N | N | – | AD-02 method. User facts live in `user_statements`, never here. |
| confidence | numeric(4,3) | N | — | 0–1 | S/I | partly | N | – | Spec `confidence`. Stored, **never displayed as a number** (AD-02). |
| confidence_basis | confidence_basis | N | — | Identifier types (PHONE, URL, DOMAIN, UPI_ID, TRANSACTION, AMOUNT, EMAIL, ACCOUNT_HINT, SMS_SENDER_HEADER, MESSAGING_HANDLE) ⇒ `SOURCE_VALIDATION` | S/I | N | N | – | Identifier confidence = OCR line confidence × validator result. Not LLM self-assessment. |
| confidence_band | confidence_band | N | — | Derived from confidence by thresholds in 06 | S/I | N | N | – | Shown in the UI |
| snippet | text | N | — | length ≤ 200; substring of the redacted line text | S/I | N | **Y** | – | Spec provenance `snippet` |
| entity_id | uuid | Y | null | FK `(entity_id, case_id)` → entities ON DELETE SET NULL | S | N | N | FK | Spec `entity_id`†. Set by normalise/correlate. |
| correction_status | correction_status | N | 'UNMODIFIED' | | C | N | N | – | Spec `correction`† |
| corrected_value | text | Y | null | non-null iff USER_CORRECTED | C | N | **Y** | – | The original `raw_value`/`normalized_value` are **kept** (FR-013) |
| corrected_normalized_value | text | Y | null | | C | N | **Y** | – | |
| correction_statement_id | uuid | Y | null | FK `(…, case_id)` → user_statements; non-null iff USER_CORRECTED | C | N | N | – | Provenance of the correction = user statement |
| corrected_at | timestamptz | Y | null | | C | N | N | – | `corrected_by` = the statement's author |

**Validation status (PRD §10.3) is derived**, not stored:
- **Validated against source** = an extraction row exists, because only validated candidates are persisted.
- **User-corrected** = `correction_status = USER_CORRECTED`.
- **User-stated** = the fact comes from `user_statements`, not `extractions`.

A stored column would be constant and could drift. **[SCHEMA-REC]**

### 9.3 `extraction_source_lines`

Purpose: the relational form of the AD-02 provenance `location.lineIds[]`. Each extraction references ≥ 1 line of **its own** evidence.

| Field | Type | Null | Constraints | Description |
|---|---|---|---|---|
| extraction_id | uuid | N | PK part; FK `(extraction_id, case_id)` ON DELETE CASCADE | |
| source_line_id | uuid | N | PK part; FK `(source_line_id, case_id)` ON DELETE CASCADE; IX | |
| case_id | uuid | N | | |
| ordinal | smallint | N | `≥ 1` | Order of lines for multi-line values |

Invariant INV-X2 (transaction): the line's `evidence_id` equals the extraction's `evidence_id`, and every extraction has ≥ 1 row here.

### 9.4 Provenance record mapping (spec §12.2 → schema)

| Spec provenance field | Column(s) |
|---|---|
| `evidence_id` | `extractions.evidence_id` |
| `location` (page / region / line) | `extraction_source_lines` → `source_lines.page_number`, `line_number`, `bbox`, `header_name` |
| `snippet` | `extractions.snippet` |
| `method` | `extractions.method` (+ `parse_results.parser_kind` for the text source) |
| `confidence` | `extractions.confidence`, `confidence_basis`, `confidence_band` |

### 9.5 `user_statements`

Purpose: user-provided facts used as provenance (AD-02 `USER_STATEMENT`). Always shown as "You stated…" (FR-015). They are **not evidence** and **not fingerprinted**. The table is append-only.

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | N | N | PK | |
| case_id | uuid | N | — | FK cases ON DELETE CASCADE | S/I | N | N | FK | |
| author_user_id | uuid | N | — | FK users; must equal `cases.user_id` (OD-01) | S/I | N | N | – | |
| statement_kind | statement_kind | N | — | | S/I | N | N | – | |
| subject | text | N | — | e.g. `case.incident_time`, `finding:<id>`, `extraction:<id>`, `timeline_event:<id>` **[SCHEMA-REC]** | S/I | N | N | – | What the statement is about |
| value_text | text | N | — | length ≤ 2000 | S/I | N | **Y** | – | The user's words |
| normalized_value | text | Y | null | | S/I | N | **Y** | – | e.g. a normalised time or amount |
| value_datetime | timestamptz | Y | null | | S/I | N | N | – | Typed answer (TL-6, MI) |
| value_amount_minor | bigint | Y | null | `≥ 0` | S/I | N | N | – | |
| supersedes_statement_id | uuid | Y | null | FK self | S/I | N | N | – | A later statement replaces an earlier one. Nothing is edited in place. |

### 9.6 `sensitive_detections` (GR-09)

Purpose: records **where** an OTP or full card number was detected, **without the value**. Used for redaction and as the source for G-2 signal U2(a).

| Field | Type | Null | Constraints | Description |
|---|---|---|---|---|
| id | uuid | N | PK | |
| case_id | uuid | N | | |
| evidence_id | uuid | N | FK `(…, case_id)` ON DELETE CASCADE; IX | |
| source_line_id | uuid | N | FK `(…, case_id)` ON DELETE CASCADE | Line whose stored text carries the mask |
| kind | sensitive_kind | N | | OTP / CARD_NUMBER |
| char_start / char_end | integer | N | `0 ≤ start < end` | Mask span in the stored line text |
| detector_version | text | N | | Detection rule version (rule in 06/07) |

**There is no column for the detected value.** The value is redacted before `source_lines.text` is written. It therefore cannot appear in snippets, extractions, reports, exports or audit (GR-09, AC-009.2). **[SCHEMA-REC]** This also means the redacted value can never become an extraction, because literal validation runs against the redacted text.

### 9.7 Guarantees against untrusted LLM assertions

1. There is no path for an LLM value to become an `extractions` row without (a) ≥ 1 `extraction_source_lines` row and (b) passing the literal-occurrence check (INV-X1, X2).
2. There is no `LLM` parser kind. Source text is produced only by OCR or parsers (OD-03).
3. Rejected candidates are not stored (EX-4).
4. Every higher-level fact needs ≥ 1 `fact_sources` row (INV-P1). Relationships need ≥ 1 **evidence-derived** source (INV-P2).
5. Scam signals, timeline descriptions and the report summary are labelled AI-derived. They never overwrite `extractions` (§15).

---

## 10. Entity Model

### 10.1 `entities`

Purpose: a case-level canonical thing that one or more extractions (or a user statement) refer to (spec §12.1). **No entity is shared across cases** (NFR-08, N14).

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | N | N | PK | |
| case_id | uuid | N | — | FK cases ON DELETE CASCADE | S/I | N | N | FK | |
| entity_type | entity_type | N | — | | S/I | N | N | UQ part | |
| canonical_value | text | N | — | **`UNIQUE (case_id, entity_type, canonical_value)`** | S | N | **Y** | UQ | Spec `canonical_value`. Full value, needed for reporting (FR-009). |
| masked_value | text | N | — | | S | N | **Y** | – | Spec `masked_value`. Default display in graph/overview (spec §13.5). Masking rules in 07. |
| amount_minor / currency | bigint / char(3) | Y | null | AMOUNT only | S | N | N | – | Typed value for AMOUNT entities |
| is_user_stated | boolean | N | false | true ⇒ supported only by `fact_sources` of kind USER_STATEMENT | S | N | N | – | e.g., the demo's bank name answer |

**Support (provenance) of an entity:**
- `extractions.entity_id` for evidence-derived support.
- `fact_sources(entity_id, ref_kind = USER_STATEMENT)` for user-stated entities.

INV-N1: every entity has ≥ 1 of these, otherwise it is an orphan and is deleted (§24).

### 10.2 Per-type normalisation and uniqueness

Exact algorithms are in 07 and must reproduce `DECISIONS.md` §7.2.4.

| entity_type | Canonical value (meaning) | Masked display | Uniqueness scope | Notes |
|---|---|---|---|---|
| PHONE | E.164, e.g. `+919000000001` | partially masked | per case | Formats `+91 90000 00001` and `9000000001` merge into one entity (AC-009.1) |
| URL | scheme + lower-cased host + path; tracking parameters removed (e.g. `utm_*`) | as canonical | per case | Never fetched |
| DOMAIN | lower-cased host | as canonical | per case | |
| UPI_ID | lower-cased `handle@psp` | partially masked | per case | |
| TRANSACTION | reference digits/characters as printed, trimmed | partially masked | per case | Labels such as "UPI Ref No" and "Ref no" are kept in `extractions.source_label` |
| AMOUNT | `INR 8500.00`-style text + typed `amount_minor` | as canonical | per case | Several evidence items can support one amount entity |
| ACCOUNT_HINT | last four digits only (e.g. `…4821`) | as printed (already masked) | per case | **Full account numbers are never stored**, because they never appear in canonical values (minimisation) |
| BANK_OR_WALLET | name as stated | as canonical | per case | Must come from evidence or a user statement (GR-05) |
| SMS_SENDER_HEADER | upper-case header | as canonical | per case | |
| MESSAGING_HANDLE, EMAIL | normalised handle / lower-cased address | partially masked | per case | |
| PERSON | name as printed | as canonical | per case | Context (payer/payee/claimed) is kept in `extractions.attributes` |
| DATETIME | — | — | — | **[SCHEMA-REC]** DATETIME extractions feed the timeline. They are **not merged into graph entities** (`entity_id` stays null). The enum value exists to keep the spec §12.3 list intact. |

There is no entity type for OTPs or card numbers (§9.6).

---

## 11. Relationship / Evidence Graph Model

### 11.1 Four layers, none duplicated

| Layer | Stored as | Source |
|---|---|---|
| Fact extraction | `extractions` (+ lines) | FR-008 |
| **Evidence → entity links (`appears_in`)** | **Derived view `entity_evidence_links`** = `SELECT DISTINCT case_id, entity_id, evidence_id FROM extractions WHERE entity_id IS NOT NULL`. **Not stored.** | Spec §13.3 note ("can be derived from Extraction records"). PRD CR-2. |
| Entity → entity relationships | `relationships` + `fact_sources` | Spec §13.3, CR-3 |
| Graph view (`GET /cases/:id/graph`) | Derived: nodes = case + entities + evidence; edges = `entity_evidence_links` ∪ `relationships` | FR-011 |

### 11.2 `fact_sources` (AD-02 `SourceRef`, relational)

Purpose: the single, uniform provenance link from any higher-level fact to its sources. Both sides are real foreign keys (an "exclusive arc"), so deletes cascade correctly and "only source" queries are simple.

| Field | Type | Null | Constraints | Description |
|---|---|---|---|---|
| id | uuid | N | PK | |
| case_id | uuid | N | All FKs below are composite with `case_id` | Same-case guarantee |
| **Owner arc** (exactly one non-null) | | | `CHECK (num_nonnulls(relationship_id, timeline_event_id, scam_signal_id, missing_info_item_id, action_item_id, urgency_reason_id, entity_id) = 1)` | |
| relationship_id | uuid | Y | FK relationships ON DELETE CASCADE; partial IX | |
| timeline_event_id | uuid | Y | FK timeline_events ON DELETE CASCADE; partial IX | |
| scam_signal_id | uuid | Y | FK scam_signals ON DELETE CASCADE; partial IX | |
| missing_info_item_id | uuid | Y | FK missing_information_items ON DELETE CASCADE; partial IX | |
| action_item_id | uuid | Y | FK action_items ON DELETE CASCADE; partial IX | |
| urgency_reason_id | uuid | Y | FK urgency_reasons ON DELETE CASCADE; partial IX | |
| entity_id | uuid | Y | FK entities ON DELETE CASCADE; partial IX; only with `ref_kind = USER_STATEMENT` | User-stated entity support |
| **Target arc** | | | | |
| ref_kind | fact_ref_kind | N | | AD-02 |
| extraction_id | uuid | Y | FK extractions ON DELETE CASCADE; partial IX; non-null iff `ref_kind = EXTRACTION` | |
| evidence_id | uuid | Y | FK evidence_items ON DELETE CASCADE; partial IX; non-null iff `ref_kind = EVIDENCE` | |
| source_line_id | uuid | Y | FK source_lines ON DELETE CASCADE; only with `ref_kind = EVIDENCE` | Optional pinpoint (e.g., the redacted OTP line) |
| user_statement_id | uuid | Y | FK user_statements ON DELETE CASCADE; partial IX; non-null iff `ref_kind = USER_STATEMENT` | |
| ordinal | smallint | N | `≥ 1` | Display order |

A uniqueness rule prevents duplicate links: `UNIQUE NULLS NOT DISTINCT (owner columns…, ref_kind, extraction_id, evidence_id, source_line_id, user_statement_id)`. This requires PostgreSQL 15+.

### 11.3 `relationships`

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | N | N | PK | |
| case_id | uuid | N | — | FK cases ON DELETE CASCADE | S/I | N | N | – | |
| from_entity_id | uuid | N | — | FK `(…, case_id)` → entities ON DELETE CASCADE | S/I | N | N | FK | |
| relation_type | relation_type | N | — | Allowed type pairs per §11.4 (app validation) | S/I | **Y** | N | – | |
| to_entity_id | uuid | N | — | FK `(…, case_id)` → entities ON DELETE CASCADE; `CHECK (from_entity_id <> to_entity_id)` | S/I | N | N | IX | |
| agent_step_id | uuid | Y | null | FK agent_steps ON DELETE SET NULL | S/I | N | N | – | |
| — | | | | **`UNIQUE (case_id, from_entity_id, relation_type, to_entity_id)`** | | | | UQ | One edge per pair and type. Multiple supporting evidence items are multiple `fact_sources` rows, **not duplicate edges**. |

**Reconciliation with the Master Spec (§13.3, §17 `Relationship.evidence_id`).** This is a schema-level implementation of the same product concept, **not a change to product behaviour**.

| Aspect | Master Spec | This schema |
|---|---|---|
| Concept | A relationship carries an `evidence_id`: "the evidence that supports it" (§13.3 "Every relationship MUST carry an evidence_id") | Identical concept: every relationship is supported by evidence |
| Cardinality | Drawn with one `evidence_id` column | **One-to-many**: ≥ 1 `fact_sources` rows of kind `EXTRACTION` or `EVIDENCE` per relationship (INV-P2) |
| Same connection seen in two artifacts (e.g., R4 `PAID_TO` in E04 **and** E05) | A single column could hold only one; a second artifact would need a second, duplicate edge row | **One edge** (`UNIQUE (case_id, from_entity_id, relation_type, to_entity_id)`) with **two source rows** |

Why this preserves provenance:
- Every supporting artifact stays individually traceable, down to extraction, line and evidence.
- Removing one artifact removes only its source row, and the edge survives on the remaining support. When the last evidence-derived source disappears, the edge is deleted (OD-11 "only source" rule, §24.2).

Why this avoids duplicate edges:
- The graph (FR-011) shows each connection once. Edge counts are not inflated by the number of artifacts.
- Correlation re-runs upsert one edge instead of accumulating copies.

The "MUST carry evidence" rule is strengthened, not weakened: a relationship with zero evidence-derived sources cannot exist (INV-P2). User statements alone never support a relationship (CR-3, CR-4: "only when the supporting evidence shows the connection").

### 11.4 Relation vocabulary [DELEGATED G-6]

| relation_type | From → To | Meaning | Source |
|---|---|---|---|
| `HOSTED_ON` | URL → DOMAIN | URL is on domain | Spec §13.3 example; R1 |
| `SENT_LINK` | PHONE / MESSAGING_HANDLE / EMAIL / SMS_SENDER_HEADER → URL | The sender sent the link | R2 |
| `REQUESTED_PAYMENT_TO` | PHONE / MESSAGING_HANDLE / EMAIL → UPI_ID | The sender asked for payment to this UPI ID | R3 |
| `PAID_TO` | TRANSACTION → UPI_ID | Payment went to UPI ID | Spec §13.3 example; R4 |
| `AMOUNT_OF` | AMOUNT → TRANSACTION | Amount of the transaction | Spec §13.3 example; R5 |
| `DEBITED_FROM` | TRANSACTION → ACCOUNT_HINT | Debited from the masked account | R6 |
| `MESSAGE_CONTAINED` | SMS_SENDER_HEADER / EMAIL → PHONE / URL / UPI_ID | A message from the sender contained the identifier | R7 |
| `CONTACTED_FROM` | PHONE → PERSON | The person (as named in evidence) contacted the victim from this number | Spec §13.3 example `contacted_from` |

The semantics of these codes are fixed here. `08-EVIDENCE-GRAPH-TIMELINE.md` may add display wording but not change the codes.

### 11.5 Demo correlations

The demo correlations (`DECISIONS.md` §7.2.4) are rows of `entity_evidence_links`, derived from extractions:

| Correlation | Derived from |
|---|---|
| PHONE `+919000000001` in E01, E02, E06 | 3 PHONE extractions (one per item) with the same `entity_id` |
| URL `https://kyc-update-verify.example/kyc` in E01, E02, E03 | 3 URL extractions (E01's raw value keeps `?utm_source=sms`) with the same `entity_id` |
| UPI_ID `kyc.refund.desk@demoupi` in E02, E04, E05 | 3 UPI_ID extractions |
| TRANSACTION `627000418532` in E04, E05 | 2 TRANSACTION extractions (labels "UPI Ref No" / "Ref no") |

---

## 12. Timeline Model

### 12.1 `timeline_events`

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description / provenance |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | N | N | PK | |
| case_id | uuid | N | — | FK cases ON DELETE CASCADE | S/I | N | N | IX(case_id, sort_order) | |
| event_key | text | Y | null | `UNIQUE (case_id, event_key)`; non-null iff origin = AI_GENERATED | S/I | N | N | UQ | **[SCHEMA-REC]** Deterministic key (event type + supporting extraction IDs). Re-runs **upsert** rather than duplicate, and **never overwrite** corrected or dismissed events (FR-013 "persists"). |
| event_type | timeline_event_type | N | — | | C | **Y** | N | – | Spec `event_type` |
| event_at | timestamptz | Y | null | `CHECK ((timestamp_precision = 'INFERRED_ORDER_ONLY') = (event_at IS NULL))` | C | **Y** | N | – | Spec `timestamp`. **No invented exact times** (GR-07, TL-3). |
| timestamp_precision | timestamp_precision | N | — | | C | **Y** | N | – | Spec †. e.g. E03's 12:16 with the date inferred from the case → `APPROXIMATE` |
| time_source_text | text | Y | null | length ≤ 100 | S/I | N | **Y** | – | **[DELEGATED G-5]** Original text, e.g. "Around 12:05 PM" |
| sort_order | integer | N | — | | S | N | N | IX | Total order including inferred-order events (TL-4). Recomputed after changes. |
| description | text | N | — | length ≤ 300 | C | **Y** | **Y** | – | Short, neutral (spec §14.1) |
| confidence | numeric(4,3) | N | — | 0–1 | S | **Y** | N | – | Spec `confidence` |
| confidence_band | confidence_band | N | — | | S | N | N | – | Shown (TL-5) |
| origin | event_origin | N | — | | S/I | N | N | – | Spec † |
| correction_status | correction_status | N | 'UNMODIFIED' | | C | N | N | – | Spec † |
| original_event_type / original_event_at / original_timestamp_precision / original_description | (as above) | Y | null | Filled on the **first** correction; immutable afterwards; non-null iff USER_CORRECTED | S/I | **Y** | **Y** | – | Original AI value kept (FR-013, TL-7) |
| correction_statement_id | uuid | Y | null | FK `(…, case_id)` → user_statements; non-null iff USER_CORRECTED | C | N | N | – | Latest correction |
| dismissed_at | timestamptz | Y | null | | U | N | N | – | Dismissal (TL-6). The event is kept, hidden from the active timeline, and audited. |
| agent_step_id | uuid | Y | null | FK agent_steps ON DELETE SET NULL | S/I | N | N | – | |

**Source references** (spec `source_refs`): `fact_sources` rows with `timeline_event_id`. INV-P1 requires ≥ 1. A user-added event has a `USER_STATEMENT` source (`statement_kind = ADDED_EVENT`). A corrected event keeps its evidence sources **and** gains the correction statement.

### 12.2 `timeline_event_entities`

| Field | Type | Null | Constraints | Description |
|---|---|---|---|---|
| timeline_event_id | uuid | N | PK part; FK `(…, case_id)` ON DELETE CASCADE | |
| entity_id | uuid | N | PK part; FK `(…, case_id)` ON DELETE CASCADE; IX | |
| case_id | uuid | N | | |

Related entities: e.g. T8 PAYMENT_INITIATED ↔ AMOUNT, TRANSACTION, UPI_ID. These links feed G-2 U1 ("AMOUNT tied to … a timeline event of type payment-initiated or debit-notification").

### 12.3 Event-type vocabulary [DELEGATED G-6]

The codes cover spec §14.1, `DECISIONS.md` §7.2.6 (T1–T9) and §7.3:

| Code | Demo use |
|---|---|
| `MESSAGE_RECEIVED` | T1 SMS received; T3 contact sent the link |
| `CALL` | T2 call |
| `LINK_OPENED` | T4 |
| `CREDENTIAL_OTP_REQUEST` | T5 (G-2 U2(b)) |
| `CREDENTIALS_OR_OTP_SHARED` | T6 (value redacted) |
| `PAYMENT_REQUESTED` | T7 |
| `PAYMENT_INITIATED` | T8 (G-2 U1) |
| `DEBIT_NOTIFICATION` | T9 (G-2 U1) |
| `MESSAGE_SENT`, `OTHER` | Not used by the demo |

### 12.4 Contradictions and corrections

- **Contradiction** (TL-8, MI-2): a `missing_information_items` row with `finding_kind = CONTRADICTION` and `subject_timeline_event_id` (or `subject_entity_id`). It has ≥ 2 `fact_sources` pointing to the conflicting extractions or statements. The conflicting values are read from those sources, never copied.
- **Correction** (FR-013): a `user_statements` row (`CORRECTION`) is written. The original values are copied once into `original_*`, the current columns are updated, `correction_status = USER_CORRECTED` is set, an audit entry is written, any active review confirmation is voided, and the case moves to `TIMELINE_READY` (S-4).

---

## 13. Missing Information Model

### 13.1 `missing_information_items`

Purpose: missing fields, contradictions, missing timestamps and missing evidence, plus the targeted follow-up question for each (FR-014, FR-015).

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | N | N | PK | |
| case_id | uuid | N | — | FK cases ON DELETE CASCADE | S/I | N | N | – | |
| finding_key | text | N | — | **`UNIQUE (case_id, finding_key)`** | S/I | N | N | UQ | **[SCHEMA-REC]** Deterministic key, e.g. `MISSING_FIELD:BANK_WALLET_MERCHANT`. Re-runs upsert, so answers stay linked. |
| finding_kind | finding_kind | N | — | | S/I | N | N | – | MI-1–MI-5 |
| checklist_field | checklist_field | Y | null | Required for MISSING_FIELD | S/I | N | N | – | NCRP checklist row (PRD §14.1) |
| checklist_variant | checklist_variant | N | — | | S | N | N | – | AD-01 |
| subject_entity_id | uuid | Y | null | FK `(…, case_id)` ON DELETE CASCADE | S | N | N | – | e.g. incomplete transaction (MI-3) |
| subject_timeline_event_id | uuid | Y | null | FK `(…, case_id)` ON DELETE CASCADE | S | N | N | – | e.g. contradiction on T8; missing timestamp (MI-4) |
| reason_text | text | N | — | Template text | S | N | N | – | "Why it matters" (FR-014). Fixed template per field. |
| is_high_value | boolean | N | — | `question_status <> 'NONE' ⇒ is_high_value` | S | **Y** | N | – | Only high-value findings get questions (MI-6) |
| status | finding_status | N | 'OPEN' | `checklist_field = 'IDENTITY_DOCUMENT' ⇒ status = 'INFORMATIONAL' AND question_status = 'NONE'` | S | N | N | – | Identity document = "keep ready" only (OD-09) |
| resolution | finding_resolution | Y | null | non-null iff status = RESOLVED | S | N | N | – | |
| question_text | text | Y | null | non-null iff `question_status <> 'NONE'` | S | **Y** | N | – | AI-phrased wording (OD-12) |
| question_status | question_status | N | 'NONE' | | U | N | N | – | |
| answer_statement_id | uuid | Y | null | FK `(…, case_id)` → user_statements; non-null iff ANSWERED | U | N | N | – | **Answer provenance** = user statement (FR-015) |
| resolved_at | timestamptz | Y | null | | S | N | N | – | |

Context and conflicting sources are `fact_sources` rows with `missing_info_item_id`. A `CONTRADICTION` requires ≥ 2 such rows (INV-M2).

### 13.2 Demo: the missing debited-bank name

These are generic rows, not hard-coded data:
1. The missing-info step finds no `BANK_OR_WALLET` entity. It upserts the finding `MISSING_FIELD:BANK_WALLET_MERCHANT` (variant `FINANCIAL`, `is_high_value = true`, `question_status = OPEN`). The report shows "Not provided".
2. The user answers. This writes a `user_statements` row (`FOLLOW_UP_ANSWER`, `value_text` = the user's words), sets `answer_statement_id` and `question_status = ANSWERED`, and sets `status = RESOLVED`, `resolution = USER_ANSWER`.
3. A `BANK_OR_WALLET` entity is created with `is_user_stated = true`, supported by `fact_sources(entity_id, USER_STATEMENT)`. The report renders it as "(you stated)".
4. The case moves to `ACTIONS_READY` (S-4). There is no evidence reprocessing (AC-015.2).

---

## 14. Deterministic Urgency Model (G-2)

### 14.1 `urgency_assessments`

Purpose: a persisted snapshot of the rule-engine result. **Never AI-generated. There is no confidence column.** **[DELEGATED: urgency caching = stored derived value]**

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | **N** | N | PK | |
| case_id | uuid | N | — | FK cases ON DELETE CASCADE | S/I | N | N | IX(case_id, computed_at DESC) | |
| rule_version | text | N | — | e.g. `G2-v1` | S/I | N | N | – | Distinguishes future rule changes from historical assessments |
| level | urgency_level | N | — | **`CHECK (rule_version <> 'G2-v1' OR (level='HIGH' AND signal_u1) OR (level='MEDIUM' AND NOT signal_u1 AND signal_u2) OR (level='LOW' AND NOT signal_u1 AND NOT signal_u2))`** | S/I | N | N | – | The **DB enforces the G-2 v1 rule** relating level to signals |
| signal_u1_financial_loss | boolean | N | — | | S/I | N | N | – | U1 = AD-01 `financial_loss_reported` |
| signal_u2_credential_exposure | boolean | N | — | | S/I | N | N | – | U2 = (a) OTP detected (`sensitive_detections` kind OTP) **or** (b) a `CREDENTIAL_OTP_REQUEST` event sourced from evidence |
| explanation_text | text | N | — | Rendered from the fixed `DECISIONS.md` §7.3 templates. **The `{sources}` placeholders are not baked into the text.** They are rendered at display time from the reasons' live `fact_sources`. | S/I | N | **Y** | – | "Urgency is HIGH because…" |
| disclaimer_text | text | N | — | Fixed template: "…not a risk score, a legal assessment, or a law-enforcement determination." | S/I | N | N | – | Always shown with the level (AC-G2.7) |
| template_params | jsonb | N | — | e.g. `{amount_minor, currency, date, time}` | S/I | N | **Y** | – | Values come only from validated facts |
| analysis_run_id | uuid | Y | null | FK analysis_runs ON DELETE SET NULL | S/I | N | N | – | |
| computed_at | timestamptz | N | now() | | S/I | N | N | – | |
| is_current | boolean | N | true | **Partial `UNIQUE (case_id) WHERE is_current`** | S | N | N | UQ | Exactly one current assessment per case |

### 14.2 `urgency_reasons`

| Field | Type | Null | Constraints | Description |
|---|---|---|---|---|
| id | uuid | N | PK; `UNIQUE (id, case_id)` | |
| case_id | uuid | N | | |
| assessment_id | uuid | N | FK `(…, case_id)` ON DELETE CASCADE | |
| signal | urgency_signal | N | | U1 or U2 |
| ordinal | smallint | N | `UNIQUE (assessment_id, ordinal)` | Highest level first (G-2 tie-breaking) |
| sentence_text | text | N | Template sentence | One per distinct transaction (no double counting) or per U2 source |

Sources are `fact_sources(urgency_reason_id, …)`, at least one per reason (INV-P1), so every reason links to its sources (AC-G2.6).

### 14.3 Rule execution (mandatory behaviour → representation)

| G-2 rule | Representation |
|---|---|
| 1. Never reached `ACTIONS_READY` in any run → "Not assessed yet" | **No `urgency_assessments` row** for the case |
| 2–4. HIGH / MEDIUM / LOW | `level` plus signals (CHECK above) |
| Tie-breaking: highest wins, all firing signals listed | `urgency_reasons.ordinal` |
| Conflicting amounts: both shown, never summed | One reason sentence per TRANSACTION entity. Contradiction noted from `missing_information_items`. |
| Identical facts → identical output (AC-G2.5) | Pure function of facts + `rule_version`. No AI input column exists. |

### 14.4 Staleness and recomputation

- **"Based on the last analysis — may be out of date"** is derived, not stored: shown when the current assessment exists and `cases.status` is earlier than `ACTIONS_READY` (G-2 missing-data rule).
- The rule engine writes a new row (and flips `is_current`) whenever the case reaches `ACTIONS_READY`, including after answers and corrections. The previous rows stay as history.
- **On evidence deletion** (an S-4 re-entry), two source rules apply together:
  - **G-2** (`DECISIONS.md` §7.3): "the last computed value stays visible, marked 'Based on the last analysis — may be out of date'".
  - **FR-025**: derived data that depended *only* on the deleted evidence is "removed or recomputed".

  The schema applies them as follows:
  1. `fact_sources` rows citing the deleted evidence cascade away.
  2. **If every reason of the current assessment still has ≥ 1 source**, the assessment **stays** as the current, out-of-date value (G-2). Displayed source lists come from live `fact_sources`, so they no longer show the deleted item.
  3. **If any reason is left with zero sources** (it depended only on the deleted evidence), that assessment is deleted (FR-025 "removed"). The rule engine immediately writes a replacement from the remaining facts (FR-025 "recomputed"), which is also shown as out of date until `ACTIONS_READY` is reached again. Because the case has reached `ACTIONS_READY` before, G-2 rule 1 ("Not assessed yet") does not apply.

  **[SCHEMA-REC]**: this application of G-2 and FR-025 is the schema's implementation. Neither source prescribes this exact mechanism.

---

## 15. Scam Analysis Model

### 15.1 Separation of layers

| Layer | Stored in | Can it overwrite another layer? |
|---|---|---|
| Observed / extracted facts | `extractions`, `entities`, `timeline_events` | — |
| Classification (labels) | `scam_signals.label`, `is_primary`; `cases.incident_type` (= primary label, AD-01) | **No.** Classification writes only `scam_signals` and `cases.incident_type`. It has no write path to fact tables. |
| Explanation | `scam_signals.explanation` | No |
| Confidence | `scam_signals.confidence`, `confidence_band` (FR-010, SA-5) | — |
| Provenance | `fact_sources(scam_signal_id, …)` — ≥ 1 per label (FR-010, SA-2) | — |
| Model / analysis metadata | `agent_steps` (provider, model, latency, token counts, fallback flag) | — |

### 15.2 `scam_signals`

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | N | N | PK | |
| case_id | uuid | N | — | FK cases ON DELETE CASCADE | S/I | N | N | IX | |
| agent_step_id | uuid | N | — | FK agent_steps ON DELETE CASCADE | S/I | N | N | – | Producing step (model metadata) |
| label | scam_label | N | — | `UNIQUE (case_id, label)` | S/I | **Y** | N | UQ | Fixed taxonomy only (AD-01) |
| is_primary | boolean | N | — | **Partial `UNIQUE (case_id) WHERE is_primary`** | S/I | **Y** | N | UQ | Exactly one primary (INV-S1 adds "≥ 1") |
| confidence | numeric(4,3) | N | — | 0–1 | S/I | **Y** | N | – | Basis `MODEL_JUDGEMENT`. Never displayed as a number. |
| confidence_band | confidence_band | N | — | | S/I | N | N | – | |
| explanation | text | N | — | length ≤ 600; passed the forbidden-phrase check (GR-12) | S/I | **Y** | **Y** | – | Calibrated ("signals consistent with…") |

Further rules:
- `UNKNOWN_OTHER` only alone and only as primary (INV-S2, transaction invariant).
- Signals are **replaced per analysis run**: the previous set is deleted and the new set inserted in one transaction. History is kept in `agent_steps` and audit, not as old rows. **[SCHEMA-REC]**

---

## 16. Action Item Model

### 16.1 `action_items`

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | N | N | PK | |
| case_id | uuid | N | — | FK cases ON DELETE CASCADE | S/I | N | N | – | |
| action_code | text | N | — | **`UNIQUE (case_id, action_code)`**; must exist in the curated action-template list (06) | S/I | N | N | UQ | e.g. `CONTACT_BANK`, `REPORT_1930_NCRP`, `PRESERVE_EVIDENCE`, `REPORT_SUSPECT_NCRP` **[SCHEMA-REC]** codes |
| action_text | text | N | — | Rendered from the template | S | N | N | – | Spec `action`. Instructional wording (AC-R5). |
| reason_text | text | N | — | Rendered from the template plus case facts | S | partly | **Y** | – | Spec `reason` (AC-R2) |
| priority_rank | smallint | N | — | `≥ 1` (1 = most urgent) | S | N | N | – | Spec `priority`. The scale's meaning is defined in 06 (`DECISIONS.md` §11). |
| official_channel_code | text | Y | null | Must exist in the curated static channel list | S | N | N | – | **Codes only.** Numbers and URLs are never stored in or generated into the DB (GR-14). |
| status | action_status | N | 'TODO' | | **U** | N | N | – | Spec `status`. User completion. |
| status_changed_by | uuid | Y | null | FK users | U | N | N | – | Who marked it |
| status_changed_at | timestamptz | Y | null | | U | N | N | – | |
| agent_step_id | uuid | Y | null | FK agent_steps ON DELETE SET NULL | S | N | N | – | System recommendation provenance |

Notes:
- **Recommendation vs. completion:** the system writes `action_code`, the texts, `priority_rank` and sources. **Only the user** writes `status`, `status_changed_by` and `status_changed_at`. Each status change is audited (`ACTION_STATUS_CHANGED`).
- Spec field `source` → `fact_sources(action_item_id, …)` (≥ 1, INV-P1).
- On re-run, actions are **upserted by `action_code`**, preserving `status`. Codes that are no longer recommended are deleted, and the audit log keeps their history. **[SCHEMA-REC]**

---

## 17. Report and Report Versioning

### 17.1 `reports` (one row per version; spec `Report`)

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | N | N | PK | |
| case_id | uuid | N | — | FK cases ON DELETE CASCADE | S/I | N | N | – | |
| version_number | integer | N | — | `≥ 1`; **`UNIQUE (case_id, version_number)`** | S/I | N | N | UQ | Spec `version`. Monotonic. Never reused. |
| status | report_status | N | 'GENERATING' | §23.3 | S | N | N | IX(case_id, status) | |
| schema_version | text | N | — | | S/I | N | N | – | ReportDocument `schemaVersion` (AD-04) |
| content | jsonb | Y | null | non-null iff status = GENERATED | S | partly | **Y** | – | **Structured complaint draft snapshot** (AD-04 sections 0–10). Each key fact embeds its SourceRefs. The AI writes only the summary and the signal explanation. |
| content_sha256 | char(64) | Y | null | non-null iff GENERATED | S/I | N | N | – | Checksum of the canonical JSON |
| pdf_storage_key | text | Y | null | UQ; non-null iff GENERATED | S | N | **Y** | – | Spec `storage_key` (rendered PDF) |
| pdf_sha256 | char(64) | Y | null | non-null iff GENERATED | S/I | N | N | – | Spec `checksum` |
| analysis_run_id | uuid | Y | null | FK analysis_runs (kind REPORT_GENERATION) ON DELETE SET NULL | S/I | N | N | – | Generation metadata |
| requested_by | uuid | N | — | FK users | S/I | N | N | – | User who triggered generation (FR-017) |
| generated_at | timestamptz | Y | null | non-null iff GENERATED or INVALIDATED-after-GENERATED | S/I | N | N | – | Spec `generated_at` |
| failure_code | text | Y | null | non-null iff FAILED | S | N | N | – | |
| invalidated_at | timestamptz | Y | null | non-null iff INVALIDATED | S | N | N | – | |
| invalidation_reason | report_invalidation_reason | Y | null | non-null iff INVALIDATED | S | N | N | – | FR-025 |

CHECK: `status = 'INVALIDATED' ⇒ content IS NULL AND pdf_storage_key IS NULL`. An invalidated version keeps only non-content metadata.

### 17.2 Current version (derived)

**Current version** = the row with the highest `version_number` where `status = GENERATED`. Older GENERATED rows stay viewable (FR-017 AC-017.5) until they are invalidated.

### 17.3 `review_confirmations` (R-1)

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, report_id)` | S/I | N | N | PK | |
| case_id | uuid | N | — | FK `(report_id, case_id)` → reports ON DELETE CASCADE | S/I | N | N | – | |
| report_id | uuid | N | — | (above) | S/I | N | N | FK | **The specific version confirmed** |
| report_content_sha256 | char(64) | N | — | Must equal `reports.content_sha256` at insert | S/I | N | N | – | Bound to version **and** checksum (R-1, FR-019) |
| confirmed_by | uuid | N | — | FK users; = case owner | S/I | N | N | – | Spec `review_confirmed_by`† ("who") |
| confirmed_at | timestamptz | N | now() | | S/I | N | N | – | Spec `review_confirmed_at`† ("when") |
| voided_at | timestamptz | Y | null | | S | N | N | – | |
| void_reason | confirmation_void_reason | Y | null | non-null iff voided | S | N | N | – | |
| — | | | | **Partial `UNIQUE (report_id) WHERE voided_at IS NULL`** | | | | UQ | At most one active confirmation per version |

**R-1 semantics, represented exactly:**
- `cases.status = USER_REVIEW` means *awaiting human review*. It is set when a report version reaches `GENERATED`.
- Confirming inserts a `review_confirmations` row **and does not change `cases.status`**. The case remains `USER_REVIEW`, and the UI shows "Reviewed – version N".
- Export eligibility = an un-voided confirmation exists on the **current** version (FR-019 AC-019.1). It is never based on `cases.status` alone.
- Any S-4 change, regeneration or evidence deletion voids active confirmations (`CASE_CHANGED`, `REPORT_REGENERATED`, `EVIDENCE_DELETED`).
- There is **no case-level "confirmed" flag**.

### 17.4 `exports` and `export_evidence_items`

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK; `UNIQUE (id, case_id)` | S/I | N | N | PK | |
| case_id | uuid | N | — | | S/I | N | N | IX(case_id, created_at DESC) | |
| report_id | uuid | N | — | FK `(report_id, case_id)` → reports ON DELETE CASCADE | S/I | N | N | FK | |
| review_confirmation_id | uuid | N | — | **FK `(review_confirmation_id, report_id)` → review_confirmations(id, report_id)**; must be un-voided at insert | S/I | N | N | – | **The DB guarantees that an export points to a confirmation of the same version** (FR-019/020) |
| format | export_format | N | — | | S/I | N | N | – | PDF or ZIP (OD-07) |
| status | export_status | N | 'GENERATING' | | S | N | N | – | |
| storage_key | text | Y | null | UQ; non-null iff READY | S | N | **Y** | – | |
| sha256 | char(64) | Y | null | non-null iff READY | S/I | N | N | – | |
| byte_size | bigint | Y | null | | S/I | N | N | – | |
| requested_by | uuid | N | — | FK users | S/I | N | N | – | |
| completed_at | timestamptz | Y | null | | S | N | N | – | |
| failure_code | text | Y | null | | S | N | N | – | |

`export_evidence_items`: PK `(export_id, evidence_id)`, `case_id`, FK `(export_id, case_id)` ON DELETE CASCADE, FK `(evidence_id, case_id)` ON DELETE CASCADE. It records which originals the user selected. The manifest is a file inside the ZIP and is not duplicated in the DB.

---

## 18. Integrity Verification

### 18.1 `integrity_verifications` (immutable results; FR-021)

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK | S/I | N | N | PK | |
| case_id | uuid | N | — | | S/I | N | N | – | |
| evidence_id | uuid | N | — | FK `(…, case_id)` ON DELETE CASCADE | S/I | N | N | IX(evidence_id, verified_at DESC) | |
| requested_by | uuid | N | — | FK users | S/I | N | N | – | Verifier |
| recorded_sha256 | char(64) | N | — | = `evidence_items.sha256` at verification time | S/I | N | N | – | Original hash |
| computed_sha256 | char(64) | Y | null | non-null iff result ∈ {MATCH, MISMATCH} | S/I | N | N | – | Recomputed hash |
| result | verification_result | N | — | `MATCH ⇔ computed = recorded`; `MISMATCH ⇔ computed ≠ recorded`; `COULD_NOT_COMPLETE ⇔ computed IS NULL` (CHECK) | S/I | N | N | – | **An unreadable object yields `COULD_NOT_COMPLETE`, never a false `MISMATCH`** (IN-6) |
| failure_code | verification_failure_code | Y | null | non-null iff COULD_NOT_COMPLETE | S/I | N | N | – | |
| attestation_result | attestation_result | Y | null | **Must be null unless OD-06 is enabled** and `attestation_ref` exists | S/I | N | N | – | Optional |
| verified_at | timestamptz | N | now() | | S/I | N | N | – | |

### 18.2 Notes

- **Per-item integrity status** (FR-018 AC-018.3) is derived: the latest verification `result`, or "not yet verified" if there are no rows. It is not stored on `evidence_items`.
- What a match proves (IN-7: byte equality since fingerprinting; not truthfulness; not legal admissibility) is **fixed UI copy**, not data.
- The database has **no dependency on any blockchain**. `evidence_items.attestation_ref` and `integrity_verifications.attestation_result` are nullable and unused unless OD-06 is built.

---

## 19. Audit Log

### 19.1 `audit_logs` (spec `AuditLog`)

| Field | Type | Null | Default | Constraints | Edit | AI | Sens | Idx | Description |
|---|---|---|---|---|---|---|---|---|---|
| id | uuid | N | gen_random_uuid() | PK | S/I | N | N | PK | |
| occurred_at | timestamptz | N | now() | | S/I | N | N | IX | Spec `timestamp` |
| case_id | uuid | Y | null | **No FK.** Survives case deletion (OD-11). | S/I | N | N | IX(case_id, occurred_at DESC) | |
| actor_kind | audit_actor_kind | N | — | | S/I | N | N | – | Spec `actor` |
| actor_user_id | uuid | Y | null | No FK; non-null iff USER | S/I | N | N | IX(actor_user_id, occurred_at DESC) | |
| action | text | N | — | Must be in the action vocabulary (§19.3) | S/I | N | N | – | Spec `action` |
| target_type | text | Y | null | e.g. `case`, `evidence`, `report`, `export` | S/I | N | N | – | Spec `target` |
| target_id | uuid | Y | null | No FK | S/I | N | N | – | |
| outcome | audit_outcome | N | — | | S/I | N | N | – | Result / status |
| request_id | text | Y | null | | S/I | N | N | IX | Correlation ID |
| metadata | jsonb | N | '{}' | **Key whitelist only** (§19.2) | S/I | N | N | – | Spec `metadata` |

### 19.2 Content rule

Audit entries never contain raw evidence (FR-023, OD-11, AC-023.2, AC-25).

| `metadata` may contain | `metadata` must never contain |
|---|---|
| UUIDs, evidence refs (`E04`), report version numbers, SHA-256 values, enum codes (status from/to, failure/rejection codes, scam label codes, action codes), counts, booleans (e.g. `fallback_used`), byte sizes, page counts | Evidence text, snippets, extracted or normalised values, entity values, OTPs, filenames, user labels, user statement text, email addresses, IP addresses, report content, question or answer text |

Enforcement:
- **[SCHEMA-REC]** The application writes audit entries only through one function that validates `metadata` against a per-action key whitelist. Unknown keys are rejected, which fails the action.
- **[IMPL, optional]** A DB trigger rejects any non-whitelisted top-level key.

### 19.3 Action vocabulary (minimum, FR-023)

| Area | Actions |
|---|---|
| Auth | `AUTH_CODE_REQUESTED`, `AUTH_SIGNED_IN`, `AUTH_SIGN_IN_FAILED`, `AUTH_SIGNED_OUT` |
| Case | `CASE_CREATED`, `CASE_UPDATED`, `CASE_STATUS_CHANGED`, `CASE_DELETED` (tombstone) |
| Evidence | `EVIDENCE_UPLOADED`, `EVIDENCE_REJECTED`, `EVIDENCE_VIEWED` (signed link issued or stream served), `EVIDENCE_PROCESSING_FAILED`, `EVIDENCE_DELETED` (tombstone) |
| Analysis | `ANALYSIS_STARTED`, `ANALYSIS_STEP_FAILED`, `ANALYSIS_COMPLETED`, `ANALYSIS_FAILED`, `FALLBACK_USED` (FR-027) |
| Corrections and answers | `EXTRACTION_CORRECTED`, `TIMELINE_EVENT_CORRECTED`, `TIMELINE_EVENT_ADDED`, `TIMELINE_EVENT_DISMISSED`, `QUESTION_ANSWERED`, `QUESTION_SKIPPED`, `ACTION_STATUS_CHANGED` |
| Reports and exports | `REPORT_GENERATED`, `REPORT_GENERATION_FAILED`, `REPORT_CONFIRMED`, `REPORT_CONFIRMATION_VOIDED`, `REPORT_INVALIDATED`, `EXPORT_CREATED`, `EXPORT_DOWNLOADED` |
| Integrity | `INTEGRITY_VERIFIED` |

### 19.4 Atomicity and append-only

- **An audited action fails if its audit entry cannot be written** (PRD FR-023 failure behaviour). The audit insert is in the **same transaction** as the domain change. If it fails, the transaction rolls back.
- For actions with an external side effect (object deletion, export file creation, signed-link issuance), the DB transaction (domain change + audit) commits **before** the side effect is released. A side effect that then fails is recorded as a follow-up `FAILED` outcome entry, with retry.
- **Append-only:** the application's DB role has `INSERT, SELECT` only on `audit_logs`, with no `UPDATE` or `DELETE`. A trigger rejecting UPDATE/DELETE gives defence in depth. **[SCHEMA-REC]**
- After case deletion, the case's audit rows (content-free) and the `CASE_DELETED` tombstone remain. They are no longer reachable through any product route, because the case no longer exists.

---

## 20. Security and Isolation

| Concern | Database-level specification | Label |
|---|---|---|
| User/case isolation | Every case-owned row has `case_id NOT NULL`. Every parent exposes `UNIQUE (id, case_id)`. Every child references `(parent_id, case_id)`. **The FK chain makes cross-case references impossible.** The only root is `cases.user_id`. | [SCHEMA-REC] for NFR-08 |
| Authorisation boundary | One application guard resolves `case_id → user_id` and compares it with the session user before any case-scoped query (AU-5). Queries always filter by `case_id`. Not-owned is answered as not-found. | [PRODUCT] AU-5 |
| Row-level security | **Not required.** PostgreSQL RLS keyed on a per-request `app.user_id` setting is an optional defence-in-depth measure. It is not decided and not assumed. | [IMPL] |
| LLM context | Case-isolation is a query-scoping rule. Every AI step loads data by one `case_id` (NFR-08). There are no cross-case views or tables. | [PRODUCT] |
| Deletion | Hard delete, cascading on `case_id` / `evidence_id` (§24) | [PRODUCT] OD-11 |
| Sensitive metadata | Columns marked **Sens = Y** are never written to logs, error messages or audit metadata (SP-10). Includes filenames, labels, extracted values, lines, snippets, user statements and report content. | [PRODUCT] §16.3 |
| Secrets | OTP codes and session tokens are stored only as hashes. OTP values and card numbers from evidence are never stored (§9.6). | [SCHEMA-REC] |
| Encryption | Evidence objects are encrypted at rest by the storage provider (OD-05). **Database at-rest encryption depends on the deferred hosting choice (OD-13) and is not claimed here.** No application-level column encryption is specified (envelope encryption is future per OD-05). TLS is required for DB connections. | [PRODUCT] / honest scope |
| Least privilege | Separate roles: **migration role** (DDL); **application role** (DML on domain tables, INSERT/SELECT only on `audit_logs`, no DDL); **queue role**, if separate, limited to the queue schema (OD-15). No superuser at runtime. | [SCHEMA-REC] |
| Auditability | §19 | [PRODUCT] FR-023 |

---

## 21. Indexing Strategy

| Index | Query it serves |
|---|---|
| `cases (user_id, updated_at DESC)` | "My cases" list. Ownership lookups. |
| `cases (case_reference)` UQ | Lookup by displayed reference |
| `sessions (token_hash)` UQ; `sessions (expires_at)` | Per-request session check; expiry cleanup |
| `otp_challenges (email, created_at DESC)`; `(requester_fingerprint)`; `(expires_at)` | Code verification; rate limits; cleanup |
| `evidence_items (case_id, sequence_no)` UQ | Evidence list ordered E01…; slot allocation; **20-item cap** |
| `evidence_items (case_id, processing_status)` | "N/N processed"; gate `INGESTING → EXTRACTED`; failed items |
| `evidence_items (case_id, sha256)` | Hash lookup within a case (S-H2 benchmark checks, QA). Duplicates are allowed, so this is non-unique. |
| `evidence_items (storage_key)` UQ | Orphan-object reconciliation |
| `evidence_items (processing_status, created_at)` partial `WHERE processing_status = 'UPLOADING'` | Cleanup of abandoned uploads |
| `parse_results (evidence_id)` UQ; `source_lines (parse_result_id, page_number, line_number)` UQ; `source_lines (evidence_id)` | Source display; provenance jumps |
| `extractions (evidence_id)`; `(case_id, field_type)`; `(entity_id)` | Extractions per evidence; per-type benchmark checks; entity support, orphan sweep, `entity_evidence_links` view |
| `extraction_source_lines (source_line_id)` | Reverse lookup when lines cascade |
| `entities (case_id, entity_type, canonical_value)` UQ | Merge/upsert; overview counts |
| `relationships (case_id, from_entity_id, relation_type, to_entity_id)` UQ; `(to_entity_id)` | Graph edges; cascade from entity deletion |
| `fact_sources` partial indexes on each non-null FK column | Cascades; "only source" checks (OD-11); provenance coverage queries (GR-06) |
| `timeline_events (case_id, sort_order)`; `(case_id, event_key)` UQ | Ordered timeline; idempotent upsert |
| `timeline_event_entities (entity_id)` | U1 evaluation; cascade |
| `analysis_runs (case_id) UNIQUE WHERE status IN ('QUEUED','RUNNING')` | **One active run per case** (FR-006 AC-006.4) |
| `analysis_runs (case_id, created_at DESC)`; `agent_steps (run_id, sequence_no)` | Activity feed (FR-024) |
| `agent_steps (case_id, step_name, evidence_id, input_hash) WHERE status = 'SUCCEEDED'` | **Idempotency.** Skip already-processed evidence (FR-006 AC-006.3). |
| `scam_signals (case_id) UNIQUE WHERE is_primary` | One primary label |
| `missing_information_items (case_id, finding_key)` UQ | Upsert; missing-info screen |
| `action_items (case_id, action_code)` UQ | Upsert; checklist |
| `urgency_assessments (case_id) UNIQUE WHERE is_current`; `(case_id, computed_at DESC)` | Overview; history |
| `reports (case_id, version_number)` UQ; `(case_id, status)` | Current version; version list |
| `review_confirmations (report_id) UNIQUE WHERE voided_at IS NULL` | Export gate |
| `exports (case_id, created_at DESC)`; `(report_id)` | Export history; cascades |
| `integrity_verifications (evidence_id, verified_at DESC)` | Latest integrity status (FR-018) |
| `audit_logs (case_id, occurred_at DESC)`; `(actor_user_id, occurred_at DESC)`; `(request_id)` | Case audit view; auth history; request tracing |

No index is placed on free-text columns. No full-text search is specified.

---

## 22. Constraints and Invariants

Enforcement layers:

| Code | Layer |
|---|---|
| **DB** | Database constraint or index |
| **TX** | Transaction invariant (application, within one transaction, under the case-row lock) |
| **APP** | Application validation before write |
| **BG** | Background-processing invariant (worker steps / cleanup) |

| ID | Invariant | Layer | Source |
|---|---|---|---|
| INV-C1 | Every case has exactly one owner, set from the session | DB (NOT NULL FK) + APP | FR-001, OD-01 |
| INV-C2 | A user can access only cases where `cases.user_id` = session user | APP (guard) + DB (composite FKs prevent cross-case links) | AU-5, NFR-08 |
| INV-C3 | Case status changes only via the allowed transition table (§23.1), and each change is audited | TX | AD-05, S-5 |
| INV-C4 | `cases.incident_type` equals the current primary `scam_signals.label` | TX | AD-01 |
| INV-C5 | No AI step writes `cases.summary` (user-only). The AI incident summary is written only to `reports.content`. | APP | FR-001; AD-04 |
| INV-C6 | `cases.contact_text` is never read by analysis, urgency, reporting or any communication workflow | APP | FR-001 (no further behaviour defined) |
| INV-E1 | Evidence belongs to exactly one case | DB | Spec §17 |
| INV-E2 | At most 20 evidence items per case | DB (`sequence_no` 1–20 + UQ) + TX (slot allocation) | G-4 |
| INV-E3 | File size ≤ 10 MB, pages ≤ 20, image ≤ 40 MP, pasted text ≤ 20,000 chars | DB (CHECKs) + APP (authoritative at confirmation) | G-4 |
| INV-E4 | Unsupported or mismatched types never become `UPLOADED`. Rejected uploads leave no row. | APP + TX (delete row in confirmation tx) + DB (`detected_content_type` check) | G-4, §16.3 |
| INV-E5 | `sha256` and `uploaded_at` are set exactly once (at confirmation) and never change | DB (trigger) + APP | FR-004 |
| INV-E6 | An evidence item with `failure_code = PDF_NO_TEXT_LAYER` has no source lines, extractions or sensitive detections, and is cited by no `fact_sources` | TX (lines written only after all pages pass) + BG | OD-03 |
| INV-E7 | A `PDF_NO_TEXT_LAYER` failure is non-retryable | DB (CHECK) | OD-03 |
| INV-E8 | Only items in `UPLOADED` (or retryable `FAILED`) can enter `PROCESSING` | TX + BG | S-3 |
| INV-E9 | The case cannot advance past `EXTRACTED` while any item is not `PROCESSED` | TX | PRD FR-006 |
| INV-X1 | An extraction's `raw_value` occurs literally in the text of its referenced source lines | TX (validator in the insert transaction) | GR-01–GR-05, EX-2 |
| INV-X2 | Each extraction references ≥ 1 source line of its own evidence | TX + DB (FK) | AD-02 |
| INV-X3 | No extraction has `method = USER`. User facts live only in `user_statements`. | DB (CHECK) | AD-02, FR-015 |
| INV-X4 | Identifier-type extractions have `confidence_basis = SOURCE_VALIDATION` | DB (CHECK) | AD-02 |
| INV-X5 | Corrections never overwrite originals | DB (`original_*` immutable trigger) + APP | FR-013 |
| INV-P1 | Every timeline event, scam signal, action item, missing-info item and urgency reason has ≥ 1 `fact_sources` row | TX (+ optional deferred constraint trigger) | GR-06, NFR-04 |
| INV-P2 | Every relationship has ≥ 1 source of kind `EXTRACTION` or `EVIDENCE` | TX | Spec §13.3, CR-3/CR-4 |
| INV-P3 | Provenance always points to existing sources in the same case | DB (composite FKs, cascades) | AD-02, NFR-08 |
| INV-P4 | No report key fact is rendered without a SourceRef; absent fields read "Not provided" | APP (renderer) | GR-06, GR-07 |
| INV-N1 | Every entity has ≥ 1 supporting extraction or user-statement source, otherwise it is deleted | TX (orphan sweep) | FR-025 |
| INV-N2 | Entities are unique per case, type and canonical value. None are shared across cases. | DB | NFR-08 |
| INV-S1 | Exactly one primary scam signal when any signals exist | DB (≤ 1) + TX (≥ 1) | AD-01 |
| INV-S2 | `UNKNOWN_OTHER` appears only alone and only as primary | TX | AD-01 |
| INV-S3 | Labels come only from the taxonomy | DB (enum) | FR-010 |
| INV-M1 | The identity-document item is always `INFORMATIONAL` with no question | DB (CHECK) | OD-09 |
| INV-M2 | A contradiction has ≥ 2 sources | TX | MI-2 |
| INV-U1 | Urgency level matches its signals under its rule version | DB (CHECK for `G2-v1`) | G-2 |
| INV-U2 | Urgency is written only by the rule engine, with no AI input. There is no confidence column. | APP + schema shape | G-2 |
| INV-U3 | At most one current urgency assessment per case | DB (partial UQ) | G-2 |
| INV-R1 | Report versions are unique and monotonic per case | DB (UQ) + TX | FR-017 |
| INV-R2 | A review confirmation references exactly one report version and its checksum | DB (FK, NOT NULL) + TX (checksum equality) | FR-019, R-1 |
| INV-R3 | Confirmation is allowed only when `cases.status = USER_REVIEW` and the report is the current GENERATED version | TX | R-1, FR-019 |
| INV-R4 | An export references a non-voided confirmation of the same report version | DB (composite FK) + TX (not voided) | FR-019, FR-020 |
| INV-R5 | Invalidated reports hold no content and no stored file | DB (CHECK) + BG (object deletion) | FR-025 |
| INV-V1 | `MATCH` / `MISMATCH` require a computed hash; `COULD_NOT_COMPLETE` requires none | DB (CHECK) | IN-6 |
| INV-A1 | Audit metadata contains only whitelisted keys, so never raw evidence | APP (+ optional DB trigger) | FR-023, OD-11 |
| INV-A2 | The audit entry is written in the same transaction as the audited action | TX | PRD FR-023 |
| INV-A3 | Audit rows are never updated or deleted | DB (grants + trigger) | FR-023 |
| INV-D1 | Deleted evidence is not reachable through any case view, link or report download | TX (cascade + report invalidation) + BG (object deletion after commit) | FR-025 AC-025.1 |
| INV-D2 | In-flight jobs check that the case/evidence still exists before every write and stop cleanly | BG | OD-11 |
| INV-F1 | Fallback results are used only for evidence whose SHA-256 is in the committed synthetic manifest, and use is recorded (`agent_steps.fallback_used`, audit `FALLBACK_USED`) | BG + APP | FR-027, AD-06 |
| INV-Q1 | Only one QUEUED/RUNNING analysis run per case | DB (partial UQ) | FR-006 |
| INV-O1 | No blockchain field is required for any MVP write path | Schema shape (nullable) | OD-06 |

---

## 23. State Machines

### 23.1 Case (`cases.status`): exact terms from spec §6.4, PRD §6.3, AD-05, R-1

| From | To | Trigger |
|---|---|---|
| NEW | INGESTING | First evidence item registered |
| INGESTING | EXTRACTED | All items `PROCESSED` in a run (INV-E9) |
| EXTRACTED | ANALYZING | Scam-analysis step starts |
| ANALYZING | CORRELATED | Analysis and correlation done |
| CORRELATED | TIMELINE_READY | Timeline step done |
| TIMELINE_READY | ACTIONS_READY | Missing-info + actions + urgency done. The analysis run ends here. |
| ACTIONS_READY | REPORT_DRAFT | User triggers report generation |
| REPORT_DRAFT | USER_REVIEW | Report version reaches `GENERATED` (R-1). On failure the case **stays** `REPORT_DRAFT` with Retry. |
| USER_REVIEW | USER_REVIEW | User confirms the version. **Status unchanged**; a confirmation row is inserted (R-1). |
| USER_REVIEW | EXPORTED | First export becomes `READY` (requires confirmation) |
| any ≥ INGESTING | INGESTING | New evidence (S-4) |
| any ≥ EXTRACTED | EXTRACTED | Extraction/entity correction (S-4) |
| any ≥ TIMELINE_READY | TIMELINE_READY | Timeline correction, addition or dismissal; answer that changes a time (S-4) |
| any ≥ ACTIONS_READY | ACTIONS_READY | Follow-up answer (S-4) |
| USER_REVIEW / EXPORTED | REPORT_DRAFT | Report regenerated (S-4) |
| any | INGESTING / NEW | Evidence deleted (NEW if none remain) |

Every backward transition voids active review confirmations. There is **no `FAILED` case state** (S-2). Failures live on `analysis_runs` / `agent_steps` / `evidence_items`.

### 23.2 Evidence (`evidence_items.processing_status`, PRD S-3)

| From | To | Trigger |
|---|---|---|
| (none) | UPLOADING | Step 1 (signed URL issued); paste goes straight to UPLOADED within one transaction |
| UPLOADING | UPLOADED | Confirmation passes: type, limits, fingerprint |
| UPLOADING | *(row deleted)* | Rejected, or abandoned beyond the URL lifetime |
| UPLOADED | PROCESSING | Included in an analysis run |
| PROCESSING | PROCESSED | Parse + extraction succeeded |
| PROCESSING | FAILED | Any `evidence_failure_code` |
| FAILED (retryable) | PROCESSING | User Retry |
| FAILED (non-retryable, e.g. `PDF_NO_TEXT_LAYER`) | *(row deleted)* | User Remove only |
| any (≠ UPLOADING) | *(row deleted)* | User deletes evidence (FR-025) |

### 23.3 Report version (`reports.status`) [SCHEMA-REC states mapping FR-017 / FR-025]

| From | To | Trigger |
|---|---|---|
| (none) | GENERATING | User requests generation. Case → REPORT_DRAFT. |
| GENERATING | GENERATED | Snapshot + PDF stored with checksums. Case → USER_REVIEW. |
| GENERATING | FAILED | Generation error. Case stays REPORT_DRAFT. |
| GENERATED | INVALIDATED | Evidence deleted (content and files removed; confirmations voided) |

A GENERATED version superseded by a newer one keeps its status. "Current" is derived (§17.2).

### 23.4 Review confirmation

`ACTIVE` (`voided_at IS NULL`) → `VOIDED` (`voided_at`, `void_reason`). There is no other transition. Re-confirming creates a new row.

### 23.5 Integrity verification

Each verification is an **immutable row** with result `MATCH`, `MISMATCH` or `COULD_NOT_COMPLETE`. There is no row-level state machine. Per-evidence status is derived: `NOT_YET_VERIFIED` (no rows) → latest result.

### 23.6 Supporting machines

- **Analysis run** (AD-05): `QUEUED → RUNNING → SUCCEEDED | FAILED`. Retry creates a new run that resumes at the failed step, skipping SUCCEEDED steps by idempotency key.
- **Agent step:** `PENDING → RUNNING → SUCCEEDED | FAILED`, or `PENDING → SKIPPED`.
- **Follow-up question:** `NONE`; `OPEN → ANSWERED | SKIPPED`.
- **Action:** `TODO ⇄ DONE ⇄ NOT_APPLICABLE` (user only).
- **Export:** `GENERATING → READY | FAILED`.

---

## 24. Cascade / Deletion Rules

### 24.1 User deletes a case (FR-025, OD-11)

All in one transaction (the case row is locked first):

| Data | Outcome |
|---|---|
| `cases` row and **every case-owned table** (via `ON DELETE CASCADE` on `case_id` / parent FKs) | **Deleted (hard)** |
| Object storage: evidence originals, report PDFs, export files | **Deleted after commit**, with retry. Failures are logged as orphan keys (by key only) for reconciliation. |
| `audit_logs` rows for the case | **Retained** (no FK, content-free) plus a `CASE_DELETED` tombstone |
| In-flight jobs | Detect the missing case and stop (INV-D2) |
| On-chain records (only if OD-06 is ever built) | Cannot be deleted. They contain no PII. |

### 24.2 User removes an evidence item (FR-025, OD-11)

All in one transaction, under the case lock:

| Step | Data | Outcome |
|---|---|---|
| 1 | `evidence_items` row | **Deleted** |
| 2 | `parse_results`, `source_pages`, `source_lines`, `sensitive_detections`, `extractions`, `extraction_source_lines`, `integrity_verifications`, `export_evidence_items` | **Deleted** by cascade |
| 3 | `fact_sources` rows targeting that evidence, its extractions or its lines | **Deleted** by cascade |
| 4 | Entities with no remaining extraction or user-statement support | **Deleted** (orphan sweep, INV-N1). Their relationships cascade. |
| 5 | Relationships and **AI-generated** timeline events left with no sources ("only source", PRD FR-025) | **Deleted**. User-added events stay, because they are sourced by user statements. |
| 6 | Case-level syntheses citing the evidence: `scam_signals`, `action_items`, `missing_information_items` | **[SCHEMA-REC — not a source requirement]** **Deleted.** Regenerated at the next analysis run. `user_statements` remain and re-link through `finding_key`. Rationale: these syntheses may embed facts from the deleted item. FR-025 permits "removed or recomputed", but **no source prescribes this exact behaviour** (see §24.6). |
| 6a | Current `urgency_assessments` | Per §14.4: kept as the out-of-date value (G-2) unless a reason depended only on the deleted evidence, in which case it is replaced by an immediate rule-engine recomputation (FR-025) **[SCHEMA-REC mechanism]** |
| 7 | All `reports` of the case | **Invalidated**: `status = INVALIDATED`, content and file keys cleared; rows retained without content |
| 8 | All active `review_confirmations` | **Voided** (`EVIDENCE_DELETED`) |
| 9 | All `exports` of the case | **Deleted** (rows and files). The audit log keeps the history. |
| 10 | `cases.status` | → `INGESTING`, or `NEW` if no evidence remains |
| 11 | Audit | `EVIDENCE_DELETED` tombstone (evidence ID + ref + SHA-256 only), plus `REPORT_INVALIDATED` |
| After commit | Object(s) | Original object and invalidated report/export files deleted |

### 24.3 A report is regenerated

A new `reports` row is created (version N+1). Earlier GENERATED versions are **retained** (viewable). Active confirmations on earlier versions are **voided** (`REPORT_REGENERATED`). Earlier exports are **retained**. Case → `REPORT_DRAFT` → `USER_REVIEW`.

### 24.4 An entity becomes orphaned

When an entity has no supporting extraction and no user-statement `fact_sources`, it is **deleted**. `relationships`, `timeline_event_entities` and `fact_sources` owned by it cascade. `extractions.entity_id` is set to null (only possible for extractions that are themselves being deleted or un-merged).

### 24.5 An extraction is invalidated

Extractions are never edited in place (only correction columns). An extraction is **removed** only when its evidence is deleted or its parse is replaced on a retry of a failed item. Removal cascades to `extraction_source_lines` and `fact_sources` that cite it. Owners left without sources are deleted (INV-P1 sweep). Entities left without support are deleted (§24.4). A user **correction** is not an invalidation: the extraction remains and shows "User-corrected".

### 24.6 Evidence deletion and re-analysis: what is required vs. recommended

**Required by the sources** (cite these, not this document):

| Behaviour | Source |
|---|---|
| Stored object and its extractions removed | FR-025; PRD FR-025 |
| Entities left without support removed | PRD FR-025 |
| Relationships citing it removed (when they have no other support) | PRD FR-025; OD-11 |
| Timeline events whose only source it was removed | PRD FR-025; OD-11 |
| All report versions invalidated; stored documents and exports deleted; confirmations voided | PRD FR-025; OD-11 |
| Case returns to `INGESTING` (or `NEW`) | PRD S-4; AD-05 |
| Minimal audit record kept | FR-025; FR-023; OD-11 |
| Last urgency value stays visible, marked out of date, until `ACTIONS_READY` | G-2 (`DECISIONS.md` §7.3) |

**[SCHEMA-REC / implementation recommendation, not required by any source]:**
- Scam signals, action items and missing-information items are **deleted** on evidence deletion and **rebuilt by the next analysis**. They are not pruned source by source.
- Consequence: an action the user had marked `DONE` / `NOT_APPLICABLE` is re-created as `TODO` if it is recommended again. The earlier status change remains in the audit log.
- The urgency replacement mechanism of §14.4 step 3.
- Alternative, if the team prefers to preserve completion marks: keep `action_items` rows, prune only their `fact_sources`, and delete an action only when it has no sources left. The next run then upserts by `action_code` and preserves `status`. This is a schema-level choice and changes no product requirement.

**Three distinct layers of state:**

| Layer | Tables | Behaviour on evidence deletion |
|---|---|---|
| **Immutable audit history** | `audit_logs` | Never changes. Already records every upload, analysis, status change (incl. `ACTION_STATUS_CHANGED`), report, confirmation, export and the deletion tombstone. It holds no content, so keeping it leaks nothing (OD-11). |
| **Current derived analysis state** | `extractions`, `entities`, `relationships`, `timeline_events`, `scam_signals`, `missing_information_items`, `action_items` (system-written columns), `urgency_assessments`, `reports` | Reflects only the evidence that currently exists. Removed or recomputed as above (FR-025). |
| **User-provided / user-completed state** | `user_statements` (answers, corrections, added events, metadata), `review_confirmations`, `action_items.status` / `status_changed_by` / `status_changed_at`, `timeline_events.dismissed_at` | `user_statements` are **kept** (they are not evidence and are not deleted with evidence). Review confirmations are **voided**, as required. Action completion marks follow the [SCHEMA-REC] above. |

### 24.7 Summary of retention classes

| Class | Records |
|---|---|
| Deleted | Everything case-owned on case deletion; evidence-dependent data on evidence deletion; exports on evidence deletion |
| Soft-deleted | **None** (OD-11) |
| Retained for audit | `audit_logs` (content-free) |
| Retained without content | Invalidated `reports` rows; voided `review_confirmations`; dismissed `timeline_events` (still case data, hidden from the active timeline) |
| Detached | `extractions.entity_id → NULL`; `*.agent_step_id → NULL` where a step row is gone (only on case deletion, which removes everything anyway) |

---

## 25. Demo Dataset Mapping (`DECISIONS.md` §7.2)

The schema contains **no demo values**. The demo only produces rows.

| Demo element | How the database represents it |
|---|---|
| Six artifacts | `evidence_items` E01 (PNG), E02 (PNG), E03 (PNG), E04 (PDF, `page_count = 1`), E05 (PNG), E06 (TEXT, `paste_kind = MESSAGE`, label "My note about the call"). Filenames as in §7.2.2 on the file items. |
| Evidence hashes | `evidence_items.sha256` must equal the committed manifest (S-H2). E06's hash is over the canonical pasted bytes (`source_metadata.canonicalization`). |
| E04 PDF path | `parse_results.parser_kind = PDF_TEXT_LAYER`; one `source_pages` row with `has_usable_text_layer = true`; no OCR |
| Phone correlation E01/E02/E06 | One PHONE entity `+919000000001`. Three extractions with raw `+91 90000 00001`, `+91 90000 00001`, `9000000001`. `entity_evidence_links` yields three rows. |
| URL correlation E01/E02/E03 | One URL entity `https://kyc-update-verify.example/kyc` (E01 raw includes `?utm_source=sms`). One DOMAIN entity. Relationship `HOSTED_ON` with sources from E01/E02/E03. |
| UPI correlation E02/E04/E05 | One UPI_ID entity `kyc.refund.desk@demoupi` with three extractions. `REQUESTED_PAYMENT_TO` (PHONE → UPI_ID, source E02). `PAID_TO` (TRANSACTION → UPI_ID, sources E04, E05). |
| Transaction correlation E04/E05 | One TRANSACTION entity `627000418532`. Two extractions (`source_label` "UPI Ref No" / "Ref no"). `AMOUNT_OF`, `DEBITED_FROM` (ACCOUNT_HINT `…4821`), each with E04 + E05 sources. |
| Demo path phone → URL → UPI → transaction | `SENT_LINK` (PHONE → URL, E02) + `REQUESTED_PAYMENT_TO` + `PAID_TO`. R7: `MESSAGE_CONTAINED` from `VX-KYCUPD` to PHONE and URL (E01). |
| Overview counts `PHONE 1 \| URL 1 \| UPI 1 \| UTR 1` | `case_overview` counts entities by type |
| Missing bank name | No BANK_OR_WALLET entity. Finding `MISSING_FIELD:BANK_WALLET_MERCHANT` OPEN with a question. The answer becomes a `user_statements` row, then a user-stated BANK_OR_WALLET entity, then the finding is RESOLVED (§13.2). The payee "KYC Refund Desk" is a PERSON entity (`attributes.context = payee_display_name`), so it never fills this field. |
| Identity document | Finding `MISSING_FIELD:IDENTITY_DOCUMENT`, `INFORMATIONAL`, no question |
| Contradiction (payment time) | Finding `CONTRADICTION` with `subject_timeline_event_id` = T8 and two `fact_sources`: the E04 DATETIME extraction (12:19, EXACT) and the E06 DATETIME extraction ("around 12:40 PM", APPROXIMATE) |
| Correction (call time) | T2 `CALL`: `event_at` ≈ 12:05, `APPROXIMATE`, `time_source_text` "Around 12:05 PM", source E06. The user corrects it: `user_statements` (CORRECTION) is written, `original_event_at` = 12:05, `event_at` = 12:07, `correction_status = USER_CORRECTED`, and the case moves to `TIMELINE_READY`. |
| E03 date inferred | T5 `CREDENTIAL_OTP_REQUEST`, `event_at` 2026-09-24 12:16 IST, `APPROXIMATE`, `time_source_text` "12:16" |
| OTP hidden | E02 line text is stored with the OTP masked. One `sensitive_detections` row (kind OTP, span, no value). There is no extraction of the OTP. T6 `CREDENTIALS_OR_OTP_SHARED` describes it without the value. The OTP is absent from reports and exports (AC-AD03.8). |
| Scam signals | `scam_signals`: KYC_IMPERSONATION (primary), PHISHING, UPI_FRAUD, each with `fact_sources`. `cases.incident_type = KYC_IMPERSONATION`. |
| Urgency | `urgency_assessments` level HIGH, U1 = true, U2 = true, `rule_version = G2-v1`. Reasons: debit (sources E04, E05); U2 (sources E03 event, E02 OTP detection line). |
| Actions | `action_items` CONTACT_BANK, REPORT_1930_NCRP, PRESERVE_EVIDENCE (+ REPORT_SUSPECT_NCRP), with channel codes |
| Provenance | Every fact above → `fact_sources` → extraction → `extraction_source_lines` → `source_lines` (page/line/bbox) → `evidence_items` |
| Report and review | `reports` v1 GENERATED (content + PDF checksums). Case `USER_REVIEW`. `review_confirmations` row on v1. Case stays `USER_REVIEW`. Export → `EXPORTED`. |
| Integrity verification | `integrity_verifications` MATCH for each untouched item. Tamper fixture (QA only): MISMATCH. Storage outage: COULD_NOT_COMPLETE. |
| Fallback | `agent_steps.fallback_used = true` only when an item's SHA-256 is in the manifest. Audit `FALLBACK_USED`. |

---

## 26. Traceability Matrix

| Table / key field | Master Spec | PRD | Decisions |
|---|---|---|---|
| users | §17 User; FR-026 | §19 AU-1–AU-3 | OD-04 |
| otp_challenges, sessions | §17 (TO BE DEFINED list); FR-026; §16.1 | FR-026; AU-2, AU-3 | OD-04 |
| cases.user_id, isolation FKs | FR-001; NFR-01; NFR-08 | FR-001; AU-4–AU-6; SP-2/SP-3 | OD-01 |
| cases.status | §6.4 | §6.3 S-1–S-6; §13.8 | AD-05, R-1 |
| cases.case_reference | FR-001; §21.1 | FR-001 | §11 (delegated) |
| cases.incident_type, financial_loss_reported, checklist_variant | §17; FR-010; FR-014 | SA-6; §14.1 | AD-01 |
| evidence_items (types, limits, sha256, status, failure) | FR-002–FR-005; §16.3 | FR-002–FR-005; §8; S-3; §21 | G-4, OD-03, OD-14, OD-05 |
| evidence_items.attestation_ref | FR-022; §17 † | FR-022 | OD-06 (deferred) |
| parse_results, source_pages, source_lines | FR-007; §12.2 | FR-007; §8.3; §9 | OD-03, AD-02, G-4 |
| sensitive_detections | GR-09; FR-009 | FR-009; SP-9 | AD-03 §7.2 (OTP), G-2 U2(a) |
| extractions, extraction_source_lines | FR-008; FR-009; GR-01–GR-05; §12.2 | FR-008; §10.1–§10.3; EX-1–EX-5 | AD-02, OD-02, OD-03 |
| user_statements | FR-013; FR-015; §12.2 | FR-001, FR-013, FR-015; §10.3 | AD-02 |
| entities | §12.3; FR-009; §13.2 | FR-009; §10.1 | AD-02 |
| relationships, fact_sources, entity_evidence_links | §13.3–§13.5; FR-011; GR-06 | FR-011; CR-1–CR-5 | AD-02, G-6 |
| timeline_events, timeline_event_entities | §14; FR-012; FR-013 | FR-012/013; TL-1–TL-8 | AD-02, AD-05, G-5, G-6 |
| missing_information_items | FR-014; FR-015; §3.4 | §14 MI-1–MI-7; FR-014/015 | AD-01, OD-09 |
| urgency_assessments, urgency_reasons | §21.1 | AC-R3 | **G-2 (`DECISIONS.md` §7.3)** |
| analysis_runs, agent_steps | FR-006; FR-024; FR-027; §10.2 | FR-006; FR-024; FR-027 | OD-12, OD-15, AD-05, AD-06 |
| scam_signals | FR-010; §11 GR-12/GR-15 | §11 SA-1–SA-7 | AD-01 |
| action_items | FR-016; GR-14 | §15 AC-R1–AC-R7 | AD-01 |
| reports | FR-017; FR-018; §17 Report | FR-017/018; §16 RP-1–RP-7 | AD-04, OD-07 |
| review_confirmations | FR-019 | FR-019; §13.8; §18 RV-5 | R-1, AD-05 |
| exports, export_evidence_items | FR-020 | FR-020; §18.2 EXP-1–EXP-3 | OD-07 |
| integrity_verifications | FR-021; §15 | FR-021; §17 IN-1–IN-8 | OD-06 |
| audit_logs | FR-023; NFR-03; §16.2 | FR-023; SP-5 | OD-11 |
| Deletion cascades | FR-025; NFR-09 | FR-025; SP-7 | OD-11 |
| Demo mapping | §22 | §22 | AD-03 (`DECISIONS.md` §7.2) |

---

## 27. Open / Deferred Items (database-relevant only)

| Item | Status | Database impact | MVP dependency? |
|---|---|---|---|
| **Blockchain attestation** (OD-06) | Deferred. Default: not built. | Nullable `evidence_items.attestation_ref` and `integrity_verifications.attestation_result`. If built: an `attest-evidence` job and audit actions. **No new table required.** | **No** |
| **Speech-to-text** (OD-08) | Deferred. Default: excluded. | None. If built, a new evidence type (user statement transcript) would need an enum value and a migration. | **No** |
| **ID uploads** (OD-09) | Deferred. Default: not accepted. | None. The identity-document finding is `INFORMATIONAL` only. | **No** |
| **Progress delivery** (OD-10) | Deferred. Default: polling. | None. The feed reads `analysis_runs` / `agent_steps` either way. | **No** |
| **Postgres hosting** (OD-13) | Deferred | Any PostgreSQL 15+ (this document relies on `UNIQUE NULLS NOT DISTINCT`, `gen_random_uuid()` and generated columns). Use a direct, non-transaction-pooled connection for the queue (OD-15). DB at-rest encryption depends on the host and is not claimed. | **No** |

Items delegated to other documents (no product decision needed):
- confidence band thresholds (06);
- action priority meaning and curated action/channel lists (06);
- normalisation and masking rules (07);
- canonical bytes for pasted text, G-3 (07);
- OTP/card detector rules (06/07);
- time-contradiction tolerance (08);
- report `content` JSON schema (06, per AD-04).

**Intentionally limited field (not a decision, not a blocker):** FR-001 "user contact" is stored in `cases.contact_text` as user-provided metadata, with no downstream use or inference, because no source defines further behaviour (§5.5).

---

## 28. Implementation Notes (Prisma / PostgreSQL)

### 28.1 Mandatory product behaviour (must survive any implementation)

- Hard delete. Same-transaction audit. Content-free audit. Append-only audit.
- Literal validation before any extraction is stored. LLM never the OCR source.
- G-4 limits enforced server-side at upload confirmation.
- OD-03 whole-PDF failure, non-retryable, no derived data.
- R-1: confirmation is a separate, version- and checksum-bound record. `USER_REVIEW` is unchanged by it.
- Deterministic urgency with rule version and traceable reasons. No AI.
- Case isolation on every query. One active analysis run per case.

### 28.2 Schema recommendations

- **Composite case-scoped FKs** (`(x_id, case_id)` → `(id, case_id)`). Prisma supports compound relations. The parents need `@@unique([id, caseId])`.
- **`fact_sources` exclusive arc**, with `num_nonnulls` CHECKs and `UNIQUE NULLS NOT DISTINCT`. The CHECK and the NULLS NOT DISTINCT clause go in raw SQL.
- **Idempotent upserts by natural key:** `timeline_events.event_key`, `missing_information_items.finding_key`, `action_items.action_code`, `entities (case, type, canonical)`, `relationships (case, from, type, to)`, `agent_steps` idempotency index.
- Redact OTP/card spans **before** writing `source_lines.text`.
- Derived views: `entity_evidence_links`, `case_overview`.

### 28.3 Implementation details

- **Prisma limitations:** Prisma cannot declare CHECK constraints, partial unique indexes, generated columns, triggers or views. Add them in hand-written SQL inside Prisma migrations and document each one next to the model. Views can be mapped as read-only Prisma `view` models or queried with raw SQL.
- **Postgres enums** map to Prisma enums. Adding values is a migration.
- **Case-row locking** (`SELECT … FOR UPDATE`) for slot allocation, transitions, confirmation, export and deletion. Use Prisma interactive transactions or raw SQL.
- **Immutability triggers** for `evidence_items.sha256` / `uploaded_at`, `original_*` timeline columns, and `audit_logs` (no UPDATE/DELETE).
- **Queue tables** (pg-boss, OD-15) live in their own schema and are excluded from Prisma migrations.
- **Cleanup jobs:** expired OTP challenges and sessions; abandoned `UPLOADING` evidence; orphan-object reconciliation by `storage_key`.
- **Seeds:** none for production. The synthetic dataset is uploaded through the product, not seeded. That way its fingerprints are computed by the real path (S-H2).

---

## 29. Consistency Audit

### 29.1 Against the Master Spec

| Check | Result |
|---|---|
| All §17 entities represented (User, Case, Evidence, Extraction, Entity, Relationship, TimelineEvent, ActionItem, Report, AuditLog) | ✅ §3.1 |
| All §17 "TO BE DEFINED" structures (missing-info/questions, job/step records, auth sessions/OTP) | ✅ §13, §15/§23.6, §4.3–4.4 |
| PostgreSQL relationships, no graph DB (§13.5, §19) | ✅ |
| No extra infrastructure (§19, principle 12) | ✅ No Redis, vector store or graph DB |
| On-chain only hash/timestamp/opaque ID; optional (§15) | ✅ Nullable, unused |
| `Relationship.evidence_id` → one-to-many evidence-derived `fact_sources` | ✅ Same product concept ("the evidence supporting the relationship"), implemented without duplicate edges (§11.3). Not a behaviour change. No spec change required. |
| `Case.summary` | ✅ Kept under its source name `cases.summary` = the user's own description (FR-001). The AI incident summary is separate, in `reports.content`, and never overwrites it (§5.4). |
| FR-001 "user contact" | ✅ `cases.contact_text`, an intentionally limited field with no inferred behaviour (§5.5) |
| `User.email/phone` → email only | Per OD-04 (follow-up M-5 in `DECISIONS.md` §10.2) |

### 29.2 Against the PRD

| Check | Result |
|---|---|
| All 28 FRs needing persistence have schema support | ✅ FR-001–FR-027 (§26). FR-028 is optional/excluded and needs no schema now. |
| NFR-03/04/08/09/11 persistence | ✅ Audit, `fact_sources`, composite FKs, hard delete, literal validation |
| S-1–S-6, §13.8 `USER_REVIEW` | ✅ §23.1, §17.3 |
| §10.3 validation status | ✅ Derived (§9.2) |
| **Where the PRD and `DECISIONS.md` differ, `DECISIONS.md` was followed:** FR-007 "retry or remove" → no retry for `PDF_NO_TEXT_LAYER`; PRD §12 lists the UPI ID in E04 only → schema supports E02/E04/E05; PRD G-4/OD-03 "open" markers → resolved values used | ✅ Matches `DECISIONS.md` §10.1 follow-ups P-4, P-7, P-2 |

### 29.3 Against `DECISIONS.md`

| Check | Result |
|---|---|
| OD-01, OD-04, OD-05, OD-07, OD-11, OD-12, OD-14, OD-15 | ✅ Represented |
| OD-03 (§7.1): every page ≥ 10 non-whitespace characters, whole-item failure, no extraction, no retry, page list | ✅ §7 |
| AD-01 taxonomy and semantics; AD-02 provenance/confidence; AD-04 report snapshot; AD-05 + R-1 states; AD-06 fallback keyed by SHA-256 | ✅ |
| AD-03 dataset representable without hard-coding | ✅ §25 |
| G-2 levels, signals, tie-breaking, missing data, rule version, template, disclaimer | ✅ §14 |
| G-4 limits and `.eml` behaviour with explicit enforcement layers | ✅ §6.2, §8 |
| Delegated items settled here: G-5 (UTC storage / IST display / original text / precision), G-6 vocabularies, case reference format, urgency caching | ✅ §2, §11.4, §12.3, §5.1, §14 |
| Deferred items remain non-dependencies | ✅ §27 |

### 29.4 Schema recommendations with user-visible effects

None of these contradicts a source requirement.

1. **Evidence slot reuse.** The lowest free slot is reused after a deletion (`E03` may be reassigned). This keeps the 20-item cap DB-enforced. Reports are invalidated on deletion anyway, and the audit log uses UUIDs.
2. **[SCHEMA-REC] On evidence deletion, scam signals, actions and missing-info items are deleted and rebuilt by the next analysis**, rather than pruned. Action "done" marks for re-created actions reset; the audit log keeps the history. FR-025 permits this ("removed or recomputed") but does **not** require this exact behaviour. A mark-preserving alternative is documented in §24.6. Urgency follows G-2 and FR-025 together (§14.4).
3. **TXT UTF-8 validity is checked at upload confirmation** (rejection), treated as type-by-content validation (G-4 lists TXT UTF-8 among the limits).
4. **Source lines are stored with OTP/card spans already redacted** (data minimisation for GR-09).

### 29.5 Final consistency audit (v1.1)

| Check | Result |
|---|---|
| No requirement or decision IDs changed | ✅ FR, NFR, GR, OD, AD, G, R and PRD rule IDs used as in the sources |
| No source terminology unnecessarily changed | ✅ The case-description column now carries its source name `summary` (was `description` in v1.0). States, entity types, taxonomy, statuses and precision values unchanged. |
| No resolved decision reopened | ✅ |
| No deferred feature became an MVP dependency | ✅ OD-06/08/09/10/13 remain optional or nullable (§27) |
| No new product behaviour invented | ✅ All additions are labelled [SCHEMA-REC]/[IMPL]. The "user contact" field gains no behaviour (§5.5). |
| All 10 source entities represented | ✅ §3.1, §3.4 |
| Provenance first-class | ✅ `extraction_source_lines`, `fact_sources`, INV-P1–P4 |
| Case isolation enforceable | ✅ Composite case FKs + ownership guard (§20) |
| Deterministic urgency | ✅ Rule-engine only, rule version, DB CHECK (§14). **Correction made in this pass:** v1.0 recomputed urgency immediately on every evidence deletion, which conflicted with G-2's "last computed value stays visible … may be out of date". §14.4 now follows G-2 and applies FR-025 only to reasons that depended solely on the deleted evidence. |
| LLM output cannot become trusted evidence without validation | ✅ §9.1, §9.7, INV-X1–X4 |
| Scanned-PDF behaviour (OD-03) | ✅ §7 |
| `.eml` behaviour (G-4) | ✅ §8 |
| Report version / user review (R-1) | ✅ §17.3, §23.1 |
| Integrity verification | ✅ §18 (COULD_NOT_COMPLETE ≠ MISMATCH; no blockchain dependency) |
| Audit logs contain no raw evidence | ✅ §19.2 |
| Demo dataset representable | ✅ §25 |

**Unresolved schema/product contradictions: none.** The source tension found in this pass (G-2 "keep last urgency visible" vs. FR-025 "remove data depending only on deleted evidence") is resolved by applying both rules as written (§14.4). It is not a new interpretation of either.

---

## Schema Readiness Checklist

| # | Check | Status |
|---|---|---|
| 1 | Every source-defined core entity is represented | ✅ |
| 2 | Every PRD requirement needing persistence has schema support | ✅ |
| 3 | Every resolved decision affecting persistence is represented | ✅ |
| 4 | No deferred feature is required for the MVP (OD-06, OD-08, OD-09, OD-10, OD-13) | ✅ |
| 5 | All six demo artifacts can be represented | ✅ §25 |
| 6 | Demo correlations (phone, URL, UPI, transaction) can be represented without duplicate edges | ✅ §11 |
| 7 | Missing information (bank name + answer) can be represented | ✅ §13 |
| 8 | Contradiction (12:19 vs ~12:40) and correction (~12:05 → 12:07) can be represented | ✅ §12 |
| 9 | Deterministic urgency with rule version and traceable reasons | ✅ §14 |
| 10 | Report versioning and version-specific review confirmation (R-1) | ✅ §17 |
| 11 | Integrity verification, including "could not complete" | ✅ §18 |
| 12 | Case isolation enforceable (composite FKs + ownership guard) | ✅ §20 |
| 13 | Audit logs cannot contain raw evidence (whitelist + same-transaction write + append-only) | ✅ §19 |
| 14 | Scanned-PDF failure represented exactly per OD-03 | ✅ §7 |
| 15 | `.eml` behaviour represented; `.msg`/mailbox rejected; attachments listed only | ✅ §8 |
| 16 | Every file limit has an explicit enforcement location | ✅ §6.2 |
| 17 | No unsupported product requirement introduced (all additions labelled [SCHEMA-REC] / [IMPL]) | ✅ §29.4 |
| 18 | All 30 tables have a documented source justification; none flagged | ✅ §3.4 |
| 19 | Relationship evidence reconciled with spec §13.3/§17 (one-to-many sources, no duplicate edges) | ✅ §11.3 |
| 20 | `Case.summary` (user) separate from the AI incident summary (report); user summary never AI-written | ✅ §5.4 |
| 21 | "User contact" stored as entered, with no inferred behaviour | ✅ §5.5 |
| 22 | Evidence-deletion behaviour split into source-required vs. [SCHEMA-REC]; urgency on deletion follows G-2 + FR-025 | ✅ §24.6, §14.4 |

**Verdict: READY FOR IMPLEMENTATION.** The v1.1 audit (§29.5) found no unresolved schema/product contradiction. No product-level decision is outstanding for the database. The remaining items are delegated implementation details (§27) and do not change the schema's shape. One optional team preference is documented but not required: whether to preserve action "done" marks across evidence deletion (§24.6 alternative).
