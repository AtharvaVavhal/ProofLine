# Proofline — Decisions Register

| Field | Value |
|---|---|
| File | `docs/DECISIONS.md` |
| Version | 0.2 |
| Date | 2026-10-02 |
| Source | `docs/01-PROOFLINE-MASTER-SPEC.md` v1.0, mainly §27 (Open Decisions Register); `docs/02-PRODUCT-REQUIREMENTS.md` v1.0 |
| Status | All `PROPOSED` items **accepted** (2026-10-02). The four remaining blocking product decisions are **resolved** in §7. **No blocking decisions remain** (§11). |
| Deadline context | Final in-person round is **2026-10-09**, 7 days from this document's date (spec §1). |

---

## 1. How to read this document

- This file **does not change** the Master Spec. Every recommendation here is non-binding until the team marks it `ACCEPTED`. After that, spec §27 should point to this file (spec principle §25.15). That spec edit is a follow-up and is **not** made here.
- Where the spec already fixes something (for example: PostgreSQL, modular monolith, no Redis/graph DB/microservices, NestJS + Next.js + Prisma), this file treats it as a **constraint**, not as an open option.
- Hackathon optimisation criteria used for every recommendation: fast to build, reliable in a live demo, low ops, low cost, easy local dev, easy deploy, no unnecessary infrastructure, providers replaceable later.

### 1.1 Status values

| Status | Meaning |
|---|---|
| `PROPOSED` | Recommendation is ready and needs no information beyond the spec. Needs team sign-off. |
| `NEEDS HUMAN DECISION` | The spec does not give enough information (budget, accounts, credits, hackathon strategy, product judgement). The team must choose. |
| `DEFERRED` | Safe to leave configurable. A default is given. |
| `ACCEPTED` | Team has signed off on the recommendation (all v0.1 `PROPOSED` items, 2026-10-02). |
| `RESOLVED` | Was `NEEDS HUMAN DECISION` or an open gap. The final decision is recorded in §7 or §8. |

### 1.3 Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-02 | Initial register: 16 spec decisions + 6 additional decisions, with recommendations. |
| 0.2 | 2026-10-02 | All `PROPOSED` items accepted. Statuses in §3–§4 updated. OD-03 (scanned PDFs), AD-03 (demo dataset), G-2 (urgency) and G-4 (file limits, email format) resolved in §7. R-1 (`USER_REVIEW`) and R-2 (document numbering), made in the PRD, recorded in §8. Consistency check (§9), follow-up changes (§10) and final status (§11) added. The v0.1 "Implementation-Blocking Decisions" and "Decisions Safe to Defer" lists are replaced by §11. |

**Precedence inside this file:** §7 and §8 override anything earlier in the file that they contradict.

### 1.2 Classification values

| Class | Meaning |
|---|---|
| **BLOCKING · PRD** | Must be settled before `02-PRODUCT-REQUIREMENTS.md`, because it changes user-visible behaviour, scope or acceptance criteria. |
| **BLOCKING · ARCH** | Must be settled before `03-TECHNICAL-ARCHITECTURE.md`, because it changes modules, data model, process topology or contracts. |
| **NON-BLOCKING** | Can stay configurable or be decided later without rework. |

Several decisions are only **partly** blocking. Usually the *contract* or *shape* blocks the architecture, while the *vendor* can be chosen later behind an adapter. Each record says which part blocks.

---

## 2. Scope reconciliation: spec §27 vs. the requested list

Spec §27 has 16 open decisions (OD-01 to OD-16). The 16 topics requested for analysis **overlap with that list but are not identical to it**:

- 10 requested topics map directly to §27 entries.
- 6 requested topics are **not** `OPEN DECISION`s in the spec. They are marked `IMPLEMENTATION DETAIL` or `TO BE DEFINED`, or (for configuration strategy) not mentioned at all. They are registered below as **AD-01 to AD-06** ("additional decisions").
- 6 §27 entries were not in the requested list (OD-05, OD-08, OD-09, OD-10, OD-12, OD-13). They are included anyway because this register must cover all of §27.

**Total: 22 decisions** (16 OD + 6 AD).

| # | Requested topic | Register ID | Where it comes from in the spec |
|---|---|---|---|
| 1 | LLM provider | OD-02 | §27, §19 |
| 2 | OCR provider | OD-03 | §27, FR-007 |
| 3 | Authentication approach | OD-04 | §27, FR-026 |
| 4 | Object storage provider | OD-14 (plus OD-05 encryption) | §27, FR-005, §19 |
| 5 | Export format | OD-07 | §27, FR-020 |
| 6 | Blockchain network / required for MVP? | OD-06 | §27, FR-022 (priority **O**, Optional) |
| 7 | Family/shared-case access | OD-01 | §27, §5 persona 2 |
| 8 | Background jobs / async processing | OD-15 (plus OD-10, OD-12) | §27, FR-006, §18.3 |
| 9 | Scam taxonomy for MVP | **AD-01** | FR-010 *defines the labels*. Multi-label semantics are `IMPLEMENTATION DETAIL`. |
| 10 | AI confidence/provenance representation | **AD-02** | §12.2, §10.5, §14.1 (`IMPLEMENTATION DETAIL`) |
| 11 | Evidence retention/deletion | OD-11 | §27, FR-025, NFR-09 |
| 12 | Demo artifact set | **AD-03** | §22.2 (`TO BE DEFINED`) |
| 13 | Report structure | **AD-04** | FR-017 (sections listed; layout not specified) |
| 14 | Case state transitions | **AD-05** | §6.4 (states from source; failure/re-entry are `IMPLEMENTATION DETAIL`) |
| 15 | Deployment platform | OD-16 (plus OD-13 DB hosting) | §27, §19 ("not specified by source") |
| 16 | Environment/configuration strategy | **AD-06** | Not in spec |
| — | Evidence encryption mechanism | OD-05 | §27 (not in requested list) |
| — | Speech-to-text caller summary | OD-08 | §27 (not in requested list) |
| — | Identity-document uploads | OD-09 | §27 (not in requested list) |
| — | Agent-activity progress delivery | OD-10 | §27 (not in requested list) |
| — | Orchestrator style | OD-12 | §27 (not in requested list) |
| — | PostgreSQL hosting | OD-13 | §27 (not in requested list) |

---

## 3. Decision table

| ID | Decision | Why it matters | Options | Recommended (hackathon) | Reason | Impact on architecture | Class | Status |
|---|---|---|---|---|---|---|---|---|
| OD-01 | Shared / multi-user case access | Defines the authorisation model and the scope of persona 2 | (a) single owner; (b) owner + invited members with roles; (c) share by link | **(a) Single owner**, with all access checks in one guard | FR-001 already says "visible only to its owner". Sharing adds invites, roles and attack surface, and no DoD step needs it. | `Case.user_id` only. One `assertCaseAccess` seam, so a members table can be added later. | BLOCKING · PRD + ARCH | `ACCEPTED` |
| OD-02 | LLM provider and model | Drives extraction quality, structured-output reliability and cost | Anthropic / OpenAI / Google / local open-weights / multi-vendor gateway | **Fix the capability contract now.** Vendor = whichever one the team has credits for that supports schema-constrained output and image input. | Identifiers never come from the LLM alone (GR-01–04), so vendor differences matter less. Vendor choice depends on credits and keys, which the spec does not record. | `LlmProvider` adapter with one structured-output call. Output references OCR line IDs. Cached fallback provider. | BLOCKING · ARCH (contract) | Contract `ACCEPTED`; vendor = implementation decision |
| OD-03 | OCR provider | Determines extraction accuracy and the provenance location model | tesseract.js (local) / Google Cloud Vision / Azure Document Intelligence / AWS Textract / multimodal LLM as OCR | **Fix the OCR output contract (lines + bbox + confidence).** Start with tesseract.js. Switch to cloud OCR if the day-1 spike misreads key fields. Never use the LLM as the OCR source of truth. | Local OCR needs no account or cost, works offline and is deterministic. LLM-as-OCR would make GR-01 validation circular. | `ParsedDocument` contract. PDFs with a text layer bypass OCR. Scanned PDFs are a scope question. | BLOCKING · ARCH (contract); PRD (scanned PDFs) | `ACCEPTED`; scanned PDFs unsupported in MVP (§7.1); engine = implementation decision |
| OD-04 | Auth implementation | Gates all case data, and sessions must be revocable (FR-026) | (a) self-built email OTP + DB sessions in NestJS; (b) Supabase Auth; (c) Clerk/Auth0; (d) Auth.js magic link | **(a) Email OTP + opaque DB sessions in an httpOnly cookie, same-origin via Next.js rewrites** | Small amount of code. Revocable and auditable. No identity split across systems. SMS OTP is impractical in India within 7 days (sender registration). | `users`, `otp_challenges`, `sessions` tables. Global auth guard. Same-origin proxy constrains deployment. | BLOCKING · ARCH | `ACCEPTED`; email vendor = implementation decision |
| OD-05 | Evidence encryption mechanism | Decides whether signed download URLs are possible at all | (a) provider-managed encryption at rest; (b) app-level envelope encryption | **(a) Provider-managed encryption at rest**, private bucket, short-lived signed URLs | With envelope encryption, signed URLs would serve ciphertext, so every download would have to stream through the API, plus key management. | Storage adapter keeps a seam for later envelope encryption. Pitch says "encrypted at rest", never "end-to-end". | BLOCKING · ARCH | `ACCEPTED` |
| OD-06 | Blockchain attestation: build it? which network? | Hackathon theme fit vs. time. Spec marks it Optional. | Skip / EVM testnet calldata tx / EVM testnet minimal contract / other chain | **Not required for MVP (spec FR-022 = O).** Build last, behind `LEDGER_ENABLED`. If built: EVM testnet, zero-value tx with hash + opaque ref in calldata. | Off the critical path by spec. Schema and adapter seam exist either way. | Nullable `attestation_ref`; async attestation job; "attestation unavailable" result already defined. | NON-BLOCKING | `DEFERRED` (default: not built; go/no-go 2026-10-06) |
| OD-07 | Export format | Defines what the victim actually leaves with | PDF only / JSON only / ZIP bundle / HTML | **Structured JSON snapshot (canonical) → PDF via a pure-JS renderer. Export = ZIP of PDF + `case.json` + `manifest.json` (SHA-256 per file) + selected originals.** PDF alone also downloadable. | A PDF is readable by a stressed user. The manifest lets anyone re-check hashes. No headless browser in production. | Report module = snapshot → renderer → stored file + checksum. `exports` records. Deletion must remove export files. | BLOCKING · PRD + ARCH | `ACCEPTED` |
| OD-08 | Speech-to-text caller summary | Optional feature with real scope cost | Build / skip | **Skip** unless the full DoD is done | Not in the MVP table. Adds an audio pipeline and another provider. | None if skipped (would be another evidence type later). | NON-BLOCKING | `DEFERRED` (default: excluded) |
| OD-09 | Accept identity-document uploads | Privacy risk. Demo must never use real IDs. | Accept / do not accept | **Do not accept.** Show "keep your ID ready for official reporting" plus copy asking users not to upload IDs. | No requirement needs the image, and accepting it raises PII exposure. | None. | NON-BLOCKING | `DEFERRED` (default: not accepted) |
| OD-10 | Agent-activity progress delivery | Demo visibility of the agentic workflow | Polling / SSE / WebSocket | **Polling** (about 1.5 s while a run is active) | Works through the Next.js same-origin proxy with no buffering or timeout issues. The same API resource can later be served over SSE. | `GET` activity endpoint either way. | NON-BLOCKING | `DEFERRED` (default: polling) |
| OD-11 | Retention / deletion behaviour | Privacy promise. Defines cascades and the audit design. | Hard delete / soft delete + purge / time-based auto-expiry | **User-initiated hard delete. No auto-expiry in MVP.** Recompute or remove derived data and invalidate reports. Audit entries kept but never contain content or PII. | Soft delete risks leaking through a missed filter. Auto-expiry has no demo value. | Cascading FKs; audit has no FK to case; object delete after DB commit; running jobs must tolerate deletion. | BLOCKING · PRD + ARCH | `ACCEPTED` |
| OD-12 | Orchestrator style | Reliability vs. "agentic" depth | Fixed pipeline / LLM tool-calling planner / hybrid | **Deterministic state machine. Deterministic `plan()` picks steps by evidence type and shows the plan in the feed. LLM calls only inside steps.** | Reproducible benchmark and per-step cached fallback. Evidence text cannot steer tool choice (GR-10). Matches the spec's hybrid recommendation. | `analysis_runs` / `agent_steps` tables. `Step` interface. Idempotent steps. | BLOCKING · ARCH | `ACCEPTED` |
| OD-13 | PostgreSQL hosting | Where data lives | Supabase / Neon / Railway Postgres / self-hosted | **Any managed Postgres 15+, ideally the same vendor as storage. Docker Postgres locally.** | The architecture uses plain Postgres with no vendor extensions. | Use a direct (non-transaction-pooled) connection for the queue. | NON-BLOCKING | `DEFERRED` (decide with OD-16 vendors before first deploy) |
| OD-14 | Object storage provider + upload transport | Evidence privacy. Hashing must happen on original bytes (FR-004). | Supabase Storage / S3 / Cloudflare R2 / MinIO; direct signed upload vs. proxy through API | **Spec-compliant signed upload + server-side "complete" step that streams the object and computes SHA-256.** Vendor: Supabase Storage (named in spec), with the Supabase CLI stack locally. | Keeps large bodies off the API. Hash is computed by the server on exactly the stored bytes. No spec change needed. | `ObjectStorage` adapter; 3-step upload; storage CORS for the web origin. | BLOCKING · ARCH (flow) | Flow `ACCEPTED`; vendor = implementation decision |
| OD-15 | Job queue implementation | Async analysis, retries, idempotency (NFR-05) | pg-boss / hand-rolled `SKIP LOCKED` table / BullMQ + Redis / in-process promise | **pg-boss in the API process**, plus own `analysis_runs` / `agent_steps` tables for domain state | Uses existing Postgres, has retries built in and survives restarts. Spec excludes Redis unless required. | Needs a persistent Node process (API cannot run on serverless functions). | BLOCKING · ARCH | `ACCEPTED` |
| OD-16 | Deployment target | Demo URL, Round 2 video, 9 Oct live demo | Vercel + container host + managed DB/storage / single VPS / all-on-Railway / local only | **Shape: Next.js on Vercel; NestJS API + worker as one always-on container; managed Postgres + storage; full docker-compose local stack as backup.** | Each piece runs on its natural host, ops are minimal, and the local backup survives venue Wi-Fi. | Same-origin rewrites; no serverless API; no sleeping free tiers. | BLOCKING · ARCH (shape) | Shape `ACCEPTED`; vendors = implementation decision |
| AD-01 | Scam taxonomy codes and multi-label semantics | Drives DB enum, prompts, checklist and dashboard label | Spec's 9 labels as-is / split or extend labels / free text | **Spec's 9 labels verbatim as enum codes. Exactly one primary + 0..n secondary labels, each cited. `UNKNOWN_OTHER` only alone.** | The label list is already fixed by FR-010. Adding labels would change the spec. | Enum + `case_signals`. `incident_type` = primary label. A derived `financial_loss_reported` flag selects the checklist variant. | BLOCKING · PRD + ARCH | `ACCEPTED` |
| AD-02 | Confidence and provenance representation | 100% provenance coverage must be checkable (NFR-04, GR-06) | Numeric only / bands only / numeric + band; JSON blobs vs. relational source refs | **Typed provenance on every extraction. Uniform relational `SourceRef` (EXTRACTION / EVIDENCE / USER_STATEMENT). Confidence stored 0–1 but displayed as High/Medium/Low.** | Provenance is queryable for coverage checks and deletion recomputation. Bands avoid false precision. | Core of the schema. Report renderer refuses facts without sources. | BLOCKING · ARCH | `ACCEPTED` |
| AD-03 | Demo artifact set | Benchmark, OCR spike, fallback keys and PRD acceptance all depend on it | Adopt spec §22.2 proposal / redesign | **Adopt E01–E06 from §22.2, with E04 as a text-layer PDF. Plant one gap (bank name) and one contradiction (payment time). Fallback keyed by artifact SHA-256.** | Exercises PNG, PDF and pasted-text paths. Satisfies FR-014/015 demo steps. Makes the fallback impossible to use on non-synthetic files. | Committed artifacts + expected-output benchmark + hash manifest. | BLOCKING · PRD | `ACCEPTED`; canonical dataset in §7.2 |
| AD-04 | Report structure | What "complaint-ready" means. Provenance enforcement point. | Free-form LLM text / templated sections from structured data | **Templated, NCRP-aligned sections from a versioned JSON snapshot. LLM writes only the summary and signal explanation, citing fact IDs.** | Enforces GR-06/07 mechanically. Deterministic and easy for the user to copy into NCRP. | `ReportDocument` schema (versioned). Checksums on JSON and PDF. Confirmation bound to version. | BLOCKING · PRD + ARCH | `ACCEPTED` |
| AD-05 | Case state transitions | Re-entry, failure, export gate | Linear only / add FAILED state / per-run failure flag | **Keep the 10 source states. Failure lives on runs and steps, not on the case. Explicit re-entry table. One transition service.** | Retry resumes at the failed step. Case status always means "furthest current stage". | `CaseStateService`, transition table, audit per transition. | BLOCKING · PRD + ARCH | `ACCEPTED`; `USER_REVIEW` per R-1 (§8) |
| AD-06 | Environment / configuration strategy | Provider swapping, fallback safety, local dev | Env vars + schema validation / config files / flag service | **pnpm monorepo (`apps/web`, `apps/api`, `packages/shared`). Env vars validated at boot with zod. Providers chosen by env. `DEMO_FALLBACK=off\|auto\|force`.** | Fail-fast config, one-line provider swaps, and shared typed contracts (spec principle 4). | Config module; shared zod schemas; `.env.example` per app. | BLOCKING · ARCH | `ACCEPTED` |

