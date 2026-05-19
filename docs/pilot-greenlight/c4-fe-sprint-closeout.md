# Sprint C4-FE — Closeout

**Date:** 2026-05-18
**Status:** ✅ Sprint goal achieved — Saraswati pilot operator activated school in prod end-to-end
**Predecessor plan:** [`c4-fe-sprint-plan.md`](./c4-fe-sprint-plan.md)
**Predecessor audits:** [`c4-fe-vocabulary-audit.md`](./c4-fe-vocabulary-audit.md)

---

## TL;DR

The sprint's defining goal — *"a fresh PABSON-archetype calendar can be set up end-to-end without engineer involvement"* — is met **and proven by real pilot data**. Saraswati School (tenant `34f49822-...`) activated their school in prod on 2026-05-18 after the operator completed setup through the UI, with one supervised intervention (the GradingPeriod backfill + PR #129 which closed that gap for every future tenant).

Three pull requests + one production data-fix landed:

| ID | Repo | What |
|---|---|---|
| #128 | server | PR A — shared-types schema fix (4 block fields on `calendarDateResponseSchema`) + entity-vs-schema contract test (46 cases) + identity serializer projection fix |
| #60 | edforge-saas-frontend | PR B — Calendar Blocks CRUD UI + curated single-day dropdown + grid overlay + Playwright spec |
| #129 | server | Saraswati follow-up — `createSession` auto-pairs GradingPeriod + `createAcademicYear` auto-promotes `isCurrent` for first AY (15 + 4 new tests) |
| (manual) | prod | Saraswati's school 4 GradingPeriod backfill + `PUT /set-current` to flip AY to `isCurrent=true` |

---

## Status against the original plan

### §0 — Architecture decisions (5/5 resolved before code)

| # | Decision | Status |
|---|---|---|
| 0.1 | Asymmetric `/calendar-blocks?schoolId=` route documented | ✅ JSDoc in `calendar-block.service.ts` |
| 0.2 | BS date handling industry-standard, ship as-is; 5 hygiene refinements deferred | ✅ |
| 0.3 | Shared-types drift fix bundled as PR A prerequisite | ✅ shipped as PR #128 |
| 0.4 | Playwright run target = `dev-pabson-primary` direct | ✅ confirmed; spec written |
| 0.5 | Option B scope confirmed (Blocks + curated dropdown) | ✅ |

### §3 — File-by-file plan

| # | File | Status | Notes |
|---|---|---|---|
| 3.0 | shared-types schema fix + contract test + consumer pin bumps | ✅ PR #128 | 46/46 contract tests; 0.50.0 → 0.51.0 |
| 3.1 | `calendar-block.service.ts` (FE API client) + asymmetric-route JSDoc | ✅ PR #60 | |
| 3.2 | `useCalendarBlocks.ts` hook + cache-invalidation | ✅ PR #60 | |
| 3.3 | `single-day-curated-options.ts` + tests | ✅ PR #60 | 33/33 tests; 11 curated keys |
| 3.4 | `BlocksPanel.tsx` (list + create-button) | ✅ PR #60 | |
| 3.5 | `BlockDrawer.tsx` (create/edit form) | ✅ PR #60 | |
| 3.6 | `CalendarStep` wiring + curated dropdown retrofit | ✅ PR #60 | |
| **3.7** | **Legacy `school-calendar.tsx` drawer retrofit** | ⚠ **Not done** | File is dormant (not routed); plan called it a "small ~30 LOC change for audit follow-up #2". Skipped. Documented as small finisher below. |
| **3.8** | **`useCalendar.ts` JSDoc** | ⚠ **Not done** | Plan called for a JSDoc comment near `useUpdateCalendarDate` noting the invalidation contract. Trivial. Documented as small finisher below. |
| 3.9 | Calendar grid block-overlay | ✅ PR #60 (slightly smaller scope) | Plan envisioned an inline "Dashain" label on the first day of each block run; shipped a `title` tooltip + a small purple dot indicator. Same operator-visibility outcome; less visual noise. |
| 3.10 | Playwright E2E spec | ✅ PR #60 (written, not executed) | 6-case spec at `e2e/tests/calendar-blocks.spec.ts`. Gated on `EDFORGE_PROD_JWT` env var. Not yet wired into CI — auth setup is a separate sprint per the "Three options" section of the plan. Manual smoke against `dev-pabson-primary` covered the equivalent surface via the Saraswati pilot. |

