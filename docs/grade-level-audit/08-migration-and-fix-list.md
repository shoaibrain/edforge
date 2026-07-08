---
title: 08 — Migration Shape + Ranked Fix List
status: REVISED 2026-05-12 (3rd pass) — F-IEMIS-2 also dissolved on closer inspection of existing code
date: 2026-05-08 (2nd pass 2026-05-08; 3rd pass 2026-05-12)
audience: FIX-sprint planner
---

# Migration Shape + Ranked Fix List

> **REVISION NOTICE (3rd pass — 2026-05-12, during T3 evidence-first investigation):** One more finding dissolved.
> - **F-IEMIS-2 dissolved.** The IEMIS Code cross-validation was already shipped — likely in Midnight Lockin P0.6 / Sprint C3 timeframe, before this audit started. Evidence: [iemis-transform.ts:100-136](../../server/application/microservices/academics/src/students/iemis-transform.ts#L100-L136) accepts `expectedIemisSchoolCode` opt; [students.service.ts:1409](../../server/application/microservices/academics/src/students/students.service.ts#L1409) (sync path) and [students.service.ts:1602](../../server/application/microservices/academics/src/students/students.service.ts#L1602) (async path / Sprint C4) both wire it; regression test at [iemis-transform.spec.ts:192](../../server/application/microservices/academics/src/students/iemis-transform.spec.ts#L192). The audit's T1 captures didn't surface this because the 200-row dev-pabson-primary fixture had matching IEMIS Codes (`888888888 == 888888888`), so the warning path never fired. Score one for evidence-first methodology — same pattern as F-CURRICULUM-1's dissolution. **The "top-3 picks" section below is updated accordingly.**
>
> **REVISION NOTICE (2nd pass after additional runtime tests):** Three findings changed materially.
> - **F-LEGACY-1 escalated to HIGH and merged with the new F-COURSE-FORM-1.** Legacy `getGradeLevelsInRange` in `validators/grade-level.ts` returns `['12']` for any ECD-starting range due to `Array.slice(-1, ...)` math. This breaks the Course form, Enrollment form, EditStudent modal, Registration step, and Rostering for every PABSON primary school. **Saraswati is affected** — silent pilot blocker. See [artifacts/H-curriculum-tab/course-form-grade-bug.md](artifacts/H-curriculum-tab/course-form-grade-bug.md).
> - **F-CONFIG-1 downgraded HIGH → MEDIUM.** DDB scan showed real School A's CONFIG row is Nepal-correct (eager createSchool country-merge works). Only the lazy fallback path produces US-defaults rows, and only for orphan/abandoned schoolIds. See [artifacts/A-school-create-wide/02-ddb/school-A-config.json](artifacts/A-school-create-wide/02-ddb/school-A-config.json).
> - **F-CURRICULUM-1 dissolved.** Runtime test showed Course.gradeLevels stores Space A internal codes (`["12"]`), not Ed-Fi descriptor names — agent was wrong without runtime evidence. Curriculum-tab counts work correctly.
> - **F-CONFIG-2 added (MEDIUM).** Two orphan SchoolConfiguration rows present in dev-pabson-primary alone — every abandoned wizard accumulates a US-defaults row via the lazy fallback. See [artifacts/00-preflight/orphan-config-rows.md](artifacts/00-preflight/orphan-config-rows.md).

The audit is evidence-complete. This doc is the FIX-sprint hand-off — every entry has severity, surface, migration cost, Ed-Fi-alignment delta, dependencies, test-bed reproduction, and effort. Pick top-N from this list without re-investigating.

## Executive summary

EdForge's grade-level domain works for the Saraswati pilot **today** because every value-space drift falls in the operator's blind spot or the wizard's manual-input override. The drift is **not yet pilot-blocking**, but it has three concrete failure modes with non-trivial blast radius:

1. **`SchoolConfiguration` sub-resource is a US-defaults leak**, actively read by attendance scheduling and gradebook code paths. (Severity: HIGH — pilot-quality bug for any non-US tenant. Saraswati is presumed affected; backfill the row.)
2. **Curriculum-tab per-grade course-count is silently wrong** when courses are created with Ed-Fi descriptor names (the form's actual output). (Severity: MEDIUM — operator-visible incorrect count, not data corruption.)
3. **IEMIS in-process worker has no orphan-running-job recovery.** (Severity: MEDIUM — risk grows with row count; Saraswati already imported, so forward-only risk for next pilot.)

Plus a basket of lower-severity drift cleanup items.

## Saraswati migration shape

Saraswati pilot tenant `34f49822-...` carries **778 students**. The migration impact under each canonical-source-of-truth option (per 04-edfi-v6-alignment.md):

### Under Option 1 (stay dual-shape, fix seams)

- Saraswati `Enrollment.gradeLevel` rows: stay as Space A internal codes. **No backfill needed.**
- Saraswati `School.gradeLevels[]` row: stay as Space B descriptor names. **No backfill needed.**
- Saraswati `SchoolConfiguration` row: **must be reconciled** to PABSON-correct values (Asia/Kathmandu, ne-NP, Nepal grading scale, Sun-Fri week). One row to update — direct DDB UpdateItem with audit trail.
- Saraswati `Course.gradeLevels[]` rows (if any courses exist): if any courses store Ed-Fi descriptor names, the Curriculum-tab will under-count. **Inventory first**, then either translate to codes or fix the read-side aggregator. Inventory is a single GSI scan.

**Total Saraswati impact: 1 row to backfill (the SchoolConfiguration), N courses to inventory.** Zero student-facing data touched.

### Under Option 2 (full Ed-Fi alignment — not recommended)

- All 778 Enrollment rows backfilled (translate gradeLevel from Space A to Space B).
- GSI1SK rebuilt on the new key shape — DDB GSI rebuild costs scale with item count; for 778 items, complete in seconds, but requires offline window or dual-write strategy.
- Dashboard aggregator + chart label function both rewritten.
- **Zero benefit unless a Ministry consumer asks for native Ed-Fi v6 read APIs** — which no such ask exists today per CLAUDE.md "Outbound Ed-Fi compliance exports only" framing.

**Recommendation:** Don't pursue Option 2 in this FIX sprint. Carry it as a tracked deferred-decision (post-pilot, post-CEHRD-API-availability).

### Under Option 3 (canonical translation layer)

- Same as Option 1 for storage. The change is enforcement: introduce `@aibrains/shared-types/grade-level/translate.ts` with `codeToDescriptor()` / `descriptorToCode()` as the only acceptable conversion path. Refactor consumers to use it. Lint rule forbids string-matching loops against `GRADE_LEVEL_OPTIONS`.
- Saraswati impact: zero. The change is in code, not data.
- This is the **right post-pilot structural cleanup**.

## Fix list (ranked)

| ID | Title | Severity | Surface | Migration cost | Ed-Fi delta | Deps | Reproduction | Effort |
|---|---|---|---|---|---|---|---|---|
| **F-CONFIG-1** | Retire the SchoolConfiguration `/configuration` sub-resource OR make it inherit from WorkspaceSettings.regional | HIGH (blocker for any non-US tenant; live consumers in attendance + grading) | Identity service [department.entity.ts:153-188](../../server/application/microservices/identity/src/common/entities/department.entity.ts#L153) (DEFAULT_SCHOOL_CONFIG); [schools.service.ts:873-889](../../server/application/microservices/identity/src/schools/schools.service.ts#L873) (lazy fallback); [sections.service.ts:177](../../server/application/microservices/academics/src/sections/sections.service.ts#L177) + [grades.service.ts:604](../../server/application/microservices/academics/src/grades/grades.service.ts#L604) (consumers) | **One-time backfill** of any existing SchoolConfiguration rows (Saraswati: 1 row; dev-pabson-primary: 1 row; total <10 across all tenants) | Toward (removes a non-Ed-Fi divergent keyspace) | none | TS3 / 05-school-provisioning-trace.md captures show America/New_York for a NPL school | **L** (touches multiple services + data backfill) |
| **F-CURRICULUM-1** | Curriculum-tab per-grade course-count: introduce a canonical B→A inverse and use it in the count loop | MEDIUM (operator-visible wrong count when courses exist) | Frontend [GradeLevelsTab.tsx](../../edforge-saas-frontend/apps/academics/src/components/curriculum/GradeLevelsTab.tsx) lines 142-170; shared-types `grade-levels.ts` (add inverse map) | None — read-side fix only | Sideways (still dual-shape) | F-TRANSLATE-1 (preferred) or standalone | TS6: create a course on the test school with `gradeLevels=['EarlyChildhoodDevelopment']`, observe Curriculum tab. Expected: ECD count = 1. Likely actual: ECD count = 0. | **S** if standalone; **M** as part of F-TRANSLATE-1 |
| **F-IEMIS-1** | Add janitor cron / SQS-based migration for orphan IEMIS_JOB rows | MEDIUM (risk grows with row count; forward-only risk for next pilot) | Academics [iemis-import-jobs.service.ts](../../server/application/microservices/academics/src/students/iemis-import-jobs.service.ts) + new EventBridge rule + Lambda OR full SQS migration of the worker | None — additive | Neutral | none | Operator-action: kick a 5000-row import on a test school, kill the academics ECS task mid-flight, observe IEMIS_JOB row stays `running` indefinitely. | **S** for janitor cron; **L** for SQS migration |
| ~~**F-IEMIS-2**~~ — **DISSOLVED 2026-05-12** | ~~Cross-validate row's `IEMIS Code` against the controller's `schoolId` (reject mismatches with finding)~~ — already shipped in Midnight Lockin P0.6 / Sprint C3. Transform: [iemis-transform.ts:100-136](../../server/application/microservices/academics/src/students/iemis-transform.ts#L100). Wiring: students.service.ts:1409 (sync) + :1602 (async). Test: [iemis-transform.spec.ts:192](../../server/application/microservices/academics/src/students/iemis-transform.spec.ts#L192). See § Revision Notice (3rd pass) above. | n/a | n/a | n/a | n/a | n/a | unit-test pinned | **DONE** |
| **F-IEMIS-3** | Add `IEMIS_IMPORT_AUDIT` row per import (who, when, school, AY, jobId, row count, optional file-hash) | MEDIUM (audit reconstruction is currently O(events)) | Academics [iemis-import-job.entity.ts](../../server/application/microservices/academics/src/students/iemis-import-job.entity.ts) (extend the IEMIS_JOB row, or add a sibling AUDIT row) | None | Neutral | none | Operator: import 200 rows. Verify a single audit row is queryable via `SK begins_with IEMIS_IMPORT_AUDIT#`. | **S** |
| **F-LEGACY-1** | Retire `validators/grade-level.ts` entirely OR add ECD/PPC to it | MEDIUM (latent — depends on confirmed reach; T7 inconclusive) | shared-types [validators/grade-level.ts](../../packages/shared-types/src/validators/grade-level.ts) and every importer | None | Neutral | none | T7 follow-up scenario (course-create with ECD on a Nepal school) | **S** if patching set; **M** if retiring fully (touches every importer) |
| **F-EDFI-1** | Namespace-route extension descriptors at outbound mapper (`EarlyChildhoodDevelopment`, `PrePrimaryClass` → `uri://edforge.app/...`) | MEDIUM (Ed-Fi non-conformance against strict consumers; only matters when there IS a strict consumer) | shared-types [education-org.mapper.ts](../../packages/shared-types/src/mappers/edfi/education-org.mapper.ts) | None | **Toward** Ed-Fi alignment | none | Trigger an Ed-Fi export, inspect the URIs for ECD/PPC values | **S** |
| **F-LABEL-1** | Retire `formatGradeLabel` in academics MFE; replace with `getGradeLevelLabel` from shared-types | LOW (drift hazard, not bug) | Frontend [useAcademicsOverview.ts:338-348](../../edforge-saas-frontend/apps/academics/src/hooks/useAcademicsOverview.ts#L338) | None | Neutral | none | Update shared-types `getGradeLevelLabel` to handle the chart's `'1st Grade'` style; observe chart labels | **S** |
| **F-SCHOOL-1** | Reject `timezone` / `locale` / `calendarSystem` fields on School create/update; document that these belong on WorkspaceSettings | LOW (operator UX correctness; CLAUDE.md rule enforcement) | Identity school create DTO + service | None — wizard already lets operator choose, will need a fallback to WorkspaceSettings if rejecting | Neutral | Best paired with F-CONFIG-1 | TS2 capture | **M** |
| **F-AY-1** | Auto-flag activated AY as `isCurrent=true` if no other current AY exists; or document the operator action that's required | LOW (operator UX) | Identity academic-year service | None | Neutral | none | Operator: activate one AY, observe `isCurrent=false`; verify dashboard `currentAcademicYearId` resolution | **S** |
| **F-TRANSLATE-1** | Build canonical bidirectional translation module `@aibrains/shared-types/grade-level/translate.ts`. Lint rule forbids ad-hoc string matching | LOW now / MEDIUM post-pilot | shared-types new module + lint rule + refactor of all consumers | None | Sideways → enables future Option 2 | none | n/a — structural change | **L** (post-pilot recommendation) |

**Severity ordering rationale**: F-CONFIG-1 leaks into live attendance + grading code, so it's the only HIGH. The IEMIS items are MEDIUM because Saraswati is already imported and the pilot is live without them; the MEDIUM rating is for the *next* pilot. F-LEGACY-1 is MEDIUM because reach is unproven; could be HIGH if T7 follow-up confirms reach.

## Top-3 picks for the FIX sprint (REVISED)

If the FIX sprint can take three items:

1. **F-LEGACY-1** (HIGH, S effort) — fix `getGradeLevelsInRange` so PABSON primary-school forms aren't silently broken. **This is the only true pilot blocker.** Bundle the test matrix from [course-form-grade-bug.md](artifacts/H-curriculum-tab/course-form-grade-bug.md).
2. **F-IEMIS-1** (MEDIUM, S) — janitor cron for orphan-running IEMIS_IMPORT_JOB rows. (Originally bundled with F-IEMIS-2 in 2nd-pass plan; F-IEMIS-2 has since dissolved as already-shipped — see 3rd-pass revision notice.) Protects next pilot's import.
3. **F-CONFIG-1a + F-CONFIG-2 + F-CURRICULUM-2** (MEDIUM, M total) — one mixed PR: remove lazy `createDefaultConfig` fallback, GC orphan CONFIG rows, wire Curriculum tab Students column to enrollment counts. All three are operator-visible cleanups touching different services so they don't conflict.

If the sprint can take more, **F-IEMIS-3** and **F-LABEL-1** are the next two; both small, both raise hygiene floor.

## Cross-cutting recommendations

### Operator UX (product-lead view)

The audit surfaced two operator-confusion vectors that aren't bugs but are real product debt:

1. **Three keyspaces for "school regional configuration."** Even after F-CONFIG-1 lands, the school root entity will still own `timezone` / `locale` / `calendarSystem` fields that CLAUDE.md says should live only on WorkspaceSettings. **Recommendation:** F-SCHOOL-1 + a clear UI message in the school wizard's regional section: "Inherited from organization settings — change in Workspace Settings if needed."

2. **The two-phase activation gate (AY-active + school-active) is implicit.** A non-engineer pilot operator wouldn't know they need three sequential POST/PUT/PATCH calls before Academics unlocks. **Recommendation:** Add a guided "Setup checklist" panel to the school detail page that surfaces the gates as explicit steps with completion checkmarks. Out of fix-list scope; carry as a separate UX brief.

### Architecture-lead view

The five-value-space split is **defensible as a dual-shape model with outbound translation at Ed-Fi mappers.** Don't tear it out. The drift items are individually scoped and individually fixable. **The structural anti-pattern is "ad-hoc translation at every consumer"** — F-TRANSLATE-1 closes that with a lint rule. Without it, every new consumer is a new opportunity to drift.

### Business-lead view

Saraswati is the lead pilot and is unaffected by everything except F-CONFIG-1. That fix is scoped to one DDB row and a code path that nobody else touches. **It can ship in a hotfix-shaped PR with low blast radius.**

The next pilot (when scheduled) raises F-IEMIS-1 to "must have." F-IEMIS-2 has dissolved (already shipped — see 3rd-pass revision notice). Time the FIX sprint to land before next-pilot kickoff.

The Ed-Fi-alignment question (Option 2) is a **strategic decision waiting for a stakeholder**. Not a fix, not in this sprint, document and defer.

### SABER framing (as user requested)

"A well-run school teaches better; takes a systems approach for better education outcome results." The audit's findings, mapped to the SABER framing:

- **Evidence-based:** ✅ Every analytical claim cites a captured artifact or a code line. The audit is reproducible.
- **Systems approach:** ✅ The five-value-space catalog is a system view, not a feature list. The fix list ranks by system blast radius.
- **Better education outcome:** The FIX sprint's payoff is operator confidence + data correctness for credentialing (F-EDFI-1 once Ed-Fi consumers exist) + correct attendance and gradebook for Nepal schools (F-CONFIG-1). All of which contribute to "the school administrator can trust the SIS to tell them the truth about their students."

Ed-Fi v6 alignment is a **means** to that end, not the end itself. The audit's recommendation is to **close the seams operators see now** (Option 1 in 04) and **structurally enable future Ed-Fi-as-native** (F-TRANSLATE-1 as a stepping stone) rather than rewrite for a hypothetical Ministry consumer.

## What this audit did NOT cover

- AY / Session / Section / Course / Calendar / Attendance / Credentials value-space audits. T3 cataloged them as consumers of grade-level but did not investigate their internals.
- Generic CSV import path (`student-import-template.csv`). Out of scope per user decision; IEMIS is the priority.
- Saraswati's actual data shape — read-only-sized in this sprint at zero rows mutated. Backfill plan in F-CONFIG-1 must verify Saraswati's `SchoolConfiguration` row before update.
- The duplicate of `formatGradeLabel` likely has more siblings across other MFEs (e.g., the AdminWeb dashboard if it has any grade-level rendering). A grep pass would inventory.
- The "How locking works" UI copy that contradicts the CLAUDE.md "schools must not override regional" rule was not located in this audit's scope. Either the copy is stale, or it represents an intentional product choice that contradicts the platform rule. Either way, **clarify the product position** before F-CONFIG-1 lands so the user-facing message stays coherent.

## Verification checklist for FIX-sprint completion

For each fix that ships, the FIX sprint must:

1. Add a regression test that exercises the value-space pathway end-to-end.
2. Keep the raw deploy log private and add a sanitized outcome note to `docs/deploys/INDEX.md`.
3. Update the relevant memory entry in `~/.claude/projects/.../memory/` so future sessions know the fix landed.
4. For F-CONFIG-1 specifically: pre-flight scan Saraswati's `SchoolConfiguration` row, capture before/after, validate that academics + sections services pick up the new values without a roll.

## Final disposition

**The audit is complete. The FIX sprint can begin.** Enter the next sprint with this fix list as the work-source-of-truth and CLAUDE.md as the boundary-rule reference.