---

## 4. Blocking decision records

### OD-01 — Shared / multi-user case access

```text
Decision:            Whether a case can be accessed by more than one user account (family-member persona).
Recommended:         Single-owner cases. Every case-scoped request passes through one server-side
                     check (assertCaseAccess(userId, caseId)). No sharing UI, no invites, no roles.
                     A helper either uses the victim's session on the same device or creates their own case.
Alternative:         case_members table (owner/editor) with email invites and per-member audit actor.
Why:                 FR-001 already states "visible only to its owner"; no Definition-of-Done step needs
                     sharing; invites/roles add a meaningful account-takeover and data-leak surface
                     (§16.1) for no demo value. Persona 2's stated need (multi-file upload + checklist)
                     is met without sharing.
Architecture impact: Ownership = Case.user_id. Authorisation centralised in one guard/service so that a
                     membership table can be added later without touching controllers. Audit actor is
                     always the owner in MVP.
Can this be changed later?: Yes, additively (new table, change one guard, backfill owner rows).
Status:              ACCEPTED (2026-10-02).
```

### OD-02 — LLM provider and model

| Layer | Content |
|---|---|
| **Product requirement** | AI proposes extractions, writes a calibrated classification explanation, phrases follow-up questions and the incident summary. It never invents identifiers, bank names or official channels (§11). |
| **Architectural requirement (from spec)** | Tool-calling, multimodal-capable model (§19). Behind an adapter (§18.3). Typed, validated outputs (§10.5). One case per call (NFR-08). Evidence delimited as untrusted data (GR-10). Deterministic fallback (FR-027). Provider data-retention terms considered (§16.3). |
| **Implementation choice (open)** | Vendor, model, SDK, prompt design. |

```text
Decision:            Which LLM vendor/model, and what contract the rest of the system relies on.
Recommended:         Fix the CONTRACT now, pick the VENDOR before implementation day 1.
                     Contract: LlmProvider.generateStructured(schema, instructions, evidenceBlocks, images?)
                     returning an object validated against a zod-derived JSON Schema. Evidence is passed
                     as delimited OCR text with line IDs. For identifiers, the model returns
                     {field_type, value, line_ids[]}; a deterministic validator accepts the value only
                     if it occurs literally (after normalisation) in those lines, otherwise rejects it
                     (GR-01–GR-04). One model for all steps, lowest-variance settings it supports.
                     Vendor selection criteria: (1) native schema-constrained structured output,
                     (2) image input, (3) acceptable API data-usage/retention terms, (4) the team
                     already has keys/credits. Verify (1)–(3) on the vendor's current documentation.
Alternative:         Multi-vendor gateway/routing; local open-weights model (no key, but weaker
                     structured output and slow on laptops — not recommended for a live demo).
Why:                 Structured-output reliability is the main driver of accuracy and demo stability.
                     Because identifiers are validated against OCR text, the LLM is never the source of
                     truth for them, which keeps the vendor choice low-risk and swappable.
Architecture impact: Extraction step contract references OCR line IDs. A single prompt builder enforces
                     case scoping and evidence delimiting. Each call recorded on its agent_step
                     (provider, model, latency, token counts — never evidence content). A
                     CachedLlmProvider serves the synthetic set when DEMO_FALLBACK applies (AD-06).
Can this be changed later?: Yes — env LLM_PROVIDER/LLM_MODEL plus adapter. Real switching cost is
                     prompt re-tuning and a benchmark re-run.
Status:              Contract ACCEPTED (2026-10-02). Vendor is an implementation decision (§11).
```

### OD-03 — OCR provider

| Layer | Content |
|---|---|
| **Product requirement** | Key fields are found on the six synthetic artifacts (> 95%, §23). The user can see the source snippet for each fact. |
| **Architectural requirement (from spec)** | OCR runs before LLM reasoning and returns positional structure: page, region/bbox, line (FR-007). Identifiers are validated against parsed text (FR-008, NFR-11). Adapter (§18.3). Data-handling terms (§16.3). |
| **Implementation choice (open)** | Engine/vendor, preprocessing. |

```text
Decision:            Which OCR engine, and what the OCR output looks like.
Recommended:         Contract: ParsedDocument { engine, engineVersion, pages[], lines[{ id, page, text,
                     bbox (normalised 0–1), confidence }] }.
                     Routing: pasted text / TXT / email export → direct text parsing (no OCR);
                     PDF with a text layer → PDF text extraction with positions; PNG/JPG → OCR engine.
                     Engine: start with tesseract.js (local, free, no account, offline, word/line bboxes).
                     Run a day-1 spike on the six synthetic artifacts (AD-03). If any key field
                     (₹ amount, UTR, UPI ID, phone, URL) is misread, switch the default to a cloud OCR
                     (e.g., Google Cloud Vision document text detection) through the same adapter.
                     Never use the multimodal LLM as the OCR source of truth.
Alternative:         Cloud OCR from the start (higher accuracy on real-world screenshots; requires a
                     cloud account, credentials for every developer, and network on demo day).
Why:                 Synthetic artifacts are clean and under our control, so a local engine may be
                     enough and has zero cost/setup. Using the LLM as OCR would make the GR-01 check
                     circular (LLM output validated against LLM output).
                     Known risk: Tesseract can misread the ₹ glyph or small digits. A misread digit
                     still passes the literal-match check, so the benchmark must compare values, not
                     just presence.
Architecture impact: Provenance location = line IDs + bbox (AD-02). tesseract.js is WASM (no native
                     binary in the container); its language data must be bundled/cached, never
                     downloaded at demo time.
                     SCOPE QUESTION: image-only (scanned) PDFs need rasterisation or a cloud engine.
                     Recommendation: MVP supports text-layer PDFs only; scanned PDFs are rejected with
                     "upload a screenshot instead". This narrows FR-002 and therefore needs sign-off.
Can this be changed later?: Yes — env OCR_PROVIDER plus adapter; re-run benchmark.
Status:              Contract and decision rule ACCEPTED (2026-10-02). Scanned-PDF scope RESOLVED in §7.1
                     (unsupported in MVP). Final engine is an implementation decision (§11).
```

### OD-04 — Authentication approach

```text
Decision:            How users authenticate and how sessions work (FR-026).
Recommended:         Email OTP implemented in the NestJS Auth module.
                     - 6-digit code, stored hashed, ~10 min expiry, max attempts, rate-limit per email/IP.
                     - On verify: create an opaque random session token, store only its hash in a
                       sessions table, send it as an httpOnly + Secure + SameSite=Lax cookie.
                       New session on every login (rotation); logout/revoke deletes the row; sessions expire.
                     - Browser calls the API same-origin through Next.js rewrites (/api/* → NestJS), so
                       the cookie is first-party (avoids third-party-cookie blocking across domains).
                     - Email delivery behind an EmailTransport adapter: "console" (code printed to the
                       API log) allowed only outside production; a transactional email API or SMTP in
                       the deployed environment.
                     - Email only. No SMS OTP in MVP.
                     - Demo: log in before going on stage. Do not add an OTP bypass to the deployed app.
Alternative:         Supabase Auth email OTP, with NestJS verifying its JWTs (less code; but identity
                     lives in a second system, stateless JWTs make "revocable sessions" weaker, and the
                     default mail sender is rate-limited so custom SMTP is needed anyway).
                     Clerk/Auth0: fast, but adds a vendor and its frontend SDK for one login screen.
Why:                 A few hours of code, no lock-in, revocable sessions as FR-026 requires, auth events
                     land in our own audit log. SMS OTP in India requires sender registration that does
                     not fit a 7-day timeline.
Architecture impact: Tables: users, otp_challenges, sessions. Global auth guard; every other module only
                     depends on request.user.id. CSRF mitigated by SameSite=Lax + JSON-only mutations +
                     Origin check. Same-origin proxy is a hard requirement on deployment (OD-16).
Can this be changed later?: Yes — only the Auth module changes if other modules depend solely on
                     request.user.id.
Status:              ACCEPTED (2026-10-02). Email vendor is an implementation decision (§11).
```

