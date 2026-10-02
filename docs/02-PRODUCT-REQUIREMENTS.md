# Proofline — Product Requirements Document

> **Trace the Evidence. Build the Case.**

---

## 1. Document Control

| Field | Value |
|---|---|
| Product | **Proofline** |
| Document | Product Requirements Document (PRD) |
| File | `docs/02-PRODUCT-REQUIREMENTS.md` |
| Version | 1.0 |
| Status | Hackathon MVP. Baseline for implementation. |
| Last updated | 2026-10-02 |
| Source documents | `docs/01-PROOFLINE-MASTER-SPEC.md` v1.0 (authoritative), `docs/DECISIONS.md` v0.1 |

### 1.1 Purpose

This document answers one question: **"Exactly what must Proofline do?"** It turns the Master Spec into implementation-oriented product requirements. It is written for frontend, backend, AI/ML, QA and security developers, the hackathon team, and future Claude Code sessions.

It specifies **what** the product does, not **how**:

| Topic | Belongs in |
|---|---|
| Physical data model | `03-DATABASE-SCHEMA.md` |
| Modules, processes, providers, deployment | `04-TECHNICAL-ARCHITECTURE.md` |
| Endpoints, payloads, errors | `05-API-SPECIFICATION.md` |
| Prompts, agent contracts, validation logic | `06-AI-AGENT-SPECIFICATION.md` |
| Ingestion, OCR, parsing, normalisation rules | `07-EVIDENCE-PROCESSING-PIPELINE.md` |
| Graph and timeline vocabularies and algorithms | `08-EVIDENCE-GRAPH-TIMELINE.md` |
| Detailed security, privacy and integrity design | `09-SECURITY-PRIVACY-INTEGRITY.md` |
| Screens, interactions, copy | `10-FRONTEND-UX-SPECIFICATION.md`, `11-DESIGN-SYSTEM.md` |
| Demo script and synthetic artifacts | `12-DEMO-SCENARIO.md`, `13-SYNTHETIC-DATA-SPECIFICATION.md` |
| Plan and tests | `14-IMPLEMENTATION-ROADMAP.md`, `15-TESTING-STRATEGY.md` |
| Pitch | `16-HACKATHON-PITCH.md` |

### 1.2 Authority and precedence

1. The **Master Spec** is the source of truth for product scope, boundaries and requirements.
2. **`DECISIONS.md`**: every recommendation with status `PROPOSED` is **accepted for the purpose of this PRD** (team instruction, 2026-10-02). Items marked `NEEDS HUMAN DECISION` or `DEFERRED` stay unresolved, and this PRD references them by ID.
3. **Team resolutions made with this PRD (2026-10-02).** Neither is yet recorded in `DECISIONS.md` or the Master Spec, and both should be recorded there later:
   - **R-1, `USER_REVIEW` meaning** (resolves the open part of AD-05). `USER_REVIEW` means *the case is awaiting human review*. Approval is a separate **review confirmation** on a specific report version. See §6.3 and §13.8.
   - **R-2, document numbering** (resolves G-1 in `DECISIONS.md`). The sequence is `01` Master Spec, `02` PRD, `03` Database Schema, `04` Technical Architecture, `05` API Specification, `06`–`16` as listed in §1.1. Wherever `DECISIONS.md` mentions `03-TECHNICAL-ARCHITECTURE.md`, read it as `04-TECHNICAL-ARCHITECTURE.md`.
4. Decision IDs: `OD-xx` and `AD-xx` refer to `DECISIONS.md`. `G-x` refers to the "Other spec gaps" table in `DECISIONS.md` §6.

### 1.3 Requirement keywords and markers

- **MUST** = required for the MVP. **SHOULD** = expected unless a documented reason exists. **MAY** = optional.
- `Dependency: <ID>` means a requirement depends on a decision. The dependency's state is listed in §25.
- `IMPLEMENTATION DETAIL` means the product behaviour is fixed, but the exact value or mechanism is left to the named technical document.

---

## 2. Product Overview

**Proofline** is an AI-powered, agentic web platform for the period after a person suspects or confirms that they have been the victim of a cyber scam. It takes fragmented incident evidence and does the following:

- Fingerprints and stores the evidence securely.
- Extracts and normalises key entities, with provenance.
- Links those entities across evidence items.
- Reconstructs the incident timeline.
- Identifies missing or contradictory information.
- Produces an immediate-action checklist and a complaint-ready case draft for the user to review.

It works alongside India's official cyber-fraud reporting channels (NCRP, 1930). It does not replace them.

| Aspect | Definition |
|---|---|
| **Problem** | After a scam, evidence is split across SMS, chat apps, email, browsers and banking apps, in different formats and with inconsistent identifiers and timestamps. Reporting (NCRP checklist, Master Spec §3.4) needs structured information that a stressed victim must currently assemble by hand. |
| **Target users** | Primary: the **individual victim**, and someone helping them. Secondary personas use the same core workflow (§5). |
| **Core value** | A faster, more complete and more consistent picture of the incident, with every key fact traceable to evidence, which improves the quality and speed of the **victim's own next action**. |
| **Product boundary** | An evidence-intelligence and response **preparation** layer. Not a reporting portal, police portal, bank, legal adviser, money-recovery service, or generic chatbot (§4). |
| **MVP objective** | A user can take the synthetic KYC/UPI scenario end-to-end: create a case, upload six artifacts, have them processed, correlated and placed on a timeline, see gaps, get actions and a provenance-backed complaint draft, verify integrity, review and export (§22). |

**Product category:** AI-powered cyber-fraud evidence intelligence and response platform. It is a post-incident evidence-orchestration layer.

**Positioning rule:** never present Proofline as "a cybercrime reporting portal". The differentiator is the evidence-intelligence layer.

---

## 3. Product Goals

These are product goals for the MVP, measured on the fixed synthetic benchmark. They are engineering/demo targets, **not** claims of production accuracy, money recovery or faster police/bank action (Master Spec §3.6, §23).

| ID | Goal | Measure (MVP target) | Source |
|---|---|---|---|
| G1 | Convert fragmented evidence into a structured case | Six heterogeneous artifacts become one case with entities, graph, timeline, actions and draft | Spec §2.4, §26 |
| G2 | Preserve provenance | **100%** of key report facts trace to evidence and location, or to a user statement | Spec §23 |
| G3 | Extract key facts accurately | **> 95%** correct on simple structured fields (phone, URL, UPI ID, transaction ID/UTR, amount, transaction date/time, bank/wallet/merchant) | Spec §23 |
| G4 | Reconstruct a useful timeline | **> 90%** of known events correctly ordered | Spec §23 |
| G5 | Identify missing and contradictory information | Every planted gap shown as "Not provided"; every planted contradiction shown with both sources | Spec FR-014, AD-03 |
| G6 | Generate evidence-backed actions | Each action has a reason. The financial-fraud checklist includes: contact bank, report via 1930/NCRP, preserve evidence. | Spec FR-016 |
| G7 | Produce a complaint-ready draft quickly | Upload to usable draft **< 2 minutes** in the demo environment | Spec §23, NFR-06 |
| G8 | Provide evidence integrity verification | **100%** match for untouched evidence; a modified copy returns mismatch | Spec §23, FR-021 |
| G9 | Keep the human in control | No export without explicit confirmation of the current report version | Spec FR-019 |
| G10 | Minimise correction burden while keeping verification | Track how often the user edits key fields. No numeric target. | Spec §23 |

### 3.1 Product quality requirements (NFRs)

All 12 Master Spec NFRs apply. Their product-visible effect is listed here. Detailed design lives in the named documents.

| NFR | Product-visible requirement | Detailed in |
|---|---|---|
| NFR-01 Security | All traffic over TLS. Evidence encrypted at rest. Every case resource requires a signed-in user who owns the case. Evidence reachable only through short-lived authorised links or authorised streams. | 09, 04 |
| NFR-02 Privacy | Least-privilege access. Identity data kept separate from evidence where practical. No evidence or PII on-chain. OTPs and full card numbers masked. Synthetic data only in the hackathon. | 09 |
| NFR-03 Auditability | Uploads, views/downloads, exports, deletions, corrections, analysis runs and verifications are visible in the case audit log. Report versions are kept and checksummed. | FR-023 |
| NFR-04 Traceability | Any key fact (entity, timeline event, classification explanation, action, report field) can be clicked to reach its source evidence and location, or the user statement it came from. | §10, §16 |
| NFR-05 Reliability | Failed steps can be retried without redoing completed work. No duplicate processing. Blockchain never on the critical path. A disclosed deterministic fallback exists for the synthetic demo. | §21, FR-027 |
| NFR-06 Performance | Upload to usable draft **< 2 min** for the six-artifact synthetic case in the demo environment. Other latencies are `IMPLEMENTATION DETAIL`. | 04, 15 |
| NFR-07 Explainability | Signals, extracted facts and recommended actions are shown **separately**. Classification has an evidence-backed explanation. Confidence or uncertainty is visible on AI-derived values. | §11, §15 |
| NFR-08 Case isolation | Everything a user sees, and everything sent to an AI provider, belongs to exactly one case. Nothing from another case ever appears. | §19, §20 |
| NFR-09 Retention & deletion | Users can delete evidence and cases (FR-025). Data is kept until the user deletes it. No automatic expiry in MVP (OD-11). | FR-025 |
| NFR-10 Human review | The user is the final reviewer. Export requires explicit confirmation. AI outputs carry disclaimers and link to official channels. | §18 |
| NFR-11 Determinism of extraction | The same input reliably yields the same identifiers, because identifiers come from parsed source text and are validated against it. | §10 |
| NFR-12 Usability | The primary interface is a structured incident-response workspace, not a chat. English UI. Usable by a stressed, non-technical victim. | 10, 11 |

---

## 4. Non-Goals

The MVP **does not** do the following, and **must not** be built, worded or demonstrated as if it does (Master Spec §4.2, §24):

| # | Non-goal | Product consequence |
|---|---|---|
| N1 | Automatic submission to police, NCRP, 1930 or any authority | Proofline prepares material. The user submits it through official channels. |
| N2 | Automatic bank action (freeze, dispute, chargeback, reversal) | Actions tell the user to contact their bank. Proofline never acts on their behalf. |
| N3 | Money recovery, or any promise or implication of it | No copy, report text or pitch line implies recovery. |
| N4 | Legal decisions or legal advice | Output is labelled AI-assisted and not a legal or official determination. No finding that a person or organisation is fraudulent. |
| N5 | Storing evidence, PII or conversation content on any blockchain | At most, hash + timestamp + an opaque evidence reference, and only if OD-06 is built. |
| N6 | Real-world suspect identification from weak evidence | Identifiers are listed as "observed in evidence", never as "the fraudster is X". |
| N7 | Autonomous communication with authorities, banks or suspects | The product sends nothing to any third party on the user's behalf. |
| N8 | Automatic call recording | Never. An optional, user-initiated spoken summary is the most permitted (FR-028, excluded by default, OD-08). |
| N9 | Production or continuous threat-intelligence enrichment | No live fetching, crawling, resolving or reputation lookup of suspicious URLs. |
| N10 | Enterprise integrations | No bank/call-centre integrations, SSO, organisation tenancy or partner APIs. |
| N11 | Multilingual workflows | English UI only. |
| N12 | Custom ML model training | Not without later approval. |
| N13 | Email/mailbox connectors | Users upload email exports. Proofline never connects to a mailbox. |
| N14 | Cross-case campaign clustering | Each case is analysed in isolation. |
| N15 | Real victim data | Hackathon uses synthetic data only. |
| N16 | Payments, billing, subscriptions | None. |
| N17 | Shared/multi-user case access | Single-owner cases in MVP (OD-01). |
| N18 | Identity-document collection | Not requested or required. Default is not accepted (OD-09, deferred). |
| N19 | Looking like an official government service | No government branding, logos or styling that suggests official status. |

---

## 5. Personas

**MVP primary persona:** the individual victim, and someone helping them, shown with the synthetic demo scenario. Personas 3–5 use the **same core workflow**. No persona-specific features are built for them in the MVP. Organisation features (team seats, SSO, tenancy, multi-seat) are future scope.

