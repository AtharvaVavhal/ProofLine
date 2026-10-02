# Proofline — API Specification

> **Trace the Evidence. Build the Case.**

| Field | Value |
|---|---|
| Product | **Proofline** |
| Document | API Specification (HTTP contract) |
| File | `docs/05-API-SPECIFICATION.md` |
| Version | 1.0 |
| Status | Hackathon MVP. Contract specification only. No code, OpenAPI files, DTOs or tests. |
| Last updated | 2026-10-02 |
| Sources (authoritative) | `01-PROOFLINE-MASTER-SPEC.md` v1.0 · `02-PRODUCT-REQUIREMENTS.md` v1.0 · `DECISIONS.md` v0.2 · `03-DATABASE-SCHEMA.md` v1.1 · `04-TECHNICAL-ARCHITECTURE.md` v1.1 |
| Precedence | `DECISIONS.md` §7–§8 → 03 (persistence) → 04 (architecture) → PRD → Master Spec |

### Labels used in this document

| Label | Meaning |
|---|---|
| **[SPEC-ENDPOINT]** | An endpoint listed in Master Spec §20. Its path and method are preserved exactly. |
| **[REQUIRED-ADDITIONAL]** | An endpoint needed by the Master Spec §20 "TO BE DEFINED" list, a PRD requirement or a resolved decision. The source is cited. |
| **[API-REC]** | A contract detail chosen here (field names, codes, pagination) that adds no product behaviour. |
| **[IMPL]** | A configurable value, not fixed by this contract. |

### Notes on the request that produced this document

- **N-1. Export path.** The request listed `POST /cases/:id/report/export` as an established endpoint. **No source document contains that path.** Master Spec §20 defines **`POST /cases/:id/report`** (generate a report version) and **`POST /cases/:id/export`** (export). Both are preserved unchanged. No alias is added (§6.3).
- **N-2. Multipart upload.** The request asked for a multipart evidence upload. Master Spec FR-002 ("signed upload URLs per source §15") and Document 04 §7 ("the API never receives file bytes") specify **signed-URL upload**. This contract follows the sources: files are registered with JSON, PUT directly to storage, then completed. Pasted text is sent as JSON (§8). **No multipart endpoint exists.**
- **N-3. Gap in Document 03.** `analysis_runs` and `agent_steps` are referenced throughout Documents 03 and 04 (status, plan, trigger, kind, fallback flag, step name, idempotency key, failure code, retryable flag, metrics), but Document 03 has **no field table** for them. This API uses only those referenced attributes. Adding the field tables to Document 03 is a follow-up (§36). It does not block this contract.

---

## 1. Purpose and API Boundary

| Aspect | Definition |
|---|---|
| Purpose | The HTTP contract between the Proofline web app and the NestJS API. It exposes **product use cases** (spec §20, PRD §6), not database tables. |
| Intended client | The first-party **Next.js web app** only (Document 04 §6). No third-party or partner API exists (spec §24 item 10). |
| Base path | Browser-facing base: **`/api`** on the web origin. The Next.js rewrite forwards `/api/*` to the API (OD-04, OD-16). All paths below are relative to `/api` (e.g., `POST /api/cases`). |
| Versioning | Unversioned paths for the MVP (§34) |
| Format | JSON (UTF-8). There are no multipart endpoints (N-2). |
| Authentication boundary | An httpOnly session cookie set by the auth endpoints (OD-04). Every endpoint except the three auth endpoints requires a valid session. |
| Authorisation boundary | Case ownership, checked server-side for every case- or evidence-scoped request (§4) |
| PostgreSQL | Reached only through API services. No endpoint exposes queries, IDs other than UUIDs, or table structure. |
| Object storage | Bytes move only between browser and storage via **short-lived signed URLs** issued by the API after ownership checks (FR-005, OD-14) |
| AI / processing | Internal. Started by `POST /cases/:id/analyze` and `POST /cases/:id/report`. Observed via the activity endpoint. **No endpoint exposes the LLM, OCR, parsers, orchestrator steps or the urgency engine directly.** |

| Endpoint class | Endpoints |
|---|---|
| Unauthenticated | `POST /auth/request-code`, `POST /auth/verify-code` |
| Authenticated | All others |
| **Not exposed (internal operations)** | Parsing/OCR, extraction, literal validation, entity resolution, correlation, scam analysis, timeline generation, findings evaluation, urgency computation, action generation, report snapshot/PDF rendering, export bundling, audit writes, object deletion, cleanup jobs, the pg-boss queue |

---

## 2. API Design Principles