### OD-05 — Evidence encryption mechanism

```text
Decision:            How evidence is encrypted at rest (FR-005, §16.2).
Recommended:         Storage provider's managed server-side encryption at rest (confirm it is enabled),
                     TLS in transit, private bucket, short-lived signed URLs (minutes), access only after
                     the case-ownership check. No application-level/envelope encryption in MVP.
Alternative:         Envelope encryption: per-object data key (AES-256-GCM) wrapped by a master key held
                     in env or a KMS.
Why:                 With envelope encryption the stored object is ciphertext, so signed download URLs
                     would hand the browser ciphertext; every preview, download and export would have to
                     stream through the API, and keys must be managed and rotated. Provider-managed
                     encryption satisfies source §13.2 ("managed key infrastructure").
Architecture impact: SHA-256 is computed on the original plaintext bytes either way (FR-004). The
                     storage adapter (putObject/getObjectStream) is the seam where envelope encryption
                     could be added later. Pitch/UI wording: "encrypted at rest", not "end-to-end".
Can this be changed later?: Yes, but it requires re-encrypting existing objects and moving downloads to
                     backend streaming. Do it before handling real data, not during the hackathon.
Status:              ACCEPTED (2026-10-02).
```

### OD-07 — Export format

```text
Decision:            What the user downloads at export (FR-020) and how it is produced.
Recommended:         Canonical report = versioned structured JSON snapshot (AD-04), checksummed.
                     Rendered to report.pdf with a pure-JS PDF library (e.g., pdfmake or
                     @react-pdf/renderer). Disclaimer on every page.
                     Export = ZIP bundle containing:
                       report.pdf      complaint draft incl. evidence index
                       case.json       the structured snapshot (machine-readable)
                       manifest.json   report version, review-confirmation time, SHA-256 of every
                                       file in the bundle and of each original evidence item
                       evidence/       originals the user selected (original bytes, so hashes match)
                     The PDF alone is also downloadable. Everything is served via short-lived signed URLs.
Alternative:         HTML→PDF via headless Chromium (Puppeteer/Playwright): nicer layout, but a large
                     binary, container tuning and a common demo-day failure point. JSON-only: not
                     usable by a non-technical victim.
Why:                 The PDF is what a stressed user can read, print or attach. The manifest makes the
                     integrity story checkable by anyone outside Proofline. No browser runtime is needed
                     in production.
Architecture impact: Report module pipeline: snapshot → renderer → object storage (+ checksum).
                     An exports record (which report version, which files) feeds the audit log.
                     Deletion (OD-11) must also delete stored report and export files.
Can this be changed later?: Yes — renderer is swappable; formats are additive.
Status:              ACCEPTED (2026-10-02).
```

### OD-11 — Evidence retention / deletion behaviour

```text
Decision:            Retention defaults and exactly what deletion does (FR-025, NFR-09).
Recommended:         - No automatic expiry in MVP (synthetic data only). PRD states: "kept until you delete
                       it"; the demo environment is wiped after the hackathon.
                     - User-initiated HARD delete.
                     - Delete evidence: delete the object; delete its extractions; delete entities left
                       with no supporting extraction; delete relationships citing it; delete timeline
                       events whose only source it was; mark all report versions invalidated, delete their
                       stored PDF/export files and void review confirmations; move case state back
                       (AD-05).
                     - Delete case: delete all rows and all objects (evidence, reports, exports).
                     - Audit log: entries are kept, but audit metadata NEVER contains evidence content,
                       filenames, extracted values or other PII (only IDs, hashes, counts, action names),
                       so keeping them leaks nothing. One tombstone entry per deletion.
                     - On-chain hashes (if any) cannot be deleted; they contain no PII by design.
Alternative:         Soft delete (deleted_at) + background purge; fixed auto-expiry (e.g., 30 days).
Why:                 Soft delete risks a missed WHERE clause exposing "deleted" evidence, contradicting
                     "can no longer be retrieved through any API". Auto-expiry adds a scheduled job and a
                     policy with no demo value.
Architecture impact: FK cascades from case → children and evidence → extractions; audit_log stores
                     plain IDs with no FK so it survives deletion. Object deletion runs after the DB commit
                     with retry and orphan logging. In-flight analysis jobs must check that the case or
                     evidence still exists and stop cleanly (race with deletion). Relational SourceRefs
                     (AD-02) make "events whose only source was X" a simple query.
Can this be changed later?: Yes — retention windows or soft delete can be added later.
Status:              ACCEPTED (2026-10-02), including report invalidation on evidence deletion.
```

### OD-12 — Orchestrator style

```text
Decision:            Whether control flow is a fixed pipeline, an LLM planner, or a hybrid.
Recommended:         Deterministic state machine (AD-05). A deterministic plan() inspects the case's
                     evidence types and current state and produces an ordered step list (e.g., skip OCR
                     for pasted text). The plan is shown in the agent-activity feed. LLM calls happen only
                     inside steps (extraction, classification explanation, follow-up question wording,
                     summary). Each step is idempotent, keyed by (case_id, step, input_hash), and persists
                     its validated output.
Alternative:         LLM tool-calling planner that chooses the next tool; or LLM-only for follow-up
                     question selection.
Why:                 Reproducible benchmark results; per-step cached fallback; prompt injection in evidence
                     cannot change tool choice (GR-10, §16.1); the visible plan still demonstrates
                     planning, tool use, state and human-in-the-loop (§10.1). Matches the spec's hybrid
                     recommendation.
Architecture impact: analysis_runs and agent_steps tables; Step interface { name, dependsOn,
                     run(ctx) → validated output }; the Orchestrator is a function over case state, not a
                     separate service.
Can this be changed later?: Yes — plan() can be replaced by an LLM planner behind the same Step interface.
Status:              ACCEPTED (2026-10-02). Pitch framing is handled in 16-HACKATHON-PITCH.md.
```

### OD-14 — Object storage provider and upload transport

| Layer | Content |
|---|---|
| **Product requirement** | Evidence is private to its owner and can be previewed and downloaded by them. |
| **Architectural requirement (from spec)** | Object storage, off-chain, encrypted at rest, not public. Short-lived signed URLs or authorised backend stream (FR-005). Signed upload URLs (FR-002). SHA-256 over original bytes before any transformation (FR-004). |
| **Implementation choice (open)** | Vendor, SDK, local emulator. |

```text
Decision:            Which object store, and how bytes get there while still being hashed server-side.
Recommended:         Flow (keeps the spec's signed-upload transport, needs no spec change):
                       1. POST /cases/:id/evidence (metadata only) → Evidence row status=uploading
                          + short-lived signed upload URL.
                       2. Browser PUTs the file directly to storage.
                       3. POST /evidence/:id/complete → API streams the stored object, computes SHA-256,
                          checks content type by magic bytes and size, sets status=uploaded, writes
                          audit. On validation failure the object is deleted and the item rejected.
                     Pasted text/URL goes to the API, is converted to canonical bytes (proposal: UTF-8,
                     Unicode NFC, CRLF→LF, nothing else trimmed — must be documented per FR-004), hashed
                     and stored by the API.
                     Adapter: ObjectStorage { createSignedUploadUrl, createSignedDownloadUrl,
                     getObjectStream, putObject, deleteObject }.
                     Vendor: Supabase Storage (named in the spec), private bucket with a bucket-level size
                     limit, server-side key only in the API. Locally: the Supabase CLI stack (Postgres +
                     Storage in Docker).
Alternative:         S3 API everywhere (MinIO locally; Cloudflare R2 or AWS S3 hosted) via AWS SDK
                     presigned URLs. Or proxy uploads through the API (simplest code, but large request
                     bodies through the Next.js proxy and a deviation from FR-002).
Why:                 Hash is computed by the server on exactly the bytes that are stored, which is what
                     verification later recomputes. API requests stay small, which matters behind the
                     Next.js rewrite proxy.
Architecture impact: Three-step upload in the API spec; storage CORS must allow the web origin for PUT;
                     per-evidence status starts at "uploading"; storage vendor credentials only in the API.
Can this be changed later?: Yes — adapter + env STORAGE_DRIVER. Migrating objects is a copy job.
Status:              Flow ACCEPTED (2026-10-02). Vendor is an implementation decision (§11).
```

### OD-15 — Background jobs / asynchronous processing

```text
Decision:            How analysis runs asynchronously with retries and without duplicates (FR-006, NFR-05).
Recommended:         pg-boss (Postgres-backed job queue for Node) running inside the NestJS process,
                     enabled by WORKER_ENABLED=true. Queues: analyze-case (one active run per case via a
                     singleton key) and, only if OD-06 is built, attest-evidence. Job payloads carry IDs
                     only. Domain progress lives in our own analysis_runs / agent_steps tables, which drive
                     the activity feed (FR-024) and step-level idempotency; pg-boss only handles delivery,
                     retry and expiry. Inside one run, per-evidence OCR/extraction runs with limited
                     concurrency.
Alternative:         Hand-rolled jobs table polled with SELECT … FOR UPDATE SKIP LOCKED (no dependency,
                     but retries, timeouts and stuck-job recovery written by hand). BullMQ + Redis
                     (excluded by spec §25.12 unless a requirement needs it). Fire-and-forget promise
                     (lost on restart, no retry — violates NFR-05).
Why:                 No new infrastructure, retries/backoff built in, survives restarts, matches §18.3.
Architecture impact: Requires a persistent long-running Node process, so the API cannot run on
                     serverless functions (constrains OD-16). pg-boss manages its own schema, kept out of
                     Prisma migrations. Use a direct (session-level) DB connection rather than a
                     transaction-mode pooler. API and worker share CPU at demo scale; can be split into a
                     second process of the same codebase by env flag.
Can this be changed later?: Yes — Step logic is independent of the queue library.
Status:              ACCEPTED (2026-10-02).
```

### OD-16 — Deployment platform

| Layer | Content |
|---|---|
| **Product requirement** | A working, reachable demo for Round 2 (video + judges). A reliable live demo on 2026-10-09. |
| **Architectural requirement (derived from OD-04, OD-15)** | Persistent process for API + worker. Web and API same-origin. HTTPS. Secrets server-side only. |
| **Implementation choice (open)** | Hosting vendors, plan tiers. |

```text
Decision:            Where and how each part runs.
Recommended:         Shape (3 deployables at most):
                       1. Next.js web on Vercel; rewrites /api/* to the API.
                       2. NestJS API + worker as ONE Docker container on an always-on container host
                          (e.g., Railway, Render paid instance, Fly.io). Avoid free tiers that sleep;
                          a tens-of-seconds cold start mid-demo is a real risk.
                       3. Managed Postgres + object storage (one vendor if possible; see OD-13/OD-14).
                     Plus a docker-compose local stack that runs the complete demo on a laptop as the
                     on-stage backup, with DEMO_FALLBACK=auto (AD-06).
                     Migrations run on deploy (prisma migrate deploy). Health-check endpoint on the API.
Alternative:         One VPS with docker compose + a reverse proxy (cheapest, most ops); everything on
                     Railway (web + API + Postgres) with S3/R2 storage; local-only demo.
Why:                 Each part runs on its natural host with minimal ops and low cost; the local backup
                     protects against venue network failure.
Architecture impact: API is never deployed as serverless functions (worker, long OCR). Same-origin
                     rewrites are mandatory (cookies, no CORS on the API). Storage CORS allows the web origin.
Can this be changed later?: Yes — the API is a portable container; web is a standard Next.js app.
Status:              Shape ACCEPTED (2026-10-02). Vendors are an implementation decision (§11).
```

### AD-01 — Scam taxonomy for MVP

