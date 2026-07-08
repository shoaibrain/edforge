---
title: Grade-Level Fix Sprint — Plan
status: Open — ready for first task pickup
date: 2026-05-08
audit_source: docs/grade-level-audit/ (8 docs + captures from dev-pabson-primary)
test-bed: dev-pabson-primary tenant (21aea5da-...) + School A (4209e3d8-...)
deploy-target: prod only (`ap-south-1`, account 257526644020) — UAT was sunset in infra-sunset sprint
workflow: branch → commit → PR → review → approve → prod deploy. No autonomous deploys.
---

> **Topology note (2026-05-08):** UAT in `us-east-2` was torn down in the infra-sunset sprint. The CLAUDE.md "UAT → human-review → prod" ladder is stale; only prod in `ap-south-1` exists. ECS `desiredCount` was reduced 2→1 in infra-sunset/6, so rolling deploys briefly run with zero healthy tasks until the new task is healthy — plan the deploy window with that in mind.
>
> **Validation strategy (replaces every "UAT validation" step below):** Validation happens directly on prod, but **only via the `dev-pabson-primary` tenant** (`tenantId 21aea5da-...`, tag `internal-dev`) which is mechanically isolated from Saraswati. New schools, test imports, and abandonment-wizard repros all happen on this tenant. Saraswati is read-only-touched until the operator validates the final feature on her own real workspace. Any text below that says "UAT" should be read as "prod via dev-pabson-primary first, then a Saraswati-operator spot-check after."
>
> **Workflow (replaces every "deploy plan" step below):** ALL changes go through a reviewed PR before any deployment. CDK changes run `cdk synth` + `cdk diff` and the diff is reviewed before suggesting release. Backend code changes ship after PR approval via prod ECR push + ECS roll. Frontend ships via Vercel auto-deploy on PR-merged main. **No autonomous deploys to prod ever.**

# Grade-Level Fix Sprint

## Why this sprint exists

The audit at [../grade-level-audit/](../grade-level-audit/) produced an evidence-backed fix list. **One finding is a silent pilot blocker**: the legacy `getGradeLevelsInRange` in shared-types returns `['12']` for any school whose grade range starts with `'ECD'`, which silently breaks the Curriculum, Enrollment, EditStudent, Registration, and Rostering forms for every PABSON primary school — including Saraswati. IEMIS bulk import bypasses these forms, which is why the pilot has not yet vocally complained. **Time-to-vocal-complaint estimate: 1–2 weeks of operator usage** in any module other than IEMIS.

Several adjacent items also need to ship before opening the platform to a second prod tenant.

## Sprint goal

1. Close the F-LEGACY-1 pilot blocker via a hotfix-shaped PR within 1–2 days (Track A).
2. Within the same release window (~1 week), close the pilot-hardening fixes (Track B): IEMIS recovery + cross-validation, SchoolConfiguration cleanup, Curriculum-tab Students column, Ed-Fi extension namespace.
3. Defer strategic structural items (F-TRANSLATE-1, F-IEMIS-3, F-SCHOOL-1) — track in backlog, not in this sprint.

## Tracks and tasks

### Track A — Hotfix (must ship within 1–2 days)

**T1 — F-LEGACY-1: fix `getGradeLevelsInRange` for ECD/PPC schools**

