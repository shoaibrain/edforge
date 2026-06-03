# Governance-Body Archetype Framework — Backend Sprint Plan

> **Repo:** `shoaibrain/edforge` (server + CDK + shared-types).
> **Reads with:** [`00-north-star.md`](./00-north-star.md) (architecture + cross-repo map).
> **Frontend counterpart:** `edforge-saas-frontend/docs/archetype-framework/frontend-sprint-plan.md`.
>
> Five sprints, ~34 atomic tickets. Every ticket is one commit + one PR with a
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

GB0 and GB1 are independent and can run in parallel. GB2 depends on GB0
(consumes the aggregator). GB3 is independent. GB4 depends on GB0–GB3 (it is the
extensibility proof and must light up every wired surface).

---

## Sprint GB0 — Governance profile aggregator + conformance harness

**Goal.** Make the governance body a first-class object without changing any
runtime behavior. Create a single `GovernanceProfile` aggregator that *imports*
(never copies) the existing scattered tables, and a conformance test that fails
CI if any runtime-active archetype is missing or inconsistent on any surface.

**Demo.** `npx jest governance-profile` runs the conformance suite green for
`PABSON` + `GENERIC`; a deliberately-incomplete archetype (added in a throwaway
test fixture) fails it red. No production code path changes — pure addition.