```text
Decision:            Enum codes and multi-label rules for FR-010.
Recommended:         Labels exactly as FR-010 lists them:
                       PHISHING · KYC_IMPERSONATION · FAKE_INVESTMENT · FAKE_JOB_OR_LOAN · UPI_FRAUD ·
                       ACCOUNT_TAKEOVER · DIGITAL_ARREST_IMPERSONATION · MARKETPLACE_FRAUD · UNKNOWN_OTHER
                     Semantics: exactly one primary label + 0..n secondary labels; each label carries a
                     confidence band (AD-02) and ≥ 1 SourceRef; UNKNOWN_OTHER may only appear alone as
                     primary. Rules propose candidate signals from entities/keywords; the LLM picks and
                     explains from the fixed enum; output validated against the enum and checked for
                     forbidden phrasing (GR-12).
                     Case.incident_type (source data model) = primary label. A separate derived flag
                     financial_loss_reported (any payment/debit amount extracted or user-stated) selects
                     the NCRP checklist variant (financial vs. all incidents) for FR-014 and FR-016.
                     Expected demo result: primary KYC_IMPERSONATION; secondary UPI_FRAUD, PHISHING
                     (dashboard "KYC/UPI").
Alternative:         Split FAKE_JOB_OR_LOAN; add labels (e.g., courier/parcel, tech support, SIM swap).
                     Any added label changes the spec and needs explicit approval (§25.13).
Why:                 The label list is already fixed by the spec; only codes and multi-label semantics are
                     open. A fixed enum gives DB validation, schema-validated LLM output and a
                     deterministic demo.
Architecture impact: DB enum/check constraint; case_signals storage; action templates and missing-info
                     checklists keyed by label + financial flag.
Can this be changed later?: Yes — adding a label = migration + prompt + templates.
Status:              ACCEPTED (2026-10-02).
```

### AD-02 — AI confidence and provenance representation

```text
Decision:            How provenance and confidence are stored and shown.
Recommended:         Extraction provenance (typed, one per extraction):
                       { evidenceId, method: OCR | PDF_TEXT | TEXT_PARSE | RULE | LLM | USER,
                         location: { page?, lineIds[], bbox? (normalised 0–1) }, snippet (short, from
                         parsed text; masked per GR-09 when displayed) }
                     Every higher-level fact (entity, relationship, timeline event, scam signal, action,
                     report field) cites sources through a uniform SourceRef:
                       { kind: EXTRACTION | EVIDENCE | USER_STATEMENT, id }
                     stored RELATIONALLY (not only inside JSON), so coverage checks and deletion
                     recomputation are plain queries.
                     User statements (follow-up answers, corrections, user-added events) are
                     user_statements rows: not evidence, not fingerprinted, always shown as "You stated…".
                     Pasted notes uploaded as evidence (e.g., E06) remain Evidence and are fingerprinted.
                     Confidence: stored 0–1 plus a derived band (HIGH / MEDIUM / LOW; thresholds an
                     implementation detail). The UI and report show the band only. For identifiers,
                     confidence is computed deterministically (OCR line confidence × validator result),
                     not taken from the LLM. LLM-reported confidence is used only for judgements
                     (classification, inferred ordering) and is never displayed as a number.
                     Corrections keep the original AI value plus corrected_value, corrected_by,
                     corrected_at and a SourceRef to the user statement.
Alternative:         Numeric confidence only; provenance as free JSON per fact; polymorphic source
                     columns per table.
Why:                 NFR-04/GR-06 demand 100% provenance on key facts, which is only enforceable if it
                     is queryable. Bands avoid false precision and match the calibrated-language rule.
Architecture impact: Central to the schema document. Report renderer refuses any key fact with no
                     SourceRef (GR-06). Provenance-coverage metric (§23) computed by query.
Can this be changed later?: Physical layout can change; the SourceRef concept should not, since every
                     module depends on it.
Status:              ACCEPTED (2026-10-02).
```

### AD-03 — Demo artifact set

```text
Decision:            The exact six synthetic artifacts and what is planted in them.
Recommended:         Adopt the §22.2 proposal, with formats chosen to exercise every ingestion path:
                       E01  PNG  fake KYC SMS (sender header, URL, phone)                        12:03
                       E02  PNG  chat screenshot with "support agent" (same phone, same URL)     12:07
                       E03  PNG  browser screenshot of phishing page on a *.example domain
                                 requesting credentials/OTP; fictional bank name, no real logos  12:11 / 12:16
                       E04  PDF  UPI receipt WITH a text layer (UPI ID, ₹8,500, UTR, time)       12:19
                       E05  PNG  bank debit SMS (₹8,500, same UTR, masked account hint)          12:21
                       E06  text pasted user note about the call (phone, approximate times)      12:07
                     Planted gap: the debited bank's name appears nowhere → "Not provided" → one
                     follow-up question → user answers (FR-014/015 demo).
                     Planted contradiction: E06 says the payment was "around 12:30"; E04 shows 12:19 →
                     flagged with both sources; Proofline does not pick a winner.
                     Timeline correction (FR-013 demo): user corrects the call event that only E06 supports.
                     All identifiers fictional: *.example domains, a fictional UPI handle suffix,
                     clearly fictional phone numbers checked by the team, synthetic 12-digit UTR.
                     Commit: the artifacts, an expected-output benchmark file (§23), and a manifest of
                     each artifact's SHA-256. The cached fallback (FR-027) is keyed by these hashes, so it
                     cannot apply to any non-synthetic file.
Alternative:         Redesign the scenario; use only PNGs (simpler OCR, but leaves the PDF path untested).
Why:                 The OCR spike (OD-03), benchmark (§23), fallback keys (AD-06) and PRD acceptance
                     criteria all depend on the exact files.
Architecture impact: Benchmark runner; fallback cache lookup by SHA-256; no runtime dependency on how
                     artifacts were generated (they are generated once and committed).
Can this be changed later?: Yes, but every change invalidates the benchmark and fallback cache, so freeze
                     early (recommended by 2026-10-03).
Status:              ACCEPTED (2026-10-02). The exact dataset is RESOLVED in §7.2, which is canonical.
                     Where this v0.1 record differs (e.g., the user-note payment time), §7.2 wins.
```

### AD-04 — Exact report structure

```text
Decision:            Sections and generation method of the complaint draft (FR-017, FR-018).
Recommended:         Templated sections built from a versioned JSON snapshot (ReportDocument,
                     with schemaVersion); NCRP-checklist order so the user can copy fields across (§3.4).
                       0. Header: case reference, report version, generated_at, review status,
                          AI-assisted / not official / not legal advice notice (GR-13)
                       1. Incident summary (only free-text section besides 5; must cite fact IDs)
                       2. Incident date and time
                       3. Financial details: amount, transaction ID/UTR, transaction date,
                          bank/wallet/merchant
                       4. Identifiers observed in evidence: phones, URLs/domains, UPI IDs, handles,
                          SMS headers, emails ("observed in evidence", never "the fraudster is", GR-08)
                       5. Scam-pattern signals with calibrated explanation and citations (GR-12, GR-15)
                       6. Timeline (with precision markers and user-corrected marks)
                       7. Missing information and contradictions
                       8. Recommended actions and official channels (curated static list, GR-14)
                       9. Evidence index: E-ref, type, label, uploaded_at, SHA-256, integrity status,
                          attestation reference (if any), key facts derived
                      10. Reminder: keep your identity document ready for official reporting (OD-09)
                     Every field shows value + source marker, or "Not provided" (GR-07). User-stated
                     facts are visibly labelled as user statements.
Alternative:         LLM-written free-form report with post-hoc citation checking.
Why:                 Provenance and "Not provided" enforced by construction, deterministic output,
                     easy to verify against the benchmark.
Architecture impact: ReportDocument schema in packages/shared; renderer is a pure function of the
                     snapshot; checksums of JSON and PDF stored; review confirmation is bound to the
                     report version + checksum.
Can this be changed later?: Yes — sections are additive; bump schemaVersion.
Status:              ACCEPTED (2026-10-02).
```

### AD-05 — Case state transitions

```text
Decision:            Allowed transitions, failure handling and re-entry for the §6.4 state machine.
Recommended:         Keep the ten source states as Case.status. Meaning: the furthest stage whose outputs
                     are current. No FAILED case state; failures live on analysis_runs.status
                     (QUEUED / RUNNING / SUCCEEDED / FAILED) and agent_steps.status; the UI shows the
                     failed step with Retry, and retry resumes at that step.
                     Per-evidence processing_status: uploading → uploaded → processing → processed | failed.
                     Forward:
                       NEW → INGESTING            first evidence registered
                       INGESTING → EXTRACTED      all evidence processed in a run
                       EXTRACTED → ANALYZING → CORRELATED → TIMELINE_READY → ACTIONS_READY
                                                  analysis run steps (run ends at ACTIONS_READY)
                       ACTIONS_READY → REPORT_DRAFT   user generates a report version
                       REPORT_DRAFT → USER_REVIEW     report version generated successfully (R-1, §8);
                                                      user confirmation is a separate record on that
                                                      version and does NOT change the status
                       USER_REVIEW → EXPORTED         first export
                     Re-entry (always to the earliest affected state; voids review confirmation):
                       new evidence                 → INGESTING
                       extraction/entity correction → EXTRACTED (re-run from analysis onward)
                       timeline correction          → TIMELINE_READY (re-run actions)
                       follow-up answer             → ACTIONS_READY, or TIMELINE_READY if it changes a time
                                                      (no full re-analysis, FR-015)
                       report regenerated           → REPORT_DRAFT
                       evidence deleted             → INGESTING (or NEW if none left)
                       action marked done           → no state change
                     All transitions go through one CaseStateService.transition(caseId, event) with an
                     allowed-transition table; each transition is audited. The export gate checks the
                     confirmation on the CURRENT report version, not case.status alone.
Alternative:         Add a FAILED case state (spec allows either); purely linear states with no re-entry.
Why:                 Keeps the source states intact for the demo, makes retry cheap and makes "what is
                     stale" explicit after corrections.
Architecture impact: State service, transition table, step dependency graph used for re-runs.
                     AMBIGUITY IN SPEC: FR-019 says confirmation results in USER_REVIEW (i.e., "reviewed"),
                     while §6.2 calls stage 12 "User Review" and the §21.1 mock shows "STATUS: REVIEW"
                     (which reads as "awaiting review"). v0.1 followed FR-019 literally; RESOLVED by
                     R-1 (§8): USER_REVIEW = awaiting review, confirmation is a separate record.
Can this be changed later?: Yes, but status values are visible in UI and API, so changing them late costs
                     front-end rework.
Status:              ACCEPTED (2026-10-02). USER_REVIEW meaning RESOLVED by R-1 (§8).
```

### AD-06 — Environment and configuration strategy

```text
Decision:            Repo layout, configuration and provider selection.
Recommended:         - pnpm workspace monorepo: apps/web (Next.js), apps/api (NestJS + worker),
                       packages/shared (zod schemas + TS types for API payloads and agent outputs, per
                       spec principle 4). No Turborepo/Nx.
                     - 12-factor env vars; .env.example committed per app; real .env git-ignored;
                       validated at boot with zod (process refuses to start on bad config).
                     - Provider selection by env: LLM_PROVIDER, LLM_MODEL, OCR_PROVIDER, STORAGE_DRIVER,
                       EMAIL_TRANSPORT, LEDGER_ENABLED (+ network/RPC/key if built), WORKER_ENABLED,
                       DEMO_FALLBACK = off | auto | force.
                     - DEMO_FALLBACK=auto: live providers first; on error/timeout, serve cached results
                       ONLY for evidence whose SHA-256 is in the committed synthetic manifest (AD-03);
                       always disclosed in the activity feed and audit log (FR-027). force = offline
                       rehearsal. Unknown hashes never get cached results.
                     - Short, fixed timeouts on provider calls so fallback triggers quickly on stage.
                     - Two environments only: local (docker compose) and deployed demo. No staging.
                     - Secrets only in host secret stores; nothing secret under NEXT_PUBLIC_*;
                       storage/LLM/OCR keys only in the API.
Alternative:         Config files per environment; a feature-flag service (overkill).
Why:                 Fail-fast configuration, one-line provider swaps, and a fallback that is safe by
                     construction.
Architecture impact: Config module in the API; shared package for contracts; fallback lives in the
                     provider adapters, not in business logic.
Can this be changed later?: Yes.
Status:              ACCEPTED (2026-10-02).
```

---

## 5. Non-blocking decision records

### OD-06 — Blockchain attestation (network, and whether to build it)