| # | Persona | User goal | Pain point | Relevant Proofline capabilities | MVP relevance |
|---|---|---|---|---|---|
| 1 | **Individual victim** | Understand what happened and take the right next steps quickly | Evidence is scattered and next steps are unclear | Guided case creation, upload, automated extraction, timeline, action checklist, complaint draft | **Primary.** The demo is built around this persona. |
| 2 | **Family member helping a victim** | Collect information from several devices and chats into one place | Has to gather material from multiple sources | Case workspace, multi-file upload, missing-information checklist | **Supported without sharing** (OD-01). Helps on the victim's signed-in session/device, or creates a case under their own account. No cross-account sharing in MVP. |
| 3 | **College/campus support desk** | Turn incomplete student accounts into a standard summary | Incomplete incident accounts | Standard case structure, incident summary, missing-information detection | Same core workflow. No desk-specific features. |
| 4 | **Bank/fintech first-line support** | Get structured, consistent incident details | Customer descriptions are inconsistent or incomplete | Entity extraction with provenance, normalised entity table, contradiction checks | Same core workflow. No bank integrations (N10). |
| 5 | **Cyber-support service provider** | Reduce manual triage and document assembly | Manual work takes time | Audit log, evidence index, exportable case bundle | Same core workflow. Multi-seat/organisation features are future. |

---

## 6. End-to-End User Journey

### 6.1 Journey

```text
Create Case
↓
Upload Evidence
↓
Evidence Fingerprinting / Storage
↓
OCR / Parsing
↓
Entity Extraction
↓
Scam Analysis
↓
Cross-Evidence Correlation
↓
Timeline Reconstruction
↓
Missing / Contradictory Information
↓
Action Checklist
↓
Complaint Draft
↓
User Review
↓
Export
↓
Integrity Verification
```

Loops: **corrections** from review return to timeline/extraction stages. **Answers** to targeted questions update the case without a full re-analysis.

**Integrity verification is not a strict final step.** It can be run on demand on any evidence item at any time after its upload completes (FR-021). The source places it before review, and the Definition of Done verifies before export. Both are valid.

### 6.2 Stages: what the user does and sees

| # | Stage | User action | What the user sees | Who performs it | FRs |
|---|---|---|---|---|---|
| 1 | Create Case | Starts a case with minimal metadata | Case reference, status `NEW` | User | FR-001, FR-026 |
| 2 | Upload Evidence | Drags/drops files, or pastes text/URL | Items appear with labels and upload status | User | FR-002, FR-003 |
| 3 | Fingerprint / Store | None | SHA-256 fingerprint per item. Item stored encrypted. | System | FR-004, FR-005, (FR-022) |
| 4 | OCR / Parse | Presses "Analyse" (starts stages 4–10) | Activity feed shows steps. Per-item "processing → processed". "N/N processed" counter. | System | FR-006, FR-007, FR-024 |
| 5 | Entity Extraction | None | Entities with source snippet, confidence band, masked display | System | FR-008, FR-009 |
| 6 | Scam Analysis | None | Primary + secondary signals, calibrated explanation, citations | System | FR-010 |
| 7 | Cross-Evidence Correlation | Explores the graph | Phone → URL → UPI ID → transaction links across artifacts | System | FR-011 |
| 8 | Timeline Reconstruction | Corrects, adds or dismisses events | Ordered events with sources, confidence and precision markers | System + user | FR-012, FR-013 |
| 9 | Missing / Contradictory Info | Answers targeted questions | "Not provided" items, contradictions with both sources, questions | System + user | FR-014, FR-015 |
| 10 | Action Checklist | Marks actions done or not applicable | Prioritised actions with reasons and official channels | System + user | FR-016 |
| 11 | Complaint Draft | Presses "Generate draft" | Versioned structured draft with evidence index | System (user-triggered) | FR-017, FR-018 |
| 12 | User Review | Reviews, corrects, then **confirms** the current version | Status `USER_REVIEW` ("Awaiting your review"), then "Reviewed – version N" | User | FR-019, FR-013 |
| 13 | Export | Selects artifacts and exports | Download of PDF or ZIP bundle | User | FR-020 |
| 14 | Integrity Verification | Presses "Verify" on an item | Match / mismatch, recorded vs. current hash, what it proves | User (on demand) | FR-021, FR-022 |

Throughout: audit log (FR-023), deletion (FR-025), demo fallback disclosure (FR-027).

### 6.3 Case states (resolved product semantics)

The ten states come from the Master Spec (§6.4). Their meanings come from AD-05 (accepted) and R-1.

| State | Meaning for the user |
|---|---|
| `NEW` | Case exists. No evidence yet. |
| `INGESTING` | Evidence is being added, or added evidence has not yet all been processed. |
| `EXTRACTED` | All evidence is parsed and entities are extracted. |
| `ANALYZING` | Scam-pattern analysis is in progress. |
| `CORRELATED` | Entities are linked across evidence. The graph is available. |
| `TIMELINE_READY` | Timeline reconstructed. |
| `ACTIONS_READY` | Missing information and action checklist are available. The analysis run ends here. |
| `REPORT_DRAFT` | A report version is being generated. If generation fails, this state is shown with Retry. |
| `USER_REVIEW` | **A report version exists and is awaiting the user's review.** The case stays in this state after the user confirms. Confirmation is shown separately as "Reviewed – version N" (R-1). |
| `EXPORTED` | At least one export of a confirmed report version has been made. |

Rules:

- **S-1** Status shows the *furthest stage whose outputs are current*.
- **S-2** There is **no** `FAILED` case state. Failures are shown on the analysis run and on the failing step, with **Retry**, and the case keeps its last completed state (AD-05).
- **S-3** Per-evidence processing status: `uploading → uploaded → processing → processed | failed`.
- **S-4** **Re-entry.** A change returns the case to the earliest affected state, re-runs only the affected downstream steps, and **voids any review confirmation**:

| Change | Case returns to |
|---|---|
| New evidence added | `INGESTING` |
| Extraction/entity corrected | `EXTRACTED` (re-run from analysis onward) |
| Timeline event corrected, added or dismissed | `TIMELINE_READY` (re-run actions) |
| Follow-up answer given | `ACTIONS_READY`, or `TIMELINE_READY` if the answer changes a time. No full re-analysis. |
| Report regenerated | `REPORT_DRAFT`, then `USER_REVIEW` |
| Evidence deleted | `INGESTING`, or `NEW` if no evidence remains |
| Action marked done / not applicable | No state change |

- **S-5** Every state change is recorded in the audit log.
- **S-6** The same re-entry rules apply after `EXPORTED`. Earlier exports remain recorded in the audit log.

---

## 7. Functional Requirements

All 28 Master Spec FRs are carried forward with their IDs, names and priorities unchanged. **M** = Must, **O** = Optional. Acceptance criteria are numbered `AC-<FR>.<n>` for QA traceability.

---

### FR-001 — Case Creation · M

**Description:** An authenticated user creates an incident case with minimal metadata. The case is owned by the user who created it.

**Actor:** Signed-in user.

**Preconditions:** User is authenticated (FR-026).

**Inputs:** Incident time (exact, approximate or unknown), user contact, optional location, optional short free-text description. All are optional at creation.

**Expected Behavior:**
- A case can be created in one short step.
- The system assigns a unique ID and a human-readable case reference. The display format is `IMPLEMENTATION DETAIL`; the source mockup shows `CF-10283`.
- Status is set to `NEW`.
- Any value the user enters here is treated as **user-provided** (user statement), never as documentary evidence.
- Fields can be added or edited later.
- The landing/new-case screen briefly explains what Proofline is and is not, and links to official channels.

**Outputs:** Case record, case reference, status `NEW`, audit entry.

**Validation:** Owner is set from the session and cannot be supplied by the client. Free text is stored and displayed safely as untrusted input.

**Failure Behavior:** If creation fails, the user sees an error and no partial case exists. An unauthenticated attempt is sent to sign-in.

**Acceptance Criteria:**
- AC-001.1 A case can be created with no optional fields filled in.
- AC-001.2 The new case shows its reference and status `NEW`.
- AC-001.3 The case is visible only to its owner. Another signed-in user can neither list nor open it.
- AC-001.4 Creation writes an audit entry.
- AC-001.5 Metadata can be added after creation.

Dependency: OD-01 (accepted: single owner).

---

### FR-002 — Evidence File Upload · M

**Description:** The user uploads one or more evidence files to a case via drag-and-drop or file picker.

**Actor:** Case owner.

**Preconditions:** Case exists and is owned by the user.

**Inputs:** Files of type PNG, JPG, PDF, TXT, email export, or transaction receipt images/PDFs. Case ID. Optional user label (e.g., "bank SMS").

**Expected Behavior:**
- Multiple files can be selected at once. Each file becomes its own evidence item with an evidence reference (`E01`, `E02`, …).
- File bytes go to secure storage through short-lived authorised upload links (Master Spec FR-002 transport, OD-14 accepted). Mechanism is defined in 04/05.
- After the transfer, Proofline itself confirms the item: checks the file type **by content**, not just extension; checks size; computes the fingerprint (FR-004). Only then does the item become `uploaded`.
- Per-item status is visible throughout (S-3).
- Adding evidence to a case beyond `INGESTING` returns it to `INGESTING` and voids any review confirmation (S-4).
- Upload does **not** start analysis. The user starts analysis (FR-006).

**Outputs:** Per item: evidence record (type, original filename, size, content type, upload time, storage reference, processing status) and an audit entry.

**Validation:**
- Only the supported types in §8 are accepted.
- Declared type must match actual content.
- Size and count limits are `IMPLEMENTATION DETAIL`. Dependency: G-4.
- PDF support boundary: §8.3. Dependency: OD-03.

**Failure Behavior:**
- **Unsupported type:** rejected before or at confirmation, with a message naming the supported types. No evidence item remains.
- **Content does not match the declared type:** stored bytes are removed and the item is rejected with a message.
- **Transfer interrupted:** item shown as failed, with retry or remove. No fingerprint is shown.
- **Storage unavailable:** visible error. The item is not shown as uploaded.

**Acceptance Criteria:**
- AC-002.1 All five synthetic file artifacts (E01–E05) upload successfully and reach `uploaded` with a fingerprint.
- AC-002.2 An unsupported file type is rejected with a clear message and leaves no evidence item.
- AC-002.3 A non-image file renamed to `.png` is rejected.
- AC-002.4 Several files can be uploaded in one action, each with its own status.
- AC-002.5 Each successful upload writes an audit entry.
- AC-002.6 Uploading evidence after a report was confirmed voids that confirmation.

Dependency: OD-14 (accepted flow), OD-03 (scanned-PDF scope, **open**), G-4 (limits and email-export format, **open**), OD-09 (deferred; default: ID documents not accepted).

---

### FR-003 — Pasted Text / URL Input · M

**Description:** The user pastes a copied message, chat transcript or URL directly into the case.

**Actor:** Case owner.

**Preconditions:** Case exists and is owned by the user.

**Inputs:** Text content. Input kind: message, URL or chat transcript. Optional label.

**Expected Behavior:**
- Pasted content becomes a first-class evidence item of type `text` or `url`.
- It is fingerprinted over a fixed, documented canonical byte representation, so verification is reproducible (`IMPLEMENTATION DETAIL`, G-3).
- It is stored like file evidence, appears in the evidence list and evidence index, and can be a provenance source.
- A pasted URL is **never fetched, opened, crawled or resolved** by Proofline.

**Outputs:** Evidence record of type `text` or `url`, fingerprint, audit entry.

**Validation:** Content must be non-empty. If the URL kind is chosen and the content is not a recognisable URL, the user is told and can submit it as a message instead. Content is untrusted input and is always displayed safely.

**Failure Behavior:** Empty input is rejected with a message. A storage failure shows a visible error and creates no evidence item.

**Acceptance Criteria:**
- AC-003.1 The synthetic E06 note can be pasted and becomes an evidence item with a fingerprint.
- AC-003.2 Pasting identical text twice yields identical fingerprints.
- AC-003.3 Submitting a URL causes no network request to that URL.
- AC-003.4 Pasted evidence appears in the evidence list and evidence index.

Dependency: G-3 (canonical text bytes, `IMPLEMENTATION DETAIL`).

---

### FR-004 — Evidence Fingerprinting · M

**Description:** At ingestion, SHA-256 is computed over the **original bytes** of each evidence item, before any transformation.

**Actor:** System.

**Preconditions:** Evidence bytes have been received and stored (FR-002/FR-003).

**Inputs:** Original evidence bytes.

**Expected Behavior:**
- Proofline computes the fingerprint itself. A value supplied by the browser is never trusted.
- It is computed on exactly the bytes stored, before encryption or processing.
- It is recorded with the ingestion timestamp and **never changes**.
- It is shown in the UI for every item.

**Outputs:** SHA-256 on the evidence record, ingestion timestamp, audit entry.

**Validation:** The fingerprint must equal an independent SHA-256 of the original file. For pasted text, it is computed over the documented canonical bytes (G-3).

