# Governance-Body Archetype Framework — Backend Sprint Plan

> **Repo:** `shoaibrain/edforge` (server + CDK + shared-types).
> **Reads with:** [`00-north-star.md`](./00-north-star.md) (architecture + cross-repo map).
> **Frontend counterpart:** `edforge-saas-frontend/docs/archetype-framework/frontend-sprint-plan.md`.
>
> Five sprints, ~40 atomic tickets. Every ticket is one commit + one PR with a
> `Validation:` line. Every sprint ends in a runnable/observable demo. This plan
> is the concrete execution of **Midnight Lockin P2 + P3.8**, elevated to a
> first-class, conformance-gated framework. It does **not** redo
> platform-hardening A–D (companion) or Saraswati C5/C6 exam/attendance pipeline
> (out of scope — see north-star §6).

---

## Sprint sequence & demos

```
GB0  Governance profile aggregator + conformance harness   → test suite proves PABSON/GENERIC fully wired
GB1  Kill country-branch anti-patterns + CI lint           → PABSON school create gets BS via archetype; bad branch fails CI
GB2  Apply defaults at lifecycle seams                     → fresh PABSON school auto-seeds board exams + curriculum + config
GB3  Ethnicity descriptor catalog + caste import           → Flash I caste_ethnicity populated from catalog, not regex
GB4  Add CBS governance body skeleton end-to-end           → CBS dev tenant seeds contextual defaults, ZERO call-site edits
```

GB0 and GB1 run mostly in parallel, with one ordering constraint: the
aggregator's `schoolConfigDefaults` slot (GB0.3) is finalized by GB1.2b's
`getDefaultConfigForArchetype` — so land GB1.2a/GB1.2b before closing GB0.3, or
stub the slot from the existing `getDefaultConfigForCountry` and re-point it in
GB1.2b. GB2 depends on GB0 (consumes the aggregator). GB3 is independent. GB4
depends on GB0–GB3 (it is the extensibility proof and must light up every wired
surface).

---

## Sprint GB0 — Governance profile aggregator + conformance harness

**Goal.** Make the governance body a first-class object without changing any
runtime behavior. Create a single `GovernanceProfile` aggregator that *imports*
(never copies) the existing scattered tables, and a conformance test that fails
CI if any runtime-active archetype is missing or inconsistent on any surface.

**Demo.** `npx jest governance-profile` runs the conformance suite green for
`PABSON` + `GENERIC`; a deliberately-incomplete archetype (added in a throwaway
test fixture) fails it red. No production code path changes — pure addition.

