# EdForge — Pilot Greenlight Sprint Plan

> **Motto:** *Synthetic tests validate the happy path. Real pilot data validates operational reality.*
>
> **Goal:** Drive any pilot school from "registered fixture" → fidelity gate green → operator-led rehearsal green → live production. The first pilot to traverse this plan is **`pabson-saraswati-bs-2083`** — see [docs/pilots/pabson-saraswati-bs-2083/dossier.md](../pilots/pabson-saraswati-bs-2083/dossier.md) for pilot-specific facts.
>
> **Architecture stance:** The codebase contains **zero** references to any specific pilot. Pilots are data, loaded by a parametric loader from `packages/pilot-fixtures/pilots/<pilot-id>/`. Adding pilot 2 = drop a directory in, register it, run the suite. No engine changes, no test rewrites.

---

## 0. How to start (new chat session bootstrap)

If you are picking this up cold:

1. Read this entire document.
2. Read [docs/pilots/pabson-saraswati-bs-2083/dossier.md](../pilots/pabson-saraswati-bs-2083/dossier.md) — first pilot's facts.
3. Read the v2 plan invariants ([docs/edforge-pabson-sprint-plan.md](../edforge-pabson-sprint-plan.md) §J) — bright-line rules.
4. Memory entries to load: `project_pilot_greenlight_plan`, `project_s3_2_gsi_casing_shipped`, `feedback_pr_first_no_more_uat`, `edforge_api_gateway_route_registration`, `edforge_shared_types_caret_pin`.
5. **First sprint to pick up:** see §0.5 Status snapshot below. As of 2026-05-17 Phase B is closed (🟢 7/7 internal greenlight); **Sprint C3 — Pre-Greenlight Hardening** is the next major sprint.
6. Cut feature branches per CLAUDE.md house rules. Open PRs against `main`. Use the `deploy-analytics.sh` wrapper for any CDK deploy.

---

## 0.5 Status snapshot — 2026-05-17 (end-of-day)

**Phase B closed (morning) + Phase C complete (afternoon).** Sprint C3 fully shipped + validated in prod across six pilot-greenlight tickets and one hotfix. **Phase C is done; Sprint C4 (multi-day event blocks) is the next major sprint** — or pivot to Phase D (operational surface) depending on pilot priorities.

| Phase | Sprints | Status |
|---|---|---|
| **A. Foundation** | C0.a, C0.c, C0.e | ✅ C0.a done · ✅ C0.c done (deployed 2026-05-16) · 🔲 C0.e not started |
| **B. Calendar Fidelity Gate** ⭐ | C1, C2 | ✅ C1 done (8/8 tickets) · ✅ **C2 GREEN — harness 7/7 against `dev-pabson-primary` 2026-05-17** |
| **C. Pre-Live Hardening** | C3, C4 (+ C0.b parallel) | ✅ C0.b done · ✅ **C3 SHIPPED — 6 ticket-pairs + 1 hotfix deployed + validated 2026-05-17** · 🔲 C4 (multi-day event blocks) not started |
| **D. Operational Surface** | C5, C6, C7 | 🔲 not started |
| **E. Event-log completion** | C8 | 🔲 not started |
| **F. Year-End Centerpiece** | C9, C10 | 🔲 not started |
| **G. Compliance** | C11 | 🔲 not started |
| **H. Greenlight Rehearsal** ⭐ | C12 | 🔲 not started |
| **I. Production** | C13 | 🔲 not started |

### Phase B verdict — closed 2026-05-17 🟢

Pilot-greenlight harness, run 2026-05-17 against `dev-pabson-primary` (tenant `21aea5da-…`) on `0c39a7a`: **7 pass / 0 fail / 0 skipped.**

| Smoke | Result | Detail |
|---|---|---|
| **SETUP** — pilot term seeder | ✅ | idempotent; 4 Terms confirmed present |
| **C2.0** — write-path skeleton | ✅ | staff-training POST → IEMIS audit row verified → DELETE cleanup |
| **C2.1** — instructional-days | ✅ | exact match all 4 terms: 77/77, 66/66, 62/62, 67/67 |
| **C2.2** — shift-profile parity | ✅ | 30/30 sampled dates: backend classification === fixture |
| **C2.3** — exam-window containment | ✅ | **40 exam-window days across 4 terms, all present + single `sourceTermId` per term** |
| **C2.4** — holiday exclusion | ✅ | 32/32 — `DATE_NOT_INSTRUCTIONAL` on 8 non-instructional dates with correct `details.reason` |
| **C2.5** — edge cases | ✅ | 6/6 — AY boundary, 3× outside-AY 404, mid-vacation, day-after-program |

**Final run log:** [`docs/deploys/prod-pilot-greenlight-G4-20260517-055018-0c39a7a.log`](../deploys/prod-pilot-greenlight-G4-20260517-055018-0c39a7a.log)

### Path to verdict (chronology 2026-05-17)

1. **G1 — identity ECR + ECS roll ✅.** New image `sha256:2433e16207ef` pushed; task `0da651b376b1…` healthy on `prod-basic/identitybasic`. Picks up PRs #104 (Leave cancel 500 fix) + #106 (shortName uniqueness 409) + #107 (`schoolTypeDescriptor` enum tightening).
2. **G2 — C0.b.2 cleanup `--apply` ✅.** `TempC0bDdbWrites` inline policy attached → `s3-2-smoke-artifacts.ts --apply` against `21aea5da-…` deleted 6 marker rows (3 calendar `S32-SMOKE-*` + 3 leave `S3.2 smoke`) → policy detached.
3. **G3 — C0.b.5 migration `--apply` ✅.** Same policy cycle → `testing-day-to-exam-window.ts --apply` → **0 rows affected** (no legacy `testing_day` events in prod; idempotent confirmed) → policy detached.
4. **G4 — harness ⚠️ then 🟢.** First run failed C2.3 (and C2.2 partially) because pre-existing **Term 1 endDate was 2026-07-14 vs fixture-canonical 2026-07-16** (BS 2083/03/32). Single PATCH to `/grading-periods/<term1Id>` widened `endDate` + set the fixture exam window `(2026-07-08 → 2026-07-16)`; `syncExamWindowEvents` auto-created the 9 missing `exam_window` CalendarDate rows. Re-run with `AWS_PROFILE=prod` (C2.0 needs DDB creds for audit-row verification): **7/7 🟢.**

### Followups (small, non-blocking)

- **Orphan staff training row** in `dev-pabson-primary` from the C2.0 cred-failure run (before the AWS_PROFILE re-run) — script's cleanup block was skipped on early-exit. Track as a one-off DELETE; not blocking.
- **C2.0 script hygiene** — wrap the AWS-SDK section in try/catch + skip-with-warning path so missing creds emit a graceful skip instead of an aborted run that orphans the training row.

### Sprint C3 — closed 2026-05-17 (afternoon) 🟢