| Layer | Content |
|---|---|
| **Product requirement** | Optional (FR-022, priority **O**). The spec does **not** require blockchain for the MVP or the DoD (§26 step 11: "FR-022 optional"). |
| **Architectural requirement (from spec)** | Behind an adapter. Only `hash + timestamp + opaque case evidence ID` on-chain. Not reversible to identity. Never on the critical path; failure shows "attestation unavailable". |
| **Implementation choice (open)** | Chain/network, library, contract vs. plain transaction. |

- **Default:** `LEDGER_ENABLED=false`. Build it last.
- **If built:** use an EVM testnet (e.g., Sepolia or an L2 testnet). Send a zero-value transaction carrying `sha256 ‖ HMAC(secret, evidence_id)` in calldata, so no contract needs deploying. Run it as an async job after upload. Store tx hash, network and block time in `attestation_ref`. Verification reads the transaction back and compares. Fund the wallet from a faucet early, because faucets are rate-limited.
- **Whether to build: `DEFERRED`** (default: not built; see §11). It depends on which DecentraHack theme(s) the Round 1 submission claimed, and the spec does not record that. If the Blockchain/Web3 theme was claimed, treat attestation as a demo must-have with a go/no-go on **2026-10-06**.
- **Why safe to defer:** the schema already has a nullable `attestation_ref`, and the integrity module already has an adapter seam (§18.2).

### OD-08 — Speech-to-text caller summary
Default: **excluded**. Revisit only if the full DoD passes by 2026-10-07. If built later, it is user-initiated recording only and is stored as evidence of type user statement (FR-028). No architectural seam is needed beyond the existing evidence types.

### OD-09 — Identity-document uploads
Default: **not accepted**. The UI and report say "keep your identity document ready for official reporting", and upload copy asks users not to upload ID documents. Nothing in the architecture depends on this.

### OD-10 — Progress delivery
Default: **polling** an activity endpoint (about every 1.5 s while a run is active). SSE can be added later on the same resource. Polling avoids buffering and timeout behaviour through the Next.js rewrite proxy.

### OD-13 — PostgreSQL hosting
Default: any managed PostgreSQL 15+, ideally the same vendor as object storage to minimise accounts. Docker Postgres (or the Supabase CLI stack) locally. Constraint: the queue needs a direct, non-transaction-pooled connection (OD-15). Decide together with OD-16 before the first deploy.

---

## 6. Other spec gaps found during this review

These are **not** among the 22 decisions. They were found while cross-checking and need an owner.

| # | Gap | Spec location | Suggested resolution (v0.1) | Status (v0.2) |
|---|---|---|---|---|
| G-1 | **Document numbering conflict.** The spec plans `03-DATABASE-SCHEMA.md` and `05-API-SPECIFICATION.md`. The next planned documents are `02-PRODUCT-REQUIREMENTS.md` and `03-TECHNICAL-ARCHITECTURE.md`, so two files would be `03`. | §1.4, §13.3 note, §17, §20 | Renumber (v0.1 suggestion superseded). | `RESOLVED` by R-2 (§8): 03 = Database Schema, 04 = Technical Architecture |
| G-2 | "Urgency" on the Incident Overview is undefined. | §21.1 | Simple rule based on recorded loss and credential/OTP exposure. | `RESOLVED` in §7.3 |
| G-3 | Canonical bytes for pasted text. | FR-004 | UTF-8, Unicode NFC, CRLF→LF, nothing else changed (see OD-14). | Implementation decision (§11). Constraint from §7.2: the committed E06 text is already in canonical form. |
| G-4 | File size/type limits; meaning of "email export". | FR-002 | 10 MB/file, 20 files/case; PNG, JPG, PDF, TXT, `.eml`. | `RESOLVED` in §7.4 |
| G-5 | Time handling. | §14.2 | Store UTC `timestamptz` + original text + precision; display IST. | Implementation decision (§11), settled in `03-DATABASE-SCHEMA.md` |
| G-6 | Relationship vocabulary and timeline `event_type` vocabulary. | §13.3, §14.1 | Define in the schema doc. | Implementation decision (§11). Must cover the semantics used in §7.2. |

---

## 7. Final resolutions of the remaining blocking decisions (v0.2)

These four decisions were the only blocking items listed in `02-PRODUCT-REQUIREMENTS.md` §25. Each is now final.

### 7.1 OD-03 — Scanned PDF behaviour

```text
Decision ID:         OD-03 (scope part)
Title:               Behaviour for PDFs without a usable text layer (scanned / image-only PDFs)
Status:              RESOLVED (2026-10-02)

Final Decision:      Scanned PDFs are UNSUPPORTED in the MVP.

                     1. Rule. A PDF is processed only if EVERY page has a usable embedded text layer.
                        A page has a usable text layer if its embedded text contains at least 10
                        non-whitespace characters. Proofline never runs OCR on PDF pages in the MVP.
                     2. When it is checked. During OCR/parsing (FR-007), after the file has uploaded,
                        been fingerprinted and been stored normally (FR-002–FR-005). The upload itself
                        succeeds and the evidence item exists.
                     3. What happens. If any page lacks a usable text layer, the item becomes `failed`
                        with reason PDF_NO_TEXT_LAYER, and:
                          - NO extraction, entity, timeline event or other derived data is created
                            from ANY page of that PDF. It is not partially processed.
                          - The user sees: "This PDF has no readable text layer (page(s) N…), so
                            Proofline can't read it. Upload the relevant page(s) as a screenshot or
                            photo (PNG or JPG) instead, then remove this PDF."
                          - Retry is not offered for this reason, because it cannot succeed. The
                            available action is Remove.
                          - The case cannot advance past EXTRACTED until the item is removed
                            (existing rule, PRD FR-006 / AD-05).
                     4. Supported workaround: upload the relevant page(s) as an image (PNG/JPG), which
                        goes through the normal OCR path.
                     5. Mixed PDFs (some pages with text, some without) are treated the same as
                        scanned PDFs: the whole item fails with the page numbers listed.
                     6. Out of scope: PDFs whose text layer exists but is garbled (broken font
                        encoding) cannot be detected reliably. The extraction validator (GR-01–GR-04)
                        still prevents invented identifiers, and the benchmark uses a clean
                        text-layer PDF (E04).

Options Considered:  (a) Unsupported, clear failure, image workaround (chosen).
                     (b) Rasterise pages and OCR them locally (needs native rendering libraries in
                         the container and a new failure surface).
                     (c) Cloud OCR for PDFs (asynchronous PDF APIs need extra storage wiring and a
                         cloud account on the critical path).
                     (d) Partial processing of mixed PDFs (per-page status UI, risk of silent omission).
                     (e) Reject at upload time instead of at processing (better feedback, but the PRD
                         describes the item as existing and "marked not processable"; option (a)
                         follows the PRD as written).

Rationale:           Lowest implementation risk. No rendering dependency, no extra provider, and the
                     check is deterministic. The demo uses a text-layer PDF (E04), so demo reliability
                     is unaffected. Failing the whole item rather than processing some pages guarantees
                     nothing is silently left out.

Product Impact:      PRD §8.3 option (b) applies. Users with scanned documents use the image
                     workaround. Spec's "PDF ingestion" in the MVP means text-layer PDFs.

Technical Impact:    One per-page text-length check in the PDF parser. A non-retryable failure reason
                     code on the evidence item. No OCR engine requirement for PDFs, which keeps the
                     OD-03 engine choice independent of PDFs.

Acceptance Criteria: AC-OD03.1 A text-layer PDF (E04) is processed with positional provenance.
                     AC-OD03.2 An image-only PDF uploads and is fingerprinted, then becomes `failed`
                               with reason PDF_NO_TEXT_LAYER and the guidance message.
                     AC-OD03.3 No extraction, entity, event or report fact derives from that PDF.
                     AC-OD03.4 Retry is not offered for it. Remove is offered.
                     AC-OD03.5 A mixed PDF fails the same way and lists the pages without text.
                     AC-OD03.6 The same page uploaded as a PNG is processed normally.

Future Extension:    Page rasterisation + OCR (local or cloud) behind the existing OCR adapter.
                     Per-page processing of mixed PDFs.
```

### 7.2 AD-03 — Canonical six-artifact demo dataset

```text
Decision ID:         AD-03
Title:               Canonical synthetic dataset for the primary hackathon demo
Status:              RESOLVED (2026-10-02)
Final Decision:      The six artifacts, values, expected results and hash behaviour in §7.2.1–§7.2.8
                     are THE canonical dataset. All values are fictional (§7.2.1).
Options Considered:  (a) Spec §22.2 proposal made concrete (chosen); (b) a different scenario;
                     (c) PNG-only set (leaves the PDF path untested).
Rationale:           Follows the spec's example incident (§6.3) and the planned demo (§22). Every
                     ingestion path used in the demo (PNG OCR, text-layer PDF, pasted text) is
                     exercised. Every correlation the demo shows has at least two independent sources.
                     Exactly one planted gap, one planted contradiction and one correctable event.
Product Impact:      Defines the expected outputs for PRD §22 (AC-01–AC-16) and the §23 benchmark.
Technical Impact:    Artifacts are generated ONCE and committed as binary files, with a manifest of
                     SHA-256 values and an expected-results benchmark file. The disclosed fallback
                     (FR-027, AD-06) is keyed only by these SHA-256 values.
Acceptance Criteria: §7.2.8.
Future Extension:    Additional fixtures (prompt-injection, email, scanned PDF, tampered copy) live in
                     13-SYNTHETIC-DATA-SPECIFICATION.md as TEST fixtures. They are not part of the six.
```

#### 7.2.1 Fictional values register

No real person's phone number, bank details, UPI ID, address, OTP or identity document appears anywhere. There are no addresses, no ID documents, no card numbers and no full account numbers.

| Value | Used as | Why it is safe |
|---|---|---|
| `+91 90000 00001` (also written `9000000001`) | The "KYC support" phone number | Deliberately patterned synthetic number. **The team must never call or message it.** If it is ever found to be assigned, replace it in all artifacts and regenerate (§7.2.7). |
| `kyc-update-verify.example` | Phishing domain | `.example` is a reserved TLD (RFC 2606) and cannot resolve to a real site |
| `https://kyc-update-verify.example/kyc` | Phishing URL | As above |
| `kyc.refund.desk@demoupi` | Fraudster's UPI ID | Fictional handle (`demoupi` is not a payment provider handle) |
| `627000418532` | UPI reference / UTR | Synthetic 12-digit number |
| `XX4821` / `****4821` | Victim's masked account hint | Masked last four digits only. No full account number exists. |
| `731904` | OTP shared in chat | Synthetic. Exists only to prove redaction (GR-09). |
| Asha Verma | Victim (payer name on receipt) | Fictional person |
| Rohan | Name the caller claims | Fictional, claimed name only |
| KYC Refund Desk | Payee display name | Fictional |
| `VX-KYCUPD`, `VX-ALERTS` | SMS sender headers | Fictional sender IDs |
| Example Bank | Bank named by the user in the follow-up answer during the demo | Fictional. It appears in **no** artifact. |

Date and time zone: **Thursday, 24 September 2026, IST (+05:30)** for every artifact.

No third-party logos or trademarks appear in any artifact. E02 uses a generic messaging-app layout. E03 shows no bank name or logo. E04 shows no payment-app branding.

#### 7.2.2 Artifacts

| ID | Filename | Type / ingestion path | What it contains |
|---|---|---|---|
| E01 | `E01_kyc_sms.png` | PNG screenshot → OCR | Fake KYC SMS from `VX-KYCUPD` with the phishing URL (with a tracking parameter) and the phone number |
| E02 | `E02_chat_kyc_agent.png` | PNG screenshot → OCR | Chat with the "KYC support" number: link sent, link opened, OTP requested and shared, payment instruction with UPI ID and ₹8,500 |
| E03 | `E03_phishing_page.png` | PNG screenshot → OCR | Mobile browser on the phishing page requesting customer ID, password, mobile number and OTP. Status-bar clock 12:16. No date visible. |
| E04 | `E04_upi_receipt.pdf` | One-page PDF **with text layer** → PDF text (no OCR) | UPI payment receipt: ₹8,500.00 to the UPI ID, UTR, payer, masked account, date and time. **No bank or wallet name.** |
| E05 | `E05_bank_debit_sms.png` | PNG screenshot → OCR | Bank debit SMS from `VX-ALERTS`: Rs.8500.00 debited, same account hint, same UTR, same UPI ID. **No bank name.** |
| E06 | `E06_user_note.txt` (committed source text; **pasted** in the demo as input kind *message*, label "My note about the call") | Pasted text → direct parsing | The victim's own account: call time (approximate), claimed caller name, credentials and OTP entered, payment time (approximate, **contradicts** E04) |