> **Source-of-truth note (verified in review).** There are **two** active-archetype
> symbols — `activeArchetypeSchema` ([`tenant.schema.ts:29`](../../packages/shared-types/src/schemas/identity/tenant.schema.ts#L29))
> and `ACTIVE_ARCHETYPES`/`ActiveArchetype` ([`tenant-locale-defaults.ts:194`](../../packages/shared-types/src/locale/tenant-locale-defaults.ts#L194))
> — and **two** `ARCHETYPE_DEFAULTS`-named tables: the *regional* `ARCHETYPE_DEFAULTS:
> Record<ActiveArchetype, RegionalSettings>` ([`tenant-locale-defaults.ts:202`](../../packages/shared-types/src/locale/tenant-locale-defaults.ts#L202))
> and `ARCHETYPE_DEFAULTS_TABLE: Record<ActiveArchetype, ArchetypeDefaults>`
> ([`archetype-defaults.ts:200`](../../packages/shared-types/src/archetype/archetype-defaults.ts#L200)).
> `ArchetypeDefaults` carries `letterGrades`, `boardExams`, `examPattern`,
> `promotionDefaults`, `primaryCurriculumRef` (a **string** code, e.g. `'CDC_NCF_2076'`),
> and `complianceForms` (a **string[]** of template IDs) — it does **not** carry a
> `requiredDescriptors` field today (GB0.2b adds it). The aggregator must compose
> what exists and explicitly add what doesn't as first-class data — never inline-invent.

| # | Title | Validation |
|---|---|---|
| GB0.0 | Unify the dual active-archetype symbols. Make one canonical (re-export the other) so there is a single enum the conformance suite iterates. | Test: `activeArchetypeSchema.options` deep-equals `[...ACTIVE_ARCHETYPES]`; adding a value to one without the other fails CI. |
| GB0.1 | Write the framework RFC at `docs/archetype-framework/rfcs/0001-governance-profile.md`: `GovernanceProfile` shape, the "aggregator is a view, not a rewrite" rule, the conformance contract, the ZERO-call-site-edit DoD, and the explicit list of which existing constant backs each slot. Link the north-star. | RFC reviewed + merged; reviewer confirms each slot names its backing constant (or marks it net-new). |
| GB0.2 | Add `GovernanceProfile` + slot types to `packages/shared-types/src/archetype/governance-profile.ts`, using the **real** source types: `regional: RegionalSettings`, `grading`/`promotionDefaults`/`examPattern`/`boardExams` from `ArchetypeDefaults`, `primaryCurriculumRef: string`, `complianceForms: string[]`, `bellPresets`, `activation`, `schoolConfigDefaults`. Types only. Re-export from index. | `tsc` clean; type compiles against a hand-written PABSON literal built from the real tables. |
| GB0.2b | Add the **net-new** `complianceRequiredDescriptors: DescriptorType[]` field to `ArchetypeDefaults` as first-class data (PABSON: GradeLevel/Sex/Language/Disability/Ethnicity/ExitWithdrawType; GENERIC: `[]`). This is the gate input for GB0.5/GB3.5 — it does not exist yet, so it ships as real data, **not** as an aggregator invention. | Unit test: `ARCHETYPE_DEFAULTS_TABLE.PABSON.complianceRequiredDescriptors` includes `'GradeLevelDescriptor'`; schema validates. |
| GB0.3 | Implement `getGovernanceProfile(archetype): GovernanceProfile` composing **only existing constants**: `ARCHETYPE_DEFAULTS` (regional), `ARCHETYPE_DEFAULTS_TABLE` (grading/promotion/examPattern/boardExams/primaryCurriculumRef/complianceForms/complianceRequiredDescriptors), `ARCHETYPE_BELL_PRESETS`, `ARCHETYPE_ACTIVATION_REQUIREMENTS`, `getDefaultConfigForArchetype` (from GB1.2a). Import the constants; inline no literals. | Unit test: `getGovernanceProfile('PABSON').regional.currency === 'NPR'`; `.boardExams` includes `SEE`; `.primaryCurriculumRef === 'CDC_NCF_2076'`. (Referential-sourcing is proven by GB0.6's deep-equal, not a spy.) |
| GB0.4 | Conformance harness `governance-profile.conformance.spec.ts`: `it.each(activeArchetypeSchema.options)` asserts every slot present + non-empty (allowing GENERIC's intentionally-empty `complianceForms`/`complianceRequiredDescriptors`). | Suite green for PABSON/GENERIC; a fixture archetype missing a slot fails red. |
| GB0.5 | Conformance cross-checks: every `boardExams[].gradeLevel` resolves via `resolveDescriptor('GradeLevelDescriptor', …)`; every `complianceRequiredDescriptors[]` has a registered catalog in `ed-fi/descriptors/catalogs.ts`; `regional.calendarSystem ∈ {bikram_sambat, gregorian}`. | Suite asserts each cross-check; a fixture with a bogus board-exam grade or unregistered descriptor fails red. |
| GB0.6 | Drift guard: assert `getGovernanceProfile(a).regional` deep-equals `ARCHETYPE_DEFAULTS[a]` and the `ArchetypeDefaults`-sourced slots deep-equal `ARCHETYPE_DEFAULTS_TABLE[a]` for PABSON+GENERIC — proving the aggregator never diverges from its sources. (This is the canonical "view, not rewrite" test; replaces any spy-based check.) | Equality test green; a manual divergence (temp edit) fails it. |
| GB0.7 | Publish `@aibrains/shared-types` minor; bump consumer pins (`server/application/package.json`, `server/package.json`, root `package-lock.json`) per CLAUDE.md caret-pin rule. | `npm install` resolves; identity + academics `nest build` clean locally; AdminWeb jsdom bundle-sim passes. |

**Closeout.** Memory entry `memory/project_governance_framework_gb0.md`. No deploy
(types/test only; no runtime behavior change → empty `cdk diff`).

---

## Sprint GB1 — Kill country-branch anti-patterns + CI lint

**Goal.** Eliminate the one runtime country-branch bug and make the
"branch on archetype, never on country" rule *enforceable* rather than
conventional. Route the remaining country-keyed school config through the
governance profile (executes Midnight Lockin **P3.8**).

**Demo.** A fresh **PABSON** school created in a tenant whose `country` is
deliberately set to something other than `NPL` still gets `bikram_sambat` (proving
archetype, not country, decides). A PR that introduces `country === 'NPL'` in a
runtime service file fails CI on the new lint rule.

| # | Title | Validation |
|---|---|---|
| GB1.1 | Fix [`schools.service.ts:358`](../../server/application/microservices/identity/src/schools/schools.service.ts#L358): replace `countryCode === 'NPL' ? 'bikram_sambat' : 'gregorian'` with the archetype-resolved `calendarSystem` (archetype is already fetched at L246–251; use `getGovernanceProfile(archetype).regional.calendarSystem`, DTO override still wins). | Unit test: PABSON tenant + `country='IND'` + no DTO override → `calendarSystem === 'bikram_sambat'`. GENERIC + `country='NPL'` → `gregorian`. DTO override respected. |
| GB1.2a | Add `getDefaultConfigForArchetype(archetype, country)` next to `getDefaultConfigForCountry()` ([`department.entity.ts:230`](../../server/application/microservices/identity/src/common/entities/department.entity.ts#L230)): pure function, archetype-over-country precedence (mirror `workspace-settings.entity.ts:227`), country map retained as the *fallback* layer only. No call-site changes yet. | Unit-test matrix: PABSON→Sun-Fri/24h/CEHRD scale; GENERIC+NPL→country fallback; GENERIC+US→US defaults. |
| GB1.2b | Surface GB1.2a's result via the `GovernanceProfile.schoolConfigDefaults` slot (closes GB0.3's stub). Bumps the exported profile shape → gated by the GB1.6 publish. | Test: `getGovernanceProfile('PABSON').schoolConfigDefaults.schoolDays` = `[sun..fri]`; GB0 conformance suite still green. |
| GB1.3 | Update `schools.service.ts` school-create to call `getDefaultConfigForArchetype(archetype, country)` instead of `getDefaultConfigForCountry(country)`. | Route-shape test: `POST /schools` for PABSON returns config with `schoolDays=[sun..fri]`; regression test GENERIC unchanged. `module-wiring.spec.ts` updated if a provider is added. |
| GB1.4 | Author ESLint rule (or `scripts/lint/no-country-branch.ts` invoked in CI) that flags `country*  === 'NPL'` / `=== 'NPL'` comparisons in `server/application/microservices/**/src/**` (allow-list: locale-defaults fallback tables + tests via inline disable). | Rule fires red on a deliberate offending fixture; green on the post-GB1.1 tree; unit test with positive + negative fixtures. |
| GB1.5 | Add the lint rule to pre-commit + CI; document the rule + escape hatch in CLAUDE.md "Archetype model" section. | CI run shows the rule executing; doc lint passes; reviewer confirms. |
| GB1.6 | Publish shared-types minor (if GB1.2 changed exported types) + consumer pin bump. | `npm install` resolves; identity Docker build clean. |
| GB1.7 | Deploy: identity ECR push + ECS rolling update (no infra change — confirm empty `cdk diff tenant-template-stack-basic`). Live smoke on dev-pabson tenant: create a school, confirm `calendarSystem=bikram_sambat`. | Smoke evidence saved to `docs/deploys/gb1-archetype-calendar-<sha>.md`. STOP: GENERIC tenant school shows `bikram_sambat` → revert GB1.1. |

**Closeout.** Memory `memory/project_governance_framework_gb1.md`; mark Midnight
Lockin **P3.8** closed.

---

## Sprint GB2 — Apply governance defaults at lifecycle seams

**Goal.** Close G-SEED: the archetype table already *defines* board exams,
curriculum ref, and exam patterns, but nothing *applies* them when a PABSON school
is set up. Wire archetype-driven seeding at school-create / first-use, idempotently,
reusing the existing seed patterns (grading/promotion already do this).

**Demo.** Provision a fresh PABSON dev school → board-exam catalog
(BLE@8, SEE@10, NEB_11, NEB_12) auto-seeded, curriculum ref defaulted to
`CDC_NCF_2076`, exam-pattern surfaced in the school setup checklist. GENERIC
school → none of the PABSON-specific seeds. Re-running setup seeds nothing twice.

| # | Title | Validation |
|---|---|---|
| GB2.1 | Trace-audit ticket: walk school-create + tenant-seeder + first-GET paths; document in the commit body which hook owns board-exam / curriculum seeding (mirror the grading-policy `getOrSeed` decision). | Paragraph in commit; reviewer confirms via grep. |
| GB2.2 | `getOrSeedBoardExams(schoolId, ctx)` in academics: idempotent (GSI query first; if empty, build from `GovernanceProfile.boardExams`; conditional `attribute_not_exists` write to prevent double-seed; on `ConditionalCheckFailed` re-query). | Unit test (aws-sdk-client-mock): first call seeds N exams, second call seeds 0; ConditionalCheckFailed branch returns winner. **Concurrency:** either the mock proves the `attribute_not_exists` write, or a `dynamodb-local` `Promise.all([seed×5])` → exactly N rows; note which in the commit body. |
| GB2.3 | Wire board-exam list endpoint to call `getOrSeedBoardExams` on empty result, then re-query (mirror grading-policy read-path fallback). | Route-shape test: empty path returns PABSON board exams; non-empty (operator-defined) path unchanged. |
| GB2.4 | Default `primaryCurriculumRef` from the governance profile at course-create when the DTO omits it (PABSON→`CDC_NCF_2076`; **GENERIC→`CCSS`** — GENERIC has a real default at [`archetype-defaults.ts:186`](../../packages/shared-types/src/archetype/archetype-defaults.ts#L186), it is NOT unset). Operator override always wins. | Unit test: PABSON course create w/o curriculumRef → `CDC_NCF_2076`; GENERIC → `CCSS`; explicit override → override. |
| GB2.5 | Surface allowed exam types from `GovernanceProfile.examPattern` via a read endpoint the setup checklist can call (the *validation* at `exams.service.ts:395` already rejects bad types — this exposes the allowed set eagerly). Three-way route registration (controller + `tenant-api-prod.json` + nginx if new prefix). | Route-shape test returns PABSON exam pattern; `check-route-drift.ts` green; smoke returns 200 not 403/404. |
| GB2.6 | CloudWatch alarm on the `getOrSeedBoardExams` re-seed signal (>1 seed/school/day = a loop) — reuse the platform-hardening Sprint-B grading alarm pattern. Owned by `tenant-template-stack-basic` (the academics service + its metrics live there). | `cdk synth tenant-template-stack-basic` shows the alarm resource; threshold unit-asserted. (Live firing is exercised by the GB2.8 smoke, not here.) |
| GB2.7 | Publish shared-types minor (if `GovernanceProfile` slots changed) + consumer pin bump. | `npm install` resolves; academics Docker build clean. |
| GB2.8 | Deploy academics (ECR + ECS rolling update). Deploy `tenant-template-stack-basic` only if GB2.6 added the alarm (confirm via `cdk diff`; empty diff → skip). Live smoke: fresh PABSON dev school auto-seeds board exams + curriculum; alarm visible in CloudWatch. | Evidence to `docs/deploys/gb2-lifecycle-seeding-<sha>.md`. STOP: any school's board-exam rows >N → halt + delete duplicates by `createdAt`. |
| GB2.9 | Backfill for **already-provisioned** PABSON schools (the seed-on-empty path doesn't upgrade existing schools). `scripts/backfill/seed-missing-board-exams.ts` (dry-run + live, mirrors the platform-hardening Sprint-B `seed-missing-grading-policies` pattern): scans schools with 0 board-exam rows, invokes `getOrSeedBoardExams`. | Dry-run row-count report; live run against dev-pabson first; pre/post DDB scan. STOP: any school ends with >N rows. |

> GB2.2's concurrency safety (no double-seed under `Promise.all`) is **part of
> GB2.2's validation** — either an `aws-sdk-client-mock` proof of the
> `attribute_not_exists` conditional write, or a `dynamodb-local` `Promise.all([seed×5])`
> → N-rows test. It is not a separate ticket (a "may be skipped" ticket isn't atomic).

**Closeout.** Memory `memory/project_governance_framework_gb2.md`.

---

## Sprint GB3 — Ethnicity descriptor catalog + caste import (compliance)

**Goal.** Close G-EDFI: the only Ed-Fi descriptor gap that blocks a *complete,
compliant* PABSON Flash I. `Student.ethnicityDescriptor` exists and Flash I needs
`caste_ethnicity`, but there is no EthnicityDescriptor catalog (transform uses
hardcoded regex) and caste is never imported. Build the catalog, wire the import,
replace the regex transform with a catalog lookup. (Flash II exam-marks +
attendance-aggregation remain owned by Saraswati C5/C6 — out of scope.)

**Demo.** Re-import a Saraswati fixture row with a caste value → student persists
`ethnicityDescriptor` URI → Flash I dry-run emits the correct CEHRD band in
`caste_ethnicity`, sourced from the catalog (not regex). A row with an unmapped
caste emits a warning, not a crash.

| # | Title | Validation |
|---|---|---|
| GB3.1 | Author `EthnicityDescriptor` catalog `packages/shared-types/src/ed-fi/descriptors/ethnicity-descriptor.ts`: CEHRD bands (Brahmin/Chhetri, Janajati, Madheshi, Dalit, Muslim, Other) + Nepal caste aliases mapping into bands; register in `catalogs.ts`; add `'EthnicityDescriptor'` to `DescriptorType`. Load-time schema validation (no dup codes / URI-code mismatch). | Unit test: `resolveDescriptor('EthnicityDescriptor', 'Brahmin')` → band URI; unknown → null; catalog passes `descriptorCatalogSchema`. |
| GB3.2 | Extend the Saraswati fixture spec to cover every distinct caste value in the real roster → asserts each resolves (the regression fence pattern already used for the 779 values). | `saraswati-fixture.spec.ts` extended; green; an injected unmapped value fails red. |
| GB3.3 | Replace the hardcoded regex `ethnicityDescriptorToBand` ([`transforms.ts:28`](../../server/lib/analytics/lambda/report-aggregator/transforms.ts#L28)) with a `resolveDescriptorEntry('EthnicityDescriptor', …)` lookup returning the band; preserve `''`-on-unresolved behavior. | `transforms.spec.ts` extended: catalog-backed mapping for all bands; unresolved → `''`. Existing Flash I generator spec green. |
| GB3.4 | Wire caste import in [`iemis-transform.ts`](../../server/application/microservices/academics/src/students/iemis-transform.ts) (mirror the gender/motherTongue/disability D0a.2 flow): map the IEMIS caste column → `student.ethnicityDescriptor`; unknown → warning, not error. **First verify the exact column header** against [`docs/pilot-greenlight/e1-flash-csv-schema.md`](../pilot-greenlight/e1-flash-csv-schema.md) + the Saraswati fixture (it is currently unmapped — do not guess the header). | Unit test: IEMIS row with the real caste header → DTO carries `ethnicityDescriptor` URI; unmapped value → warning collected, import continues; header asserted against the schema doc. |
| GB3.5 | Add `EthnicityDescriptor` to `GovernanceProfile.compliance.requiredDescriptors` for PABSON, so the GB0 conformance suite now *enforces* the catalog's existence. | Conformance suite asserts the catalog is registered; removing the catalog fails CI. |
| GB3.6 | Publish shared-types minor (new catalog) + consumer pin bump; the analytics Lambda + identity both consume it. | `npm install` resolves; academics Docker build clean; analytics `cdk synth` clean. |
| GB3.7 | Deploy `analytics-stack` (report-aggregator picks up catalog-backed transform) + academics ECR/ECS (importer). Live smoke: Flash I dry-run on dev-pabson tenant → `caste_ethnicity` populated from catalog. | Evidence to `docs/deploys/gb3-ethnicity-<sha>.md`. STOP: any previously-populated caste column now blank → halt + revert GB3.3. |

> **Backfill stance (existing students):** caste was never imported, so existing
> Saraswati students have no source caste value to re-map — their enrichment
> happens via the **Saraswati Sprint E re-import** path (which re-enriches existing
> students), not a GB3 backfill script. GB3 ships the catalog + import wiring; the
> historical backfill is Sprint E's, by design.

**Closeout.** Memory `memory/project_governance_framework_gb3.md`; cross-link the
Ed-Fi review's Gap D.4/D.5 as closed.

---

## Sprint GB4 — Add CBS governance body skeleton end-to-end (extensibility proof)

**Goal.** *Prove* the framework's Definition of Done: adding a new governance body
is a single data module + locale pack + holiday-seed stub, gated by a green
conformance suite, with **ZERO call-site edits**. Add **CBS** (Central Bureau —
public Nepal schools) as a complete profile that stays non-runtime-valid in prod
(not added to `activeArchetypeSchema` until product greenlights) but is fully
exercisable in tests and dev. Executes Midnight Lockin **P2.1**.

**Demo.** With CBS temporarily added to the active enum in a dev/test build:
(1) the GB0 conformance suite passes for CBS with **no other code changes**;
(2) a provisioned CBS dev tenant seeds CBS-contextual defaults (its calendar,
grading, curriculum, school config) end-to-end; (3) `git diff` shows only new
data files + enum + locale/holiday entries — **no service-layer edits**.

| # | Title | Validation |
|---|---|---|
| GB4.1 | Add CBS rows to **both** archetype tables — `ARCHETYPE_DEFAULTS_TABLE` (grading, promotion, examPattern, boardExams, `primaryCurriculumRef`, `complianceForms`, `complianceRequiredDescriptors`) in `archetype-defaults.ts` **and** the regional `ARCHETYPE_DEFAULTS` in `tenant-locale-defaults.ts` — plus `bell-schedule-presets.ts`, `activation-requirements.ts`, and the archetype config in `department.entity.ts`. **Data files only.** Values per the CBS public-school governance brief (placeholder-but-plausible where pending, flagged `// TODO(cbs-liaison)`). | Each of the **two** `ARCHETYPE_DEFAULTS*` tables + the other 3 tables has a CBS entry; `tsc` clean; the GB0.0 enum-parity test still green after CBS is added to the canonical enum. |
| GB4.2 | Add a CBS holiday-seed stub `holiday-seeds/cbs-npl-<bsYear>.json` + registry entry (can mirror PABSON's national holidays minus PABSON-specific blocks). | `resolveHolidaySeed('CBS', 'NPL', <year>)` returns the stub with `appliedFallback: 'exact'`. |
| GB4.3 | **The proof ticket.** Add `'CBS'` to a *test-only* active enum and run GB0's conformance suite against it. Prove ZERO service-layer edits via a **real, repeatable CI gate**, not eyeballing. | A committed script `scripts/lint/assert-archetype-data-only.sh` runs `git diff --name-only <base>..HEAD` and fails non-zero if any path matches `^server/application/microservices/.*/src/` (allow-list: the single `provision-tenant.sh` extension point from GB4.4). Conformance suite green for CBS; the script is wired into CI and is the headline acceptance gate. |
| GB4.4 | Provisioning dry-run: extend the tenant-seeder unit test to seed a `CBS` tenant (using injected defaults) and assert METADATA + SETTINGS#WORKSPACE rows carry CBS regional defaults — verifying the seeder is archetype-generic (reads from tables, needs no change). | Seeder test seeds CBS row with CBS currency/calendar. If `provision-tenant.sh`'s validation allow-list needs a one-line `CBS` addition, that single edit is the **only** permitted call-site change, allow-listed in GB4.3's script and documented as the one extension point. |
| GB4.5 | AdminWeb tenant-create: confirm CBS appears in the create-tenant archetype dropdown. [`client/AdminWeb/src/pages/Tenants/TenantCreate.tsx`](../../client/AdminWeb/src/pages/Tenants/TenantCreate.tsx) is **already** driven by `ARCHETYPE_OPTIONS` from `@aibrains/shared-types` (verified in review) — so this is a data add to `ARCHETYPE_OPTIONS`, not a component edit. **CLAUDE.md trap:** any shared-types change consumed by AdminWeb requires the `zod ~3.24.4` pin + the jsdom bundle-sim before the controlplane redeploy. | Adding CBS to `ARCHETYPE_OPTIONS` makes it selectable in AdminWeb (component diff empty); AdminWeb jsdom bundle-sim passes; CBS stays gated out of the runtime-active set per GB4.6. |
| GB4.6 | Author the "Adding a governance body" runbook at `docs/archetype-framework/adding-a-governance-body.md`. **Generate its file list from the actual GB4 diff** (`git diff --name-only`) so the runbook can't drift from reality. Cover: the file list, the GB4.3 CI gate, the coordinated shared-types publish, and the cross-repo handshake with `frontend-sprint-plan.md` GF5. | Runbook's file list is generated (not hand-written) and matches the GB4 diff; reviewer confirms. |
| GB4.7 | Coordinated shared-types publish for the CBS data + consumer pin bumps. **Keep CBS out of the production active set** — ship the data, not the runtime activation. (Frontend GF5 is a *separate* `@edforge/archetype` publish landed in the same change-window — see north-star §4.) | `npm install` resolves; all consumers (incl. AdminWeb) build; production enum still `['PABSON','GENERIC']`; a test confirms `POST /tenants {archetype:'CBS'}` is rejected in prod config. |

**Closeout.** Memory `memory/project_governance_framework_gb4.md`; mark Midnight
Lockin **P2.1** done; note CBS is "data-complete, runtime-deferred" so the first
real CBS pilot is a flag flip + liaison-verified values, not an engineering project.

---

## Backend Definition of Done (framework-level)

- [ ] `getGovernanceProfile(archetype)` is the single import for governance config; conformance suite green for all active archetypes (GB0).
- [ ] Zero `country === 'NPL'`-style branches in runtime service code; CI lint enforces it (GB1).
- [ ] Archetype defaults are *applied*, not just defined: board exams, curriculum ref, school config all flow from the profile at the right seams (GB2).
- [ ] PABSON Flash I `caste_ethnicity` is catalog-backed and compliant; the missing descriptor gap is closed (GB3).
- [ ] Adding CBS required only data files + a green conformance run — proven, not asserted (GB4).
- [ ] Every ticket shipped with tests; every sprint demoed; Midnight Lockin P2.1 + P3.8 marked done.

---

*Backend plan generated 2026-06-03 from the end-to-end code review. Subagent-reviewed
against atomic-ticket / demoable-sprint / no-duplication criteria before finalization.*
