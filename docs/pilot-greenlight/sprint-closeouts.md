# Pilot Greenlight — Sprint Closeouts

Per [docs/pilot-greenlight/sprint-plan.md](sprint-plan.md) §11 "Definition of Done (per sprint)", each sprint's closeout lives here. Entries are appended chronologically; the most recent sprint is at the top.

---

## Sprint 0.4 — `ArchetypeDefaults` Entity (V1 Master EPIC — second execution sprint, partial-ship)

**Closed:** 2026-05-22
**Goal:** Land the per-archetype academic-policy defaults foundation that all of EPIC-D depends on (D.1 GradingPolicy + D.2 PromotionRule + D.3-D.6 ExternalAssessment family).
**Outcome:** All 6 tickets shipped to main; identity ECR + ECS roll complete on prod; ArchetypeDefaultsService fully functional for service-to-service DI consumption. `GET /archetype-defaults?archetype=` HTTP endpoint deferred-deploy (shared-infra-stack redeploy needed; blocked this session by Docker containerd I/O error — same root cause as the 2026-04 incident). See [`docs/deploys/INDEX.md` 2026-05-22 entry](../deploys/INDEX.md) "Partial-ship status" table for the precise list of what's live vs deferred.

### Tickets

| Ticket | PR | Status |
|---|---|---|
| 0.4.1 — Zod schema + supporting subschemas | [#136](https://github.com/shoaibrain/edforge/pull/136) | ✅ shipped to prod (shared-types 0.52.0 + identity image) |
| 0.4.2 — PABSON profile seed (incl. v3.4.1 NG letter-grade + v3.4 D.4.0 BLE supplementary + v3.4 E.1.0 §7 Forms 7/2/19 EXCLUDED) | [#136](https://github.com/shoaibrain/edforge/pull/136) | ✅ shipped |
| 0.4.3 — GENERIC profile seed (Sprint F.2 archetype-agnostic proof target) | [#136](https://github.com/shoaibrain/edforge/pull/136) | ✅ shipped |
| 0.4.4 — ArchetypeDefaultsService (loader, cache, fail-loud) + module + 8 specs | [#136](https://github.com/shoaibrain/edforge/pull/136) | ✅ shipped |
| 0.4.5 — `GET /archetype-defaults` controller + 5 specs + three-way handoff | [#136](https://github.com/shoaibrain/edforge/pull/136) | ⏳ **partial** — Nest controller deployed; API GW + nginx rproxy deferred |
| 0.4.6 — Invariant 12 lint script + 29-file empirical allowlist + bash 3.2 compat | [#136](https://github.com/shoaibrain/edforge/pull/136) | ✅ shipped |

### Deploy artifacts

- shared-types `0.52.0` — published to npm (user-executed)
- identity image `sha256:3aa98441f9cc284f0d185c821e01a2064378551dfee47829bddb565d40251e74` tagged `b166767-20260522162512` + `:latest`
- ECS `prod-basic/identitybasic` rolled to new image; service stable 2026-05-22 11:30:49 CDT
- Logs: `prod-build-application-identity-20260522-112504-b166767.log` + `prod-ecs-roll-identitybasic-20260522-112621-b166767.log` + `prod-smoke-archetype-defaults-20260522-…-b166767.log` + `prod-cdk-diff-shared-infra-stack-20260522-113546-b166767.log` (failed; documented as deferred)

### Architecture invariants preserved

| # | Invariant | Evidence |
|---|---|---|
| 5 | `auditedWrite()` on every write | n/a — read-only static data |
| 6 | Domain event with registry schema | n/a — no domain actions |
| 8 | No service-code archetype branches | New module is data-driven; lint enforces |
| 11 | Ed-Fi extension namespace `edforge:` | n/a — no new descriptors |
| 12 | Lint script ships in this sprint | ✅ `check-invariant-12.sh` + 29-file allowlist; runs in CI |
| 13 | No pilot-specific names | Profile names `PABSON` / `GENERIC` only |

### Backlog surfaced (NOT in scope for 0.4)

- **shared-infra-stack redeploy** — needed to expose `GET /archetype-defaults` via API GW. Blocked this session by Docker containerd I/O error during CDK synth (Python Lambda build for CognitoAuth in control-plane-stack). Pick up at next Docker-healthy session.
- **rproxy ECR push + ECS roll** — nginx.template has the new `^/archetype-defaults` location block but rproxy hasn't been rebuilt. Same redeploy window as API GW.
- **2 pre-existing PABSON branches in `schools.service.ts`** — allowlisted as `(T)` tech debt during 0.4.6 empirical scan. Lines 214 + 367. Should be migrated to data-driven via `ArchetypeDefaults.complianceForms.includes('IEMIS_FLASH_I')` or per-archetype validation rule registry. Phase D refactor backlog item.

### Retros from this sprint window

- **`build-application.sh` must be invoked from `scripts/` directory.** First attempt from repo root failed `cd: ../server/application: No such file or directory`. Memory `project_grade_level_fix_T4_shipped.md` notes this; pattern re-confirmed.
- **bash 3.2 compat matters on macOS.** First version of `check-invariant-12.sh` used `mapfile` (bash 4+). Rewrote with `while IFS= read -r line; do array+=("$line"); done < <(...)`.
- **Empirical lint allowlist surfaced 2 pre-existing `archetype === 'PABSON'` branches.** Originally thought identity had zero invariant-8 violations; spot-grep proved otherwise. Allowlisted as (T) instead of refactoring mid-sprint.
- **API Gateway route deploys are a separate ladder rung from ECS rolls.** Memory `edforge_api_gateway_route_registration` says "403 SigV4 = API GW route missing." Three-way handoff lands all 3 files in the same PR, but DEPLOYING all 3 layers takes 2 deploy events (ECS push + shared-infra-stack redeploy). This session caught the ECS half but Docker-blocked the API GW half.
- **Docker containerd I/O errors recur** when disk pressure approaches the snapshot DB limits. Same root cause as the 2026-04 prior session. Symptom + fix pattern is now stable: free disk + restart Docker + `docker builder prune -af`.

### Dependency graph — next up

Per v1-master-epic-breakdown.md §12: **Sprint E.0** (NEW v3.4 — `hasEcedExperience` + `municipalityConfig` + `scholarshipAmountNpr` schema extensions) is the next execution target. These three schema extensions land BEFORE Sprint E.1 Flash I/II MVP and BEFORE Sprint D.4 BLE workflow (E.0.2's `municipalityConfig` is a FK target for the v3.4.1-expanded D.3.1 ExternalExamRegistration entity).

---

## Sprint 0.1 — Operator-Feedback Compounding (V1 Master EPIC — first execution sprint)

**Closed:** 2026-05-22
**Goal:** Close the IEMIS-upload-compounding gaps that would block Saraswati's principal each time she uploaded a new cohort. Per [`v1-master-epic-breakdown.md`](v1-master-epic-breakdown.md) Sprint 0.1, 5 tickets: jobs LIST + transformer extension + descriptor lookup tables + 206-row backfill + job janitor.
**Outcome:** 4 of 5 tickets fully shipped via prior PRs (#131, #132, #133, plus earlier `69969d6` janitor). The fifth ticket (**0.1.3 historical backfill script**) is **reclassified as a deferred data-debt item**, NOT executed as engineering, after two design audits revealed the originally-planned backfill path is not feasible:

### Tickets

| Ticket | Disposition | Evidence |
|---|---|---|
| **0.1.1** — IEMIS jobs LIST endpoint | ✅ Shipped pre-v3.4 | PR #131 (`25500e2`); [`students.controller.ts:350-382`](../../server/application/microservices/academics/src/students/students.controller.ts#L350-L382); route in [`tenant-api-prod.json:9822-9891`](../../server/lib/tenant-api-prod.json#L9822-L9891) |
| **0.1.2a** — IEMIS transformer field extension | ✅ Shipped pre-v3.4 | PR #132 (`6ac5096`); 4 fields (`motherTongueDescriptor`, `sexDescriptor`, `disabilities`, `isTransferred`) populated from XLSX rows in [`iemis-transform.ts:235-315`](../../server/application/microservices/academics/src/students/iemis-transform.ts#L235-L315); 195 LOC new tests |
| **0.1.2b** — IEMIS descriptor lookup tables | ✅ Shipped pre-v3.4 | [`language-descriptor.ts:22-131`](../../packages/shared-types/src/ed-fi/descriptors/language-descriptor.ts#L22-L131) (covers Nepali, Maithili, Bhojpuri, Tharu, Newar, Bajjika, Magar, Doteli, Awadhi, Limbu, Gurung + Devanagari aliases); [`disability-descriptor.ts:18-86`](../../packages/shared-types/src/ed-fi/descriptors/disability-descriptor.ts#L18-L86) (covers 8 CEHRD categories incl. NoDisability with aliases) |
| **0.1.3** — Saraswati 206-row historical backfill | ⚠️ **RECLASSIFIED → deferred data-debt** (not engineering) | See [§17.6 v3.4 breakdown](v1-master-epic-breakdown.md#17-v34-cross-cutting-research-findings--synthesis-new-2026-05-22). Audit revealed: (a) IEMIS import does NOT store the source XLSX (parsed JSON array, in-memory only, discarded post-import); (b) IEMIS import endpoint hard-codes SKIP on duplicate `emisStudentId` rows (no upsert mode). Backfill via re-upload requires new engineering (`mode='upsert'` on the import endpoint, ~half-day). **Decision (CEO, 2026-05-22):** defer; debt surfaces naturally at Sprint E.1.5 pre-flight validation when operator first exports Flash I. Decide remedy then (upsert mode / manual UI / sexDescriptor-only script) with real operator context. |
| **0.1.4** — IEMIS Job Janitor Lambda | ✅ Shipped pre-v3.4 | Commit `69969d6`; [`handler.ts:100-276`](../../server/lib/analytics/lambda/iemis-job-janitor/handler.ts#L100-L276); cron `*/5 * * * ? *` via EventBridge Scheduler; SNS operator-alert wired |

### What this closeout doesn't do (deferred work)

1. **206-row historical backfill** — see 0.1.3 above. Tracked as data-debt; surfaces at Sprint E.1.5 (Flash I/II pre-flight validation). Three remedy paths documented for that sprint to decide between: (i) add `mode='upsert'` to import endpoint, (ii) sexDescriptor-only one-shot script (recovers 1 of 4 fields), (iii) accept debt + submit Flash I with gaps + amend later.
2. **No new engineering branches.** This closeout is a docs-only PR — no NestJS or CDK changes.

### Lessons (for v3.4+ planning hygiene)

- **Always verify "we have the source data" before planning a backfill.** The original 0.1.3 spec assumed XLSX was stashed in S3 — it isn't. Audit-first prevented wasted code.
- **Check the duplicate-handling behavior of any import endpoint before assuming re-upload solves a gap.** Two distinct audits were needed (XLSX stored Y/N → duplicates UPSERT Y/N) to nail down the actual blockers.
- **"Sprint 0.1.3 not done" ≠ "Sprint 0.1 not closed."** 4 of 5 tickets shipped; the 5th was scoped on a wrong assumption; declaring functionally closed with documented debt is the honest call.

### Dependency graph — next up

Per v1-master-epic-breakdown.md §12: Sprint 0.4 (`ArchetypeDefaults` entity) is the next execution target — hard-dep for all of EPIC-D (D.1 GradingPolicy + D.2 PromotionRule + D.3 ExternalAssessment family + D.4 BLE + D.5 SEE + D.6 NEB-11/12).

---

## Sprint C0.c — Event Emission Foundation

**Shipped:** 2026-05-16
**Deployed to prod:** 2026-05-16 (~15:30 UTC) — see [docs/deploys/INDEX.md](../deploys/INDEX.md#2026-05-16--sprint-c0c3-activate-eventservicebase-runtime-event-validation)
**Goal:** EventBridge bus + schema registry + emitter integration so invariant 6 ("every domain action emits an event with a registry schema") is enforceable. Per the redirect agreed before C0.c.1, **the plan's framing was overstated** — the SBT EventBridge bus and EventServiceBase publisher already existed and were already wired into every microservice. The real gap was runtime Zod validation of event payloads. This sprint closed that gap.
**Outcome:** All three tickets shipped, plus the publish-gate follow-up. Code on prod across identity / academics / finance; validation gate active; smoke 32/33 (= 2026-05-14 baseline). Sprint C0.e (deferred per operator decision — see [deferred-work.md](deferred-work.md)) and Sprint C1 (pilot fixture engine) are unblocked.

### Tickets

| Ticket | PR | Status |
|---|---|---|
| C0.c.1 — Verify event bus infrastructure (no new stack) | [#73](https://github.com/shoaibrain/edforge/pull/73) | merged |
| C0.c.2 — Domain event taxonomy — 25 Zod schemas | [#74](https://github.com/shoaibrain/edforge/pull/74) | merged |
| Publish + consumer-pin bumps (`@aibrains/shared-types@0.43.0`) | [#75](https://github.com/shoaibrain/edforge/pull/75) | merged |
| C0.c.3 — Runtime event validation in EventServiceBase | [#76](https://github.com/shoaibrain/edforge/pull/76) | merged |

### Demo

- **C0.c.1** — Locked the EventServiceBase contract with 8 new tests (the class had zero coverage before, despite carrying every domain event in prod). Wrote [docs/pilot-greenlight/event-infrastructure.md](event-infrastructure.md) codifying that the SBT bus is canonical (no second bus, no AWS Schema Registry duplicate) and what C0.c.2 + C0.c.3 close.
- **C0.c.2** — 25 Zod schemas in `packages/shared-types/src/events/` covering the V1 universe (school 4, AY 3, term 3, enrollment 4, attendance 2, exam 3, result 1, reporting 2, calendar.block 3). `EVENT_REGISTRY` + `DomainEvent` discriminated union + `validateEvent()` helper. 56 new tests; 444/444 shared-types regression green. Snake-dotted naming (`school.created`) per the plan; existing ~110 PascalCase publishers stay loose-typed and migrate as their owners are touched.
- **C0.c.3** — `publishValidatedEvent(event: DomainEvent)` typed entry point added; `publishEvent` + `publishEvents` now run `validateBeforeEmit` per event. Three branches: registered+valid → emit, unregistered (legacy PascalCase) → log warning + emit (backward compat), registered+invalid → SKIP emit + DLQ hook. 6 new tests covering every branch × single + batch paths.

### Architecture invariants — preserved

| # | Invariant | C0.c evidence |
|---|---|---|
| 5 | Every write goes through `auditedWrite()` | unchanged; this sprint only touches event emission, not the write path |
| 6 | Every domain action emits an event with a registry schema | **closed by C0.c.2 + C0.c.3** — schemas exist, runtime validation fires for registered events, INVALID_PAYLOAD events are routed to DLQ instead of corrupting the bus |
| 7 | No silent fallbacks | the legacy PascalCase branch logs a structured warning surfacing migration debt — not silent |
| 8 | No archetype branching | event schemas are descriptor-driven; consumers route on `reportType: string` etc., not archetype |
| 11 | Ed-Fi extension namespace `edforge:` is the only place new descriptors land | no descriptors added |
| 13 | No pilot-specific names in code | grep across the 13 new files in C0.c.2 + EventServiceBase changes returns zero hits |

### Backlog surfaced (NOT in scope for C0.c)

- **ESLint rule** — plan's "lint asserts every `auditedWrite()` paired with `emitEvent()`" deferred to a follow-up ticket. A proper AST-walking custom rule + tests is ~200-300 lines on its own; splitting kept C0.c.3 reviewable.
- **Deploy ladder for the new runtime validation** — code is on `main` but no microservice has deployed the new EventServiceBase yet. Activation requires identity ECR push + ECS roll (most events live here), then verify CloudWatch logs for unexpected `INVALID_PAYLOAD` entries, then academics + finance. Operator-authorized step, not engineering-blocked.
- **PascalCase → snake-dotted migration** for the ~110 existing publishers (`IdentityEventsService.publishSchoolCreated` → emit `school.created` etc.). Migrate per-domain as future sprints touch their owners (C5 exam, C7 result, C9 enrollment promotion, etc.). Each migration is a small backwards-compat-safe rename + schema-fixture-rewrite per call site.

### Dependency graph — next up

```
C0.a (DONE) → C0.c (DONE) → C0.e (compliance declarations, can parallel C1) → C1 (pilot fixture engine) → C2 (greenlight gate)
```

Either C0.e or C1 can start now. C0.e has policy / legal lead time; C1 is the critical-path engineering work.

---

## Sprint C0.a — Calendar-Blocking Verifications

**Shipped:** 2026-05-15
**Goal:** Verify prerequisites for calendar fidelity work are already in place. Anything not verified is fixed here.
**Outcome:** All three tickets shipped. Sprint C0.c (event emission foundation) is unblocked per the §7 dependency graph.

### Tickets

| Ticket | PR | Repo | Status |
|---|---|---|---|
| C0.a.1 — Verify S0.2 `School.academicCalendarType` removed | [shoaibrain/edforge#70](https://github.com/shoaibrain/edforge/pull/70) | server | merged |
| C0.a.2 — Verify S0.4 `calendarSystem` in `SchoolConfiguration` response | [shoaibrain/edforge#71](https://github.com/shoaibrain/edforge/pull/71) | server | merged |
| C0.a.3 — D1.4 BS converter dedupe in frontend | [shoaibrain/edforge-saas-frontend#59](https://github.com/shoaibrain/edforge-saas-frontend/pull/59) | frontend | merged |

### Demo

- **C0.a.1 + C0.a.2:** four new cross-service spec files in `server/application/microservices/identity/src/__tests__/c0-a-1-*.spec.ts` + `c0-a-2-*.spec.ts` lock the S0.2 and S0.4 response contracts at the integration level. 9 new tests, all green. Existing 63 schools-service tests still green — no regressions.
- **C0.a.3:** frontend `packages/date-utils/` no longer carries a local BS lookup table. `adToBS` / `bsToAD` / `getDaysInBSMonth` are now thin wrappers around `@aibrains/shared-types`' `gregorianToBs` / `bsToGregorian` / `getBsMonthDays`. The 49-test `converter.test.ts` suite passes byte-equal under the new implementation (including 7 round-trip dates + 9 known AD↔BS pairs + the `getDaysInBSMonth(9999, 1) === 30` silent fallback). Existing consumers (`DateDisplay`, `BSDateInput`, attendance dashboard, calendar layout, header) compile + run unchanged.

### Architecture invariants — preserved

| # | Invariant | C0.a evidence |
|---|---|---|
| 4 | Dated entities accept BS or AD on input | C0.a.3 preserves the local converter's TZ-safety via the `T12:00:00` parse trick around shared-types' canonical converter. |
| 6 | Every domain action emits an event with a registry schema | No new write paths in C0.a; nothing to emit. C0.c will introduce the registry. |
| 8 | No code branches on `tenant.archetype` | C0.a.2's test names use `'PABSON-shaped'` / `'GENERIC-shaped'` as test descriptors; code paths are identical. |
| 11 | Ed-Fi extension namespace `edforge:` is the only place new descriptors land | No descriptors added. |
| 13 | No pilot-specific names in code | Grep across the three new spec files + the frontend converter changes returns zero hits on `saraswati` / `pabson-saraswati`. Generic identifiers (`tenant-c0a1`, `school-c0a2`, etc.) throughout. |

### Backlog surfaced (NOT in scope for C0.a)

- **S0.2 storage-layer residue** — `School` TS entity, `schoolEntitySchema`, `createSchool` write path, `CONFIG_LOCKED_FIELDS`, `field-governance.ts`, AdminWeb workspace-settings field-lock map all still carry `academicCalendarType`. Stripping requires a data migration (separate ticket, P1 timing per the existing schools.service comments).
- **S0.4 read-source refactor** — `getConfiguration()` reads `calendarSystem` from `school.calendarSystem` (denormalized copy), not from `WorkspaceSettings.regional.defaultCalendarSystem` directly. Drift is prevented by provisioning convention + deprecation warning on `updateSchool`. P1 (per Midnight Lockin decision #3) will strip the school-level field; the C0.a.2 spec then becomes the regression guard for whichever read path replaces it.
- **Bundle size verification for C0.a.3** — left as a backlog item: actual production bundle size delta after Vercel rebuild has not been measured. The local 105-line table deletion is the lower-bound; tree-shaking + shared-types co-bundle in other packages may yield a smaller net delta.

### Dependency graph — next up

```
C0.a (DONE) → C0.c (event emission foundation) → C0.e (compliance declarations) → C1 (pilot fixture engine) → C2 (greenlight gate)
```

C0.c.1 (EventBridge bus + schema registry per tenant) is the immediate next ticket.

---
