# V1 Platform Hardening — Sprint Plan

> **Status:** revised 2026-06-02 after duplication audit. Previous draft proposed
> 6 sprints; ~3 of them duplicated work already shipped or already planned.
> See `/tmp/saraswati-hardening-sprint-plan.draft.md` for the original draft
> and the duplication audit summary at the end of this file.
>
> **Trigger.** First-pilot validation against the PABSON archetype, using
> Saraswati School (`<first-pilot-tenant-uuid>` in prod) as the
> first pilot in production, surfaced one new bug (GradingPolicy seed never
> fires on read path), one undocumented design intent (school-first grade-level
> codes), one architecture-framing error in CLAUDE.md, and 3 items already-
> planned-but-not-yet-executed (Midnight Lockin P1, bell schedule archetype
> defaults, IEMIS Flash grade-code transform).
>
> **Scope.** Platform-level hardening for V1, scoped to the PABSON archetype
> because that's the only governance body in production today. Saraswati is the
> *validation catalyst*, not the subject — every ticket here lands for all
> current and future PABSON pilots, and every architectural decision generalizes
> to new archetypes. Architecture must remain scalable to future governance-body
> archetypes (CBS for public Nepal schools, NGO-run, etc.) — never branch on
> `country === 'NPL'` for what should be archetype-keyed logic.

---

## Architecture framing (correction)

`Tenant.archetype` is a **governance-body classification**, not a school-size
or community-flavor label. Each archetype represents a distinct governance body
with its own reporting structure, curriculum mandates, and operational defaults:

- **PABSON** — Private and Boarding Schools Organization Nepal. V1 pilots
  (incl. Saraswati) operate under this.
- **CBS** (future) — government Central Bureau for public Nepal schools.
- **NGO-run** (future) — NGO-operated schools.
- **GENERIC** — null-governance fallback.

CLAUDE.md L28 currently mis-frames PABSON as "the Nepal community-school
archetype." Sprint A.1 fixes this.

---

## Already done — do not re-build

Critical to acknowledge before any new ticket:

