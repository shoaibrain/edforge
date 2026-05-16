# Pilot Greenlight — Deferred Work

Items consciously deferred from the pilot-greenlight critical path. Each entry records *why* it was deferred and *when* it should be picked up. Living document — append + cross-check before declaring any sprint "done."

---

## Production incident 2026-05-16: cross-tenant 500 + NO_CURRENT_AY UX

**Surfaced:** 2026-05-16 16:25 UTC, while operator was actively browsing the prod UI post-C0.c.3-deploy. Identified as pre-existing bugs (NOT caused by C0.c.3 — both code paths are untouched by EventServiceBase). Triaged + deferred.

### Bug 1 (backend) — AccessDeniedException surfaces as 500 instead of 403

**Source:** `server/application/microservices/identity/src/common/services/dynamodb-client.service.ts` `getItem` (and likely `query` / `putItem` / `updateItem` / `deleteItem`).

When the tenant-template ABAC role's tag-based condition denies a DynamoDB call (legitimate tenant-isolation enforcement), the `AccessDeniedException` propagates up through `DynamoDBClientService.getItem` → `GlobalExceptionFilter.UnhandledException` and surfaces as `500 INTERNAL_SERVER_ERROR`. Per **invariant 7** ("No silent fallbacks — explicit 404 + errorCode"), this should be a clean `403 FORBIDDEN` with `errorCode: CROSS_TENANT_FORBIDDEN`.

**Repro:** authenticate to tenant A; request `/tenants/<tenantB>/settings` (or any cross-tenant read). Response is 500 instead of 403.

**Fix:**
1. Catch `AccessDeniedException` (or its underlying AWS SDK class) in `DynamoDBClientService` and rethrow as `ForbiddenException` with structured `errorCode: 'CROSS_TENANT_FORBIDDEN'` plus the requested vs. session tenant IDs in the detail.
2. Audit other AWS SDK callsites (`query` / `putItem` / `updateItem` / `deleteItem` / `batchWrite`) for the same wrap.
3. Spec-level coverage: integration test sets up a JWT for tenant A, requests tenant B's data, asserts 403 + errorCode.

**Picked up when:** any time. Small scope (~50 LOC). Reasonable to bundle into the next identity-service touch (e.g., a future ABAC tightening sprint).

**Not blocking:** anything in the pilot-greenlight critical path. Tenant isolation IS working as designed at the IAM layer — the bug is purely about error response shape.

### Bug 2 (frontend) — `/finance/invoices` makes cross-tenant settings request

**Source:** TBD. Symptom: the `/finance/invoices` page makes `GET /tenants/<otherTenantId>/settings` while the user is authenticated to a different tenant. Specifically observed: user JWT-authenticated to `dev-pabson-primary` (`21aea5da-511f-4dfa-a6f2-6971f63a719f`), and the page requested settings for tenant `34f49822-ae1d-4188-95f0-04e14bc6c662` (a registered prod PABSON tenant, distinct identity).

**Probable causes:**
- Stale `localStorage` from a prior cross-tenant session
- Hardcoded tenant ID in `/finance/invoices` page code
- A wrong `useTenant()` hook subscription or `react-query` key

**Repro:**
1. Authenticate to any tenant via prod UI
2. Navigate to `/finance/invoices`
3. Observe network panel: the `settings` request URL's path tenant should always match the JWT's `custom:tenantId`. Mismatch = the bug.

**Verification first-pass:** the operator can clear browser localStorage at `edforge.app`, log out, log back in. If the cross-tenant request stops, the bug is stale storage and may have a state-cleanup workaround. If it persists, it's a code bug requiring a frontend PR.

**Fix:** locate where the finance/invoices tenant lookup is wired; replace any hardcoded or stale-state source with the JWT-driven `useCurrentTenant()` hook (or whatever the canonical hook is in this monorepo).

**Picked up when:** any time. Standalone frontend PR. Repro requires being authenticated to a tenant with finance data.