**Rendering requirements for PNGs:**
- 1080 px wide, portrait, lossless PNG.
- Body text at least 32 px, dark on light, using a sans-serif font with a correct ₹ glyph.
- No blur, noise or compression artifacts.

These keep OCR deterministic. The ₹ in E02 is the deliberate OCR check for the OD-03 engine spike.

#### 7.2.3 Exact visible content

**E01 — `E01_kyc_sms.png`**
```text
[Header]        VX-KYCUPD
[Date divider]  Thursday, 24 Sep 2026
[Message]       Dear Customer, your bank KYC has expired. Your account will be BLOCKED today.
                Update KYC now: https://kyc-update-verify.example/kyc?utm_source=sms
                or call KYC desk +91 90000 00001
[Time]          12:03 PM
```

**E02 — `E02_chat_kyc_agent.png`** (C = contact, U = user)
```text
[Header]        +91 90000 00001   ~ KYC Support
[Date divider]  24 September 2026
12:09 PM  C:  Hello, this is Rohan from KYC verification team as discussed on call. Open this link
              and complete KYC: https://kyc-update-verify.example/kyc
12:11 PM  U:  Opened the link. It is asking for customer ID and password.
12:15 PM  C:  Enter all details. You will get an OTP, share it here to complete verification.
12:17 PM  U:  OTP is 731904
12:18 PM  C:  Final step: pay refundable KYC security deposit ₹8,500 to UPI ID
              kyc.refund.desk@demoupi. It will be refunded in 2 hours.
12:18 PM  U:  Ok paying now
```

**E03 — `E03_phishing_page.png`**
```text
[Status bar]    12:16
[Address bar]   https://kyc-update-verify.example/kyc
[Page title]    KYC Verification Centre
[Text]          Your KYC has expired. Complete verification within 24 hours to avoid account
                suspension.
[Fields]        Customer ID | Password | Registered Mobile Number | Enter OTP sent to your mobile
[Button]        Verify KYC
```
Input fields are shown empty, with placeholders only.

**E04 — `E04_upi_receipt.pdf`** (embedded text, one page)
```text
UPI Payment Receipt
Payment Successful
Amount: ₹8,500.00
Paid to: KYC Refund Desk
UPI ID: kyc.refund.desk@demoupi
Paid by: Asha Verma
From account: ****4821
Date & time: 24 Sep 2026, 12:19 PM
UPI Ref No: 627000418532
Note: KYC deposit
```

**E05 — `E05_bank_debit_sms.png`**
```text
[Header]        VX-ALERTS
[Date divider]  Thursday, 24 Sep 2026
[Message]       Rs.8500.00 debited from A/c XX4821 on 24-09-26 12:21 via UPI to VPA
                kyc.refund.desk@demoupi. Ref no 627000418532. If not done by you, report to your
                bank immediately.
[Time]          12:21 PM
```

**E06 — pasted text** (committed as UTF-8, Unicode NFC, LF line endings, **no trailing newline**, so the file bytes equal the canonical pasted bytes)
```text
On 24 Sep 2026 I got an SMS saying my bank KYC had expired. Around 12:05 PM I called the number in the SMS, 9000000001. A man who said his name was Rohan from the KYC team told me to open a link he would send on chat. I entered my customer ID, password and the OTP. He then asked me to pay a refundable deposit, and I paid Rs 8,500 at around 12:40 PM. After that I got a debit SMS.
```

#### 7.2.4 Expected extraction results (benchmark)

Fields marked **K** are benchmark key fields (> 95% target, PRD G3). Normalised values show the *expected meaning*; exact normalisation formats are defined in `07-EVIDENCE-PROCESSING-PIPELINE.md`.

| Art. | Field type | Raw value | Expected normalised value | K |
|---|---|---|---|:-:|
| E01 | SMS_SENDER_HEADER | `VX-KYCUPD` | `VX-KYCUPD` | |
| E01 | URL | `https://kyc-update-verify.example/kyc?utm_source=sms` | `https://kyc-update-verify.example/kyc` (tracking parameter removed) | K |
| E01 | DOMAIN | `kyc-update-verify.example` | same | |
| E01 | PHONE | `+91 90000 00001` | `+919000000001` | K |
| E01 | DATETIME | `Thursday, 24 Sep 2026` + `12:03 PM` | 2026-09-24 12:03 IST, exact | K |
| E02 | PHONE | `+91 90000 00001` (chat header) | `+919000000001` | K |
| E02 | PERSON | `Rohan` (claimed name) | `Rohan` | |
| E02 | URL / DOMAIN | `https://kyc-update-verify.example/kyc` | same canonical URL as E01 | K |
| E02 | AMOUNT | `₹8,500` | INR 8,500.00 | K |
| E02 | UPI_ID | `kyc.refund.desk@demoupi` | same | K |
| E02 | DATETIME | `24 September 2026` + 12:09 / 12:11 / 12:15 / 12:17 / 12:18 PM | exact | K |
| E02 | *(OTP)* | `731904` | **Not an entity.** Detected and redacted everywhere (GR-09). | |
| E03 | URL / DOMAIN | `https://kyc-update-verify.example/kyc` | same canonical URL | K |
| E03 | DATETIME | `12:16` (no date) | 12:16 IST; date 2026-09-24 inferred from case evidence; precision **approximate** | |
| E04 | AMOUNT | `₹8,500.00` | INR 8,500.00 | K |
| E04 | PERSON (payee display name) | `KYC Refund Desk` | same | |
| E04 | UPI_ID | `kyc.refund.desk@demoupi` | same | K |
| E04 | PERSON (payer) | `Asha Verma` | same | |
| E04 | ACCOUNT_HINT | `****4821` | last four `4821` | |
| E04 | DATETIME | `24 Sep 2026, 12:19 PM` | 2026-09-24 12:19 IST, exact | K |
| E04 | TRANSACTION | `627000418532` (label "UPI Ref No") | `627000418532` | K |
| E04 | BANK_OR_WALLET | — | **none (intentional gap)** | K |
| E05 | SMS_SENDER_HEADER | `VX-ALERTS` | same | |
| E05 | AMOUNT | `Rs.8500.00` | INR 8,500.00 | K |
| E05 | ACCOUNT_HINT | `XX4821` | last four `4821` | |
| E05 | DATETIME | `24-09-26 12:21` (DD-MM-YY) | 2026-09-24 12:21 IST, exact | K |
| E05 | UPI_ID | `kyc.refund.desk@demoupi` | same | K |
| E05 | TRANSACTION | `627000418532` (label "Ref no") | `627000418532` | K |
| E05 | BANK_OR_WALLET | — | **none (intentional gap)** | K |
| E06 | PHONE | `9000000001` | `+919000000001` | K |
| E06 | PERSON | `Rohan` | `Rohan` | |
| E06 | AMOUNT | `Rs 8,500` | INR 8,500.00 | K |
| E06 | DATETIME | `24 Sep 2026`; `Around 12:05 PM`; `around 12:40 PM` | approximate times | |

**Benchmark rule for the gap.** In the NCRP field *Bank / wallet / merchant*, "bank/wallet" means the victim's **debited** bank or wallet. The payee display name ("KYC Refund Desk") does **not** fill this field. It is listed under identifiers observed in evidence.

**Expected canonical entities after correlation** (overview shows `PHONE 1 | URL 1 | UPI 1 | UTR 1`, matching spec §21.1):

| Entity | Canonical value | Appears in |
|---|---|---|
| PHONE | `+919000000001` | E01, E02, E06 |
| URL | `https://kyc-update-verify.example/kyc` | E01, E02, E03 |
| DOMAIN | `kyc-update-verify.example` | E01, E02, E03 |
| UPI_ID | `kyc.refund.desk@demoupi` | E02, E04, E05 |
| TRANSACTION | `627000418532` | E04, E05 |
| AMOUNT | INR 8,500.00 | E02, E04, E05, E06 |
| ACCOUNT_HINT | `…4821` | E04, E05 |
| SMS_SENDER_HEADER | `VX-KYCUPD` / `VX-ALERTS` | E01 / E05 |
| PERSON | Rohan (claimed) / KYC Refund Desk (payee) / Asha Verma (payer) | E02, E06 / E04 / E04 |
| BANK_OR_WALLET | none, then "Example Bank" **after the follow-up answer (user statement)** | — |

#### 7.2.5 Expected relationships (semantics; vocabulary names per G-6 in `08-…`)

| # | Relationship | Supported by |
|---|---|---|
| R1 | URL is hosted on DOMAIN | E01, E02, E03 |
| R2 | PHONE (chat contact) sent URL | E02 |
| R3 | PHONE (chat contact) requested payment to UPI_ID | E02 |
| R4 | TRANSACTION paid to UPI_ID | E04, E05 |
| R5 | AMOUNT is the amount of TRANSACTION | E04, E05 |
| R6 | TRANSACTION debited from ACCOUNT_HINT | E04, E05 |
| R7 | SMS_SENDER_HEADER `VX-KYCUPD` sent a message containing PHONE and URL | E01 |

Together these produce the demo path **phone → URL → UPI ID → transaction** (R2, R3, R4), each edge with its supporting evidence. Co-occurrence alone does not create a relationship (PRD CR-4).

#### 7.2.6 Expected timeline, gap, contradiction and correction

| # | Time (IST, 24 Sep 2026) | Event | Source | Precision | Notes |
|---|---|---|---|---|---|
| T1 | 12:03 | Fake KYC SMS received | E01 | exact | |
| T2 | ~12:05 → **12:07 after user correction** | User called the "KYC desk" number | E06 | approximate → user-corrected | **Demo correction (FR-013).** User checks their call log and corrects it to 12:07. |
| T3 | 12:09 | Contact sent the phishing link | E02 | exact | |
| T4 | 12:11 | User opened the link | E02 | exact | |
| T5 | 12:16 | Phishing page requested credentials/OTP | E03 | approximate (date inferred) | Credential/OTP request event |
| T6 | 12:17 | OTP shared in chat (value redacted) | E02 | exact | |
| T7 | 12:18 | Contact requested ₹8,500 to the UPI ID | E02 | exact | |
| T8 | 12:19 | UPI payment of ₹8,500 | E04 | exact | **Contradiction:** E06 says "around 12:40 PM" |
| T9 | 12:21 | ₹8,500 debit notification | E05 | exact | |

After the correction, the spec's example sequence (§6.3) is fully reproduced: 12:03 → 12:07 → 12:11 → 12:16 → 12:19 → 12:21.

- **Planted gap (exactly one):** the debited bank/wallet name appears in **no** artifact. It shows as "Not provided", with the follow-up question "Which bank or wallet was the ₹8,500 debited from?". The demo answer is "Example Bank", stored as a user statement.
- **Planted contradiction (exactly one):** the payment time. E04 says 12:19 PM; E06 says "around 12:40 PM". Both sources are shown. An optional question lets the user resolve it. The demo may leave it unresolved.
- **Other expected missing-information output:** identity document listed as "keep ready for official reporting" (no question). Every other NCRP field is present: incident date/time, details, amount, UTR, transaction date, suspect details.
- **Non-contradiction:** the approximate call time in E06 (~12:05) does not conflict with any other source, because E02's "as discussed on call" message is at 12:09.

#### 7.2.7 Expected downstream outputs and SHA-256 behaviour

| Output | Expected result |
|---|---|
| Scam signals (AD-01) | Primary `KYC_IMPERSONATION` (E01, E02); secondary `PHISHING` (E03, E02) and `UPI_FRAUD` (E02, E04, E05). Calibrated wording. |
| Financial loss reported | **True** (E04, E05, E02, E06) |
| Urgency (§7.3) | **HIGH**. Debit of ₹8,500 recorded (E04, E05). Also a credential/OTP request was observed (E03) and an OTP appears in messages (E02). |
| Actions (FR-016) | MUST: contact your bank; report financial cyber fraud via 1930 / NCRP; preserve original evidence. SHOULD: report suspect identifiers (phone, URL, UPI ID) via NCRP Report Suspect. Channels from the curated list only. |
| Report (AD-04) | All sections. Section 3 bank/wallet = "Not provided" before the answer, "Example Bank (you stated)" after. Section 4 lists phone, URL/domain, UPI ID and SMS headers as identifiers observed in evidence. The OTP never appears. |

