# EdForge Sprint Plan Update — Pilot Readiness & PABSON Generalization

> **Drafted:** 2026-05-19
> **Status:** 🟡 Draft pending sign-off
> **Predecessor:** [`sprint-plan.md`](./sprint-plan.md) (v1 pilot-greenlight plan). This document extends and revises v1 based on what shipped through Phase C and what the live Saraswati pilot has surfaced. v1 is NOT replaced — its §4 invariants, §10/§11 DoDs, and §13 pilot dossier contract remain authoritative.
> **Companion docs:** [`c4-fe-sprint-closeout.md`](./c4-fe-sprint-closeout.md) · [`c4-ops-sprint-plan.md`](./c4-ops-sprint-plan.md) · [`docs/pilots/pabson-saraswati-bs-2083/iemis-import-review-2026-05-19.md`](../pilots/pabson-saraswati-bs-2083/iemis-import-review-2026-05-19.md) · [`deferred-work.md`](./deferred-work.md).
> **Review history:** v0 draft → critical staff-engineer review → this v1. See §13 "What changed from v0 draft" for the diff summary.

---

## 1. Premise

EdForge's foundation is shipped (Phases A → C in v1 plan). The first PABSON-archetype pilot — **Saraswati Secondary English Boarding School**, tenant `34f49822-…` — is **live in production**: operator-led setup completed through the UI on 2026-05-18 with no engineer involvement on the setup path; 206 students imported across 5 grade batches by 2026-05-19; 9 grades remain over the next ~2 weeks; in-person classes start in ≤2 weeks.

We are now in **implementation + revision** mode. Two project goals run in parallel:

1. **Saraswati operational ✅.** All daily-use workflows (period attendance, exam, term-end results, cross-year handoff, IEMIS submission) work end-to-end with audit + event coverage. Pilot lives ≥30 days with no P0/P1 incidents.
2. **PABSON generalization proven.** A second PABSON-archetype school onboards as data only (drop `packages/pilot-fixtures/pilots/<id>/` + dossier; no engine changes) and reaches activation through the same UI path. Plus: a synthetic `GENERIC` archetype run to prove archetype-blindness — see §5.K.4.b.

Goal #1 owns the critical path through Phase H/I. Goal #2 validates at Phase K.

---

## 2. Architecture context (for any future engineer picking this up cold)

### 2.1 The shape

| Layer | What it is | Where it lives |
|---|---|---|
| **Frontend MFE shell + 4 remotes** | Module-federated React (shell + academics + people + finance + analytics) | `edforge-saas-frontend/` (separate git repo, Vercel-deployed) |
| **AdminWeb** | System-admin React app (tenant provisioning, AY/calendar setup, archetype config) | `client/AdminWeb/` (CloudFront; gated on `@aibrains/shared-types` `npm publish`) |
| **API Gateway + nginx rproxy** | Per-tenant routing | `server/lib/tenant-api-prod.json` + `server/application/reverseproxy/nginx.template` |
| **NestJS microservices** | identity, academics, finance, rproxy | `server/application/microservices/<svc>/` |
| **Per-service DDB tables** | Each service owns its own table; GSI1-GSI9 shape (lowercase attrs per S3.2 rule) | `server/lib/tenant-template/ecs-dynamodb.ts` (CDK) |
| **EventBridge bus + Zod schema registry** | 25 event schemas live since C0.c | `server/lib/event-bus-stack.ts` + `packages/shared-types/src/events/` |
| **Shared types (cross-service contract)** | Zod schemas, BS↔AD converter, locale defaults, IEMIS mappers, Ed-Fi extensions | `packages/shared-types/` (`@aibrains/shared-types`, npm-published) |
| **Pilot fixtures** | Per-pilot calendar + bell + structure + holidays + programs JSON | `packages/pilot-fixtures/pilots/<pilot-id>/` (workspace-only) |

### 2.2 The contracts (the 13 invariants from v1 §4 — recap)

1. `tenant_id` is the PK prefix on every row.
2. `(student, AY)` is the join key for grade level.
3. Every academic record references `enrollmentId`, not `(studentId, date)`.
4. Every dated entity accepts BS or AD on input; canonical Gregorian on storage; both on response.
5. Every write goes through `auditedWrite()`.
6. Every domain action emits an event with a registry-resident Zod schema.
7. No silent fallbacks — explicit 404/403 + `errorCode`.
8. No code branches on `tenant.archetype` — only `archetypeDefaults` lookups.
9. Activation requirements come from archetype defaults.
10. Calendar regeneration defaults to non-destructive `merge` mode.
11. Ed-Fi extension namespace `edforge:` is the only place new descriptors land.
12. `grep -rn 'archetype' server/application/microservices/*/src/` returns zero hits in service code.
13. No pilot-specific names in code. Pilots are data; engine is generic.

A reviewer who spots a violation rejects without further comment.

### 2.3 Currently shipped (Phase A → C)

Phases A (C0.a/C0.b/C0.c), B (C1/C2), and C (C3/C4/C4-FE) all closed. Saraswati activation in prod on 2026-05-18 is the first end-to-end real-operator validation. Detail in v1 plan §0.5.

### 2.4 Not shipped (Phase D → K)

The remainder of this document.

---

## 3. Operating principles (extends v1 plan §3)

1. **Operator-feedback is now the primary validation signal.** Saraswati's daily workflow surfaces gaps that smokes against `dev-pabson-primary` cannot. Every finding → fast-follow PR, in-sprint bundle, or formal backlog entry within 1 week. Weekly operator sync until Day-30 (see D0b.5).
2. **Atomic tickets with tests OR documented manual validation.** Each ticket = one commit, one PR, one validation pass. If tests don't make sense (e.g., a CDK output check, a doc), the ticket carries a written manual-verification procedure with expected output.
3. **Demoable per sprint.** A sprint that doesn't demo a behavior change didn't ship. Demos run against either Saraswati (preferred) or `dev-pabson-primary`.
4. **Two-pilot parametric validation.** Every smoke or integration test from D0 onwards passes with both `PILOT_ID=pabson-saraswati-bs-2083` AND `PILOT_ID=dev-pabson-primary`. K adds a third synthetic `archetype=GENERIC` non-NPR run for archetype-blindness.
5. **Three-way route handoff (CLAUDE.md house rule).** Every new endpoint touches NestJS controller + `tenant-api-prod.json` + `nginx.template` (if new prefix) in the same PR. Route-drift lint at `scripts/check-route-drift.ts` enforces.
6. **Shared-types pin discipline.** Any shared-types minor bump requires lockstep consumer pin bumps in `server/package.json` + `server/application/package.json` in the same PR (npm `^0.X.0` does not include `0.(X+1).0` for 0.x semver). Per-sprint shared-types checklist embedded in §7 DoD.
7. **Module-wiring invariant.** Every new NestJS module declared in D2/D3/F1/F2/G updates `module-wiring.spec.ts` in the SAME PR (per memory `feedback_module_wiring_invariant`). `nest build` passes even when DI is broken; ECS services-stable returns HEALTHY even when container crash-loops on Nest bootstrap. This invariant has been violated twice in prod.
8. **Two-repo git hygiene.** Every git command starts with explicit `cd <repo-root>` — even when chaining. Frontend (`edforge-saas-frontend/`) and backend (`/Users/shoaibrain/edforge`) are independent git repos.

---

## 4. Sprint structure — revised dependency graph

```
[NOW — Saraswati activated; 206 students; in-person classes start ≤2 weeks]
                                    │
                ┌───────────────────┴───────────────────┐
                │                                       │
              D0a                                     D0b   (parallel-eligible)
       (Saraswati-compounding —              (Operator-feedback non-
        operator can't continue                compounding — bugs +
        IEMIS uploads cleanly                  F-series cleanup +
        without these)                         ESLint-rule infra)
                │                                       │
                └───────────────────┬───────────────────┘
                                    │
                                   D1   (Daily-Use Coverage — audit-pivoted 2026-05-19; per-period attendance deferred to Phase J)
                                    │
                                   D2   (Exam — Saraswati Term-1 prep)
                                    │
                                   D3   (Result — Saraswati Term-1 end)
                                    │
                                    │  ┌────────────┐
                                    │◀─│ E parallel │  (any time after D3)
                                    │  └────────────┘
                                   F1   (Cross-year handoff)
                                    │  ┌─────────────┐
                                    │◀─│ F2 parallel │  (after F1 OR before
                                    │  └─────────────┘   if CEHRD deadline forces)
                                    │
                                    │  ┌────────────────────────────┐
                                    │◀─│ G parallel (legal-blocked) │  HARD-DEP: G.1 before H.3
                                    │  └────────────────────────────┘
                                    │
                                   H   (Greenlight Rehearsal Completion — Saraswati signoff)
                                    │
                                   I   (Production Hypercare — Saraswati 30 days)
                                    │
                                    │  ┌─────────────────────┐
                                    │◀─│ K.0 pre-flight smoke│  (can run during I)
                                    │  └─────────────────────┘
                                    │
                                   K   (PABSON Generalization Proof — pilot 2 + GENERIC archetype)
                                    │
                                   J   (Operational Polish — Timetable + Per-Period Attendance + Substitute)  [NEW — post-K]
```

Critical path: **D0a → D1 → D2 → D3 → F1 → H → I → K.**
Parallel-eligible: **D0b** (alongside D0a/D1 start), **E** (any time after D3), **F2** (after F1, can invert if CEHRD deadline forces), **G** (anytime — legal-blocked; G.1 hard-dep before H.3), **K.0** (during I).

**Why D1 elevated above D2 (i.e., C6 before C5 in v1 plan terms):** Saraswati's in-person classes start in ≤2 weeks. Per-period attendance is daily-use from day-1. Exam scheduling has ~4-week lead time; result publish is end-of-Term-1 (~mid-July 2026). The reversal is safe: C5 (Exam) and C6 (Period Attendance) do not depend on each other; C7 (Result) depends on `exam.closed` event from C5.

---

## 5. Sprint-by-sprint ticket detail

> **Convention.** Each ticket carries: **Files** (what changes), **Validation** (test or manual-check), **AC** (reviewer-checkable acceptance criteria). All tickets honor the §3 operating principles. Frontend tickets honor the v1 §8 frontend-inclusion policy: daily-use workflows ship in-sprint with the backend; admin-rare workflows defer to a follow-up frontend sprint.

### Sprint D0a — Operator-Feedback Compounding (Saraswati-blocking the moment uploads resume)

**Goal:** Close the operator-feedback gaps that compound with each additional Saraswati IEMIS upload OR additional day of operation. Ship before the principal's next upload.

**Source:** [`c4-ops-sprint-plan.md`](./c4-ops-sprint-plan.md) (ENG-1/ENG-2 expanded); [`iemis-import-review-2026-05-19.md`](../pilots/pabson-saraswati-bs-2083/iemis-import-review-2026-05-19.md).

#### Tickets

- **D0a.1** — IEMIS jobs LIST endpoint (ENG-1). **Lock-ordered FIRST** because D0a.3 (backfill) leverages it.
  - **Files:** `microservices/academics/src/students/students.controller.ts` (`@Get('students/import/iemis/jobs')`); `microservices/academics/src/students/students.service.ts` (`listIemisImportJobs(schoolId, opts, ctx)`); `server/lib/tenant-api-prod.json` (route entry — existing `/academics` prefix means nginx unchanged); `microservices/academics/src/students/students.service.spec.ts` (+6 tests).
  - **Validation:** Jest integration. Live curl on Saraswati: returns ≥5 historical jobs sorted by `createdAt desc`; ≥1 has `findings[].length > 0`.
  - **AC:** `GET /academics/students/import/iemis/jobs?schoolId=<id>&since=<iso>&limit=<n>&cursor=<base64>` returns paginated list; ABAC-scoped per tenant; route-drift lint green; no PII in finding text (verified).

