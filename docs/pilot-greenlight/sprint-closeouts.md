# Pilot Greenlight — Sprint Closeouts

Per [docs/pilot-greenlight/sprint-plan.md](sprint-plan.md) §11 "Definition of Done (per sprint)", each sprint's closeout lives here. Entries are appended chronologically; the most recent sprint is at the top.

---

## Sprint A.2 — Course Extension + CDC Curriculum Foundation (V1 Master EPIC — first EPIC-A sprint)

**Closed:** 2026-05-22
**Goal:** Extend the `Course` entity with curriculum-specific descriptors (`academicSubject`, `stateSubjectCode`, `curriculumRef`) so downstream EPIC-A (Exam → Result) + EPIC-D (BLE/SEE/NEB) sprints can reference the Ed-Fi V6 descriptor on Course rather than building a separate Subject entity. Seed the PABSON CDC NCF 2076 catalog (Grades 4-10) as Edge data + backfill dev-pabson-primary.
**Outcome:** All 5 tickets (A.2.1–A.2.5) shipped to prod across 3 PRs. shared-types `0.56.0` published; academics ECS rolled (image `sha256:5982b8…`); A.2.5 backfill executed on dev-pabson-primary with 17 creates + 4 patches, idempotency proven on re-run (19 SKIP + 2 documented WARN). Sprint plan + Core/Edges architecture principle codified at `docs/pilot-greenlight/a2-sprint-plan.md` §1.5. Unblocks ~28 downstream V1 tickets: A.3 Exam Subsystem, A.4 Result Subsystem, D.3 ExternalAssessment family, D.4 BLE / D.5 SEE / D.6 NEB-11/12.

### Tickets