**SHA-256 behaviour (all six):**
- **S-H1** Each artifact's SHA-256 is recorded in a committed manifest (`synthetic/manifest.json`, path final in `13-…`) at the moment the artifacts are generated.
- **S-H2** On upload, the fingerprint Proofline computes **must equal** the manifest value. For E06, this is the hash of the canonical pasted bytes, which equal the committed file bytes (§7.2.3).
- **S-H3** The fingerprint never changes after processing, correction or report generation.
- **S-H4** Verification of each untouched item returns **match**.
- **S-H5** The disclosed fallback serves cached results **only** for these six SHA-256 values.
- **S-H6** Tamper test (QA fixture, not one of the six): `E04_upi_receipt.TAMPERED.pdf`, amount changed to ₹5,500.00. When its bytes replace the stored E04 object in a test environment, verification returns **mismatch**.
- **S-H7** Regenerating any artifact changes its hash. Manifest, benchmark and fallback cache must be updated in the same commit. Artifacts are **frozen** once committed.

#### 7.2.8 Acceptance criteria (AD-03)

- AC-AD03.1 All six artifacts exist exactly as specified in §7.2.3, are committed, and match the manifest hashes.
- AC-AD03.2 Uploading or pasting them yields fingerprints equal to the manifest (S-H2).
- AC-AD03.3 Benchmark key fields (K in §7.2.4) are extracted at > 95% accuracy.
- AC-AD03.4 Canonical entities match §7.2.4, including the overview counts.
- AC-AD03.5 Relationships R2–R4 are shown with their supporting evidence.
- AC-AD03.6 The timeline matches §7.2.6 with > 90% of events correctly ordered, and T2 can be corrected to 12:07.
- AC-AD03.7 Exactly one gap (bank/wallet) and one contradiction (payment time) are reported.
- AC-AD03.8 The OTP `731904` appears in no UI text, report or export.
- AC-AD03.9 Downstream outputs match §7.2.7.
- AC-AD03.10 A search of the dataset finds no real-looking full account number, card number, address or ID document.

### 7.3 G-2 — Case-level urgency

```text
Decision ID:         G-2
Title:               Case-level urgency on the Incident Overview
Status:              RESOLVED (2026-10-02)

Final Decision:      Urgency is a deterministic, rule-based indicator computed ONLY from validated case
                     facts (accepted extractions, typed timeline events and user statements). It is
                     never produced by the AI model and is not a risk score.

                     Levels (matching the spec §21.1 mock "URGENCY HIGH"):
                       HIGH | MEDIUM | LOW, plus the pre-assessment display "Not assessed yet".

                     Input signals:
                       U1 Financial loss recorded = the AD-01 `financial_loss_reported` flag: at least
                          one AMOUNT tied to a payment or debit (a TRANSACTION, or a timeline event of
                          type payment-initiated or debit-notification), sourced from evidence or from
                          a user statement.
                       U2 Credential/OTP exposure indicated = either
                          (a) an OTP value detected in evidence (the GR-09 detector), or
                          (b) a timeline event of type credential/OTP request sourced from evidence.

                     Decision logic (first match wins):
                       1. Case has not yet reached ACTIONS_READY in any analysis run → "Not assessed yet".
                       2. U1 true                → HIGH
                       3. U1 false and U2 true   → MEDIUM
                       4. otherwise              → LOW

                     Tie-breaking: the highest level whose rule fires wins. ALL firing signals are
                     listed in the explanation, highest first. Each distinct transaction is listed
                     once (no double counting of E04/E05). Amounts are never summed across conflicting
                     sources. If amounts conflict, both values are shown and the contradiction is noted.

                     Missing-data behaviour:
                       - Unknown timestamps do not affect urgency. There is no time-elapsed rule.
                       - Absence of a payment in the evidence gives LOW or MEDIUM, with the
                         explanation saying the result is based only on what has been provided.
                       - A loss known only from a user statement still gives HIGH, labelled "you stated".
                       - If the case returns to an earlier state (S-4), the last computed value stays
                         visible, marked "Based on the last analysis — may be out of date", until
                         ACTIONS_READY is reached again. Answers and corrections recompute it at that
                         point.
                       - Users cannot edit urgency directly. They change the underlying facts.

                     Explanation shown to the user (template-generated, never AI-written; every
                     reason links to its sources):
                       HIGH:   "Urgency is HIGH because a debit of ₹{amount} on {date} at {time} is
                                recorded in this case ({sources})." [+ U2 sentence if U2 also fires]
                       MEDIUM: "Urgency is MEDIUM because a request for passwords or an OTP was
                                observed ({sources}), but no payment or debit is recorded in the
                                evidence so far."
                       LOW:    "Urgency is LOW because no payment, debit, or password/OTP request has
                                been found in the evidence provided so far. If money left your account,
                                add the receipt or bank alert."
                       U2 sentence: "A request for passwords or an OTP was also observed ({sources})."
                       Always followed by: "Urgency shows how soon to act on the steps below, based
                       only on facts recorded in this case. It is not a risk score, a legal
                       assessment, or a law-enforcement determination."

                     Placement: Incident Overview only. Not part of the report or exports (AD-04 is
                     unchanged). Independent of per-action priorities (FR-016).

Options Considered:  (a) Two-signal rule (chosen).
                     (b) Add a recency rule (e.g., HIGH only within N hours of the debit). Rejected:
                         time-dependent, so the demo case (24 Sep) would downgrade before the
                         9 Oct final, and it adds a policy claim the spec does not make.
                     (c) AI-judged urgency. Rejected: opaque and non-deterministic.
                     (d) Use the scam label. Rejected: the label is AI-assisted. Urgency must rest on
                         validated facts only.

Rationale:           Deterministic, explainable in one sentence, traceable to evidence, stable over
                     time for the demo, and consistent with the spec's emphasis on prompt action for
                     financial fraud (§4.3) without claiming anything about outcomes.

Product Impact:      Fills spec §21.1 "TO BE DEFINED" and PRD AC-R3. Demo case shows HIGH (§7.2.7).

Technical Impact:    A pure function over case facts at ACTIONS_READY. It may be cached as a derived
                     value (level, reasons with source refs, computed_at) for display. No new entity
                     type. Requires G-6 to include the event types payment-initiated,
                     debit-notification and credential/OTP request (already listed as examples in
                     spec §14.1).

Acceptance Criteria: AC-G2.1 Demo case → HIGH, with reasons citing E04/E05 and the U2 sentence citing E02/E03.
                     AC-G2.2 A case with only E01 and E03 → MEDIUM (credential/OTP request event
                             from E03; no payment recorded).
                     AC-G2.3 A case containing only E01 → LOW with the "based on evidence so far" wording.
                     AC-G2.4 Before the first analysis completes → "Not assessed yet".
                     AC-G2.5 Identical facts always give identical level and text (no AI involvement).
                     AC-G2.6 Every reason links to its source evidence or user statement.
                     AC-G2.7 The disclaimer sentence is always shown with the level.

Future Extension:    Additional signals (e.g., account-takeover indicators), configurable rules for
                     organisation users, and a time-aware variant if the product later makes an
                     explicit, sourced claim about reporting windows.
```

### 7.4 G-4 — File limits and email export format

```text
Decision ID:         G-4
Title:               Evidence size/type limits and accepted email export format
Status:              RESOLVED (2026-10-02)

Final Decision:      1. Accepted file types, checked by CONTENT, not extension:
                          PNG · JPEG (.jpg/.jpeg) · PDF (text layer, §7.1) · TXT (UTF-8) · EML.
                        Everything else is rejected, including HEIC/HEIF, WebP, GIF, TIFF, DOCX,
                        .msg, .mbox, .pst and archives. The message names the supported types and,
                        for images, says "export as PNG or JPG".
                     2. Limits:
                          - Max file size: 10 MB (10,485,760 bytes) per file, all types. Empty
                            (0-byte) files are rejected.
                          - Max evidence items per case: 20 (files + pasted items).
                          - PDF: max 20 pages. Password-protected or encrypted PDFs are rejected.
                          - Images: max 40 megapixels (width × height ≤ 40,000,000).
                          - Pasted text: max 20,000 characters per item.
                          - TXT: must be valid UTF-8.
                     3. Enforcement:
                          - Type, size, count, page count, pixel count and encryption are checked at
                            upload confirmation, before the item becomes `uploaded`. Failing items
                            are REJECTED: the stored bytes are removed, no evidence item remains,
                            and the user sees a clear message.
                          - The browser pre-checks size, type and count for fast feedback, but the
                            server check is authoritative.
                          - The text-layer check (§7.1) and email parsing happen at processing,
                            because they are processing capabilities rather than safety limits.
                     4. Email export: ONLY single-message `.eml` files (RFC 5322 / MIME) are accepted.
                          - Extracted: From, To, Cc, Reply-To, Return-Path, Subject, Date, Message-ID,
                            and the body as text. text/plain is preferred; if only text/html exists it
                            is converted to plain text. Remote content is never loaded, scripts never
                            run, and the HTML is never rendered as HTML.
                          - URLs found in the body (including link targets) are extracted lexically
                            and NEVER fetched.
                          - Provenance location = header name, or body line number.
                          - Attachments and embedded images are NOT processed. Their filename, type
                            and size are listed on the evidence item, with the message "Attachments
                            inside emails are not analysed; upload them separately."
                          - Failures: unparseable file or missing headers → `failed` with "We couldn't
                            read this email file. Save the email as .eml, or paste its text
                            instead."; S/MIME or PGP-encrypted body → `failed` with "This email is
                            encrypted and can't be read."; .msg, .mbox and other mailbox formats →
                            rejected at upload with "Save the email as .eml or paste its text."
                          - Alternatives that remain available: paste the email text (FR-003), or
                            upload a PDF/screenshot of it.
                          - Email ingestion stays in MVP scope but is NOT in the primary demo. It is
                            covered by a synthetic `.eml` test fixture (13/15).

Options Considered:  Size: 5 MB (too tight for some phone photos), 10 MB (chosen), 25 MB (more
                     storage and processing time, no demo benefit).
                     Email: .eml only (chosen); .eml + .msg (needs a proprietary-format parser);
                     .mbox (multi-message, unclear case semantics); PDF printouts only (lose headers).

Rationale:           One size limit is easy to enforce and explain, and covers screenshots, phone
                     photos and receipts. Page, pixel and count caps bound processing time against
                     the < 2 min target and limit decompression/resource abuse. .eml is the standard
                     single-message export from common mail clients and can be parsed with mature
                     libraries. Not processing attachments avoids nested-file risk.

Product Impact:      Upload validation messages and limits become concrete (PRD FR-002, FR-003, §8.1,
                     §21). Email users get a clear supported path and two fallbacks (paste, PDF or
                     screenshot).

Technical Impact:    Validation at upload confirmation (OD-14 step 3). The storage bucket's size limit
                     is set to 10 MB. An .eml parser in the processing pipeline. An attachment-metadata
                     field on email evidence. Exact canonical header handling is in 07.

Acceptance Criteria: AC-G4.1 A 10 MB file is accepted. A 10 MB + 1 byte file is rejected with a
                             size message.
                     AC-G4.2 A 21st evidence item is rejected with a count message.
                     AC-G4.3 A 21-page PDF, an encrypted PDF and a > 40 MP image are rejected at
                             upload.
                     AC-G4.4 HEIC, WebP, .msg and .docx are rejected, naming the supported types.
                     AC-G4.5 A renamed file whose content does not match its extension is rejected.
                     AC-G4.6 The synthetic .eml fixture yields sender, subject, date, body URLs and
                             body text, each with provenance. URLs are not fetched.
                     AC-G4.7 An .eml with an attachment lists the attachment and does not process it.
                     AC-G4.8 An unparseable .eml becomes `failed` with the guidance message, and
                             nothing is extracted from it.
                     AC-G4.9 Pasted text over 20,000 characters is rejected with a message.

Future Extension:    .msg support, attachment processing as linked child evidence, mailbox
                     connectors (spec future scope), raised limits after measuring real usage.
```

---

## 8. Team resolutions recorded

These were made by the team on 2026-10-02 and already applied in `02-PRODUCT-REQUIREMENTS.md`. They are recorded here so that this file is the complete register.