| # | Principle | Contract consequence |
|---|---|---|
| A1 | Resource ownership | Every case-scoped resource resolves to exactly one case and its owner |
| A2 | Case isolation | No endpoint returns data from more than one case, except `GET /cases` (the user's own cases, metadata only) (NFR-08) |
| A3 | Explicit authorisation | An unowned or non-existent case or evidence item returns **404** (AU-5: "behaves as if the case does not exist") |
| A4 | Predictable HTTP semantics | GET is safe (audited reads excepted, §22). POST starts actions. PATCH updates user-editable fields. DELETE removes. |
| A5 | Structured errors | One error envelope with stable codes (§5) |
| A6 | Idempotency | Natural idempotency via database invariants (§24) |
| A7 | Provenance preservation | Every fact in a response carries `sources: SourceRef[]` (NFR-04, GR-06) |
| A8 | Server-side validation | Client checks are advisory. The server is authoritative (G-4). |
| A9 | Deterministic business rules | Urgency, actions, checklists and state transitions come from the server and are never computed by the client |
| A10 | No client trust | Fingerprints, owners, states, versions and checksums are never accepted from the client as truth. Client-supplied versions and checksums are only **compared** with server values. |
| A11 | No raw evidence exposure | Evidence bytes only via signed URLs. Redacted source text only via the source endpoint. Nothing in audit responses. |
| A12 | Use-case driven | No generic CRUD over tables (§6) |

---

## 3. API Conventions

| Topic | Convention |
|---|---|
| Request content type | `application/json` for all bodies. Evidence file bytes go to storage via a signed `PUT` with the file's own content type (§8). |
| Response content type | `application/json` (`204 No Content` has no body). All responses carry `Cache-Control: no-store`. |
| Field naming [API-REC] | **camelCase** JSON keys. Shared zod schemas live in `packages/shared` (AD-06). |
| Enums | **Exactly** the enum values of Document 03 §4.1, as UPPER_SNAKE strings (e.g., `USER_REVIEW`, `KYC_IMPERSONATION`, `PDF_NO_TEXT_LAYER`) |
| IDs | UUID strings (`gen_random_uuid()`, schema §2). Human-readable references are separate fields: `caseReference` (e.g., `CF-10001`) and `evidenceRef` (`E01`–`E20`). |
| Case reference | Server-generated: `CF-` + a sequence number starting at **10001** (schema §5.1). It is never accepted from the client. |
| Timestamps | ISO 8601 **UTC** with `Z` (e.g., `2026-09-24T06:49:00Z`). Stored in UTC (G-5). **The client displays them in IST (Asia/Kolkata).** Incident event times also carry `precision` and `timeSourceText` (the original text, e.g. `"Around 12:05 PM"`). |
| Nullable values | Absent product values are `null` (not omitted) in typed responses. "Not provided" is a **presentation** of `null` in report content, not a magic string in data fields. |
| Money | `{ "amountMinor": 850000, "currency": "INR" }` (paise) |
| Confidence | **Bands only** (`HIGH` / `MEDIUM` / `LOW`). Numeric confidence is never returned (AD-02). |
| Booleans | `true` / `false` only |
| Request size | JSON bodies ≤ 64 KB, except pasted evidence (≤ 20,000 characters of content) [IMPL] |
| Request ID | Every response carries an `X-Request-Id` header. Errors include `requestId` (§5). |

### 3.1 Shared object: `SourceRef` (provenance; AD-02)

```json
{
  "kind": "EXTRACTION | EVIDENCE | USER_STATEMENT",
  "id": "uuid of the extraction, evidence item or user statement",
  "evidenceId": "uuid | null",
  "evidenceRef": "E04 | null",
  "location": { "pageNumber": 1, "lineNumbers": [4], "headerName": null } ,
  "snippet": "redacted source text | null",
  "statementText": "user's words (USER_STATEMENT only) | null"
}
```

- `location` is `null` for `USER_STATEMENT` refs.
- `snippet` comes from stored, **already-redacted** text (schema §9.6).
- User statements are labelled by `kind`, so the UI can render "You stated…" (FR-015).

---

## 4. Authentication and Authorisation

### 4.1 Mechanism [RESOLVED OD-04]

- Email one-time code → opaque session token in an **httpOnly, Secure, SameSite=Lax** cookie, delivered first-party through the `/api` rewrite.
- Sessions expire and can be revoked. Every login creates a new session.
- There is no bearer-token, API-key, SSO or phone login.

### 4.2 Request checks (every authenticated endpoint)

1. **AuthGuard:** a valid, unexpired, unrevoked session is required, else `401 UNAUTHENTICATED`.
2. **Origin check** on POST/PATCH/DELETE, else `403 ORIGIN_NOT_ALLOWED` (CSRF defence).
3. **CaseGuard:**
   - Case-scoped routes load `cases.user_id` by `:id`.
   - Evidence-scoped routes (`/evidence/:id/...`) resolve evidence → case → owner.
   - Nested IDs (extraction, event, finding, action, report version, export) must belong to that case.
   - Any mismatch or non-existence returns **`404 NOT_FOUND`**. The response never reveals whether another user's resource exists.
4. Ownership is the only authorisation rule. There is no sharing and no roles (OD-01).

**Isolation guarantee:** a request by User A for Case B, Evidence B or any child of Case B returns **404**, whatever the IDs supplied. This is enforced in the API (guard) and in the database (composite case FKs, schema §20).

### 4.3 Per-endpoint auth summary

Every endpoint in §6 states its auth requirement. "Owner" means the authenticated user must own the case that the resource resolves to.

---

## 5. Standard Error Contract

```json
{
  "error": {
    "code": "PDF_TOO_MANY_PAGES",
    "message": "This PDF has more than 20 pages. Upload up to 20 pages.",
    "requestId": "req_7f3c…",
    "fieldErrors": [ { "field": "byteSize", "code": "TOO_LARGE" } ],
    "details": { "limit": 20 }
  }
}
```

| Field | Rule |
|---|---|
| `code` | Stable UPPER_SNAKE code from the catalogue below (and `upload_rejection_code` / `evidence_failure_code` values from schema §4.1) |
| `message` | Safe, user-presentable English text. **Never** contains evidence content, extracted values, SQL, stack traces, provider names/errors or secrets. |
| `requestId` | Correlates with logs and audit (`request_id`) |
| `fieldErrors` | Optional. Validation errors per input field. |
| `details` | Optional. Whitelisted, non-sensitive values (limits, current state, current version). |

### 5.1 Status usage

| Status | Use |
|---|---|
| 400 `VALIDATION_FAILED` | Malformed JSON, schema violations, unknown fields |
| 401 `UNAUTHENTICATED` | No or invalid session |
| 403 `ORIGIN_NOT_ALLOWED` | CSRF/Origin check failed. (Ownership failures are **404**, not 403.) |
| 404 `NOT_FOUND` | Missing **or unowned** resource |
| 409 `INVALID_CASE_STATE`, `ANALYSIS_IN_PROGRESS`, `REPORT_NOT_CURRENT`, `REPORT_CHECKSUM_MISMATCH`, `REPORT_NOT_CONFIRMED`, `CONFIRMATION_VERSION_MISMATCH`, `TOO_MANY_ITEMS`, `EVIDENCE_NOT_UPLOADED`, `EVIDENCE_NOT_RETRYABLE` | State conflicts and invariant violations (§25, §31) |
| 413 `FILE_TOO_LARGE`, `TEXT_TOO_LONG` | Size limits (G-4) |
| 415 `TYPE_NOT_SUPPORTED`, `CONTENT_TYPE_MISMATCH`, `EMAIL_FORMAT_NOT_SUPPORTED` | Unsupported or mismatched content type (G-4) |
| 422 `EMPTY_FILE`, `PDF_TOO_MANY_PAGES`, `PDF_ENCRYPTED`, `IMAGE_TOO_LARGE`, `TEXT_NOT_UTF8`, `INVALID_CODE`, `CODE_EXPIRED`, `NOT_A_URL` | Well-formed request, semantically unacceptable content |
| 429 `RATE_LIMITED` | With a `Retry-After` header (§27) |
| 500 `INTERNAL_ERROR` | Unexpected application failure, including a failed audit write (the action is rolled back, FR-023) |
| 502 `PROVIDER_ERROR` | A **synchronous** call to an external provider failed (email send; storage during signed-URL issue, confirmation, verification read) |
| 503 `SERVICE_UNAVAILABLE` | Dependency temporarily unavailable (DB/storage). `Retry-After` when known. |

Asynchronous failures (OCR, LLM, report rendering) are **not** HTTP errors. They appear as `FAILED` runs, steps, items or report versions in normal responses (§9, §11).

---

## 6. API Endpoint Inventory

### 6.1 Master Spec §20 endpoints (preserved exactly) [SPEC-ENDPOINT]

| # | Method | Endpoint | Purpose | Auth | Requirement |
|---|---|---|---|---|---|
| 1 | POST | `/cases` | Create a case | User | FR-001 |
| 2 | GET | `/cases/:id` | Case summary: status, metadata, scam signals, counts (+ urgency, run and report state) | Owner | FR-001, FR-010, G-2 |
| 3 | POST | `/cases/:id/evidence` | Register evidence: file (returns signed upload URL) or pasted text/URL | Owner | FR-002–FR-005 |
| 4 | POST | `/cases/:id/analyze` | Start (or retry/resume) the analysis run | Owner | FR-006 |
| 5 | GET | `/cases/:id/entities` | Entities with provenance | Owner | FR-008, FR-009 |
| 6 | GET | `/cases/:id/timeline` | Timeline events | Owner | FR-012 |
| 7 | GET | `/cases/:id/graph` | Evidence graph | Owner | FR-011 |
| 8 | GET | `/cases/:id/actions` | Action checklist | Owner | FR-016 |
| 9 | POST | `/cases/:id/report` | Generate a new report version | Owner | FR-017, FR-018 |
| 10 | POST | `/cases/:id/export` | Export a confirmed report version | Owner | FR-019, FR-020 |
| 11 | POST | `/evidence/:id/verify` | Verify an evidence item's integrity | Owner | FR-021, FR-022 |

### 6.2 Additional endpoints, each required by a cited source [REQUIRED-ADDITIONAL]

| # | Method | Endpoint | Purpose | Auth | Required by |
|---|---|---|---|---|---|
| 12 | POST | `/auth/request-code` | Request a sign-in code | None | Spec §20 list ("request OTP"); FR-026 |
| 13 | POST | `/auth/verify-code` | Verify the code and start a session | None | Spec §20 list ("verify OTP"); FR-026 |
| 14 | POST | `/auth/logout` | End the session | User | Spec §20 list ("logout"); AU-3 |
| 15 | GET | `/cases` | List the user's cases | User | Spec §20 list ("List the user's cases") |
| 16 | PATCH | `/cases/:id` | Add or edit case metadata | Owner | PRD FR-001 ("fields can be added or edited later") |
| 17 | DELETE | `/cases/:id` | Delete a case | Owner | Spec §20 list; FR-025 |
| 18 | POST | `/evidence/:id/complete` | Confirm an upload: validate, hash, accept or reject | Owner | OD-14 (step 3); FR-002, FR-004 |
| 19 | GET | `/cases/:id/evidence` | List evidence with status, fingerprint and integrity status | Owner | Spec §20 list ("List evidence in a case"); FR-018 |
| 20 | GET | `/evidence/:id/source` | Parsed, redacted source text with locations | Owner | PRD P-6, P-9 ("source text … viewable per item"; inspect source) |
| 21 | GET | `/evidence/:id/download` | Short-lived signed URL for the original | Owner | Spec §20 list ("Get or download one evidence item (signed URL)"); FR-005 |
| 22 | DELETE | `/evidence/:id` | Delete an evidence item | Owner | Spec §20 list; FR-025 |
| 23 | GET | `/cases/:id/activity` | Agent activity / run status feed (polling) | Owner | Spec §20 list; FR-024; OD-10 |
| 24 | POST | `/cases/:id/extractions/:extractionId/correction` | Correct an extracted value | Owner | Spec §20 list ("correct an extraction or entity"); FR-013 |
| 25 | POST | `/cases/:id/timeline` | Add a user event | Owner | Spec §20 list ("add a user event"); FR-013 |
| 26 | PATCH | `/cases/:id/timeline/:eventId` | Correct a timeline event | Owner | Spec §20 list ("update a timeline event"); FR-013 |
| 27 | POST | `/cases/:id/timeline/:eventId/dismiss` | Dismiss an incorrect event | Owner | PRD TL-6 |
| 28 | GET | `/cases/:id/missing-information` | Missing items, contradictions, questions | Owner | Spec §20 list; FR-014, FR-015 |
| 29 | POST | `/cases/:id/missing-information/:itemId/answer` | Answer a question | Owner | Spec §20 list ("submit answers"); FR-015 |
| 30 | POST | `/cases/:id/missing-information/:itemId/skip` | Skip a question | Owner | PRD FR-015 validation ("user may skip"); MI-6 |
| 31 | PATCH | `/cases/:id/actions/:actionId` | Update action status | Owner | Spec §20 list; FR-016 |
| 32 | GET | `/cases/:id/reports` | List report versions | Owner | Spec §20 list ("Get report versions") |
| 33 | GET | `/cases/:id/reports/:version` | Get one version's content for review | Owner | FR-017, FR-019 (review) |
| 34 | POST | `/cases/:id/reports/:version/confirm` | Confirm a specific version (checksum-bound) | Owner | Spec §20 list ("Review confirmation for a report version"); FR-019; R-1 |
| 35 | GET | `/cases/:id/exports/:exportId` | Export status | Owner | FR-020 (export is generated asynchronously; Document 04 §18) |
| 36 | GET | `/cases/:id/exports/:exportId/download` | Short-lived signed URL for a ready export | Owner | Spec §20 list ("download export"); FR-020 |
| 37 | GET | `/cases/:id/audit-log` | Case audit log | Owner | Spec §20 list ("Audit log for a case"); FR-023 |

**Total: 37 endpoints** (11 spec + 26 required additional).

### 6.3 Intentionally not provided

| Not provided | Reason |
|---|---|
| `POST /cases/:id/report/export` | Not in any source (N-1). Export is `POST /cases/:id/export`. |
| Multipart upload | Contradicts FR-002 / OD-14 / Document 04 (N-2) |
| `GET /cases/:id/urgency` | Urgency is part of `GET /cases/:id` (spec §21.1 overview). No separate endpoint is needed. |
| `GET /cases/:id/scam-analysis` | Scam signals are part of `GET /cases/:id` (spec §20: "scam signals") |
| Evidence retry endpoint | Retry = `POST /cases/:id/analyze` (resumes the failed step and includes retryable `FAILED` items; AD-05). **No retry exists for `PDF_NO_TEXT_LAYER`** (OD-03). |
| Entity/relationship/source-line CRUD | Internal. Entity correction is done by correcting its supporting extraction (#24). |
| Audit write endpoint | Audit writes are internal (Document 04 §20) |
| WebSocket / SSE | Polling is the resolved default (OD-10) |
| Account, profile, sharing, payments | Not in scope (OD-01, N16) |
| Blockchain endpoints | Deferred (OD-06). Attestation would appear only as fields inside the verify response. |

---

## 7. Case API

### 7.1 `POST /cases` [SPEC-ENDPOINT #1]

| Item | Contract |
|---|---|
| Auth | Authenticated user. The new case is owned by that user (OD-01). |
| Body (all optional) | `incidentTime` (ISO UTC \| null), `incidentTimePrecision` (`EXACT`\|`APPROXIMATE`\|`UNKNOWN` \| null), `contact` (≤ 200 chars), `location` (≤ 200), `summary` (≤ 2000, the **user's own description**) |
| Validation | `incidentTimePrecision` is required when `incidentTime` is given. `UNKNOWN` requires `incidentTime: null`. Lengths as above. Unknown fields → 400. **`userId`, `caseReference` and `status` are never accepted.** |
| Behaviour | One transaction: case `NEW` + server-generated `caseReference` + `CASE_METADATA` user statements for provided values + audit `CASE_CREATED` |
| Response | `201` with the Case object (§7.3) |
| Errors | 400, 401, 403, 429 |

`summary` is the user's description (schema §5.4). **No AI process writes it.** The AI incident summary appears only in report content (§18).

`contact` is stored as entered. It is **not used** for messaging, notifications, authentication, matching or inference (schema §5.5).

### 7.2 `GET /cases/:id` [SPEC-ENDPOINT #2]

| Item | Contract |
|---|---|
| Auth | Owner (404 otherwise) |
| Response | `200` Case object (§7.3) |
| Excludes | Evidence content, source text, extraction values, report content |

### 7.3 Case object

```json
{
  "id": "uuid",
  "caseReference": "CF-10001",
  "status": "ACTIONS_READY",
  "statusChangedAt": "…Z",
  "incidentTime": null,
  "incidentTimePrecision": null,
  "contact": null,
  "location": null,
  "summary": "string | null",
  "incidentType": "KYC_IMPERSONATION | null",
  "financialLossReported": true,
  "evidence": { "total": 6, "byStatus": { "UPLOADING": 0, "UPLOADED": 0, "PROCESSING": 0, "PROCESSED": 6, "FAILED": 0 } },
  "latestRun": { "id": "uuid", "kind": "ANALYSIS", "status": "SUCCEEDED", "failedStep": null, "fallbackUsed": false } ,
  "scamSignals": [ { "label": "KYC_IMPERSONATION", "isPrimary": true, "confidenceBand": "HIGH", "explanation": "…", "sources": [ "SourceRef…" ] } ],
  "urgency": {
    "assessed": true,
    "level": "HIGH",
    "outOfDate": false,
    "ruleVersion": "G2-v1",
    "explanation": "Urgency is HIGH because …",
    "disclaimer": "Urgency shows how soon to act … not a risk score, a legal assessment, or a law-enforcement determination.",
    "reasons": [ { "signal": "U1_FINANCIAL_LOSS", "text": "…", "sources": [ "SourceRef…" ] } ],
    "computedAt": "…Z"
  },
  "entityCounts": { "PHONE": 1, "URL": 1, "UPI_ID": 1, "TRANSACTION": 1 },
  "report": { "currentVersion": 2, "currentStatus": "GENERATED", "reviewed": true, "confirmedAt": "…Z" },
  "createdAt": "…Z",
  "updatedAt": "…Z"
}
```

Field rules:
- **`urgency`** [RESOLVED G-2]:
  - Before the case first reaches `ACTIONS_READY`: `{ "assessed": false, "level": null, … }`, which the UI shows as **"Not assessed yet"**.
  - `outOfDate = true` when an assessment exists and `status` is earlier than `ACTIONS_READY` (schema §14.4).
  - `explanation` source placeholders are rendered from the live `reasons[].sources`.
  - There is no numeric score or confidence.
- **`report.reviewed`** = an active confirmation exists on the current version (R-1). `status` remains `USER_REVIEW` before and after confirmation.
- `latestRun` is `null` if analysis has never started. `report` is `null` if no version exists.

### 7.4 `GET /cases` [#15]

- Owner's cases only, newest first.
- Each item: `id`, `caseReference`, `status`, `incidentType`, `urgency.level` (or `null`), `evidence.total`, `createdAt`, `updatedAt`.
- Pagination: §26.

### 7.5 `PATCH /cases/:id` [#16]

- Body: any subset of the §7.1 fields.
- Each changed value writes a `CASE_METADATA` user statement plus audit `CASE_UPDATED`. **There is no case state change.** The change takes effect at the next analysis or report generation (no source defines a re-entry for metadata).
- Response `200` Case object.

### 7.6 `DELETE /cases/:id?confirm=true` [#17]

See §23.

---

## 8. Evidence Upload API

### 8.1 `POST /cases/:id/evidence` [SPEC-ENDPOINT #3]

Two request variants, discriminated by `source`.

**(a) File registration** (step 1 of 3, OD-14):

```json
{ "source": "FILE", "filename": "E04_upi_receipt.pdf", "declaredContentType": "application/pdf", "byteSize": 48211, "label": "UPI receipt" }
```

**(b) Pasted content:**

```json
{ "source": "PASTE", "pasteKind": "MESSAGE | CHAT_TRANSCRIPT | URL", "content": "…", "label": "My note about the call" }
```

| Check | (a) File | (b) Paste | Failure |
|---|---|---|---|
| Owner | ✓ | ✓ | 404 |
| Case not in an active run | ✓ | ✓ | 409 `ANALYSIS_IN_PROGRESS` (§25) |
| ≤ 20 items per case (slot allocation under case lock) | ✓ | ✓ | 409 `TOO_MANY_ITEMS` |
| Declared type ∈ {image/png, image/jpeg, application/pdf, text/plain, message/rfc822} | ✓ | — | 415 `TYPE_NOT_SUPPORTED` / `EMAIL_FORMAT_NOT_SUPPORTED` (.msg, .mbox) |
| `byteSize` 1–10,485,760 (declared) | ✓ | — | 413 `FILE_TOO_LARGE` / 422 `EMPTY_FILE` |
| `content` 1–20,000 characters | — | ✓ | 413 `TEXT_TOO_LONG` / 400 |
| `pasteKind = URL` content parses as a URL | — | ✓ | 422 `NOT_A_URL` (the user may resubmit as `MESSAGE`; PRD FR-003) |
| filename ≤ 255, label ≤ 100 | ✓ | label | 400 |

Responses:
- **(a) `201`:** `{ "evidence": Evidence (status UPLOADING, sha256 null), "upload": { "url": "<signed PUT URL>", "method": "PUT", "headers": { "Content-Type": "application/pdf" }, "expiresAt": "…Z" } }`.
  - The browser PUTs the bytes to `upload.url`, then calls #18.
- **(b) `201`:** `{ "evidence": Evidence (status UPLOADED, sha256 set) }`.
  - The server canonicalises the content (G-3, doc 07), hashes it, stores it, and audits `EVIDENCE_UPLOADED`.
  - The URL is **never fetched** (FR-003).

Filename handling:
- Stored as given (length-limited) for the owner's display.
- **Never** used in storage keys (opaque UUID keys), logs or audit.

### 8.2 `POST /evidence/:id/complete` [#18]

| Item | Contract |
|---|---|
| Preconditions | Item `UPLOADING`, owned, object present in storage |
| Server validation (authoritative, on the **stored bytes**) | Magic-byte type ∈ supported set and matching the declared type; size 1–10 MB; PDF ≤ 20 pages and not encrypted; image ≤ 40 MP; TXT valid UTF-8 |
| Hash | SHA-256 over the stored bytes, computed by the server (FR-004). **The client never supplies a hash.** |
| Success | `200` Evidence (`UPLOADED`, `sha256`, `uploadedAt`) + audit `EVIDENCE_UPLOADED` |
| Rejection | The evidence row is **deleted** and the object deleted after commit. Audit `EVIDENCE_REJECTED` with code only. Response: 415 `CONTENT_TYPE_MISMATCH`/`TYPE_NOT_SUPPORTED`; 413 `FILE_TOO_LARGE`; 422 `EMPTY_FILE`/`PDF_TOO_MANY_PAGES`/`PDF_ENCRYPTED`/`IMAGE_TOO_LARGE`/`TEXT_NOT_UTF8`. **No evidence item remains** (G-4). |
| Object missing (PUT not done or failed) | 409 `EVIDENCE_NOT_UPLOADED`. The item stays `UPLOADING`; the client may re-request a URL by deleting and re-registering. Abandoned items are cleaned up after the URL lifetime [IMPL]. |
| Storage unavailable | 503. Retry `complete` later. |
| Repeat call on an `UPLOADED` item | `200` with the same Evidence (idempotent, §24) |

Scanned PDFs pass this step if they meet the size/page/encryption constraints. The text-layer check happens during processing (§9).

### 8.3 Validation layers (G-4; schema §6.2; Document 04 §8.2)

| Limit | Client (advisory) | API (authoritative) | Database (backstop) |
|---|---|---|---|
| Types | pre-check | #3 declared, #18 magic bytes | enum + detected type check |
| 10 MB | pre-check | #3 declared, #18 actual | `byte_size` CHECK + bucket limit |
| 20 items | pre-check | #3 slot allocation | `sequence_no` 1–20 unique |
| 20 PDF pages | — | #18 | `page_count` CHECK |
| 40 MP | — | #18 | width × height CHECK |
| 20,000 chars | pre-check | #3 | `text_char_count` CHECK |
| `.eml` only for email | pre-check | #3, #18 | no enum value for other formats |

### 8.4 Evidence object (used by #3, #18, #19)

```json
{
  "id": "uuid", "evidenceRef": "E04", "evidenceType": "PDF", "pasteKind": null, "label": "UPI receipt",
  "originalFilename": "E04_upi_receipt.pdf", "contentType": "application/pdf", "byteSize": 48211,
  "pageCount": 1, "imageWidth": null, "imageHeight": null, "textCharCount": null,
  "sha256": "64 lowercase hex | null", "uploadedAt": "…Z | null",
  "processingStatus": "PROCESSED",
  "failure": null,
  "integrity": { "latestResult": "NOT_YET_VERIFIED | MATCH | MISMATCH | COULD_NOT_COMPLETE", "verifiedAt": null },
  "email": null,
  "createdAt": "…Z"
}
```

- `failure`: `{ "code": "PDF_NO_TEXT_LAYER", "retryable": false, "pagesWithoutText": [2] }`, or `null`. Retryable failures omit `pagesWithoutText`.
- `email` (EML only): `{ "attachments": [ { "filename": "…", "contentType": "…", "sizeBytes": 1234 } ], "attachmentsProcessed": false }` (G-4).
- `integrity.latestResult` is derived from the latest verification (schema §18.2).
- `attestationRef` is not returned unless OD-06 is built.

---

## 9. Evidence Processing States

States are exactly `evidence_processing_status` (PRD S-3; schema §23.2).

| `processingStatus` | Meaning | Client can | Retry? | Contributes to analysis? |
|---|---|---|---|---|
| `UPLOADING` | Registered; bytes not yet confirmed | PUT bytes, call `complete`, delete | — | No |
| `UPLOADED` | Accepted and fingerprinted | Start analysis, delete, download, verify | — | Yes, at the next run |
| `PROCESSING` | In an active run | Watch activity | — | In progress |
| `PROCESSED` | Parsed and extracted | View source, entities, etc.; verify; delete | — | **Yes** |
| `FAILED` (`retryable: true`) — e.g. `NO_READABLE_TEXT`, `OCR_FAILED`, `EXTRACTION_FAILED` | Processing failed | Retry via `POST /cases/:id/analyze`, or delete | **Yes** | No (blocks the case past `EXTRACTED` until retried successfully or removed; PRD FR-006) |
| `FAILED` (`retryable: false`) — `PDF_NO_TEXT_LAYER`, `EMAIL_UNPARSEABLE`, `EMAIL_ENCRYPTED` | Cannot be processed | **Delete only** | **No** | No (blocks until removed) |

| Scenario | API representation |
|---|---|
| **Scanned PDF** (OD-03) | Uploads and completes normally. During processing: `FAILED`, `failure.code = PDF_NO_TEXT_LAYER`, `retryable = false`, `pagesWithoutText = [...]`. `GET /evidence/:id/source` returns pages with `hasUsableTextLayer: false` and **no lines**. No entities, events or facts derive from it. `POST /cases/:id/analyze` does **not** reprocess it. The UI shows the fixed guidance: upload the affected page(s) as PNG/JPG, then remove the PDF. |
| Unreadable evidence | `FAILED` / `NO_READABLE_TEXT`, retryable |
| Unsupported format | Never reaches a processing state (rejected at #3 or #18) |
| Processing failure | `FAILED` with code, plus the failing step in the activity feed |
| Success | `PROCESSED` |

---

## 10. Evidence Retrieval

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /cases/:id/evidence` [#19] | `{ "items": Evidence[] }` ordered by `evidenceRef` | ≤ 20 items, so no pagination |
| `GET /evidence/:id/source` [#20] | `{ "evidenceId", "evidenceRef", "parserKind", "engine", "pages": [ { "pageNumber", "hasUsableTextLayer", "nonWhitespaceCharCount" } ], "lines": [ { "id", "pageNumber", "lineNumber", "locationKind", "headerName", "text", "bbox" } ] }` | **Redacted** text only (OTP/card spans masked, schema §9.6). `409 EVIDENCE_NOT_UPLOADED` if it has never been parsed. Audited `EVIDENCE_VIEWED`. |
| `GET /evidence/:id/download` [#21] | `{ "url": "<signed GET URL>", "expiresAt": "…Z" }` | Private object, short-lived link after the ownership check. Audited `EVIDENCE_VIEWED`. **No public or CDN URL exists.** |

---

## 11. Analysis API

### 11.1 `POST /cases/:id/analyze` [SPEC-ENDPOINT #4]

| Item | Contract |
|---|---|
| Auth | Owner |
| Body | none |
| Preconditions | ≥ 1 item in `UPLOADED`, `PROCESSED` or retryable `FAILED`. Otherwise 409 `INVALID_CASE_STATE` with `details.reason = "NO_PROCESSABLE_EVIDENCE"`. |
| Allowed case states | Any. `plan()` decides which steps run from the case state and evidence (OD-12). |
| Behaviour | **Asynchronous.** Enqueues an `ANALYSIS` run (trigger `USER_START`, or `USER_RETRY` if the last run failed) and returns immediately (FR-006). A retry resumes at the failed step and includes retryable `FAILED` items. Non-retryable items are excluded. |
| Response | `202` `{ "run": { "id", "kind": "ANALYSIS", "status": "QUEUED", "trigger", "plan": null } }`. The plan appears in the activity feed once computed. |
| Repeated call | If a run is already `QUEUED`/`RUNNING`, **`200` with that run** (`"alreadyActive": true`). No second run is created (FR-006 AC-006.4; schema partial unique index). |
| Run ends | `SUCCEEDED` with the case at `ACTIONS_READY`, or `FAILED` at a step (case keeps its last state; S-2) |
| Late uploads | Items whose upload completes after the run started are not in the run's plan. If any item is unprocessed at the `EXTRACTED` gate, the run stops there: remaining steps `SKIPPED`, run `FAILED` with code `EVIDENCE_PENDING` (retryable), and the user starts analysis again (PRD FR-006: "processed in a later run"; INV-E9). |
| Progress | Poll `GET /cases/:id/activity` (OD-10). No SSE or WebSocket. |

### 11.2 `GET /cases/:id/activity` [#23]

```json
{
  "run": { "id": "uuid", "kind": "ANALYSIS", "trigger": "USER_START", "status": "RUNNING",
           "plan": ["PLAN","PARSE","EXTRACT","NORMALIZE","SCAM_ANALYSIS","CORRELATE","TIMELINE","MISSING_INFO","ACTIONS","URGENCY"],
           "fallbackUsed": false, "startedAt": "…Z", "finishedAt": null, "failure": null },
  "steps": [ { "id": "uuid", "stepName": "PARSE", "evidenceRef": "E01", "status": "SUCCEEDED",
               "description": "Read text from E01", "fallbackUsed": false, "startedAt": "…Z", "finishedAt": "…Z", "failure": null } ],
  "evidenceProgress": { "processed": 6, "total": 6 },
  "pollAfterMs": 1500
}
```

- Returns the latest run, or `run: null` if there has been none. Steps and results only; **no model reasoning** (FR-024).
- `fallbackUsed: true` is shown whenever cached synthetic results were used (FR-027).
- `failure`: `{ "code", "retryable" }`.
- `pollAfterMs` is a hint [IMPL]. `report` runs (`kind: REPORT_GENERATION`) also appear here.

---

## 12. Analysis Result APIs

| Output | Where it is returned | Reason |
|---|---|---|
| Entities | `GET /cases/:id/entities` | Spec endpoint |
| Timeline | `GET /cases/:id/timeline` | Spec endpoint |
| Graph | `GET /cases/:id/graph` | Spec endpoint |
| Missing information | `GET /cases/:id/missing-information` | Spec §20 list |
| Actions | `GET /cases/:id/actions` | Spec endpoint |
| **Urgency** | **Inside `GET /cases/:id`** (`urgency`) | Overview data (spec §21.1). No separate endpoint (§6.3). |
| **Scam analysis** | **Inside `GET /cases/:id`** (`scamSignals`, `incidentType`) | Spec §20 ("scam signals") |

Before the producing step has run, result endpoints return empty collections (`200`). They do not return errors.

---

## 13. Entity API — `GET /cases/:id/entities` [SPEC-ENDPOINT #5]

```json
{
  "entities": [
    {
      "id": "uuid", "entityType": "PHONE", "canonicalValue": "+919000000001", "maskedValue": "+91 90XXX XX001",
      "isUserStated": false,
      "appearsIn": ["E01","E02","E06"],
      "extractions": [
        { "id": "uuid", "evidenceId": "uuid", "evidenceRef": "E06", "fieldType": "PHONE",
          "rawValue": "9000000001", "normalizedValue": "+919000000001", "normalizationStatus": "NORMALIZED",
          "method": "RULE", "confidenceBand": "HIGH", "validationStatus": "VALIDATED_AGAINST_SOURCE",
          "sourceLabel": null, "snippet": "…called the number in the SMS, 9000000001. …",
          "location": { "pageNumber": 1, "lineNumbers": [1], "headerName": null, "bbox": null },
          "correction": null }
      ],
      "userSources": []
    }
  ],
  "unmergedExtractions": []
}
```

Field rules:
- **`validationStatus`** is derived: `VALIDATED_AGAINST_SOURCE` | `USER_CORRECTED` (schema §9.2). User-stated entities (`isUserStated: true`) carry `userSources: SourceRef[]` and no extractions.
- `correction`: `{ "correctedValue", "correctedNormalizedValue", "correctedAt", "statementId" }`. The original values are always kept and returned.
- `unmergedExtractions`: extractions with `NOT_NORMALIZED` status. `DATETIME` extractions are not returned here; they feed the timeline (schema §10.2).
- **Values never stored are never returned:** there is no OTP or card number field, and account hints are last-four only.
- No pagination. The collection is bounded by the case's evidence.

**Correction:** `POST /cases/:id/extractions/:extractionId/correction` [#24]
- Body: `{ "correctedValue": "string", "note": "string | null" }`.
- Creates a `CORRECTION` user statement and sets the correction fields (originals kept). The entity is recanonicalised.
- The case returns to `EXTRACTED`, confirmations are voided, and a run with trigger `CORRECTION` is enqueued (S-4).
- Response `202` `{ "extraction", "run" }`.
- 409 `ANALYSIS_IN_PROGRESS` if a run is active. 422 if the type format is invalid (FR-013).

---

## 14. Timeline API — `GET /cases/:id/timeline` [SPEC-ENDPOINT #6]

Query: `includeDismissed=false` (default).

```json
{
  "displayTimeZone": "Asia/Kolkata",
  "events": [
    {
      "id": "uuid", "sortOrder": 2, "eventType": "CALL",
      "occurredAt": "2026-09-24T06:37:00Z", "precision": "APPROXIMATE", "timeSourceText": "Around 12:05 PM",
      "description": "User called the number in the SMS",
      "confidenceBand": "MEDIUM", "origin": "AI_GENERATED",
      "correctionStatus": "USER_CORRECTED",
      "original": { "eventType": "CALL", "occurredAt": "2026-09-24T06:35:00Z", "precision": "APPROXIMATE", "description": "…" },
      "dismissed": false,
      "relatedEntityIds": ["uuid"],
      "contradictionItemIds": [],
      "sources": [ "SourceRef(EXTRACTION, E06)", "SourceRef(USER_STATEMENT)" ]
    }
  ]
}
```

Rules:
- Events are ordered by `sortOrder` (schema §12.1).
- `occurredAt` is `null` iff `precision = INFERRED_ORDER_ONLY`. No time is ever invented (TL-3).
- `original` is non-null iff `USER_CORRECTED`.
- `contradictionItemIds` link to `CONTRADICTION` findings.

| Endpoint | Body | Effect | Response |
|---|---|---|---|
| `POST /cases/:id/timeline` [#25] | `{ "eventType", "occurredAt" \| null, "precision", "description", "note"? }` | `ADDED_EVENT` statement; event `USER_ADDED`; case → `TIMELINE_READY`; run (`CORRECTION`) for ACTIONS/URGENCY; confirmations voided | `202` `{ "event", "run" }` |
| `PATCH /cases/:id/timeline/:eventId` [#26] | Any of `eventType`, `occurredAt`, `precision`, `description`; `note`? | `CORRECTION` statement; first correction copies originals; `USER_CORRECTED`; S-4 as above | `202` `{ "event", "run" }` |
| `POST /cases/:id/timeline/:eventId/dismiss` [#27] | `{ "note"? }` | `dismissed_at` set; audited; S-4 as above | `202` `{ "event", "run" }` |

All three return 409 `ANALYSIS_IN_PROGRESS` while a run is active, and 422 for invalid times or precision.

---

## 15. Evidence Graph API — `GET /cases/:id/graph` [SPEC-ENDPOINT #7]

```json
{
  "nodes": [
    { "id": "case:uuid", "kind": "CASE", "label": "CF-10001" },
    { "id": "entity:uuid", "kind": "ENTITY", "entityType": "UPI_ID", "label": "kyc.r***@demoupi" },
    { "id": "evidence:uuid", "kind": "EVIDENCE", "evidenceRef": "E04", "evidenceType": "PDF" }
  ],
  "edges": [
    { "id": "appears:entityUuid:evidenceUuid", "kind": "APPEARS_IN", "from": "entity:uuid", "to": "evidence:uuid" },
    { "id": "rel:uuid", "kind": "RELATIONSHIP", "relationType": "PAID_TO", "from": "entity:uuid(TRANSACTION)", "to": "entity:uuid(UPI_ID)",
      "supportCount": 2, "sources": [ "SourceRef(EXTRACTION, E04)", "SourceRef(EXTRACTION, E05)" ] }
  ]
}
```

Rules:
- Entity labels are **masked by default** (spec §13.5). Full values come from the entities endpoint.
- `APPEARS_IN` edges are **derived** from extractions (one edge per entity–evidence pair). They are not stored.
- **Each entity-to-entity relationship appears exactly once**, with all supporting sources in `sources` (schema §11.3). Duplicate edges are never emitted.
- `relationType` values are exactly schema §11.4. Only this case's nodes are returned. There is no pagination.

---

## 16. Missing Information API

### 16.1 `GET /cases/:id/missing-information` [#28]

```json
{
  "checklistVariant": "FINANCIAL",
  "items": [
    { "id": "uuid", "findingKind": "MISSING_FIELD", "checklistField": "BANK_WALLET_MERCHANT",
      "status": "OPEN", "resolution": null, "reasonText": "Your bank or wallet is needed when reporting …",
      "isHighValue": true,
      "question": { "text": "Which bank or wallet was the ₹8,500 debited from?", "status": "OPEN" },
      "answer": null, "subjectEntityId": null, "subjectTimelineEventId": null, "sources": [] },
    { "id": "uuid", "findingKind": "MISSING_FIELD", "checklistField": "IDENTITY_DOCUMENT",
      "status": "INFORMATIONAL", "reasonText": "Keep your identity document ready for official reporting.",
      "isHighValue": false, "question": null, "answer": null, "sources": [] },
    { "id": "uuid", "findingKind": "CONTRADICTION", "checklistField": null, "status": "OPEN",
      "reasonText": "Two different payment times were found.", "subjectTimelineEventId": "uuid",
      "question": { "text": "…", "status": "OPEN" }, "answer": null,
      "sources": [ "SourceRef(EXTRACTION, E04: 12:19 PM)", "SourceRef(EXTRACTION, E06: around 12:40 PM)" ] }
  ]
}
```

- `answer`: `{ "statementId", "text", "answeredAt" }`. It is always a **user statement**, never evidence (FR-015).
- Contradiction values are shown through their sources. Proofline does not pick a winner (TL-8).

### 16.2 Answer and skip

| Endpoint | Body | Effect | Response | Errors |
|---|---|---|---|---|
| `POST …/:itemId/answer` [#29] | `{ "answer": "string ≤ 2000" }` | `FOLLOW_UP_ANSWER` statement → item `RESOLVED` / `USER_ANSWER`. A user-stated entity is created where applicable (e.g., `BANK_OR_WALLET`). Case → `ACTIONS_READY` (or `TIMELINE_READY` if a time changed). Run (`ANSWER`) re-runs only the affected steps. Confirmations voided. **No evidence reprocessing.** | `202` `{ "item", "run" }` | 409 `ANALYSIS_IN_PROGRESS`; 409 `INVALID_CASE_STATE` if the question is not `OPEN`; 422 for invalid typed answers |
| `POST …/:itemId/skip` [#30] | none | `question.status = SKIPPED`. The field stays "Not provided". Audited. | `200` `{ "item" }` | 409 if not `OPEN` |

Answers never modify evidence, extractions or source text.

---

## 17. Actions API

### 17.1 `GET /cases/:id/actions` [SPEC-ENDPOINT #8]

```json
{
  "actions": [
    { "id": "uuid", "actionCode": "CONTACT_BANK", "priorityRank": 1,
      "actionText": "Contact your bank …", "reasonText": "A debit of ₹8,500 is recorded (E04, E05).",
      "officialChannel": null,
      "recommendedBy": "SYSTEM",
      "status": "TODO", "statusChangedAt": null,
      "sources": [ "SourceRef…" ] },
    { "id": "uuid", "actionCode": "REPORT_1930_NCRP", "priorityRank": 2, "actionText": "Report financial cyber fraud via 1930 / NCRP",
      "reasonText": "…", "officialChannel": { "code": "NCRP_1930", "label": "…", "contact": "from curated list" },
      "recommendedBy": "SYSTEM", "status": "TODO", "statusChangedAt": null, "sources": [ "SourceRef…" ] }
  ]
}
```

- Ordered by `priorityRank`.
- `officialChannel` is resolved from the **curated static list** in application configuration. Contact details are never AI-generated (GR-14).
- `recommendedBy` is always `SYSTEM`. User completion is shown by `status` / `statusChangedAt`.

### 17.2 `PATCH /cases/:id/actions/:actionId` [#31]

- Body `{ "status": "TODO | DONE | NOT_APPLICABLE" }`.
- Writes only the user-status fields and audit `ACTION_STATUS_CHANGED`. **There is no state change, no re-analysis, and no change to facts or reasons** (S-4).
- Setting the current value again → `200`, no-op, no audit.
- Allowed during an active run (it does not affect analysis).
- If the action was removed by a concurrent re-run → `404`.

---

## 18. Report API

### 18.1 `POST /cases/:id/report` [SPEC-ENDPOINT #9]

| Item | Contract |
|---|---|
| Preconditions | Case status ∈ {`ACTIONS_READY`, `REPORT_DRAFT` (after a failed generation), `USER_REVIEW`, `EXPORTED`} and no active run. Otherwise 409 `INVALID_CASE_STATE` / `ANALYSIS_IN_PROGRESS`. |
| Behaviour | Creates version N+1 (`GENERATING`). Case → `REPORT_DRAFT`. Earlier confirmations voided (`REPORT_REGENERATED`). Enqueues a `REPORT_GENERATION` run. |
| Response | `202` `{ "report": { "version": 3, "status": "GENERATING" }, "run": { "id", "kind": "REPORT_GENERATION", "status": "QUEUED" } }` |
| Repeated call while a report run is active | `200` with the active run and version (`alreadyActive: true`) |
| Outcome | `GENERATED` → case `USER_REVIEW` (R-1). `FAILED` → case stays `REPORT_DRAFT`; earlier versions remain viewable (PRD FR-017). |

### 18.2 `GET /cases/:id/reports` [#32]

```json
{ "currentVersion": 2,
  "versions": [ { "id": "uuid", "version": 2, "status": "GENERATED", "isCurrent": true, "generatedAt": "…Z",
                  "contentSha256": "…", "pdfSha256": "…", "confirmation": { "active": true, "id": "uuid", "confirmedAt": "…Z" } },
                { "id": "uuid", "version": 1, "status": "GENERATED", "isCurrent": false, "generatedAt": "…Z",
                  "contentSha256": "…", "pdfSha256": "…", "confirmation": { "active": false, "id": "uuid", "confirmedAt": "…Z", "voidReason": "REPORT_REGENERATED" } } ] }
```

`INVALIDATED` versions are listed without hashes or content.

### 18.3 `GET /cases/:id/reports/:version` [#33]

- `200` `{ "version", "status", "schemaVersion", "contentSha256", "generatedAt", "isCurrent", "content": ReportDocument }`.
- `content` follows ReportDocument (sections 0–10, AD-04; JSON schema owned by doc 06).
- Every key fact carries `sources: SourceRef[]` or is `null`, which the UI renders as "Not provided" (GR-06, GR-07).
- The AI incident summary appears only in content section 1.
- `GENERATING` / `FAILED` / `INVALIDATED` versions → `200` with `content: null`.
- **Report text never becomes evidence.** No endpoint accepts report content as input.

---

## 19. User Review / Confirmation API — `POST /cases/:id/reports/:version/confirm` [#34]

| Item | Contract |
|---|---|
| Body | `{ "contentSha256": "64 hex" }`: the checksum of the content the user reviewed |
| Checks (in one transaction, under case lock) | Case `status = USER_REVIEW`. Version is the **current** GENERATED version. `contentSha256` equals the stored value. No active run. |
| Success | `201` `{ "confirmation": { "id", "reportVersion", "contentSha256", "confirmedBy", "confirmedAt" } }` + audit `REPORT_CONFIRMED`. **The case status remains `USER_REVIEW`** (R-1). |
| Already confirmed (active confirmation exists for this version) | `200` with the existing confirmation (idempotent) |
| Errors | 409 `REPORT_NOT_CURRENT` (stale version); 409 `REPORT_CHECKSUM_MISMATCH`; 409 `INVALID_CASE_STATE`; 409 `ANALYSIS_IN_PROGRESS` |

There is no "confirm case" operation. Confirmation exists only per version.

---

## 20. Report Export API — `POST /cases/:id/export` [SPEC-ENDPOINT #10]

(The request's `POST /cases/:id/report/export` does not exist in the sources; see N-1.)

| Item | Contract |
|---|---|
| Body | `{ "reportVersion": 2, "confirmationId": "uuid", "format": "REPORT_PDF \| ZIP_BUNDLE", "evidenceIds": ["uuid", …] }`. `evidenceIds` is allowed only for `ZIP_BUNDLE` (the originals to include; may be empty). |
| Checks | `reportVersion` is the **current** GENERATED version (else 409 `REPORT_NOT_CURRENT`). `confirmationId` exists, is **active**, and belongs to **that** version (else 409 `REPORT_NOT_CONFIRMED` / `CONFIRMATION_VERSION_MISMATCH`). Every `evidenceIds` item belongs to the case and is not deleted (else 404). |
| Guarantee | **Report v2 + confirmation for v1 → 409 `CONFIRMATION_VERSION_MISMATCH`.** This is also enforced by the composite FK `exports(review_confirmation_id, report_id)` (schema §17.4). |
| Behaviour | Creates an export (`GENERATING`) and builds it asynchronously: PDF, or ZIP with `report.pdf`, `case.json`, `manifest.json` (SHA-256 of every file and each original) and `evidence/` originals (OD-07). On `READY`, the case → `EXPORTED` (first export). **Nothing is submitted to any external party** (EXP-3). |
| Response | `202` `{ "export": { "id", "format", "status": "GENERATING", "reportVersion" } }` |
| Status / download | `GET /cases/:id/exports/:exportId` [#35] → `{ "id", "format", "status": "GENERATING\|READY\|FAILED", "sha256", "byteSize", "completedAt", "failure" }`. `GET …/download` [#36] → `{ "url", "expiresAt" }` (audited `EXPORT_DOWNLOADED`), or 409 `INVALID_CASE_STATE` if not `READY`. |
| Failures | Build failure → export `FAILED` (retry by posting a new export). Storage outage → 503. |
| Formats | **Resolved** (OD-07): `REPORT_PDF`, `ZIP_BUNDLE` |

---

## 21. Integrity Verification API — `POST /evidence/:id/verify` [SPEC-ENDPOINT #11]

| Item | Contract |
|---|---|
| Auth | Owner (evidence → case → owner) |
| Preconditions | Item has a recorded fingerprint (status ≠ `UPLOADING`), else 409 `EVIDENCE_NOT_UPLOADED` |
| Behaviour | Stream the stored object → SHA-256 → compare with the recorded value → insert an immutable verification + audit `INTEGRITY_VERIFIED` |
| Response | `200` (for **all three outcomes**) |

```json
{
  "verificationId": "uuid", "evidenceId": "uuid", "evidenceRef": "E04",
  "result": "MATCH | MISMATCH | COULD_NOT_COMPLETE",
  "recordedSha256": "…", "computedSha256": "… | null", "failureCode": null,
  "ingestedAt": "…Z", "verifiedAt": "…Z",
  "attestation": null,
  "meaning": {
    "proves": "The stored file is byte-for-byte identical to the file fingerprinted at upload.",
    "doesNotProve": "That the evidence is truthful or authentic, or that it is legally admissible."
  }
}
```

- `MATCH` = verified. `MISMATCH` = stored bytes differ. **`COULD_NOT_COMPLETE`** = the object could not be read (`failureCode`: `STORAGE_UNAVAILABLE` | `OBJECT_MISSING`), with `computedSha256: null`. **This is never reported as a mismatch** (IN-6).
- Hash equality demonstrates **byte equality**, not truth or legal admissibility (spec §15.3).
- `attestation` stays `null` unless OD-06 is built (deferred). If built, it would be `{ "network", "txHash", "result": "MATCH|MISMATCH|UNAVAILABLE" }`.
- Each call creates a new verification record.

---

## 22. Audit API — `GET /cases/:id/audit-log` [#37]

```json
{ "entries": [ { "id": "uuid", "occurredAt": "…Z", "actorKind": "USER", "actorIsYou": true,
                 "action": "REPORT_CONFIRMED", "targetType": "report", "targetId": "uuid",
                 "outcome": "SUCCEEDED", "requestId": "req_…", "metadata": { "reportVersion": 2 } } ],
  "nextCursor": "opaque | null" }
```

- Metadata contains only whitelisted keys (schema §19.2): IDs, evidence refs, hashes, codes, counts and versions. **No evidence content, filenames, values or statements.**
- The actor user ID is not returned. `actorIsYou` (true for the owner) is enough.
- Paginated (§26). Audit writes are internal; no endpoint creates audit entries.

---

## 23. Delete / Remove Behaviour

| Endpoint | Contract |
|---|---|
| `DELETE /cases/:id?confirm=true` [#17] | `confirm=true` is required, else 400 `CONFIRMATION_REQUIRED`. Allowed in **any** state, including during a run (the run stops cleanly; INV-D2). One transaction deletes all case data (schema §24.1). Objects are deleted after commit. Content-free audit rows and the `CASE_DELETED` tombstone are retained. Response `204`. Afterwards every case route returns 404. |
| `DELETE /evidence/:id?confirm=true` [#22] | `confirm=true` is required. Allowed in any state. During an active run, the run stops with failure code `CASE_CHANGED_DURING_RUN` (retryable), per Document 04 §14 deletion races. Effects follow schema §24.2: dependent data removed; **all report versions invalidated**; exports deleted; confirmations voided; case → `INGESTING`/`NEW`; urgency per schema §14.4; scam signals, actions and missing-info items rebuilt at the next analysis (**schema/implementation recommendation**, schema §24.6). Response `200` `{ "caseStatus", "reportsInvalidated": n, "exportsDeleted": n }`. |

There are no other DELETE endpoints.

---

## 24. Idempotency

There is **no `Idempotency-Key` header in the MVP**. Document 03 defines no idempotency-key storage, and the invariants below give natural idempotency without it [API-REC].

| Operation | Mechanism | Replay behaviour |
|---|---|---|
| Evidence registration (#3) | None needed: each call registers a distinct item (duplicates are allowed by the schema). The client must disable double submit. | A second call creates a second item (counts toward 20) |
| Upload completion (#18) | State check (`UPLOADING` → `UPLOADED` once) | Returns the same Evidence |
| Analysis start (#4) | One active run per case (DB partial unique + queue singleton key) | Returns the active run (`200`) |
| Report generation (#9) | Same active-run rule | Returns the active run/version |
| Confirmation (#34) | Partial unique "one active confirmation per version" | Returns the existing confirmation |
| Export (#10) | Each call is a distinct export (intended history) | New export each time |
| Integrity verification (#11) | Each call is a distinct verification (intended history) | New verification each time |
| Action status (#31) | Set-to-value semantics | No-op if unchanged |
| Answer (#29) / skip (#30) | `question.status` must be `OPEN` | 409 on repeat |
| Corrections (#24, #26) | Each is a new user statement (append-only) | A second identical correction creates another statement; the latest wins |

---

## 25. Concurrency and Conflicts

| Situation | Behaviour |
|---|---|
| Two analysis requests | One run. The second request gets that run (`200`). |
| Report generation during analysis | 409 `ANALYSIS_IN_PROGRESS` (one active run of any kind per case) |
| Simultaneous report generations | One run. The second request gets it. |
| Confirming a stale version | 409 `REPORT_NOT_CURRENT` |
| Confirming changed content | 409 `REPORT_CHECKSUM_MISMATCH` |
| Corrections, answers, timeline edits, new evidence registration during a run | 409 `ANALYSIS_IN_PROGRESS` (these rewind state; S-4) |
| Upload **completion** during a run | Allowed. The item is not in that run (§11.1 late uploads). |
| Evidence deletion during a run | Allowed. The run stops with `CASE_CHANGED_DURING_RUN` (§23). |
| Case deletion during a run | Allowed. The run stops silently; the case is gone. |
| Action status change during a run, or racing a re-run | Allowed. 404 if the action was removed. Last write wins for status. |
| Verification of an item being deleted | Ordered by the case lock. If deletion commits first → 404. |
| Export of a version invalidated mid-build | Export fails (`FAILED`) and is deleted with the invalidation |

---

## 26. Pagination, Filtering and Sorting

| Collection | Pagination | Order |
|---|---|---|
| `GET /cases` | Cursor: `?limit` (default 20, max 50), `?cursor` | `updatedAt` desc, `id` tiebreak |
| `GET /cases/:id/audit-log` | Cursor: `?limit` (default 50, max 200), `?cursor` | `occurredAt` desc, `id` tiebreak |
| Evidence (≤ 20), entities, timeline, graph, missing info, actions, report versions, activity steps | **None** (bounded per case) | Evidence: `evidenceRef`; timeline: `sortOrder`; actions: `priorityRank`; versions: version desc; steps: sequence |

Cursors are opaque and case/user-scoped. Filtering: `includeDismissed` on the timeline only.

---

## 27. Rate Limiting

Rate limits apply per user (and per email or client fingerprint for auth). Limit values are **implementation-configurable** [IMPL]; this document defines no numbers except the OTP attempt limit stored with each challenge (schema §4.3).

| Area | Scope |
|---|---|
| `POST /auth/request-code` | Per email + per client fingerprint |
| `POST /auth/verify-code` | Per challenge (max attempts) + per fingerprint |
| Evidence registration/completion | Per user |
| `POST /cases/:id/analyze`, `POST /cases/:id/report`, `POST /cases/:id/export` | Per user (natural de-duplication also applies) |
| `POST /evidence/:id/verify` | Per user |
| Response | 429 `RATE_LIMITED` + `Retry-After` |

---

## 28. Security Requirements (API scope; details in doc 09)

- AuthGuard + CaseGuard on every case- and evidence-scoped endpoint. Unowned → 404.
- Object access only via short-lived signed URLs issued after ownership checks (#3, #21, #36). Private storage.
- Input validation with shared schemas. Unknown fields rejected. Explicit length limits.
- Upload validation by content (#18). G-4 limits are enforced server-side.
- Request body size limits (§3).
- Prompt-injection isolation: no endpoint passes user or evidence text to an LLM synchronously, and no endpoint lets text alter processing (Document 04 §13.3).
- Sensitive fields: redacted source text only. No numeric confidence. Masked graph labels.
- Error sanitisation (§5). Rate limiting (§27).
- Auditability: every state-changing endpoint writes its audit entry in the same transaction. Audited reads: evidence source/download, export download.
- `Cache-Control: no-store` on all responses. CSRF via SameSite=Lax + Origin check.

---

## 29. API Data Exposure Rules

The API **never** returns:

| Never exposed | Why it cannot leak |
|---|---|
| OTP values, full card numbers | Never stored (redacted before persistence, schema §9.6) |
| Full account numbers | Only last-four hints exist |
| Secrets, provider credentials, DB credentials, session tokens, OTP codes or hashes | Never serialised. Tokens only in the httpOnly cookie. |
| System prompts, prompt or completion bodies, model reasoning | Not stored (Document 04 §27) |
| Stack traces, SQL, provider error bodies | Sanitised errors (§5) |
| Evidence content in audit responses | Whitelisted metadata only |
| Other users' data | Ownership guard + composite FKs |
| Numeric AI confidence | Bands only (AD-02) |
| Public evidence URLs | Do not exist |
| Storage keys | Internal only |

---

## 30. External Provider Error Mapping

| Provider | Failure | Category | API surface |
|---|---|---|---|
| OCR | Engine error / timeout | Temporary | Item `FAILED` (`OCR_FAILED`, retryable). Run `FAILED`. Fallback only for the synthetic set (disclosed). |
| OCR / parser | No readable text; no PDF text layer; unparseable/encrypted `.eml` | Permanent input | Item `FAILED` with code (retryable only for `NO_READABLE_TEXT`) |
| LLM | Timeout / 5xx / rate limit | Temporary | Step `FAILED` (retryable) after one internal retry; fallback for the synthetic set |
| LLM | Schema-invalid output after re-ask | Application | Step `FAILED` (retryable). Nothing persisted. |
| LLM | Candidate fails literal validation | Validation (not an error) | Discarded; counted in the step summary |
| Object storage | Unavailable during sync calls (#3, #18, #20, #21, #36) | Temporary | 503 `SERVICE_UNAVAILABLE` |
| Object storage | Unavailable during verification | Temporary | `200` with `COULD_NOT_COMPLETE` (§21) |
| Object storage | Unavailable during report/export build | Temporary | Version/export `FAILED` (retry) |
| Email | Send failure on `request-code` | Temporary | 502 `PROVIDER_ERROR` ("We couldn't send the code") |
| Ledger (deferred) | Unavailable | — | `attestation.result = UNAVAILABLE`. Never an error. |
| Database | Unavailable / failed transaction (incl. audit write) | Application/temporary | 500 `INTERNAL_ERROR` or 503 |

---

## 31. API State-Transition Rules

| Endpoint | Allowed when | Case-state effect |
|---|---|---|
| `POST /cases` | Always | → `NEW` |
| `POST /cases/:id/evidence` | No active run; < 20 items | First item: `NEW` → `INGESTING`. Later: any → `INGESTING` (voids confirmation). |
| `POST /evidence/:id/complete` | Item `UPLOADING` | none |
| `POST /cases/:id/analyze` | ≥ 1 processable item | Run advances `INGESTING` → … → `ACTIONS_READY` |
| Corrections / answers / timeline edits | No active run; target exists (answer: question `OPEN`) | Rewind per S-4; voids confirmation |
| `PATCH …/actions/:id` | Always | none |
| `POST /cases/:id/report` | `ACTIONS_READY`, `REPORT_DRAFT`, `USER_REVIEW`, `EXPORTED`; no active run | → `REPORT_DRAFT` → (`GENERATED`) `USER_REVIEW` |
| `POST …/reports/:v/confirm` | `USER_REVIEW`; `v` current; checksum match | **none** (stays `USER_REVIEW`) |
| `POST /cases/:id/export` | Active confirmation of the current version | → `EXPORTED` when the first export is `READY` |
| `POST /evidence/:id/verify` | Item fingerprinted | none |
| `DELETE /evidence/:id` | Always | → `INGESTING` / `NEW` |
| `DELETE /cases/:id` | Always | case removed |

States used: exactly `NEW`, `INGESTING`, `EXTRACTED`, `ANALYZING`, `CORRELATED`, `TIMELINE_READY`, `ACTIONS_READY`, `REPORT_DRAFT`, `USER_REVIEW`, `EXPORTED`. Evidence states are as in §9. Report statuses: `GENERATING`, `GENERATED`, `FAILED`, `INVALIDATED`.

---

## 32. API Traceability Matrix

| # | Endpoint | Requirement | Database entity (03) | Module (04) | Decision |
|---|---|---|---|---|---|
| 1 | POST /cases | FR-001; AU-4 | cases, user_statements, audit_logs | cases | OD-01 |
| 2 | GET /cases/:id | FR-001, FR-010; spec §21.1; AC-R3 | cases, scam_signals, urgency_assessments/reasons, reports, review_confirmations, analysis_runs | cases, analysis, urgency, reports | G-2, R-1, AD-01 |
| 3 | POST /cases/:id/evidence | FR-002–FR-005; FR-003 | evidence_items | evidence, storage | OD-14, G-4 |
| 4 | POST /cases/:id/analyze | FR-006 | analysis_runs, agent_steps | orchestrator, jobs | OD-12, OD-15, AD-05 |
| 5 | GET /cases/:id/entities | FR-008, FR-009; NFR-04 | entities, extractions, extraction_source_lines, fact_sources | entities, extraction | AD-02 |
| 6 | GET /cases/:id/timeline | FR-012; TL-1–TL-8 | timeline_events, timeline_event_entities, fact_sources | timeline | G-5, G-6 |
| 7 | GET /cases/:id/graph | FR-011; CR-1–CR-5 | entities, relationships, fact_sources, view entity_evidence_links | graph | AD-02, G-6 |
| 8 | GET /cases/:id/actions | FR-016; GR-14 | action_items, fact_sources | actions | AD-01 |
| 9 | POST /cases/:id/report | FR-017, FR-018 | reports, analysis_runs | reports, orchestrator | AD-04, OD-07 |
| 10 | POST /cases/:id/export | FR-019, FR-020 | exports, export_evidence_items, review_confirmations | reports, storage | OD-07, R-1 |
| 11 | POST /evidence/:id/verify | FR-021, FR-022; IN-1–IN-8 | integrity_verifications | integrity | OD-06 |
| 12–14 | auth endpoints | FR-026; AU-1–AU-3 | users, otp_challenges, sessions | auth, users | OD-04 |
| 15 | GET /cases | Spec §20 list | cases | cases | OD-01 |
| 16 | PATCH /cases/:id | PRD FR-001 | cases, user_statements | cases, provenance | — |
| 17 | DELETE /cases/:id | FR-025 | all case tables | cases, storage | OD-11 |
| 18 | POST /evidence/:id/complete | FR-002, FR-004 | evidence_items | evidence, storage | OD-14, G-4 |
| 19 | GET /cases/:id/evidence | Spec §20 list; FR-018 | evidence_items, integrity_verifications | evidence | — |
| 20 | GET /evidence/:id/source | PRD P-6, P-9 | parse_results, source_pages, source_lines | processing | OD-03, G-4 |
| 21 | GET /evidence/:id/download | FR-005 | evidence_items | evidence, storage | OD-05, OD-14 |
| 22 | DELETE /evidence/:id | FR-025 | evidence + dependents | evidence, storage | OD-11 |
| 23 | GET /cases/:id/activity | FR-024, FR-027 | analysis_runs, agent_steps | orchestrator | OD-10, AD-06 |
| 24 | POST …/extractions/:id/correction | FR-013 | extractions, user_statements | extraction, provenance | AD-02, AD-05 |
| 25–27 | timeline add/correct/dismiss | FR-013; TL-6, TL-7 | timeline_events, user_statements | timeline | AD-05 |
| 28–30 | missing information get/answer/skip | FR-014, FR-015; MI-1–MI-7 | missing_information_items, user_statements, entities | findings, provenance | AD-01, OD-09 |
| 31 | PATCH …/actions/:id | FR-016 (AC-016.2) | action_items | actions | — |
| 32–33 | report versions / content | FR-017, FR-019 | reports | reports | AD-04 |
| 34 | POST …/reports/:v/confirm | FR-019 | review_confirmations | reports | R-1, AD-05 |
| 35–36 | export status / download | FR-020 | exports | reports, storage | OD-07 |
| 37 | GET …/audit-log | FR-023; NFR-03 | audit_logs | audit | OD-11 |

---

## 33. API Example Contracts

All values are fictional, from the synthetic dataset (`DECISIONS.md` §7.2). UUIDs are shortened to `…` for readability.

**1. Create case**

```http
POST /api/cases
{ "summary": "Got a KYC SMS, called the number and paid by UPI." }
```

```json
201 { "id": "c1…", "caseReference": "CF-10001", "status": "NEW", "summary": "Got a KYC SMS, called the number and paid by UPI.",
      "incidentTime": null, "incidentTimePrecision": null, "contact": null, "location": null, "incidentType": null,
      "financialLossReported": null, "evidence": { "total": 0, "byStatus": { "UPLOADING":0,"UPLOADED":0,"PROCESSING":0,"PROCESSED":0,"FAILED":0 } },
      "latestRun": null, "scamSignals": [], "urgency": { "assessed": false, "level": null, "outOfDate": false, "ruleVersion": null,
      "explanation": null, "disclaimer": null, "reasons": [], "computedAt": null }, "entityCounts": {}, "report": null,
      "createdAt": "2026-10-02T05:00:00Z", "updatedAt": "2026-10-02T05:00:00Z", "statusChangedAt": "2026-10-02T05:00:00Z" }
```

**2. Register a file, then complete**

```http
POST /api/cases/c1…/evidence
{ "source": "FILE", "filename": "E04_upi_receipt.pdf", "declaredContentType": "application/pdf", "byteSize": 48211, "label": "UPI receipt" }
```

```json
201 { "evidence": { "id": "e4…", "evidenceRef": "E04", "evidenceType": "PDF", "processingStatus": "UPLOADING", "sha256": null, "…": "…" },
      "upload": { "url": "https://storage.example/…signed…", "method": "PUT", "headers": { "Content-Type": "application/pdf" }, "expiresAt": "2026-10-02T05:10:00Z" } }
```

```http
POST /api/evidence/e4…/complete
```

```json
200 { "id": "e4…", "evidenceRef": "E04", "evidenceType": "PDF", "pageCount": 1, "byteSize": 48211,
      "sha256": "<64-hex, equals synthetic manifest>", "uploadedAt": "2026-10-02T05:01:12Z", "processingStatus": "UPLOADED",
      "failure": null, "integrity": { "latestResult": "NOT_YET_VERIFIED", "verifiedAt": null } }
```

**3. Paste E06**

```http
POST /api/cases/c1…/evidence
{ "source": "PASTE", "pasteKind": "MESSAGE", "label": "My note about the call", "content": "On 24 Sep 2026 I got an SMS saying my bank KYC had expired. …" }
```

```json
201 { "evidence": { "id": "e6…", "evidenceRef": "E06", "evidenceType": "TEXT", "pasteKind": "MESSAGE", "processingStatus": "UPLOADED", "sha256": "<64-hex>", "…": "…" } }
```

**4. Upload rejection**

```json
413 { "error": { "code": "FILE_TOO_LARGE", "message": "Files can be up to 10 MB.", "requestId": "req_…", "details": { "limitBytes": 10485760 } } }
```

**5. Start analysis**

```http
POST /api/cases/c1…/analyze
```

```json
202 { "run": { "id": "r1…", "kind": "ANALYSIS", "status": "QUEUED", "trigger": "USER_START", "plan": null } }
```

**6. Get entities (excerpt)**

```json
200 { "entities": [ { "id": "n1…", "entityType": "UPI_ID", "canonicalValue": "kyc.refund.desk@demoupi", "maskedValue": "kyc.r***@demoupi",
        "isUserStated": false, "appearsIn": ["E02","E04","E05"],
        "extractions": [ { "id": "x4…", "evidenceRef": "E04", "fieldType": "UPI_ID", "rawValue": "kyc.refund.desk@demoupi",
          "normalizedValue": "kyc.refund.desk@demoupi", "normalizationStatus": "NORMALIZED", "method": "RULE", "confidenceBand": "HIGH",
          "validationStatus": "VALIDATED_AGAINST_SOURCE", "sourceLabel": "UPI ID", "snippet": "UPI ID: kyc.refund.desk@demoupi",
          "location": { "pageNumber": 1, "lineNumbers": [5], "headerName": null, "bbox": null }, "correction": null } ], "userSources": [] } ],
      "unmergedExtractions": [] }
```

**7. Get timeline (excerpt)**

```json
200 { "displayTimeZone": "Asia/Kolkata", "events": [
  { "id": "t8…", "sortOrder": 8, "eventType": "PAYMENT_INITIATED", "occurredAt": "2026-09-24T06:49:00Z", "precision": "EXACT",
    "timeSourceText": "24 Sep 2026, 12:19 PM", "description": "UPI payment of ₹8,500", "confidenceBand": "HIGH", "origin": "AI_GENERATED",
    "correctionStatus": "UNMODIFIED", "original": null, "dismissed": false, "relatedEntityIds": ["n1…","n2…","n3…"],
    "contradictionItemIds": ["m2…"], "sources": [ { "kind": "EXTRACTION", "id": "x9…", "evidenceRef": "E04", "location": { "pageNumber": 1, "lineNumbers": [8] }, "snippet": "Date & time: 24 Sep 2026, 12:19 PM" } ] } ] }
```

**8. Get graph (excerpt)**: see §15. Example: `PAID_TO` from TRANSACTION `6270…8532` (masked) to UPI_ID, `supportCount: 2` (E04, E05).

**9. Get actions (excerpt)**: see §17.1.

**10. Generate a report and retrieve the version list**

```http
POST /api/cases/c1…/report
```

```json
202 { "report": { "version": 1, "status": "GENERATING" }, "run": { "id": "r2…", "kind": "REPORT_GENERATION", "status": "QUEUED" } }
```

```json
GET /api/cases/c1…/reports → 200 { "currentVersion": 1, "versions": [ { "id": "p1…", "version": 1, "status": "GENERATED", "isCurrent": true,
  "generatedAt": "…Z", "contentSha256": "a3f…(64-hex)", "pdfSha256": "…", "confirmation": null } ] }
```

**11. Confirm the version**

```http
POST /api/cases/c1…/reports/1/confirm
{ "contentSha256": "a3f…(64-hex)" }
```

```json
201 { "confirmation": { "id": "k1…", "reportVersion": 1, "contentSha256": "a3f…", "confirmedBy": "you", "confirmedAt": "…Z" } }
```

**12. Export, and a rejected mismatch**

```http
POST /api/cases/c1…/export
{ "reportVersion": 1, "confirmationId": "k1…", "format": "ZIP_BUNDLE", "evidenceIds": ["e4…","e5…"] }
```

```json
202 { "export": { "id": "x1…", "format": "ZIP_BUNDLE", "status": "GENERATING", "reportVersion": 1 } }
```

```json
POST …/export { "reportVersion": 2, "confirmationId": "k1…", "format": "REPORT_PDF" }
409 { "error": { "code": "CONFIRMATION_VERSION_MISMATCH", "message": "This confirmation is for a different report version. Review and confirm version 2.", "requestId": "req_…", "details": { "currentVersion": 2 } } }
```

**13. Verify integrity**

```http
POST /api/evidence/e4…/verify
```

```json
200 { "verificationId": "v1…", "evidenceId": "e4…", "evidenceRef": "E04", "result": "MATCH",
      "recordedSha256": "<64-hex>", "computedSha256": "<same 64-hex>", "failureCode": null,
      "ingestedAt": "2026-10-02T05:01:12Z", "verifiedAt": "2026-10-02T05:20:00Z", "attestation": null,
      "meaning": { "proves": "The stored file is byte-for-byte identical to the file fingerprinted at upload.",
                   "doesNotProve": "That the evidence is truthful or authentic, or that it is legally admissible." } }
```

**14. Scanned PDF after processing** (excerpt from `GET /cases/:id/evidence`)

```json
{ "evidenceRef": "E07", "evidenceType": "PDF", "processingStatus": "FAILED",
  "failure": { "code": "PDF_NO_TEXT_LAYER", "retryable": false, "pagesWithoutText": [1, 2] } }
```

(E07 is illustrative only. It is not part of the six-artifact dataset.)

---

## 34. API Versioning and Compatibility

- **MVP:** a single unversioned API at `/api`, consumed only by the first-party web app, which is deployed together with it.
- **Compatibility:** response fields may be **added** without notice. Clients ignore unknown fields.
- **Breaking changes** (removing or renaming fields, changing semantics or enum meanings) are made in a coordinated web+API release during the MVP.
- If third-party clients ever exist (out of scope), introduce `/api/v2` path versioning. No gateway or version-management system is introduced.

---

## 35. Implementation Boundaries

| Not defined here | Owner |
|---|---|
| Tables, constraints, cascades | `03-DATABASE-SCHEMA.md` |
| Modules, transactions, providers, deployment | `04-TECHNICAL-ARCHITECTURE.md` |
| ReportDocument JSON schema, prompts, step schemas, action templates, checklist detail, confidence thresholds | `06-AI-AGENT-SPECIFICATION.md` |
| Parsing, canonical text bytes (G-3), normalisation/masking rules, OTP detector | `07-EVIDENCE-PROCESSING-PIPELINE.md` |
| Relationship rules, ordering, contradiction tolerance | `08-EVIDENCE-GRAPH-TIMELINE.md` |
| Detailed security controls, rate-limit values, signed-URL lifetimes | `09-SECURITY-PRIVACY-INTEGRITY.md` |
| Screens, copy (error/guidance messages), interactions | `10-FRONTEND-UX-SPECIFICATION.md` |
| Visual design | `11-DESIGN-SYSTEM.md` |
| Test cases for this contract | `15-TESTING-STRATEGY.md` |

---

## 36. API Readiness Checklist

- [x] All Master Spec API endpoints are represented (11/11, paths unchanged).
- [x] No established endpoint was silently renamed. (The request's `/report/export` is noted as absent from the sources; N-1.)
- [x] Every endpoint has authentication/authorisation behaviour (§4, §6).
- [x] Case isolation is enforced (404 for unowned; nested-ID ownership; DB composite FKs).
- [x] Request validation is defined.
- [x] Response contracts are defined.
- [x] The error contract is consistent (§5).
- [x] Evidence upload limits are represented (§8: 10 MB, 20 items, 20 pages, 40 MP, 20,000 characters).
- [x] Scanned-PDF behaviour is represented (§9: fails in processing, pages listed, no facts, no retry).
- [x] `.eml` behaviour is represented (types; attachments listed, not processed; failures non-retryable).
- [x] Analysis/polling behaviour matches the resolved architecture (async run; polling; OD-10).
- [x] Entities are exposed with provenance.
- [x] The timeline is exposed with provenance.
- [x] The graph does not duplicate relationships.
- [x] The missing-information workflow is supported (get, answer, skip).
- [x] Action completion is auditable.
- [x] Report versions are supported.
- [x] Confirmation is tied to a specific report version and checksum.
- [x] Export cannot use a mismatched confirmation.
- [x] Integrity verification handles unreadable evidence correctly (`COULD_NOT_COMPLETE`).
- [x] Raw sensitive evidence is not exposed through audit or API responses.
- [x] Idempotency and concurrency behaviour is defined.
- [x] External provider failures are safely mapped.
- [x] Traceability is complete (§32).
- [x] Example contracts match the specification (§33).
- [x] No deferred feature became an MVP dependency (OD-06, OD-08, OD-09, OD-10, OD-13).
- [x] No unsupported product behaviour was invented.

**Consistency notes (not contradictions):**
- **N-1:** the request's export path does not exist in the sources. The spec paths are preserved.
- **N-2:** the multipart request conflicts with FR-002, OD-14 and Document 04. The sources are followed.
- **N-3:** Document 03 lacks field tables for `analysis_runs` / `agent_steps`. The API uses only the attributes those documents reference. **Follow-up:** add the field tables to Document 03. This does not block the API contract.
- **Derived run failure codes** `EVIDENCE_PENDING` and `CASE_CHANGED_DURING_RUN` are [API-REC] codes. They express PRD FR-006 ("processed in a later run"; gate at `EXTRACTED`) and Document 04 §14 (deletion races). They are not new product behaviour.

No contradiction with Documents 01–04 or `DECISIONS.md` was found.

**Final status: READY FOR IMPLEMENTATION**