| Surface | Status | Cite |
|---|---|---|
| Holiday seed catalogue | **End-to-end shipped (C3.3 / C3.6 / C3.8)** | [`HOLIDAY_SEEDS`](../../packages/shared-types/src/locale/holiday-seeds/index.ts) registry + [`pabson-npl-2083.json`](../../packages/shared-types/src/locale/holiday-seeds/pabson-npl-2083.json) (6 blocks + 13 single-day) + `GET /holiday-seeds` endpoint + integration with `POST .../generate-calendar` accepting `holidays[]` payload. Saraswati's 0-holidays state is operator-pending, not engineering-pending. |
| MFE regional hydration | **Shipped** | `GET /tenants/my/settings` at [tenants.controller.ts:49-58](../../server/application/microservices/identity/src/tenants/tenants.controller.ts#L49-L58) is the canonical hydration endpoint for MFEs to resolve currency/calendar/locale. No "RegionalResolverService" needs to be built. |
| Bell schedule `isDefault` toggle | **Shipped** | Full toggle mechanism with "clear-old-when-set-new" semantics in [bell-schedule.service.ts:488](../../server/application/microservices/identity/src/schools/bell-schedule.service.ts#L488). Only archetype-seeded defaults + activation gate are missing. |
| Calendar multi-day blocks | **Shipped (C4 + C4-followup)** | Full CRUD in [calendar-blocks/](../../server/application/microservices/identity/src/calendar-blocks/). Used by `holidays[]` payload to `generate-calendar`. |
| School-level regional field deprecation (Phase 0) | **Shipped (Midnight Lockin P0.17)** | Deprecation warning at [schools.service.ts:529-543](../../server/application/microservices/identity/src/schools/schools.service.ts#L529-L543) for `timezone/locale/calendarSystem/academicCalendarType` writes. P1 (entity removal) is planned but not yet executed — see Sprint D below. |
| Grade-level descriptor aliases (PG/NUR→ECD, LKG/UKG→PPC) | **Shipped** | Alias map in [grade-level-descriptor.ts:51,64](../../packages/shared-types/src/ed-fi/descriptors/grade-level-descriptor.ts#L51). Resolution via `resolveDescriptor`. The mapping function exists; only the Flash I/II generator wiring is missing. |
| GradingPolicy `buildSeedFromArchetype` | **Shipped (D.1.3)** | Builder at [grading-policy.service.ts:322](../../server/application/microservices/academics/src/grades/grading-policy.service.ts#L322). Only the read-path-fallback caller is missing. |

---

## Findings to address

| ID | Finding | Truly new work? |
|---|---|---|
| F-DOC-1 | CLAUDE.md L28 mis-frames archetype; school-first design undocumented | YES — Sprint A |
| F-GRADE-1 | `listGradingPolicies` doesn't fall through to seed builder; Saraswati has 0 policy rows; legacy 32-pass scale is operative | 🟡 In flight — Sprint B. **B.1 reconciliation (2026-06-04):** the *compute* path (`gpa-calculator`, `grades.service`) already lazily seeds via `getDefaultPolicyEntity`→`ensureDefaultPolicy` (D.1.3), and no `32`/legacy-scale literal exists in `grades/` — so the "32-pass operative" symptom is likely already resolved on the compute path (re-validate against deployed state). Remaining real gaps: (a) `listGradingPolicies` still returns `[]` without seeding (list ≠ compute), (b) the seed `putItem` ([grading-policy.service.ts:253](../../server/application/microservices/academics/src/grades/grading-policy.service.ts#L253)) has no concurrency guard. B.2/B.3 reframed to **harden seed (conditional write) + wire list path**. |
| F-BELL-1 | Default bell schedule is placeholder "Regular Day"; archetype defaults not seeded at provisioning; no activation gate | YES — Sprint C |
| F-REG-1 / F-REG-2 | School-level regional override fields still exist on `School` + `SchoolConfiguration` entities | NO — execute Midnight Lockin P1 (Sprint D) |
| F-IEMIS-1 | Flash I/II generators don't apply existing descriptor aliases to grade-level columns | YES (small) — Sprint A.3 |
| F-IEMIS-2 | PABSON archetype guard for `emisSchoolCode` at school create missing (Midnight Lockin audit S-2) | YES (small) — Sprint A.4 |
| F-DRIFT-1 | `COUNTRY_DEFAULTS` missing `defaultTimeFormat` for USA/IND (Midnight Lockin P1-d) | YES (cosmetic) — Sprint A.5 |
| F-CAL-1 (operator) | Saraswati BS 2083 calendar has 0 holidays | NOT engineering — operator runs `holidays[]` payload via existing UI |

---

## Sprint order

```
Sprint A   Architecture framing + small surgical wirings           [1-2 days]
Sprint B   GradingPolicy seed-on-empty                              [1-2 days]
Sprint C   Bell schedule archetype defaults + activation gate       [2-3 days]
Sprint D   Execute Midnight Lockin P1 (school regional removal)     [3-5 days, gated]
```

Sprint A can ship in parallel with B or C; D depends on Midnight Lockin P0
already being in production (it is) and follows the existing P1 plan.

---

## Cross-sprint conventions

- **Every ticket = one commit + one PR.** If a ticket reads like 3 days, split it.
- **Every ticket has a `Validation` line.** Test, dynamodb-local integration,
  route-shape test, or explicit smoke against dev-pabson-primary.
- **CLAUDE.md traps apply:** 3-way route registration, module-wiring invariant,
  shared-types caret-pin bump, 2-repo git hygiene.
- **Frontend tickets start with URL→router→page→tab→component trace** pasted
  into the commit body.
- **Saraswati live smoke** is the sprint closeout — STOP condition + rollback
  link in each closeout ticket.

---

## Sprint A — Architecture framing + small surgical wirings

**Goal.** Fix the CLAUDE.md framing error so future contributors don't misread
the design. Wire the existing descriptor-alias resolution into the Flash I/II
generators so IEMIS reports actually map school codes to CEHRD canonical.
Close two small Midnight Lockin audit gaps (S-2 + P1-d).

**Demo.** CLAUDE.md has corrected archetype framing + new school-first section.
Flash I generator on a PABSON fixture outputs ECD/PPC for PG/NUR/LKG/UKG
students. PABSON school-create without `emisSchoolCode` returns 400.

### Tickets

| # | Title | Validation |
|---|---|---|
| A.1 | CLAUDE.md: replace "PABSON, the Nepal community-school archetype" at L28 with "PABSON — the Private and Boarding Schools Organization Nepal governance body." Add a new "School-first architecture" subsection under "Archetype model" (after L308): document that school carries operator-chosen local grade codes (PG/NUR/LKG/UKG/etc.); CEHRD canonical (ECD/PPC) is a *report-time projection* via descriptor aliases at [grade-level-descriptor.ts:51,64](../../packages/shared-types/src/ed-fi/descriptors/grade-level-descriptor.ts#L51); explicit "don't flag school codes as a regression" anti-trap. Add 1-line cross-link from `dossier.md` Notes. | Doc lint passes; reviewer confirms cite. |
| A.2 | Reframe the `archetype-defaults.ts` JSDoc header (and any related comments) to call out "governance body" framing. No code changes — pure comment edit. | Diff is comments-only; `npm test` runs unchanged. |
| A.3 | Add `transform: 'schoolGradeToCanonical'` enum value + handler in `server/lib/analytics/lambda/report-aggregator/transforms.ts`. Handler invokes `resolveDescriptor` (already exported from shared-types) to map school code → canonical. Apply `transform` to the grade-level columns in [IEMIS_NPL_CEHRD_FLASH_I.ts:136](../../packages/shared-types/src/external-reporting/templates/IEMIS_NPL_CEHRD_FLASH_I.ts#L136) and [IEMIS_NPL_CEHRD_FLASH_II.ts:65](../../packages/shared-types/src/external-reporting/templates/IEMIS_NPL_CEHRD_FLASH_II.ts#L65). | Snapshot test on Flash I generator with PABSON fixture: students enrolled in PG/NUR/LKG/UKG/1-10 produce column values ECD/ECD/PPC/PPC/1-10. Unit test on the transform handler. |
| A.4 | (Midnight Lockin S-2) PABSON `emisSchoolCode` required-field guard at school create. In [schools.service.ts:252-258](../../server/application/microservices/identity/src/schools/schools.service.ts#L252-L258) the rejection exists today — verify it covers all PABSON code paths and add a unit test if missing. If guard is partial (e.g., only on direct create but not on tenant-seeder), close the gap. | Unit test: PABSON tenant + school create without `emisSchoolCode` returns 400 with clear errorCode. Regression test: GENERIC tenant allows missing `emisSchoolCode`. |
| A.5 | (Midnight Lockin P1-d) Add `defaultTimeFormat` to USA + IND entries in `COUNTRY_DEFAULTS` at [workspace-settings.entity.ts:133-152](../../server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts#L133-L152). Match canonical values in [tenant-locale-defaults.ts](../../packages/shared-types/src/locale/tenant-locale-defaults.ts). | Drift detector test (or simple equality assertion) that the inline duplicate matches canonical shared-types map for all archetype/country pairs. |
| A.6 | Publish `@aibrains/shared-types` minor; bump consumer pins (`server/application/package.json`, `server/package.json`, root lockfile) per [memory `edforge_shared_types_caret_pin`](../../.claude/projects/-Users-shoaibrain-edforge/memory/edforge_shared_types_caret_pin.md). | `npm install` resolves; identity + academics Docker build locally; AdminWeb bundle-sim passes. |
| A.7 | Deploy analytics-stack (report-aggregator Lambda picks up new transform + shared-types). Live smoke: trigger Flash I dry-run on dev-pabson-primary; verify CEHRD codes in output. | Smoke output saved to `docs/deploys/sprint-A-flash-transform-<sha>.md`. STOP: any PG/NUR/LKG/UKG in output → halt + revert. |

**Closeout.** Single memory entry `memory/project_post_saraswati_sprint_a_shipped.md` covering all 7 tickets.

---

## Sprint B — GradingPolicy seed fires on the read path

**Goal.** `GET /academics/grading-policies` returns the CEHRD 35-pass NG scale
(seeded from ArchetypeDefaults) for any PABSON school where no operator policy
exists. The legacy SchoolConfiguration 32-pass scale stops being the operative
source.

**Demo.** Before/after on Saraswati: pre-deploy `GET /academics/grading-policies`
returns `[]`; post-deploy returns 1 policy with `letterGrades` including `NG`
+ `passingThresholdPct: 35`. A 39% mark is now F (fail), not legacy D
(pass-at-32).

### Tickets

| # | Title | Validation |
|---|---|---|
| B.1 | Root-cause + write-up in commit body. Confirm `getOrSeedDefaultPolicy` does not exist as a method; only `buildSeedFromArchetype` at L322 + `seedDefaultPolicy` internal path are present. Cite live evidence from `/tmp/saraswati-validation-1780456847/`. | Paragraph in commit; reviewer confirms via grep. |
| B.2 | New `getOrSeedDefaultPolicy(schoolId, context)` method in [grading-policy.service.ts](../../server/application/microservices/academics/src/grades/grading-policy.service.ts). Idempotent: queries GSI1 first; if empty, calls `buildSeedFromArchetype` and PutItem with DDB `attribute_not_exists(entityKey)` conditional write to prevent double-seed under concurrency; returns the seeded row. On `ConditionalCheckFailedException`, re-query and return the winning row. | Unit test: first call seeds + returns 1 item; second call returns same item without re-seeding; spy on `buildSeedFromArchetype` confirms invoked once. Test for ConditionalCheckFailed branch returns the loser's re-queried row. |
| B.3 | Wire `listGradingPolicies` (L408) to invoke `getOrSeedDefaultPolicy` when GSI1 returns 0 items, then re-query. | Existing route-shape test extended: empty-GSI1 path returns 1 item (not `[]`); regression test for non-empty (operator-defined policy) path unchanged. |
| B.4 | Concurrency safety test using `dynamodb-local`. `Promise.all([list × 5])` against a fresh school → assert exactly 1 GradingPolicy row in DDB. **Skip if B.2's `attribute_not_exists` reliably handles it** (verified by `aws-sdk-client-mock` unit test in B.2) — note the decision in commit body. | dynamodb-local docker started in jest setup; concurrent listings produce 1 row; test deterministic. |
| B.5 | Backfill script `scripts/backfill/seed-missing-grading-policies.ts`. Scans all tenants × schools where GSI1 returns 0; invokes `getOrSeedDefaultPolicy`. Dry-run + live modes; per-school log with archetype + letterGrades count. | Dry-run report; live run against dev-pabson-primary first. |
| B.6 | CloudWatch alarm on `getOrSeedDefaultPolicy` invocation rate. Threshold: > 1 / school / day signals a re-seed loop and pages oncall. | Alarm exists in CDK output; test fires on synthetic metric. |
| B.7 | Ship to prod. Live smoke against Saraswati: `GET /academics/grading-policies` returns 1 policy with `letterGrades.length === 10` and a `'NG'` entry. DDB scan: GRADING_POLICY rows for tenant `34f49822-…` increases from 0 to school-count. Grade-letter compute endpoint: mark=39% pre-deploy = D pass, post-deploy = F fail. | Evidence saved to `docs/deploys/sprint-B-grading-seed-<sha>.md`. STOP: any school's policy count > 1 → halt + reverse-backfill (delete the duplicates by `createdAt`). |

**Closeout.** Memory entry `memory/project_post_saraswati_sprint_b_shipped.md`.

---

## Sprint C — Bell schedule archetype defaults + activation gate

**Goal.** PABSON schools get "Nepal Standard (Sun-Fri)" as their default bell
schedule out of the box. A *newly-activating* school cannot pass activation
while default is "Regular Day" or any single-period placeholder. **Already-
active schools (incl. Saraswati) are grandfathered.**

**Demo.** Provision a fresh PABSON dev tenant; Bell Schedules page shows "Nepal
Standard (Sun-Fri)" as default. On a non-active school with placeholder default,
`GET /academics/{ay}/activation-requirements` returns `canActivate: false` with
`missing: ["bellScheduleSetAsDefault"]`. Saraswati (active) → `canActivate: true`.

### Tickets

| # | Title | Validation |
|---|---|---|
| C.1 | Trace audit: walk the school-provisioning code path and document where bell schedules are first seeded (tenant-seeder Lambda? school-create? archetype-defaults service?). Decision in commit body on which hook owns the new archetype-aware seed. | Paragraph in commit. |
| C.2 | Extend [`ArchetypeDefaults`](../../packages/shared-types/src/archetype/archetype-defaults.ts) schema with `defaultBellSchedule: BellSchedulePreset`. PABSON: `{ name: "Nepal Standard (Sun-Fri)", periodCount: 8, periodDurationMinutes: 45, startTime: "10:00", endTime: "16:00", scope: "academic", schoolDays: ["sun","mon","tue","wed","thu","fri"] }`. GENERIC: sensible US default. Zod-validated. | Snapshot test on `getArchetypeDefaults('PABSON').defaultBellSchedule`. |
| C.3 | Implement archetype-aware seed at the hook chosen in C.1. Call existing [`BellScheduleService.create`](../../server/application/microservices/identity/src/schools/bell-schedule.service.ts) with the preset; the existing `isDefault: true` path (L488) handles clear-old semantics. **Do not build new isDefault logic** — reuse what exists. | Integration test: provision fresh PABSON school; DDB scan finds bell schedule row with `isDefault: true` matching PABSON preset. Same for GENERIC. |
| C.4 | New activation requirement key `bellScheduleSetAsDefault`. Predicate: school has ≥ 1 bell schedule AND `isDefault: true` is set on a schedule whose `periodCount > 1`. **Grandfather:** check only runs when `school.status !== 'ACTIVE'`. Already-active schools (incl. Saraswati) pass unconditionally. | Integration test 1: pre-fix school (default = placeholder, status = INACTIVE) → `canActivate: false`. Test 2: operator sets real default → `canActivate: true`. Test 3: status = ACTIVE + placeholder default → `canActivate: true` (grandfathered). |
| C.5 | Frontend: URL-trace per CLAUDE.md, then add yellow "Placeholder — set a real schedule before activating AY" chip next to "Regular Day" if it's the default. Add green "Default" badge on the active default schedule. | Route-trace in commit body. Component test for chip + badge. Visual smoke via `npm run dev:shell` (screenshot in commit). |
| C.6 | Frontend: surface new `bellScheduleSetAsDefault` requirement in activation panel with clickable link to Bell Schedules page. | Component test renders new key + link; visual smoke. |
| C.7 | RBAC confirmation: setting bell-schedule default is covered by existing ABAC `'school'+'configure'`. If not, add ABAC action. | Per-route ABAC test; existing security tests green. |
| C.8 | Operator-runnable script `scripts/operator/set-default-bell-schedule.ts` for ops-emergency (UI is primary path). Idempotent. | Dry-run + live run against dev-pabson-primary. |
| C.9 | Live smoke against Saraswati: operator switches default from "Regular Day" to "Nepal Standard (Sun-Fri)" via UI. Confirm activation requirements still all green (grandfathering held). Confirm calendar's `defaultBellScheduleId` reflects new schedule. | Evidence saved to `docs/deploys/sprint-C-bell-defaults-<sha>.md`. STOP: Saraswati's `canActivate` flips false → halt + revert C.4. |

**Closeout.** Memory entry `memory/project_post_saraswati_sprint_c_shipped.md`.

---

## Sprint D — Execute Midnight Lockin P1: remove school-level regional fields

**Goal.** Execute the already-planned Midnight Lockin P1 (documented at
[docs/MIDNIGHT_LOCKIN_IMPLEMENTATION_REVIEW.md](../MIDNIGHT_LOCKIN_IMPLEMENTATION_REVIEW.md)
L29): "remove these from the DTO and entity entirely." P0 already shipped the
deprecation warning at [schools.service.ts:529-543](../../server/application/microservices/identity/src/schools/schools.service.ts#L529-L543);
P1 strips the fields. Also broaden scope to include `dateFormat`/`timeFormat`
on `SchoolConfiguration` (P0.17 only covered `timezone/locale/calendarSystem/academicCalendarType`).

**Demo.** `GET /schools/:sid/configuration` response no longer carries
`timezone/locale/dateFormat/timeFormat` at the top level. DDB scan of
`SCHOOL#*#CONFIG` rows shows 0 such attributes. Saraswati post-deploy: regional
values served via `GET /tenants/my/settings` (which already exists).

**Builds on:** P0.17 is in production; gather 7-day deprecation-warning log
sample first (D.1) to identify any still-live writer that hasn't yet been
migrated to tenant-level.

### Tickets

| # | Title | Validation |
|---|---|---|
| D.0 | Pull 7-day P0.17 deprecation-warning log sample from prod CloudWatch Insights. Filter on `"DEPRECATED school-level regional fields written"`. Group by `tenantId` + `actor` + `fields`. Output: punch-list of callers still writing these fields. **Gate:** if any non-test caller appears in the log, those call sites need migration *before* D.5 strip ships. | Punch-list saved to `docs/platform-hardening/sprint-D-deprecation-callers.md`. |
| D.1 | Migrate any callers found in D.0 to tenant-level writes (via `PATCH /tenants/:tenantId/settings`). One commit per caller. | Per-caller test confirms the new path; old write site no longer fires the deprecation warning in subsequent dev runs. |
| D.2 | Punch-list: grep + tag every **read** of `School.{timezone,locale}` and `SchoolConfiguration.{timezone,locale,dateFormat,timeFormat}` across `server/`, `client/AdminWeb/`, `edforge-saas-frontend/`. Distinguish callers that should resolve via tenant from callers that need a thin local helper. | Saved to `docs/platform-hardening/sprint-D-school-regional-readers.md`. Reviewer signs off — any miss = P0 in D.5 backfill. |
| D.3 | Migrate readers from D.2. Callers in server-side controllers resolve via the existing `WorkspaceSettings` lookup in `TenantsService` (or via the hydration pattern already used by `getMyWorkspaceSettings`); frontend MFE callers already use `GET /tenants/my/settings` — verify, no new client added. **No new `RegionalResolverService` — reuse what exists.** | Per-controller/per-MFE route-shape test or component test. Existing specs still green. |
| D.4 | DDB snapshot of every `SCHOOL#*#CONFIG` row across all prod tenants → S3 bucket with 90-day retention. Companion `scripts/backfill/restore-school-regional-fields.ts` reads snapshot back and re-applies attributes. **This is the rollback envelope for D.5.** | Snapshot in S3; restore-script dry-run against dev-pabson-primary reverses a synthetic strip. |
| D.5 | Remove `timezone`, `locale` from [`School` entity at school.entity.ts:54-55](../../server/application/microservices/identity/src/common/entities/school.entity.ts#L54-L55). Keep `calendarSystem` (C0.a anchor) with explicit code comment. Remove `timezone`, `locale`, `dateFormat`, `timeFormat` from [`SchoolConfiguration` at department.entity.ts:54-57](../../server/application/microservices/identity/src/common/entities/department.entity.ts#L54-L57). Update `CONFIG_LOCKED_FIELDS` to drop these (no longer school-level). Surgical edit of [`COUNTRY_CONFIG_OVERRIDES`](../../server/application/microservices/identity/src/common/entities/department.entity.ts#L230-L272) (lines 230-272): remove ONLY the 4 regional sub-fields per country block; **keep** `schoolDays/startTime/endTime/periodDuration/academicCalendarType/gradingScale`. Same surgical removal on [`DEFAULT_SCHOOL_CONFIG` at L190-225](../../server/application/microservices/identity/src/common/entities/department.entity.ts#L190-L225). | Type-checker fires on any missed caller from D.2 (treat as P0). Route-shape test for `/schools/:sid/configuration` asserts response no longer includes the 4 fields. `nest build` clean. |
| D.6 | Backfill script `scripts/backfill/strip-school-regional-fields.ts`. UpdateItem `REMOVE timezone, locale, dateFormat, timeFormat` for every `SCHOOL#*#CONFIG` row. Emits audit event `IDENTITY.SCHOOL_CONFIG.REGIONAL_FIELDS_STRIPPED` per row with before-values. Dry-run + live modes. | Dry-run prod row-count report. Live run against dev-pabson-primary first; pre/post DDB scan; audit-event rows. |
| D.7 | Static lint rule `scripts/lint/no-school-level-regional-reads.ts` forbidding any future read OR declaration of these 6 field paths on school-scope entities. Add to pre-commit + CI. | Linter fires red on deliberate regression patch; clean on current code post-D.5. |
| D.8 | CLAUDE.md update: strengthen "Archetype model" with explicit "WorkspaceSettings is the only source for regional fields; school's `calendarSystem` is the C0.a anchor exception" rule. Point to D.7 lint as enforcement. Remove the P0.17 deprecation warning code (now redundant). | Doc lint passes; deprecation-warning code path deleted; reviewer approves. |
| D.9 | Ship to prod. Live smoke against Saraswati: `GET /schools/{sid}/configuration` returns no regional fields at top level; `GET /tenants/my/settings` returns `dateFormat: "DD/MM/YYYY"` (canonical). DDB GetItem on `SCHOOL#<sid>#CONFIG` confirms 4 attributes absent. Audit-event row exists for Saraswati's school. | Evidence to `docs/deploys/sprint-D-regional-cleanup-<sha>.md`. STOP: any caller surfaces `undefined` for regional fields → halt + run D.4 restore script for Saraswati row. |

**Closeout.** Memory entry `memory/project_post_saraswati_sprint_d_shipped.md`. Cross-link to Midnight Lockin doc; mark P1 (regional fields slice) closed.

---

## Deferred / not-engineering

| Item | Reason |
|---|---|
| Operator applies PABSON holiday template to Saraswati BS 2083 calendar | Engineering exists end-to-end (`HOLIDAY_SEEDS` + endpoint + generate-calendar integration). Operator action — F-CAL-1, planned this week. |
| Saraswati grades 3-7 sections + enrollment (only Grade 8 = 48 students) | Operator data entry. |
| BS 2084 holiday seed | Authoritative source not yet published. New shared-types `HOLIDAY_SEEDS` entry when PABSON liaison delivers BS 2084 calendar. |
| PABSON UX polish (archetype-aware Specialized Types empty state, Standards "CDC coming in V1.5" placeholder, Nepali subject re-bucket, textbook catalog) | Original Sprint 6 from draft. Orthogonal to regression-class issues. Separate epic. |
| Other Midnight Lockin P1 items (P1-a finance currency, P1-b audit coverage, P1-c multi-role data scope, P1-e emisSchoolCode immutability) | Tracked in [MIDNIGHT_LOCKIN_IMPLEMENTATION_REVIEW.md](../MIDNIGHT_LOCKIN_IMPLEMENTATION_REVIEW.md). Out of scope for this hardening epic; pick up separately. |
| Future CBS / NGO-run archetype seed entries | Add when first non-PABSON pilot is on the roadmap. No architectural change needed — just new entries in `archetype-defaults.ts`, `HOLIDAY_SEEDS`, `tenant-locale-defaults.ts`. |

---

## Open questions for operator / PABSON liaison

| # | Question | Blocks |
|---|---|---|
| Q1 | After Sprint C.4 ships the `bellScheduleSetAsDefault` activation gate, grandfather Saraswati indefinitely, or re-evaluate current state? Plan grandfathers (don't break running pilot). | Sprint C.4 ships as-is unless contradicted. |
| Q2 | Sprint D.6 strips DDB regional fields across **all** tenants. Are any non-Saraswati prod tenants likely to have operator-set non-canonical regional values worth preserving as a `MIGRATED_FROM_SCHOOL_CONFIG` audit attribute? If yes, D.6 needs to emit values to S3 archive before strip. | Sprint D.6 live-run. |
| Q3 | Shared-types publish batching: Sprint A bumps minor (3 packages: A.3 transform + A.5 drift fix). Sprint C bumps minor (C.2 defaultBellSchedule). Sprint D bumps minor (D.5 entity changes). Batch into 1 publish + 1 pin-bump PR per sprint, or batch across sprints if landing in same week? | Sprints A.6, C end-ticket, D.5. |

---

## Cross-sprint risks + mitigations

| Risk | Mitigation |
|---|---|
| Sprint D destructive backfill misses an unmigrated reader | D.0 deprecation-log audit + D.2 punch-list rigor + D.3 migration soak + D.4 rollback envelope + D.9 STOP condition. |
| Sprint D static lint can't catch dynamic property access (`school['timezone']`) | Soak log review during the gap between D.5 and D.6 is the safety net. Consider extending D.7 lint to ban dynamic-access patterns where pragmatic. |
| Sprint C activation gate breaks Saraswati already-active state | Explicit grandfather (`school.status !== 'ACTIVE'`) in C.4 predicate; 3 integration tests for both pathways. |
| Sprint B concurrent seed creates duplicate policies | B.2's DDB `attribute_not_exists` + B.4 dynamodb-local concurrency test. |
| Shared-types publish + consumer pin drift | Per-sprint pin bumps in same PR per [memory `edforge_shared_types_caret_pin`](../../.claude/projects/-Users-shoaibrain-edforge/memory/edforge_shared_types_caret_pin.md). |
| Module-wiring drift on any new service | Per CLAUDE.md [feedback memory](../../.claude/projects/-Users-shoaibrain-edforge/memory/feedback_module_wiring_invariant.md). No new services planned in this revised scope. |
| Two-repo git hygiene drift | Per-git `cd <repo>` pattern (memory `feedback_explicit_cd_per_git`). |
| **Repeating the duplication mistake** | Per [memory `feedback_audit_before_proposing_new_sprints`](../../.claude/projects/-Users-shoaibrain-edforge/memory/feedback_audit_before_proposing_new_sprints.md): grep + read existing code + check `docs/` for prior planning artifacts BEFORE drafting any new ticket. |

---

## What changed vs the original draft

The original draft (preserved at `/tmp/saraswati-hardening-sprint-plan.draft.md`)
proposed 6 sprints. After auditing existing code, ~3 sprints were duplicates:

| Original | Reality | Outcome |
|---|---|---|
| S1 grade-level mapper (proposed new function + alias map) | Alias map exists at [grade-level-descriptor.ts:51,64](../../packages/shared-types/src/ed-fi/descriptors/grade-level-descriptor.ts#L51); `resolveDescriptor` exported | **Reduced to A.3** — just wire transform into Flash generators |
| S2 GradingPolicy seed | Genuinely missing | **Kept as Sprint B** |
| S3 Bell schedule (proposed building `isDefault` + activation gate) | `isDefault` exists with clear-old logic | **Reduced to Sprint C** — only archetype seed + activation gate are missing |
| S4 Regional read-path migration (proposed `RegionalResolverService`) | `GET /tenants/my/settings` already serves this | **Folded into Sprint D** — reuse existing endpoint, no new service |
| S5 Regional entity removal + backfill | Midnight Lockin P1 already plans this | **Kept as Sprint D** — execute existing plan, don't redesign |
| S6 Holiday templates (proposed building from scratch) | End-to-end shipped: `HOLIDAY_SEEDS` + fixture + endpoint + `generate-calendar` integration | **Dropped entirely** — operator runs existing pipeline |

Net: from 6 sprints / ~50 tickets to 4 sprints / ~30 tickets, all atomic.

---

*Generated 2026-06-02 from V1 first-pilot validation against the PABSON archetype
(Saraswati School as the validation catalyst).
Revised after duplication audit found 3 sprints overlapped with already-shipped
or already-planned work. Architecture framing corrected per operator clarification
(archetype = governance body, not size/community). Don't-duplicate-work lesson
captured in memory `feedback_audit_before_proposing_new_sprints`.*