### §7 — Test plan results

| Suite | Result |
|---|---|
| **Vitest mapper unit tests** | 33/33 pass |
| **Jest contract test** (entity ↔ schema, calendar-date) | 46/46 pass |
| **Jest session auto-pair tests** (PR #129) | 15/15 pass |
| **Jest AY auto-promote tests** (PR #129) | 4 new pass; full suite 36/36 |
| **Frontend typecheck** | 21 errors on branch = 21 on main (zero new) |
| **Manual smoke against `dev-pabson-primary`** | Implicit — auto-pair smoke ran today, all 7 assertions green |
| **Real-pilot smoke against Saraswati prod** | Operator activated school via UI today (the strongest validation possible) |
| **Playwright E2E run** | Spec exists; not yet executed (auth setup deferred) |

### §8 — Deploy plan results

| Step | Result |
|---|---|
| `@aibrains/shared-types` 0.50.0 → 0.51.0 published | ✅ |
| Consumer pin bumps in lockstep (server, server/application, shell, pilot-fixtures) | ✅ |
| Identity ECR rebuilds | ✅ (3 total — PR A serializer, PR B was FE-only, PR #129) |
| Identity ECS rolls | ✅ all 3 rollouts PRIMARY=COMPLETED with `Nest application successfully started` boot verification |
| Vercel auto-deploy on PR B merge | ✅ |
| Post-deploy verification curls | ✅ all green |

---

## Items that surfaced in-flight and were resolved

These weren't in the original plan; surfaced during implementation/validation and shipped same-sprint:

1. **Serializer drift bigger than the audit found.** The audit identified that `calendarDateResponseSchema` was missing 4 fields. Verification curl exposed an additional layer: the identity service's hand-mapped `toCalendarDateResponse` projection also dropped them. Both fixed in PR A. Lesson logged: schema fix alone wouldn't have changed runtime behavior — Zod schemas validate input, they don't shape NestJS responses.

2. **Saraswati activation block.** Operator-driven UI created 4 Sessions but 0 GradingPeriods. Activation gate counts GradingPeriods (`entityType='TERM'`), not Sessions. Manually unblocked via 4 POST `/grading-periods` + 1 PUT `/set-current`. Fix landed as PR #129 — `createSession` auto-pairs GP and `createAcademicYear` auto-promotes first AY's `isCurrent`. Both backed by spec tests.

3. **NO_CURRENT_AY 404 storm.** Same Saraswati session: their AY was `status='active'` but `isCurrent=false`. Every `/academic-years/current` call was returning 404, silently breaking dashboards. Fixed in the same PR #129 — first AY now auto-promotes to `isCurrent=true` unless operator explicitly opts out.

4. **Frontend "Sessions/Terms" wizard step had an aspirational comment.** Line 776-777 of `AcademicSetupTab.tsx`: *"every session auto-creates a grading period at backend session-creation time"*. That claim was false pre-PR-129 and true post-PR-129. The code itself can stay; the documented contract now matches reality.

---

## Sprint exit: what to do with the two unchecked items

### Option A — Tiny finisher PR (~30 minutes)

Closes the loose ends to make the plan 10/10:

- **§3.7** — Retrofit the legacy `school-calendar.tsx` drawer dropdown to use `single-day-curated-options.ts`. The file is dormant (not routed), but this keeps the curated mapper exercised from both call sites per audit follow-up #2. Insulates against a future "let me re-route this page" change pulling in stale code. ~30 LOC.
- **§3.8** — Add the JSDoc comment to `useCalendar.ts` near `useUpdateCalendarDate` documenting the cache-invalidation contract. ~5 LOC.

Recommendation: **bundle as a single small frontend PR ("C4-FE plan closure — §3.7 + §3.8 loose ends")**. Time: 30 minutes. Demo-ready definition then becomes 100% met.

### Option B — Accept as-is, move both to backlog

Defensible because:
- §3.7 retrofits a file that isn't even routed.
- §3.8 is a 5-LOC JSDoc note.
- Sprint outcome (Saraswati activated) is met; further work has lower marginal value than starting the next sprint.

**My recommendation: Option A.** The 30-minute investment closes the audit contract (FE local mapper used from both call sites) and lets the sprint close at 100%. Better hygiene for the next time someone touches this code.

---

## Deferred follow-ups (explicit, in priority order)

Each is a focused small PR; none are pilot-blocking.

| # | Area | Why | Size |
|---|---|---|---|
| F1 | `updateSession` syncs dates to paired GradingPeriod | Currently if operator changes session dates, GP stays at old dates → exam dates can fall outside the GP's range | Small (~half day) |
| F2 | `deleteSession` cascade-deletes paired GP + adds `DELETE /grading-periods/:termId` route | Surfaced today: no DELETE route exists for GPs. Leaving orphan smoke artifact `PR129-SMOKE-DELETEME` in dev-pabson-primary | Small (~half day) |
| F3 | BS date picker hygiene PR (audit R1, R3, R4, R5) | Branded types, error-handling cleanup, boundary tests, dual AD/BS validation refinement | ~4.5 hours |
| F4 | COUNTRY_DEFAULTS sync-guard test extension to AdminWeb | Catches the 4th consumer in CI; addresses CLAUDE.md-noted duplication | ~2 hours |
| F5 | Entity-vs-schema contract test pattern for other entities | Apply the `calendar-date.contract.spec.ts` pattern to Staff, Student, AcademicYear, Term, BellSchedule, CalendarBlock | ~8 hours |
| F6 | Retire `scripts/pilot-greenlight/seed-pilot-terms.ts` | Now redundant with PR #129's auto-pair. Wait 1 week then delete the script and its sibling smokes | 30 min |
| F7 | Option C grading-period markers on grid (deferred from §3.9) | Visual decorators showing term boundaries on the month grid | ~1.5 days |
| F8 | Playwright E2E auth setup → CI integration | The C4-FE spec exists but needs Cognito-login storage-state setup to run against `dev-pabson-primary` from CI | ~2-3 hours |

---

## Memories to save from this sprint

(Already saved as memory entries — listed here for the closeout audit trail):

1. **Schema fix alone doesn't change runtime when the projection is hand-mapped.** Always verify the actual API response, not just the Zod type.
2. **Aspirational comments in code lie eventually.** The `SessionsStep` comment claiming auto-pair behavior persisted for weeks while the backend didn't implement it. Pilot operator was the first to hit the gap.
3. **First real operator finds bugs engineers don't.** Dev tenant smoke results don't catch ops paths that engineers manually patch with seeder scripts. The seeder scripts themselves are a symptom — they exist because the operator path was broken.
4. **Pilot-led validation > smoke-test-led validation.** Sprint plan called for a Playwright spec; sprint actually validated through the Saraswati operator hitting + reporting real bugs. Both have value; pilot wins on signal density.

---

## What this unblocks next

Saraswati's journey from now on:
1. ✅ AY created, marked current, 4 sessions + 4 paired GPs all in place
2. ✅ Calendar generated with PABSON holiday seed
3. ✅ Bell schedule (Nepal Standard Sun-Fri) applied
4. ✅ **School activated** (`canActivate: true` → operator clicked Activate today)
5. → **IEMIS XLSX student import** (next sprint focus)
6. → Operator data verification + UX feedback loop (2-3 weeks)
7. → IEMIS Sprint-related fixes as gaps surface
8. → Saraswati operationally live for AY 2083 (BS calendar starting Baisakh 1 ≈ mid-April 2026)

The next sprint focus is **IEMIS XLSX import path validation against real CEHRD-format data**. That's a separate planning + execution cycle; the C4-FE work is done.