- **Owner:** backend (shared-types) + frontend (consumer pin bumps)
- **Severity:** HIGH
- **Effort:** S
- **Files to change:**
  - [packages/shared-types/src/validators/grade-level.ts](../../packages/shared-types/src/validators/grade-level.ts) — re-route to canonical `ORDERED_GRADES` from `schemas/identity/grade-levels.ts`. Recommended: **make `GRADE_LEVELS` a re-export of `ORDERED_GRADES`** so the existing `slice()` arithmetic just works. Type `GradeLevel` widens to include `'ECD' | 'PPC'`.
  - [packages/shared-types/src/validators/grade-level.spec.ts](../../packages/shared-types/src/validators/grade-level.spec.ts) — add the regression test matrix below.
  - [packages/shared-types/package.json](../../packages/shared-types/package.json) — bump version (next minor: presumed 0.40.0)
  - [package-lock.json](../../package-lock.json) — refresh root lockfile
  - [edforge-saas-frontend/apps/academics/package.json](../../edforge-saas-frontend/apps/academics/package.json), [edforge-saas-frontend/apps/shell/package.json](../../edforge-saas-frontend/apps/shell/package.json), [edforge-saas-frontend/packages/*/package.json](../../edforge-saas-frontend/packages/) — bump `@aibrains/shared-types` pin (per [`edforge_shared_types_caret_pin.md`](../../../.claude/projects/-Users-shoaibrain-edforge/memory/edforge_shared_types_caret_pin.md): `^0.N.0` resolves to `>=0.N.0 <0.(N+1).0`, so every consumer must bump explicitly).
  - **Backend identity/academics services:** also pin shared-types — bump per the publish checklist in CLAUDE.md.

- **Test matrix to add to grade-level.spec.ts:**

  | Input | Expected `getGradeLevelsInRange` output |
  |---|---|
  | `('ECD', '12')` | 16 entries `['ECD','PPC','PK','K','1','2',...,'12']` |
  | `('ECD', 'PPC')` | `['ECD', 'PPC']` |
  | `('ECD', 'ECD')` | `['ECD']` |
  | `('PPC', '5')` | `['PPC','PK','K','1','2','3','4','5']` (8 entries) |
  | `('PK', '12')` | 14 entries (current US-K-12 behavior preserved) |
  | `('6', '10')` | `['6','7','8','9','10']` (5 entries) |
  | `('12', 'ECD')` | `[]` (start > end) |
  | `('K', 'K')` | `['K']` |

- **Pre-deploy validation (local):** typecheck, lint, spec tests, `tsc --noEmit` cross-workspace, `nest build identity` and `nest build academics`. ✅ ALL DONE for T1.

- **PR-first deploy plan (revised for prod-only topology):**
  1. **Local:** typecheck, lint, run new spec tests in shared-types ✅
  2. **Local:** `cd packages/shared-types && npm run build` ✅
  3. **Publish:** `npm publish` from packages/shared-types/ (2FA prompt) ✅ (user approved + executed)
  4. **Verify:** `npm view @aibrains/shared-types version` ✅
  5. **Refresh:** root `npm install`, frontend `pnpm install` — commit both lockfiles with the PR ✅
  6. **AdminWeb sim:** clean rebuild + jsdom bundle init sim per CLAUDE.md ✅ (passed; new bundle `main.1ccd59c1.js` inits cleanly)
  7. **Stage:** branch from main → commit → push → open PR with the diff summary below. **STOP for human review.**
  8. **Prod deploy (only after PR approved):**
     - `AWS_PROFILE=prod ./scripts/build-application.sh identity 2>&1 | tee ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-build-application-identity-<ts>-<sha>.log`
     - Same for `academics`
     - `AWS_PROFILE=prod aws ecs update-service --cluster prod-basic --service identitybasic --force-new-deployment --region ap-south-1` (with log tee)
     - Same for `academicsbasic`
     - **Deploy window awareness:** ECS `desiredCount=1` means brief zero-healthy-task window per service during the roll. Coordinate with operator for low-traffic window if Saraswati is actively in-app.
  9. **Production validation:** spot-check on edforge.app with a Saraswati operator account — open Curriculum → Add Course; verify all 16 grade chips render. Repeat for EnrollExistingStudentModal, EditStudentModal, registration PersonalInfoStep, EnrollmentTable filter, rostering filter.
  10. **AdminWeb redeploy:** NOT required for T1 (AdminWeb does not import any grade-level helpers — confirmed by repo grep). Skip controlplane-stack redeploy; document the decision in the deploy log. F-EDFI-1 / F-LABEL-1 in later tasks may also be no-op for AdminWeb; assess per task.

- **Risk:** `GradeLevel` type widens to include `'ECD' | 'PPC'`. Any compile-time switch/match exhaustiveness check on `GradeLevel` will surface as TS error. **No such consumers found in repo grep** (backend uses `string` for gradeLevel fields uniformly; frontend uses string-keyed lookups), so risk is low. Run `tsc` across all workspaces to confirm before publish.

- **Rollback:** Re-deploy prior shared-types version; ECR rollback for identity + academics per CLAUDE.md "ECR image rollback" recipe.

- **Done when:**
  - Spec tests green
  - All 6 frontend forms render correct grade levels for an ECD-having school on UAT
  - Same on prod (Saraswati operator confirms)
  - shared-types new minor version visible on npm registry
  - Frontend & backend pin bumps merged

---

### Track B — Pilot hardening (ships within sprint, after Track A)

These can run in parallel with each other. T2 + T3 are the most pilot-protective; T4 + T5 are the orphan-config cleanup; T6 is the half-finished UI; T7 + T8 + T9 are quality polish.

---

**T2 — F-IEMIS-1: janitor cron for orphan running IEMIS_JOB rows**

- **Severity:** MEDIUM
- **Effort:** S
- **Files:**
  - New EventBridge rule + Lambda construct in [server/lib/](../../server/lib/) (place under analytics-stack or core-appplane-stack — preference: analytics-stack since it owns the operator-alert SNS topic)
  - The Lambda scans `edforge-academics-basic` for items where `entityType='IEMIS_JOB' AND status='running' AND createdAt < now() - 30min`, marks them `status='failed'` with `failureReason='task-killed-during-import'`, publishes to operator-alert SNS topic.
- **Test plan:**
  - Local: unit test the Lambda handler with mock DDB rows — running >30min, running <30min, succeeded, failed
  - UAT: kick a 5000-row import on a UAT test school, kill the academics ECS task mid-flight (`aws ecs stop-task ...`), wait 35 min, observe job marked failed + SNS alert fires
- **Rollback:** Detach EventBridge rule (idempotent — rule disabled means no scans, existing failed-marked rows stay marked).
- **Done when:** UAT failure scenario produces a failed job + SNS alert.

---

**T3 — ~~F-IEMIS-2: cross-validate `IEMIS Code` against school's `emisSchoolCode`~~** — **DISSOLVED 2026-05-12**

> **DISSOLVED — already shipped in an earlier sprint.** Discovered during T3 evidence-first investigation: the validation was already implemented as part of Midnight Lockin P0.6 / Sprint C3 work before the audit started. The audit caught the structural concern but missed the existing fix. Score one for evidence-first methodology — same pattern as F-CURRICULUM-1 (T1 era).
>
> **Evidence of existing implementation:**
> - Transform: [iemis-transform.ts:100-136](../../server/application/microservices/academics/src/students/iemis-transform.ts#L100-L136) — accepts `expectedIemisSchoolCode` opt; emits warning finding on mismatch (warn-and-continue, exactly the UX this task's spec recommended).
> - Sync-path wiring: [students.service.ts:1409](../../server/application/microservices/academics/src/students/students.service.ts#L1409) — `importStudentsIemis` passes `school.emisSchoolCode` to the transform.
> - Async-path wiring (Sprint C4): [students.service.ts:1602](../../server/application/microservices/academics/src/students/students.service.ts#L1602) — `executeIemisImportAsync` passes it too.
> - Regression test: [iemis-transform.spec.ts:192](../../server/application/microservices/academics/src/students/iemis-transform.spec.ts#L192) — `'IEMIS School Code mismatch emits a warning (not error)'`.
>
> **Why T1 captures didn't surface this:** the 200-row dev-pabson-primary fixture had `IEMIS Code: 888888888` matching the school's `emisSchoolCode: 888888888` — no mismatch, so the warning path never fired in the captures. Unit test pins the behavior.
>
> **Original spec** (preserved in `git log` on this branch — no value duplicating it here now that the fix is already shipped). No code change needed for T3; sprint advances directly to T4.

---

**T4 — F-CONFIG-1a: remove lazy `createDefaultConfig` fallback**

- **Severity:** MEDIUM
- **Effort:** S
- **Files:**
  - [server/application/microservices/identity/src/schools/schools.service.ts:873-889](../../server/application/microservices/identity/src/schools/schools.service.ts#L873-L889) `getConfiguration` — change behavior: when config row not found, return 404 instead of writing US defaults.
  - Caller audit: any frontend that calls `GET /api/schools/<id>/configuration` for non-existent schoolIds must be fixed to call `POST /api/schools` first (eager path). Audit shows the lazy create was triggered by abandoned wizards, suggesting some prefetch path needs hardening.
- **Frontend fix (paired in same PR):** find the `GET /configuration` prefetch site that fires for the WIP wizard schoolId and remove the prefetch, OR gate it on `school.status !== 'setup'`.
- **Test plan:**
  - Unit: `getConfiguration` returns 404 for unknown schoolId
  - UAT: open + abandon school wizard; verify no orphan SCHOOL#X#CONFIG row appears for the WIP schoolId.
- **Done when:** UAT abandonment scenario produces zero orphan CONFIG rows; existing real-school configs unchanged.

---

**T5 — F-CONFIG-2: GC orphan SchoolConfiguration rows**

- **Severity:** MEDIUM
- **Effort:** S
- **Files:**
  - New script `scripts/cleanup-orphans/orphan-school-configs.ts` modeled after the existing Sprint 0.5 cleanup-orphans pattern.
  - Logic: for each tenant, scan for `SK begins_with('SCHOOL#') AND SK ends_with('#CONFIG')`, then for each, check if `SCHOOL#<id>` METADATA row exists. If not → delete (with `--dry-run` default, `--apply` flag for execution). Audit log every deletion (operator email + correlation-id + timestamp + tenantId + orphan schoolId).
- **Pre-flight:** count orphans across UAT first; expected 1-3 per active tenant. Confirm count is not surprisingly high before applying.
- **Run order:**
  1. UAT `--dry-run` → count orphans, sanity check
  2. UAT `--apply` → delete; capture log to `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}`
  3. Prod `--dry-run` → count orphans
  4. Prod `--apply` → delete; capture log
- **Risk:** if F-CONFIG-1a (T4) hasn't shipped yet, new orphans accumulate after the cleanup. **Sequence T4 before T5.** Or run T5 with T4 in the same PR so production goes from "orphans + leak" → "no orphans + no leak" in one ladder rung.

---

**T6 — F-CURRICULUM-2: wire Students column to enrollment counts**

- **Severity:** MEDIUM
- **Effort:** S
- **Files:**
  - [edforge-saas-frontend/apps/academics/src/components/curriculum/GradeLevelsTab.tsx:241-243](../../edforge-saas-frontend/apps/academics/src/components/curriculum/GradeLevelsTab.tsx#L241-L243) — replace hardcoded `<span>—</span>` cell with a live count.
  - Data source: dashboard's `byGradeLevel` map (already fetched somewhere in academics MFE; confirm whether Curriculum tab can reuse the same query result or needs a new fetch).
  - Per-grade aggregation: pass enrollment count map down from the route component.
- **Edge cases:**
  - When count is 0 → render `0`, not `—`. The dash should ONLY appear during the loading state.
  - When the school has no current AY → render `—` with tooltip "No active academic year". Distinct visual state from "0 students".
- **Test plan:**
  - Visual: on dev-pabson-primary School A (200 imported students), Grade Levels tab should show realistic counts per grade. ECD bucket shows the count of ECD/PPC-merged students.
  - Edge: a fresh school with 0 students shows `0` in every row, not `—`.
- **Done when:** UAT + prod show non-em-dash counts on schools with enrollments.

---

**T7 — F-EDFI-1: namespace-route ECD/PPC at outbound mapper**

- **Severity:** MEDIUM (conditional on Ed-Fi consumer existing — none currently identified)
- **Effort:** S
- **Files:**
  - [packages/shared-types/src/mappers/edfi/education-org.mapper.ts:224-249](../../packages/shared-types/src/mappers/edfi/education-org.mapper.ts#L224-L249) `mapGradeLevel` — add explicit early-return for `'EarlyChildhoodDevelopment'` and `'PrePrimaryClass'` emitting under `uri://edforge.app/GradeLevelDescriptor#...`.
  - Optional: same audit for any other extension descriptor that falls through the `value || gradeLabels[value]` default. Quick code-read first.
- **Test plan:**
  - Snapshot test: `mapGradeLevel('EarlyChildhoodDevelopment')` returns `uri://edforge.app/GradeLevelDescriptor#EarlyChildhoodDevelopment`.
  - Snapshot test: `mapGradeLevel('FirstGrade')` continues to return `uri://ed-fi.org/GradeLevelDescriptor#First grade` (preserve existing behavior).
- **Adjacent observation worth a quick check:** core descriptors use mid-sentence lowercase (`'First grade'` not `'First Grade'`). 5-min check whether Ed-Fi v6 spec uses Title Case.
- **Done when:** snapshot tests green + mapper output namespace-routes extensions correctly.

---

**T8 — F-LABEL-1: retire `formatGradeLabel` duplicate**

- **Severity:** LOW
- **Effort:** S
- **Files:**
  - [edforge-saas-frontend/apps/academics/src/hooks/useAcademicsOverview.ts:338-348](../../edforge-saas-frontend/apps/academics/src/hooks/useAcademicsOverview.ts#L338-L348) — delete `formatGradeLabel`; replace call sites with `getGradeLevelLabel` from `@aibrains/shared-types`.
  - May need to extend shared-types `getGradeLevelLabel` to handle the chart's `'1st Grade'` style if needed; currently shared-types returns `'Grade 1'` style. **Decide which style is canonical** — this is a UX consistency call. Recommendation: keep shared-types `'Grade 1'` style and update chart label rendering accordingly. Chart will read consistently with form chips.
- **Test plan:** Storybook snapshot of chart with shared-types label.
- **Done when:** chart still renders correctly; `formatGradeLabel` is gone from MFE.

---

**T9 — F-AY-1: auto-set `isCurrent` on first AY activation**

- **Severity:** LOW
- **Effort:** S
- **Files:**
  - Identity service academic-year status PUT handler (find via grep — likely [server/application/microservices/identity/src/academic-year/](../../server/application/microservices/identity/src/academic-year/) or similar). When `status='active'` and **no other AY for this school is `isCurrent`**, set `isCurrent=true` automatically.
- **Test plan:**
  - Unit: first AY activation → isCurrent=true
  - Unit: second AY activation while first is current → isCurrent=false (operator must explicitly switch)
  - UAT: create 2 AYs, activate first, observe isCurrent=true; activate second, observe isCurrent=false.
- **Done when:** captured behavior matches spec.

---

## Sequencing (revised for prod-only / PR-first workflow)

```
Day 0           Day 1                Day 2                 Day 3-7
─────────       ──────               ────────              ────────
T1: F-LEGACY-1  Local: code          PR opened →           Prod deploy:
                + tests + lockfile   diff reviewed →       ECR push +
                + bundle sim         user approves         ECS roll →
                                                          dev-pabson
                                                          validation →
                                                          Saraswati
                                                          spot-check

                                                          T2-T9 each follow
                                                          same PR-first
                                                          ladder. CDK tasks
                                                          (T2) require
                                                          synth+diff review
                                                          before deploy.
```

**Per-task ladder (universal):**

```
1. Branch from main
2. Code change(s) + tests
3. Local validation: typecheck, lint, unit tests, build
4. CDK tasks only: cdk synth + cdk diff <stack> — review diff carefully
5. shared-types-touching tasks only: bump version, npm publish (with user approval)
6. Push branch, open PR with diff summary + deploy plan
7. PR review → user approves
8. Prod deploy with log tee to ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/
9. dev-pabson-primary validation
10. Saraswati operator spot-check (low-traffic window)
11. Update memory entry: project_grade_level_fix_<task>_shipped.md
12. Update status snapshot in this file
```

**Critical path:** T1 ships first (Day 1-2). Everything else parallelizes after.

## Pre-flight checklist (before T1 begins)

- [x] Confirm shared-types CI publish workflow works (0.40.0 published 2026-05-08)
- [x] Confirm dev-pabson-primary on prod has an ECD-having school (School A `4209e3d8-...` from audit captures)
- [ ] Coordinate with Saraswati operator: pre-announce that Curriculum forms will start showing all grade levels (queue for after PR approved)
- [ ] `git checkout main && git pull` — ensure starting from main
- [ ] Branch: `git checkout -b sprint/grade-level-fix-T1` (one branch per task; small focused PRs)

## Per-sprint shared-types publish checklist (per CLAUDE.md)

For T1, T7, T8 — each sprint task that changes `packages/shared-types/src/`:

1. ☐ Bump version (T1: 0.40.0 — single bump per task is fine; or roll T1+T7+T8 into one bump if they ship together)
2. ☐ Publish to npm (`npm publish` with 2FA)
3. ☐ Verify `npm view @aibrains/shared-types version`
4. ☐ Refresh root lockfile
5. ☐ Rebuild AdminWeb locally (no grade-level imports → expected no-op, but verify)
6. ☐ Run jsdom bundle sim per CLAUDE.md
7. ☐ Rebuild + ECR push identity + academics
8. ☐ Deploy controlplane-stack (only if AdminWeb is affected — for grade-level tasks this is a no-op since AdminWeb doesn't import these helpers)
9. ☐ edforge-saas-frontend Vercel auto-deploys on git push
10. ☐ Post-deploy sanity curl

## Logs convention

Every deploy step in this sprint must tee a log to `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}` per CLAUDE.md filename pattern:

```
<env>-<target>-<YYYYMMDD-HHMMSS>-<gitsha>.log
```

Examples:
- `uat-build-application-academics-20260509-100530-abc1234.log`
- `uat-ecs-roll-academicsbasic-20260509-101200-abc1234.log`
- `prod-build-application-identity-20260510-143015-def5678.log`

When the sprint ships, add a section to [docs/deploys/INDEX.md](../${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/INDEX.md) linking the relevant logs.

## Risks

1. **`GradeLevel` type widening (T1) breaks downstream switch exhaustiveness.** Repo grep showed no consumers, but a full `tsc` across all workspaces should run as a guard. Mitigation: add this to T1's pre-publish checklist.
2. **Saraswati operator hits T1 mid-deploy.** Window is small (Vercel deploys are <2 min) but still possible. Mitigation: pre-announce to operator; have a rollback ready (the prior shared-types pin still works for K-12 schools, so the existing K-12 paths aren't blocked even on rollback).
3. **F-CONFIG-1a (T4) breaks frontend prefetch path that we haven't located yet.** Mitigation: the abandonment-wizard repro on UAT will surface the prefetch site if it exists. Fix in same PR.
4. **F-CONFIG-2 (T5) deletes a row we shouldn't.** Mitigation: dry-run mandatory; cross-check that target row's schoolId has NO METADATA row before deletion (not just absent at scan time but confirmed via direct GetItem).
5. **shared-types-pin-drift across the monorepo** — multiple workspaces pin different versions today. T1 forces a rebump everywhere. Risk is missed workspace = stale resolution. Mitigation: grep for `@aibrains/shared-types` across the repo as part of the bump PR; bump every found pin.
6. **Frontend-form-fix deploy timing.** edforge-saas-frontend deploys via Vercel on git push to main; if UAT validation reveals a regression, roll back via Vercel's previous-deploy promote (UI). Backend rollback per ECR procedure in CLAUDE.md.

## Strategic items DEFERRED (NOT in this sprint)

- **F-TRANSLATE-1** — canonical bidirectional grade-level translation module + ESLint rule. Post-pilot structural cleanup. Carries forward to a future sprint after the next pilot is live.
- **F-IEMIS-3** — `IEMIS_IMPORT_AUDIT` row per import. Audit-floor improvement; not pilot-blocking.
- **F-SCHOOL-1** — reject regional fields on School create endpoint. CLAUDE.md rule enforcement; carry forward.
- **Manual student-create path audit** — out of audit scope; needs a separate investigation before any fix.
- **F-EDFI Title-Case audit** — adjacent finding from T7; do as part of T7 if it's quick (<5 min), defer otherwise.

## Done criteria (sprint-level)

The sprint is done when:

1. ✅ T1 shipped to prod (PRs #46/#45/#47/#48; merged 2026-05-12). Saraswati operator spot-check still pending (operator action).
2. ✅ T2 (F-IEMIS-1) shipped to prod (PR #49; deploy 340a8a2; two scheduled fires verified). T3 (F-IEMIS-2) DISSOLVED — already shipped in earlier sprint, regression test pins behavior.
3. ☐ T4 + T5 shipped to prod; abandonment-wizard scenario (verify via `dev-pabson-primary`) produces zero orphans; prod orphan count is 0.
4. ☐ T6 shipped to prod; Curriculum tab Students column shows realistic counts on a school with enrollments.
5. ☐ T7 shipped to prod; mapper snapshot tests green.
6. ☐ T8 + T9 shipped to prod (or formally deferred to next sprint with explicit decision).
7. ☐ Memory entry updated: `project_grade_level_fix_sprint_shipped.md` documenting which tasks landed, deploy log links, and any deferred items.
8. ☐ The audit's [docs/grade-level-audit/08-migration-and-fix-list.md](../grade-level-audit/08-migration-and-fix-list.md) marked with the per-fix landed status.

## Status snapshot

| ID | Title | Severity | Local | npm publish | PR | Prod | Validated |
|---|---|---|---|---|---|---|---|
| T1 | F-LEGACY-1 (+ T1.b Students-page filter) | HIGH | ✅ | ✅ 0.40.0 | ✅ #46 + #45 merged | ✅ edforge.app (frontend); backend ECR/ECS pending+gated | ✅ on preview + prod (Saraswati spot-check pending) |
| T2 | F-IEMIS-1 (janitor cron — CDK) | MEDIUM | ☐ | n/a | ☐ — | ☐ — | ☐ — |
| T3 | ~~F-IEMIS-2 (IEMIS Code validate)~~ — **DISSOLVED** (already shipped in Midnight Lockin P0.6 / Sprint C3) | MEDIUM | n/a | n/a | n/a | already in prod | ✅ unit test pins it (iemis-transform.spec.ts:192) |
| T4 | F-CONFIG-1a (remove lazy fallback) | MEDIUM | ☐ | n/a | ☐ — | ☐ — | ☐ — |
| T5 | F-CONFIG-2 (orphan GC script) | MEDIUM | ☐ | n/a | ☐ — | ☐ — | ☐ — |
| T6 | F-CURRICULUM-2 (Students column) | MEDIUM | ☐ | n/a | ☐ — | ☐ — | ☐ — |
| T7 | F-EDFI-1 (namespace ECD/PPC — shared-types) | MEDIUM | ☐ | ☐ | ☐ — | ☐ — | ☐ — |
| T8 | F-LABEL-1 (dedupe label) | LOW | ☐ | n/a | ☐ — | ☐ — | ☐ — |
| T9 | F-AY-1 (auto-isCurrent) | LOW | ☐ | n/a | ☐ — | ☐ — | ☐ — |

**Backlog items surfaced during T1 (not in original audit):**

- **F-PERF-1** — `/api/academics/attendance/{overview,alerts}` returned 504 Gateway Timeout on first hit during dev-pabson-primary preview validation. Pre-existing performance issue. Most likely cold-start under `desiredCount=1` (post infra-sunset/6) OR N+1 query in attendance.service.ts. Re-test after backend deploy warms tasks.
- **`uat.edforge.app` stale alias** — Vercel domain alias still pointing at a pre-sunset deployment with the dead UAT Cognito client ID. Survived infra-sunset/3. Delete or repoint.
- **Env-var doc PR** — update `docs/infrastructure-sunset/sprint-4-vercel-env-update.md` to mark T4.3.3 (Preview env) done; document the `API_BASE_URL` Production-and-Preview fix that defused a latent time-bomb (Production deployment was working only because its routing manifest was baked when the env var had a value; ANY rebuild would have shipped a broken bundle).
- **F-FORM-DRIFT-1 (informal — picked up by T1.b but worth tracking)** — `StudentFilters.tsx` and `StudentsFilterRow.tsx` both had hardcoded inline `GRADE_LEVELS` arrays. The audit caught 6 components using `useFilteredGradeOptions`; this caught 2 more that didn't. F-TRANSLATE-1 (deferred from audit T8) is the right structural answer: ESLint rule forbidding ad-hoc grade-level literals.

## Pickup instructions for whoever's executing

1. Read this plan top to bottom.
2. Read [../grade-level-audit/README.md](../grade-level-audit/README.md) and [../grade-level-audit/08-migration-and-fix-list.md](../grade-level-audit/08-migration-and-fix-list.md) for context.
3. Spot-check the captures in [../grade-level-audit/artifacts/](../grade-level-audit/artifacts/) — particularly the orphan-config-rows.md and the course-form-grade-bug.md.
4. Branch from main: `git checkout -b sprint/grade-level-fix`.
5. Start with **T1**. Don't skip ahead — T1 protects the pilot and is the smallest task by code volume.
6. After each task, update the "Status snapshot" table with UAT + prod deploy log filenames.
7. Stop at "ready for human review" between UAT and prod for every task. **No prod deploys without explicit operator approval per CLAUDE.md house rules.**