**Failure Behavior:** If the fingerprint cannot be computed, the item does not become `uploaded`. It is shown as failed, with retry or remove.

**Acceptance Criteria:**
- AC-004.1 Every uploaded item displays a SHA-256 fingerprint.
- AC-004.2 For each synthetic file, the displayed fingerprint equals a SHA-256 computed independently with a standard tool.
- AC-004.3 The fingerprint does not change after analysis, correction or report generation.

---

### FR-005 — Encrypted Evidence Storage · M

**Description:** Original evidence is stored encrypted in object storage, off-chain. Metadata is stored separately.

**Actor:** System.

**Preconditions:** Evidence upload has started.

**Inputs:** Original evidence bytes, case ID.

**Expected Behavior:**
- Evidence objects are private.
- They are encrypted at rest using the storage provider's managed encryption, and encrypted in transit with TLS (OD-05 accepted).
- They are reachable only through authorised, short-lived links issued after a case-ownership check, or through an authorised backend stream.
- Product copy says "encrypted at rest", **never** "end-to-end encrypted".

**Outputs:** Encrypted object at a storage reference.

**Validation:** Every link is issued only after the ownership check and expires quickly. The exact lifetime is `IMPLEMENTATION DETAIL`.

**Failure Behavior:** If storage is unavailable, the upload or preview fails visibly. Evidence is never served without authorisation.

**Acceptance Criteria:**
- AC-005.1 A stored object cannot be fetched without an authorised link.
- AC-005.2 An expired link no longer works.
- AC-005.3 A different user cannot obtain a link for another user's evidence.
- AC-005.4 Encryption at rest is confirmed enabled on the evidence store.

Dependency: OD-05 (accepted), OD-14 (accepted flow; vendor is `IMPLEMENTATION DETAIL`).

---

### FR-006 — Analysis Orchestration · M

**Description:** The user starts analysis. The Case Orchestrator runs the agent workflow asynchronously, moving through the case states.

**Actor:** Case owner starts it. The system executes it.

**Preconditions:** Case has at least one evidence item in `uploaded` or `processed` state.

**Inputs:** Case ID.

**Expected Behavior:**
- Starting analysis returns immediately. Work continues in the background and progress is visible (FR-024).
- The orchestrator first produces a **plan**: the ordered steps chosen from the evidence types present, e.g., no OCR for pasted text. The plan is shown in the activity feed (OD-12 accepted).
- Control flow is deterministic. AI is used **inside** steps only. Evidence content can never change which steps run (GR-10).
- Steps cover OCR/parsing → extraction → normalisation → scam analysis → correlation → timeline → missing information/questions → actions. The run ends at `ACTIONS_READY`. Report generation is a separate user action (FR-017).
- Each step's validated structured output is saved.
- Re-running does **not** reprocess evidence that is already processed and unchanged.
- Only one analysis run is active per case. Starting another while one runs does not create a duplicate.
- Evidence still uploading when the run starts is processed in a later run.

**Outputs:** State transitions (§6.3), saved per-step outputs, activity events, audit entry for the run.

**Validation:** Every step's output must match its defined structure before it is saved and before the case advances. Invalid output counts as a step failure.

**Failure Behavior:**
- A failed step marks the run as failed at that step.
- The case keeps its last completed state.
- The user sees which step failed and a **Retry**, which resumes at the failed step.
- The case does not advance past `EXTRACTED` until every evidence item is `processed` or has been removed by the user.

**Acceptance Criteria:**
- AC-006.1 Starting analysis does not block the UI, and progress appears in the activity feed.
- AC-006.2 The plan is visible before or as steps run.
- AC-006.3 After adding one new item to an analysed case, re-running processes only the new item's OCR/extraction.
- AC-006.4 Starting analysis twice concurrently results in one run.
- AC-006.5 A forced failure in one step shows that step as failed, and Retry completes the run without redoing completed steps.
- AC-006.6 Each step's structured output is saved, not only final text.

Dependency: OD-12, OD-15, AD-05 (accepted).

---

### FR-007 — OCR / Parsing · M

**Description:** Extract text and layout from each evidence item before any AI reasoning.

**Actor:** System (Evidence / Extraction Agent).

**Preconditions:** Evidence item is `uploaded`. Analysis is running.

**Inputs:** Evidence item: image, PDF, text, email export or URL.

**Expected Behavior:**
- Produces source text with positional structure: page, line, and region/bounding box for images. Each line is individually referenceable.
- Routing by type:
  - Pasted text, TXT and email exports are parsed directly.
  - PDFs with a text layer use their embedded text with positions.
  - Images (PNG/JPG) use OCR.
  - URLs are parsed as strings only.
- **The AI language model is never the OCR or parsing source of truth** (OD-03 accepted). Source text comes from OCR or a parser.
- Records parser/engine metadata and confidence where available.

**Outputs:** Parsed source text with positions per evidence item, plus parser metadata.

**Validation:** Positional information must be good enough for the UI to show the source snippet of any extracted fact.

**Failure Behavior:**
- If parsing fails or yields no usable text, the item becomes `failed` with a reason the user can understand, e.g., "No readable text found".
- The user can retry or remove the item.
- No extraction is ever produced from a failed parse.
- Scanned (image-only) PDFs: see §8.3.

**Acceptance Criteria:**
- AC-007.1 Each of the six synthetic artifacts produces source text containing all its key fields, as listed in the benchmark.
- AC-007.2 Every line of source text can be located back to its page/region or line.
- AC-007.3 An image with no readable text is marked `failed` with a visible reason, and no entities are produced from it.
- AC-007.4 No source text is produced by the language model.

Dependency: OD-03 (contract accepted; engine choice `IMPLEMENTATION DETAIL`; scanned-PDF scope **open**).

---

### FR-008 — Entity Extraction with Provenance · M

**Description:** Identify key entities in each evidence item. Every extraction carries provenance.

**Actor:** System (Evidence / Extraction Agent).

**Preconditions:** FR-007 succeeded for the item.

**Inputs:** Parsed source text and positions. Evidence type.

**Expected Behavior:**
- Follows the extraction model in §10.2. Candidates are proposed with references to source lines. Each identifier is accepted **only if it literally occurs in the referenced source text after normalisation**.
- Extracts at least the fields in §10.1 per evidence type, where they are present.
- Each accepted extraction records the fields listed in §10.3.

**Outputs:** Extraction records with: field type, raw value, normalised value, confidence, provenance (evidence, page/region/line, snippet, method) and validation status.

**Validation:**
- Phone numbers, URLs, UPI IDs, transaction IDs/UTRs and amounts that are not present in the source text are **rejected** (GR-01–GR-04).
- Bank, wallet and merchant names must come from evidence or a user statement (GR-05).
- Rejected candidates are never shown as facts.

**Failure Behavior:**
- If extraction fails for an item, the step fails visibly with Retry (§21).
- If no entities are found, this is shown as "No key details found in this item". It is not a failure, and nothing is invented.

**Acceptance Criteria:**
- AC-008.1 On the synthetic set, phone, URL, UPI ID, UTR, amount and dates appear with provenance, at > 95% accuracy on simple structured fields.
- AC-008.2 If the AI proposes an identifier that is not in the source text (fault-injection test), it is rejected and appears nowhere.
- AC-008.3 Every displayed extraction opens its source snippet and location.
- AC-008.4 Every extraction shows a confidence band and its validation status.

Dependency: OD-02 (contract accepted; vendor **open**, `IMPLEMENTATION DETAIL`), AD-02 (accepted).

---

### FR-009 — Entity Normalisation, Canonicalisation & Masking · M

**Description:** Normalise extracted values and produce case-level canonical entities with a masked display value.

**Actor:** System.

**Preconditions:** Accepted extractions exist.

**Inputs:** Extraction records.

**Expected Behavior:**
- Normalises phone format, URL canonical form, amount and currency, and timestamps.
- Merges extractions that refer to the same thing into one case-level **entity** with a canonical value and a masked value.
- Entity types follow §10.1.
- Masked values are shown by default where the Master Spec requires (graph, overview).
- Full identifier values are available to the owner where they are needed for reporting (entity detail, report).
- **OTPs and full card numbers are never shown** in ordinary UI text or reports (GR-09).

**Outputs:** Entity records (type, canonical value, masked value) linked to their supporting extractions.

**Validation:** Normalisation rules are `IMPLEMENTATION DETAIL` (07). A canonical value must be derivable from at least one accepted extraction.

**Failure Behavior:** If normalisation fails for a value, it is kept as its raw value, marked "not normalised", and is not merged.

**Acceptance Criteria:**
- AC-009.1 The same phone number written in different formats (with/without `+91`, spaces) resolves to one entity.
- AC-009.2 An OTP present in evidence is redacted in the UI, the report and exports.
- AC-009.3 A full card number, if present, is masked everywhere.
- AC-009.4 Each entity lists the extractions and evidence items that support it.

---

### FR-010 — Scam Pattern Analysis · M

**Description:** Classify the likely scam pattern against a fixed taxonomy and explain the evidence behind it.

**Actor:** System (Scam Analysis Agent).

**Preconditions:** Case reached `EXTRACTED`.

**Inputs:** Entities, extractions, parsed text, user-provided description.

**Expected Behavior:** Produces **one primary** label and zero or more **secondary** labels from the fixed taxonomy (§11). Each label carries a confidence band, a short calibrated explanation and at least one citation. Rules and AI reasoning are both used.

**Outputs:** Scam signals: labels, explanation, citations, confidence bands. The case's incident type equals the primary label (AD-01).

**Validation:**
- Labels come only from the taxonomy.
- `UNKNOWN_OTHER` may appear only alone, as primary.
- Every explanation cites at least one evidence item or extraction.
- Wording is checked for forbidden phrasing such as "confirmed fraud" or "the scammer is" (GR-12).

**Failure Behavior:**
- If no label is supported by evidence, the result is `UNKNOWN_OTHER` with an explanation of what was missing.
- If the step fails or produces invalid output, the step fails visibly with Retry. No label is shown.

**Acceptance Criteria:**
- AC-010.1 For the synthetic case, the primary label is KYC impersonation, with UPI fraud and phishing as secondary labels (shown as "KYC/UPI" on the overview).
- AC-010.2 Every explanation cites at least one evidence item.
- AC-010.3 No output contains "confirmed fraud" or names a suspect as the fraudster.
- AC-010.4 A label outside the taxonomy is never shown.

Dependency: AD-01 (accepted).

---

### FR-011 — Cross-Evidence Correlation & Evidence Graph · M

**Description:** Link entities across evidence items and build the case-level evidence graph.

**Actor:** System (Evidence Correlation Agent). The user explores the result.

**Preconditions:** Entities exist.

**Inputs:** Entities, extractions, evidence items.

**Expected Behavior:** Builds `appears_in` links (entity → evidence) and entity-to-entity relationships (§12). Each relationship references the evidence that supports it. The graph contains only this case's nodes. Selecting a node shows its source evidence and snippets.

**Outputs:** Graph of case, entity and evidence nodes, with supported edges.

**Validation:** An edge without a supporting evidence reference is never created or shown.

**Failure Behavior:** The step fails visibly with Retry. The rest of the workspace (entities, evidence) stays available.

**Acceptance Criteria:**
- AC-011.1 In the synthetic case, the graph visibly connects **phone → URL → UPI ID → transaction** across different artifacts.
- AC-011.2 Every edge shows the evidence that supports it.
- AC-011.3 Clicking a node shows its source evidence and snippet.
- AC-011.4 Masked values are shown by default in the graph.

Dependency: G-6 (relationship vocabulary, `IMPLEMENTATION DETAIL` in 08).

---

### FR-012 — Timeline Reconstruction · M

**Description:** Build a chronological list of incident events from extracted timestamps and user input.

**Actor:** System (Timeline Agent).

**Preconditions:** Case reached `CORRELATED`.

**Inputs:** Temporal extractions, entities, evidence metadata, user-provided incident time and corrections.

**Expected Behavior:** Events carry the fields listed in §13.1. They are ordered by time. Events without a reliable time are placed by inferred order and **marked as such**. Exact times are never invented.

**Outputs:** Timeline events.

**Validation:** Every event has at least one source reference: evidence/extraction or user statement.

**Failure Behavior:** The step fails visibly with Retry. A partial timeline is never shown as complete.

**Acceptance Criteria:**
- AC-012.1 For the synthetic case, the timeline matches the expected sequence with > 90% of known events correctly ordered.
- AC-012.2 An event with no explicit timestamp is marked as approximate or order-only and shows no invented time.
- AC-012.3 Every event links to its source.