| Ticket | PR | Status |
|---|---|---|
| A.2.1 — Course entity + `AcademicSubjectDescriptor` (15 values) + `curriculumRef` + `stateSubjectCode` | [#152](https://github.com/shoaibrain/edforge/pull/152) (Phase 1) + [#153](https://github.com/shoaibrain/edforge/pull/153) (Phase 2 entity side) | ✅ shipped; existing `courseSubjectAreaSchema` (Ed-Fi V6 rollup) untouched — coexists with the new granular descriptor |
| A.2.2 — Course CREATE/PATCH validation pass-through (Zod pipe at controller layer enforces enum; service is pass-through) | [#153](https://github.com/shoaibrain/edforge/pull/153) | ✅ shipped |
| A.2.3 — `subjectArea` ↔ `academicSubject` dual-write mapper (one-way granular → coarse; reverse intentionally not provided — ambiguous) | [#153](https://github.com/shoaibrain/edforge/pull/153) | ✅ shipped; pure function, 18 spec assertions covering all 15 descriptor values |
| A.2.4 — PABSON CDC NCF 2076 Course catalog seed (21 templates, Grades 4-10; Grades 1-3 V1.5; Grades 11-12 Sprint D.6) | [#152](https://github.com/shoaibrain/edforge/pull/152) | ✅ shipped; `PABSON_COURSE_CATALOG` exported from `@aibrains/shared-types` |
| A.2.5 — dev-pabson-primary Course backfill (authenticated API-based; dry-run + apply + idempotency re-check) | [#154](https://github.com/shoaibrain/edforge/pull/154) | ✅ executed against school `4209e3d8-…` (emis 888888888); 17 CREATE + 4 PATCH all OK; idempotent re-run = 19 SKIP + 2 WARN (documented `NCF-MATH-G910` ↔ `NCF-OPMATH-G910` overlap); deploy log local at `docs/deploys/dev-pabson-backfill-courses-20260522-202352-46e04c5.log` |

### Deploy artifacts

- `@aibrains/shared-types` `0.55.0` → `0.56.0` on npm
- academics ECR image `sha256:5982b839f5dced1a66d2789be6c90f8cd0e31717b4661abf84053e83ae9941d9` tagged `ff704e3-20260523005253` + `:latest`
- academics ECS deployment `ecs-svc/2788486331947289791` on `prod-basic/academicsbasic` (ap-south-1) — `rolloutState: COMPLETED`, steady state at 20:00:01
- AdminWeb jsdom bundle sim passed (`main.feea19a4.js`, root HTML 1056 chars) — AdminWeb pin stays `^0.40.0` (no behavior change in A.2; controlplane redeploy not needed)
- dev-pabson-primary backfill against school `4209e3d8-d2e2-4e0e-9961-790341c264f4` in tenant `21aea5da-511f-4dfa-a6f2-6971f63a719f`

### Architecture invariants preserved

| # | Invariant | A.2 evidence |
|---|---|---|
| 5 | `auditedWrite()` on every write | Existing courses.service.ts audit/event pattern unchanged; new fields ride through same path |
| 6 | Domain event registry | `course.created` + `course.updated` events fire on POST/PATCH per existing emit-sites; payload structure unchanged (new fields are additive on Course entity, not on event schema) |
| 8 | No code branches on `tenant.archetype` | A.2.2 + A.2.3 service code reads enums only; PABSON catalog lookup happens in the BACKFILL SCRIPT (under `scripts/`), not in academics src. `grep -rn 'archetype' server/application/microservices/academics/src/` stays clean. |
| 11 | Ed-Fi extension namespace `edforge:` is the only place new descriptors land | `AcademicSubjectDescriptor` is a Core Ed-Fi V6 concept (descriptor on Course; per research artifact §2.1). `curriculumRef` enum was already in shared-types from Sprint 0.4. No new `edforge:` descriptors added. |
| 13 | No pilot-specific names in code | Backfill script accepts `--tenant-id`/`--school-id` env vars, never hardcodes Saraswati or any pilot ID. PABSON catalog lives in `archetype/` (allowed pattern, archetype-scoped not pilot-scoped). Grep across the 6 new files returns zero `saraswati` / `pabson-saraswati` hits. |

### Architecture principle codified (load-bearing for downstream EPIC-D)

§1.5 of the sprint plan made the **Core Ed-Fi V6 + Edges by archetype** discipline explicit:
- **Core (archetype-blind):** descriptors in `packages/shared-types/src/descriptors/`, schemas in `packages/shared-types/src/schemas/academics/`, service code in `server/application/microservices/academics/src/courses/`. None of this reads `tenant.archetype`.
- **Edge (archetype-scoped):** catalogs + seeds in `packages/shared-types/src/archetype/`. PABSON Course catalog lives here. Future archetype-specific data (BLE CDC rubric in D.4.2, SEE 25/75 weight in D.5.2, NEB stream electives in D.6) follows the same pattern.
- **Operator tooling:** `scripts/backfill-pabson-courses.ts` reads Edge data + writes Core entities via authenticated API. Same pattern applies to future archetype-specific backfills.

Every downstream EPIC-D sprint should reference this principle. Getting it right in A.2 prevents archetype-bleed in 28 downstream tickets.

### Decisions captured

1. **Service-side auto-derive deferred.** Master plan A.2.3 literal text called for `createCourse` to auto-derive `subjectArea` when absent + `academicSubject` provided. Since `subjectArea` remains REQUIRED at the API in V1, that auto-derive would be dead code at the service layer. Mapper function exists + is spec'd + is consumed by A.2.5 backfill. Auto-derive can land V1.5 if `subjectArea` relaxes to optional via Zod refinement.
2. **GSI on `Course.curriculumRef` deferred.** Not pilot-scale needed (per-school partition scan with filter handles ≤100 courses/school). Add post-pilot-2 if multi-tenant aggregate queries demand it. Documented in sprint plan §2 out-of-scope.
3. **Prod Saraswati Course backfill out of scope.** Per CEO 2026-05-22: prod Saraswati school has no Course data yet. A.2.5 targets `dev-pabson-primary` only in V1. Operator will create courses via UI when ready to onboard the Term-1 exam workflow.
4. **No specs in `scripts/`.** Existing repo convention: `scripts/backfill-*.ts` ship without specs; operator dry-run review IS the test. Initial `backfill-pabson-courses.spec.ts` was deleted to match.

### Edge cases documented

- **Catalog grade-band overlap on shared derived `subjectArea`:** `NCF-MATH-G910` (Compulsory Math) and `NCF-OPMATH-G910` (Optional Math) both derive to `subjectArea='mathematics'` + span Grades 9-10. After apply, each template's matcher sees BOTH rows as candidates → WARN on idempotency re-run. Both rows correctly exist with different `academicSubject` values. Operator disambiguates manually if ever needed. Not a bug — known data-model artifact.
- **Dual-targeting on single-match PATCH:** On the pre-apply diff, `NCF-SCI-G45` + `NCF-SCI-G68` both single-matched `SCI001` (which spans G5,6,7); each queued a PATCH targeting the same row. Second PATCH wrote the same `academicSubject='science'` value — idempotent no-op functionally, 2 extra audit rows per affected row. Documented in script docstring + PR #154 description.

### Backlog surfaced (NOT in scope for A.2)

- **6 pre-existing failing academics test suites** (queryGSI signature drift in `listCourses` + grades-spec mock setup) untouched per memory `project_grade_level_fix_sprint_closed`. Tech-debt cleanup eligible for a separate sprint.
- **AdminWeb / saas-frontend academics MFE UI for the 3 new Course fields** — not wired; deferred until operator UI demand surfaces. AdminWeb pin stays at `^0.40.0`.
- **Prod Saraswati backfill** — when Saraswati's operator onboards Term-1 exam workflow, run the same `scripts/backfill-pabson-courses.ts` against the prod Saraswati tenant + school. Or operator creates via UI.
- **Service-side auto-derive of `subjectArea`** — V1.5 candidate if `subjectArea` ever relaxes to optional.
- **`stateSubjectCode` authoritative CDC code population** — V1 best-guess scope left this undefined. Operator populates per-course when source doc is in hand.

### Dependency graph — next up

```
A.2 (DONE) → A.3 (Exam Subsystem; needs A.2 + D.1 — both DONE) → A.4 (Result Subsystem; needs A.3 + D.1)
A.2 (DONE) → D.3 (ExternalAssessment family; needs A.2.1 for Course.academicSubject FK) → D.4 BLE (needs D.1 + D.3) / D.5 SEE (needs D.3 + D.2) / D.6 NEB-11/12 (needs D.3)
```

Critical-path candidates for next sprint pickup (per memory `project_sprint_a2_shipped_prod` follow-ups):
- **A.3 Exam Subsystem** — natural EPIC-A continuation; ExamCourse + ExamScore + state machine; ~11 tickets
- **D.2 PromotionRule** — unlocks cross-year handoff (D.2.7–12) + D.4.8 + D.5.5 promotion rules; ~12 tickets
- **C.1 School Branding** — starts EPIC-C (Document Rendering) chain; parallel-eligible
- **A.1 Daily-Use Coverage** — small operator-visible polish; audit-driven

---

## Sprint E.0 — IEMIS Reporting Schema Extensions (V1 Master EPIC — third execution sprint)

**Closed:** 2026-05-22 (PM Phase 7 deploy window)
**Goal:** Land three additive schema extensions on existing entities to unblock Sprint E.1 (Flash I/II) and v3.4.1-expanded Sprint D.3.1 (`ExternalExamRegistration.municipalityId` FK).
**Outcome:** All 3 tickets shipped to prod via PR #138. Phase 7 deploy window also closed the **Sprint 0.4 deferred work** (shared-infra-stack + rproxy) that was Docker-blocked in the AM session. Both sprints now fully on prod.

### Tickets

| Ticket | PR | Status |
|---|---|---|
| E.0.1 — `Student.hasEcedExperience` (Flash I Grade 1 entrant flag) + IEMIS transformer (4 alias columns; 14 new specs) | [#138](https://github.com/shoaibrain/edforge/pull/138) | ✅ shipped to prod (academics image sha256:a672904b) |
| E.0.2 — `SchoolConfiguration.municipalityConfig` (per-school municipality binding; FK target for D.3.1 + render input for D.4.5) | [#138](https://github.com/shoaibrain/edforge/pull/138) | ✅ shipped (identity image sha256:72e4d097); live smoke verified PATCH + GET round-trip on Sunshine Private Academy (dev-pabson-primary) |
| E.0.3 — `Student.scholarshipAmountNpr` (Flash II col 7; optional; harmless if IEMIS rejects) | [#138](https://github.com/shoaibrain/edforge/pull/138) | ✅ shipped |

### Phase 7 deploy artifacts (also CLOSED Sprint 0.4 deferred items)

- shared-types `0.53.0` published
- identity image `sha256:72e4d097da9980baff155e71d2b2de12c3e61d7b735c50aeae613be4d420c965`
- academics image `sha256:a672904ba1261c5dc8470052a95ef0f65b69a3f23ac041e3f200300fb20ba71d`
- shared-infra-stack deployed (213s) — `/archetype-defaults` API GW path live
- rproxy image `sha256:a66d65c42e08f1a9877ef40d053296032813d666b77610a5b1bbf02c817eef4c` — nginx `^/archetype-defaults` location block live
- All services-stable; full deploy log refs in [INDEX.md 2026-05-22 PM entry](../deploys/INDEX.md)

### Architecture invariants preserved

| # | Invariant | Evidence |
|---|---|---|
| 5 | `auditedWrite()` on every write | Existing `computeFieldChanges` + audit emit path covers new `municipalityConfig` automatically |
| 6 | Domain event registry | Existing `school.configuration.updated` payload covers new field |
| 8 | No service-code archetype branches | Pure schema extension; lint stayed clean |
| 12 | Lint script gating | ✅ 29 files scanned; same allowlist as Sprint 0.4 |

### Live smoke results

`GET /archetype-defaults?archetype=PABSON` → 200 OK with full PABSON profile (NG + Forms-7/2/19-excluded + BLE-supplementary all verified).

`PATCH /schools/3c28654f-c623-449b-8211-67c729784d37/configuration` with `municipalityConfig` payload → 200 OK on Sunshine Private Academy in dev-pabson-primary tenant; independent GET confirms persistence + no other field clobbered.

### Retros from Phase 7

- **Two prod deploys in one day on a single SHA is fine** when the second closes the first's deferred work; capture rollback markers at both windows
- **Docker recovery from 2026-04 + 2026-05-22 AM is repeatable:** `docker builder prune -af` reclaims 21-28 GB consistently
- **CDK shared-infra-stack diff was clean** — only 1 new path + expected RestApi/Deployment refresh; no Cognito/IAM/VPC drift
- **rproxy ECS roll is slowest** (~9 min vs ~4-5 for identity/academics); document for ops planning
- **Cognito 1h JWT TTL caught us** (memory R12); refresh just before smoke

### Sprint partial-ship debt cleared

The 2026-05-22 (AM) Sprint 0.4 entry noted three deferred items: shared-infra-stack redeploy, rproxy ECR/ECS, external HTTP smoke verification. **All three closed in this PM window.**

### Dependency graph — next up

Per v1-master-epic-breakdown.md §12: **Sprint E.1** (Flash I/II MVP) is the next execution target. Consumes Sprint E.0 schema extensions (hasEcedExperience for Flash I col 14; scholarshipAmountNpr for Flash II col 7; municipalityConfig for per-school CSV header overrides) + Sprint 0.4 ArchetypeDefaultsService via DI.

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