| # | Title | Validation |
|---|---|---|
| GB0.1 | Write the framework RFC at `docs/archetype-framework/rfcs/0001-governance-profile.md`: define `GovernanceProfile` shape, the "aggregator is a view, not a rewrite" rule, the conformance contract, and the ZERO-call-site-edit DoD. Link the north-star. | RFC reviewed + merged; reviewer confirms it cites the existing tables it will aggregate. |
| GB0.2 | Add `GovernanceProfile` + slot types to `packages/shared-types/src/archetype/governance-profile.ts`. Types only — no values yet. Re-export from package index. | `tsc` clean; types exported; unit test asserts the type compiles against a hand-written PABSON literal. |
| GB0.3 | Implement `getGovernanceProfile(archetype): GovernanceProfile` that composes existing constants: `resolveArchetypeDefaults` (regional), `getArchetypeDefaults` (grading/promotion/examPattern/boardExams/curriculumRef), `ARCHETYPE_BELL_PRESETS`, `ARCHETYPE_ACTIVATION_REQUIREMENTS`, compliance templates. **Import the constants — do not inline literals.** | Unit test: `getGovernanceProfile('PABSON').regional.currency === 'NPR'`; `.boardExams` includes `SEE`; assertion that each slot is referentially sourced (spy/import check), not a copied literal. |
| GB0.4 | Conformance harness `governance-profile.conformance.spec.ts`: `it.each(activeArchetypeSchema.options)` asserts every slot present + non-empty. | Suite green for PABSON/GENERIC. |
| GB0.5 | Conformance cross-checks: every `boardExams[].gradeLevel` resolves via `resolveDescriptor('GradeLevelDescriptor', …)`; every `compliance.requiredDescriptors[]` has a registered catalog in `ed-fi/descriptors/catalogs.ts`; `regional.calendarSystem ∈ {bikram_sambat, gregorian}`. | Suite asserts each cross-check; a fixture with a bogus board-exam grade fails red (`@ts-expect-error`/runtime assertion). |
| GB0.6 | Drift guard: assert `getGovernanceProfile(a).regional` deep-equals `resolveArchetypeDefaults(a, …)` and `.grading` deep-equals `getArchetypeDefaults(a).grading` for PABSON+GENERIC — proving the aggregator never diverges from its sources. | Equality test green; a manual divergence (temp edit) fails it. |
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
| GB1.2 | Refactor `getDefaultConfigForCountry()` ([`department.entity.ts:230`](../../server/application/microservices/identity/src/common/entities/department.entity.ts#L230)) → `getDefaultConfigForArchetype(archetype, country)` using archetype-over-country precedence (mirror `workspace-settings.entity.ts:227`). Keep the country map as the *fallback* layer only; surface the result via `GovernanceProfile.schoolConfigDefaults`. | Unit test matrix: PABSON→Sun-Fri/24h/CEHRD scale; GENERIC+NPL→country fallback; GENERIC+US→US defaults. Existing school-create specs green. |
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
| GB2.2 | `getOrSeedBoardExams(schoolId, ctx)` in academics: idempotent (GSI query first; if empty, build from `GovernanceProfile.boardExams`; conditional `attribute_not_exists` write to prevent double-seed; on `ConditionalCheckFailed` re-query). | Unit test (aws-sdk-client-mock): first call seeds N exams, second call seeds 0; ConditionalCheckFailed branch returns winner. |
| GB2.3 | Wire board-exam list endpoint to call `getOrSeedBoardExams` on empty result, then re-query (mirror grading-policy read-path fallback). | Route-shape test: empty path returns PABSON board exams; non-empty (operator-defined) path unchanged. |
| GB2.4 | Default `curriculumRef` from `GovernanceProfile.curriculumRef` at course-create when the DTO omits it (PABSON→`CDC_NCF_2076`; GENERIC→none). Operator override always wins. | Unit test: PABSON course create w/o curriculumRef → `CDC_NCF_2076`; with override → override; GENERIC → unset. |
| GB2.5 | Surface allowed exam types from `GovernanceProfile.examPattern` via a read endpoint the setup checklist can call (the *validation* at `exams.service.ts:395` already rejects bad types — this exposes the allowed set eagerly). Three-way route registration (controller + `tenant-api-prod.json` + nginx if new prefix). | Route-shape test returns PABSON exam pattern; `check-route-drift.ts` green; smoke returns 200 not 403/404. |
| GB2.6 | Concurrency safety test for GB2.2 using dynamodb-local: `Promise.all([seed × 5])` → exactly N board-exam rows. (Skip if GB2.2's `attribute_not_exists` is proven by the aws-sdk-client-mock test — note the decision in commit body.) | dynamodb-local test deterministic; 1 set of rows. |
| GB2.7 | CloudWatch alarm on `getOrSeedBoardExams` invocation rate (>1/school/day = re-seed loop) — reuse the Sprint-B grading alarm pattern. | Alarm in CDK output; fires on synthetic metric. |
| GB2.8 | Publish shared-types minor (if `GovernanceProfile` slots changed) + consumer pin bump. | `npm install` resolves; academics Docker build clean. |
| GB2.9 | Deploy academics (ECR + ECS rolling update; `analytics`/`tenant-template` `cdk diff` empty unless GB2.7 alarm added → then deploy that stack). Live smoke: fresh PABSON dev school auto-seeds board exams + curriculum. | Evidence to `docs/deploys/gb2-lifecycle-seeding-<sha>.md`. STOP: any school's board-exam rows >N → halt + delete duplicates by `createdAt`. |

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
| GB3.4 | Wire caste import in [`iemis-transform.ts`](../../server/application/microservices/academics/src/students/iemis-transform.ts) (mirror the gender/motherTongue/disability D0a.2 flow): map the `Caste`/`Caste/Ethnicity` column → `student.ethnicityDescriptor`; unknown → warning, not error. | Unit test: IEMIS row with caste → DTO carries `ethnicityDescriptor` URI; unmapped → warning collected, import continues. |
| GB3.5 | Add `EthnicityDescriptor` to `GovernanceProfile.compliance.requiredDescriptors` for PABSON, so the GB0 conformance suite now *enforces* the catalog's existence. | Conformance suite asserts the catalog is registered; removing the catalog fails CI. |
| GB3.6 | Publish shared-types minor (new catalog) + consumer pin bump; the analytics Lambda + identity both consume it. | `npm install` resolves; academics Docker build clean; analytics `cdk synth` clean. |
| GB3.7 | Deploy `analytics-stack` (report-aggregator picks up catalog-backed transform) + academics ECR/ECS (importer). Live smoke: Flash I dry-run on dev-pabson tenant → `caste_ethnicity` populated from catalog. | Evidence to `docs/deploys/gb3-ethnicity-<sha>.md`. STOP: any previously-populated caste column now blank → halt + revert GB3.3. |

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
| GB4.1 | Add CBS rows to every governance table: `archetype-defaults.ts` (grading, promotion, examPattern, boardExams, curriculumRef, compliance), `tenant-locale-defaults.ts` (regional), `bell-schedule-presets.ts`, `activation-requirements.ts`, `department.entity.ts` archetype config. **Data files only.** Values per the CBS public-school governance brief (placeholder-but-plausible where the brief is pending, flagged with `// TODO(cbs-liaison)`). | Each table has a CBS entry; `tsc` clean. |
| GB4.2 | Add a CBS holiday-seed stub `holiday-seeds/cbs-npl-<bsYear>.json` + registry entry (can mirror PABSON's national holidays minus PABSON-specific blocks). | `resolveHolidaySeed('CBS', 'NPL', <year>)` returns the stub with `appliedFallback: 'exact'`. |
| GB4.3 | **The proof ticket.** Add `'CBS'` to a *test-only* extension of the active enum and run the GB0 conformance suite against it. Assert it passes with **no edits to any `server/application/microservices/**/src` file** in the diff. | Conformance suite green for CBS; a CI assertion (or reviewer-verified `git diff --stat`) confirms zero service-layer files changed. This is the headline acceptance test. |
| GB4.4 | Provisioning dry-run: extend the tenant-seeder unit test to seed a `CBS` tenant (using injected `ARCHETYPE_DEFAULTS`) and assert METADATA + SETTINGS#WORKSPACE rows carry CBS regional defaults — verifying `provision-tenant.sh` validation + seeder are archetype-generic (they read from tables, so should need no change). | Seeder test seeds CBS row with CBS currency/calendar; if `provision-tenant.sh`'s allow-list needs a one-line CBS addition, that single edit is the *only* permitted call-site change and is noted as the documented extension point. |
| GB4.5 | Author/refresh the "Adding a new governance body" runbook at `docs/archetype-framework/adding-a-governance-body.md`: the exact file list (the data files touched in GB4.1–GB4.2), the conformance gate, the coordinated shared-types publish, and the cross-repo handshake with `frontend-sprint-plan.md` GF5. | Runbook reviewed; a second engineer follows it on paper and confirms completeness against the GB4 diff. |
| GB4.6 | Coordinated shared-types publish for the CBS data (batched with frontend GF5 per north-star §4) + consumer pin bumps. **Keep CBS out of the production `activeArchetypeSchema`** — ship the data, not the runtime activation. | `npm install` resolves; all consumers build; production enum still `['PABSON','GENERIC']`; a test confirms a `POST /tenants {archetype:'CBS'}` is still rejected in prod config. |

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