All six C3 ticket-pairs shipped + validated in prod, plus one hotfix from the C3.5 post-deploy smoke. Detail in [`docs/deploys/INDEX.md`](../deploys/INDEX.md#2026-05-17--sprint-c3-closeout--c34--c35--hotfix--c32--c33).

| Ticket | PR(s) | Deploy artifacts | Validation |
|---|---|---|---|
| C3.1 phase 1 (diagnosis) | [#113](https://github.com/shoaibrain/edforge/pull/113) | docs only | n/a |
| C3.1 phase 2 (bulk-scan) | [#114](https://github.com/shoaibrain/edforge/pull/114) | academics ECR + roll | harness 7/7 + `/alerts` smoke 200 |
| C3.7 (BS↔AD roundtrip) | [#112](https://github.com/shoaibrain/edforge/pull/112) | shared-types 0.45.0 | 1095 roundtrip assertions in CI |
| C3.6 + C3.8 (BS inputs + merge mode) | [#115](https://github.com/shoaibrain/edforge/pull/115) | 0.46.0 + identity roll | post-roll harness 7/7 |
| C3.4 + C3.5 (bell presets) | [#116](https://github.com/shoaibrain/edforge/pull/116) | 0.47.0 + CDK + identity roll | academic preset 201 + exam_day caught hotfix |
| C3.5 hotfix (validator dayType) | [#117](https://github.com/shoaibrain/edforge/pull/117) | 0.48.0 + identity roll | exam_day preset 201 with 180+120min blocks |
| C3.2 + C3.3 (holiday seeds) | [#118](https://github.com/shoaibrain/edforge/pull/118) | 0.49.0 + rproxy + CDK + identity roll | 3-smoke green (exact + 400 + none-fallback) |

**Numbers from the sweep:**
- 7 PRs merged in one day
- 5 `shared-types` publishes (0.45.0 → 0.49.0)
- 2 `shared-infra-stack` CDK deploys (`/bell-schedules/preset`, `/holiday-seeds`)
- 5 ECS rolls (academics×1, identity×3, rproxy×1)
- 0 prod regressions; one issue (C3.5 validator) was caught by the post-deploy smoke and fixed in a same-day hotfix
- Net new test coverage: **+58 specs** (shared-types 1591 → 1649 across the sprint)

### Then unlocks (per §7 dependency graph)

1. **Sprint C4 — Multi-Day Event Blocks** (next major sprint per §3). Or pivot to Phase D (operational surface — C5/C6/C7) depending on pilot urgency.
2. **C0.b operator gates** — ✅ all drained (G1/G2/G3 above).

### Retros captured for future sprint windows

- **Smoke caught what unit tests couldn't.** The C3.5 exam-day preset failed in prod against `validateBellSchedule`'s school-config-aware uniformity check — pure unit tests in shared-types had no school-config to violate. End-to-end smoke against a real-shaped tenant is irreplaceable. Lesson: every new endpoint that goes through any cross-module validator gets a prod smoke against `dev-pabson-primary`, not just unit tests.
- **Cognito's 1h TTL is shorter than a CDK + 2× ECS roll.** Saw this twice in this sweep — the JWT expired mid-deploy. Plan: capture the smoke JWT just before running the smoke, not at the start of the deploy.
- **`build-application.sh` CWD-fragility** held up across five rolls — `cd /Users/shoaibrain/edforge/scripts && ./build-application.sh <svc>` is the only invocation that works. Memory `project_grade_level_fix_T4_shipped` already captures this; reinforced.
- **Five back-to-back `npm publish`** cycles in one sprint. Each ticket-pair touched shared-types, and the next pair's PR couldn't merge until the previous publish landed. A consolidated publish at the end of a sprint window would have been less ceremonial — worth considering for future sprints that touch shared-types repeatedly.

---

## 1. Executive summary

The first pilot cannot be greenlit for live operations against synthetic data alone. The pivot this plan executes:

| Today | This plan |
|---|---|
| Tests use ad-hoc synthetic dates/events | Tests use the registered pilot fixtures as expected-result generators |
| Greenlight = "happy path covered" | Greenlight = read-path + write-path **both** validated against fixture, on a deployed prod-account dev tenant |
| Cross-year handoff is theoretical | Cross-year handoff explicitly models the provisional-enrollment window (when the next AY is active but prior-year results haven't published) |
| Domain events are partial / ad-hoc | EventBridge bus + schema registry land **before** the services that need them |
| Pilot-specific names litter the codebase | Pilot-agnostic engine; pilot-specific data lives only under `pilots/<pilot-id>/` and `docs/pilots/<pilot-id>/` |

Three structural decisions worth flagging:

1. **Read-path validation alone is insufficient for greenlight.** The five non-negotiable tests are all queries. Live operations are writes (student imports, enrollment, attendance, scores). The greenlight gate (C2) includes both a **write-path smoke** (C2.0) and the five read-path tests (C2.1-C2.5).
2. **Event emission foundation lands in C0.c**, before any sprint whose tickets emit events. Services emitting events before the registry exists violates invariant 6.
3. **No pilot-specific names in code** (invariant 13, §4). Code is pilot-agnostic; pilots are data. Tests use `describe.each(listPilots())`. Smokes accept `PILOT_ID` env var.

---

## 2. Phases and sprint outline

| Phase | Sprints | Outcome |
|---|---|---|
| **A. Foundation** | C0.a, C0.c, C0.e | Calendar-blocking verifications done; event emission infrastructure live; compliance declaration started |
| **B. Calendar Fidelity Gate** ⭐ | C1, C2 | Pilot fixture loadable via registry; write-path + 5 read-path tests pass — **internal greenlight** |
| **C. Pre-Live Hardening** | C3, C4 (with C0.b in parallel) | F-PERF-1 fixed; archetype-aware holiday seed live; multi-day event blocks; BS dates fully accepted |
| **D. Operational Surface** | C5, C6, C7 | Exam + period-attendance + result subsystems — pilot can run terms 1-3 |
| **E. Event-log completion** | C8 | Event-log entity + DLQ + staff.training migration (C0.c shipped the bus + schemas earlier) |
| **F. Year-End Centerpiece** | C9, C10 | Cross-year handoff (provisional window); annual external reporting submission |
| **G. Compliance** | C11 | Tenant export + DSAR + DR drill + cancellation state machine |
| **H. Greenlight Rehearsal** ⭐ | C12 | E2E hand-test on dev rehearsal **+ prod-shadow rehearsal** in prod account — **external greenlight** |
| **I. Production** | C13 | Pilot live + 30-day hypercare |

⭐ = critical gate; cannot skip.

---

## 3. Design principles

1. **Real data over synthetic.** Every integration test from C2 onward uses a registered pilot fixture as expected-result generator. No hand-crafted synthetic fixtures where a real one suffices.
2. **Atomic tickets.** Each ticket is one commit-sized change, one PR-sized scope, one validation pass. Multi-component tickets are split (a/b/c).
3. **Demoable per sprint.** A sprint that doesn't demo a behavior change didn't ship. Demos run against a registered pilot dev tenant.
4. **Three orthogonal layers preserved.** Academic Structure (terms/exam-windows/calendar spine) ⊥ Operational Schedule (shifts/bells) ⊥ Event Overlay (holidays/programs).
5. **Iteration over perfection.** Ship the first pilot live as soon as C12 passes. Observe → iterate on real edge cases. Don't pre-optimize for hypothesis.
6. **Pilot-agnostic code.** Pilot names appear in data files and pilot dossiers only. Engine code, tests, smokes, and CI artifacts must be pilot-agnostic.
7. **Architecture invariants are bright lines.** Every PR rejected on invariant violation, not just commented.

---

## 4. Architecture invariants (apply to every ticket)

Per [docs/edforge-pabson-sprint-plan.md](../edforge-pabson-sprint-plan.md) §J, extended with invariant 13:

1. `tenant_id` is the PK prefix on every row.
2. `(student, AY)` is the join key for "what grade is this student in".
3. Every academic record references `enrollmentId`, not raw `(studentId, date)`.
4. Every dated entity accepts BS or AD on input; canonical Gregorian on storage; both on response.
5. Every write goes through `auditedWrite()`.
6. Every domain action emits an event with a registry schema.
7. No silent fallbacks — explicit 404 + `errorCode`.
8. No code branches on `tenant.archetype` — only `archetypeDefaults` lookups.
9. Activation requirements come from archetype defaults.
10. Calendar regeneration defaults to non-destructive merge mode.
11. Ed-Fi extension namespace `edforge:` is the only place new descriptors land.
12. `grep -rn 'archetype' server/application/microservices/*/src/` returns zero hits in service code.
13. **No pilot-specific names in code.** `grep -rni '<pilot-name>\|<school-name>'` against `server/application/microservices/*/src/`, `packages/shared-types/src/`, `client/`, `edforge-saas-frontend/`, and `scripts/smoke-tests/` (excluding pilot-id env-var defaults) returns **zero hits**. Pilot data lives only in `packages/pilot-fixtures/pilots/<pilot-id>/` and `docs/pilots/<pilot-id>/`. A PR that introduces a pilot-named symbol in code is rejected.

A reviewer who spots a violation may **reject without further comment**.

---

## 5. Out of scope (explicit, do not re-litigate)

Per v2 plan §A1 + memory `feedback_pr_first_no_more_uat`:

- PDF generation (calendar export, ID card, TC, transcript)
- Notification delivery (SMS, WhatsApp, email, in-app) — events emit; delivery deferred
- Boarding / Hostel management subsystem
- Parent + Student portals (already partially built; not on V1 delivery path)
- Finance subsystem expansion (current C2.A/C2.B work is sufficient for V1)
- Multi-campus expansion in V1
- Additional archetypes (CBSE_IN, NAIS_US, GEMS_UAE) — dormant; placeholder data only
- Localization translation pass (lint stays; translation work deferred)
- UAT environment (sunset; only prod remains)

---

## 6. Sprint plans — ticket-by-ticket

Every ticket carries:
- **Files:** what changes, where
- **Validation:** test path or concrete check
- **AC:** acceptance criteria a reviewer can mechanically verify

### Sprint C0.a — Calendar-Blocking Verifications

**Status:** ✅ DONE (PRs [#70](https://github.com/shoaibrain/edforge/pull/70), [#71](https://github.com/shoaibrain/edforge/pull/71), [#72](https://github.com/shoaibrain/edforge/pull/72) closeout). C0.a.3 frontend BS dedupe lives in the separate `edforge-saas-frontend` repo — verification of that ticket not re-checked from server tree.

**Goal:** Verify prerequisites for calendar fidelity work are already in place. Anything not verified is fixed here.

- **C0.a.1** Verify S0.2 — `School.academicCalendarType` removed; AY-level `calendarType` is sole source.
  - Files: grep `academicCalendarType` across `server/application/microservices/identity/src/` + DTO schemas; integration test.
  - Validation: integration test asserts AY-level field is returned; School-level field is not.
  - AC: Field absent on Schools; AY.calendarType is authoritative; integration test green.

- **C0.a.2** Verify S0.4 — `calendarSystem` in `SchoolConfiguration` response.
  - Files: `server/application/microservices/identity/src/schools/configuration/`; integration test.
  - Validation: `GET /schools/:id/configuration` against any registered pilot's tenant returns `calendarSystem`.
  - AC: Response includes `calendarSystem`; matches `WorkspaceSettings.regional.calendarSystem`.

- **C0.a.3** D1.4 — BS converter dedupe in frontend.
  - Files: `edforge-saas-frontend/packages/date-utils/src/converter.ts` (delete local table); `edforge-saas-frontend/packages/date-utils/src/index.ts` (re-export from `@aibrains/shared-types`).
  - Validation: frontend roundtrip test BS↔AD.
  - AC: Single source of truth for BS table; frontend bundle size reduced.

**Demo:** `GET /schools/.../configuration` on a pilot dev tenant returns `calendarSystem`; School entity carries no `academicCalendarType` field; frontend roundtrip green using shared-types converter only.

---

### Sprint C0.c — Event Emission Foundation

**Status:** ✅ DONE — shipped + deployed to prod 2026-05-16. PRs [#73](https://github.com/shoaibrain/edforge/pull/73) (verify bus), [#74](https://github.com/shoaibrain/edforge/pull/74) (taxonomy: 25 Zod schemas), [#75](https://github.com/shoaibrain/edforge/pull/75) (consumer pin bump), [#76](https://github.com/shoaibrain/edforge/pull/76) (runtime validation in `EventServiceBase`), [#78](https://github.com/shoaibrain/edforge/pull/78) (deploy plan), [#79](https://github.com/shoaibrain/edforge/pull/79) (deploy closeout). Prod outcome: 32/33 smoke green (the 1 fail is pre-existing Leave cancel 500, picked up in C0.b.1).

**Goal:** EventBridge bus + schema registry + `emitEvent()` helper live **before** any sprint whose tickets emit events. Invariant 6 from day 1.

- **C0.c.1** EventBridge bus + schema registry per tenant.
  - Files: `server/lib/event-bus-stack.ts` (NEW); `server/bin/ecs-saas-ref-template.ts` (add stack dependency).
  - Validation: CDK synth diff; deploy to a dev tenant.
  - AC: Bus deployed; schema registry queryable; CloudWatch metrics emit.

- **C0.c.2** Domain event taxonomy spec.
  - Files: `packages/shared-types/src/events/taxonomy.ts` (NEW); per-domain TS files (`school.ts`, `academic-year.ts`, `term.ts`, `enrollment.ts`, `attendance.ts`, `exam.ts`, `result.ts`, `reporting.ts`, `calendar.ts`).
  - ~22 events: `school.{created,activated,updated,deactivated}`, `academic_year.{created,activated,completed}`, `term.{created,updated,exam_scheduled}`, `enrollment.{created,promoted,retained,withdrawn}`, `attendance.{recorded,updated}`, `exam.{created,closed,published}`, `result.published`, `reporting.{submitted,submission_due}`, `calendar.{block_created,block_updated,block_deleted}`.
  - Validation: unit tests on each schema; lint that every emitted event has a schema.
  - AC: Every event has Zod schema in registry; lint rule fails on schema-less emission.

- **C0.c.3** `emitEvent()` helper service.
  - Files: `server/application/microservices/common/services/event-emitter.service.ts` (NEW).
  - Validation: unit tests; lint asserts every `auditedWrite()` call site is paired with `emitEvent()`.
  - AC: Helper available across all microservices; lint enforces pairing.

**Demo:** Trigger `school.created` on a dev tenant. Event lands on bus with schema-validated payload. CloudWatch metric records emission. Lint fails on a deliberately schema-less commit.

---

### Sprint C1 — Pilot Canonical Fixture (engine + first pilot data)

**Status:** ✅ DONE — 8/8 tickets shipped. PRs [#80](https://github.com/shoaibrain/edforge/pull/80) (C1.0 workspace + registry), [#81](https://github.com/shoaibrain/edforge/pull/81) (C1.1 schema), [#84](https://github.com/shoaibrain/edforge/pull/84) (C1.2 12 month calendar files), [#86](https://github.com/shoaibrain/edforge/pull/86) (C1.3 bell-schedule), [#87](https://github.com/shoaibrain/edforge/pull/87) (C1.4 academic-structure), [#88](https://github.com/shoaibrain/edforge/pull/88) (C1.5 holidays-consolidated), [#89](https://github.com/shoaibrain/edforge/pull/89) (C1.6 programs), [#90](https://github.com/shoaibrain/edforge/pull/90) (C1.7 loader utility). Plus PR [#83](https://github.com/shoaibrain/edforge/pull/83) bumped shared-types to 0.44.0.

**Goal:** Establish a parametric pilot-fixtures package + register the first pilot. Engine knows zero pilots; pilots are data dropped under `pilots/<pilot-id>/`.

**Note:** Fixtures live in a **workspace-only** package (`packages/pilot-fixtures/`), **not** in `@aibrains/shared-types`. Avoids the AdminWeb publish-gate gotcha and keeps shared-types clean for cross-service contracts.

- **C1.0** Pilot registry pattern (NEW per invariant 13).
  - Files: `packages/pilot-fixtures/package.json` (NEW workspace); `packages/pilot-fixtures/src/pilot-registry.ts` (NEW); `packages/pilot-fixtures/src/types.ts` (NEW); `packages/pilot-fixtures/pilots/<pilot-id>/metadata.json` (one per registered pilot).
  - `pilot-registry.ts` exports `listPilots(): Pilot[]` and `loadPilot(pilotId): Pilot`.
  - `metadata.json` schema: `{ pilotId, archetype, country, calendarSystem, primaryAcademicYearId, gradingScale, status }`.
  - Validation: unit test — registry returns at least one pilot when one is registered; throws `PILOT_NOT_FOUND` for unknown id.
  - AC: Adding pilot 2 = drop directory + add metadata.json + one line in a registry index file (or auto-discover via fs glob). No code changes elsewhere.

- **C1.1** Calendar fixture JSON schema (generic).
  - Files: `packages/pilot-fixtures/src/schema/calendar-fixture.schema.json` (NEW).
  - Validation: jest schema-compile test; validates empty doc; fails on missing required fields.
  - AC: Schema covers month → date → eventType + eventName + metadata; passes ajv strict-mode.

- **C1.2** Register first pilot data — per-month event files (12 JSON files).
  - Files: `packages/pilot-fixtures/pilots/pabson-saraswati-bs-2083/calendar/{baisakh,jeth,asar,saun,bhadau,asoj,kartik,mangsir,pus,magh,fagun,chait}.json` (12 NEW).
  - Source: pilot dossier (printed calendar evidence in `docs/pilots/pabson-saraswati-bs-2083/dossier.md`).
  - Validation: jest counts per-month match dossier-declared totals.
  - AC: All 12 month files pass schema; per-month event counts match dossier.

- **C1.3** Bell schedule fixture.
  - Files: `packages/pilot-fixtures/pilots/pabson-saraswati-bs-2083/bell-schedule.json` (NEW).
  - Schema covers `shifts: [{ id, name, scope, periods: [{ id, startTime, endTime }] }]` + optional `examDayShifts` variant.
  - The pilot may declare multiple shifts (e.g., a boarding-routine shift outside academic operations); the `scope` field marks academic vs non-academic.
  - Validation: jest schema test + no overlapping periods within a shift.
  - AC: JSON validates; all declared shifts well-formed; comments document scope distinctions.

- **C1.4** AY academic structure fixture.
  - Files: `packages/pilot-fixtures/pilots/pabson-saraswati-bs-2083/academic-structure.json` (NEW).
  - Schema: terms with start/end + exam-window per term + AY boundary + cross-year markers (result-publish date in next AY, new-session-begin date in next AY).
  - Validation: jest assert per-term inclusive day counts match dossier.
  - AC: Schema validates; dates match dossier; cross-year markers explicit.

- **C1.5** Holiday consolidation fixture.
  - Files: `packages/pilot-fixtures/pilots/pabson-saraswati-bs-2083/holidays-consolidated.json` (NEW).
  - Categorize: national / religious / school-specific. Multi-day blocks tagged with explicit start+end.
  - Validation: jest count = dossier-declared total.
  - AC: Every holiday categorized; blocks identified; total day count matches dossier.

- **C1.6** Programs / events fixture.
  - Files: `packages/pilot-fixtures/pilots/pabson-saraswati-bs-2083/programs.json` (NEW).
  - Each program: BS/AD date + category + `sourceTermId` where applicable. Cross-year markers separated as a top-level field.
  - Validation: jest count matches dossier.
  - AC: Schema validates; counts match.

- **C1.7** Fixture loader utility (parametric).
  - Files: `packages/pilot-fixtures/src/loader.ts` (NEW); `packages/pilot-fixtures/src/index.ts` (NEW exports).
  - Exports: `loadPilot(pilotId)`, `expandBlocks(pilot)`, `expandHolidays(pilot)`, `eventsOnDate(pilot, date)`, `instructionalDaysInRange(pilot, range, schoolDaysCfg)`, `shiftProfileForDate(pilot, date)`.
  - Validation: unit tests against the registered first-pilot fixture; multi-event days correctly handled.
  - AC: Typed; multi-event days correct; reference docs (README in the package).

**Demo:** CLI helper `npx ts-node packages/pilot-fixtures/bin/print-day-summary.ts --pilot pabson-saraswati-bs-2083 --date 2083-07-06` prints all events on that date. Count summary across the year matches dossier exactly. Calling `loadPilot('non-existent')` throws `PILOT_NOT_FOUND`.

---

### Sprint C2 — Greenlight Gate (Write-path + Five Non-Negotiable Read Tests)

**Status:** ✅ **GREENLIGHT GATE CLOSED 🟢 2026-05-17.** Code SHIPPED 2026-05-16 (PRs [#91](https://github.com/shoaibrain/edforge/pull/91)–[#101](https://github.com/shoaibrain/edforge/pull/101)). Harness verdict on `dev-pabson-primary` (tenant `21aea5da-…`) on `0c39a7a`: **7 pass / 0 fail / 0 skipped** (SETUP + C2.0 + C2.1–C2.5). Final-green log: [`docs/deploys/prod-pilot-greenlight-G4-20260517-055018-0c39a7a.log`](../deploys/prod-pilot-greenlight-G4-20260517-055018-0c39a7a.log). Path to verdict + followups in §0.5.

**Goal:** All 5 non-negotiable read tests **plus** a write-path smoke pass against the deployed service using a registered pilot's fixture. This is the **internal greenlight** gate.

**Important constraint:** Every test in this sprint MUST run against a **deployed dev tenant** via HTTP, not in jest-isolation against an in-memory service. The harness (C2.6) provisions the tenant in `beforeAll`. Synthetic-to-real pivot fails if these tests slip back into mocks.

All tests parametrize over `listPilots()` so adding pilot 2 expands coverage automatically.

- **C2.0** Write-path smoke (closes critical gap).
  - Files: `scripts/smoke-tests/pilot-write-path.ts` (NEW). Accepts `PILOT_ID` env var.
  - Provisions dev tenant; seeds AY from the pilot's fixture; bulk-imports 50 students (mix of grades from the pilot's gradeLevels); enrolls them; marks 1 day of period attendance for one section.
  - Validates: no 5xx; every write produces an audit row; every write emits the expected event per taxonomy.
  - AC: Smoke exits 0 for each registered pilot; write count = expected; audit count = write count; event-log count = write count.

- **C2.1** Test 1 — Academic period queries return exact operating days.
  - Files: `server/application/microservices/academics/src/__tests__/pilot-operating-days.integration.spec.ts` (NEW).
  - `describe.each(listPilots())` — for each pilot, for each term in the pilot's academic-structure, HTTP call `GET /academic-years/.../instructional-days?from=<termStart>&to=<termEnd>`.
  - Expected counts computed from pilot fixture via `instructionalDaysInRange()`.
  - Validation: jest integration test; HTTP call (not in-memory).
  - AC: For each pilot × each term: actual count = expected count; excludes weekends + holiday blocks + vacations.

- **C2.2** Test 2 — Shift resolution for any given day.
  - Files: same integration suite (extended).
  - For each pilot, 30 sampled dates (10 regular school + 10 exam-window + 10 weekend/holiday). HTTP call `GET /schools/:id/shift-profile?date=<date>` returns expected shift profile.
  - Validation: jest integration.
  - AC: For each pilot × each sample: profile matches expected.

- **C2.3** Test 3 — Exam period containment.
  - Files: same integration suite.
  - For each pilot × each exam window: every date in window has `exam_window` event with correct `sourceTermId`; no date outside has it.
  - Validation: jest integration HTTP.
  - AC: All exam windows × inclusive-exclusive correct.

- **C2.4** Test 4 — Holiday exclusion in operational calculations.
  - Files: same integration suite.
  - For each pilot × each multi-day holiday block:
    - `instructionalDays` excludes them.
    - Attempt to POST attendance on a holiday → 400 with `errorCode: DATE_NOT_INSTRUCTIONAL`.
    - Bell schedule resolution returns "school closed" profile.
  - Validation: jest integration HTTP.
  - AC: All blocks × all three assertions.

- **C2.5** Test 5 — Shift transition edge cases.
  - Files: same integration suite.
  - For each pilot, 6+ edge cases derived from pilot's academic structure: AY boundary day, next-AY day-1, next-AY result-publish day, next-AY new-session-begin day, mid-vacation day, day after a school-specific program day.
  - Validation: jest integration HTTP.
  - AC: Edge cases assert correctly with explicit per-case ACs.

- **C2.6** Pilot-data E2E harness (parametric).
  - Files: `scripts/smoke-tests/pilot-greenlight.ts` (NEW). Accepts `PILOT_ID` env var.
  - Provisions fresh dev tenant in prod account; seeds with pilot fixture; runs C2.0 + C2.1 → C2.5 sequentially.
  - Includes cleanup (DELETE tenant or namespace artifacts) on exit.
  - Validation: smoke runs against deployed prod-account dev tenant.
  - AC: Exit 0 = greenlight; cleanup automated; tee'd log per CLAUDE.md deploy-log convention.

- **C2.7** Greenlight gate documentation (generic).
  - Files: `docs/pilot-greenlight/gate.md` (NEW).
  - Captures: what each test proves, how to register a pilot, how to re-run the gate.
  - Validation: doc reviewed; checked into repo.
  - AC: One-page; a new engineer can pick up and re-run for any registered pilot.

**Demo:** `PILOT_ID=pabson-saraswati-bs-2083 npx ts-node scripts/smoke-tests/pilot-greenlight.ts` exits 0. All 6 tests (1 write + 5 read) pass on a deployed prod-account dev tenant.

**Greenlight gate verdict at end of C2:** If all 6 tests green for the target pilot, calendar/operational domain is internally validated for that pilot. Proceed to Phase C hardening before external rehearsal.

---

### Sprint C3 — Pre-Greenlight Hardening (Performance + Holiday Seed + BS-Everywhere)

**Status:** ✅ **CLOSED 2026-05-17** — all 6 ticket-pairs + 1 hotfix shipped + validated in prod. Detail in §0.5 (status snapshot) and [`docs/deploys/INDEX.md`](../deploys/INDEX.md#2026-05-17--sprint-c3-closeout--c34--c35--hotfix--c32--c33). Net delta: 7 PRs, 5 shared-types publishes (0.45.0 → 0.49.0), 2 CDK deploys, 5 ECS rolls, +58 specs, 0 prod regressions.

**Goal:** Close gaps that would otherwise burn the first pilot within Term 1: attendance perf, archetype-aware holiday seed live, BS-only date inputs accepted on every entity.

- **C3.1** F-PERF-1 attendance 504 fix. **Phase 1 diagnosis complete** — see [`c3-1-attendance-perf-diagnosis.md`](c3-1-attendance-perf-diagnosis.md).
  - Root cause confirmed: `getAttendanceAlerts` does N-student × up to 3-query fan-out (~1,092 DDB queries per request at pilot scale). `getAttendanceOverview` inherits the cost.
  - Phase 2 fix: replace per-student summary loop with one bulk GSI3 date-range scan + in-memory group-by + lazy trend on top-20. **No CDK / GSI addition needed** — the right partition already exists.
  - Files (Phase 2): `server/application/microservices/academics/src/attendance/attendance.service.ts` only. ~150 LOC, ~3–5h.
  - AC: `/alerts` p95 < 500ms, `/overview` p95 < 1s at 1,000 students × 30 sections; no behavioral change; existing scope-filtering specs extended.

- **C3.2** Archetype-aware holiday seed bootstrap.
  - Files: `packages/shared-types/src/locale/holiday-seeds/<archetype>-<region>-<year>.json` (NEW; first instance carries the first pilot's archetype + region + AY). Registered in archetype-defaults table.
  - Source: each pilot's `holidays-consolidated.json` fixture is the canonical source for that archetype's seed within that AY window.
  - Validation: jest seed-shape test; loader test.
  - AC: Seed loadable by tenant-seeder Lambda; matches fixture.

- **C3.3** Holiday seed query endpoint with archetype filter.
  - Files: `server/application/microservices/identity/src/holidays/holiday-seed.controller.ts` (NEW); route in `tenant-api-prod.json` (per three-way handoff rule); nginx if new prefix.
  - `GET /holiday-seeds?archetype=<archetype>&year=<yearId>` returns curated list.
  - Validation: integration test; route-drift lint passes.
  - AC: Archetype-curated returned; falls back to generic-country seed if archetype-specific unavailable; route registered in all three places.

- **C3.4** Bell schedule preset — archetype default (academic shift).
  - Files: `server/application/microservices/identity/src/bell-schedules/bell-schedule.service.ts` (NEW); preset registered in archetype-defaults.
  - Period count + duration + start time pulled from archetype defaults.
  - Validation: jest unit + integration creating one for a pilot tenant.
  - AC: Operator can apply preset via API; no overlap.

- **C3.5** Bell schedule preset — exam-day variant.
  - Files: same service.
  - Block count + duration from archetype defaults.
  - Validation: jest + integration.
  - AC: Operator can apply.

- **C3.6** `generate-calendar` accepts BS-only inputs.
  - Files: `server/application/microservices/academics/src/calendars/generate-calendar.service.ts`.
  - Audit current: does it accept `breaks: [{ startBS, endBS }]` without AD? If not, fix.
  - Validation: integration test sends BS-only payload, gets 200 + correct calendar.
  - AC: BS-only generation works for whole AY; round-trip BS↔AD validated.

- **C3.7** Round-trip BS↔AD property test.
  - Files: `packages/shared-types/src/utils/__tests__/bikram-sambat-roundtrip.spec.ts` (NEW).
  - For every Baisakh 1 of BS 2000 → 2090, convert BS→AD→BS, assert equality.
  - Validation: jest property test.
  - AC: 91 years × roundtrip integrity; runs in <2s.

- **C3.8** `generate-calendar` non-destructive merge mode.
  - Files: same generate service.
  - Add `mode: 'replace' | 'merge'` query param; default `merge`.
  - `merge` preserves events where `sourceUserId !== 'SYSTEM'`.
  - `replace` is current destructive behavior; gated by Danger Zone UI confirmation flow.
  - Validation: integration: create operator override → run merge → override survives; run replace → wiped.
  - AC: Merge default; replace path preserved; audit emits `calendar.regenerated` event with mode in payload.

**Demo:** Apply archetype holiday seed + bell preset on a pilot dev tenant. Generate calendar in merge mode. Operator override survives second `generate-calendar` run. Attendance API p95 < 500ms with 1000 records. BS-only `generate-calendar` works.

---

### Sprint C4 — Multi-Day Event Blocks

**Status:** 🔲 PENDING — follows C3 in Phase C. Note: C4.2 adds a new GSI on CalendarDate — coordinate lowercase attribute names per the S3.2 rule (memory `project_s3_2_gsi_casing_shipped`).

**Goal:** Operators create multi-day holiday blocks with sub-events (e.g., "Dashain 9-day block with 6 sub-events") as one operator gesture. Per-day overrides preserved on block update.

- **C4.0** GSI inventory audit.
  - Files: `docs/pilot-greenlight/gsi-inventory.md` (NEW); `server/lib/tenant-template/ecs-dynamodb.ts` (annotated).
  - Document current GSI1-GSIn usage per table; identify next free index number for the block→dates query.
  - Validation: doc reviewed; checked into repo.
  - AC: GSI inventory committed before any GSI add; next free slot identified.

- **C4.1** Add `blockId/blockName/blockDescriptor/subEventName` to CalendarDate.
  - Files: `server/application/microservices/academics/src/common/entities/calendar-date.entity.ts`.
  - Backward-compatible additive — all 4 fields optional.
  - Validation: jest entity test; integration test existing rows still readable.
  - AC: New fields optional; existing rows unaffected; gsi-casing-contract unchanged.

- **C4.2** Add block→dates GSI (number per C4.0 audit).
  - Files: `server/lib/tenant-template/ecs-dynamodb.ts`.
  - `<gsiN>pk=BLOCK#{blockId}, <gsiN>sk=DATE#{date}`.
  - Validation: CDK synth diff; deploy to dev.
  - AC: GSI deploys; lowercase attribute names per S3.2 rule; existing GSIs unaffected.

- **C4.3** Block CRUD endpoints (split a/b/c for atomicity).
  - **C4.3.a** POST `/calendar-blocks` (creates block + N child date rows in TransactWriteItems).
  - **C4.3.b** GET `/calendar-blocks/:id` + LIST `/calendar-blocks?schoolId=&ay=`.
  - **C4.3.c** DELETE `/calendar-blocks/:id` (cascade-delete child dates; emits `calendar.block_deleted`).
  - Files: `server/application/microservices/academics/src/calendar-blocks/blocks.controller.ts` (NEW); routes in `tenant-api-prod.json`; nginx route.
  - Validation: integration per endpoint; route-drift lint.
  - AC: A 9-day block POST writes 9 child date rows atomically.

- **C4.4** Block-edit drawer preserves per-day overrides.
  - Files: `blocks.service.ts`.
  - PATCH `/calendar-blocks/:id` updates block name + sub-event metadata; per-day overrides on child dates survive.
  - Validation: integration: create block → override a sub-event date to `early_release` → rename block → verify override persists.
  - AC: Per-day override preserved on block-level update; audit row per change.

- **C4.5** [frontend] Drag-to-select UI for block creation.
  - **Included in this sprint** (daily-use operator workflow).
  - Files: `edforge-saas-frontend/.../CalendarBlocks/...`.
  - Validation: Cypress E2E.
  - AC: Drag selection creates a block via API; integrated with block-edit drawer.

- **C4.6** Audit emission for block create/update/delete.
  - Files: `blocks.service.ts`.
  - Emits `calendar.block_created`, `calendar.block_updated`, `calendar.block_deleted` per C0.c.2 taxonomy.
  - Validation: integration asserts audit + event.
  - AC: Every block op audited; events appear on bus.

**Demo:** On a pilot dev tenant, drag a multi-day range in UI → name the block with N sub-events. Override one sub-event date. Rename block. Override persists. All N dates have `blockId` populated.

---

### Sprint C0.b — Deferrable Cleanup (Parallel to C3/C4)

**Status:** ✅ Code-complete 2026-05-16 — 5/5 tickets shipped (PRs #104, #105, #106, #107, #108 all merged). Operator gates pending: identity ECR + ECS roll picks up #104/#106/#107 in one combined deploy; ops-script `--apply` runs for #105 cleanup and #108 migration. See §0.5 operator action queue.

**Goal:** Close known loose ends that don't block the greenlight gate. Runs in parallel; doesn't gate any downstream sprint.

- **C0.b.1** Fix Leave cancel 500 (surfaced in S3.2 smoke; 2 requestIds captured in deploy log).
  - Files: `server/application/microservices/identity/src/leave/leave.service.ts` `cancelLeave` path.
  - Diagnose: CloudWatch logs from `dabba06f-d62e-496c-b867-fb66cfec4293` and `7478b136-6b0a-4211-a24d-491e0e69bf94`.
  - Validation: re-run S3.2 smoke → 33/33 green.
  - AC: PATCH `/staff/:staffId/leave/:leaveId/cancel` returns 2xx + audit row + event.

- **C0.b.2** Clean up S3.2 smoke artifacts in dev tenant.
  - Files: `scripts/cleanup-orphans/s3-2-smoke-artifacts.ts` (NEW); temp IAM policy if needed.
  - 2 stuck leave rows + 2 calendar `S32-SMOKE-*` rows.
  - Validation: post-cleanup DDB query returns 0 artifacts.
  - AC: Dev tenant clean; temp IAM policy detached.

- **C0.b.3** D4.5 — `shortName` uniqueness per tenant.
  - Files: `server/application/microservices/identity/src/schools/schools.service.ts` `createSchool` path.
  - ConditionExpression for unique `shortName` within tenant scope.
  - Validation: integration negative test.
  - AC: 409 with `errorCode: SHORT_NAME_DUPLICATE`.

- **C0.b.4** D4.6 — `schoolTypeDescriptor` as Ed-Fi enum.
  - Files: `school.entity.ts` + DTO; `packages/shared-types/src/schemas/identity/school.schema.ts`.
  - Convert from string to enum; validate against Ed-Fi descriptor namespace.
  - Validation: integration: 400 on invalid; 200 on valid.
  - AC: Only valid Ed-Fi values accepted.

- **C0.b.5** Migrate legacy `testing_day` → `exam_window` rows (S1.6).
  - Files: `scripts/migrations/testing-day-to-exam-window.ts` (NEW); migration log.
  - Validation: pre-migration scan; post-migration scan asserts 0 testing_day rows.
  - AC: Migration committed + verified in prod.

**Demo:** S3.2 smoke 33/33 green; dev tenant DDB scan shows 0 smoke artifacts; `shortName` uniqueness validates; `schoolTypeDescriptor` rejects invalid values; 0 `testing_day` rows remain in production.

---

### Sprint C5 — Exam Subsystem

**Status:** 🔲 PENDING (Phase D — Operational Surface).

**Goal:** First-class `Exam` entity tied to `GradingPeriod`. Operator creates Term-1 exam, adds subjects, enters scores, closes the exam. Result calculation **moves to C7** (atomicity).

- **C5.1** Exam entity.
  - Files: `server/application/microservices/academics/src/common/entities/exam.entity.ts` (NEW).
  - Fields: `examId`, `examName`, `termId`, `examType` (terminal/quiz/mid-term/etc), `startDate`, `endDate`, `status` (draft/scheduled/in_progress/closed/published).
  - GSIs: by `termId`, by `status`.
  - Validation: entity unit tests; gsi-casing-contract verifies lowercase.
  - AC: Entity factory writes correct DDB shape; passes gsi-casing-contract.

- **C5.2** ExamSubject entity.
  - Files: `server/application/microservices/academics/src/common/entities/exam-subject.entity.ts` (NEW).
  - Fields: `examSubjectId`, `examId`, `subjectId`, `maxMarks`, `passingMarks` (default from SchoolConfiguration.passingGrade), `creditHours`.
  - Validation: entity tests.
  - AC: Schema correct; relation to Exam via `examId`.

- **C5.3** ExamScore entity (keyed by enrollmentId per invariant 3).
  - Files: `server/application/microservices/academics/src/common/entities/exam-score.entity.ts` (NEW).
  - Fields: `examScoreId`, `examId`, `examSubjectId`, `enrollmentId`, `rawScore`, `status` (entered/locked), `enteredBy`, `enteredAt`.
  - Validation: entity tests + cross-AY query path test (uses GSI2 student→enrollments).
  - AC: Score row references `enrollmentId`, NOT `(studentId, examId)`. Cross-year aggregation works via GSI2.

- **C5.4.a** Exam CRUD endpoints.
  - Files: `server/application/microservices/academics/src/exams/exams.controller.ts` (NEW); routes in `tenant-api-prod.json`; nginx if new prefix.
  - POST + GET + LIST `/exams`.
  - Validation: integration; route-drift lint.
  - AC: 2xx behaviors validated; audit + event emit per write.

- **C5.4.b** ExamSubject CRUD endpoints.
  - Files: `exams.controller.ts` (extended) or separate `exam-subjects.controller.ts`.
  - POST + GET + LIST `/exams/:examId/subjects`.
  - Validation: integration.
  - AC: Subject add validates against school's curriculum-subjects.

- **C5.4.c** ExamScore endpoints (single + bulk).
  - Files: `exam-scores.controller.ts` (NEW).
  - POST `/exams/:examId/scores` (single); POST `/exams/:examId/scores/bulk` (≤100 per call).
  - Validation: integration.
  - AC: Validates `0 ≤ rawScore ≤ maxMarks`; 409 if exam.status=closed; 404 if any FK missing.

- **C5.4.d** Exam state machine endpoint.
  - Files: `exams.controller.ts` extended.
  - PATCH `/exams/:examId/status` transitions: draft→scheduled→in_progress→closed.
  - Validation: integration state machine test.
  - AC: Invalid transitions return 409 with `errorCode: EXAM_STATE_INVALID_TRANSITION`.

- **C5.5** Bulk score entry chunked at 100 (DDB TransactWriteItems limit).
  - Files: `exam-scores.service.ts`.
  - 250 scores → 3 atomic chunks; per-chunk audit + event.
  - Validation: integration with 250 scores.
  - AC: All scores written; idempotent on retry; concurrency-safe via correlation ID.

- **C5.6** Score validation rules.
  - Files: `packages/shared-types/src/schemas/academics/exam-score.schema.ts` (NEW); service-side cross-check.
  - Validation: integration negative tests for each rule.
  - AC: 4xx errors structured per project errorCode schema.

**Demo:** Create Term-1 exam on a pilot dev tenant. Add subjects per the pilot's curriculum. Enter scores for 10 students. Close the exam. Verify audit + events on bus for every step.

---

### Sprint C6 — Period Attendance + Day Rollup

**Status:** 🔲 PENDING (Phase D — Operational Surface).

**Goal:** Per-period attendance wired end-to-end against the pilot's bell schedule. Day rollup correct under holiday/weekend conditions.

- **C6.1** Validate `classPeriodId` against active bellSchedule.
  - Files: `server/application/microservices/academics/src/attendance/attendance.service.ts`.
  - POST attendance with `periodAttendance: [{ classPeriodId, status }]` must validate every `classPeriodId` exists in school's active bellSchedule.
  - Validation: integration negative test.
  - AC: 400 with `errorCode: PERIOD_NOT_IN_BELL_SCHEDULE` on invalid; valid passes.

- **C6.2** [frontend] Per-period grid UI in academics MFE.
  - **Included in this sprint** (daily-use operator workflow).
  - Files: `edforge-saas-frontend/.../Attendance/PerPeriodGrid.tsx` (NEW).
  - Validation: Cypress E2E.
  - AC: Operator marks late for P3 only → grid shows late; per-day rollup shows partial.

- **C6.3** Day rollup from period data.
  - Files: `server/application/microservices/academics/src/attendance/attendance-rollup.service.ts` (NEW).
  - All present → present; all absent → absent; partial → partial_absent.
  - Validation: unit + integration.
  - AC: Rollup deterministic; produces correct status across mixed periods.

- **C6.4** Per-period analytics aggregation.
  - Files: analytics Lambda or academics endpoint `GET /analytics/per-period?schoolId=&termId=`.
  - Per-term per-period attendance %.
  - Validation: integration with pilot fixture data.
  - AC: Aggregation returns per-period rollup; cached 5min per CLAUDE.md.

- **C6.5** Pilot real-data attendance smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-attendance-week.ts` (NEW). Accepts `PILOT_ID`.
  - Mark attendance for 10 students × 6 days × N periods using the pilot's bell schedule.
  - Validate: rollups correct, no 504s, audit + events complete.
  - AC: Smoke exits 0 for each registered pilot; data shape matches Ed-Fi Attendance.

- **C6.6** Day rollup respects vacation/holiday/weekend.
  - Files: `attendance-rollup.service.ts` extended.
  - If date is a registered holiday for the school → rollup returns `holiday` (not `absent`).
  - If date is a weekend (per school's `schoolDays`) → returns `weekend`.
  - If date is mid-vacation block → returns `vacation`.
  - Validation: integration with each multi-day holiday block from pilot fixture.
  - AC: Rollup returns correct non-`absent` value for all holiday types in the fixture.

**Demo:** Mark per-period attendance for a section on a pilot dev tenant for a week, including a holiday-block date. Inspect grid + rollup + analytics. No 504s. Holiday dates show `holiday` not `absent`.

---

### Sprint C7 — Result Subsystem (Per-Term Cards + Aggregation Engine)

**Status:** 🔲 PENDING (Phase D — Operational Surface).

**Goal:** After exam closes, generate per-student per-term `ResultCard` rows using the term-aggregation rules engine. Admin UI shows them. "Publish" event emits.

- **C7.0** Term-aggregation rules engine.
  - Files: `server/application/microservices/academics/src/results/term-aggregation.service.ts` (NEW).
  - Reads `gradingScale` from `SchoolConfiguration` (data-driven, archetype-blind — invariant 8).
  - Per-term weighted GPA across exams; optional attendance penalty; rank scope (section / class / school).
  - Validation: unit tests with synthetic + pilot-fixture gradingScale data.
  - AC: Engine is data-driven; rules come from term metadata, not code; no archetype branching.

- **C7.1** ResultCard entity.
  - Files: `server/application/microservices/academics/src/common/entities/result-card.entity.ts` (NEW).
  - Fields: `cardId`, `enrollmentId`, `termId`, `examId`, `subjectScores: [{ subjectId, score, grade, gpa }]`, `totalScore`, `termGpa`, `classRank`, `sectionRank`, `conduct`, `classTeacherRemark`, `publishedAt`, `publishedBy`, `status` (draft/published).
  - Validation: entity tests; keyed by `enrollmentId` per invariant 3.
  - AC: Card factory writes correct shape; passes gsi-casing-contract.

- **C7.2** Batch result generation Lambda.
  - Files: `server/lib/result-generation/result-batch-lambda.ts` (NEW).
  - Trigger: `exam.closed` event from C0.c bus.
  - Generates ResultCard per enrollment in the exam using C7.0 engine.
  - Validation: Lambda unit + integration triggering via EventBridge.
  - AC: 200 enrollments → 200 cards in <30s.

- **C7.3** Conduct + class-teacher-remark entry.
  - Files: `server/application/microservices/academics/src/results/conduct.controller.ts` (NEW).
  - PATCH `/result-cards/:id/conduct` writes conduct rating + remark.
  - Validation: integration; audit per write.
  - AC: Audit row + event per write.

- **C7.4** Publication state machine.
  - Files: `result-cards.service.ts`.
  - draft → published transition: writes `publishedAt` + `publishedBy`; emits `result.published` event.
  - Validation: integration; state machine unit test.
  - AC: Cannot un-publish; cannot publish twice (409 `RESULT_ALREADY_PUBLISHED`).

- **C7.5** Cross-year publication tested.
  - Files: integration spec.
  - Scenario: prior-AY Term-1 results publish while next AY hasn't been created.
  - Assert: card has `enrollmentId` referencing prior-AY enrollment; provisional flip (from C9.5) is N/A for Term-1.
  - AC: Cards stay coupled to correct AY.

- **C7.6** [frontend] Admin result-review UI.
  - **Deferred to a separate frontend sprint** (admin-rare workflow; API-first acceptable for V1).
  - Tracked in `docs/Sprints/Result-Subsystem-Frontend.md` (to be created).

- **C7.7** Pilot real-data result smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-result-card-publish.ts` (NEW). Accepts `PILOT_ID`.
  - End-to-end: create Term-1 exam, score 10 students, close, generate cards (Lambda fires), publish.
  - Validate: cards exist, GPA correct per pilot's gradingScale, audit clean, `result.published` events appear.
  - AC: Smoke exits 0 for each registered pilot.

**Demo:** Close Term-1 exam on a pilot dev tenant. 10 ResultCards generated by Lambda. Add conduct + remark on 5 of them. Publish all 10. `result.published` events appear in event-log + bus.

---

### Sprint C8 — Event-Log Completion + Staff Migration

**Status:** 🔲 PENDING (Phase E — Event-log completion). C0.c already shipped the bus + 25 schemas; C8 completes the consumer side (event-log entity + DLQ + staff.training migration).

**Goal:** Complete the event emission story started in C0.c. Read-side event log + DLQ + retry + migrate pre-existing `staff.training.*` events through the new emitter.

(C0.c.1, C0.c.2, C0.c.3 are already shipped from earlier sprint.)

- **C8.4** Event-log entity (read-side).
  - Files: `server/application/microservices/common/entities/event-log.entity.ts` (NEW); per-tenant DDB partitioning.
  - Validation: integration: every event on bus also in log; queryable by tenant + time range.
  - AC: Audit-grade event log; queryable; 30-day retention default.

- **C8.5** DLQ + retry on emission failure.
  - Files: CDK extension to `event-bus-stack.ts`; `emitEvent()` service retry policy.
  - Validation: chaos test injects EventBridge failure.
  - AC: 3 retries with exponential backoff; DLQ catches permanent failures; CloudWatch alarm fires.

- **C8.6** Migrate `staff.training.*` events through new emitter.
  - Files: identity service staff-training paths (existing).
  - Validation: behavior unchanged; existing tests pass; new event-log shows staff.training events.
  - AC: Pre-existing events flow through new emitter; payload shape consistent with C0.c.2 taxonomy.

**Demo:** Trigger `school.created` + `academic_year.created` + `term.created` + `exam.closed` + `result.published` on a pilot dev tenant. All 5 land on bus, in event-log, with schema-validated payloads. DLQ empty. Chaos test inject failure → 3 retries → recovered. Old `staff.training.*` events now visible in event-log.

---

### Sprint C9 — Cross-Year Handoff (THE Centerpiece)

**Status:** 🔲 PENDING (Phase F — Year-End Centerpiece). Critical for the first pilot's AY 2083 → 2084 transition.

**Goal:** The pilot can cross AY → next AY. Provisional → final transition for the operator's printed result-publish window. Retention path tested. Attendance and other academic records preserve their `enrollmentId` reference through the rewrite (invariant 3).

The reference window for the first pilot is the printed `[next AY new-session-begin date] → [next AY result-publish date]` interval — both pulled from `academic-structure.json`. The state machine generalizes across pilots.

- **C9.1** Add `'provisional'` to EnrollmentStatus enum.
  - Files: `server/application/microservices/academics/src/common/entities/base.entity.ts`.
  - Valid transitions: `provisional → enrolled`, `provisional → withdrawn`. Invalid: `enrolled → provisional`.
  - Validation: unit (state machine); integration creating a provisional enrollment.
  - AC: Status accepted by API; invalid transitions return 409.

- **C9.2** Add `priorEnrollmentId?: string` to Enrollment.
  - Files: `enrollment.entity.ts`.
  - Validation: integration round-trip; FK validation that referenced enrollment exists.
  - AC: Field present; nullable; populated by promotion op.

- **C9.3** Add `promotionDecision` field (write-once).
  - Files: `enrollment.entity.ts`.
  - Enum: `'promoted' | 'retained' | 'conditional' | 'graduated' | 'withdrawn' | 'transferred_out'`.
  - Validation: unit asserts write-once (PUT second value → 409 `errorCode: PROMOTION_DECISION_LOCKED`).
  - AC: Field on prior-year enrollment; set on result-publish in C9.5.

- **C9.4** Batch-promote operation.
  - Files: `server/application/microservices/academics/src/enrollment/promote.controller.ts` (NEW); `server/application/microservices/academics/src/enrollment/promote.service.ts` (NEW); routes in `tenant-api-prod.json` and nginx.
  - POST `/schools/:id/academic-years/:to/promote-from/:from?gradeLevel=<grade>`.
  - Creates N provisional rows in AY `:to` with `priorEnrollmentId` set.
  - Atomic per student (TransactWriteItems chunked at 100).
  - Audit row + event per promotion.
  - Idempotent (re-run = no-op or returns existing).
  - Validation: integration test using the pilot's AY → next AY transition dates from fixture.
  - AC: 200 students promoted in chunks; emits `enrollment.promoted` event per promotion; route registered in all 3 places.

- **C9.5** Provisional → final transition on result publish (with explicit window AC).
  - Files: `result-cards.service.ts` + `enrollment.service.ts`.
  - When prior-AY Term-N result publishes (event: `result.published` with terminal-exam flag), provisional next-AY enrollments flip to `enrolled` (unless retained — see C9.6).
  - Validation: integration with explicit window simulation, parametrized over pilot fixture:
    > "10 students have provisional next-grade enrollments at next-AY day-1. Mark attendance for the operator-printed [new-session-begin → result-publish] window against provisional enrollmentIds. Publish prior-AY Term-N results on the printed result-publish day. Assert: 9 enrollments flip to `enrolled` (priorEnrollmentId set, promotionDecision='promoted' on prior); 1 retained gets gradeLevel rewritten to prior grade (see C9.6); ALL window attendance rows remain queryable via their original enrollmentId — invariant 3 preserved."
  - AC: Smoke green; idempotent on result-publish retry.

- **C9.6** Retention path.
  - Files: `enrollment.service.ts`; `promote.service.ts`.
  - Marking a student `retained`:
    - Rewrites their next-AY enrollment's `gradeLevel` to match prior AY (no new row created — same `enrollmentId`).
    - Sets `promotionDecision='retained'` on prior-AY enrollment.
    - Attendance records under the provisional enrollment are preserved (they reference `enrollmentId`, which doesn't change).
  - Validation: integration: retain X → verify gradeLevel rewrite; verify window attendance still resolves under the same enrollmentId; verify audit captures both pre-rewrite gradeLevel + retention decision.
  - AC: Cross-references invariant 3 explicitly; smoke validates attendance survives.

- **C9.7** Cross-AY student timeline endpoint.
  - Files: `server/application/microservices/academics/src/enrollment/student-timeline.controller.ts` (NEW); routes registered.
  - GET `/students/:id/timeline` returns all enrollments across all AYs via GSI2.
  - Validation: integration with pilot fixture across two AYs.
  - AC: Returns full chain with promotion decisions; sorted by AY ascending.

- **C9.8** Enrollment state machine + tests.
  - Files: `server/application/microservices/academics/src/common/utils/enrollment-state-machine.ts`.
  - Validation: unit tests covering every transition (valid + invalid).
  - AC: All transitions tested; rejection list documented in code comments + spec.

- **C9.9** Pilot cross-year smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-cross-year-handoff.ts` (NEW). Accepts `PILOT_ID`.
  - Simulates the operator-printed [new-session-begin → result-publish] window:
    1. Prior AY active; 10 students in the source grade.
    2. Create next AY (status=active).
    3. Batch-promote source grade → target grade in next AY.
    4. Mark attendance for the window against provisional enrollments.
    5. Publish prior AY Term-N results on the printed publish date.
    6. Verify: 9 students flip to `enrolled` target grade; 1 retained → next-AY gradeLevel = source grade; all window attendance preserved.
  - AC: Smoke exits 0 for each registered pilot.

**Demo:** A pilot dev tenant — full operator-printed window simulation per C9.9. Provisional → final flip works; retention path works; attendance preserved through gradeLevel rewrite.

---

### Sprint C10 — Annual External Reporting Submission

**Status:** 🔲 PENDING (Phase F — Year-End Centerpiece).

**Goal:** Generate the annual external reporting submission (e.g., for the first pilot: CEHRD-template-conformant IEMIS submission). Submission history queryable.

Generic naming because future pilots in other regions submit to other authorities (CBSE / UAE MOE / state DOE). The pipeline is parametric on the reporting-template descriptor.

- **C10.1** ReportingSnapshot entity.
  - Files: `server/application/microservices/identity/src/external-reporting/reporting-snapshot.entity.ts` (NEW).
  - Fields: `reportId`, `tenantId`, `schoolId`, `ayId`, `reportType` (e.g., `IEMIS_NPL_CEHRD`), `generatedAt`, `csvS3Key`, `validationResult`, `submittedAt?`, `submittedBy?`.
  - Validation: entity tests.
  - AC: Snapshot rows queryable per AY × reportType.

- **C10.2** Aggregation Lambda (per-report-type).
  - Files: `server/lib/external-reporting/lambda/report-aggregator.ts` (NEW); per-report-type aggregator modules.
  - Aggregations declared in the report-type template (students-by-grade × gender, staff-by-role × gender, etc.); aggregator is generic, template-driven.
  - Validation: integration with pilot fixture data.
  - AC: Aggregations match expected pilot profile; runs in <60s for 1000-student tenant.

- **C10.3** Report template registry.
  - Files: `packages/shared-types/src/external-reporting/templates/<reportType>.ts` (NEW; first instance: `IEMIS_NPL_CEHRD`).
  - Each template defines: columns, aggregation rules, validation rules.
  - Validation: roundtrip against known-good fixture from the authority (or strict schema validator if fixture unavailable).
  - AC: First-pilot template passes strict schema; aggregations land in correct columns.

- **C10.4** [frontend] Submission history UI.
  - **Deferred to frontend sprint** (admin-rare workflow).
  - Tracked separately.

- **C10.5** Audit per submission.
  - Files: external-reporting service.
  - Validation: integration.
  - AC: Audit row per generation; `reporting.submitted` event on bus.

- **C10.6** `reporting.submission_due` event emission.
  - Files: scheduled trigger (EventBridge cron) + lambda.
  - Emits event when an AY nears submission window (per report-type schedule).
  - Validation: integration.
  - AC: Event fires on schedule; delivery deferred per scope.

- **C10.7** Pilot reporting smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-external-reporting.ts` (NEW). Accepts `PILOT_ID`.
  - Aggregate pilot AY fixture data → CSV via the appropriate report-type template.
  - AC: CSV passes template validation; smoke exits 0 for each registered pilot.

**Demo:** Generate the first pilot's AY annual submission via the IEMIS_NPL_CEHRD template. CSV downloaded; counts match dev-tenant data. Submission history shows entry. `reporting.submitted` event on bus.

---

### Sprint C11 — Compliance + DR Foundation (Engineering Slice)

**Status:** 🔲 PENDING (Phase G — Compliance).

**Goal:** Tenant export, DSAR foundation, DR drill cadence, tenant-cancellation state machine. (Residency commitment + consent capture moved to C0.e — declaration/policy work, started early.)

- **C11.2** Tenant data export endpoint + async job.
  - Files: `server/application/microservices/identity/src/tenant-export/tenant-export.controller.ts` (NEW); export job Lambda; routes registered.
  - POST `/tenants/:id/export` triggers async job → S3 zip with every entity (Schools, Staff, Students, Enrollments, Attendance, Exams, ResultCards, ReportingSnapshots, audit log, event log).
  - Validation: integration on a pilot dev tenant.
  - AC: Zip contains every entity type; job completes <30min for 1000-student tenant; download URL signed.

- **C11.3** DSAR endpoint foundation.
  - Files: `server/application/microservices/identity/src/dsar/dsar.controller.ts` (NEW); routes registered.
  - GET `/dsar/students/:id` returns all data about student X.
  - Validation: integration.
  - AC: Returns structured response; audit row + event per query.

- **C11.5** DR drill script + runbook.
  - Files: `scripts/dr-drill/restore-pitr.sh` (NEW); `docs/runbooks/dr-drill.md` (NEW).
  - Drill against a test tenant: trigger PITR to a fixture; assert fixture data restored.
  - Validation: dry-run + actual restore on the prod-shadow tenant from C12.10.
  - AC: Drill repeatable; runbook walkthrough-able by on-call engineer.

- **C11.6** Tenant-cancellation state machine + auto-export.
  - Files: tenant lifecycle service + CDK extension if needed.
  - On cancel: trigger export → mark tenant `cancelled` → retain data 30 days → soft-delete.
  - Validation: integration with test tenant.
  - AC: State transitions audited; data retained per policy; soft-delete reversible within retention window.

- **C11.7** Audit on every compliance op.
  - Files: lint rule + integration.
  - Validation: lint asserts every compliance endpoint has `auditedWrite` + `emitEvent`.
  - AC: 100% coverage; lint hard-fails on missing.

**Demo:** Click "Export tenant data" on a pilot dev tenant. S3 zip arrives with every entity. Run DR drill against test tenant → fixture restored from PITR. Tenant-cancellation state transitions audited on a test tenant.

---

### Sprint C0.e — Compliance Policy / Declaration (Started Early)

**Status:** 🔲 PENDING (Phase A — Foundation). Can run in parallel with anything; non-engineering scope.

**Goal:** Long-lead-time policy and declaration work that needs legal/operations sign-off. Started early to avoid blocking C12 rehearsal.

- **C0.e.1** Data-residency commitment doc + per-tenant assertion.
  - Files: `docs/compliance/data-residency-commitment.md` (NEW); test in tenant-create flow that asserts region.
  - AC: Doc reviewed (legal sign-off ideal); per-tenant assertion fails fast if region mismatch detected.

- **C0.e.2** Consent capture on user invite.
  - Files: identity service user-invite path; consent entity.
  - Version-hashed policy URL stored with consent.
  - Validation: integration: cannot invite without consent record.
  - AC: Audit row + consent record per invite.

**Demo:** Provision a new dev tenant and confirm region assertion fires correctly. Send a test user invite and confirm consent record persists with version-hashed policy URL.

---

### Sprint C12 — Pilot Onboarding Rehearsal (External Greenlight Gate)

**Status:** 🔲 PENDING (Phase H — Greenlight Rehearsal). Critical external-greenlight gate.

**Goal:** Walk a fresh dev tenant through every step of real-world pilot onboarding, mimicking the pilot's printed calendar. **Plus a prod-shadow rehearsal in the prod account.**

- **C12.1** Prepare fresh dev tenant for rehearsal.
  - Provision via real tenant-provisioning flow. Tenant name carries `tenantTag=internal-dev`.
  - AC: Tenant ID captured + logged.

- **C12.2** Run steps 1-11 from v2 Part E.2 (provisioning + AY + terms + calendar generation using the pilot's fixture).
  - AC: Audit rows captured for each step; events on bus.

- **C12.3** Run steps 12-17 (vacations + programs + bell + students + week of attendance).
  - AC: Every operation produces expected event + audit; per-period attendance via UI grid (from C6.2).

- **C12.4** Run steps 18-19 (activation + Term-1 exam + result generation).
  - AC: Activation gate accepts (archetype-aware); Term-1 result publishes cleanly via Lambda.

- **C12.5** Run step 20 (cross-year handoff using the pilot's AY transition dates).
  - Replicate C9.9 smoke under full rehearsal conditions.
  - AC: Provisional → final transitions clean; retention path tested; attendance preserved.

- **C12.6** Run steps 21-22 (annual external reporting submission + tenant export).
  - AC: CSV passes template; zip complete with every entity.

- **C12.7** Run step 23 (audit + event log review).
  - Any unaudited write OR un-emitted event = milestone **FAIL**.
  - AC: 100% audit + event coverage verified by query against event-log entity.

- **C12.8** Record demo video.
  - Files: `docs/pilots/<pilot-id>/c12-evidence/rehearsal-walkthrough.mp4`.
  - 90-minute walkthrough capturing every step.
  - AC: Video archived; index entry in `docs/pilots/<pilot-id>/dossier.md`.

- **C12.9** Publish post-milestone gap list.
  - Files: `docs/pilots/<pilot-id>/c12-evidence/gap-list.md`.
  - Any unresolved gap → backlog ticket.
  - AC: Gap list reviewed; user signs off OR identifies must-fix-before-live items.

- **C12.10** Prod-shadow rehearsal.
  - Provision a prod-account dev tenant for the pilot (`tenantTag=internal-dev`, in-region).
  - Re-run the rehearsal subset: steps 1-11 (provisioning + AY + terms + calendar) + 21-22 (reporting + export).
  - Tear down after.
  - AC: Prod-account provisioning + reporting export + tenant export validated; teardown clean; deploy log captured in `docs/deploys/`.

**Demo:** The 90-minute recorded walkthrough on the dev rehearsal tenant. Then the prod-shadow rehearsal log shows successful provisioning + export on the prod account. **Greenlight = pilot can go live.**

---

### Sprint C13 — Production Launch

**Status:** 🔲 PENDING (Phase I — Production). The end goal.

**Goal:** Migrate the pilot from rehearsal to live. Operator hand-off complete. 30-day hypercare.

- **C13.1** Provision real pilot tenant in prod.
  - Files: capture provisioning evidence in `docs/deploys/`; pilot dossier updated.
  - AC: Tenant live; Cognito admin invite issued; first-login audited.

- **C13.2** Operator-led onboarding session.
  - Recorded session: pilot admin walks through their setup with EdForge support present.
  - AC: Admin can complete activation independently; recording archived in `docs/pilots/<pilot-id>/`.

- **C13.3** Day 0-7 observability check.
  - Monitor: CloudWatch alarms; per-event audit completeness; tenant-isolation cross-checks (no cross-tenant queries succeed).
  - AC: No prod incidents in first week; daily check-in artefacts captured.

- **C13.4** Day 8-30 hypercare.
  - Capture every operator question + frontline bug; triage to bug-fix sprints.
  - AC: Triage queue empty by day 30 OR each item in a tracked sprint.

- **C13.5** Day 30 retrospective + plan adjustment.
  - Files: `docs/pilots/<pilot-id>/day-30-retro.md`.
  - Capture: what real production surfaced vs. what synthetic tests caught; backlog adjustments for pilot 2/3 readiness.
  - AC: Lessons learned → backlog adjustment committed.

**Demo:** Pilot live. Admin trained. Hypercare runbook in place. First 30 days documented.

---

## 7. Dependency graph

```
C0.a (cal-blocking verifications)
  ↓
C0.c (event emission foundation)
  ↓
C0.e (compliance declarations — started parallel)
  ↓
C1 (pilot fixture engine + first pilot registered)
  ↓
C2 (greenlight gate: write smoke + 5 read tests) ⭐ internal greenlight
  ↓
C3 (perf + holiday seed + BS everywhere)   ←  C0.b runs in parallel
  ↓
C4 (multi-day blocks)
  ↓
C5 (exam capture, no math)
  ↓
C6 (period attendance)
  ↓
C7 (result subsystem + aggregation engine)
  ↓
C8 (event-log + DLQ + staff migration)
  ↓
C9 (cross-year handoff) ⭐ centerpiece
  ↓
C10 (external reporting submission)
  ↓
C11 (compliance engineering)
  ↓
C12 (rehearsal + prod-shadow) ⭐ external greenlight
  ↓
C13 (pilot production launch)
```

Critical path = C0.a → C0.c → C1 → C2 → C3 → C5 → C7 → C9 → C12 → C13.

Sprints that can parallelize: C0.b alongside C3/C4; C0.e alongside C0.a/C0.c/C1; C4 alongside C5 if backend bandwidth allows.

---

## 8. Operator UX scope (explicit)

**Frontend tickets included in their respective sprints** (daily-use operator workflows):

| Sprint | Frontend ticket | Why in-sprint |
|---|---|---|
| C4 | C4.5 — Drag-to-select UI for block creation | Operator creates multi-day block as one gesture; daily-use during calendar setup |
| C6 | C6.2 — Per-period attendance grid | Daily teacher action; cannot defer |

**Frontend tickets deferred to separate frontend sprints** (admin-rare workflows; API-first acceptable for V1):

| Sprint | Deferred ticket | Tracked in |
|---|---|---|
| C7 | C7.6 — Admin result-review UI | `docs/Sprints/Result-Subsystem-Frontend.md` |
| C10 | C10.4 — External reporting submission history UI | `docs/Sprints/External-Reporting-Frontend.md` |

Rehearsal at C12 covers UI for in-sprint frontend tickets; API/curl/Postman walkthrough for deferred ones.

---

## 9. Open questions / followups

1. **GSI inventory (C4.0)** — needs audit before C4.2 picks a GSI number. May affect C8.4 event-log GSI design too.
2. **Pilot gradingScale values** — fixture metadata assumes archetype default; verify against pilot's actual policy with the admin during C13.2 onboarding session.
3. **External reporting template fixture** (C10.3) — do we have a known-good fixture from each authority, or do we validate against schema-only?
4. **Bell schedule scope modeling (C1.3)** — `scope: 'academic' | 'non-academic'` per shift. The first pilot's "Morning shift" is boarding-routine (non-academic). Re-confirm this distinction holds for other pilots.
5. **Retention rules engine (C9.6)** — auto-derived retention from failing grades vs. operator-manual. Plan assumes operator-manual for V1; auto-derived deferred to a "retention policy engine" backlog item.
6. **Prod-account dev tenants (C12.10)** — existing pattern (`tenantTag=internal-dev` in prod). C12.10 follows same pattern. Confirm no cost-center implications.

---

## 10. Definition of Done (per ticket)

A ticket is "Done" when:
- [ ] Files changed match the listed Files
- [ ] Validation passes (jest/integration/smoke as specified)
- [ ] AC is reviewer-checkable (no "tested locally")
- [ ] All architecture invariants (§4) preserved — reviewer signs off
- [ ] Audit + event emission rule (invariants 5 + 6) verified for any write
- [ ] Three-way route registration (if new endpoint): NestJS controller + `tenant-api-prod.json` + `nginx.template` if new prefix
- [ ] PR description references the ticket ID (e.g., "C9.4 — batch-promote endpoint")
- [ ] If shared-types changed: minor bump + npm publish + consumer pins updated + AdminWeb jsdom bundle sim per CLAUDE.md
- [ ] **Invariant 13 check:** `grep -rni '<first-pilot-name>'` against `server/`, `packages/shared-types/`, `client/`, `edforge-saas-frontend/`, `scripts/smoke-tests/` returns zero hits (excluding pilot-id env-var defaults in smoke scripts)

## 11. Definition of Done (per sprint)

A sprint is "Done" when:
- [ ] Every ticket meets per-ticket DoD
- [ ] Sprint demo recorded against a pilot dev tenant (where applicable)
- [ ] Deploy log committed to `docs/deploys/` for any prod-touching action
- [ ] No regressions in prior sprints' smokes (regression test bundle re-run)
- [ ] Closeout note added to `docs/pilot-greenlight/sprint-closeouts.md`

---

## 12. Greenlight criteria

**Internal greenlight (end of C2):**
- C2.0 write-path smoke green for the target pilot
- C2.1-C2.5 all five read-path tests green for the target pilot
- Smoke runs against deployed prod-account dev tenant (not jest-isolation)

**External greenlight (end of C12):**
- C12.1-C12.9 dev rehearsal complete, demo video archived in pilot dossier
- C12.10 prod-shadow rehearsal in prod account complete
- C12.9 gap list reviewed + signed off OR must-fix items resolved
- All architecture invariants (§4) verified across the rehearsal

**Production-ready (end of C13.5):**
- Pilot live for ≥30 days
- No P0/P1 incidents in week 1
- Hypercare triage queue empty or tracked
- Day-30 retro committed

---

## 13. Pilot dossier contract

Every registered pilot has a dossier at `docs/pilots/<pilot-id>/dossier.md` containing:

- **Identity:** pilotId, archetype, country, calendarSystem, primaryAcademicYearId
- **Source:** how the calendar data was obtained (printed calendar, PDF, operator entry)
- **Academic structure summary:** N terms, exam windows, AY boundary, cross-year markers
- **Holiday summary:** N blocks, N single-day, source authority
- **Programs:** count + categories
- **Bell schedule:** number of shifts, scope per shift, periods per shift
- **gradeLevels in scope:** which descriptors apply
- **gradingScale:** numeric scale + pass threshold (verify with admin in C13.2)
- **Admin contact:** name, email, phone
- **Onboarding session date:** TBD until C13.2
- **C12 evidence artifacts:** links to rehearsal video, gap list, prod-shadow log
- **C13 launch artifacts:** prod tenant ID, first-login audit log, hypercare triage

The dossier is the only place pilot-specific facts live. No code reads from this file; the fixture JSON under `packages/pilot-fixtures/pilots/<pilot-id>/` is the machine-readable source of truth. The dossier is the human-readable companion.