Dependency: G-5 (time handling, `IMPLEMENTATION DETAIL`), G-6 (event-type vocabulary).

---

### FR-013 — User Corrections · M

**Description:** The user can correct AI-generated timeline events and extracted fields, including one-click correction of OCR mistakes.

**Actor:** Case owner.

**Preconditions:** The target record exists.

**Inputs:** Target (timeline event, extraction or entity), corrected value, optional note.

**Expected Behavior:**
- The corrected value is stored alongside the **original AI value**, which is kept.
- The correction is recorded as a **user statement** and marked visibly as user-corrected.
- Downstream outputs are refreshed according to the re-entry rules (S-4).
- Users can also **add** missing events and **dismiss** incorrect ones.

**Outputs:** Updated record with correction status, preserved original, user-statement provenance, audit entry.

**Validation:**
- A corrected value is validated for its type (e.g., a time must be a valid time).
- A user-corrected identifier is labelled as user-provided, not as extracted from evidence.

**Failure Behavior:** If saving fails, the original value remains and the user sees an error. The correction is not shown as applied.

**Acceptance Criteria:**
- AC-013.1 The user corrects one timeline event, and the change persists after reload.
- AC-013.2 The corrected event is visibly marked user-corrected, and the original value is viewable.
- AC-013.3 Timeline order and report reflect the correction after regeneration.
- AC-013.4 The correction voids any existing review confirmation.
- AC-013.5 An audit entry records the correction.

---

### FR-014 — Missing & Contradictory Information Detection · M

**Description:** Check the case against the information needed for reporting, and flag gaps and conflicts.

**Actor:** System (Evidence Correlation Agent / Orchestrator).

**Preconditions:** Case reached `TIMELINE_READY`.

**Inputs:** Entities, timeline, scam classification, the NCRP-based reference checklist (§14).

**Expected Behavior:** Lists missing items, each with why it matters, and contradictions, each referencing **both** conflicting sources. Proofline does not choose which conflicting source is correct. The checklist variant (financial or all incidents) is selected by whether a financial loss is reported (AD-01).

**Outputs:** Missing-information items and contradiction items.

**Validation:** Absent required fields read **"Not provided"**. No gap is ever filled with a guessed value.

**Failure Behavior:** The step fails visibly with Retry. A failed check is never shown as "nothing missing".

**Acceptance Criteria:**
- AC-014.1 The planted gap in the synthetic case (debited bank name) is listed as "Not provided" with a reason.
- AC-014.2 The planted contradiction (payment time in the user note vs. the receipt) is shown with both sources.
- AC-014.3 The identity document is listed as "keep ready for official reporting" and is never requested as an upload.

Dependency: AD-01 (accepted), OD-09 (deferred; default not accepted). The exact checklist per incident type is `IMPLEMENTATION DETAIL` (06), based on §14.

---

### FR-015 — Targeted Follow-up Questions · M

**Description:** The agent asks a small number of high-value questions to fill critical gaps or resolve contradictions.

**Actor:** System asks. Case owner answers.

**Preconditions:** FR-014 produced items.

**Inputs:** Missing and contradiction items.

**Expected Behavior:**
- Questions appear only for gaps or conflicts that materially affect the case.
- Answers are stored as **user statements** and labelled as such, e.g., "You stated…".
- Answers update the case **without a full re-analysis** (S-4).
- An answer is never presented as documentary evidence.

**Outputs:** Questions, stored answers, updated missing-information list, audit entry.

**Validation:** Answers are validated for type where applicable (e.g., time, amount). The user may skip a question. The field then stays "Not provided".

**Failure Behavior:** If an answer fails to save, the question remains open and an error is shown.

**Acceptance Criteria:**
- AC-015.1 The synthetic case raises a question for the missing bank name, and the answer fills the field as a user statement.
- AC-015.2 Answering does not trigger reprocessing of evidence.
- AC-015.3 The report shows the answered value labelled as user-stated.
- AC-015.4 No question is asked about a field that is already present and uncontested.

---

### FR-016 — Immediate Action Checklist · M

**Description:** Generate prioritised next steps based on the incident type, pointing to official channels where relevant.

**Actor:** System (Response Agent). The user updates status.

**Preconditions:** Case reached `TIMELINE_READY`.

**Inputs:** Scam classification, entities (e.g., whether money moved), timeline, missing information.

**Expected Behavior:** Produces actions with priority, action, reason, source and status (to do / done / not applicable), ordered by priority. Official contact channels (1930, NCRP, NCRP Report Suspect, bank contact guidance) come from a **curated static list**. Details in §15.

**Outputs:** Action items.

**Validation:** Every action has a reason. No helpline number or portal URL comes from the AI (GR-14).

**Failure Behavior:** The step fails visibly with Retry. The static official-channel guidance on the landing page remains available regardless.

**Acceptance Criteria:**
- AC-016.1 For the synthetic UPI fraud case, the checklist includes at least: **contact your bank**, **report financial cyber fraud via 1930 / NCRP**, **preserve original evidence**, each with a reason.
- AC-016.2 The user can mark an action done or not applicable, and the change persists.
- AC-016.3 Every official channel shown matches the curated list exactly.

---

### FR-017 — Complaint Draft Generation · M

**Description:** Generate a structured, complaint-ready case draft.

**Actor:** Case owner triggers it. The system (Report Generator) assembles it.

**Preconditions:** Case reached `ACTIONS_READY` (or later).

**Inputs:** Case metadata, entities, classification, timeline, missing information, user corrections and answers, actions, evidence index.

**Expected Behavior:**
- Assembles a **versioned** draft with the sections in §16, aligned to the NCRP checklist order.
- Content is assembled from saved structured data. AI writes only the incident summary and the signal explanation, and both must cite their sources.
- Each version records version number, generation time and checksum.
- Regenerating creates a new version and keeps the earlier ones.
- The case moves `REPORT_DRAFT` → `USER_REVIEW`.

**Outputs:** Report version (structured content + rendered document), audit entry.

**Validation:**
- **Every key fact carries provenance** (evidence or user statement). A key fact without provenance is not rendered (GR-06).
- Missing fields read "Not provided" (GR-07).
- An AI-assisted / not official / not legal advice notice is present.

**Failure Behavior:** Generation failure leaves the case in `REPORT_DRAFT` with Retry. No partial draft is shown as complete. Earlier versions remain available.

**Acceptance Criteria:**
- AC-017.1 The synthetic case produces a draft containing every §16 section.
- AC-017.2 100% of key facts link to evidence or a user statement.
- AC-017.3 Missing fields read "Not provided".
- AC-017.4 The disclaimer is present.
- AC-017.5 Regenerating produces version N+1 and keeps version N.

Dependency: AD-04, OD-07 (accepted).

---

### FR-018 — Evidence Index · M

**Description:** A downloadable list of all evidence in the case.

**Actor:** System.

**Preconditions:** Case has evidence.

**Inputs:** Evidence records.

**Expected Behavior:** For each item, lists: evidence reference (`E01`…), type, label, upload time, SHA-256, integrity status, attestation reference (if any), and the key facts derived from it. Included in the complaint draft and in exports.

**Outputs:** Evidence index (within the report and export).

**Validation:** Every evidence item in the case appears, and its fingerprint matches the stored value.

**Failure Behavior:** Generated with the report. If generation fails, it fails with the report (FR-017).

**Acceptance Criteria:**
- AC-018.1 All six synthetic items appear with matching fingerprints.
- AC-018.2 The index appears in the draft and in the export.
- AC-018.3 Integrity status shows the latest verification result, or "not yet verified".

---

### FR-019 — User Review Gate · M

**Description:** The user must review and explicitly confirm the case package before export or sharing.

**Actor:** Case owner.

**Preconditions:** Case is `USER_REVIEW`, with a current report version.

**Inputs:** Report version, explicit confirmation action.

**Expected Behavior:**
- While the case is `USER_REVIEW`, the draft awaits review. The review screen shows key facts, uncertain values, missing information and contradictions (§18).
- Confirming records **who and when** against **that specific report version** (and its checksum).
- The case **remains** `USER_REVIEW` and shows "Reviewed – version N" (R-1).
- Any later change (S-4) or regeneration voids the confirmation, and a new confirmation is required.

**Outputs:** Review confirmation record, audit entry.

**Validation:** A confirmation applies only to the version it was made on.

**Failure Behavior:** If saving the confirmation fails, export stays disabled and an error is shown.

**Acceptance Criteria:**
- AC-019.1 Export is impossible without a confirmation tied to the current report version.
- AC-019.2 After regeneration, the previous confirmation no longer allows export.
- AC-019.3 Status reads `USER_REVIEW` both before and after confirmation, and the confirmation indicator distinguishes the two.
- AC-019.4 Confirmation writes an audit entry with the version number.

Dependency: AD-05 + R-1 (resolved).

---

### FR-020 — Export · M

**Description:** Export selected artifacts.

**Actor:** Case owner.

**Preconditions:** The current report version is confirmed (FR-019).

**Inputs:** Confirmed report version. Selection: draft, evidence index, chosen original evidence files.

**Expected Behavior:** Provides the formats in §18.2 (OD-07 accepted): the **report PDF** alone, or a **ZIP bundle**. Downloads use authorised, short-lived links. The case becomes `EXPORTED`. Proofline submits **nothing** to any external party.

**Outputs:** Downloadable export. Audit entry recording what was exported and which version.

**Validation:** Only the confirmed current version can be exported. Original files in the bundle are byte-identical to the uploaded originals, so their fingerprints match the manifest.

**Failure Behavior:** If export generation fails, a visible error with Retry. No partial bundle is offered.

**Acceptance Criteria:**
- AC-020.1 A confirmed version exports as PDF and as a ZIP bundle.
- AC-020.2 The SHA-256 of each original file in the bundle equals the manifest value and the evidence index.
- AC-020.3 An unconfirmed version cannot be exported.
- AC-020.4 The audit log shows the export.
- AC-020.5 No network request is made to any external authority, bank or third party.

Dependency: OD-07 (accepted).

---

### FR-021 — Integrity Verification · M

**Description:** Recompute SHA-256 of the stored evidence and compare it with the recorded hash. If an attestation exists, also compare it with the ledger record.

**Actor:** Case owner (on demand).

**Preconditions:** Evidence item has a recorded fingerprint.

**Inputs:** Evidence ID.

**Expected Behavior:** Returns **match** or **mismatch**, with recorded hash, current hash and ingestion timestamp. If an attestation exists: the attestation reference and whether it agrees, or **attestation unavailable** when the ledger cannot be reached. The screen states in plain language what a match does and does not prove (§17).

**Outputs:** Verification result, audit entry.

**Validation:** The comparison is always against the fingerprint recorded at ingestion.

**Failure Behavior:** If the stored object cannot be read (e.g., storage unavailable), the result is "**verification could not be completed**". This is **never** reported as match or mismatch.

**Acceptance Criteria:**
- AC-021.1 Untouched evidence returns **match** 100% of the time.
- AC-021.2 A deliberately modified copy returns **mismatch** (negative test).
- AC-021.3 The "proves / does not prove" statements are visible on the result.
- AC-021.4 A storage read failure shows "could not be completed", not mismatch.
- AC-021.5 Each verification writes an audit entry.

Dependency: OD-06 (optional attestation; deferred).

---

### FR-022 — Blockchain/Testnet Hash Attestation · O

**Description:** Optionally register `hash + timestamp + case evidence ID` on a low-cost blockchain testnet.

**Actor:** System.

**Preconditions:** Feature enabled (default **disabled**). Evidence fingerprinted.

**Inputs:** Evidence SHA-256, timestamp, opaque case evidence ID.

**Expected Behavior:** Registers **only** minimal integrity metadata, asynchronously. Stores the attestation reference with the evidence. The on-chain identifier cannot be reversed to user identity.

**Outputs:** Attestation reference (e.g., transaction hash, network).

**Validation:** Nothing else goes on-chain: no content, no PII, no bank details, no conversation text.

**Failure Behavior:** Chain failure or unavailability **never** blocks upload, analysis, report, review, export or verification. The attestation status shows "unavailable".

**Acceptance Criteria (only if built):**
- AC-022.1 The on-chain payload contains only hash, timestamp and opaque reference.
- AC-022.2 With the ledger unreachable, the full end-to-end flow still completes.
- AC-022.3 Verification shows the attestation reference and comparison result.

Dependency: OD-06 (**whether to build: open**; network deferred). Blockchain is **not** required for the MVP.

---

### FR-023 — Audit Log · M