**Not blocking:** any pilot-greenlight sprint (the frontend cross-tenant request is observable only post-fix-tenant-context; doesn't break any backend flow).

### Bug 3 (UX) — NO_CURRENT_AY 404 reaches the operator as a generic error

**Source:** the `getCurrentAcademicYear` 404 with `errorCode: NO_CURRENT_AY` is correct per S0.1 design (memory `project_iemis_sprint_1_uat`) — but the frontend may not be surfacing this gracefully. Operator sees a generic error page instead of "no academic year is marked as current; please designate one."

**Repro:** create an AY with `status: active, isCurrent: false`. Call `GET /schools/:id/academic-years/current`. Receive 404 NO_CURRENT_AY. Observe frontend: probably a generic toast/error.

**Fix:** locate the `useCurrentAcademicYear()` hook (or equivalent) and special-case `errorCode === 'NO_CURRENT_AY'` to render a "Set a current AY" CTA pointing at the AY list with a "Set current" button.

**Picked up when:** any time. Frontend UX polish.

**Not blocking:** any pilot-greenlight sprint.

---

## `gregorianToBs` timezone fragility

**Discovered:** 2026-05-16 (during C1.2 / shared-types Pus 2083 fix)
**Source:** [`packages/shared-types/src/utils/bikram-sambat.ts:145-182`](../../packages/shared-types/src/utils/bikram-sambat.ts#L145-L182)

**Scope:** `gregorianToBs(date: string)` parses the input via `new Date(date)` (UTC-midnight) and then reads local components via `getFullYear()`/`getMonth()`/`getDate()`. In **negative-offset timezones** (e.g., the US: PST UTC-8, CDT UTC-5) the local-component read shifts the day by one. Result: every conversion is off by one day when the function runs in a non-UTC environment with a negative offset.

The frontend wrapper at `edforge-saas-frontend/packages/date-utils/src/converter.ts` works around this (C0.a.3) by appending `T12:00:00` to the input string before forwarding to `gregorianToBs`. The shared-types function itself is unfixed.

**Production impact:**
- Analytics Lambda runs in AWS Lambda with default TZ=UTC, so it's safe in prod today.
- BsDatePicker UI runs in the browser, in the user's local timezone — Nepal (UTC+5:45) is safe; users in negative-offset timezones would see off-by-one BS dates.
- Tests on developer machines in CDT/PST observe the bug; CI runners default to UTC so don't.

**Fix (when picked up):**
1. Change `gregorianToBs` to parse `date + 'T12:00:00'` internally (matches the frontend C0.a.3 workaround).
2. Add roundtrip regression tests: `bsToGregorian(y, m, d) → gregorianToBs(that) === { year: y, month: m, day: d }` for an exhaustive set of dates including month-boundary days for all 91 supported BS years (2000-2090).
3. Bump shared-types minor (data-correction-equivalent change).
4. Same deploy ladder as C0.c.3 / Pus-2083 fix: code-only PR, then publish + consumer pin bump + redeploy alongside the next sprint that needs the converter (likely C1.7 loader work).

**Picked up when:** C1.7 starts. The loader uses `gregorianToBs` for fixture-date validation; TZ fragility there would cause spurious failures on developer machines.

**Not blocking:** C1.0 (done), C1.1 (done), C1.2 (uses fixture data, not the converter), C1.3-C1.6 (also fixture data).

---

## C0.e — Compliance Policy / Declaration

**Deferred:** 2026-05-16
**Plan reference:** [sprint-plan.md §6 Sprint C0.e](sprint-plan.md)

**Scope (from the plan):**
- **C0.e.1** Data-residency commitment doc + per-tenant assertion that the tenant's AWS region matches its declared residency.
- **C0.e.2** Consent capture on user invite — version-hashed policy URL stored alongside the consent record.

**Why deferred:**
- C0.e is "compliance policy / declaration" work — needs legal / operations sign-off on the wording before code changes are meaningful. Long-lead-time on the human side, not the engineering side.
- The plan originally scheduled C0.e to run **in parallel** with C0.a / C0.c / C1 so the legal/ops review wouldn't gate the C12 rehearsal. Since the legal/ops collaboration hasn't started, deferring keeps engineering focused on critical-path work (C1 → C2 → C9 → C12).

**Picked up when:**
- Latest meaningful trigger: **before Sprint C11** (the compliance engineering slice). C11.5 (DR drill) and C11.6 (tenant-cancellation state machine) both depend on the residency commitment being declared, and C11.2 (tenant data export) depends on consent records being captured.
- Practical trigger: as soon as legal / operations is ready to draft the residency commitment doc and the consent capture form. Could land at any time before C11 starts.

**Risk if it slips further:**
- C12 (external greenlight rehearsal) tests both flows — `C12.10` prod-shadow rehearsal validates per-tenant region assertion; tenant export tested in C12.6. If C0.e isn't done by then, those rehearsal steps would fail.
- Pilot go-live (C13) cannot proceed without a published data-residency commitment.

**Not blocking:** any of C0.a (done), C0.c (done), C1, C2, C3, C4, C5, C6, C7, C8, C9, C10.

---

## ESLint pairing rule — `auditedWrite` ↔ `publishEvent`

**Deferred:** 2026-05-16
**Plan reference:** [sprint-plan.md §6 Sprint C0.c](sprint-plan.md) — listed under C0.c.3 AC but split out

**Scope:**
- Custom ESLint rule that asserts every `auditedWrite()` call site is paired with a `publishEvent` / `publishValidatedEvent` call within the same function scope.
- Tests for the rule.

**Why deferred:**
- A proper AST-walking custom rule + tests is ~200-300 lines on its own. Splitting kept the C0.c.3 PR (runtime-validation gate) reviewable.

**Picked up when:**
- Latest meaningful trigger: **before Sprint C8** (event-log completion). C8 will reveal any auditedWrite-without-emit gaps when the read-side event log is queried. Catching them at lint time is cheaper than catching them at runtime.
- Realistic timing: any of the Sprints between C1 and C8.

**Not blocking:** any current sprint.

---

## PascalCase → snake-dotted event migration

**Deferred:** 2026-05-16
**Plan reference:** [sprint-plan.md §6 Sprint C0.c](sprint-plan.md) — implicit; not a single ticket

**Scope:**
- The ~110 existing PascalCase publishers on `IdentityEventsService` / `AcademicsEventsService` / `FinanceEventsService` (`publishSchoolCreated` emitting `SchoolCreated`, etc.) emit unregistered eventTypes per the C0.c.2 registry, falling through the legacy backward-compat branch with a warning log per emit.
- Each needs a per-domain migration: rename emitted `eventType` to snake-dotted, add a Zod schema for any not already in the registry, switch the call site to `publishValidatedEvent`.

**Why deferred:**
- Big-bang rename has zero pilot value and substantial coordination cost (downstream consumers — analytics aggregator, EventBridge rules — would need to either accept both or migrate in lockstep).
- The legacy branch is intentional — it preserves backward compat for the 40+ event types currently flowing live.

**Picked up when:**
- **Piecewise** as future sprints touch each domain's emit-site owner:
  - Sprint C5 (exam subsystem) introduces `exam.{created,closed,published}` natively from new code; no migration needed for those.
  - Sprint C9 (cross-year handoff) introduces `enrollment.{promoted,retained,withdrawn}` natively — migrate existing `StudentWithdrawn`/`StudentTransferred` opportunistically.
  - Existing `SchoolCreated` etc. migrate when their service code is otherwise modified (e.g., during a P1 rewrite touching SchoolsService).
- Catch any drift via the C0.c.3 CloudWatch warning logs: if a specific PascalCase event has high volume + clear migration target, it can be promoted to a one-off migration ticket.

**Not blocking:** any current sprint.

---

## Bundle-size verification for C0.a.3

**Deferred:** 2026-05-15 (from C0.a closeout)
**Plan reference:** [sprint-closeouts.md — Sprint C0.a backlog](sprint-closeouts.md)

**Scope:** Measure the actual production frontend bundle size delta after the C0.a.3 BS converter dedupe (frontend `BS_MONTH_DAYS` table deleted → import from `@aibrains/shared-types`). The local 105-line table deletion is the lower-bound; net delta depends on tree-shaking + co-bundle behavior.

**Picked up when:** opportunistic — any time the frontend bundle size is profiled (e.g., as part of a perf sprint or a Vercel-deploy-size investigation).

**Not blocking:** anything.

---

## S0.2 storage-layer residue strip

**Deferred:** 2026-05-15 (from C0.a closeout)
**Plan reference:** [sprint-closeouts.md — Sprint C0.a backlog](sprint-closeouts.md)

**Scope:** Strip `academicCalendarType` from:
- `School` TS entity (`server/application/microservices/identity/src/common/entities/school.entity.ts:55`)
- `schoolEntitySchema` accept-on-input (`packages/shared-types/src/schemas/identity/school.schema.ts:169,300`)
- `createSchool` DDB write path (`server/application/microservices/identity/src/schools/schools.service.ts:281,313`)
- `CONFIG_LOCKED_FIELDS` list (`schools.service.ts:1119`)
- `field-governance.ts:39`
- AdminWeb workspace-settings field-lock map

Requires a data migration for legacy DDB rows.

**Picked up when:** P1 cleanup pass on SchoolsService, OR when stripping creates value (e.g., before SchoolConfiguration schema redesign in C11).

**Not blocking:** anything in the pilot-greenlight plan.

---

## S0.4 read-source refactor — `getConfiguration().calendarSystem`

**Deferred:** 2026-05-15 (from C0.a closeout)
**Plan reference:** [sprint-closeouts.md — Sprint C0.a backlog](sprint-closeouts.md)

**Scope:** `SchoolsService.getConfiguration()` currently reads `calendarSystem` from the denormalized `school.calendarSystem` field; should read from `WorkspaceSettings.regional.defaultCalendarSystem` directly. Drift is currently prevented by provisioning convention + a deprecation warning on `updateSchool`.

**Picked up when:** P1 (per Midnight Lockin decision #3, when the school-level regional field is stripped entirely). The C0.a.2 cross-entity spec becomes the regression guard.

**Not blocking:** anything in the pilot-greenlight plan.

---

## Exam-window seeding automation gap — blocks harness greenlight

**Surfaced:** 2026-05-16, running the pilot-greenlight harness against `dev-pabson-primary` post-C2-sprint deploy (logs at `docs/deploys/prod-smoke-pilot-greenlight-harness-20260516-*.log`).

**Symptom:** harness verdict is `4 passed / 2 failed` against canonically-seeded dev-pabson-primary. The two failures are downstream of one root cause:
- **C2.2 shift-profile parity** — 20/30 (all 10 `exam_day` samples come back `regular`).
- **C2.3 exam-window containment** — `contained=0/40` across all 4 fixture terms (term-1 0/9, term-2 0/9, term-3 0/10, term-4 0/12).

**Root cause:** `dev-pabson-primary`'s Saraswati AY 2083 has only **1 of 4 fixture-defined Terms** in DDB ("Term 1", ends 2026-07-14). The other 3 quarters have no Term row, so the backend's auto-sync (which writes one `exam_window` CalendarDate per day of a Term's `examStartDate..examEndDate`) has nothing to produce. The seed script that did exist for one quarter — `scripts/smoke-tests/s1-tier2-seed-exam-window-2083.ts` — is uncommitted and only handles 5 days. The committed pilot-greenlight automation has no Term-creation step; [`scripts/pilot-greenlight/seed-pilot-calendar.ts`](../../scripts/pilot-greenlight/seed-pilot-calendar.ts) only seeds holidays + breaks via `POST /generate-calendar`, and [`scripts/smoke-tests/pilot-write-path.ts`](../../scripts/smoke-tests/pilot-write-path.ts) (C2.0) only does staff-training writes.

**Fix scope (small, well-defined):**
1. New script `scripts/pilot-greenlight/seed-pilot-terms.ts` that:
   - Loads the pilot fixture via `@edforge/pilot-fixtures`
   - For each term in `fixture.academicStructure.terms` *that doesn't already exist in DDB*: `POST /schools/:id/academic-years/:yearId/terms` with `{ name, startDate, endDate, examStartDate, examEndDate }` from the fixture (BS → AD conversion via shared-types).
   - Asserts auto-sync wrote `(examEndDate - examStartDate + 1)` `exam_window` CalendarDate rows per term.
2. Wire it into `scripts/smoke-tests/pilot-greenlight.ts` as a pre-C2.1 setup step OR as a new C2.0.5 smoke (decision: probably a setup step since it's idempotent and not a behavioral assertion).
3. Re-run harness; expect 6/6 pass.

**Why deferred (not done in C2):** The C2 execution plan ([line 18](c2-execution-plan.md)) explicitly noted: *"dev-pabson-primary's AY needs `isCurrent: true` AND `calendar-dates` seeded from the pilot fixture, OR C2.0 seeds it as part of the write-path smoke. Decision deferred to PR #2."* PR #2 (C2.0 write-path) ended up scoped to staff-training only; the calendar-seed half was carved off to `seed-pilot-calendar.ts` (PR #95) but the term-seed half didn't follow. The harness merged in PR #100 inherited the gap.

**Picked up when:** before Sprint C3 starts. C3 ("Pre-Greenlight Hardening") presupposes a greenlit harness verdict. ~1-2 hours of work.

**Not blocking:**
- The C2 *deployed code* — `/shift-profile` endpoint, `DATE_NOT_INSTRUCTIONAL` validation, calendar generator are all live and proven correct by C2.1's 4-term exact match, C2.4's 32/32 rejection coverage, and C2.5's edge-case pass.
- Pilot launch *operational* readiness — operators can create Terms manually via AdminWeb; the gap is only in the automated seeding flow.

---