- **D0a.2a** — IEMIS transformer field extension (ENG-2 part 1).
  - **Files:** `microservices/academics/src/students/iemis-transform.ts` (extend DTO builder lines 240–258 to populate `motherTongueDescriptor`, `isTransferred`, `disabilities`, `sexDescriptor` from existing `IemisRow` columns); `iemis-transform.spec.ts` (+4 derivation tests for `deriveSexDescriptor` from `Gender`).
  - **Validation:** Jest unit. Live: principal's next IEMIS upload lands with `sexDescriptor` populated.
  - **AC:** All 4 target fields populated when source XLSX provides them; existing 133 academics tests stay green; entity-vs-schema contract test (per C4-FE F5) extended for Student.

- **D0a.2b** — IEMIS descriptor lookup tables (ENG-2 part 2).
  - **Files:** `iemis-transform.ts` — add `mapMotherTongueToEdFi`, `mapDisabilityToEdFi` lookup tables (Ed-Fi `LanguageDescriptor` + `DisabilityDescriptor` namespaces); per-value review of each entry against the official Ed-Fi descriptor namespace; `iemis-transform.spec.ts` (+12 mapper tests: 3 known + 3 unknown + 3 mixed-case + 3 empty per mapper).
  - **Validation:** Jest unit. Unknown values emit warning (added to `IemisImportJob.findings[]`), not rejection.
  - **AC:** Lookup tables reviewed against Ed-Fi spec; unknowns warned not rejected; CEHRD-Nepal-specific values resolved (Maithili, Bhojpuri, Tharu, Newari, etc.); audit trail on every lookup hit.

- **D0a.3** — IEMIS backfill script for Saraswati's 206 historical rows. Depends on D0a.1 + D0a.2b.
  - **Files:** `scripts/backfill-iemis-derived-fields-saraswati.ts` (NEW); reads jobs via D0a.1 LIST endpoint; re-reads original XLSX from S3 (`iemis-imports/<jobId>/<filename>`); computes derived fields via D0a.2; PATCHes each Student via existing endpoint; `--dry-run` (default) prints diff for review; `--apply` writes.
  - **Validation:** Dry-run prints diffs for all 206; user approves; `--apply` writes; post-apply GET asserts populated fields on rows where XLSX provided source.
  - **AC:** 206 rows updated where XLSX provided source values; PATCH log archived to `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-backfill-saraswati-iemis-<ts>-<sha>.log`; idempotent on re-run.

- **D0a.4** — IEMIS Job Janitor Lambda (BL-1 from import review; mirrors rollup-janitor pattern).
  - **Files:** `server/lib/iemis-janitor/janitor-lambda.ts` (NEW); CDK wiring in `tenant-template-stack-basic`; EventBridge Scheduler `cron(*/5 * * * ? *)`; checks IemisImportJob rows in `running` status older than 30 minutes; marks `failed` with `failureReason='STUCK_RUNNING'`; emits SNS alert on operator-alert topic if count > 0.
  - **Validation:** Unit on the janitor's marker logic; integration: inject a stuck row → next cron run marks it `failed` + SNS notify.
  - **AC:** Cron schedule visible in EventBridge Scheduler console (not Lambda Triggers tab — same pattern as rollup janitor, per memory `project_grade_level_fix_T2_shipped`); SNS subscription captures operator alerts; no false-positives on legitimately-running jobs (<30min).

- **D0a.5** — XLSX strict-header validation (BL-2).
  - **Files:** `microservices/academics/src/students/iemis-transform.ts` — add `validateIemisHeaders(headers: string[])` that asserts every required column from `IemisRow` is present in the uploaded XLSX. Unknown columns produce a warning (added to findings); missing required columns reject the upload with 400 `IEMIS_HEADERS_INVALID`.
  - **Validation:** Jest unit; integration: upload XLSX missing `Gender` column → 400 with structured detail listing missing headers.
  - **AC:** Header-rename detection before row processing; warnings vs rejections differentiated; CEHRD-source files pass cleanly.

**Demo (Saraswati prod):**
1. `curl …/iemis/jobs?schoolId=<saraswati-school>` → returns ≥5 historical jobs.
2. Principal uploads next grade XLSX → new students land with `motherTongueDescriptor` + `sexDescriptor` populated.
3. Backfill `--apply` log shows 206/206 rows updated.
4. Inject a stuck job row → 5 min later, janitor marks `failed`, SNS fires.
5. Try uploading XLSX missing a required column → 400 `IEMIS_HEADERS_INVALID`.

---

### Sprint D0b — Operator-Feedback Non-Compounding (parallel with D0a / D1 start)

**Goal:** Resolve the operator-feedback gaps that don't compound with operator activity. Ship in parallel with D0a / D1.

#### Tickets

- **D0b.1** — Bug 1: `AccessDeniedException` → 403 (deferred from prod incident 2026-05-16; [`deferred-work.md` Bug 1](./deferred-work.md)).
  - **Files:** `microservices/identity/src/common/services/dynamodb-client.service.ts` (wrap `getItem` / `query` / `putItem` / `updateItem` / `deleteItem` / `batchWrite` to rethrow `AccessDeniedException` as `ForbiddenException` with `errorCode: CROSS_TENANT_FORBIDDEN`); integration test.
  - **Validation:** Jest integration negative: JWT-tenant-A → request tenant-B → expect 403, not 500.
  - **AC:** 403 + structured `errorCode` per invariant 7; `details` payload carries requested-vs-session tenant IDs (with PII redacted if applicable); same-tenant calls unaffected.

- **D0b.2** — Bug 2 spike: `/finance/invoices` cross-tenant settings request — repro + scope (frontend).
  - **Files:** None initially. This is a **spike ticket**: repro under DevTools network panel, identify the source file and the fix scope, write up the finding as `docs/pilot-greenlight/d0b-bug2-spike.md`. Outputs a follow-up ticket `D0b.2-fix` with concrete files.
  - **Validation:** Repro produced + documented; if not reproducible, ticket closes with "not-repro" verdict.
  - **AC:** Either a `D0b.2-fix` ticket with concrete files lands in next sprint review, OR `D0b.2` closes "not-repro" with operator-side localStorage hygiene documented as the workaround.

- **D0b.3** — Bug 3: `NO_CURRENT_AY` UX (frontend).
  - **Files:** `edforge-saas-frontend/.../useCurrentAcademicYear()` consumer; special-case `errorCode === 'NO_CURRENT_AY'` to render "Set a current AY" CTA pointing at AY list with "Set current" button.
  - **Validation:** Manual: AY with `status=active, isCurrent=false` → UI shows CTA, not generic toast.
  - **AC:** Operator self-recovers from missing-current-AY via UI; no engineer involvement.