**Description:** Record security-relevant and case-relevant actions.

**Actor:** System records. The owner views.

**Preconditions:** None.

**Inputs:** System events.

**Expected Behavior:**
- Records at least: case creation, uploads, evidence views/downloads, analysis runs, state changes, corrections, answers, report generation, review confirmation, exports, verifications and deletions. Each entry has actor, action, target, time and metadata.
- The owner can view the case audit log.
- Entries are append-only from the application's point of view.
- **Audit metadata never contains evidence content, filenames, extracted values or other PII** (OD-11). This allows entries to survive deletion without leaking data.

**Outputs:** Audit entries. Audit view.

**Validation:** No update or delete of audit entries through the product.

**Failure Behavior:** If an audited action cannot write its audit entry, the action is treated as failed and the user is told.

**Acceptance Criteria:**
- AC-023.1 Every action listed above appears in the audit view after the end-to-end test.
- AC-023.2 No audit entry contains evidence text, filenames or identifier values.
- AC-023.3 Audit entries cannot be edited or deleted through the product.

---

### FR-024 — Agent Activity View · M

**Description:** Show the user, in structured form, what the agents are doing and have done.

**Actor:** Case owner views.

**Preconditions:** An analysis run exists.

**Inputs:** Orchestrator step events.

**Expected Behavior:**
- An ordered feed shows the plan, then each step with status, short description and timestamps.
- Per-evidence progress is shown (e.g., "Evidence 6/6 processed").
- The feed updates without a page reload. Delivery is polling by default (OD-10).
- It shows steps and results, **not** raw model reasoning.
- If the demo fallback is active, the feed **says so** (FR-027).

**Outputs:** Activity feed.

**Validation:** The feed reflects only this case.

**Failure Behavior:** Failed steps are shown as failed, with reason and Retry. If the feed itself cannot be loaded, the user sees a connection message, not a frozen "running" state.

**Acceptance Criteria:**
- AC-024.1 During analysis, the audience can see OCR → extraction → correlation → timeline → actions progress, and the report step when the draft is generated.
- AC-024.2 The "N/N processed" counter is accurate.
- AC-024.3 No raw model reasoning is shown.
- AC-024.4 Fallback use is visibly labelled.

Dependency: OD-10 (deferred; default polling).

---

### FR-025 — Case & Evidence Deletion · M

**Description:** The user can delete an evidence item or an entire case.

**Actor:** Case owner.

**Preconditions:** Item or case exists and is owned by the user.

**Inputs:** Case ID or evidence ID, explicit confirmation.

**Expected Behavior (OD-11 accepted):**
- **Hard delete**, user-initiated only. No automatic expiry in MVP. Data is kept until the user deletes it.
- **Deleting evidence** removes:
  - the stored object and its extractions;
  - entities left without support;
  - relationships citing it;
  - timeline events whose only source it was.
- Deleting evidence also **invalidates all report versions**: their stored documents and exports are deleted and any confirmation is voided. The case returns to `INGESTING`, or `NEW` if no evidence remains.
- **Deleting a case** removes all its data and stored objects.
- A minimal audit tombstone is kept (FR-023).
- On-chain hashes, if any, cannot be deleted. They contain no PII.

**Outputs:** Deletion result, audit tombstone.

**Validation:** Explicit confirmation is required, and the user is told what will be removed, including report invalidation.

**Failure Behavior:**
- If deletion fails part-way, the user is told and can retry.
- Deleted data is never shown again.
- An analysis running on deleted evidence or a deleted case stops cleanly, without errors surfacing as data.

**Acceptance Criteria:**
- AC-025.1 Deleted evidence can no longer be retrieved through any product route, including old links once they expire and report downloads.
- AC-025.2 Derived data that depended only on that evidence is removed.
- AC-025.3 Report versions are invalidated after an evidence deletion.
- AC-025.4 A deleted case disappears entirely.
- AC-025.5 A tombstone audit entry remains.

Dependency: OD-11 (accepted).

---

### FR-026 — Authentication & Session · M

**Description:** Users authenticate with a one-time code sent to their email and keep a session.

**Actor:** User.

**Preconditions:** None.

**Inputs:** Email address, one-time code.

**Expected Behavior:** Details in §19 (OD-04 accepted).
- **Email** one-time code sign-in. Phone/SMS codes are not in MVP.
- Codes expire, and repeated wrong attempts are limited.
- A new session is created at every login.
- Sessions expire and can be revoked (logout).

**Outputs:** Authenticated session. Audit of sign-in/sign-out.

**Validation:** Codes are single-use and time-limited.

**Failure Behavior:** Wrong or expired code shows a clear message and allows a new code to be requested. Too many attempts results in a temporary block with a message. Email delivery failure shows a visible error, never a silent wait.

**Acceptance Criteria:**
- AC-026.1 An unauthenticated user cannot reach any case data.
- AC-026.2 A valid code signs the user in. Expired or reused codes are rejected.
- AC-026.3 Logout ends the session, and the old session no longer works.
- AC-026.4 Repeated wrong codes are limited.

Dependency: OD-04 (accepted; email delivery vendor `IMPLEMENTATION DETAIL`).

---

### FR-027 — Synthetic Demo Dataset & Deterministic Fallback · M

**Description:** A fixed synthetic KYC/UPI scenario with expected outputs, plus a fallback path if external OCR/AI services fail during a demo.

**Actor:** Demo team, system.

**Preconditions:** Synthetic dataset and benchmark exist (AD-03).

**Inputs:** The six synthetic artifacts, expected results, fingerprint list.

**Expected Behavior:**
- The full Definition of Done runs on the synthetic dataset (§22).
- When enabled, cached results are served **only** for evidence whose fingerprint matches the committed synthetic set, and only when the live service fails or for an explicit offline rehearsal (AD-06).
- Fallback use is **always** shown in the activity feed and recorded in logs and audit. It is **never** presented as live processing.

**Outputs:** Reproducible demo. Benchmark results for the §3 goals.

**Validation:** Evidence with any other fingerprint can **never** receive cached results.

**Failure Behavior:** If the live service fails for non-synthetic evidence, the step fails visibly (§21). No fallback is used.

**Acceptance Criteria:**
- AC-027.1 With OCR and AI services unavailable, the synthetic case still completes end-to-end, with fallback disclosed.
- AC-027.2 A non-synthetic file with services unavailable fails visibly and receives no cached output.
- AC-027.3 Benchmark results are produced for extraction accuracy, provenance coverage, timeline completeness, generation time and integrity.

Dependency: AD-03 (list accepted; **exact contents open**), AD-06 (accepted).

---

### FR-028 — Speech-to-Text Caller Summary · O

**Description:** Optionally accept a spoken summary of a caller conversation from the user, and transcribe it as evidence.

**Actor:** Case owner.

**Preconditions:** Feature built and enabled. **Default: excluded** from the MVP (OD-08, deferred).

**Inputs:** User-initiated audio of the user's own summary.

**Expected Behavior:** If built, it is user-initiated only and never automatic call recording. The transcript is stored as evidence of type *user statement* and labelled as such.

**Outputs:** Transcript evidence item.

**Validation:** No automatic capture of any call.

**Failure Behavior:** If transcription fails, the item is marked failed with Retry.

**Acceptance Criteria (only if built):**
- AC-028.1 Recording starts only on explicit user action.
- AC-028.2 The transcript is labelled as a user statement.

Dependency: OD-08 (deferred; default excluded unless the full DoD passes first).

---

## 8. Evidence Requirements

### 8.1 Supported evidence types (MVP)

| Evidence type | Input method | Processed by | Notes |
|---|---|---|---|
| Screenshot (PNG/JPG) | File upload | OCR | Chat, SMS, browser, bank-alert screenshots |
| PDF with text layer | File upload | Embedded text with positions | Receipts, statements |
| PDF without text layer (scanned) | File upload | **See §8.3** | Dependency: OD-03 |
| TXT | File upload | Direct parsing | |
| Email export | File upload | Direct parsing (sender, subject, timestamp, headers/URLs where available, body) | Exact accepted format(s) depend on G-4. Mailbox connectors are out of scope (N13). |
| Transaction / payment receipt | File upload (image or PDF) | As per its file type | |
| Pasted message / chat transcript | Paste | Direct parsing | Fingerprinted canonical text (G-3) |
| Pasted URL | Paste | String parsing only | **Never fetched, opened, crawled or resolved** |
| Spoken caller summary | Recording | Transcription | **Excluded by default** (OD-08) |
| Identity documents | — | — | **Not requested. Default: not accepted** (OD-09). Users are asked not to upload them. |

### 8.2 Evidence rules

- **EV-1** Every evidence item, file or pasted, gets an evidence reference, a fingerprint, secure storage and an audit entry.
- **EV-2** Evidence is immutable after ingestion. Corrections apply to derived data, never to the original.
- **EV-3** Evidence content is **untrusted data**. Text inside evidence can never change product behaviour, step selection or output structure (GR-10).
- **EV-4** File type is checked by content. Size and count limits are `IMPLEMENTATION DETAIL` (G-4).
- **EV-5** Users can preview their own evidence through authorised access only (FR-005).
- **EV-6** Synthetic data only in the hackathon. Never real bank details, OTPs, addresses or ID documents.

### 8.3 Scanned-PDF boundary (FR-002 is not changed)

FR-002 accepts PDF files. FR-002 is **not** narrowed by this PRD. Whether image-only (scanned) PDFs are **processed** in the MVP depends on **OD-03 (open, `NEEDS HUMAN DECISION`)**.

The following holds **regardless** of how OD-03 is resolved:

- **EV-7** A PDF with a text layer **MUST** be processed.
- **EV-8** A scanned PDF **MUST NOT** silently produce an empty or invented result. Exactly one of these applies:
  - **(a) If OD-03 includes scanned-PDF support:** it is processed like an image, with positional provenance.
  - **(b) If OD-03 excludes it:** the item is clearly marked as not processable, with the message "This PDF contains no readable text layer; upload a screenshot or photo of it instead". The user can remove it.
- **EV-9** The synthetic demo set uses a text-layer PDF (E04), so the demo does not depend on OD-03.

---

## 9. Evidence Processing Requirements

What the user can expect after uploading evidence. Technologies are specified in 04 and 07.

| # | Expectation | Requirement | FRs |
|---|---|---|---|
| P-1 | Upload succeeds | Each accepted item reaches `uploaded`. Rejected items are clearly explained and leave nothing behind. | FR-002, FR-003 |
| P-2 | Evidence receives an identifier | Each item gets a unique ID and an evidence reference (`E01`, …), shown in the list and index. | FR-002, FR-018 |
| P-3 | Evidence is fingerprinted | SHA-256 of the original bytes, computed by Proofline, visible to the user. | FR-004 |
| P-4 | Evidence is securely stored | Private, encrypted at rest, authorised short-lived access only. | FR-005 |
| P-5 | OCR/parsing runs | After the user starts analysis, each item moves `processing → processed` or `failed`. | FR-006, FR-007 |
| P-6 | Extracted content becomes available | Source text (with locations) and extracted entities are viewable per item. | FR-007, FR-008 |
| P-7 | Extraction results retain provenance | Every extracted value links to evidence + location + snippet + method. | FR-008 |
| P-8 | Processing failures are visible | Failed items and failed steps show a reason and Retry. Nothing fails silently. | FR-006, §21 |
| P-9 | User can inspect source evidence | From any fact, the user can open the evidence preview and the highlighted source snippet. | NFR-04 |
| P-10 | The system never invents extracted facts | Identifiers not present in source text are rejected. Missing values read "Not provided". | GR-01–GR-07 |

---

## 10. Entity Extraction Requirements

### 10.1 What is extracted

**Entity types (MVP):** `PERSON` · `PHONE` · `EMAIL` · `URL` · `DOMAIN` · `UPI_ID` · `TRANSACTION` (transaction ID / UTR / reference number) · `AMOUNT` · `BANK_OR_WALLET` (bank/wallet/merchant name) · `ACCOUNT_HINT` (masked account/channel hints) · `SMS_SENDER_HEADER` · `MESSAGING_HANDLE` (WhatsApp/Telegram) · `DATETIME`. The exact enumeration is `IMPLEMENTATION DETAIL` (03/07). Dates and times are both captured, with their precision.

**Per input type, where present** (Master Spec §8.1):