| ID | Resolution | Supersedes |
|---|---|---|
| ACC-1 | All v0.1 `PROPOSED` recommendations are accepted. | v0.1 statuses |
| R-1 | **`USER_REVIEW` means the case is awaiting human review.** It is entered automatically when a report version is generated successfully. Review **confirmation** is a separate record tied to one report version and its checksum. The case stays in `USER_REVIEW` (UI: "Reviewed – version N"). Any later change voids the confirmation. Export eligibility comes from the confirmation on the current version. Consistent with FR-019's outputs, because the status is `USER_REVIEW` at the moment of confirmation. | Open part of AD-05 |
| R-2 | **Document sequence:** 01 Master Spec · 02 Product Requirements · 03 Database Schema · 04 Technical Architecture · 05 API Specification · 06 AI Agent Specification · 07 Evidence Processing Pipeline · 08 Evidence Graph & Timeline · 09 Security, Privacy & Integrity · 10 Frontend UX · 11 Design System · 12 Demo Scenario · 13 Synthetic Data · 14 Implementation Roadmap · 15 Testing Strategy · 16 Hackathon Pitch. Earlier references in this file to `03-TECHNICAL-ARCHITECTURE.md` mean `04-TECHNICAL-ARCHITECTURE.md`. | G-1 suggestion |

---

## 9. Consistency check (v0.2 resolutions)

| Decision | 1. Contradicts Master Spec? | 2. Contradicts PRD? | 3. Requires PRD change? | 4. Requires Master Spec change? |
|---|---|---|---|---|
| OD-03 scanned PDFs | **No explicit contradiction.** FR-002 and §7 list "PDF" without qualification. The decision narrows an unqualified scope to text-layer PDFs. | **No.** PRD §8.3 anticipated exactly this outcome as option (b). | **Yes (wording):** remove the open-dependency markers; make option (b) definitive; FR-007 "retry or remove" excludes retry for this reason; §23 row ❓ → ❌. | **Recommended (clarification):** §7 "PDF ingestion" note → "text-layer PDFs (OD-03)". |
| AD-03 dataset | **No.** Implements spec §22.2 and §6.3. E02 is a generic chat layout rather than WhatsApp-branded (consistent with spec §4.3's no-impersonation stance). E04 = PDF and E05 = PNG, as the spec allows. UPI ID additionally appears in E02 and E05 (superset of §13.4's example). | **No contradiction.** PRD §12's expected-correlation list is a subset (UPI shown only in E04). | **Yes (completeness):** PRD §12 expected correlations and the AC-05/AC-09 expected values should cite §7.2. | **Recommended:** §22.2 "TO BE DEFINED" → reference to the canonical dataset; E02 description wording. |
| G-2 urgency | **No.** Fills a §21.1 `TO BE DEFINED`. HIGH/MEDIUM/LOW matches the mock. | **No.** | **Yes:** AC-R3 and §25 should reference §7.3 instead of an open G-2. | **Recommended:** §21.1 note → reference §7.3. |
| G-4 limits & email | **No.** FR-002 leaves limits as `IMPLEMENTATION DETAIL`. "Email export" is now defined as `.eml`. | **No.** | **Yes:** FR-002/FR-003 validation values, §8.1 email row, new §21 failure rows, §23 row, §25. | **Recommended:** FR-002 reference to G-4. |
| R-1 | FR-019's output wording ("Case status `USER_REVIEW`") is compatible but reads as if confirmation sets the status. | **No.** The PRD defines R-1. | **Yes (minor):** PRD §1.2 says R-1/R-2 are not yet in `DECISIONS.md`. They now are. | **Recommended:** FR-019 clarification. |
| R-2 | **Mismatch:** spec §1.4 lists only `03-DATABASE-SCHEMA.md` and `05-API-SPECIFICATION.md`. No conflict with R-2 numbering, but the list is incomplete. | **No.** | No. | **Recommended:** §1.4 full sequence. |

No decision in §7 or §8 creates a hard contradiction with the Master Spec's requirements or boundaries. All required changes are clarifications or removal of now-resolved "open" markers.

---

## 10. Follow-up Documentation Changes Required

**Not made now.** Both documents are left untouched as instructed. Apply these in a later, explicitly approved edit.

### 10.1 `docs/02-PRODUCT-REQUIREMENTS.md`

| # | Location | Change |
|---|---|---|
| P-1 | §1.2 item 3 | R-1 and R-2 are now recorded in `DECISIONS.md` §8. Remove "not yet recorded". |
| P-2 | FR-002 Validation and Dependency | Replace "`IMPLEMENTATION DETAIL`. Dependency: G-4" with the §7.4 limits. Change OD-03 and G-4 from **open** to resolved. |
| P-3 | FR-003 Validation | Add the 20,000-character limit (§7.4). |
| P-4 | FR-007 Failure Behavior and Dependency | For `PDF_NO_TEXT_LAYER`, offer Remove only, not retry. Mark OD-03 scope resolved (§7.1). |
| P-5 | §8.1 table | Scanned-PDF row → "Unsupported in MVP (OD-03, §7.1)". Email row → "`.eml` only; attachments not analysed; .msg/mbox rejected (§7.4)". |
| P-6 | §8.3 | Make option (b) definitive. Drop option (a) and the "regardless of OD-03" framing. Add the mixed-PDF rule. |
| P-7 | §12 expected demo correlations | UPI ID in E02, E04, E05. Add AMOUNT (E02/E04/E05/E06) and ACCOUNT_HINT (E04/E05). Reference §7.2.4–§7.2.5. |
| P-8 | §15 AC-R3 | Replace the G-2 dependency with the urgency rule reference (§7.3). |
| P-9 | §21 Failure States | Add rows: file too large; too many evidence items; PDF over 20 pages; encrypted PDF; image over 40 MP; unsupported image format (HEIC/WebP); pasted text too long; unreadable `.eml`; encrypted email. Make the scanned-PDF row unconditional. |
| P-10 | §22 AC-05, AC-06, AC-09, AC-11 | Reference the expected values in §7.2.4–§7.2.7. Add the expected urgency HIGH to the overview checks. |
| P-11 | §23 MVP vs Future | Scanned PDF ❓ → ❌ MVP / ✅ Future. Email row → `.eml` only. Add "Email attachment processing" as Future. |
| P-12 | §24 Traceability | Add §7.1–§7.4 references for FR-002, FR-003, FR-007, FR-027 and the Incident Overview. |
| P-13 | §25 Open Dependencies | Remove the four BLOCKING rows (OD-03 scope, AD-03 contents, G-2, G-4). The BLOCKING list becomes empty. |

### 10.2 `docs/01-PROOFLINE-MASTER-SPEC.md`

| # | Location | Change |
|---|---|---|
| M-1 | §1.4 Related documents | List the full R-2 sequence (01–16). |
| M-2 | §7 MVP Scope, "PDF ingestion" | Note "text-layer PDFs; scanned PDFs future (OD-03)". |
| M-3 | FR-002 | Reference G-4 for limits and `.eml` as the email export format. |
| M-4 | FR-019 Outputs | Clarify per R-1: confirmation is recorded against the version and does not change the status, which remains `USER_REVIEW`. |
| M-5 | FR-026 | Note: email only in MVP (OD-04). Phone is future. |
| M-6 | §6.4 | Replace the `IMPLEMENTATION DETAIL` failure/re-entry bullets with a reference to AD-05 / R-1. |
| M-7 | §21.1 urgency note | Replace `TO BE DEFINED` with a reference to §7.3. |
| M-8 | §22.2 | Replace "proposal … `TO BE DEFINED`" with a reference to the canonical dataset (§7.2 here; `13-SYNTHETIC-DATA-SPECIFICATION.md`). Describe E02 as a generic chat screenshot without third-party branding. |
| M-9 | §27 Open Decisions Register | Point to `docs/DECISIONS.md` as the register of record (spec principle §25.15). |

### 10.3 `docs/DECISIONS.md` (this file)

None outstanding. The v0.1 AD-03 record text (contradiction "around 12:30") is superseded by §7.2 ("around 12:40"), as noted in its status line.

---

## 11. Final Status

### Blocking Decisions Remaining

**None.** No new blocker was found. `03-DATABASE-SCHEMA.md` can proceed directly.

### Deferred Decisions

Each has a default that product and schema can rely on.

| ID | Default in effect | Decide by |
|---|---|---|
| OD-06 | Blockchain attestation **not built** (`LEDGER_ENABLED=false`). Schema keeps a nullable attestation reference. If built: EVM testnet, hash + timestamp + opaque reference only. | Go/no-go 2026-10-06 (depends on the claimed hackathon theme) |
| OD-08 | Speech-to-text caller summary **excluded** | Only if the full DoD passes by 2026-10-07 |
| OD-09 | Identity-document uploads **not accepted**; "keep ready" reminder only | Post-hackathon |
| OD-10 | Agent activity delivered by **polling** | Any time (SSE can be added later on the same resource) |
| OD-13 | Any managed PostgreSQL 15+; Docker locally; direct connection for the queue | With OD-16 vendors, before first deploy |

### Implementation Decisions

These can be settled while writing `03`–`07` or during the build. None changes product behaviour.

| Item | Settled in / by |
|---|---|
| OD-02 LLM vendor and model (contract accepted) | Before adapter coding (2026-10-03) |
| OD-03 OCR engine for images (tesseract.js first; switch if the spike misreads K fields, especially ₹ in E02) | After the spike on the §7.2 artifacts (2026-10-03) |
| OD-04 email delivery service for sign-in codes | Before first deploy |
| OD-14 / OD-16 storage and hosting vendors (flow and shape accepted) | Before first deploy (2026-10-04) |
| G-3 canonical byte form of pasted text (constraint: E06 committed bytes must equal it) | `07-EVIDENCE-PROCESSING-PIPELINE.md` |
| G-5 time storage and IST display | `03-DATABASE-SCHEMA.md` |
| G-6 relationship and timeline event-type vocabularies (must cover §7.2.5 and the §7.3 event types) | `03-DATABASE-SCHEMA.md` / `08-EVIDENCE-GRAPH-TIMELINE.md` |
| Confidence band thresholds (AD-02) | `06-AI-AGENT-SPECIFICATION.md` |
| Case reference display format (e.g., `CF-10283`) | `03-DATABASE-SCHEMA.md` |
| Action priority scale; per-incident-type checklist detail | `06-AI-AGENT-SPECIFICATION.md` |
| Normalisation rules (phone, URL tracking-parameter list, amounts, DD-MM-YY dates) | `07-EVIDENCE-PROCESSING-PIPELINE.md` (must reproduce §7.2.4) |
| OTP detection rule (GR-09) | `06` / `07` (must detect `731904` in E02) |
| Time-contradiction tolerance (must flag 12:19 vs ~12:40; must not flag the ~12:05 call) | `08-EVIDENCE-GRAPH-TIMELINE.md` |
| Artifact rendering tooling, manifest and benchmark file formats | `13-SYNTHETIC-DATA-SPECIFICATION.md` |
| Urgency caching (stored derived value vs. computed on read) | `03-DATABASE-SCHEMA.md` / `04-TECHNICAL-ARCHITECTURE.md` |

---

## 12. Owner resolution — Phase 8 and joint Gate G (2026-10-03)

```text
Decision:            Phase 8 acceptance timing: OPTION 4, joint integration milestone.
Final Decision:      Phase 8 is an Analysis Orchestration infrastructure phase. Its readiness can be
                     accepted before the processors assigned to Phases 9, 10 and 12 exist.
                     Infrastructure readiness proves deterministic planning, dependencies, lifecycle
                     gates, re-entry, retry/resume, concurrency and mutation protection, deletion,
                     idempotency, Phase 5–7 integration and unavailable-processor handling.
                     The original requirement remains the FINAL JOINT INTEGRATION GATE:
                     "a full run reaches ACTIONS_READY deterministically twice in a row with identical
                     outputs (excluding timestamps and IDs)".
                     Execute that gate only after the required processors exist. Do not fabricate
                     results, mark missing processors successful, or advance to ACTIONS_READY early.
Rationale:           14 §15 and 15 §51 identify Gate G as a joint P8/P12 integration gate. Distinguish
                     infrastructure readiness from final full-run acceptance; preserve processor
                     ownership and all product lifecycle/provenance/security requirements.
Interim execution:   Real Phase 5–7 processors continue to run. Later step contracts remain pending
                     when unavailable. No analysis run may falsely succeed. Use existing internal
                     status/error conventions; no new public failure code is authorised.
Implementation note: A blocked attempt ends FAILED with the existing INTERNAL_ERROR (retryable),
                     while unavailable steps stay PENDING, with no domain outputs. This releases
                     active-run protection for retry/correction without claiming analysis completion.
                     CORRELATE can compute Phase 7 facts after NORMALIZE; the CORRELATED lifecycle
                     gate still requires successful SCAM_ANALYSIS as well as CORRELATE.
Documents affected:  14 Phase 8 exit gate/R-N3; 15 §31/§51 acceptance timing only. No product rules,
                     domain processor assignments, public enums or final Gate G requirement change.
Status:              ACCEPTED — explicitly ratified by the owner in this implementation session.
```
