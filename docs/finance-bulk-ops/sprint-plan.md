# Finance Module — Bulk Operations: Multi-Sprint Implementation Plan

## 1. Context

EdForge's finance module today supports per-student invoice generation and per-invoice PDF download, but the Saraswati pilot operator is sitting on ~800 students across 12+ grade levels and a billing window measured in hours, not days. Three pilot-blocking gaps drive this program:

1. **Bulk invoice generation has no grade resolution.** `POST /finance/schools/:schoolId/invoices/bulk-generate` (server/application/microservices/finance/src/invoices/invoices.service.ts:845) accepts a flat `studentIds[]` (max 500) and assumes the operator already curated the list. The bulk-generate wizard's Step 1 ([apps/finance/src/components/billing/BulkInvoiceForm.tsx:122-740](edforge-saas-frontend/apps/finance/src/components/billing/BulkInvoiceForm.tsx)) loads an unbounded student list (500-cap, name search only) — the pilot operator explicitly flagged this as unusable.
2. **No bulk download.** Invoice/receipt PDFs are streamed inline one at a time via [invoices.service.ts:486](server/application/microservices/finance/src/invoices/invoices.service.ts) (`renderInvoiceToPdfBuffer`). Sequentially downloading 800 invoices is operationally infeasible. Payment list ([apps/finance/src/routes/billing/payments/index.tsx](edforge-saas-frontend/apps/finance/src/routes/billing/payments/index.tsx)) lacks row selection entirely.
3. **No grade-level filter on invoice/payment lists.** Backend supports `status` and `academicYear` only. Operators can't isolate "all Grade 4 unpaid invoices" before acting.

User-locked decisions:
- **gradeLevel = snapshot at issue time** (stable for accounting; survives student promotion).
- **Output formats = both ZIP-of-PDFs and merged single PDF**, operator picks per export.
- **Async target = 3–5 min for 800 PDFs**, in-process ECS worker (no Lambda fan-out in V1).
- **Admin/operator scope only** — parent portal bulk downloads deferred.

The IEMIS import async pattern at [academics/src/students/iemis-import-jobs.service.ts](server/application/microservices/academics/src/students/iemis-import-jobs.service.ts) is the architectural precedent (202 + jobId, `setImmediate` worker, 2s polling). It is reused as a **shape**, not copy-pasted — IEMIS imports student demographics; this writes ledger entries and exports regulated PII. The semantics differ, the consequences of a bug differ, and the validation surface (transactional consistency, audit logging, concurrency control) is correspondingly stricter.

---

## 2. Architecture

### Data model deltas