| Input | Must extract |
|---|---|
| Screenshot | OCR text, sender/recipient, dates, times, visible URLs, phone numbers, amounts |
| UPI/bank receipt | Merchant/name, amount, timestamp, transaction/reference ID, account/channel hints |
| Email | Sender, subject, timestamp, headers/URLs when available, body text |
| PDF/statement | Transaction rows, dates, reference numbers, names |
| URL | Domain, path, normalised URL, basic lexical signals from the string itself. **No claim of maliciousness.** |
| Chat transcript | Participants, message timestamps, requests, payment details, suspicious claims |

### 10.2 Extraction model (mandatory)

```text
Evidence
↓
OCR / Parser
↓
Source text (with locations)
↓
AI identifies candidate entities + source line references
↓
Proofline validates each candidate against the OCR/source text
↓
Accepted structured extraction
```

- **EX-1** The AI language model is **not** the OCR source. Source text always comes from OCR or a parser (FR-007).
- **EX-2** For phone numbers, URLs, UPI IDs, transaction IDs/UTRs and amounts, a candidate is accepted **only if its value occurs literally in the referenced source text after normalisation**. A value that merely "looks plausible" is **rejected**.
- **EX-3** Bank, wallet and merchant names must be present in evidence or come from a user statement (GR-05).
- **EX-4** Rejected candidates are never shown, counted as facts, or used downstream.
- **EX-5** The same input yields the same identifiers (NFR-11).

### 10.3 Required attributes of every important extracted value

| Attribute | Requirement |
|---|---|
| Raw value | Exactly as read from the source text |
| Normalised value | Where applicable (phone, URL, amount/currency, date/time) |
| Source evidence | Evidence reference |
| Source location / provenance | Page, line(s), region where applicable, snippet, method (OCR / PDF text / text parse / rule / AI / user) |
| Confidence | Shown as a **band (High / Medium / Low)**. For identifiers it is derived from source-text reading quality and validation, **not** from the AI's self-assessment. The AI's own confidence is never displayed as a number. Band thresholds are `IMPLEMENTATION DETAIL` (AD-02). |
| Validation status | **Validated against source** / **User-corrected** / **User-stated** |

---

## 11. Scam Analysis Requirements

### 11.1 MVP taxonomy (fixed; AD-01 accepted)

| Code | Label (Master Spec FR-010) |
|---|---|
| `PHISHING` | Phishing |
| `KYC_IMPERSONATION` | KYC impersonation |
| `FAKE_INVESTMENT` | Fake investment |
| `FAKE_JOB_OR_LOAN` | Fake job/loan |
| `UPI_FRAUD` | UPI fraud |
| `ACCOUNT_TAKEOVER` | Account takeover |
| `DIGITAL_ARREST_IMPERSONATION` | Digital-arrest/impersonation |
| `MARKETPLACE_FRAUD` | Marketplace fraud |
| `UNKNOWN_OTHER` | Unknown/other |

Adding or splitting labels is a scope change that needs approval.

### 11.2 Analysis requirements

- **SA-1** Exactly one primary label plus zero or more secondary labels. `UNKNOWN_OTHER` only alone.
- **SA-2** Each label shows a short explanation citing at least one evidence item or extraction.
- **SA-3** Calibrated wording, e.g., "**signals consistent with** KYC impersonation". Never "confirmed fraud", never "the scammer is…", and no legal determination (GR-08, GR-12, GR-13).
- **SA-4** **Signals** (interpretation) are shown separately from **extracted facts** and from **actions** (GR-15, NFR-07).
- **SA-5** Uncertainty is visible: each label has a confidence band. Weak support is stated as such.
- **SA-6** The case's incident type equals the primary label. A separate **financial loss reported** indicator (true when any payment or debit amount is extracted or user-stated) selects the financial-fraud checklist variant (§14, §15).
- **SA-7** URL signals are lexical only and never framed as proof of maliciousness.

---

## 12. Correlation Requirements

- **CR-1** Entities that appear in several evidence items are merged into one canonical entity (FR-009).
- **CR-2** `appears_in` connects each entity to every evidence item it was extracted from.
- **CR-3** Entity-to-entity relationships, e.g., transaction **paid to** UPI ID, amount **of** transaction, URL **hosted on** domain, are created **only** when the supporting evidence shows the connection. Each carries the supporting evidence reference. The vocabulary is `IMPLEMENTATION DETAIL` (G-6, 08).
- **CR-4** No relationship is claimed without source evidence. Co-occurrence in one case alone is not a relationship.
- **CR-5** The graph shows only this case's nodes. Masked values are shown by default. Every node and edge opens its provenance.

Expected demo correlations:

```text
PHONE          — appears in → E01 SMS, E02 chat, E06 user note
URL / DOMAIN   — appears in → E01 SMS, E02 chat, E03 browser screenshot
UPI ID         — appears in → E04 payment receipt
TRANSACTION    — connects   → E04 payment receipt + E05 bank alert (same UTR)
```

---

## 13. Timeline Requirements

### 13.1 Event content

| Field | Requirement |
|---|---|
| Timestamp | When the event occurred, or empty if unknown |
| Timestamp precision | Exact / approximate / inferred order only |
| Event type | e.g., message received, call, link opened, credential/OTP request, payment initiated, debit notification. Vocabulary `IMPLEMENTATION DETAIL` (G-6). |
| Description | Short and neutral |
| Source references | Evidence/extraction and/or user statement |
| Confidence | Band (High / Medium / Low) |
| Origin | AI-generated or user-added |
| Correction status | Unmodified or user-corrected, with the original kept |

### 13.2 Event creation
- **TL-1** Events are created from temporal extractions and from user-provided information (incident time, answers, added events).

### 13.3 Timestamp extraction and normalisation
- **TL-2** Times are read from source text (FR-008) and normalised across formats. Default time zone is **IST**; exact handling is `IMPLEMENTATION DETAIL` (G-5).
- **TL-3** Relative or partial times are kept with reduced precision. **No exact time is ever invented.**

### 13.4 Ordering
- **TL-4** Events are ordered by timestamp. Events without a reliable time are placed by inferred order and labelled as such.

### 13.5 Sources and confidence
- **TL-5** Every event shows its sources and confidence. Inferred ordering has lower confidence.

### 13.6 User correction
- **TL-6** Users can correct an event's time, type or description, add missing events (which then have the user as their source), and dismiss incorrect events.
- **TL-7** Corrections are visible, audited and kept alongside the original. Ordering and downstream outputs update (S-4).

### 13.7 Contradiction handling
- **TL-8** When sources disagree about a time or sequence, both values and sources are shown as a contradiction (FR-014). Proofline does not choose between them. The user decides by correcting or answering.

### 13.8 `USER_REVIEW` semantics (resolved, R-1)

`DECISIONS.md` (AD-05) identified an ambiguity: Master Spec FR-019 lists `USER_REVIEW` as the status after confirmation, while §6.2 and §21.1 read it as "awaiting review". **This PRD resolves it as follows. The Master Spec is not modified.**

- **`USER_REVIEW` = the case is awaiting human review.** It is entered automatically when a report version is successfully generated.
- **Review confirmation** is a **separate action and record**, tied to a specific report version. It indicates that the user has approved the current case contents. The case remains `USER_REVIEW`, and the UI shows "Reviewed – version N".
- This is consistent with FR-019's outputs: at the moment of confirmation the case status is `USER_REVIEW`.
- Any correction, answer, new evidence, deletion or regeneration voids the confirmation (S-4).
- Export eligibility is decided by the confirmation on the current version, **not** by the status alone.

---

## 14. Missing Information Requirements

### 14.1 Reference checklist (from the NCRP complainant checklist, Master Spec §3.4)

| Field | Applies to | Proofline behaviour if absent |
|---|---|---|
| Incident date and time | All incidents | "Not provided" + high-value question |
| Incident details | All incidents | "Not provided" + question |
| Identity document | All incidents | Listed as **"keep ready for official reporting"**. Never requested or uploaded (OD-09). |
| Bank / wallet / merchant | Financial fraud | "Not provided" + question |
| Transaction ID or UTR | Financial fraud | "Not provided" + question |
| Transaction date | Financial fraud | "Not provided" + question |
| Fraud amount | Financial fraud | "Not provided" + question |
| Relevant evidence | All incidents | Missing-evidence hint, e.g., "no payment receipt uploaded" |
| Suspect details (phones, emails, bank accounts, URLs) | Optional | "Not provided". No question unless material. |

The financial rows apply when **financial loss reported** is true (SA-6). The exact checklist per incident type is `IMPLEMENTATION DETAIL` (06).

### 14.2 Requirements

- **MI-1 Missing critical fields:** each required field that is absent is listed as "Not provided", with why it matters.
- **MI-2 Contradictions:** conflicting values for the same fact, e.g., two amounts for one transaction or two times for one payment, are listed with both values and both sources.
- **MI-3 Incomplete transaction details:** a transaction missing amount, date, reference or bank/wallet is flagged per missing field.
- **MI-4 Missing timestamps:** events without a reliable time are flagged when the time matters for reporting.
- **MI-5 Missing evidence:** where a reported fact has no supporting document, e.g., a user-stated payment with no receipt, the user is told what evidence would support it.
- **MI-6 Question budget:** questions are asked **only** for gaps or contradictions that materially affect the case. Skipped questions leave the field "Not provided".
- **MI-7** Proofline never fills a gap with a guessed value.

---

## 15. Immediate Action Requirements

- **AC-R1 Based on incident information:** actions derive from the classification, the financial-loss indicator, entities, timeline and missing information.
- **AC-R2 Reason and source:** each action shows *why* and *what case information triggered it*.
- **AC-R3 Urgency:** each action has a priority, and the list is ordered by it. The priority scale is `IMPLEMENTATION DETAIL`. The case-level "urgency" indicator on the Incident Overview is undefined in the Master Spec. Dependency: **G-2 (open)**.
- **AC-R4 Official channels:** where relevant, actions direct the user to official channels (bank, 1930, NCRP, NCRP Report Suspect) using a **curated static list**. The AI never generates contact details (GR-14).
- **AC-R5 Proofline does not perform the action:** wording is always instructional ("Contact your bank…", "Report via 1930 / NCRP…"). Nothing implies Proofline has contacted anyone or will.
- **AC-R6 Status:** the user can mark each action to do / done / not applicable.
- **AC-R7 Minimum for financial UPI fraud:** contact your bank, report financial cyber fraud via 1930 / NCRP, preserve original evidence.

---

## 16. Complaint / Case Report Requirements

### 16.1 Report sections (AD-04 accepted; NCRP-aligned order)

| # | Section | Content |
|---|---|---|
| 0 | Header | Case reference, report version, generation time, review status, **AI-assisted / not an official document / not legal advice** notice |
| 1 | Incident summary | Short narrative. Every statement cites its sources. |
| 2 | Incident date and time | With precision and source |
| 3 | Financial details | Amount, transaction ID/UTR, transaction date, bank/wallet/merchant |
| 4 | Identifiers observed in evidence | Phones, URLs/domains, UPI IDs, messaging handles, SMS sender headers, emails. Labelled "observed in evidence", never as suspect identification (GR-08). |
| 5 | Scam-pattern signals | Primary/secondary labels with calibrated explanation and citations |
| 6 | Timeline | Chronological events with precision and user-corrected markers |
| 7 | Missing information and contradictions | "Not provided" items. Contradictions with both sources. |
| 8 | Recommended actions and official channels | From the checklist and the curated list |
| 9 | Evidence index | FR-018 contents |
| 10 | Identity-document reminder | "Keep your identity document ready for official reporting" |

### 16.2 Report rules

- **RP-1** Every key fact shows its value with a source marker (evidence + location, or user statement), or reads **"Not provided"**.
- **RP-2** User-stated facts are visibly labelled as user statements.
- **RP-3** Signals, facts and actions are in separate sections (GR-15).
- **RP-4** No report field exists beyond those above. New fields require a spec change.
- **RP-5** Reports are versioned and checksummed. Earlier versions remain viewable until invalidated by deletion (FR-025).
- **RP-6** The report is reviewable in the product before any export (§18).
- **RP-7** OTPs and full card numbers never appear (GR-09).

---

## 17. Evidence Integrity Requirements

- **IN-1 Fingerprint:** SHA-256 over original bytes at ingestion (FR-004).
- **IN-2 Stored fingerprint:** recorded with the ingestion timestamp. Never changes.
- **IN-3 Later verification:** on demand, Proofline recomputes SHA-256 of the stored evidence and compares (FR-021).
- **IN-4 Success:** **match** shows recorded hash = current hash, plus the ingestion time.
- **IN-5 Failure:** **mismatch** shows both hashes and explains that the stored file differs from what was registered.
- **IN-6 Could not complete:** if stored evidence cannot be read, the result says so. It is never shown as match or mismatch.
- **IN-7 Plain-language explanation, shown on the verification screen.** A match **proves** that the file has not changed since it was fingerprinted. It **does not prove** that the evidence is truthful or authentic: a fabricated screenshot verifies too. It **does not** by itself establish legal admissibility.
- **IN-8 Blockchain is optional** (FR-022, OD-06 deferred, default off). When built, only hash + timestamp + an opaque reference go on-chain, and its unavailability never blocks anything.