- **D0b.4** — F1: `updateSession` syncs dates to paired GradingPeriod ([`c4-fe-sprint-closeout.md` F1](./c4-fe-sprint-closeout.md)).
  - **Files:** `microservices/identity/src/schools/academic-session.service.ts` (`updateSession` path); spec extension.
  - **Validation:** Jest unit: PATCH session dates → paired GP dates updated. Smoke: PATCH a `dev-pabson-primary` session date → GP `beginDate`/`endDate` updated.
  - **AC:** Session date PATCH propagates to paired GP; failure non-fatal (consistent with PR #129 auto-pair pattern); audit row per change.

- **D0b.5** — F2 + new DELETE: `deleteSession` cascade + `DELETE /grading-periods/:termId`.
  - **Files:** `microservices/identity/src/schools/academic-session.service.ts` (`deleteSession` cascade-deletes paired GP); `microservices/identity/src/academic-years/academic-years.service.ts` (NEW `deleteGradingPeriod`); `microservices/identity/src/academic-years/academic-years.controller.ts` (NEW `@Delete('grading-periods/:termId')`); `server/lib/tenant-api-prod.json` (route entry — `/schools` existing prefix means nginx unchanged); tests.
  - **Validation:** Jest integration. Live: clean up smoke artifact `PR129-SMOKE-DELETEME` GP in `dev-pabson-primary` via new route.
  - **AC:** DELETE session cascades to paired GP; new GP DELETE route works standalone; cascade transactional (TransactWriteItems if same table, two-step + rollback log if cross-table); route-drift lint green.

- **D0b.6** — F6: retire `scripts/pilot-greenlight/seed-pilot-terms.ts`.
  - **Files:** Delete `scripts/pilot-greenlight/seed-pilot-terms.ts`; update `scripts/smoke-tests/pilot-greenlight.ts` to drop the SETUP step.
  - **Validation:** Re-run pilot-greenlight harness against `dev-pabson-primary` → still 7/7 (sessions now auto-pair GPs at create-time via PR #129; no separate seed needed).
  - **AC:** Script removed; harness still 7/7; no regression.

- **D0b.7** — ESLint rule: `auditedWrite` ↔ `publishValidatedEvent` pairing (pulled forward from v1 §C8 E.4 / [`deferred-work.md` "ESLint pairing rule"](./deferred-work.md)).
  - **Files:** `eslint-rules/audited-write-event-pair.js` (NEW; AST walk); CI integration; tests.
  - **Validation:** CI fails on a deliberately mismatched commit.
  - **AC:** Lint catches missing-emit-after-audited-write; D1/D2/D3/F1/F2/G can rely on it as the validation step rather than per-PR manual review.

- **D0b.8** — F3: BS date picker hygiene PR (audit R1, R3, R4, R5).
  - **Files:** `edforge-saas-frontend/packages/ui/src/components/BsDatePicker.tsx` (branded types per R1; error-handling cleanup R3; boundary tests R4; dual AD/BS validation refinement R5).
  - **Validation:** Frontend unit + Playwright on each BS-date entry surface.
  - **AC:** Per audit follow-up doc; ~4.5h of work; no behavior change observable from outside the picker.

- **D0b.9** — F4: `COUNTRY_DEFAULTS` sync-guard test → AdminWeb.
  - **Files:** AdminWeb test that asserts `COUNTRY_DEFAULTS` import matches `@aibrains/shared-types`'s canonical export. Existing sync-guard pattern in 3 other consumers (server, identity entity, tenant-settings-resolver) extended to the 4th (AdminWeb).
  - **Validation:** CI test fails if AdminWeb's local copy drifts from shared-types.
  - **AC:** Drift detection at CI time; addresses CLAUDE.md-noted duplication.

- **D0b.10** — F5: entity-vs-schema contract test pattern extended.
  - **Files:** Contract test for Staff, Student, AcademicYear, Term, BellSchedule, CalendarBlock entities, mirroring the C4-FE `calendar-date.contract.spec.ts` pattern.
  - **Validation:** Each contract test asserts the entity factory's output shape exactly matches the corresponding Zod schema's parsed output.
  - **AC:** 6 new contract specs land; CI gates on them; future schema/serializer drift caught at compile/CI.

- **D0b.11** — F7: grading-period markers on calendar grid (Option C, deferred from C4-FE §3.9).
  - **Files:** `edforge-saas-frontend/apps/shell/src/components/calendar/MonthGrid.tsx` — render visual decorators showing term boundaries.
  - **Validation:** Playwright e2e against `dev-pabson-primary` 4-term layout.
  - **AC:** Term boundaries visible on grid; matches PABSON 4-quarter structure; no regression to existing block overlay.

- **D0b.12** — F8: Playwright E2E auth setup → CI integration.
  - **Files:** `edforge-saas-frontend/e2e/auth-setup/cognito-storage-state.ts` (NEW); GH Actions wiring; `EDFORGE_PROD_JWT` env removed (replaced by Cognito-login storage state).
  - **Validation:** `e2e/tests/calendar-blocks.spec.ts` (existing) runs against `dev-pabson-primary` from CI.
  - **AC:** Playwright suite runs unattended in CI; no manual JWT-paste required.

- **D0b.13** — Finance widen-to-tenant-currency (BUG-F1 follow-on per memory `project_sprint_C2_A_currency_shipped_prod`).
  - **Files:** `microservices/finance/src/credit-notes/credit-note.entity.ts`, `microservices/finance/src/fee-structures/fee-structure.entity.ts`, `microservices/finance/src/refund-requests/refund-request.entity.ts` — replace NPR literal with `string` sourced from `SchoolConfiguration.currency`; schemas in shared-types widened.
  - **Validation:** Existing NPR data continues to validate; integration with `archetype=GENERIC` non-NPR fixture (from K.4.b) shows USD-or-similar credit-note/fee-structure passes.
  - **AC:** Three entities no longer carry NPR literal; existing Saraswati finance rows unaffected; K's archetype-blindness proof is unblocked.

- **D0b.14** — `dev-pabson-primary` SchoolConfiguration cleanup audit (precondition for D1/D2/D3/F1/G demos).
  - **Files:** None — read-only audit. Verify that T4 + T5 fixes (memory `project_grade_level_fix_T4_shipped` + `T5_shipped`) hold; no new orphan SchoolConfiguration rows; PABSON archetype defaults visible on `GET /schools/:id/configuration`.
  - **Validation:** Run a `GET /schools/:id/configuration` against every school in `dev-pabson-primary`; assert PABSON defaults (NPR, Asia/Kathmandu, bikram_sambat) — no US defaults.
  - **AC:** Tenant clean; demo-worthy state; or, if orphans found, a cleanup ticket scoped before D1.

**Demo (mostly `dev-pabson-primary` + Saraswati for Bug 1/3):**
- Cross-tenant request returns 403 + errorCode.
- Bug 2 spike report committed (or "not-repro" verdict).
- NO_CURRENT_AY UI CTA appears for a misconfigured AY.
- PATCH session date → paired GP updated.
- DELETE session → paired GP cascade-deleted.
- Pilot-greenlight harness 7/7 with seed-pilot-terms.ts removed.
- ESLint rule catches deliberately-mismatched commit in CI.
- BS picker passes hygiene audit; AdminWeb COUNTRY_DEFAULTS sync test green; 6 new contract specs.
- Term boundaries render on calendar grid.
- Playwright runs unattended in CI.
- Finance entities accept non-NPR currency.
- `dev-pabson-primary` configuration audit green.

---

### Sprint D1 — Period Attendance Surface (elevated from v1 plan §C6)

**Goal:** Per-period attendance wired end-to-end against the active bell schedule, respecting the **academic vs non-academic shift distinction** from the Saraswati dossier. Day-rollup correct under holiday/weekend/vacation. Daily-use UI ready before in-person classes start.

#### Tickets

- **D1.0** — Section entity readiness audit (doc-only, blocker check).
  - **Files:** `docs/pilot-greenlight/d1-section-readiness-audit.md` (NEW).
  - **Validation:** Read `microservices/academics/src/sections/` — confirm Section CRUD + Section-Enrollment assignment + section-to-bell-schedule resolution all exist and work. Run a smoke creating a Section on `dev-pabson-primary` and assigning enrollments to it.
  - **AC:** Either: (1) audit confirms readiness → checkpoint logged → D1.1 proceeds, OR (2) audit identifies gaps → spawn `D1.0-fix` ticket BEFORE D1.1.

- **D1.1** — `classPeriodId` validation: in-bell-schedule + academic-scope.
  - **Files:** `microservices/academics/src/attendance/attendance.service.ts` (`recordPeriodAttendance` validates: (a) `classPeriodId` exists in school's active bell schedule, (b) the parent shift has `scope === 'academic'`, NOT `'non-academic'`); spec extensions.
  - **Validation:** Jest integration. Three negative cases:
    1. POST with invalid `classPeriodId` → 400 `PERIOD_NOT_IN_BELL_SCHEDULE`.
    2. POST with a `classPeriodId` from Shift 1 (non-academic boarding routine — Saraswati's morning routine 05:30–09:00) → 400 `PERIOD_NOT_ACADEMIC` (distinct errorCode).
    3. POST with exam-day variant on a date marked `eventType=exam_day` → uses exam-day 4×90min variant, not regular 8×45min.
  - **AC:** Both errorCodes distinct and structured; exam-day variant resolved correctly; existing positive-path test continues green.

- **D1.2** — Day-rollup engine (pure function).
  - **Files:** `microservices/academics/src/attendance/attendance-rollup.service.ts` (NEW); unit tests.
  - **Validation:** Jest unit, table-driven: all-present → `present`; all-absent → `absent`; mixed → `partial_absent`; explicit override → respected.
  - **AC:** Deterministic; pure (no DDB reads in rollup fn); ≥90% line coverage.

- **D1.3** — Holiday-aware day-rollup.
  - **Files:** `attendance-rollup.service.ts` extended; reads CalendarDate by date.
  - **Validation:** Jest integration with each of Saraswati's 6 multi-day holiday blocks (Dashain, Tihar, Chhath, Summer, Winter, Holi); each date in block → rollup returns `holiday`. Weekend → `weekend`. Mid-vacation → `vacation`.
  - **AC:** Rollup returns correct non-`absent` value for all 6 multi-day blocks + weekends + 13 single-day holidays + 9 programs from Saraswati fixture. Same assertion via parametric run on `dev-pabson-primary`.

- **D1.4** — Per-period grid UI (frontend, daily-use).
  - **Files:** `edforge-saas-frontend/apps/academics/src/Attendance/PerPeriodGrid.tsx` (NEW); supporting hooks + API client; `e2e/tests/per-period-attendance.spec.ts`.
  - **Validation:** Playwright e2e: teacher marks late for P3 only → grid shows late on P3; rollup chip shows partial. Manual smoke on Saraswati's first in-person-class day.
  - **AC:** Operator marks per-period state via UI; rollup updates live; grid handles all 8 PABSON Shift-2 periods AND exam-day 4-block variant; Shift-1 non-academic periods NOT shown (hidden by `scope === 'non-academic'` filter); mobile-responsive (teachers use phones).

- **D1.5** — Per-period analytics aggregation.
  - **Files:** `microservices/academics/src/dashboard/per-period-analytics.service.ts` (NEW or extension); endpoint `GET /analytics/per-period?schoolId=&termId=`; routes registered three-way (existing `/academics` prefix).
  - **Validation:** Jest integration with seeded period-attendance data.
  - **AC:** Returns per-period rollup with 5-minute cache per CLAUDE.md analytics convention; latency p95 <500ms.

- **D1.6** — Audit + event emission on every attendance write.
  - **Files:** `attendance.service.ts` (every write goes through `auditedWrite` + emits `attendance.recorded` / `attendance.updated` per C0.c.2 taxonomy).
  - **Validation:** D0b.7 ESLint rule catches missing emits at CI. Plus runtime check: write 10 attendance rows → 10 audit rows visible via existing audit API.
  - **AC:** Lint enforces; runtime check passes; events queryable post-Sprint E.

- **D1.7** — Pilot real-data attendance smoke (parametric).
  - **Files:** `scripts/smoke-tests/pilot-attendance-week.ts` (NEW); accepts `PILOT_ID`; marks attendance for 10 students × 6 days × N periods using the pilot's bell schedule; validates rollups + no 504s + audit + events.
  - **Validation:** Smoke runs against Saraswati + `dev-pabson-primary`; both exit 0.
  - **AC:** Per-period writes correct, rollups correct, p95 <500ms holds, audit clean.

- **D1.8** — Section-attendance regression check.
  - **Files:** Verify existing `microservices/academics/src/section-attendance/` module still works post per-period changes.
  - **Validation:** Re-run existing section-attendance integration tests (must stay green).
  - **AC:** Zero regressions on section-attendance endpoints; per-period and per-section coexist.

**Demo (`dev-pabson-primary` → Saraswati when school opens):** Teacher marks per-period attendance for Grade 10 section A for a week including a holiday-block date and an exam-day date. Grid shows correct states. Rollup respects holidays (returns `holiday`, not `absent`). Non-academic Shift-1 periods rejected with `PERIOD_NOT_ACADEMIC`. Analytics dashboard displays per-period stats. Audit + events appear.

---

### Sprint D2 — Exam Subsystem (v1 plan §C5, refined)

**Goal:** First-class `Exam` + `ExamSubject` + `ExamScore` entities. Operator creates Term-1 exam, adds subjects per curriculum, enters scores, closes exam. Result calculation deferred to D3 for atomicity.

#### Tickets

- **D2.0** — Curriculum / subjects entity readiness audit (doc-only, blocker check).
  - **Files:** `docs/pilot-greenlight/d2-curriculum-readiness-audit.md` (NEW).
  - **Validation:** Read `microservices/academics/src/courses/` + `grades/` + `classwork/` — confirm Curriculum/Subject entity surface exists for D2.4.b's "validate against school's curriculum-subjects" AC. If not, scope `D2.0-fix` BEFORE D2.4.b.
  - **AC:** Audit committed; readiness confirmed OR follow-up ticket scoped.

- **D2.1** — Exam entity.
  - **Files:** `microservices/academics/src/common/entities/exam.entity.ts` (NEW); fields `examId`, `examName`, `termId`, `examType` (terminal/quiz/mid-term), `startDate`, `endDate`, `status` (draft/scheduled/in_progress/closed/published); GSIs by `termId`, by `status`; lowercase attribute names per S3.2 rule.
  - **Validation:** Entity unit tests; existing `gsi-casing-contract.spec.ts` extended to assert new entity.
  - **AC:** Factory writes correct DDB shape; contract test green; new module registered in `module-wiring.spec.ts` in same PR (invariant from §3.7).

- **D2.2** — ExamSubject entity.
  - **Files:** `exam-subject.entity.ts` (NEW); fields `examSubjectId`, `examId`, `subjectId`, `maxMarks`, `passingMarks` (defaults from `SchoolConfiguration.passingGrade`), `creditHours`.
  - **Validation:** Entity tests.
  - **AC:** FK validation on create (against curriculum from D2.0); module-wiring updated.

- **D2.3** — ExamScore entity (keyed by `enrollmentId` per invariant 3).
  - **Files:** `exam-score.entity.ts` (NEW); fields `examScoreId`, `examId`, `examSubjectId`, `enrollmentId`, `rawScore`, `status` (entered/locked), `enteredBy`, `enteredAt`.
  - **Validation:** Entity tests + cross-AY query path via GSI2 (student → enrollments).
  - **AC:** References `enrollmentId` NOT `(studentId, examId)` per invariant 3; cross-year aggregation works.

- **D2.4a** — Exam CRUD endpoints.
  - **Files:** `exams.controller.ts` (NEW); POST + GET + LIST `/exams`; `server/lib/tenant-api-prod.json` (route entries); `nginx.template` (new prefix `/exams` → new rproxy block); route-drift lint.
  - **Validation:** Jest integration per endpoint + live curl through API GW + nginx + Nest post-deploy.
  - **AC:** 2xx behaviors validated; audit + event emit per write (D0b.7 lint catches misses); route registered all three places.

- **D2.4b** — ExamSubject CRUD endpoints.
  - **Files:** `exams.controller.ts` extended or `exam-subjects.controller.ts`; POST + GET + LIST `/exams/:examId/subjects`; subject add validates against curriculum-subjects (depends on D2.0).
  - **Validation:** Jest integration; FK rejection negative test.
  - **AC:** Validates against curriculum; 4xx on invalid `subjectId`.

- **D2.4c** — ExamScore CRUD endpoints.
  - **Files:** `exam-scores.controller.ts` (NEW); POST `/exams/:examId/scores` (single); GET `/exams/:examId/scores`; LIST with filter.
  - **Validation:** Jest integration.
  - **AC:** Validates `0 ≤ rawScore ≤ maxMarks`; 409 if `exam.status === 'closed'`; 404 on missing FKs.

- **D2.5** — Exam state machine.
  - **Files:** `exams.controller.ts` (PATCH `/exams/:examId/status`); state-machine util.
  - **Validation:** Integration: every valid transition (draft→scheduled→in_progress→closed) + every invalid transition (e.g., closed→draft) returns 409 `EXAM_STATE_INVALID_TRANSITION`.
  - **AC:** Transitions audited + events; idempotent re-call of same transition returns 200 not 409.

- **D2.6** — Bulk score entry chunked at 100 (DDB TransactWriteItems limit).
  - **Files:** `exam-scores.service.ts` (chunks 250 scores → 3 atomic chunks); idempotency via correlation ID. POST `/exams/:examId/scores/bulk`.
  - **Validation:** Integration with 250-score payload; retry idempotent.
  - **AC:** All scores written atomically per chunk; failure rolls back chunk not whole bulk; **emits one `exam.scores_recorded` event per chunk with `count` in payload** (NOT N individual `exam.score_recorded` events — design decision locked here to avoid 250-event flood).

- **D2.7** — Score validation rules.
  - **Files:** `packages/shared-types/src/schemas/academics/exam-score.schema.ts` (NEW); service-side cross-check.
  - **Validation:** Integration negatives per rule.
  - **AC:** 4xx errors structured per project errorCode schema; existing FK validation patterns reused.

- **D2.8** — Audit + event emission per write.
  - **Files:** `exams.service.ts`, `exam-scores.service.ts`; emits `exam.created`, `exam.closed` per C0.c.2 taxonomy.
  - **Validation:** D0b.7 ESLint rule catches missing emits.
  - **AC:** Every write paired; lint green.

- **D2.9** — Pilot exam smoke (parametric).
  - **Files:** `scripts/smoke-tests/pilot-exam-flow.ts` (NEW); accepts `PILOT_ID`; creates Term-1 exam, adds subjects, scores 10 students, closes exam.
  - **Validation:** Smoke on Saraswati + `dev-pabson-primary`; both exit 0.
  - **AC:** Full exam lifecycle complete; audit + events at every step.

**Demo (`dev-pabson-primary`):** Create Term-1 exam, add 5 subjects per Grade 10 curriculum, enter scores for 10 enrollments (single + bulk paths), close exam. Audit + events captured. Saraswati Term-1 follows naturally when its exam window opens (Asar 24-32 ≈ mid-July).

---

### Sprint D3 — Result Subsystem (v1 plan §C7, refined)

**Goal:** After `exam.closed`, generate per-student per-term `ResultCard` rows using the term-aggregation rules engine. Admin UI deferred. `result.published` event emits.

#### Tickets

- **D3.1** — Term-aggregation rules engine (pure function, archetype-blind).
  - **Files:** `microservices/academics/src/results/term-aggregation.service.ts` (NEW); reads `gradingScale` from `SchoolConfiguration` (data-driven per invariant 8); per-term weighted GPA; optional attendance-penalty hook (off by default for V1); rank scope (section/class/school).
  - **Validation:** Unit tests with PABSON 32-pass gradingScale + synthetic gradingScale data. Property test: monotonic raw-score sequence → monotonic GPA sequence. **Explicit archetype-grep assertion: `grep -rn 'archetype' microservices/academics/src/results/` returns zero in service code (per invariant 12).**
  - **AC:** Engine fully data-driven; zero `tenant.archetype` reads; rule source documented in code comment + spec; archetype-grep CI check.

- **D3.2** — ResultCard entity.
  - **Files:** `result-card.entity.ts` (NEW); fields `cardId`, `enrollmentId`, `termId`, `examId`, `subjectScores: [{ subjectId, score, grade, gpa }]`, `totalScore`, `termGpa`, `classRank`, `sectionRank`, `conduct`, `classTeacherRemark`, `publishedAt`, `publishedBy`, `status` (draft/published).
  - **Validation:** Entity tests; keyed by `enrollmentId` (invariant 3); entity-vs-schema contract test (F5 pattern from D0b.10).
  - **AC:** Factory + contract test green; module-wiring updated.

- **D3.3** — Batch result generation Lambda.
  - **Files:** `server/lib/result-generation/result-batch-lambda.ts` (NEW); CDK wiring in `tenant-template-stack-basic`; EventBridge rule triggers on `exam.closed`; reads enrollments + scores; calls D3.1 engine; writes ResultCard per enrollment.
  - **Validation:** Lambda unit + integration triggering via EventBridge.
  - **AC:** 200 enrollments → 200 cards in <30s p50 / <90s p95; DLQ catches Lambda failures; CloudWatch alarm on DLQ depth ≥1; **Lambda cold-start tolerance:** EventBridge → Lambda cold-start measured + documented; first invocation latency budget ≤45s including cold start.

- **D3.4** — Conduct + class-teacher-remark entry endpoints.
  - **Files:** `conduct.controller.ts` (NEW); PATCH `/result-cards/:id/conduct`; routes three-way (new `/result-cards` prefix → new nginx block).
  - **Validation:** Integration; audit per write.
  - **AC:** Field updates; audit + event per write.

- **D3.5** — Publication state machine.
  - **Files:** `result-cards.service.ts`; draft→published writes `publishedAt`, `publishedBy`; emits `result.published`.
  - **Validation:** Integration + unit: cannot un-publish; cannot publish twice (409 `RESULT_ALREADY_PUBLISHED`).
  - **AC:** State transition audited + event.

- **D3.6** — Cross-year publication regression test (invariant 3 guard).
  - **Files:** Integration spec.
  - **Validation:** Scenario: prior-AY Term-1 results publish after next-AY created. Assert: card has `enrollmentId` referencing prior-AY enrollment; cross-year aggregation via GSI2 returns both. **Every row returned by F1.7's student-timeline endpoint references `enrollmentId`, not `(studentId, AY)`.**
  - **AC:** Cards stay coupled to correct AY; no enrollment-id mismatches.

- **D3.7** — Pilot result smoke (parametric).
  - **Files:** `scripts/smoke-tests/pilot-result-card-publish.ts` (NEW); accepts `PILOT_ID`; end-to-end: create exam → score → close → cards via Lambda → publish.
  - **Validation:** Smoke on Saraswati + `dev-pabson-primary`; both exit 0.
  - **AC:** Full result lifecycle; events on bus.

- **D3.8** — Admin result-review UI (deferred, tracker only).
  - **Files:** `docs/Sprints/Result-Subsystem-Frontend.md` (NEW tracker).
  - **AC:** Backlog ticket scoped; not in-sprint.

**Demo (`dev-pabson-primary`):** Close Term-1 exam. 10 ResultCards generated by Lambda within 30s. Add conduct + remark on 5 cards. Publish all 10. `result.published` events appear on bus + (post-Sprint E) event-log.

---

### Sprint E — Event-Log Completion (v1 plan §C8 minus E.4 which moved to D0b.7)

**Goal:** Complete the event emission story started in C0.c. Add read-side event log + DLQ + retry + migrate legacy `staff.training.*` events. **Per the 2026-05-19 daily-use audit (see §14), this sprint ALSO absorbs the academics PascalCase → snake-dotted event migration** — ~30 emit-sites across attendance, section-attendance, classwork, grades, sections, courses, enrollment currently emit `AttendanceRecorded`/`GradeRecorded`/etc. and fall through the C0.c backward-compat branch without Zod validation. New ticket E.8 below.

> Note: E.4 (ESLint pairing rule) was pulled forward to D0b.7 so D1/D2/D3 audit/event lint enforcement is automatic, not deferred-manual.

#### Tickets

- **E.1** — Event-log entity (read-side).
  - **Files:** `microservices/common/entities/event-log.entity.ts` (NEW); per-tenant DDB partitioning; queryable by tenant + time range; 30-day retention via DDB TTL attribute.
  - **Validation:** Integration: every event on bus also lands in log; queryable.
  - **AC:** Queryable; TTL enforces retention.

- **E.2** — DLQ + retry on emission failure.
  - **Files:** `server/lib/event-bus-stack.ts` CDK extension (DLQ); `emitEvent` retry policy.
  - **Validation:** Chaos test injecting EventBridge failure → 3 retries → DLQ catches; CloudWatch alarm fires.
  - **AC:** Retries + DLQ + alarm active.

- **E.3** — `staff.training.*` migration through new emitter.
  - **Files:** Identity service staff-training paths; switch to `publishValidatedEvent`.
  - **Validation:** Behavior unchanged; existing tests pass; new event-log shows staff.training events.
  - **AC:** Pre-existing flow routes through new emitter; payload shape matches C0.c.2 taxonomy.

- **E.4 (REMOVED — moved to D0b.7).**

- **E.5** — Event-log query endpoint.
  - **Files:** `microservices/common/event-log.controller.ts` (NEW); `GET /event-log?tenantId=...&from=...&to=...&eventType=...&cursor=...`; routes three-way; ABAC-scoped.
  - **Validation:** Integration; route-drift lint.
  - **AC:** Tenant-scoped query works; pagination cursor-based.

- **E.6** — PascalCase legacy emit migration audit.
  - **Files:** `scripts/event-migration-audit.ts` (NEW); scans CloudWatch logs for backward-compat warning emissions; produces per-event-type frequency report.
  - **Validation:** Report committed to `docs/pilot-greenlight/event-migration-audit.md`.
  - **AC:** Each high-volume PascalCase emit has a documented migration ticket (per [`deferred-work.md` "PascalCase → snake-dotted event migration"](./deferred-work.md)).

- **E.7** — Event-log roundtrip smoke (closes review's demoability gap).
  - **Files:** `scripts/smoke-tests/event-log-roundtrip.ts` (NEW); accepts `PILOT_ID`; triggers `school.created` + `academic_year.created` + `term.created` + `exam.closed` + `result.published` (or 5 representative events for the registered pilot); polls event-log; asserts all 5 appear with schema-validated payloads.
  - **Validation:** Smoke against Saraswati + `dev-pabson-primary`; both exit 0.
  - **AC:** Reusable; replaces engineer-CloudWatch-inspection demo with one-command smoke.

**Demo:** Run `event-log-roundtrip.ts` against `dev-pabson-primary` — 5/5 events appear in log with valid payloads. Chaos test injects failure → 3 retries → DLQ catches. Old `staff.training.*` events visible in log. PascalCase audit report committed.

---

### Sprint F1 — Cross-Year Handoff (v1 plan §C9, refined)

**Goal:** Saraswati's AY 2083 → 2084 transition works end-to-end. The provisional → final window (per dossier: Baisakh 1 2084 → Baisakh 8 2084 ≈ 7 days, ≈ Apr 14-21 2027) is fully modeled. Attendance preserves `enrollmentId` (invariant 3).

> **Timing note:** Saraswati's actual cross-year is ~11 months out. F1 ships earlier (parametric validation on `dev-pabson-primary`); real Saraswati window is exercised under Sprint K.6 hypercare or H rehearsal.

#### Tickets

- **F1.1** — Add `'provisional'` to EnrollmentStatus enum.
  - **Files:** `microservices/academics/src/common/entities/base.entity.ts`; valid transitions `provisional → enrolled`, `provisional → withdrawn`; invalid `enrolled → provisional`.
  - **Validation:** Unit (state machine) + integration creating a provisional row.
  - **AC:** API accepts; invalid → 409.

- **F1.2** — Add `priorEnrollmentId?` to Enrollment.
  - **Files:** `enrollment.entity.ts`; FK validation.
  - **Validation:** Integration round-trip.
  - **AC:** Field present; nullable; populated by promotion op.

- **F1.3** — Add `promotionDecision` (write-once).
  - **Files:** `enrollment.entity.ts`; enum `'promoted' | 'retained' | 'conditional' | 'graduated' | 'withdrawn' | 'transferred_out'`.
  - **Validation:** Unit asserts write-once (second PUT → 409 `PROMOTION_DECISION_LOCKED`).
  - **AC:** Field on prior-year enrollment; set in F1.5b.

- **F1.4** — Batch-promote operation.
  - **Files:** `microservices/academics/src/enrollment/promote.controller.ts` (NEW); `promote.service.ts` (NEW); routes three-way (new prefix `/promote-from` or extends `/schools` — pick per route inventory at code time); POST `/schools/:id/academic-years/:to/promote-from/:from?gradeLevel=<grade>`; creates N provisional rows in `:to` with `priorEnrollmentId` set; chunked at 100 per TransactWriteItems; idempotent.
  - **Validation:** Integration using Saraswati fixture's AY 2083 → 2084 dates.
  - **AC:** 200 students promoted in chunks; `enrollment.promoted` event per chunk (NOT per student — same design pattern as D2.6); route-drift lint green; module-wiring updated.

- **F1.5a** — Result-publish event handler.
  - **Files:** `result-cards.service.ts` (or new `enrollment-transition-handler.service.ts`); subscribes to `result.published` with terminal-exam flag; queries provisional next-AY rows; calls F1.5b.
  - **Validation:** Integration: publish prior-AY Term-N result → handler invoked.
  - **AC:** Handler fires on event; idempotent on retry.

- **F1.5b** — Atomic provisional → final flip (chunked).
  - **Files:** `enrollment.service.ts` `promoteProvisionalToEnrolled(provisionalIds: string[])`; chunked at 100 per TransactWriteItems.
  - **Validation:** Integration: 10 provisional rows + handler invocation → 9 flip to `enrolled`, 1 retained gets gradeLevel rewritten (per F1.6).
  - **AC:** Atomic per chunk; failure rolls back chunk; audit row + event per chunk.

- **F1.5c** — Idempotency test.
  - **Files:** Integration spec.
  - **Validation:** Trigger F1.5a twice with same event payload → second call no-op (rows already `enrolled`); attendance rows during window unaffected on retry.
  - **AC:** Idempotent; no duplicate writes.

- **F1.6** — Retention path.
  - **Files:** `enrollment.service.ts`; mark retained → rewrites next-AY enrollment's `gradeLevel` to prior grade (same enrollmentId); sets `promotionDecision='retained'` on prior AY.
  - **Validation:** Integration: attendance under provisional enrollment survives gradeLevel rewrite; audit captures pre-rewrite gradeLevel.
  - **AC:** Cross-references invariant 3 explicitly; attendance preservation tested with at least 1 attendance row in the window.

- **F1.7** — Cross-AY student timeline endpoint.
  - **Files:** `student-timeline.controller.ts` (NEW); `GET /students/:id/timeline` returns all enrollments across AYs via GSI2; routes three-way.
  - **Validation:** Integration across two AYs.
  - **AC:** Returns full chain with promotion decisions, sorted by AY ascending; **every row carries `enrollmentId`, NOT `(studentId, AY)`** (invariant 3 explicit guard).

- **F1.8** — Enrollment state machine util + tests.
  - **Files:** `enrollment-state-machine.ts` (NEW).
  - **Validation:** Unit covering every transition (valid + invalid).
  - **AC:** 100% transition coverage; rejection list documented.

- **F1.9** — Cross-year smoke (parametric, Saraswati-shaped window).
  - **Files:** `scripts/smoke-tests/pilot-cross-year-handoff.ts` (NEW); accepts `PILOT_ID`; simulates full operator-printed window.
  - **Validation:** Smoke on Saraswati + `dev-pabson-primary`; both exit 0.
  - **AC:** Full simulation correct; attendance preserved.

**Demo (`dev-pabson-primary`):** Full simulation per F1.9 (prior AY active → next AY created → batch-promote → window attendance → publish prior results → 9 flip + 1 retained, attendance survives). Same simulation on Saraswati at actual transition (~Apr 2027).

---

### Sprint F2 — Annual External Reporting Submission (v1 plan §C10, refined for IEMIS)

**Goal:** Saraswati can generate CEHRD-template-conformant annual IEMIS submission. Submission history queryable. Pipeline parametric on report-type.

> **Timing flag (RISK R3 in §10):** If CEHRD requires a partial-year submission in mid-2026 for AY 2083, F2 must compress and may need to precede F1. CEHRD deadline must be confirmed before F2 starts.

#### Tickets

- **F2.1** — ReportingSnapshot entity.
  - **Files:** `microservices/identity/src/external-reporting/reporting-snapshot.entity.ts` (NEW); fields `reportId`, `tenantId`, `schoolId`, `ayId`, `reportType` (e.g., `IEMIS_NPL_CEHRD`), `generatedAt`, `csvS3Key`, `validationResult`, `submittedAt?`, `submittedBy?`.
  - **Validation:** Entity tests; queryable per AY × reportType.
  - **AC:** Factory + contract test green; module-wiring updated.

- **F2.2** — Report template registry (naming-discipline ticket).
  - **Files:** `packages/shared-types/src/external-reporting/templates/IEMIS_NPL_CEHRD.ts` (NEW); template name uses country code `NPL` and authority `CEHRD` only — no pilot name. Defines columns, aggregation rules, validation rules.
  - **Validation:** Roundtrip against known-good CEHRD fixture (or strict schema if fixture unavailable); naming-lint check: `grep -rni '_SARASWATI\|_PABSON_SARASWATI' packages/shared-types/src/external-reporting/templates/` returns zero.
  - **AC:** Template loadable; naming pilot-agnostic per invariant 13.

- **F2.3** — Aggregation Lambda (per-report-type, template-driven, archetype-blind).
  - **Files:** `server/lib/external-reporting/lambda/report-aggregator.ts` (NEW); aggregator generic; template declares aggregations (students-by-grade × gender, staff-by-role × gender, etc.). **Explicit archetype check:** `grep -rn 'archetype' server/lib/external-reporting/` returns zero in Lambda code.
  - **Validation:** Integration with Saraswati's actual 206+ students; archetype-grep CI check.
  - **AC:** Aggregations match expected profile; runs <60s for 1000-student tenant; zero archetype branches.

- **F2.4** — POST `/reporting/snapshots` endpoint.
  - **Files:** `reporting-snapshot.controller.ts` (NEW); routes three-way (new prefix `/reporting` → new nginx block).
  - **Validation:** Integration; audit + event.
  - **AC:** Triggers Lambda; returns snapshot ID + S3 key.

- **F2.5** — `reporting.submission_due` event emission (EventBridge cron).
  - **Files:** Scheduled CDK trigger + Lambda.
  - **Validation:** Integration; event fires on schedule.
  - **AC:** Event emitted; delivery deferred per V1 scope.

- **F2.6** — Audit per submission.
  - **Files:** External-reporting service.
  - **Validation:** Integration.
  - **AC:** Audit + `reporting.submitted` event per generation.

- **F2.7** — Saraswati IEMIS dry-run smoke.
  - **Files:** `scripts/smoke-tests/pilot-external-reporting.ts` (NEW); accepts `PILOT_ID`; aggregates pilot AY fixture → CSV.
  - **Validation:** CSV passes IEMIS_NPL_CEHRD validation; manually inspected by operator + EdForge against Saraswati's 206 actuals.
  - **AC:** Smoke exit 0; CSV human-verified.

- **F2.8** — Submission history UI (deferred, tracker only).
  - **Files:** `docs/Sprints/External-Reporting-Frontend.md` (NEW tracker).
  - **AC:** Backlog ticket scoped.

**Demo (Saraswati):** Generate AY 2083 partial-year IEMIS submission via the IEMIS_NPL_CEHRD template. CSV downloaded; counts match Saraswati's 206 + remaining grades. Submission history row visible. `reporting.submitted` event on bus + event-log.

---

### Sprint G — Compliance (merges v1 plan §C0.e + §C11)

**Goal:** Data residency commitment + consent capture + tenant export + DSAR + DR drill + cancellation state machine. Legal/operations sign-off-gated. **HARD DEPENDENCY: G.1 (residency commitment doc) must complete before H.3 (tenant-export rehearsal).**

#### Tickets

- **G.1** — Data-residency commitment doc + per-tenant assertion.
  - **Files:** `docs/compliance/data-residency-commitment.md` (NEW, legal-reviewed); identity service test asserting tenant region matches `tenant.regionalCommitment`.
  - **Validation:** Integration: provision tenant claiming region X → infrastructure region must match.
  - **AC:** Doc legal-reviewed; assertion fails fast on mismatch.

- **G.2** — Consent capture on user invite.
  - **Files:** Identity service user-invite path; consent entity; version-hashed policy URL with consent.
  - **Validation:** Integration: cannot invite without consent record.
  - **AC:** Audit row + consent record per invite.

- **G.3** — Tenant data export endpoint + async job.
  - **Files:** `microservices/identity/src/tenant-export/tenant-export.controller.ts` (NEW); export Lambda; routes three-way (new `/tenants/:id/export` — `/tenants` prefix exists); POST → S3 zip with every entity.
  - **Validation:** Integration on `dev-pabson-primary`.
  - **AC:** Zip complete; <30min for 1000-student tenant; signed download URL.

- **G.4** — DSAR endpoint foundation.
  - **Files:** `dsar.controller.ts` (NEW); GET `/dsar/students/:id` returns all data about student X; routes three-way (new `/dsar` prefix).
  - **Validation:** Integration.
  - **AC:** Structured response; audit + event per query.

- **G.5a** — DR drill test-tenant provisioning helper.
  - **Files:** `scripts/dr-drill/provision-test-tenant.sh` (NEW); `scripts/dr-drill/teardown-test-tenant.sh` (NEW).
  - **Validation:** Dry-run + provision + teardown.
  - **AC:** Helpers idempotent; teardown cleans all resources.

- **G.5b** — DR drill script + runbook.
  - **Files:** `scripts/dr-drill/restore-pitr.sh` (NEW); `docs/runbooks/dr-drill.md` (NEW).
  - **Validation:** Actual restore on test tenant from G.5a.
  - **AC:** Drill repeatable; runbook walkable by on-call engineer.

- **G.6** — Tenant-cancellation state machine + auto-export.
  - **Files:** Tenant lifecycle service + CDK extension if needed.
  - **Validation:** Integration on test tenant from G.5a.
  - **AC:** On cancel → trigger export → mark `cancelled` → 30-day retention → soft-delete; transitions audited; reversible within retention.

- **G.7** — Lint rule extension: every compliance op has `auditedWrite` + `emitEvent`.
  - **Files:** Extends D0b.7 ESLint rule to cover compliance-endpoint surfaces.
  - **Validation:** Lint hard-fails on missing.
  - **AC:** 100% compliance-endpoint coverage.

**Demo:** Click "Export tenant data" on `dev-pabson-primary` (or Saraswati if operator wants test). S3 zip arrives with every entity. Run DR drill against test tenant from G.5a. Tenant-cancellation transitions on a test tenant. All legal-reviewed docs committed.

---

### Sprint H — Greenlight Rehearsal Completion (compressed C12, post-Phase-D)

**Goal:** Complete formal external-greenlight rehearsal. Compressed per v1 plan §9 Q7 recommendation (b): Saraswati's operator-led prod activation already covered C12.2 (steps 1–11). H covers C12.3 → C12.7 + C12.10 prod-shadow.

#### Tickets

- **H.1** — Operator-data verification on Saraswati (post-Phase-D).
  - **Files:** `docs/pilots/pabson-saraswati-bs-2083/h-rehearsal-evidence/` (NEW directory).
  - **Validation:** Capture: 1 week of period attendance evidence; 1 Term-1 exam-flow evidence (real-or-synthetic — see AC); 1 result-publish evidence; cross-year promotion evidence (simulated on `dev-pabson-primary` since Saraswati's real cross-year is ~Apr 2027).
  - **AC:** Evidence committed; operator signs off on data correctness. **Term-1 exam evidence must be either: (a) real Saraswati Term-1 evidence collected post-Asar 32 BS 2083 (~mid-July 2026), OR (b) `dev-pabson-primary`-shaped synthetic evidence collected pre-July 2026 with explicit annotation in the evidence doc that the real Saraswati Term-1 will be verified at the actual window.**

- **H.1.5** — Merge-mode regression audit on Saraswati's calendar.
  - **Files:** `docs/pilots/pabson-saraswati-bs-2083/h-rehearsal-evidence/merge-mode-audit.md`.
  - **Validation:** Query Saraswati's CalendarDate rows; identify any with `sourceUserId !== 'SYSTEM'` (operator-edited); verify they survived any post-2026-05-18 `generate-calendar` regenerations.
  - **AC:** Operator-edits intact; C3.8 merge-mode contract holds in real prod conditions.

- **H.2** — IEMIS dry-run sign-off.
  - **Files:** `h-rehearsal-evidence/iemis-dry-run.md`.
  - **Validation:** Saraswati operator + EdForge inspect IEMIS CSV from F2.7; resolve any discrepancies.
  - **AC:** Sign-off captured; CSV submission-ready.

- **H.3** — Tenant-export rehearsal on Saraswati. **DEPENDS ON G.1 (residency doc must be legal-signed first).**
  - **Files:** `h-rehearsal-evidence/tenant-export.md`; archived zip.
  - **Validation:** Run G.3 against Saraswati; inspect zip completeness.
  - **AC:** Zip complete; Saraswati operator signs off.

- **H.4** — Prod-shadow rehearsal on fresh `tenantTag=internal-dev` tenant.
  - **Files:** Deploy log in `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}`.
  - **Validation:** Provision fresh dev tenant in prod account; run steps 1-11 + 21-22; teardown.
  - **AC:** Prod-account provisioning + reporting + export validated; teardown clean.

- **H.5** — Audit + event-log completeness review (full Saraswati history).
  - **Files:** `h-rehearsal-evidence/audit-completeness.md`; query report.
  - **Validation:** Query event-log (from E.1) for Saraswati tenant; assert every write has audit row + event.
  - **AC:** Any unaudited write or un-emitted event = FAIL; resolved before sign-off.

- **H.6** — Demo video.
  - **Files:** `h-rehearsal-evidence/rehearsal-walkthrough.mp4`.
  - **Validation:** Walkthrough captures every step H.1-H.5; archived.
  - **AC:** Video archived; dossier index updated.

- **H.7** — Gap list publication.
  - **Files:** `h-rehearsal-evidence/gap-list.md`.
  - **Validation:** Any unresolved gap → backlog ticket; user signs off OR identifies must-fix.
  - **AC:** Gap list reviewed + signed off.

**Demo:** Full Saraswati rehearsal evidence package + prod-shadow log. **Greenlight = pilot operationally live.**

---

### Sprint I — Production Hypercare + Saraswati Operationally Live

**Goal:** Saraswati lives ≥30 days. Day-30 retro committed; backlog adjusted for pilot 2.

#### Tickets

- **I.1** — Operator-led onboarding session (recorded).
  - **Files:** `docs/pilots/pabson-saraswati-bs-2083/c13-launch-artifacts/onboarding-session.mp4`.
  - **Validation:** Recorded session of operator walking through daily ops with EdForge support.
  - **AC:** Recording archived; admin can complete daily ops independently.

- **I.2** — Day 0-7 observability daily check.
  - **Files:** `c13-launch-artifacts/week-1-checks.md`.
  - **Validation:** Daily CloudWatch alarm review; per-event audit completeness check; tenant-isolation cross-checks (zero cross-tenant queries succeed).
  - **AC:** No P0/P1 incidents in week 1; daily check-in artifacts captured.

- **I.3** — Day 8-30 hypercare triage queue.
  - **Files:** `c13-launch-artifacts/hypercare-queue.md`; per-item links to backlog tickets.
  - **Validation:** Every operator question + frontline bug captured; triaged to immediate fix or backlog.
  - **AC:** Triage queue empty by day 30 OR each item tracked.

- **I.4** — Day 30 retrospective.
  - **Files:** `c13-launch-artifacts/day-30-retro.md`.
  - **Validation:** Compare: what real production surfaced vs. what synthetic tests caught; pilot 2 readiness adjustments.
  - **AC:** Lessons learned → backlog adjustments committed.

- **I.5** — Sign-off log update in dossier.
  - **Files:** `docs/pilots/pabson-saraswati-bs-2083/dossier.md` "Sign-off log".
  - **AC:** C2, C12 (≡ H), C13.5 (≡ I.4) all green in dossier table.

**Demo:** Saraswati live for 30 days. Hypercare runbook in place. Day-30 retro committed. Sign-off log shows 3 green gates.

---

### Sprint K — PABSON Generalization Proof (NEW)

**Goal:** A second PABSON-archetype school onboarded with **zero engine changes** — only data drops. Plus a synthetic `archetype=GENERIC` non-NPR run to prove archetype-blindness beyond just "two PABSONs worked."

#### Tickets

- **K.0** — Pre-flight parametric smoke run (can execute during Sprint I).
  - **Files:** `scripts/smoke-tests/pre-flight-pilot-2-readiness.ts` (NEW); runs D1.7 + D2.9 + D3.7 + F1.9 + F2.7 with `PILOT_ID=<pilot-2-id-candidate>` once pilot-2 fixture exists.
  - **Validation:** All 5 smokes exit 0.
  - **AC:** Surfaces any latent pilot-1-specific assumption before K.5 provisioning; can run repeatedly during I.

- **K.1** — Pilot 2 dossier + fixture.
  - **Files:** `docs/pilots/<pilot-2-id>/dossier.md` (NEW, follows v1 §13 pilot-dossier contract); `packages/pilot-fixtures/pilots/<pilot-2-id>/{metadata,calendar/*,bell-schedule,academic-structure,holidays-consolidated,programs}.json` (NEW).
  - **Validation:** Fixture passes `packages/pilot-fixtures/src/schema/`.
  - **AC:** Dossier follows v1 §13; fixture loadable via `loadPilot('<pilot-2-id>')`.

- **K.2** — Invariant-13 audit (full re-grep).
  - **Files:** `scripts/lint/check-invariant-13.sh` (NEW; lint helper).
  - **Validation:** `grep -rni 'saraswati\|sseeb\|pabson-saraswati' server/application/microservices/*/src/ packages/shared-types/src/ client/ edforge-saas-frontend/ scripts/smoke-tests/` returns **zero hits** (excluding pilot-id env-var defaults in smoke scripts).
  - **AC:** Lint green; CI gates.

- **K.3** — Re-run pilot-greenlight harness with `PILOT_ID=<pilot-2-id>`.
  - **Validation:** Harness exits 7/7.
  - **AC:** Same test code, different `PILOT_ID`, zero engine changes — pass.

- **K.4a** — Re-run parametric smokes (D1.7, D2.9, D3.7, F1.9, F2.7) with `PILOT_ID=<pilot-2-id>`.
  - **Validation:** All exit 0.
  - **AC:** Zero engine changes; pass.

- **K.4b** — Re-run parametric smokes with synthetic `archetype=GENERIC` non-NPR fixture (the actual archetype-blindness gate).
  - **Files:** `packages/pilot-fixtures/pilots/generic-synthetic-q2-2026/` (NEW; `archetype=GENERIC`, `country=USA` (or any non-NPL), `currency=USD`, `calendarSystem=gregorian`, `timezone=America/Chicago`, `locale=en-US`, `weekStart=Monday`); finance entities verified to accept USD (per D0b.13 BUG-F1 fix).
  - **Validation:** Same 5 smokes run with `PILOT_ID=generic-synthetic-q2-2026`; all exit 0; **finance flows accept USD** without NPR-literal residue (this is the BUG-F1 regression guard).
  - **AC:** Engine accepts a non-PABSON archetype with no code changes; invariants 8 + 12 verified.

- **K.5** — Pilot 2 provisioning + operator-led setup rehearsal.
  - **Files:** `docs/pilots/<pilot-2-id>/k-rehearsal-evidence/`.
  - **Validation:** Provision real pilot-2 tenant in prod with **`tenantTag='production'`** (NOT `internal-dev` — this is the real pilot); operator completes activation via UI.
  - **AC:** Activation gate green; setup mirrors Saraswati's 2026-05-18 flow; `tenantTag='production'` recorded in tenant METADATA.

- **K.6** — Pilot 2 live cutover + 30-day hypercare (mirrors Sprint I).
  - **Files:** Per Sprint I template, under `docs/pilots/<pilot-2-id>/c13-launch-artifacts/`.
  - **AC:** Pilot 2 live; hypercare runbook reused; day-30 retro committed.

- **K.7** — Generalization retrospective.
  - **Files:** `docs/pilot-greenlight/pabson-generalization-retro.md` (NEW).
  - **Validation:** Compare: what we thought was generic that turned out pilot-1-specific? Lessons feed pilot 3+.
  - **AC:** Retro committed; backlog adjustments for pilot 3+.

**Demo:** Pilot 2 live with the same engine running Saraswati. K.4b proves the engine accepts a non-PABSON archetype. Zero engine PRs in this sprint other than possible K.2 drift-fix — and that drift-fix becomes the operational measure of "did we maintain invariant 13."

---

## 6. Demoability matrix

| Sprint | Demo venue | What demos |
|---|---|---|
| D0a | Saraswati prod | IEMIS columns populated on new uploads; jobs LIST returns history; backfill log shows 206 updated; janitor catches stuck row; XLSX header validation |
| D0b | `dev-pabson-primary` + Saraswati for Bug 1/3 | 4 bug fixes; F1/F2/F6 fixes; ESLint rule catches mismatch; BS picker + sync-guard + contract specs + grid markers + Playwright auth + finance widen + `dev-pabson-primary` config audit |
| D1 | `dev-pabson-primary` → Saraswati admin/principal | Dashboard daily-activity cards (classwork-today, grades-yesterday, sections-with-attendance-taken); CourseOffering emits events; academics module-wiring spec green; co-teacher + inter-section transfer UI; (conditional) Discipline MVP |
| J | `dev-pabson-primary` → Saraswati teacher | "My day" view; per-period attendance against timetable; substitute teacher day-assignment |
| D2 | `dev-pabson-primary` (Saraswati Term-1 follows) | Full exam lifecycle, bulk score entry, state machine |
| D3 | `dev-pabson-primary` | Result generation via Lambda + publication |
| E | `dev-pabson-primary` via `event-log-roundtrip.ts` | 5 events through bus → log; DLQ + retry; PascalCase audit |
| F1 | `dev-pabson-primary` (Saraswati at actual transition Apr 2027) | Cross-year handoff simulation |
| F2 | Saraswati | IEMIS CSV with real 206+ student counts |
| G | `dev-pabson-primary` + test tenant | Export + DSAR + DR drill + cancellation SM |
| H | Saraswati + fresh prod-shadow tenant | Full rehearsal evidence + prod-shadow + merge-mode audit |
| I | Saraswati | 30-day hypercare run |
| K | Pilot 2 + synthetic GENERIC | Engine works for second PABSON school + non-PABSON archetype |

Every demo is reproducible in <30 minutes by an engineer (operator demos for D0a, D1.4, K.5 may exceed for operator-pacing reasons).

---

## 7. Validation strategy per ticket type

| Type | Required validation | DoD checks |
|---|---|---|
| Entity (DDB shape) | Jest unit on factory + `gsi-casing-contract.spec.ts` + entity-vs-schema contract test (F5 pattern from D0b.10) | Module-wiring spec updated in same PR |
| Pure function (rollup, aggregation, mapper) | Jest unit, table-driven, ≥90% line coverage | n/a |
| Service method (DDB read/write) | Jest integration via mocked DDB client OR live against `dev-pabson-primary` | `auditedWrite` + `publishValidatedEvent` paired (D0b.7 lint) |
| Controller endpoint | Jest integration via supertest + route-drift lint | Route-drift CI green |
| New API route | Three-way handoff PR (Nest + tenant-api-prod.json + nginx if new prefix) + route-drift lint + live curl post-deploy | Three-way handoff verified in PR review |
| Event emission | Integration asserts audit row + event-log entry (post-Sprint E); pre-Sprint E asserts via D0b.7 lint + CloudWatch | Lint passes |
| Frontend component | Playwright e2e on storybook or live; manual on Saraswati if daily-use | Playwright in CI from D0b.12 |
| Smoke script | Exits 0 against Saraswati AND `dev-pabson-primary` with appropriate `PILOT_ID`; raw log retained privately | Private deploy evidence summarized in `docs/deploys/INDEX.md` |
| Compliance/lint rule | CI gates on rule; deliberately-bad commit must fail CI | n/a |
| Doc-only ticket | Reviewed; checked into repo; reviewer signoff in PR | n/a |
| Shared-types schema export | Minor bump + `npm publish` + AdminWeb jsdom bundle sim per CLAUDE.md + lockstep pin bumps in `server/package.json` + `server/application/package.json` | Bump+publish+sim per CLAUDE.md "Per-sprint shared-types publish checklist" |
| CDK stack change | `npx cdk synth` locally + `cdk diff` logged + deploy via `scripts/deploy-analytics.sh` (renames to `scripts/deploy.sh` per B0.1) | Diff logged in `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}` |

---

## 8. Definition of Done (per ticket — extends v1 §10)

A ticket is "Done" when:
- [ ] Files changed match listed Files
- [ ] Validation passes (jest/integration/smoke as specified)
- [ ] AC reviewer-checkable (no "tested locally")
- [ ] All architecture invariants (§2.2) preserved
- [ ] Audit + event emission paired (D0b.7 lint enforces post-merge of D0b.7)
- [ ] Three-way route registration verified (if new endpoint)
- [ ] PR description references ticket ID (e.g., "D2.4a — Exam CRUD")
- [ ] If shared-types changed: minor bump + npm publish + AdminWeb jsdom sim per CLAUDE.md "Per-sprint shared-types publish checklist"
- [ ] If new NestJS module: `module-wiring.spec.ts` updated in same PR (§3.7 invariant)
- [ ] If new GSI: `docs/pilot-greenlight/gsi-inventory.md` updated before CDK deploy
- [ ] **Invariant 13 check** (run before every PR):
  ```bash
  grep -rni 'saraswati\|sseeb\|pabson-saraswati' server/application/microservices/*/src/ packages/shared-types/src/ client/ edforge-saas-frontend/ scripts/smoke-tests/ \
    | grep -v 'PILOT_ID' | grep -v '<your-other-pilot-default-env-vars>' \
    | tee /tmp/inv13.log
  test ! -s /tmp/inv13.log  # exits 0 if file is empty
  ```

## 9. Definition of Done (per sprint — extends v1 §11)

A sprint is "Done" when:
- [ ] Every ticket meets per-ticket DoD
- [ ] Sprint demo recorded (or run live) against a pilot dev tenant or Saraswati
- [ ] Private deploy evidence summarized in `docs/deploys/INDEX.md` for any prod-touching action
- [ ] No regressions in prior sprints' smokes (regression bundle re-run)
- [ ] Closeout note added to `docs/pilot-greenlight/sprint-closeouts.md`
- [ ] If shared-types touched repeatedly: consider one consolidated publish at end of sprint (lesson from C3 retro — 5 back-to-back publishes were ceremonial)
- [ ] Cognito JWT captured fresh **just before the smoke**, not at deploy start (lesson from C3 retro — 1h TTL shorter than CDK+ECS roll)

---

## 10. Risk register (NEW)

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | School opens <14 days; D1 frontend slips | M | H — manual workaround burns operator trust | D0a doesn't gate D1; D1 can start after D0b.7 ESLint rule lands |
| R2 | Principal continues IEMIS uploads while ENG-2 unshipped → backfill scope compounds | H | M — D0a.3 backfill handles it; reviewer-checkable diff grows | Ship D0a.1 → D0a.2 → D0a.3 in lock-order before next upload (op coordination) |
| R3 | F2 (IEMIS submission) deadline is mid-year 2026, before F1 ready | M | H — F1 dependency wrong; F2 must invert | Confirm CEHRD deadline; document in §11 Q2; if confirmed, F2 can run pre-F1 (parametric smokes still valid) |
| R4 | `dev-pabson-primary` SchoolConfiguration state regression hides demo bugs | L (T4+T5 fixed) | H — demos surface stale data | D0b.14 pre-D1 audit ticket |
| R5 | shared-types caret-pin drift breaks Docker build on D2/D3 | M | M — caught at ECR push | Sprint DoD checklist; per-PR pin bump confirmation |
| R6 | EventBridge Lambda cold-start on D3.3 causes >30s SLA breach | M | M | DLQ + alarm + warm-up; cold-start latency budgeted in D3.3 AC (45s incl. cold start) |
| R7 | Operator hypercare on-call coverage in UTC+5:45 not yet staffed | H | M — incident-response lag | §11 Q6 must be answered before I.2 starts |
| R8 | K.2 invariant-13 grep finds late-stage drift, forces eng work in K (defeats "data-only" claim) | L | H — invalidates generalization proof | K.2 runs as weekly preflight during D1-F2 (not just at K time) |
| R9 | Module-wiring spec skipped on new modules (D2/D3/F1/F2/G) | M | H — DI breakage at ECS boot (twice already prod-down per memory) | Per-PR checklist (§8); CI module-wiring spec catches misses |
| R10 | Finance NPR-literal residue (BUG-F1) breaks K.4b's non-NPR validation | M | H — invalidates K | D0b.13 ships finance widen before K.4b |
| R11 | IEMIS job janitor missing → stuck-running jobs invisible | M | M — operator can't retry | D0a.4 ships janitor in same sprint as transformer |
| R12 | Cognito 1h JWT TTL shorter than CDK+ECS roll | H | L | §9 sprint DoD: capture JWT just before smoke |
| R13 | Two-repo git hygiene violation (e.g., wrong-repo branch) | M | M — recoverable per CLAUDE.md house rule | Explicit `cd <repo>` per git command; verify `git branch --show-current` before commit |
| R14 | Saraswati operator surfaces a Phase-D issue mid-sprint that compounds | H | M — sprint-level disruption | D0b.5-style weekly operator sync; in-sprint fast-follow PR budget |
| R15 | Pilot 2 candidate not identified before K.0 pre-flight | M | M — K compresses to "synthetic-only generalization" | Q4 in §11 must be answered before D2 ships |
| R16 | Saraswati's AY 2083 calendar has operator edits that won't survive a future regenerate | L | H — operator trust break | H.1.5 merge-mode audit catches this; backfill plan if any edits at risk |
| R17 | **Academics has no `auditedWrite()` infrastructure** (invariant 5 violation; daily-use audit). Every academics write is DDB-direct with no audit-row companion. | H (latent) | M for Saraswati / H for K.5 multi-school | B0.1 architectural debt; port `AuditedWriteService` from identity before Sprint K. CloudWatch logs trace writes meanwhile |
| R18 | **All ~30 academics events emit legacy PascalCase**, fall through C0.c backward-compat branch with no Zod validation (invariant 6 violation). | H | L — events flow but unvalidated | E.8 absorbs migration. Until E ships, audit emissions via CloudWatch warning-log scan |
| R19 | **Academics has no `module-wiring.spec.ts`** — twice took prod down per memory `feedback_module_wiring_invariant` | M | H — DI breakage at ECS boot | D1.3 ships academics module-wiring spec |
| R20 | **No timetable entity** — D1 (period attendance) was over-scoped pre-audit. Saraswati teachers have no "my day" view. | H | M — per-section-per-day works for class-teacher model | Defer per-period attendance to Phase J post-K (audit Q1 + user decision 2026-05-19). Saraswati runs on class-teacher takes morning attendance once for Term 1 |
| R21 | **Discipline / Behavior module absent** — IEMIS Form-19 may require disciplinary-incident count | M | M — pilot might run without it; IEMIS gap if required | D1.6 ships MVP if Saraswati onboarding confirms requirement; otherwise defer to backlog |

---

## 11. Open questions

1. ~~**F2 vs F1 ordering.**~~ ✅ **Resolved 2026-05-19** — CEO directive: CEHRD submission timing is flexible; assume anytime acceptable. F2 stays after F1.
2. ~~**CEHRD submission deadline.**~~ ✅ **Resolved 2026-05-19** — flexible; document during operator onboarding for record-keeping but not plan-blocking.
3. **Legal/operations point-of-contact for G.1 + G.2.** Without named owner, G is unschedulable.
4. **Pilot 2 candidate identity.** K depends on a second PABSON school signed up. Who, when, what AY? (Risk R15.)
5. **Hypercare on-call rotation (Sprint I).** UTC+5:45 night/weekend coverage. (Risk R7.)
6. **Frontend follow-up sprint bundling.** D3.8 + F2.8 + C7.6 — one consolidated "Operator polish UI" sprint after I, or spread? Trade-off: frontend bandwidth vs. delay for admin-rare workflows.
7. **C12 prod-shadow tenant lifecycle.** H.4 provisions + tears down a fresh prod-account tenant. Cost-center implication? Tracking in tenant METADATA?
8. ~~**Bell-schedule scope='non-academic' generalization.**~~ Moot — D1 rescope drops per-period attendance entirely (deferred to Phase J). Question revisits at J.4.
9. **Saraswati co-teaching practice** — does the school actually co-teach any sections? Determines whether D1.4 (co-teacher UI) ships in-sprint or defers. **Confirm during operator sync.**
10. **IEMIS Form-19 disciplinary requirement** — is the disciplinary-incident count a hard IEMIS submission requirement, or nice-to-have? Determines whether D1.6 (Discipline MVP) is in D1 scope or backlog. **Confirm during operator sync.**
11. **Pilot 2 PABSON archetype candidate identification** — answered 2026-05-19 as "identified but not signed"; K.0 pre-flight runs during I once fixture data is drafted.

---

## 12. What was preserved vs. compressed from v1 plan

**Preserved verbatim:**
- §4 architecture invariants (the 13)
- §10 + §11 DoD checklists (extended in §8/§9 above)
- §13 pilot dossier contract (K.1 AC references)

**Compressed:**
- §2 phase-and-sprint outline — restated in §4 dep graph
- §3 design principles — extended into §3 operating principles
- §6 ticket detail for C3/C4/C0.a/C0.b/C0.c — closed; cross-referenced only
- §7 critical path — restated in §4 with parallel markers
- §8 operator UX scope — folded into §5 per-sprint ticket "Files" lines + §6 demoability venue
- §9 open questions — folded into §11 (with status updates) + §10 risk register

**Lost (consciously):**
- Detailed Phase-A/B/C status snapshot tables — superseded by sprint-plan.md §0.5 (still authoritative)
- Per-sprint deploy-log link tables for Phase A/B/C — preserved in v1 plan §0.5 + INDEX.md
- The Saraswati-specific operator track table — kept in v1 plan §0.5; mirrored in dossier

**Added:**
- D0a / D0b split (operator-feedback compounding vs non-compounding)
- D0b.13 finance widen-to-tenant-currency (BUG-F1 follow-on)
- D0b.14 dev-pabson-primary config cleanup audit
- D1.0 section readiness audit; D2.0 curriculum readiness audit
- D1.1 non-academic-scope explicit rejection
- D0a.4 IEMIS Job Janitor (BL-1)
- D0a.5 XLSX strict-header validation (BL-2)
- E.7 event-log roundtrip smoke (closes demoability gap)
- F1.5 split a/b/c
- G.5 split a/b (provisioning helper + drill)
- H.1.5 merge-mode regression audit
- K.0 pre-flight parametric smoke
- K.4b synthetic GENERIC archetype validation
- Sprint K (PABSON generalization)
- Risk register (§10)
- Module-wiring invariant in §3 + §8 DoD

---

## 13. What changed from v0 draft (this v1)

Following a critical staff-engineer + product-lead review, this v1 differs from v0 in:

| Change | Reason |
|---|---|
| Split Sprint D0 into D0a + D0b | v0 D0 had 10 tickets across 2 services + frontend + backfill against live prod — not atomic |
| Added D0a.4 (IEMIS Janitor) + D0a.5 (XLSX header validation) | Saraswati uploads continue daily; stuck jobs invisible without janitor; header rename silently drops fields |
| Added D0b.13 (finance widen) | BUG-F1 invisible in v0; required for K.4b's non-NPR archetype validation |
| Pulled E.4 (ESLint rule) forward to D0b.7 | v0 deferred audit/event lint to post-D3; D1/D2/D3 audit completeness was manual-review-only |
| Added D1.0 + D2.0 readiness audits | v0 assumed Section + Curriculum entities ready; not verified |
| D1.1 explicit non-academic-scope rejection | v0 silently assumed bell resolver handled Shift-1 exclusion |
| D0a.1 + D0a.2 + D0a.3 lock-ordered | v0 had "D0.2 leverages D0.3 or enumerates directly" — coin-flip dependency |
| D0.5 (Bug 2) made into a spike ticket | v0 had "TBD files" — not atomic |
| F1.5 split a/b/c | v0 was one ticket covering 3 distinct concerns (handler, atomic flip, idempotency) |
| G.5 split a/b | v0 conflated test-tenant provisioning with DR drill |
| H.1 explicit real-vs-synthetic Term-1 AC | v0 was silent on what counts as Term-1 evidence pre-July-2026 |
| Added H.1.5 merge-mode regression audit | v0 missed C3.8 merge-mode contract under real operator-edit conditions |
| Added K.0 pre-flight + K.4b GENERIC synthetic | v0's K validated "two PABSONs work" but not archetype-blindness |
| Added §10 risk register (16 entries) | v0 had no explicit risk register |
| Restored §8/§9 DoD checklists from v1 plan | v0 compressed DoDs too aggressively |
| Module-wiring invariant elevated to §3 + §8 | v0 mentioned it once; incident history says twice prod-down |
| §6 demoability matrix kept; §7 validation matrix extended | v0 was lighter on per-type DoD breakdown |

---

**This plan is live; revisions land via PRs that touch this file.** When a sprint closes, append a one-line entry to §0.5 of the v1 plan referencing the new closeout doc, AND mark the relevant sprint header here as 🟢 with PR links.

---

## 14. v1 → v2 — Daily-Use Audit-Driven Revisions (2026-05-19 afternoon)

The 2026-05-19 daily-use coverage audit ([`daily-use-coverage-audit-2026-05-19.md`](./daily-use-coverage-audit-2026-05-19.md)) materially changed Sprint D1's scope and surfaced new architectural risks. CEO decisions on the audit's 5 open questions:

| Audit Q | CEO decision (2026-05-19) | Plan change |
|---|---|---|
| Q1: Timetable / per-period attendance — defer to Phase J? | ✅ Defer | Sprint D1 rescopes from "Period Attendance Surface" to "Daily-Use Coverage". NEW Phase J post-K covers timetable + per-period + substitute. |
| Q2: Discipline / IEMIS Form-19 requirement | Confirm with admin during operator sync | D1.6 conditional |
| Q3: Co-teacher Saraswati realism | Confirm with admin during operator sync | D1.4 conditional |
| Q4: PascalCase event migration timing | ✅ Absorb into Sprint E | New ticket E.8 |
| Q5: Academics `AuditedWriteService` | ✅ Track as B0.1 backlog | Risk R17 added |

**Sprint D1 — rescoped to "Daily-Use Coverage":**
- D1.0 ~~Section readiness audit~~ (v0/v1 ticket) → DROPPED. Audit confirmed sections module is operator-ready end-to-end.
- D1.1 ~~classPeriodId validation in-bell-schedule + academic-scope~~ → MOVED to Phase J (J.4)
- D1.2 ~~Day-rollup engine~~ → MOVED to J.4
- D1.3 ~~Holiday-aware rollup~~ → MOVED to J.4
- D1.4 ~~Per-period grid UI~~ → MOVED to J.3
- D1.5 ~~Per-period analytics aggregation~~ → MOVED to J.4
- D1.6 ~~Audit + event emission on attendance writes~~ → MOOT (D0b.7 ESLint rule handles enforcement; existing attendance writes already emit legacy PascalCase events)
- D1.7 ~~Pilot real-data attendance smoke~~ → MOVED to J
- D1.8 ~~Section-attendance regression check~~ → MOOT (per-section-per-day attendance unchanged in D1)

**Sprint D1 — NEW tickets (per audit's D-DAILY proposal):**
- **D1.1** — Dashboard daily-activity surfaces (gap #2 + #5 from audit). Extend `DashboardService.getOverview` to add `recentClassworkCount`, `recentGradeCount`, `sectionsWithAttendanceTaken`. ~1 sprint-day. **AC:** principal sees 3 new cards above-the-fold; query path uses DDB GSIs (not events — events deferred per Q4).
- **D1.2** — CourseOffering event emission (gap #6, invariant 6). `course-offering.service.ts` adds publishCourseOfferingCreated/Updated/Deleted via `eventsService`. Legacy PascalCase OK (E.8 migrates later). ~30 LOC + 3 emission tests. **AC:** every write emits one event; invariant 6 audit-grep passes for CourseOffering.
- **D1.3** — Academics `module-wiring.spec.ts` (gap #8, R19). NEW `microservices/academics/src/__tests__/module-wiring.spec.ts` mirroring identity's. ~150 LOC. **AC:** spec fails on deliberate "forgot import" mutation; passes on main.
- **D1.4** [CONDITIONAL on operator-sync answer to Q9] — Co-teacher UI in SectionForm. Multi-select `coTeacherIds` in `edforge-saas-frontend/.../SectionForm.tsx`. ~1 sprint-day. Defer if Saraswati single-teacher norm.
- **D1.5** — Within-school inter-section transfer endpoint. `POST /sections/:id/transfer` with `{targetSectionId, studentIds[]}`, atomic TransactWriteItems drop+add, emits `StudentTransferredBetweenSections`. Three-way handoff. ~1 sprint-day. **AC:** single-call atomic transfer; partial failure rolls back both sides.
- **D1.6** [CONDITIONAL on operator-sync answer to Q10] — Discipline MVP. NEW `discipline/` module: Ed-Fi `DisciplineIncident` + `StudentDisciplineIncidentAssociation` entities, CRUD endpoints, descriptors under `edforge:` namespace, dashboard count. ~MEDIUM. Defer if IEMIS Form-19 doesn't require it.
- **D1.7** — Academics 404 → structured errorCode hardening (audit invariant-7 observation). Classwork/grades/sections/courses currently throw `NotFoundException` with string message, not `errorCode`. Bring to identity's `NO_CURRENT_AY` pattern. ~half-day per module × 4 = ~2 days.

**Sprint E — NEW ticket E.8 (PascalCase migration):**
- **E.8** — Academics events migrate to snake-dotted registry. Add 6 new Zod schemas in `packages/shared-types/src/events/` for `attendance.recorded`/`.updated`, `classwork.item_created`, `grade.recorded`/`.finalized`, `enrollment.created`. Register in `EVENT_REGISTRY`. Update `academics-events.service.ts` to use `publishValidatedEvent`. Keep legacy publishers as alias-with-deprecation-warning for 1 sprint, then delete. **AC:** event-log integration sees 6 new types; backward-compat aliases log deprecation warning.

**Sprint K — Pre-flight check added:**
- **K.0.5** — Verify R17 fix landed: `grep -rn auditedWrite microservices/academics/src/` returns ≥1 hit. If R17 still B0.1 at K time, K.5 (real pilot 2 provisioning) is gated on completion or explicit acceptance of risk by Tech Lead.

**Phase J — NEW (post-K, "Operational Polish"):**
- **J.1** — `Timetable` entity in identity service. Key shape `SCHOOL#schoolId#TIMETABLE#{ayId}#{termId}#{dayOfWeek}#{periodId}` → `{sectionId, primaryTeacherId, locationId}`. Module-wiring spec extended same PR.
- **J.2** — Timetable CRUD endpoints. Three-way handoff (Nest + tenant-api-prod.json + nginx new prefix `/schools/:id/timetable`).
- **J.3** — Timetable UI grid (frontend). Weekly grid for operator to drag sections into period × day cells. "My day" teacher view.
- **J.4** — Per-period attendance integration. Extend section-attendance with optional `classPeriodId`; frontend uses timetable to know which period is "now"; rollup respects holiday/weekend/vacation (revives D1.1-D1.5 logic). Pilot smoke `pilot-attendance-week.ts` parametric.
- **J.5** — Substitute-teacher day assignment. `POST /schools/:id/timetable/substitutes` with `{date, periodId, sectionId, substituteTeacherId, reason}`. Resolver prefers sub over base timetable for the day. Three-way handoff.

**Daily-use coverage tracking metric:** the audit established a **~55% baseline**. After D1 ships, projected ~70%. After Phase J ships, projected ~92% (parent communication remains V1-deferred per v1 plan §5).

**What was NOT changed by the audit:**
- D0a tickets (already in flight; D0a.1 merged 2026-05-19 as PR #131)
- D0b tickets (already scoped)
- D2 / D3 / F1 / F2 / G / H / I / K (audit found no scope changes; F2 timing relaxed per CEO 2026-05-19)
- §3 operating principles, §4 invariants, §7-§9 DoDs

---

> Document state: **v2 (audit-revised)**. Next major revision will follow either a pilot operator sync (resolves Q9/Q10) or the close of Sprint D0a.