1. **`InvoiceEntity.gradeLevel` becomes a populated snapshot.** Field already exists at [common/entities/invoice.entity.ts:85](server/application/microservices/finance/src/common/entities/invoice.entity.ts); `generate()` and `generateBulk()` do not populate it today. Forward `studentInfo.currentGradeLevel` whenever the caller did not supply one.
2. **`PaymentEntity.gradeLevel` denormalized at issue time** (set from the parent invoice's snapshot). Avoids the JOIN-with-overfetch fragility flagged by review. Backfill alongside invoices.
3. **New GSI14** on the finance table: `gsi14pk = TENANT#{tid}#SCHOOL#{schoolId}#GRADE#{gradeLevel}`, `gsi14sk = INVOICE#{issuedDate}` (and analogously `PAYMENT#{processedDate}` for payments — same GSI, different entity-type prefix on sk). Sparse: rows with `gradeLevel === undefined` are absent from the index. Defined in [server/lib/tenant-template/ecs-dynamodb.ts](server/lib/tenant-template/ecs-dynamodb.ts); GSI11/12 reserved, 14 is the next free slot. Single GSI Query replaces a school-wide Scan-and-filter — required for the 800-student grade-export use case.
4. **New `FinanceJob` entity** mirroring `IemisImportJob` but with finance-specific fields. PK=tenantId, SK=`FINANCE_JOB#{jobId}`. Fields: `jobId`, `schoolId`, `operatorId`, `jobType: 'bulk_invoice_generate' | 'bulk_invoice_pdf_export' | 'bulk_receipt_pdf_export'`, `status: 'queued'|'running'|'succeeded'|'failed'`, counters (`requested`, `processed`, `succeeded`, `failed`, `skipped`), `outputFormat: 'zip'|'merged_pdf'|null`, `output: { zipKey?, mergedPdfKey?, zipUrl?, mergedPdfUrl?, urlExpiresAt? }`, `failedStudentIds[]` (capped at 500 for partial-retry UX), `idempotencyKey?` (24h-TTL row to dedupe submissions), lifecycle timestamps, capped `errors[]`.
5. **New `FinanceAuditEvent` entity** for bulk-export PII access trail. PK=tenantId, SK=`AUDIT#FINANCE_BULK#{ts}#{eventId}`. Fields: `eventType: 'finance.bulk_export.{requested,started,succeeded,failed,url_minted}'`, `operatorId`, `schoolId`, `jobId`, `invoiceCount`, `format`, `presignedKeyHash` (SHA256 of the S3 key, not the URL itself), `requestIp` (from JWT claims), `userAgent`. Queryable via existing audit-event GSI on identity table; finance adds a sibling table-local audit fan-out path.
6. **New `IdempotencyKey` entity** (small, generic). PK=tenantId, SK=`IDEMPOTENCY#{operatorId}#{key}`. Value: original jobId + 24h TTL. Header-driven (`Idempotency-Key: <uuid>`).

### Service shape

- **`BulkOperationsModule`** at `server/application/microservices/finance/src/bulk-ops/` housing `BulkOpsController`, `BulkOpsService` (resolver + idempotency check), `FinanceJobsService` (entity owner), `FinanceAuditService`, worker functions per job type, and a per-school in-memory semaphore. Wired in `finance.module.ts` and registered in the wiring spec (CLAUDE.md §574-583 invariant).
- **Worker model**: `setImmediate(() => this.runWorker(jobId, payload, context))` from controller. Worker fetches branding + template **once** via the existing `IdentityClient` cache, constructs a `RenderContext`, reuses across all PDFs. Concurrency: `p-limit(N)` where N is read from `BULK_PDF_CONCURRENCY` (default 8). **Per-school semaphore** (in-memory `Map<schoolId, Promise>`): a second job for the same school stays `queued` until the first terminates — prevents one school's mass export from starving another school's invoice generation on the same ECS task.
- **Transactional consistency**: `InvoicesService.generate()` writes 4 entities via `TransactWriteItems` (invoice + ledger + studentAccount + paymentApplication). The bulk worker calls `generate()` per student — each call is its own transaction, so per-student failures isolate. **A pre-Sprint-E validation spike must confirm**: (a) `generate()` is reentrant under p-limit(8); (b) there is no shared serialization point (e.g., `LAST_INVOICE_NUMBER#schoolId` counter row) that would serialize the entire loop and defeat the concurrency budget; (c) the expected `TransactionCanceledException` rate is < 1% with bounded retry inside the worker.
- **S3 layout** (reuses the existing `edforge-pdfs-{account}-{region}` bucket; tag-based 7d lifecycle rule already in place per [analytics-stack.ts:1099-1129](server/lib/analytics/analytics-stack.ts)):
  - `tenants/{tenantId}/schools/{schoolId}/pdf-jobs/{jobId}/individual/{invoiceNumber}.pdf` (intermediate per-PDF)
  - `tenants/{tenantId}/schools/{schoolId}/pdf-jobs/{jobId}/invoices.zip`
  - `tenants/{tenantId}/schools/{schoolId}/pdf-jobs/{jobId}/invoices-merged.pdf`
  - All objects tagged `{lifecycle: 'pdf-jobs'}` at PutObject — existing `expire-pdf-jobs-7d` tag rule applies.
- **Job state machine**: `queued → running → succeeded|failed`. `markCompleted` mints presigned URLs (15-min TTL); `GET /finance/jobs/:jobId` re-mints if the existing URL is within 60s of expiry. Same-tenant cross-school polling returns **404 (not 403)** — operator-school-scope is enforced as a not-found path so job IDs are not enumerable across schools.

### UX flow

```
Operator → /invoices/bulk-generate wizard
  Step 1: "By Student" tab (existing) | "By Grade" tab (new)
            By-Grade: multi-select grade chips OR "All grades" toggle
  Step 2-4: existing fee-structure / details / preview steps
  Preview: shows resolved student count + estimated invoice count + duplicate count
  Submit  (with Idempotency-Key header)
         → ≤25 students: synchronous 200 → result panel
         → >25 students:  202 + jobId
         → useFinanceJob(jobId) polls every 2s until terminal
         → renders "X generated, Y skipped, Z failed → [Retry failed only] button"

Operator → /invoices list
  New grade chip alongside status chips
  Select rows (filtered or select-all) → "Download ▾" menu (ZIP | Merged PDF)
  POST /finance/schools/:schoolId/invoices/bulk-pdf-export { invoiceIds, format }
  → 202 { jobId } → JobProgressModal polling → terminal → download anchor (no auto-download)

Operator → /payments list (row selection added)
  Same affordance routing to bulk-receipt-pdf-export
```

### Five CLAUDE.md traps most relevant here

1. **Three-way route registration** (CLAUDE.md §434-460). Every new endpoint touches the Nest controller, [server/lib/tenant-api-prod.json](server/lib/tenant-api-prod.json), and [nginx.template](server/application/reverseproxy/nginx.template) only if a brand-new top-level prefix is introduced. We deliberately keep all routes under existing `/finance/*` prefixes; nginx.template is untouched. `scripts/check-route-drift.ts` must pass.
2. **Cross-service DDB / S3 IAM grants on the ABAC role** (CLAUDE.md §462-484). Finance ABAC role currently has zero S3 statements. Empty `cdk diff tenant-template-stack-basic` after Sprint F.1 means the grant is missing — a false-clear that ships a broken worker. Acceptance gates the deploy on a non-empty diff showing the new S3 statement.
3. **Route → component, never file-name → component** (CLAUDE.md §586-624). Frontend edits to the wizard and list pages must be traced from the URL through the router → page → tab → component. The wizard lives at `routes/billing/invoices/bulk-generate.tsx` rendering `BulkInvoiceForm.tsx`; either is a plausible-looking edit target but only one is actually rendered.
4. **Shared-types caret-pin pitfall for 0.x** (CLAUDE.md §504-520). Every `@aibrains/shared-types` minor bump requires consumer pin bumps in the same PR: `server/application/package.json`, `server/package.json`, root lockfile. Docker builds resolve from registry, not workspace symlinks.
5. **`AwsCustomResource` is a blunt instrument** (CLAUDE.md). N/A for runtime worker code, but if Sprint I.1 janitor is wired as a CDK custom resource (it shouldn't be — it's a scheduled Lambda), this trap applies. Pre-create the IAM role unconditionally with `inlinePolicies` to avoid the same-deploy propagation race.

---

## 3. Sprint-by-Sprint Breakdown

9 sprints, strictly ordered for the data-dependency chain: **0 → A → B → C → D → E → F → G → H → I**. Each sprint = 4–8 tickets, each ticket = 1 PR, each sprint independently deployable through the change-to-deploy ladder.

---

### SPRINT 0 — Foundations (latency truth, idempotency, audit scaffolding)

**Goal:** Establish facts and shared infra before any sprint commits to a budget that depends on them.

**Demo:** (a) Single-PDF latency findings doc reviewed in standup; (b) `Idempotency-Key` header round-trips on a stub endpoint; (c) `FinanceAuditEvent` row writes and reads in dev-pabson-primary.

#### 0.1 — PDF latency investigation + findings doc
- Description: Half-day spike. Instrument the existing single-PDF path in finance: log timings around (a) DDB GetItem, (b) `IdentityClient.getBranding`, (c) `IdentityClient.getCurrentTemplate`, (d) `renderToBuffer`, (e) total server time. Run from inside the ECS task (eliminate user-network latency). Run also from a developer laptop in US to confirm/refute the network-vs-architecture split.
- Acceptance:
  - Findings doc at `docs/perf/finance-pdf-single-render-2026Q3.md` with measured p50/p95 per stage and a recommendation for any sub-1-day optimization (e.g., template cache TTL bump, font preload, identity-call parallel-fetch confirmation) that should land in Sprint A
  - Confirms or refutes the working assumption that bulk-job latency = `(one-time branding+template fetch) + (N × pdfkit render at < 600ms p95)`
- Tests: the doc + the instrumentation PR (instrumentation is reverted or feature-flagged off before merge to main)
- Files: instrumentation in [invoices.service.ts](server/application/microservices/finance/src/invoices/invoices.service.ts); doc as listed
- Dependencies: none

#### 0.2 — `IdempotencyKey` entity + middleware
- Description: Generic Nest middleware reading `Idempotency-Key` header on POST endpoints opting in via a decorator. On hit (key seen for this operator+tenant in last 24h): replay the stored response. On miss: process, store `{key → response}` in DDB with 24h TTL.
- Acceptance:
  - `@Idempotent()` decorator on a controller method enables the middleware
  - 24h DDB TTL set on the row
  - Operator-supplied UUID format-validated (reject malformed keys with 400)
  - Cap: 1000 idempotency rows per operator per day (avoids unbounded growth from misuse)
- Tests: middleware unit test + integration spec hitting a stub endpoint twice with the same key, asserting the second call doesn't invoke the handler
- Files:
  - [server/application/microservices/finance/src/common/middleware/idempotency.middleware.ts](server/application/microservices/finance/src/common/middleware) (new)
  - [server/application/microservices/finance/src/common/entities/idempotency-key.entity.ts](server/application/microservices/finance/src/common/entities) (new)
- Dependencies: none

#### 0.3 — `FinanceAuditService` + `FinanceAuditEvent` entity
- Description: Audit writer for finance-scoped events. First consumers: bulk-export endpoints (Sprints F/G). Audit events fan out to (a) DDB row for queryability and (b) structured CloudWatch log line for SIEM ingestion. Reuse audit envelope from identity's pattern at `server/application/microservices/identity/src/common/services/audit-event.service.ts`.
- Acceptance:
  - `FinanceAuditService.emit(eventType, payload)` writes a DDB row + CloudWatch line
  - Event types enumerated: `finance.bulk_export.{requested,started,succeeded,failed,url_minted}` (plus headroom for future write events)
  - `presignedKeyHash` field stores SHA256 of the S3 key, not the URL
  - `requestIp` populated from the JWT `aws:SourceIp` claim if present
  - Operator-queryable via `GET /finance/audit/bulk-export?from=&to=&schoolId=&operatorId=`
- Tests: service unit test + controller spec for the read endpoint
- Files:
  - [server/application/microservices/finance/src/common/entities/finance-audit-event.entity.ts](server/application/microservices/finance/src/common/entities) (new)
  - [server/application/microservices/finance/src/common/services/finance-audit.service.ts](server/application/microservices/finance/src/common/services) (new)
  - [server/application/microservices/finance/src/audit/](server/application/microservices/finance/src/audit) (new controller)
  - [server/lib/tenant-api-prod.json](server/lib/tenant-api-prod.json) (new audit read route)
- Dependencies: none

#### 0.4 — Smoke harness scaffolding for finance bulk-ops
- Description: New smoke file `scripts/smokes/finance-bulk-ops.smoke.ts` skeleton, registered in `scripts/smokes/index.ts`. Empty cases for: sync-generate, async-generate, ZIP export, merged-PDF export, GET job by id, 413 boundary at 26 students, 404 on cross-school job access, idempotent submission replay. Subsequent sprints fill the case bodies.
- Acceptance: harness loads; running it produces "0 cases" output without error; one trivial case (GET /finance/health) passes
- Tests: the smoke runs in CI nightly
- Files: [scripts/smokes/finance-bulk-ops.smoke.ts](scripts/smokes) (new)
- Dependencies: none

---

### SPRINT A — Invoice + Payment `gradeLevel` snapshot, GSI14, backfill

**Goal:** Every new invoice/payment carries the snapshot grade level; GSI14 is live; existing rows are backfilled. **No `UNKNOWN` sentinel** — unresolved rows stay sparse on the GSI and are surfaced separately.

**Demo:** Operator generates a single invoice for a Grade 5 student → DDB row shows `gradeLevel: "5"`, GSI14 keys populated. Companion payment row shows the same. Backfill summary: "N rows updated, M unresolved (excluded from GSI), 0 errors."

#### A.1 — Populate `gradeLevel` snapshot on Invoice creation
- Description: In `InvoicesService.generate()`, if `dto.gradeLevel` is undefined, set it from already-fetched `studentInfo.currentGradeLevel` (line 172) before constructing the entity. `generateBulk()` inherits via `generate()`.
- Acceptance:
  - Entity row carries non-empty `gradeLevel` for every code path that successfully fetched studentInfo
  - When studentInfo is null: gradeLevel remains undefined (not empty string), `gradeLevelResolutionStatus: 'unresolved'` set, audit warning logged
  - `dto.gradeLevel`-supplied path continues to win (admin-override scenario)
  - Mapper passes both fields through
- Tests: `invoices.service.spec.ts` cases for default-fill, override-wins, unresolved-marks-status
- Files:
  - [server/application/microservices/finance/src/invoices/invoices.service.ts](server/application/microservices/finance/src/invoices/invoices.service.ts) (~lines 172-240)
  - [server/application/microservices/finance/src/common/entities/invoice.entity.ts](server/application/microservices/finance/src/common/entities/invoice.entity.ts) (add `gradeLevelResolutionStatus?: 'resolved'|'unresolved'`)
  - [server/application/microservices/finance/src/common/mappers/invoice.mapper.ts](server/application/microservices/finance/src/common/mappers/invoice.mapper.ts)
- Dependencies: none

#### A.2 — Denormalize `gradeLevel` onto Payment at issue time
- Description: When a payment is recorded against an invoice, snapshot the invoice's `gradeLevel` onto the payment row. Reuses the parent-invoice lookup already in `payments.service.ts:recordManualPayment` and the existing `TransactWriteItems` block.
- Acceptance:
  - Every new payment row carries `gradeLevel` matching its parent invoice
  - Backfill case: invoice.gradeLevel undefined → payment.gradeLevel undefined (sparse)
  - Mapper passes through
- Tests: `payments.service.spec.ts` case asserting payment.gradeLevel === invoice.gradeLevel after recordManualPayment
- Files:
  - [server/application/microservices/finance/src/payments/payments.service.ts](server/application/microservices/finance/src/payments/payments.service.ts)
  - [server/application/microservices/finance/src/common/entities/payment.entity.ts](server/application/microservices/finance/src/common/entities/payment.entity.ts)
- Dependencies: A.1

#### A.3 — GSI14 on finance DDB stack (school + gradeLevel × entity-sort)
- Description: `addGlobalSecondaryIndex` block with `gsi14pk = TENANT#{tid}#SCHOOL#{schoolId}#GRADE#{gradeLevel}`, `gsi14sk = {ENTITY}#{date}` where ENTITY ∈ {`INVOICE`, `PAYMENT`}. Sparse: keys absent when gradeLevel undefined. `GSIKeyBuilder.schoolGradeScope(tenantId, schoolId, gradeLevel)` added to base.entity.ts.
- Acceptance:
  - GSI14 declared in `ecs-dynamodb.ts` immediately after GSI13 with a comment describing the dual-entity access pattern
  - `createInvoiceEntity` and `createPaymentEntity` set the gsi14 keys only when `gradeLevel` is set
  - `cdk synth tenant-template-stack-basic` passes; `cdk diff` shows exactly ONE GSI addition (DDB hard limit)
  - The DDB online GSI build is scheduled with a documented maintenance window (~10 min on the existing table size)
- Tests: entity specs asserting sparse population; CDK snapshot test
- Files:
  - [server/lib/tenant-template/ecs-dynamodb.ts](server/lib/tenant-template/ecs-dynamodb.ts) (after GSI13 block)
  - [server/application/microservices/finance/src/common/entities/base.entity.ts](server/application/microservices/finance/src/common/entities/base.entity.ts)
  - [server/application/microservices/finance/src/common/entities/invoice.entity.ts](server/application/microservices/finance/src/common/entities/invoice.entity.ts)
  - [server/application/microservices/finance/src/common/entities/payment.entity.ts](server/application/microservices/finance/src/common/entities/payment.entity.ts)
- Dependencies: A.1, A.2

#### A.4 — `listBySchoolAndGrade` service method using GSI14
- Description: New `InvoicesService.listBySchoolAndGrade` and `PaymentsService.listBySchoolAndGrade` methods. Same return shape (`{items, lastEvaluatedKey, hasMore}`) as `list()`. Used by Sprint B.
- Acceptance:
  - Signature mirrors `list()`; status/AY become FilterExpression on the GSI14 Query
  - Cursor pagination preserved
  - Empty-string gradeLevel rejected (defensive — never happens via UI)
  - Logs `listBySchoolAndGrade entity=X schoolId=Y grade=Z returned=N`
- Tests: service unit tests mocking the GSI query
- Files:
  - [server/application/microservices/finance/src/invoices/invoices.service.ts](server/application/microservices/finance/src/invoices/invoices.service.ts)
  - [server/application/microservices/finance/src/payments/payments.service.ts](server/application/microservices/finance/src/payments/payments.service.ts)
- Dependencies: A.3

#### A.5 — Backfill script: `scripts/operations/finance-backfill-grade-snapshot.ts` + deploy
- Description: Scans finance table for `INVOICE#…` and `PAYMENT#…` rows with missing `gradeLevel`. Resolves invoice's gradeLevel from academics; payment's gradeLevel from its parent invoice's (already-set or freshly-resolved) value. Idempotent (`attribute_not_exists(gradeLevel)`).
  - **No UNKNOWN sentinel.** Unresolved rows stay sparse (gradeLevel undefined → absent from GSI14 → invisible to grade filters). They are flagged `gradeLevelResolutionStatus: 'unresolved'` for a separate "Unfiltered (grade unknown)" UI bucket (added in Sprint B).
  - `--dry-run`, `--limit N`, `--tenant <tid>` flags. Per-row failures logged + skipped, not fatal.
  - Final summary `{updated, unresolved, skipped, errors, durationSec}` + a `findings.csv` of unresolved rows for ops review.
- Acceptance + deploy:
  - Spec passes against in-memory DDB local fixture
  - Dry-run executed against dev-pabson-primary → log archived to `docs/deploys/`
  - Real run executed; ≥ 95% resolution rate confirmed; unresolved count documented
- Tests: spec + operator-visual log review
- Files:
  - [scripts/operations/finance-backfill-grade-snapshot.ts](scripts/operations) (new)
  - [scripts/operations/finance-backfill-grade-snapshot.spec.ts](scripts/operations) (new)
  - `docs/deploys/dev-pabson-primary-finance-grade-backfill-<ts>.log`
- Dependencies: A.4 deployed

---

### SPRINT B — Grade filter on invoice + payment lists

**Goal:** Operator filters both lists by grade with no JOIN fragility. "Unfiltered (grade unknown)" bucket exposes the unresolved rows.

**Demo:** Operator opens `/finance/billing/invoices`, picks Grade 5 chip, list refreshes. Picks "Unknown" chip, sees the 12 unresolved rows. Same on `/payments`. All status/AY combinations work.

#### B.1 — `gradeLevel` query param on `GET /finance/schools/:schoolId/invoices`
- Description: Plumb param through controller → service. When set, route to `listBySchoolAndGrade` (A.4). Accept literal value `'__UNRESOLVED__'` to route to a sparse-status query (separate code path returning rows with `gradeLevelResolutionStatus: 'unresolved'`).
- Acceptance:
  - `@Query('gradeLevel')` on controller
  - Combines with `status` + `academicYear` filters on the GSI14 query
  - Omitting the param: unchanged GSI1 path
  - API GW spec [tenant-api-prod.json](server/lib/tenant-api-prod.json) updated; `npm run lint:routes` passes
- Tests: controller + service specs covering the three-way branching (no-filter | grade-set | unresolved)
- Files: controller, service, api-prod.json
- Dependencies: Sprint A complete

#### B.2 — `gradeLevel` query param on `GET /finance/schools/:schoolId/payments`
- Description: Mirror of B.1 for payments. Because Payment now carries its own gradeLevel snapshot (A.2), this is a direct GSI14 query — **no JOIN, no overfetch**.
- Acceptance: same shape as B.1
- Tests: controller + service specs
- Files: payments controller, service, api-prod.json
- Dependencies: A.4

#### B.3 — Lift `useSchoolEnabledGradeOptions` into a shared package
- Description: De-duplicate `deriveSchoolGradeCodes` from `apps/finance/src/routes/configuration/fee-structures.tsx:88` and the academics hook at `apps/academics/src/hooks/useGradeOptions.ts`. Landing: new package `@aibrains/grade-options` (must be npm-published — Docker-built MFEs can't consume workspace-only `@edforge/*` packages per CLAUDE.md §495-501).
- Acceptance:
  - New package published; both `apps/academics` and `apps/finance` import from it
  - Academics hook becomes a thin re-export
  - Existing tests moved alongside the new shared hook
- Tests: Vitest unit asserting the three resolution rules (enabledGradeLevels > gradeRange > fallback)
- Files: new package; updates to both MFE imports
- Dependencies: none (frontend-only)

#### B.4 — Grade filter chip on invoice list (incl. "Unknown" bucket)
- Description: `FinanceFilterChips`-styled grade dropdown beside status chips. Options: All / Grade N (from `useSchoolEnabledGradeOptions`) / Unknown. Wires to `gradeLevel` param.
- Acceptance:
  - Chip dropdown renders; selection updates `useInvoicesInfinite` query key
  - "Clear filters" resets all chips
  - Empty-state copy distinguishes "No Grade-X invoices in selected period" vs "No unresolved-grade invoices"
- Tests: operator-visual via `pnpm dev:finance`
- Files: invoice list page, finance-services hook + service
- Dependencies: B.1, B.3

#### B.5 — Grade filter chip on payment list
- Description: Mirror of B.4 for payments.
- Acceptance: same shape
- Tests: operator-visual
- Files: payment list page + hook + service
- Dependencies: B.2, B.3

#### B.6 — Route-shape guard tests for grade-filter calls
- Description: Extend [payments-service-routes.test.ts](edforge-saas-frontend/packages/finance-services/src/__tests__/payments-service-routes.test.ts) and the invoices counterpart with new cases asserting `apiGet(...invoices, {gradeLevel: 'X'})` and `apiGet(...payments, {gradeLevel: 'X'})` use the exact paths.
- Acceptance: vitest green
- Tests: the tests themselves
- Files: the route-shape test files
- Dependencies: B.4, B.5

---

### SPRINT C — Bulk generation accepts grade filter (sync path, idempotent)

**Goal:** Backend bulk-generate accepts `gradeLevels[]`; wizard Step 1 has "By Grade" tab. Synchronous for ≤25 students; above that, 413 with a pointer to the async endpoint (introduced in Sprint E). Idempotency-Key plumbed on submit.

**Demo:** Operator picks Grades 1-3 in the wizard → preview shows "Will generate 240 invoices" → submits → for a fixture of 22 students, sees synchronous success in <5s. Double-clicks submit: second call returns the original result without spawning a duplicate job.

#### C.1 — Extend `bulkGenerateInvoiceSchema` via `z.discriminatedUnion`
- Description: Discriminated union on a `selectionMode: 'students' | 'grades'` field. `students` requires `studentIds[]`; `grades` requires `gradeLevels: (string | 'ALL')[]`. Avoids the `superRefine` fragility flagged in review.
- Acceptance:
  - Schema validates each shape; operator-friendly error messages
  - `BulkGenerateInvoiceDto` type union exported correctly
- Tests: schema unit tests for valid + invalid combinations
- Files: [packages/shared-types/src/schemas/finance/invoice.schema.ts](packages/shared-types/src/schemas/finance/invoice.schema.ts)
- Dependencies: none

#### C.2 — Bump `@aibrains/shared-types` minor + consumer pin bumps
- Description: Per CLAUDE.md §504-520 — bump, publish, update pins in `server/application/package.json`, `server/package.json`, root lockfile.
- Acceptance: new minor visible on npm; Docker build of finance succeeds
- Tests: full backend `nest build` + frontend `pnpm typecheck`
- Files: the three package.jsons + lockfile
- Dependencies: C.1

#### C.3 — `BulkOpsService.resolveStudentIds(filter)` helper
- Description: Given `{selectionMode: 'grades', gradeLevels: [...]}` or `{selectionMode: 'students', studentIds: [...]}`, returns flat de-duplicated `studentIds[]` by calling academics. Parallel calls per grade; `ALL` is a single no-grade call.
- Acceptance:
  - De-dupes
  - Hard cap 5,000 students total; > 5,000 throws `PayloadTooLargeException`
  - Partial-failure tolerance: single-grade failure → log + continue; total failure → throw
  - Logs `resolveStudentIds schoolId=X grades=[…] resolved=N`
- Tests: service spec with mocked academics httpClient
- Files: [server/application/microservices/finance/src/bulk-ops/bulk-ops.service.ts](server/application/microservices/finance/src/bulk-ops/bulk-ops.service.ts) (new)
- Dependencies: C.2

#### C.4 — `InvoicesService.generateBulk` honours the new payload shape (sync ≤25)
- Description: Accept the wider DTO. If `gradeLevels` present, call `resolveStudentIds` first. Existing batched-`Promise.allSettled(10)` loop preserved. Sync threshold = 25 students; 26+ returns 413 + `nextAction` hint.
- Acceptance:
  - Both payload shapes work
  - 25→26 boundary correctly switches to 413
  - All existing duplicate-detection logic preserved
  - **Idempotency-Key middleware (Sprint 0.2) applied** — second submission with same key returns the original response
- Tests: service spec for both shapes; controller spec for 413 boundary; integration test for idempotent replay
- Files:
  - [server/application/microservices/finance/src/invoices/invoices.service.ts](server/application/microservices/finance/src/invoices/invoices.service.ts) (line 845)
  - [server/application/microservices/finance/src/invoices/invoices.controller.ts](server/application/microservices/finance/src/invoices/invoices.controller.ts) (line 90)
- Dependencies: C.3, 0.2

#### C.5 — Wizard Step 1 "By Grade" tab + preview integration
- Description: Tab toggle at top of Step 1: "By Student" (existing) | "By Grade" (new). Grade tab uses `useSchoolEnabledGradeOptions` chips + "All grades" toggle. Preview (Step 4) calls a new `GET /finance/schools/:schoolId/bulk-preview?selectionMode=grades&gradeLevels=…` endpoint that returns `{studentCount, eligibleCount, duplicateCount, estimatedDurationSec}`. Submission generates a fresh UUID per form-submit and passes it as `Idempotency-Key`.
- Acceptance:
  - Tab state held in form state; switching clears the other tab's selection
  - "All grades" toggle sends `gradeLevels: ['ALL']`
  - Preview Step 4 shows resolved counts; when `studentCount > 25` a banner appears: "This will run as a background job (estimated N minutes). You can keep this tab open."
  - On submit: confirmation modal when studentCount > 100: "Generate N invoices? This cannot be undone."
- Tests: operator-visual via `pnpm dev:finance`
- Files: [BulkInvoiceForm.tsx](edforge-saas-frontend/apps/finance/src/components/billing/BulkInvoiceForm.tsx)
- Dependencies: C.2, B.3

#### C.6 — `GET /finance/schools/:schoolId/bulk-preview` endpoint
- Description: Lightweight read-only endpoint backing C.5's preview. Calls `resolveStudentIds` + existing duplicate-detection. Does NOT generate.
- Acceptance:
  - Permission `billing:view`
  - Response time < 2s for `ALL` on 800-student tenant
  - Route registered in api-prod.json; route-drift lint passes
- Tests: controller + service spec; smoke harness case added
- Files:
  - [server/application/microservices/finance/src/invoices/invoices.controller.ts](server/application/microservices/finance/src/invoices/invoices.controller.ts)
  - [server/lib/tenant-api-prod.json](server/lib/tenant-api-prod.json)
- Dependencies: C.4

---

### SPRINT D — Async job framework foundation (entity + service + GET endpoint)

**Goal:** Job entity, lifecycle service, and read endpoint live. **No worker yet** — worker ships in Sprint E with the concurrency validation. Sprint D ends with the ability to write/read a job row by hand and observe lifecycle transitions.

**Demo:** A unit-test script creates a `FinanceJob` row, transitions through states, and a `GET /finance/jobs/:jobId` call returns it. Cross-school GET returns 404 (not 403).

#### D.1 — `FinanceJob` entity + key builder + types
- Description: Entity definition mirroring `IemisImportJob` shape but with finance-specific fields per §2.4 above. Capped `errors[]` (200) + capped `failedStudentIds[]` (500).
- Acceptance: `createFinanceJobEntity()`, `capErrors()`, `capFailedStudents()`, `EntityKeyBuilder.financeJob(jobId)` returning `FINANCE_JOB#{jobId}`
- Tests: entity spec for shape + cap helpers
- Files:
  - [server/application/microservices/finance/src/common/entities/finance-job.entity.ts](server/application/microservices/finance/src/common/entities) (new)
  - [server/application/microservices/finance/src/common/entities/base.entity.ts](server/application/microservices/finance/src/common/entities/base.entity.ts)
- Dependencies: none

#### D.2 — `FinanceJobsService` (CRUD + lifecycle transitions)
- Description: `create / get / markRunning / markCompleted / markFailed / appendFailedStudent / list`. Conditional UpdateItem with version increment for transitions (concurrent worker + janitor write-safety).
- Acceptance:
  - All transitions atomic with version check
  - `get()` returns row or `NotFoundException`
  - `list(schoolId, {limit, cursor, since})` returns sorted by createdAt desc
- Tests: full service spec covering each transition + version-mismatch path
- Files:
  - [server/application/microservices/finance/src/bulk-ops/finance-jobs.service.ts](server/application/microservices/finance/src/bulk-ops/finance-jobs.service.ts) (new)
- Dependencies: D.1

#### D.3 — `BulkOpsController` with `GET /finance/jobs/:jobId`
- Description: New controller at `/finance/jobs`. Only the GET endpoint in this sprint. **Cross-school access returns 404, not 403** (UUIDs are not enumerable across schools by design).
- Acceptance:
  - Permission `billing:view` + operator's school-scope must include `job.schoolId`; else 404
  - Route in api-prod.json; check-route-drift passes
  - nginx.template untouched (existing `^/finance` covers); CLAUDE.md §434-460 referenced in PR description
- Tests: controller spec covering same-school 200, cross-school 404, non-existent 404; smoke case added
- Files:
  - [server/application/microservices/finance/src/bulk-ops/bulk-ops.controller.ts](server/application/microservices/finance/src/bulk-ops/bulk-ops.controller.ts) (new)
  - [server/lib/tenant-api-prod.json](server/lib/tenant-api-prod.json)
- Dependencies: D.2

#### D.4 — `BulkOperationsModule` wiring + module-wiring spec entry
- Description: Wire the new module into `FinanceModule`. **CRITICAL** per CLAUDE.md §574-583: declare providers in `BulkOperationsModule.providers` AND register the module in `__tests__/module-wiring.spec.ts` in the SAME PR.
- Acceptance:
  - Module declares `[FinanceJobsService, BulkOpsService, FinanceAuditService, IdentityClientService, DynamoDBClientService]` + any others touched
  - Wiring spec updated and green
  - `npx nest build finance` succeeds
- Tests: the wiring spec
- Files:
  - [server/application/microservices/finance/src/bulk-ops/bulk-ops.module.ts](server/application/microservices/finance/src/bulk-ops/bulk-ops.module.ts) (new)
  - [server/application/microservices/finance/src/finance.module.ts](server/application/microservices/finance/src/finance.module.ts)
  - [server/application/microservices/finance/src/__tests__/module-wiring.spec.ts](server/application/microservices/finance/src/__tests__/module-wiring.spec.ts)
- Dependencies: D.3

#### D.5 — Frontend `useFinanceJob(jobId)` hook + service
- Description: Mirrors `useIemisImportJob` — TanStack Query with `refetchInterval: 2000` until terminal status. `useFinanceJob` invalidates `paymentKeys.invoices(schoolId)` on `succeeded`.
- Acceptance:
  - Query key `['finance-job', jobId]`
  - Route-shape test added asserting `apiGet('/finance/jobs/{jobId}')` exact URL
  - Hook tested with TanStack Query test harness
- Tests: vitest hook test
- Files:
  - [packages/finance-services/src/hooks/useFinanceJob.ts](edforge-saas-frontend/packages/finance-services/src/hooks/useFinanceJob.ts) (new)
  - [packages/finance-services/src/services/jobs.service.ts](edforge-saas-frontend/packages/finance-services/src/services/jobs.service.ts) (new)
  - [packages/finance-services/src/__tests__/jobs.service.test.ts](edforge-saas-frontend/packages/finance-services/src/__tests__/jobs.service.test.ts)
- Dependencies: D.3

---

### SPRINT E — Async invoice generation worker (concurrency + transaction validation)

**Goal:** First worker ships. The `bulk_invoice_generate` async path goes end-to-end. **A validation spike is the first ticket** — answers whether the existing `generate()` is safe under concurrency before the worker is implemented.

**Demo:** Operator runs the wizard for "All grades" on a 600-student tenant → 202 → modal polls → ~3-4 min later succeeds with "586 generated, 14 skipped, 0 failed." Operator views the job's audit-event row.

#### E.1 — Transaction-conflict + concurrency validation spike
- Description: 1-day spike. Build a test harness that calls `InvoicesService.generate()` against a fixture tenant with `p-limit(8)` × 200 students. Measure:
  - `TransactionCanceledException` rate (must be <1%)
  - Any per-school serialization point (e.g., shared invoice-number counter row) that defeats the concurrency budget — if found, propose a remedy (per-shard counter, optimistic skip + retry, etc.) before E.3 builds on it
  - Per-student p50 / p95 transaction time
  - DDB consumed-capacity profile
- Acceptance: findings doc at `docs/perf/finance-bulk-generate-concurrency-2026Q3.md` with go/no-go on the worker's design + a documented retry policy
- Tests: the harness + the doc
- Files: instrumentation in `scripts/perf/finance-bulk-generate-spike.ts` (new); the findings doc
- Dependencies: D.4

#### E.2 — Per-school concurrency semaphore
- Description: In-memory `Map<schoolId, Promise>` in `BulkOpsService`. A second job for the same school stays `queued` until the first terminates. Worker picks up FIFO. Across schools: parallel. Across ECS tasks (multi-replica): each task has its own semaphore; the janitor (Sprint I) is the cross-task safety net.
- Acceptance:
  - Two jobs submitted for same school: second's `markRunning` happens after first's `markCompleted`
  - Two jobs for different schools: both `running` simultaneously
  - Semaphore size = 1 per school in V1; configurable via env var
- Tests: integration test simulating concurrent submissions
- Files: [server/application/microservices/finance/src/bulk-ops/bulk-ops.service.ts](server/application/microservices/finance/src/bulk-ops/bulk-ops.service.ts)
- Dependencies: E.1

#### E.3 — Async `POST /invoices/bulk-generate` branch
- Description: Add `?async=true` query param OR auto-promote when `studentCount > 25`. Returns 202 + jobId. Worker invoked via `setImmediate`. Idempotency-Key honoured (replays return original jobId).
- Acceptance:
  - Sync ≤25, async >25 (configurable via env var `BULK_SYNC_THRESHOLD`)
  - Idempotency replay works across sync/async boundary
  - Route registered in api-prod.json
- Tests: controller spec covering sync/async branching + idempotent replay; smoke case added
- Files:
  - [server/application/microservices/finance/src/invoices/invoices.controller.ts](server/application/microservices/finance/src/invoices/invoices.controller.ts)
  - [server/lib/tenant-api-prod.json](server/lib/tenant-api-prod.json)
- Dependencies: E.2

#### E.4 — `BulkInvoiceGenerateWorker`
- Description: Worker invoked from controller's async branch. State machine: `markRunning` → loop with `p-limit(N)` + per-student `generate()` → `markCompleted` or `markFailed`. Counters updated in DDB every 25 students. Per-student `TransactionCanceledException` retried up to 2× with jittered backoff; final failure appended to `failedStudentIds[]` (capped at 500). Catch-all `try/finally` calls `markFailed` with truncated error string.
- Acceptance:
  - Hard cap on duration: 60 min; warn at 50 min
  - Idempotent at job-level: failed job's retry is a new jobId, populated from `failedStudentIds`
  - **Calls `FinanceAuditService.emit('finance.bulk_generate.{started,succeeded,failed}', ...)`** at the relevant transitions
- Tests: worker spec with mocked DDB + InvoicesService; spec asserts the per-student retry + the audit emit
- Files:
  - [server/application/microservices/finance/src/bulk-ops/workers/bulk-invoice-generate.worker.ts](server/application/microservices/finance/src/bulk-ops/workers/bulk-invoice-generate.worker.ts) (new)
- Dependencies: E.3, 0.3

#### E.5 — Wizard async submit UX (mirrors IemisImport.tsx)
- Description: When the wizard submission returns 202, render the IEMIS-style indeterminate progress bar with "Generating invoices for N students. You can keep this tab open or come back later." Poll via `useFinanceJob`. Terminal-success: summary panel with "**Retry N failed** only" button if failures present. Terminal-failure: error string + "Retry" button (re-runs original input).
- Acceptance:
  - Copy matches IEMIS pattern; reference `IemisImport.tsx`
  - Progress bar indeterminate (per-step DDB writes too expensive for percent-true progress)
  - Toast on succeeded/failed
  - "Retry failed only" submits a new job restricted to `failedStudentIds`
- Tests: operator-visual via `pnpm dev:finance`; manual test against stubbed worker
- Files: [BulkInvoiceForm.tsx](edforge-saas-frontend/apps/finance/src/components/billing/BulkInvoiceForm.tsx)
- Dependencies: E.4, D.5

---

### SPRINT F — Bulk invoice download (ZIP + audit + S3 grants)

**Goal:** Operator selects N invoices and downloads as ZIP within 3-5 min for 800. Full audit trail.

**Demo:** Operator filters invoices to Grade 5 + status Issued → "Select all 86" → "Download ▾ → ZIP of PDFs" → JobProgressModal polls → succeeded → clicks "Download invoices.zip" → 86-PDF ZIP arrives. Audit-event view shows the request + the URL-mint event.

#### F.1 — S3 grants on finance ABAC role + `PDF_OUTPUT_BUCKET` env var
- Description: Add `s3:PutObject`, `s3:GetObject`, `s3:PutObjectTagging` on `arn:aws:s3:::edforge-pdfs-{account}-{region}/tenants/${aws:PrincipalTag/tenant}/*` to finance ABAC role. Mirror identity's branding block at [tenant-template-stack.ts:664-704](server/lib/tenant-template/tenant-template-stack.ts) under `info.name === 'finance'`. Inject `PDF_OUTPUT_BUCKET` env var into finance container.
- Acceptance:
  - `cdk diff tenant-template-stack-basic` shows the new IAM statements + env var. **Empty diff = grant missing = block deploy** (the CLAUDE.md §462-484 false-clear trap)
  - cdk-nag passes
- Tests: `tenant-template-stack.spec.ts` adding an assertion that finance role inline policies include the S3 statement
- Files:
  - [server/lib/tenant-template/tenant-template-stack.ts](server/lib/tenant-template/tenant-template-stack.ts) (~line 624)
  - [server/service-info.txt](server/service-info.txt) (env var declaration for finance)
- Dependencies: Sprint E shipped

#### F.2 — `S3Service` in finance common
- Description: Wraps `@aws-sdk/client-s3`. Methods `putPdf(key, buffer)`, `putZip(key, stream)`, `presignGet(key, expirySec)`. All puts tag `{lifecycle: 'pdf-jobs'}`.
- Acceptance:
  - Tagging unit-tested
  - Presigned URL TTL = 900s default
  - Multipart upload used for streams >5MB
- Tests: spec with mocked S3Client
- Files: [server/application/microservices/finance/src/common/services/s3.service.ts](server/application/microservices/finance/src/common/services/s3.service.ts) (new)
- Dependencies: F.1

#### F.3 — `BulkInvoicePdfExportWorker` (ZIP variant)
- Description: Worker for `jobType: 'bulk_invoice_pdf_export', outputFormat: 'zip'`. Steps:
  1. `markRunning` + audit `started` event
  2. ONE-TIME branding + template fetch (the latency optimization)
  3. `p-limit(N)` over invoice IDs; per invoice: load entity → render via `renderInvoiceToPdfBuffer` with pre-fetched branding/template
  4. Stream each finished PDF into an `archiver` ZIP being uploaded to S3 via multipart
  5. On success: `markCompleted` with `output.zipKey` + presigned URL + audit `succeeded` + `url_minted` events
- Acceptance:
  - 800-invoice fixture completes in <5 min on existing ECS task size (validated in load test in Sprint I)
  - **Peak RSS measured and logged** via `process.memoryUsage().rss` at completion; documented in spec output. Acceptance: peak RSS under 256 MB (half the ECS task memory)
  - Per-PDF render error: log to `errors[]`, increment `failed`, continue (no whole-job abort for one bad invoice)
  - Job-level idempotent: retry of failed job uses a new jobId; old S3 objects untouched (lifecycle reaps)
- Tests: spec with 50-invoice fixture asserting ZIP size, contents, peak RSS, completion time
- Files:
  - [server/application/microservices/finance/src/bulk-ops/workers/bulk-invoice-pdf-export.worker.ts](server/application/microservices/finance/src/bulk-ops/workers/bulk-invoice-pdf-export.worker.ts) (new)
- Dependencies: F.2, E.4

#### F.4 — `POST /finance/schools/:schoolId/invoices/bulk-pdf-export`
- Description: Endpoint accepting `{invoiceIds: string[], format: 'zip' | 'merged_pdf'}`. Sprint F honours `'zip'` only; `'merged_pdf'` returns 501 (lands in Sprint H). Cap: 2000 invoiceIds (ZIP) per request.
- Acceptance:
  - 202 + jobId
  - Permission `billing:view` + schoolId-scope check (same 404-not-403 contract as D.3)
  - Idempotency-Key honoured
  - Cap enforced
  - Route in api-prod.json; route-drift passes
- Tests: controller spec + smoke case
- Files:
  - [server/application/microservices/finance/src/bulk-ops/bulk-ops.controller.ts](server/application/microservices/finance/src/bulk-ops/bulk-ops.controller.ts)
  - [packages/shared-types/src/schemas/finance/invoice.schema.ts](packages/shared-types/src/schemas/finance/invoice.schema.ts) (`bulkPdfExportSchema`)
  - [server/lib/tenant-api-prod.json](server/lib/tenant-api-prod.json)
- Dependencies: F.3, C.2 (shared-types bump pattern)

#### F.5 — Reusable `JobProgressModal` + invoice list "Download ▾" wiring
- Description: New `JobProgressModal.tsx` (reused across F/G/H). Invoice list adds "Download ▾" menu next to "Issue Selected". Items: "ZIP of PDFs" (enabled), "Merged PDF" (disabled, hint: "Coming in next release"). Submit opens modal; modal polls via `useFinanceJob`; on success shows download anchor (**no auto-download countdown** — operator clicks the link explicitly).
- Acceptance:
  - Modal copy matches IEMIS pattern
  - Download anchor opens in new tab; analytics event fired on click
  - Modal dismissible only after terminal state OR via explicit "Run in background" button (which hides the modal but keeps polling)
- Tests: operator-visual
- Files:
  - [apps/finance/src/components/billing/JobProgressModal.tsx](edforge-saas-frontend/apps/finance/src/components/billing/JobProgressModal.tsx) (new)
  - [apps/finance/src/routes/billing/invoices/index.tsx](edforge-saas-frontend/apps/finance/src/routes/billing/invoices/index.tsx)
- Dependencies: F.4, D.5

#### F.6 — Frontend service + route-shape test for bulk-pdf-export
- Description: `bulkInvoicePdfExport` service + `useBulkInvoicePdfExport` hook + route-guard test asserting exact URL.
- Acceptance: vitest green; cases in new `bulk-ops-routes.test.ts` (file split from `payments-service-routes.test.ts` once >200 lines)
- Tests: the route-guard tests
- Files:
  - [packages/finance-services/src/services/bulk-ops.service.ts](edforge-saas-frontend/packages/finance-services/src/services/bulk-ops.service.ts) (new)
  - [packages/finance-services/src/hooks/useBulkInvoicePdfExport.ts](edforge-saas-frontend/packages/finance-services/src/hooks/useBulkInvoicePdfExport.ts) (new)
  - [packages/finance-services/src/__tests__/bulk-ops-routes.test.ts](edforge-saas-frontend/packages/finance-services/src/__tests__/bulk-ops-routes.test.ts) (new)
- Dependencies: F.4

---

### SPRINT G — Bulk receipt download (row selection on payments + worker + UI)

**Goal:** Same affordance for receipts. Payment list gets row selection (had none).

**Demo:** Operator opens `/payments` → filters by Grade 5 + status `completed` → selects 30 rows → "Download ▾ → ZIP of PDFs" → 30-receipt ZIP downloads. Cross-school polling attempt returns 404.

#### G.1 — Add row selection to payment list
- Description: `TanstackDataTable` supports it; copy `createSelectColumn<Payment>` + `rowSelection` state from the invoice list pattern. Use the same `column-builder` utility.
- Acceptance:
  - Multi-select checkboxes
  - "Select all visible" + "Select all filtered" affordance
  - Selection state persists across pagination changes
- Tests: operator-visual + vitest snapshot
- Files: [apps/finance/src/routes/billing/payments/index.tsx](edforge-saas-frontend/apps/finance/src/routes/billing/payments/index.tsx)
- Dependencies: none

#### G.2 — `BulkReceiptPdfExportWorker`
- Description: Mirror of F.3 but renders receipts via `renderReceiptToPdfBuffer` at [payments/receipt-pdf.renderer.ts](server/application/microservices/finance/src/payments/receipt-pdf.renderer.ts). One-time branding + template fetch (template doctype `RECEIPT`). Per-iteration loads Payment + parent Invoice for school/student context.
- Acceptance: identical contract to F.3; spec covers receipt-specific path
- Tests: spec + smoke case
- Files: [server/application/microservices/finance/src/bulk-ops/workers/bulk-receipt-pdf-export.worker.ts](server/application/microservices/finance/src/bulk-ops/workers/bulk-receipt-pdf-export.worker.ts) (new)
- Dependencies: F.3

#### G.3 — `POST /finance/schools/:schoolId/payments/bulk-pdf-export`
- Description: Endpoint mirror of F.4 but `paymentIds[]`. Cap: 2000.
- Acceptance: 202 + jobId; same 404-not-403 contract; idempotency honoured; route registered
- Tests: controller spec + smoke case
- Files:
  - [server/application/microservices/finance/src/bulk-ops/bulk-ops.controller.ts](server/application/microservices/finance/src/bulk-ops/bulk-ops.controller.ts)
  - [server/lib/tenant-api-prod.json](server/lib/tenant-api-prod.json)
- Dependencies: G.2

#### G.4 — Payment list "Download ▾" wiring (reuses JobProgressModal)
- Description: Same affordance as F.5 on the payment list.
- Acceptance: operator-visual passes
- Tests: operator-visual + new route-shape test case
- Files:
  - [apps/finance/src/routes/billing/payments/index.tsx](edforge-saas-frontend/apps/finance/src/routes/billing/payments/index.tsx)
  - [packages/finance-services/src/services/bulk-ops.service.ts](edforge-saas-frontend/packages/finance-services/src/services/bulk-ops.service.ts) (add `bulkReceiptPdfExport`)
  - [packages/finance-services/src/__tests__/bulk-ops-routes.test.ts](edforge-saas-frontend/packages/finance-services/src/__tests__/bulk-ops-routes.test.ts)
- Dependencies: G.3, F.5

---

### SPRINT H — Merged-PDF variant

**Goal:** Enable the "Merged PDF" radio in the format picker (invoice + receipt). Output is a single concatenated PDF.

**Demo:** Operator picks "Merged PDF" → modal polls → single 86-page PDF downloads.

#### H.1 — `mergePdfBuffers(buffers: Buffer[]): Promise<Buffer>` in `@aibrains/pdf-renderer`
- Description: Add a `pdf-lib`-based helper to the renderer package. **Verify `pdf-lib` is not a peer-dep collision** with `@react-pdf/renderer`'s own pdf-lib pin.
- Acceptance:
  - Pure function; deterministic byte output for identical input
  - Documented memory profile: peak ≈ Σ(input bytes)
  - Unit test merging 5 single-page PDFs → asserts page count = 5
- Tests: renderer spec
- Files:
  - [packages/pdf-renderer/src/merge-pdfs.ts](packages/pdf-renderer/src) (new)
  - [packages/pdf-renderer/src/__tests__/merge-pdfs.spec.ts](packages/pdf-renderer/src/__tests__) (new)
- Dependencies: none

#### H.2 — Publish `@aibrains/pdf-renderer` + consumer pin bump
- Description: Mirror of C.2 for the renderer package.
- Acceptance: finance backend consumes the helper after pin bump + lockfile refresh
- Tests: backend build green
- Files: pdf-renderer package.json, finance package.json, root lockfile
- Dependencies: H.1

#### H.3 — Worker branches: `outputFormat: 'merged_pdf'` (invoice + receipt)
- Description: Extend both workers (F.3, G.2) to honour merged-PDF. Collect buffers, call `mergePdfBuffers`, upload single PDF, populate `output.mergedPdfKey` + URL. **Cap merged-PDF at 1000 documents** (memory ceiling); ZIP cap remains 2000. Format `'both'` cut per review.
- Acceptance:
  - `outputFormat` honoured; correct key populated
  - 1000-document cap enforced at controller (F.4, G.3 updated)
  - Peak RSS measured under 256 MB
- Tests: worker spec for each format mode
- Files: both worker files; controller validation
- Dependencies: H.2

#### H.4 — Enable "Merged PDF" option in JobProgressModal format picker
- Description: Remove disabled state on merged-PDF radio in `JobProgressModal.tsx`. Pick correct download URL per format.
- Acceptance: both options selectable; operator-visual passes
- Tests: operator-visual
- Files: [JobProgressModal.tsx](edforge-saas-frontend/apps/finance/src/components/billing/JobProgressModal.tsx)
- Dependencies: H.3

---

### SPRINT I — Hardening: janitor, observability, lifecycle, runbook, load test

**Goal:** Production-grade ops. Stuck jobs auto-recovered, dashboard live, alarms wired, runbook published, load test validates 3-5 min target. **One sprint** because no piece should ship without the others.

**Demo:** Run a deliberately bad bulk job → kill the ECS task → 60 min later janitor marks it `failed` with sentinel reason → dashboard shows the failure → SNS alert fires.

#### I.1 — `finance-job-janitor` Lambda + EventBridge schedule
- Description: Mirror of `iemis-job-janitor` at [server/lib/analytics/lambda/iemis-job-janitor/handler.ts](server/lib/analytics/lambda/iemis-job-janitor/handler.ts) + CDK wiring at [analytics-stack.ts:942-1004](server/lib/analytics/analytics-stack.ts). Scans finance table for `FINANCE_JOB#…` rows stuck `running` > 60 min, marks failed with sentinel. **Pre-create the role unconditionally with `inlinePolicies`** per CLAUDE.md §770-810 to avoid the IAM propagation race.
- Acceptance:
  - Runs every 5 min via EventBridge Scheduler
  - Conditional UpdateItem (`status = 'running'`) — losing the race to the real worker logged + skipped
  - `STALE_THRESHOLD_MIN: '60'` (PDF generation legitimately runs 5+ min)
  - SNS alert on > 2 marked-failed per 15 min
- Tests: Lambda handler spec mirroring `iemis-job-janitor/handler.spec.ts`
- Files:
  - [server/lib/analytics/lambda/finance-job-janitor/handler.ts](server/lib/analytics/lambda/finance-job-janitor) (new)
  - [server/lib/analytics/lambda/finance-job-janitor/handler.spec.ts](server/lib/analytics/lambda/finance-job-janitor) (new)
  - [server/lib/analytics/analytics-stack.ts](server/lib/analytics/analytics-stack.ts)
- Dependencies: Sprint H shipped to non-prod

#### I.2 — CloudWatch metric filters for job lifecycle
- Description: Three filters on worker structured logs: `finance_job_started`, `finance_job_succeeded`, `finance_job_failed`. Emit to `Edforge/Finance/Jobs` namespace with `jobType` dimension.
- Acceptance: metrics visible within 60s of an event; per-jobType breakdown works
- Tests: smoke (trigger a job, observe metrics tick)
- Files: [analytics-stack.ts](server/lib/analytics/analytics-stack.ts)
- Dependencies: I.1

#### I.3 — CloudWatch dashboard `EdForge-Finance-Jobs`
- Description: Jobs/min by type, success rate, p50/p95 duration, current `running` count (queue depth proxy), error count, top-5 failed error strings, S3 bucket size.
- Acceptance: dashboard JSON committed (cloudwatch.Dashboard construct); renders in console post-deploy
- Tests: visual
- Files: [analytics-stack.ts](server/lib/analytics/analytics-stack.ts)
- Dependencies: I.2

#### I.4 — Alarms: failure rate > 10% over 15 min + queue depth > 5
- Description: Two CW alarms wired to operator-alert SNS topic.
- Acceptance: alarms named `EdForge-Finance-Jobs-FailureRate` and `EdForge-Finance-Jobs-QueueDepth` exist in console; manually breach threshold to validate
- Tests: smoke
- Files: [analytics-stack.ts](server/lib/analytics/analytics-stack.ts)
- Dependencies: I.3

#### I.5 — S3 bucket access logging + lifecycle verification
- Description: Enable S3 server access logging on `edforge-pdfs-{account}-{region}`; logs queryable via CloudWatch Insights. Provides the audit trail of "who downloaded the ZIP at 3:14am." Verify the existing `expire-pdf-jobs-7d` tag rule via `aws s3api get-bucket-lifecycle-configuration` (30s — no 8-day clock test needed).
- Acceptance:
  - Server access logging enabled on the bucket (CDK)
  - `get-bucket-lifecycle-configuration` output archived; tag rule confirmed
  - One-page doc `docs/operations/finance-bulk-ops-lifecycle.md` with the verified rule + access-log query patterns
- Tests: smoke + doc
- Files:
  - [server/lib/.../pdf-assets-bucket.ts](server/lib) (enable access logging)
  - [docs/operations/finance-bulk-ops-lifecycle.md](docs/operations) (new)
- Dependencies: I.4

#### I.6 — Runbook `docs/operations/finance-bulk-ops-runbook.md`
- Description: Operator-facing runbook covering: how to trigger, how to monitor, how to diagnose a stuck job, how to retry, how to manually mark a job failed, how to check S3 for orphaned objects, on-call escalation, **how to bulk-void wrongly-generated invoices** (data-recovery procedure), how to query the audit trail.
- Acceptance: reviewed by one other engineer; linked from `docs/operations/index.md`
- Tests: peer review
- Files: [docs/operations/finance-bulk-ops-runbook.md](docs/operations) (new)
- Dependencies: I.1-I.5

#### I.7 — Load test: 1500-invoice bulk export in non-prod
- Description: Smoke + perf in non-prod against a fixture tenant. Validates the 3-5 min target + peak RSS ceiling at scale.
- Acceptance:
  - 1500-invoice bulk PDF export completes in < 8 min
  - p95 per-PDF render < 600 ms (proves branding/template share is working — the latency-budget validation)
  - Peak RSS < 256 MB
  - No ECS OOM
  - Result archived in `docs/deploys/<env>-finance-bulk-loadtest-<ts>.log`
- Tests: operational
- Files: log only
- Dependencies: I.6

#### I.8 — Production deployment + 24h post-deploy monitoring
- Description: Full change-to-deploy ladder for `tenant-template-stack-basic` (S3 grants + GSI14 if not already) + ECR push + `analytics-stack` (janitor + dashboard). Monitor for 24h.
- Acceptance: prod smoke 4/4 (one small bulk job per type + audit query); dashboard shows zero anomalies; no SNS alerts fire
- Tests: smoke + observation
- Files: deploy logs
- Dependencies: I.7

---

## 4. Verification Strategy (cross-sprint)

- **Unit tests**: every service method (especially `generate()` reentrancy, `markRunning/markCompleted` versioning, `resolveStudentIds` partial-failure paths).
- **Integration tests**: full worker run against DynamoDB Local fixtures with 50-invoice batches.
- **Route-shape guard tests**: every new endpoint adds a case to `bulk-ops-routes.test.ts` asserting exact URL + query-param shape (prevents the PR #93-style silent invented-URL regression).
- **Smoke harness**: `scripts/smokes/finance-bulk-ops.smoke.ts` runs nightly in non-prod, exercises every new endpoint end-to-end including the 404-not-403 cross-school contract.
- **Operator-visual**: every UI change verified with `pnpm dev:finance` in a browser before the PR is declared ready. Type-check + tests catch contracts; only a render-path smoke catches "wrong-component-edited" (the Saraswati AY isCurrent incident reference).
- **Load test (Sprint I.7)**: validates the 3-5 min / 800 PDFs business commitment + the 256 MB RSS ceiling.
- **Audit query (Sprint F+)**: after each bulk export, query the audit endpoint and verify the event row + the URL-mint event are both present.

---

## 5. Open Questions / Risks

Priority-ordered. Each must be answered or accepted before its sprint starts.

1. **Transaction-conflict rate under p-limit(8) is unmeasured.** The Sprint E.1 spike answers this. If `generate()` has an unexpected serialization point (e.g., per-school `LAST_INVOICE_NUMBER` counter row, fee-structure cache row, anything else with a single PK), the worker's concurrency budget is defeated and the 3-5 min target is unreachable. **Get E.1 done before any UI work in Sprint E commits.**

2. **PII bulk export audit logging is a baseline compliance requirement, not a polish item.** Sprint 0.3 ships it before any export endpoint. Schools (especially in regulated markets) will ask who downloaded the bills, when, how often. Without F.3's audit emit + I.5's S3 access logs, "who has my child's invoice on their laptop" is unanswerable.

3. **The 12-15s single-PDF latency is the user's stated complaint.** Sprint 0.1 answers whether the dominant cost is network (US→ap-south-1, fixable only by edge caching or moving the user) or architectural (React-PDF / IdentityClient / something else). If architectural, the 3-5 min bulk target may be unreachable on the existing ECS task profile and Sprint E/F/G assumptions need re-validation **before they ship**, not at I.7.

4. **GSI14 deploys block the table for ~10 min** (AWS hard limit: ONE GSI per table update). Schedule with a documented maintenance window. Confirm no other team is queuing a finance-GSI PR.

5. **The S3 IAM grant in Sprint F.1 is the classic "empty `cdk diff` = false-clear" trap.** Acceptance gates the deploy on a non-empty diff showing the new S3 statement. Code review must verify manually.

6. **Per-school semaphore is per-ECS-task (memory-local).** Two replicas can each run a job for the same school simultaneously. At pilot scale (single-replica during deploy) this is fine. Documented in Sprint E.2; janitor (Sprint I.1) is the cross-replica safety net for the long-tail case. Escalate to a DDB-backed lock if ECS replicas > 1 becomes operational reality.

7. **Idempotency-Key TTL = 24h** means an operator's "submitted yesterday" replay returns the original jobId, not a new run. If the job has been janitor-marked-failed, the replay shows the failed terminal state — operator must then explicitly resubmit (frontend mints a new key). Documented in the runbook.

8. **Merged-PDF mode has a real memory ceiling.** `pdf-lib` holds the full output in memory before upload. 1000 × ~20 kB invoices = ~20 MB output, comfortably within ECS task memory. Cap enforced at controller (1000 for merged; 2000 for ZIP). Above the cap → 413 with an "ALL invoices for school" alternative-flow hint.

9. **Cross-MFE re-use of `useSchoolEnabledGradeOptions` (Sprint B.3)** lands as a new `@aibrains/grade-options` published package. Adds a publish step but follows the existing `@aibrains/shared-types` pattern. Confirm with operator: any preference for one-large-package vs many-small-packages? Default recommendation: small, focused package per scope.

10. **The SBT route-drift trap — `tenant-api-prod.json` is hand-maintained.** Every new route in C.6, D.3, E.3, F.4, G.3 touches it. The route-drift linter is the safety net but can miss a copy-paste-without-update. Every new-route PR description includes a `curl` smoke command against non-prod GW URL showing a 401/403 (proves the GW route exists) rather than the 403 SigV4 "no route" signature.

11. **Backfill (A.5) writes to the live finance table.** Even idempotent UpdateItem, a buggy academics resolution could mass-mis-tag `gradeLevel`. Mitigation: `--dry-run` first with the first 100 rows logged as before/after diff; real run scoped to one tenant via `--tenant` first; spot-check before broad run.

---

## 6. Critical files for implementation

- [server/application/microservices/finance/src/invoices/invoices.service.ts](server/application/microservices/finance/src/invoices/invoices.service.ts)
- [server/application/microservices/finance/src/payments/payments.service.ts](server/application/microservices/finance/src/payments/payments.service.ts)
- [server/application/microservices/finance/src/common/entities/invoice.entity.ts](server/application/microservices/finance/src/common/entities/invoice.entity.ts)
- [server/application/microservices/finance/src/common/entities/payment.entity.ts](server/application/microservices/finance/src/common/entities/payment.entity.ts)
- [server/lib/tenant-template/ecs-dynamodb.ts](server/lib/tenant-template/ecs-dynamodb.ts)
- [server/lib/tenant-template/tenant-template-stack.ts](server/lib/tenant-template/tenant-template-stack.ts)
- [server/lib/tenant-api-prod.json](server/lib/tenant-api-prod.json)
- [server/lib/analytics/analytics-stack.ts](server/lib/analytics/analytics-stack.ts)
- [packages/shared-types/src/schemas/finance/invoice.schema.ts](packages/shared-types/src/schemas/finance/invoice.schema.ts)
- [edforge-saas-frontend/apps/finance/src/components/billing/BulkInvoiceForm.tsx](edforge-saas-frontend/apps/finance/src/components/billing/BulkInvoiceForm.tsx)
- [edforge-saas-frontend/apps/finance/src/routes/billing/invoices/index.tsx](edforge-saas-frontend/apps/finance/src/routes/billing/invoices/index.tsx)
- [edforge-saas-frontend/apps/finance/src/routes/billing/payments/index.tsx](edforge-saas-frontend/apps/finance/src/routes/billing/payments/index.tsx)
- [edforge-saas-frontend/packages/finance-services/src/__tests__/payments-service-routes.test.ts](edforge-saas-frontend/packages/finance-services/src/__tests__/payments-service-routes.test.ts) — route-shape guard pattern

Reference for async-job + janitor pattern:
- [server/application/microservices/academics/src/students/iemis-import-jobs.service.ts](server/application/microservices/academics/src/students/iemis-import-jobs.service.ts)
- [server/lib/analytics/lambda/iemis-job-janitor/handler.ts](server/lib/analytics/lambda/iemis-job-janitor/handler.ts)