---

## 18. User Review and Export

### 18.1 Human-in-the-loop requirements

Before export, the review screen **MUST** show:

- **RV-1** Key extracted information: summary, financial details, identifiers, timeline, signals, each with provenance.
- **RV-2** Uncertain information: low-confidence values, inferred ordering and approximate times, clearly marked.
- **RV-3** Missing information and contradictions.
- **RV-4** Which facts are user statements and which are user corrections.
- **RV-5** An explicit **confirmation** action for the current report version (FR-019). Export stays unavailable until it is done.
- **RV-6** The AI-assisted / not official / not legal advice disclaimer.

### 18.2 Export (OD-07 accepted)

| Export option | Contents |
|---|---|
| Report PDF | Complaint draft including evidence index. Disclaimer on every page. |
| ZIP bundle | `report.pdf`; `case.json` (structured case data); `manifest.json` (report version, confirmation time, SHA-256 of every file in the bundle and of each original evidence item); `evidence/` with the original files the user selected |

- **EXP-1** Only a confirmed current version can be exported.
- **EXP-2** Downloads use authorised, short-lived links.
- **EXP-3** **No automatic external submission** of any kind. The user takes the material to official channels themselves.

---

## 19. Authentication / Authorization Requirements

Resolved by OD-01 and OD-04 (accepted). Implementation is in 04/09.

| ID | Requirement |
|---|---|
| AU-1 Authentication | Sign-in with a one-time code sent to the user's **email**. Phone/SMS codes are not in MVP. |
| AU-2 Code handling | Codes are single-use and expire. Repeated wrong attempts are limited. |
| AU-3 Session handling | A new session at every sign-in. Sessions expire and can be revoked by signing out. |
| AU-4 Case ownership | A case belongs to the user who created it. |
| AU-5 Authorization | Every access to a case or anything inside it requires a signed-in user who owns that case. Otherwise it behaves as if the case does not exist. |
| AU-6 Case isolation | No screen, export, search or AI request ever includes data from another case (NFR-08). |
| AU-7 Shared/family access | **Not in MVP** (OD-01). A family member helps on the victim's signed-in device, or creates their own case. |
| AU-8 Demo practice | Presenters sign in before the demo. The deployed product has **no** sign-in bypass. |

---

## 20. Privacy and Security Requirements

The detailed specification is in `09-SECURITY-PRIVACY-INTEGRITY.md`. Product-level requirements:

| ID | Area | Requirement | Source |
|---|---|---|---|
| SP-1 | Evidence confidentiality | Encrypted at rest and in transit. Private storage. Short-lived authorised access. | FR-005, NFR-01, OD-05 |
| SP-2 | Case isolation | Every query, view and AI request is scoped to one case. | NFR-08 |
| SP-3 | Access control | Owner-only access, enforced on the server. | NFR-01, OD-01 |
| SP-4 | Prompt-injection resistance | Evidence text is treated as data. Instructions in evidence never change behaviour, step choice or output structure. | GR-10, §16.1 |
| SP-5 | Auditability | Security- and case-relevant actions are logged (FR-023). Audit entries contain no content or PII. | NFR-03, OD-11 |
| SP-6 | Secure evidence storage | Evidence is off-chain. Only optional minimal integrity metadata on-chain. | §15, N5 |
| SP-7 | Deletion / retention | User-initiated hard delete. No auto-expiry in MVP. | FR-025, OD-11 |
| SP-8 | Data minimisation | Only what a step needs is sent to OCR/AI providers, for one case at a time. Provider data terms are considered when choosing providers (OD-02, OD-03). | §16.3 |
| SP-9 | Sensitive values | OTPs and full card numbers are never shown. Masked display by default in the graph and overview. | GR-09 |
| SP-10 | No sensitive data in logs | Evidence content and PII never appear in application logs or error messages. | §16.3 |
| SP-11 | Safe rendering | Extracted and pasted text is always displayed safely as untrusted content. | §16.3 |
| SP-12 | No official look | No government branding or styling that suggests official status. | §4.3 |
| SP-13 | AI over-reliance | Disclaimers, human review and links to official channels are present. | §16.1 |

---

## 21. Failure States

**Principle:** Proofline **fails visibly**. It never hides a failure behind plausible-looking output, never fabricates a value, and never presents fallback output as live. Every failure states what failed, keeps completed work, and offers a next step.

| Failure | Where it shows | User-visible behaviour | Recovery |
|---|---|---|---|
| **Upload failure** (transfer interrupted) | Evidence list | Item marked failed. No fingerprint shown. | Retry or remove |
| **Unsupported file** | Upload area | Rejected with the list of supported types. No item kept. | Upload a supported type |
| **Type mismatch** (content ≠ extension) | Upload area | Rejected with explanation. Stored bytes removed. | Upload the correct file |
| **Scanned PDF not processable** (if OD-03 excludes it) | Evidence list | "No readable text layer; upload a screenshot instead" | Remove; upload image |
| **OCR / parsing failure** | Evidence item + activity feed | Item `failed` with reason. No entities from it. Case stays below `EXTRACTED`. | Retry or remove item |
| **Extraction failure** | Activity feed | Extraction step failed. Run marked failed. | Retry |
| **No entities found** | Evidence item | "No key details found in this item". Not an error. Nothing invented. | Optional: add info via answers |
| **AI analysis failure** (classification, questions, summary) | Activity feed | Step failed. No label or text shown for it. | Retry. Disclosed fallback for synthetic set only. |
| **Invalid AI output** (fails structure or source validation) | Activity feed | Treated as step failure or rejected candidate. Never displayed. | Retry |
| **Timeline generation failure** | Timeline + feed | "Timeline not available — step failed". No partial timeline presented as complete. | Retry |
| **Report generation failure** | Report screen | Case stays `REPORT_DRAFT` with error. Earlier versions still viewable. | Retry |
| **Export failure** | Report screen | Error. No partial bundle offered. | Retry |
| **Integrity mismatch** | Verification screen | **Mismatch** with both hashes and explanation | Inspect; re-upload original if needed (new item, new fingerprint) |
| **Integrity check could not complete** | Verification screen | "Verification could not be completed". Not match, not mismatch. | Retry |
| **Attestation unavailable** (if built) | Verification screen | "Attestation unavailable". Hash verification still shown. | None needed |
| **Storage failure** | Wherever evidence is uploaded, previewed or exported | Explicit error. Nothing shown as uploaded or exported. | Retry |
| **Sign-in failure** (bad/expired code, email not delivered) | Sign-in screen | Clear message. New code can be requested. Attempts limited. | Request new code |
| **Deletion failure** | Case/evidence screen | Error. Deleted parts never reappear. | Retry |
| **Activity feed unreachable** | Activity screen | Connection message instead of a frozen "running" state | Automatic retry / reload |

The demo fallback (FR-027) may replace a failed live OCR/AI step **only** for the synthetic set, and is always labelled.

---

## 22. Acceptance Criteria

### 22.1 Primary end-to-end acceptance test (synthetic case)

Uses the synthetic KYC/UPI dataset: six artifacts, ₹8,500 loss (AD-03 list; exact contents per `13-SYNTHETIC-DATA-SPECIFICATION.md`).

```text
Create case
→ upload synthetic evidence
→ process evidence
→ extract entities
→ correlate evidence
→ generate timeline
→ identify missing information
→ generate actions
→ generate report
→ review
→ verify integrity
→ export
```

| ID | Step | Pass condition | FRs |
|---|---|---|---|
| AC-01 | Sign in | User signs in with an email code. Unauthenticated access to case data is refused. | FR-026 |
| AC-02 | Create case | Case created with minimal metadata. Reference shown. Status `NEW`. | FR-001 |
| AC-03 | Upload synthetic evidence | E01–E05 uploaded and E06 pasted. Each shows a SHA-256 fingerprint that matches an independent computation. Stored encrypted. | FR-002–FR-005 |
| AC-04 | Process evidence | Analysis starts without blocking. Plan and steps visible. "6/6 processed". | FR-006, FR-007, FR-024 |
| AC-05 | Extract entities | Phone, URL, UPI ID, UTR, amount and dates appear with provenance, confidence bands and masked display. > 95% accuracy on simple structured fields. | FR-008, FR-009 |
| AC-06 | View scam analysis | Primary `KYC_IMPERSONATION`; secondary `UPI_FRAUD`, `PHISHING`. Calibrated, cited explanation. | FR-010 |
| AC-07 | Correlate evidence | Graph shows phone → URL → UPI ID → transaction across artifacts. Clicking a node shows its source. | FR-011 |
| AC-08 | Generate timeline | Expected sequence with > 90% correctly ordered. User corrects one event, and the correction persists and is marked. | FR-012, FR-013 |
| AC-09 | Identify missing information | Bank name shown as "Not provided". Payment-time contradiction shown with both sources. Targeted question answered and stored as a user statement. | FR-014, FR-015 |
| AC-10 | Generate actions | Checklist includes contact bank, report via 1930/NCRP, preserve evidence, each with reasons and curated channels. | FR-016 |
| AC-11 | Generate report | Draft with all §16 sections and evidence index. 100% key-fact provenance. "Not provided" where missing. Disclaimer present. Case `USER_REVIEW`. | FR-017, FR-018 |
| AC-12 | Review | Review screen shows key, uncertain and missing information. User confirms version N, and the indicator shows "Reviewed – version N". | FR-019 |
| AC-13 | Verify integrity | Each untouched item returns **match**. The screen explains what this proves and does not prove. | FR-021 |
| AC-14 | Export | PDF and ZIP bundle download. Manifest hashes match. Status `EXPORTED`. Audit log shows the full sequence. | FR-020, FR-023 |
| AC-15 | Timing | Upload to usable draft < 2 minutes in the demo environment | NFR-06 |

### 22.2 Additional MVP acceptance criteria

| ID | Criterion | Requirement |
|---|---|---|
| AC-16 | With external OCR/AI unavailable, the synthetic flow still completes, with the fallback disclosed in the feed and audit. | FR-027 |
| AC-17 | A non-synthetic file with services unavailable fails visibly and receives no cached output. | FR-027 |
| AC-18 | A deliberately modified copy of an artifact returns **mismatch**. | FR-021 |
| AC-19 | An AI-proposed identifier not present in source text (fault injection) is rejected and appears nowhere. | FR-008, GR-01–GR-04 |
| AC-20 | Evidence containing an embedded instruction, e.g., "ignore previous instructions", does not change steps, outputs or output structure. | GR-10 |
| AC-21 | A second user cannot list, open, download or export the first user's case or evidence. | AU-5, NFR-08 |
| AC-22 | No demo output contains "confirmed fraud", names a suspect as the fraudster, shows an OTP or full card number, or shows an AI-generated official channel. | GR-08, GR-09, GR-12, GR-14 |
| AC-23 | Export is impossible without confirmation of the current version, and regeneration voids a prior confirmation. | FR-019 |
| AC-24 | Deleting an evidence item removes it and its dependent derived data, invalidates reports, and leaves an audit tombstone. Deleting a case removes everything. | FR-025 |
| AC-25 | No audit entry or application log contains evidence text, filenames or identifier values. | FR-023, SP-10 |
| AC-26 | A pasted URL is never fetched. | FR-003 |
| AC-27 | A failed step shows its failure with Retry, and Retry resumes without redoing completed steps. | FR-006, §21 |
| AC-28 | If attestation is built (OD-06): the end-to-end flow completes with the ledger unreachable, and only hash, timestamp and opaque reference are on-chain. | FR-022 |

---

## 23. MVP vs Future

| Capability | MVP | Future | Notes |
|---|:---:|:---:|---|
| Screenshot ingestion (PNG/JPG) | ✅ | | |
| PDF ingestion (text layer) | ✅ | | |
| Scanned (image-only) PDF processing | ❓ | | Depends on OD-03 (open). Never silent (EV-8). |
| Pasted text / pasted URL | ✅ | | URLs never fetched |
| TXT and email-export upload | ✅ | | Format per G-4. Mailbox connectors are future. |
| OCR / document extraction | ✅ | | AI is never the OCR source |
| Entity extraction with provenance | ✅ | | |
| Entity normalisation and masking | ✅ | | |
| Scam taxonomy classification | ✅ | | Fixed 9-label taxonomy (AD-01) |
| Evidence-backed explanation | ✅ | | Calibrated language |
| Timeline reconstruction with user correction | ✅ | | |
| Evidence graph | ✅ | | |
| Missing / contradictory information detection | ✅ | | |
| Targeted follow-up questions | ✅ | | High-value only |
| Immediate action checklist | ✅ | | Curated official channels |
| Complaint draft | ✅ | | AD-04 structure |
| Evidence index | ✅ | | |
| User review gate before export | ✅ | | R-1 semantics |
| Export: PDF + ZIP bundle | ✅ | | OD-07 |
| SHA-256 fingerprinting and verification | ✅ | | |
| Blockchain/testnet hash attestation | ⚪ Optional | | OD-06. Default off. Build/skip open. |
| Audit log | ✅ | | |
| Agent activity view | ✅ | | Polling by default (OD-10) |
| Case and evidence deletion (hard delete) | ✅ | | OD-11 |
| Automatic retention expiry | | ✅ | OD-11: none in MVP |
| Email one-time-code sign-in | ✅ | | OD-04 |
| Phone/SMS one-time-code sign-in | | ✅ | Not in MVP (OD-04) |
| Single-owner cases | ✅ | | OD-01 |
| Shared / family multi-user case access | | ✅ | OD-01 |
| Application-level (envelope) encryption | | ✅ | OD-05. Provider-managed encryption in MVP. |
| Synthetic demo data + disclosed fallback | ✅ | | |
| English UI | ✅ | | |
| Speech-to-text caller summary | ⚪ Optional | | OD-08. Excluded by default. |
| Identity-document upload | ❌ | | OD-09. Default not accepted. |
| Secondary chat/Q&A surface | ⚪ Optional | | Spec §7. Not required. |
| Email connectors / mailbox ingestion | | ✅ | |
| Specialised multimodal model ensemble | | ✅ | |
| Continuous threat-intelligence enrichment / live URL inspection | | ✅ | |
| Advanced temporal reasoning and graph analytics | | ✅ | |
| Cross-case campaign clustering | | ✅ | |
| Bank / call-centre integrations | | ✅ | |
| Enterprise notarisation / policy-controlled integrity | | ✅ | |
| Organisation features (seats, SSO, tenancy) | | ✅ | Personas 3–5 |
| Pilot deployments with consented real cases | | ✅ | |
| Multilingual Indian-language workflows | | ✅ | |

Legend: ✅ in scope · ⚪ optional · ❓ depends on open decision · ❌ excluded.

---

## 24. Traceability Matrix

### 24.1 Functional requirements

| Requirement | Master Spec section | Decision dependency | Future technical document(s) |
|---|---|---|---|
| FR-001 Case Creation | §8 FR-001, §6.2, §17 | OD-01 | 03, 05, 10 |
| FR-002 Evidence File Upload | §8 FR-002, §7, §8.1 | OD-14, OD-03 (scanned PDF), G-4, OD-09 | 04, 05, 07, 10 |
| FR-003 Pasted Text / URL | §8 FR-003, FR-008 note | G-3 | 05, 07 |
| FR-004 Fingerprinting | §8 FR-004, §15 | OD-14, G-3 | 07, 09 |
| FR-005 Encrypted Storage | §8 FR-005, §16.2 | OD-05, OD-14, OD-16 | 04, 09 |
| FR-006 Analysis Orchestration | §8 FR-006, §6.4, §10 | OD-12, OD-15, AD-05 | 04, 06 |
| FR-007 OCR / Parsing | §8 FR-007, §6.2 | OD-03 | 04, 07 |
| FR-008 Entity Extraction | §8 FR-008, §8.1, §11, §12.2 | OD-02, AD-02 | 06, 07 |
| FR-009 Normalisation & Masking | §8 FR-009, §12.3, GR-09 | — | 03, 07 |
| FR-010 Scam Pattern Analysis | §8 FR-010, §10.4 | AD-01 | 03, 06 |
| FR-011 Correlation & Graph | §8 FR-011, §13 | G-6 | 03, 08, 10 |
| FR-012 Timeline | §8 FR-012, §14 | G-5, G-6 | 03, 08 |
| FR-013 User Corrections | §8 FR-013, §14.2 | AD-02, AD-05 | 03, 05, 08, 10 |
| FR-014 Missing & Contradictory | §8 FR-014, §3.4 | AD-01, OD-09 | 06 |
| FR-015 Follow-up Questions | §8 FR-015 | AD-02, AD-05 | 05, 06, 10 |
| FR-016 Action Checklist | §8 FR-016, GR-14 | AD-01, G-2 | 06, 10 |
| FR-017 Complaint Draft | §8 FR-017, GR-06/07 | AD-04, OD-07 | 03, 05, 06 |
| FR-018 Evidence Index | §8 FR-018 | AD-04 | 05, 09 |
| FR-019 User Review Gate | §8 FR-019, §6.4 | AD-05, R-1 | 03, 05, 10 |
| FR-020 Export | §8 FR-020 | OD-07 | 04, 05 |
| FR-021 Integrity Verification | §8 FR-021, §15 | OD-06 | 05, 09 |
| FR-022 Blockchain Attestation (O) | §8 FR-022, §15.2 | OD-06 | 04, 09 |
| FR-023 Audit Log | §8 FR-023, §16.2 | OD-11 | 03, 09 |
| FR-024 Agent Activity View | §8 FR-024 | OD-10, OD-12 | 05, 06, 10 |
| FR-025 Deletion | §8 FR-025, NFR-09 | OD-11 | 03, 05, 09 |
| FR-026 Authentication | §8 FR-026, §16.1 | OD-04 | 03, 04, 05, 09 |
| FR-027 Demo Dataset & Fallback | §8 FR-027, §22 | AD-03, AD-06 | 04, 12, 13, 15 |
| FR-028 Speech-to-Text (O) | §8 FR-028 | OD-08 | — (only if built) |

Document key: 03 Database Schema · 04 Technical Architecture · 05 API Specification · 06 AI Agent Specification · 07 Evidence Processing Pipeline · 08 Evidence Graph & Timeline · 09 Security, Privacy & Integrity · 10 Frontend UX · 12 Demo Scenario · 13 Synthetic Data · 15 Testing Strategy.

### 24.2 Non-functional requirements

| Requirement | Master Spec section | Decision dependency | Future technical document(s) |
|---|---|---|---|
| NFR-01 Security | §9, §16 | OD-04, OD-05 | 04, 09 |
| NFR-02 Privacy | §9, §16.2 | OD-06, OD-09 | 09 |
| NFR-03 Auditability | §9 | OD-11 | 03, 09 |
| NFR-04 Traceability | §9, §12.2 | AD-02 | 03, 06, 10 |
| NFR-05 Reliability | §9, §18.3 | OD-12, OD-15, AD-06 | 04, 15 |
| NFR-06 Performance | §9, §23 | OD-16 | 04, 15 |
| NFR-07 Explainability | §9, §16.4 | AD-01, AD-02 | 06, 10 |
| NFR-08 Case isolation | §9, §16.1 | OD-01 | 04, 06, 09 |
| NFR-09 Retention & deletion | §9 | OD-11 | 03, 09 |
| NFR-10 Human review | §9 | AD-05, R-1 | 10 |
| NFR-11 Determinism of extraction | §9, §11 | OD-02, OD-03 | 06, 07 |
| NFR-12 Usability | §9, §21 | G-2 | 10, 11 |

### 24.3 Cross-cutting rules

| Rule set | Master Spec section | Decision dependency | Future technical document(s) |
|---|---|---|---|
| Guardrails GR-01–GR-15 (§10, §11, §15, §16 of this PRD) | §11 | OD-02, AD-02 | 06, 15 |
| Case states S-1–S-6 | §6.4 | AD-05, R-1 | 03, 04 |
| Evidence rules EV-1–EV-9 | §7, §8 | OD-03, G-3, G-4 | 07 |
| Report sections RP-1–RP-7 | FR-017 | AD-04 | 06, 10 |

---

## 25. Open Dependencies

Only unresolved items that still affect product requirements are listed. Decisions accepted in `DECISIONS.md`, and R-1/R-2 above, are **not** re-opened.

- **BLOCKING:** product behaviour is undefined until resolved. Must be decided before the named step.
- **DEFERRED:** has a default. This PRD specifies behaviour under that default.
- **IMPLEMENTATION DETAIL:** product behaviour is fully defined here. Only the mechanism or value is open.

| ID | Open item | Class | Effect on this PRD | Resolve before |
|---|---|---|---|---|
| OD-03 (scope) | Are scanned (image-only) PDFs processed? | **BLOCKING** | Selects EV-8 (a) or (b) | `07-EVIDENCE-PROCESSING-PIPELINE.md` and PDF ingestion work |
| AD-03 (contents) | Exact story, names and values of the six synthetic artifacts | **BLOCKING** | Benchmark values, AC-05–AC-10 expected results, fallback set | `13-SYNTHETIC-DATA-SPECIFICATION.md`, OCR spike |
| G-2 | How case-level "urgency" is derived for the Incident Overview | **BLOCKING** | Overview urgency indicator (AC-R3) | `10-FRONTEND-UX-SPECIFICATION.md` |
| G-4 | File size/count limits; accepted email-export format(s) | **BLOCKING** | Upload validation messages (FR-002, §8.1) | `05-API-SPECIFICATION.md`, `07-…` |
| OD-06 | Build blockchain attestation? (depends on claimed hackathon theme) | **DEFERRED** (default: not built) | FR-022, AC-28 apply only if built | Go/no-go 2026-10-06 |
| OD-08 | Speech-to-text caller summary | **DEFERRED** (default: excluded) | FR-028 applies only if built | Only if DoD passes |
| OD-09 | Identity-document uploads | **DEFERRED** (default: not accepted) | "Keep ready" reminder only | Post-hackathon |
| OD-10 | Progress delivery mechanism | **DEFERRED** (default: polling) | None beyond FR-024 | Any time |
| OD-13 | PostgreSQL hosting | **DEFERRED** | None | Before first deploy |
| OD-02 (vendor) | LLM vendor/model | **IMPLEMENTATION DETAIL** | None; contract fixed | Before adapter coding |
| OD-03 (engine) | OCR engine after spike | **IMPLEMENTATION DETAIL** | None if > 95% target met | After spike |
| OD-04 (vendor) | Email delivery service | **IMPLEMENTATION DETAIL** | None | Before first deploy |
| OD-14 / OD-16 (vendors) | Storage and hosting vendors | **IMPLEMENTATION DETAIL** | None | Before first deploy |
| G-3 | Canonical byte representation of pasted text | **IMPLEMENTATION DETAIL** | Must be fixed and documented (FR-003/FR-004) | `07-…` |
| G-5 | Exact time-zone handling (IST default) | **IMPLEMENTATION DETAIL** | None | `03-DATABASE-SCHEMA.md` |
| G-6 | Relationship and timeline event-type vocabularies | **IMPLEMENTATION DETAIL** | None | `03-…`, `08-…` |
| — | Case reference format; confidence band thresholds; action priority scale; per-incident checklist detail; normalisation rules | **IMPLEMENTATION DETAIL** | None | 03, 06, 07 |

**Recording follow-ups (no product effect):** R-1 (`USER_REVIEW` meaning) and R-2 (document numbering) should later be recorded in `DECISIONS.md`, and the Master Spec §27 should point to `DECISIONS.md`. Neither file is modified by this PRD.

---

## 26. Definition of Done (for this PRD)

| # | Criterion | Where satisfied |
|---|---|---|
| 1 | All 28 FRs are represented | §7 (FR-001 – FR-028), §24.1 |
| 2 | All 12 NFRs relevant to product behaviour are represented | §3.1, §24.2 |
| 3 | The MVP boundary is explicit | §4, §23 |
| 4 | The complete user journey is defined | §6 |
| 5 | Failure states are defined | §21, plus Failure Behavior in each FR |
| 6 | Human review is explicit | FR-019, §13.8, §18 |
| 7 | Provenance is explicit | FR-008, §10.3, §16.2, NFR-04 |
| 8 | Evidence integrity is explicit | FR-004, FR-021, §17 |
| 9 | Unresolved decisions are referenced | `Dependency:` lines, §25 |
| 10 | No unsupported product capabilities were added | §23 contains only Master Spec capabilities and accepted decisions. Additions are limited to resolved behaviour of existing requirements: R-1, the "could not complete" verification error state, and user-visible deletion and fallback rules from OD-11 and AD-06. |
