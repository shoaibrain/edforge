# EdForge — Saraswati Pilot Revised Roadmap

**Status:** Draft v1 (post-subagent review)
**Author:** Claude (pair-programming with Shoaib)
**Date drafted:** 2026-04-26
**Supersedes:** ad-hoc go-live plan in `~/.claude/plans/peaceful-meandering-alpaca.md`
**Companion docs:**
- [docs/operations/iemis-emis-sprint-plan.md](docs/operations/iemis-emis-sprint-plan.md) (v4 import sprint plan — partially superseded by Sprint D below)
- [docs/operations/iemis-import-post-mortem-and-emis-roadmap.md](docs/operations/iemis-import-post-mortem-and-emis-roadmap.md)
- [CLAUDE.md](CLAUDE.md)

---

## 0. Executive summary

EdForge is on prod through Sprint 4 partial (S4.1 + S4.6 + S4.7). The remaining work to take Nepal's first pilot school (Saraswati) live — and then prove the Ed-Fi → IEMIS round-trip at end-of-cycle — is broken into **fourteen sequential sprints (A–N)**. The first eight (A–H) are the critical path to green-go; the last six (I–N) are the proof-of-model + post-pilot expansion path.

The plan is structured around three architectural commitments:
1. **Ed-Fi spine, IEMIS adapter.** The data model is Ed-Fi compliant; IEMIS specifics are mappers, descriptors, and export formats layered on top. The same pattern scales to other markets.
2. **Archetype-first, not country-first.** PABSON drives Nepal-specific behavior; the codebase is structured so adding `CBSE_IN`, `NAIS_US`, etc. is a config-and-component drop, not a fork.
3. **No live PII without compliance baseline.** KMS-CMK + PITR + audit-emit alarm + data-residency memo land before real-tenant onboarding.

---

## 1. Where we are today (2026-04-26 prod snapshot)

### 1.1 Shipped to prod

| Sprint / phase | Evidence |
|---|---|
| Midnight Lockin Sprints A/B/C | memory `project_midnight_lockin_sprints_ab.md`, `project_midnight_lockin_sprint_c.md` |
| Midnight Lockin Phase 4 observability | memory `project_midnight_lockin_phase_4.md` |
| Sprint 0 foundations | `docs/deploys/prod-sprint-0-3-deploy-summary-20260424-3c420c1.md` |
| Sprint 1 IEMIS identity/RBAC/audit + IemisCodeBadge frontend | same + frontend PR #31 |
| Sprint 2 Ed-Fi descriptor catalogs + resolver | same |
| Sprint 3 Student demographics PATCH + SSA projection + Demographics tab + descriptor mapper hotfix (PR #23) | same + frontend PR #36 |
| Sprint 4 partial — S4.1 (5 IEMIS Staff fields) + S4.6 (16-digit IEMIS Staff ID) + S4.7 (6 audit event types) | `docs/deploys/prod-sprint4-s4.1-s4.6-deploy-summary-20260424-e4ff44e.md`; S4.7 prod smoke 21/21 green at `identity:5c673b9-20260425051222` |

Shared-types currently published at **0.34.0**. Frontend at PR #36 merged.

### 1.2 Open gaps blocking pilot green-go

| # | Gap | Sprint that resolves |
|---|---|---|
| G1 | Address-bearing forms hardcoded US-shaped (the just-flagged regression on edforge.app) | A |
| G2 | Phone inputs accept any string; no Nepal +977 validation | A |
| G3 | Sprint 4 frontend incomplete — EditStaffModal missing the 5 IEMIS fields | B |
| G4 | StaffTraining backend + UI not built | B |
| G5 | KMS CMK not yet provisioned in ap-south-1 | C |
| G6 | Audit federation: `/iemis/audit` only reads identity DDB; academics events (`student.descriptor.edited`) not surfaced | C |
| G7 | Academics IEMIS audit-emit-failure alarm missing (identity has one, academics doesn't) | C |
| G8 | SNS subscription not wired to operator alert topic on prod | C |
| G9 | Pilot xlsx import pipeline end-to-end incomplete (504 timeout, no Ed-Fi descriptor enrichment, no findings UI) | D + E |
| G10 | Day-one ops not validated against Nepal-shaped data | F |
| G11 | Prod rehearsal §7.3 QA not run | G |
| G12 | Real Saraswati tenant not provisioned | H |
| G13 | Saraswati Student.ethnicity field absent — schema migration risk if added post-onboarding | C (promoted from I per review) |
| G14 | DSAR / data-export user endpoint not built | C |
| G15 | Cognito MFA not enforced on tenant admins | C |
| G16 | No AWS WAF / managed rule set on edforge.app | C |
| G17 | Pen-test not yet engaged | C |
| G18 | No "kill switch" (per-tenant feature flag) for IEMIS UI in case of incident | C |

### 1.3 Carry-forward observations from subagent review

The plan distinguishes **three** address shapes today:

| Shape | File / line | Used by | Has Nepal fields? |
|---|---|---|---|
| `addressSchema` (legacy) | [packages/shared-types/src/schemas/common.ts:119](packages/shared-types/src/schemas/common.ts#L119) | Student, Family, Guardian | No |
| `staffAddressSchema` (Ed-Fi-shaped) | [packages/shared-types/src/schemas/identity/staff.schema.ts:124](packages/shared-types/src/schemas/identity/staff.schema.ts#L124) | Staff | No |
| `schoolAddressSchema` (Nepal-aware) | [packages/shared-types/src/schemas/identity/school.schema.ts:85](packages/shared-types/src/schemas/identity/school.schema.ts#L85) | School | **Yes** — `wardNumber/municipality/district/province/region` + NPL-conditional refinements at lines 103-121 |

`schoolAddressSchema` is the canonical Nepal shape. Sprint A's job is to reuse that pattern for Student/Family/Guardian/Staff — **extend, don't rename**, to preserve GENERIC-tenant compatibility.

NGINX has a prefix-regex `location ~ ^/staff` at [server/application/reverseproxy/nginx.template:131](server/application/reverseproxy/nginx.template#L131) that catches all `/staff/*` sub-paths. **No rproxy edit is needed for new `/staff/:id/trainings` routes.** This affects framing of Sprint B (two-way registration, not three-way) and any future `/staff` sub-routes.

DDB PITR is on by default at [server/lib/tenant-template/ecs-dynamodb.ts:30](server/lib/tenant-template/ecs-dynamodb.ts#L30). Sprint C's PITR ticket reframes as "verify + regression-assert," not "enable."

---

## 2. Architectural framing

### 2.1 Ed-Fi spine, IEMIS adapter

EdForge stores data in Ed-Fi-aligned shapes (Student, Staff, EducationOrganization, Section, StudentSchoolAssociation, etc.). IEMIS / CEHRD specifics — `emisStudentId`, `emisSchoolCode`, mother-tongue Ed-Fi descriptors, Flash I/II export schemas — are **adapters** at the edges:

- **Inbound adapter:** xlsx import pipeline (Sprint D + E) parses CEHRD-shaped data and writes Ed-Fi-shaped DDB rows.
- **Outbound adapter:** Flash I/II export (Sprint I + K + L) reads Ed-Fi-shaped DDB rows and writes CEHRD-shaped .xlsm files.
- **Reference catalogs:** Ed-Fi descriptor URIs (Sprint 2 already shipped) bridge Nepal vocabulary to Ed-Fi vocabulary.

This means: the same Edforge codebase serves a US Ed-Fi school by switching the *adapter set*, not by forking the entity layer.

### 2.2 Archetype-first

`Tenant.archetype` is a write-once first-class field (PABSON or GENERIC in V1). All Nepal-specific UI/UX behavior branches on `archetype === 'PABSON'`, not on `country === 'NPL'`. This is so a future PABSON-equivalent in another country (e.g., a PABSON-affiliated chain in India) gets the same treatment without country-code gymnastics. Per memory `edforge_archetype_model.md`.

### 2.3 Three-way (or sometimes two-way) route registration

New API routes touch:
1. **NestJS controller** — actual handler.
2. **API Gateway** — `server/lib/tenant-api-prod.json`.
3. **NGINX rproxy** — `server/application/reverseproxy/nginx.template`. **Skip if** the path's parent prefix is already in nginx as a regex (e.g., `/staff/*` is covered by `location ~ ^/staff`).

Per memory `edforge_api_gateway_route_registration.md`.

### 2.4 shared-types versioning

Every minor bump (`0.N.0` → `0.(N+1).0`) requires explicit consumer pin updates because npm desugars `^0.N.0` to `>=0.N.0 <0.(N+1).0`. Per memory `edforge_shared_types_caret_pin.md`. AdminWeb has a publish-gate (workspace-only packages break CodeBuild) per CLAUDE.md; edforge-saas-frontend is on Vercel and resolves locally.

### 2.5 Two git repos

`shoaibrain/edforge` (server/CDK + AdminWeb) and `shoaibrain/edforge-saas-frontend` (tenant-facing MFE) are independent remotes. The frontend checkout is nested inside the server dir but is **not** a submodule. Every git op must `cd <repo> && git ...` in the same Bash call. Per memory `edforge_two_git_repos.md`.

---

## 3. Definition of "green-go"

Saraswati admin signs in to `edforge.app`, sees their imported students with full demographic + guardian data correctly shaped, can take attendance / enter grades / record fees in Nepali context (NPR currency, BS dates, Nepal-shaped addresses), with all PII at rest under KMS-CMK + PITR, audit federation surfacing both identity + academics events, alarms wired to SNS, ethnicity field present and backfill-ready.

**Quantitative green-go gates (must pass before H.7 sign-off):**
- 779/779 students imported correctly (or whatever Saraswati's actual count is).
- 0 audit-emit failures during 7-day post-onboarding window.
- 0 5xx errors on edforge.app prod for 7 days.
- p95 latency < 1.5s on student-list and student-detail pages.
- Saraswati principal NPS ≥ 8 in 7-day check-in.
- All Sprint G QA boxes green.
- Pen-test report received with zero High/Critical findings open.

---

## 4. Goals & non-goals

### 4.1 In scope (this roadmap)
- Saraswati green-go.
- Region-aware UX foundation (PABSON archetype on edforge.app).
- Pre-pilot compliance baseline.
- Pilot xlsx import pipeline (synchronous-feeling but async-implemented).
- CEHRD Flash I round-trip (proof-of-model, end of pilot academic cycle).
- Flash II student/staff/infra/attendance exports (end-of-year reporting).

### 4.2 Out of scope (deferred post-pilot, tracked in Sprint M/N or beyond)
- Parent portal / parent Cognito accounts.
- Real-time CEHRD portal API integration (manual upload acceptable for V1).
- Multi-language UI (Nepali strings).
- Advanced/Premium tier features.
- Multi-region replication.
- Async batched cross-tenant imports (single-tenant async sufficient for V1).
- Live event-bus telemetry to analytics for IEMIS events (analytics already serves descriptor data via existing route).

---

## 5. Sprint-numbering convention

The original v4 import plan used `S0.1`, `S1.4` etc. This roadmap uses `A.1`, `B.5` etc. for clarity (one letter per sprint). When a ticket is inherited from the v4 plan, the v4 ID is noted in parentheses.

Existing deploy logs (`docs/deploys/uat-sprint0-…`) reference S-numbers; do **not** rename those. The new lettering applies to *future* logs only.

| Letter | Sprint name | Demo gate |
|---|---|---|
| A | Region-aware UX foundation | Saraswati admin sees Nepal-shaped fields + GENERIC tenant unchanged |
| B | Sprint 4 wrap (Staff completeness) | Full Staff record incl. trainings; 9 IEMIS Staff event types in audit |
| C | Pre-pilot compliance baseline | Induced failure → SNS arrives; KMS+PITR verified; Student.ethnicity in schema |
| D | Pilot xlsx import (foundation) | 779-row upload → dry-run → commit → ImportReport, no 504 |
| E | Pilot xlsx import — Ed-Fi descriptor enrichment | Re-import enriches existing students; Demographics tab shows mapped values |
| F | Day-one operational validation | Full operational flow on Nepal data; no US artifacts |
| G | Prod rehearsal | §7.3 QA all-green; PITR drill passes |
| H | Real Saraswati onboarding | Live tenant; principal trained; 7-day monitor green |
| I | CEHRD Flash I export (proof-of-model) | Fixture round-trip + manual CEHRD upload accepted |
| J | SchoolInfrastructure entity | UI captures rooms/toilets/water/electricity |
| K | Flash II student export | End-of-year student outcomes exported |
| L | Flash II staff/infra/attendance | Full Flash II reporting suite |
| M | Multi-school readiness | Async + concurrency proven |
| N | Compliance/ops backlog | DSAR endpoint, IEMIS Console, calendar |

---

## 6. Sprint-by-sprint plan

Conventions:
- Each ticket: ID, title, files touched, summary, validation, deploy step.
- "Validation" = vitest / NestJS test / smoke / manual screenshot — never absent.
- Tickets are listed in dependency order within a sprint. Inter-sprint dependencies noted at sprint header.
- "(v4 S<n>.<m>)" = inherited from `docs/operations/iemis-emis-sprint-plan.md`.

---

### Sprint A — Region-aware UX foundation

**Goal:** every address-bearing form on edforge.app adapts to tenant archetype. Saraswati admin sees Nepal-shaped fields (Province / District / Municipality / Ward / Tole / Postal Code); GENERIC-archetype tenants see the existing US-shaped fields unchanged. Phone fields validate +977 for PABSON tenants.

**Inter-sprint dependencies:** none (this is the first sprint).

**Demo:** log in as Saraswati admin → "Add Staff" → see Nepal-shaped fields with Province dropdown (default Bagmati) + +977 phone input → save → reload → fields persist. Then log in as a generic-archetype tenant → see US-shaped fields unchanged.

**Tickets:**

#### A.0 — Audit & policy: existing-tenant address-data divergence
- **Touches:** `docs/decisions/region-aware-forms-divergence.md` (NEW)
- **Summary:** decide whether existing edforge.app tenant data with US-shaped addresses (e.g., the rehearsal tenant's 20 imported students) gets migrated, wiped, or tolerated. Recommendation: **tolerate** — the schema extension is additive, GENERIC tenants keep working, PABSON tenants can populate Nepal fields manually post-Sprint A. Document the policy + sign off.
- **Validation:** ADR doc lands; PR-tagged.
- **Deploy:** none.

#### A.1 — Backend: extend legacy `addressSchema` (Student / Family / Guardian)
- **Touches:** [packages/shared-types/src/schemas/common.ts:119](packages/shared-types/src/schemas/common.ts#L119)
- **Summary:** add 4 optional fields: `wardNumber` (string max 10), `municipality` (string max 100), `district` (string max 100), `province` (string max 100). Mirror naming from `schoolAddressSchema` for consistency. **Do not** add NPL-conditional refinements — keeps GENERIC tenants validating; PABSON tenant validation is enforced at the frontend `<AddressFields>` component instead. **Do not rename existing fields** (`street1` etc. stay).
- **Validation:** vitest — Nepal-shaped payload validates; US-shaped payload still validates; existing tests unmodified pass.
- **Deploy:** part of A.6 publish.

#### A.2 — Backend: extend `staffAddressSchema` with Nepal-aware fields
- **Touches:** [packages/shared-types/src/schemas/identity/staff.schema.ts:124](packages/shared-types/src/schemas/identity/staff.schema.ts#L124)
- **Summary:** add the same 4 fields. Ed-Fi-shaped naming kept (`stateAbbreviationDescriptor`, `streetNumberName`); Nepal fields are extension-only.
- **Validation:** vitest as A.1.

#### A.3 — Backend: confirm `schoolAddressSchema` already has Nepal fields
- **Touches:** [packages/shared-types/src/schemas/identity/school.schema.ts:85](packages/shared-types/src/schemas/identity/school.schema.ts#L85) — read-only audit.
- **Summary:** verify the existing fields (`wardNumber`, `municipality`, `district`, `province`, `region`, NPL-conditional refinements) are sufficient. Document the canonical pattern for Sprint A as the reference.
- **Validation:** read code, write a 1-paragraph note in ADR A.0.

#### A.4 — Shared-types: Nepal administrative-divisions reference data
- **Touches:** `packages/shared-types/src/locale/nepal-administrative-divisions.ts` (NEW)
- **Summary:** export `NEPAL_PROVINCES` (7 entries: `provinceCode` 1–7, `nameEn`, `nameNe`); `NEPAL_DISTRICTS` (77 entries with `provinceCode` FK + `nameEn` + `nameNe` + CEHRD district code); `NEPAL_MUNICIPALITY_TYPES` (`metropolitan` / `sub_metropolitan` / `municipality` / `rural_municipality`).
- **Source of truth:** **CEHRD-canonical** — same district codes/spellings CEHRD publishes for Flash I/II forms. Single source for both import (xlsx data) and export (Flash .xlsm cells) eliminates drift. Header doc-comment in the file MUST cite: source URL, retrieved-on date, sha256 of source artifact, catalog version. On CEHRD reorganization, bump catalog version + add migration test asserting legacy district codes still resolve.
- **Validation:** vitest — count assertions (7 / 77), `provinceCode` FK integrity (every district's `provinceCode` ∈ {1..7}), spot-check 5 districts across all 7 provinces, header doc-comment present + sha256 matches the committed source artifact.

#### A.5 — Shared-types: phone-format helper
- **Touches:** `packages/shared-types/src/locale/phone-format.ts` (NEW)
- **Summary:** export `phoneFormatForArchetype(archetype, country)` returning `{ dialCode, regex, placeholder, label }`. PABSON+NPL → `{ '+977', /^[2-9]\d{9}$/, '98XXXXXXXX', 'Nepal mobile' }`. Default → US-style.
- **Validation:** vitest — 5 input cases per archetype.

#### A.6 — Shared-types: 0.35.0 publish (atomic publish-only)
- **Touches:** `packages/shared-types/package.json` (version), `packages/shared-types/src/index.ts` (exports)
- **Summary:** version bump + new exports + `npm publish`. **Does not** touch any consumer pin — that's A.6a/A.6b/A.6c. Run AdminWeb jsdom bundle sim per CLAUDE.md.
- **Validation:** `npm view @aibrains/shared-types version` returns `0.35.0`. AdminWeb bundle sim passes (silent-bundle-failure check).

#### A.6a — Consumer pin bump: server (NestJS microservices)
- **Touches:** [server/package.json](server/package.json), [server/application/package.json](server/application/package.json), root [package.json](package.json) — `^0.34.0` → `^0.35.0`
- **Summary:** atomic bump in server-side consumers; lockfile refreshed.
- **Validation:** `nest build identity && nest build academics && nest build finance` all green.

#### A.6b — Consumer pin bump: AdminWeb
- **Touches:** [client/AdminWeb/package.json](client/AdminWeb/package.json) (verify if it imports the new exports)
- **Summary:** if AdminWeb imports any new symbol via barrel, bump pin. If not, skip with a comment in PR.
- **Validation:** AdminWeb local build + jsdom sim.

#### A.6c — Consumer pin bump: edforge-saas-frontend
- **Touches:** every `package.json` in `edforge-saas-frontend/` workspace that pins `@aibrains/shared-types`
- **Summary:** atomic per-workspace bump.
- **Validation:** `npm run build` per affected workspace.

#### A.7 — Frontend: archetype context provider
- **Touches:** `edforge-saas-frontend/packages/auth/src/contexts/TenantArchetypeContext.tsx` (NEW or extend existing TenantContext)
- **Summary:** expose `tenantArchetype` (PABSON | GENERIC) and `tenantCountry` (ISO-3166 alpha-3) via React context, sourced from `WorkspaceSettings`. Memoized; refreshes on tenant switch.
- **Validation:** vitest — provider yields correct value for mocked PABSON tenant; for GENERIC tenant.

#### A.8 — Frontend: `<AddressFieldsNepal>` component
- **Touches:** `edforge-saas-frontend/packages/forms/src/sections/AddressFieldsNepal.tsx` (NEW)
- **Summary:** render Province (select, 7 entries from `NEPAL_PROVINCES`), District (cascading select from `NEPAL_DISTRICTS`), Municipality (input + type select), Ward (number 1-99), Tole (free text → maps to `street1`), Postal Code (optional), Country (locked "Nepal" / NPL).
- **Validation:** vitest — renders all 7 fields, district options cascade correctly, form-state shape matches A.1+A.2.

#### A.9 — Frontend: `<AddressFieldsLegacy>` component
- **Touches:** `edforge-saas-frontend/packages/forms/src/sections/AddressFieldsLegacy.tsx` (NEW or refactor existing `AddressSection.tsx` per [edforge-saas-frontend/packages/forms/src/sections/AddressSection.tsx](edforge-saas-frontend/packages/forms/src/sections/AddressSection.tsx))
- **Summary:** existing US-shaped form extracted into a named legacy component. No behavior change.
- **Validation:** vitest — matches existing snapshot.

#### A.10 — Frontend: `<AddressFields>` archetype switch
- **Touches:** `edforge-saas-frontend/packages/forms/src/sections/AddressFields.tsx` (NEW or update existing)
- **Summary:** consume `useTenantArchetype()` from A.7; render `<AddressFieldsNepal>` if `archetype==='PABSON'`, else `<AddressFieldsLegacy>`. Single import surface for callers.
- **Validation:** vitest — both branches render correctly.

#### A.11 — Frontend: `<PhoneInput>` component
- **Touches:** `edforge-saas-frontend/packages/forms/src/inputs/PhoneInput.tsx` (NEW)
- **Summary:** consumes `useTenantArchetype()` and `phoneFormatForArchetype()` from A.5. Renders dial-code prefix + input. PABSON: locked +977, validates `[2-9]\d{9}`.
- **Validation:** vitest — 5 phone-input cases (valid/invalid/empty for both archetypes).

#### A.12 — Wire `<AddressFields>` into Staff Wizard (AddressStep)
- **Touches:** `edforge-saas-frontend/apps/people/src/wizards/StaffWizard/steps/AddressStep.tsx`
- **Validation:** vitest snapshot + dev-server manual test on prod-rehearsal tenant.

#### A.13 — Wire `<AddressFields>` into Student Wizard
#### A.14 — Wire `<AddressFields>` into Student Detail edit modal
#### A.15 — Wire `<AddressFields>` into Family / Guardian forms
#### A.16 — Wire `<AddressFields>` into School create/edit form
- (Each is a separate ticket. Each: same touches/validation pattern as A.12, locate exact path via grep.)

#### A.17 — Wire `<PhoneInput>` into Staff forms (wizard + edit modal)
#### A.18 — Wire `<PhoneInput>` into Student / Guardian / Emergency Contact forms
#### A.19 — Wire `<PhoneInput>` into School form
- (One ticket per location.)

#### A.20 — Backend mapper round-trip: Staff
- **Touches:** [server/application/microservices/identity/src/staff/staff.service.ts](server/application/microservices/identity/src/staff/staff.service.ts) (`staffEntityToDto` already extracted in S4.1)
- **Summary:** ensure mapper preserves all 4 Nepal extension fields on entity↔DTO round-trip.
- **Validation:** vitest mapper-regression test (mirror S4.1 pattern).

#### A.21 — Backend mapper round-trip: Student
- **Touches:** academics student mapper.
- **Validation:** vitest.

#### A.22 — Backend mapper round-trip: School
- **Touches:** identity school mapper.
- **Validation:** vitest.

#### A.23 — GENERIC-tenant regression test
- **Touches:** `server/application/microservices/identity/src/staff/staff.controller.spec.ts` (or new test file)
- **Summary:** lock that GENERIC archetype tenant POST /staff with US-shaped address still validates; e2e from controller down.
- **Validation:** Jest e2e.

#### A.24 — Vercel preview-environment fix for region-aware forms
- **Touches:** [server/.env.uat](server/.env.uat) — `CDK_PARAM_CORS_ALLOWED_ORIGINS` to add `https://*.vercel.app` (or specific preview pattern); `shared-infra-stack` redeploy.
- **Summary:** Vercel PR-preview URLs aren't in the prod CORS allowlist by default. Without this, region-aware form previews white-screen on tenant API calls. Mitigation per subagent risk (a).
- **Validation:** open PR-preview URL → tenant API call succeeds (no CORS in DevTools).

#### A.25 — Smoke: end-to-end Nepal address round-trip
- **Touches:** `scripts/smoke-tests/sprintA-region-aware-address-smoke.ts` (NEW)
- **Summary:** on PABSON tenant: create staff with Nepal address → GET → assert all 4 extension fields present → PATCH ward only → GET → assert update; create student same; create school same; cleanup. ~18 checks.
- **Validation:** smoke green on UAT + prod.

#### A.26 — ADR: region-aware forms decision record
- **Touches:** `docs/decisions/region-aware-forms.md` (NEW)
- **Summary:** why archetype-first, how `<AddressFields>` decides, how to add a new archetype, divergence policy for existing GENERIC data.

#### A.27 — Demo

**Sprint A risks (incorporated from review):**
- **Vercel preview CORS** — addressed in A.24.
- **Cognito user-pool migration** — existing US-format phone admins could fail validation. Mitigation: Sprint A's `<PhoneInput>` validates **only on submit**, not on Cognito login. Existing admins unaffected.
- **Chrome auto-translate rewriting form labels** — manual test in Sprint F (F.x.translate).
- **AdminWeb publish-gate barrel** — A.6 jsdom sim catches it.

---

### Sprint B — Sprint 4 wrap (Staff completeness)

**Goal:** Saraswati admin can record full Staff data — 5 IEMIS fields, credentials, assignments, **and trainings** — with all 9 IEMIS Staff event types appearing in `/iemis/audit`.

**Inter-sprint dependencies:** Sprint A (for Nepal-shaped Staff address fields).

**Demo:** create staff member → fill all 5 IEMIS fields → add a credential → verify it → add a training → list trainings → check `/iemis/audit` shows all 9 event types.

**Tickets:**

#### B.1 — DDB schema + GSI design for StaffTraining
- **Touches:** `docs/decisions/staff-training-ddb-schema.md` (NEW)
- **Summary:** decide PK/SK + GSIs. Recommend `pk=TENANT#<tid>#STAFF#<sid>`, `sk=TRAINING#<trainingId>`, GSI for "expiring soon" (sk on endDate+certificateNumber). Document.
- **Validation:** ADR signed off; pattern matches existing Credential + Assignment shape on staff.

#### B.2 — `StaffTraining` entity
- **Touches:** `server/application/microservices/identity/src/staff/staff-training.entity.ts` (NEW)
- **Summary:** entity fields per B.1: trainingId, staffId, trainingTitle, trainingType, trainingProvider, startDate, endDate, durationHours, certificateNumber, status (`completed | in_progress | scheduled`).
- **Validation:** Zod schema in shared-types + entity mapper test.

#### B.3 — Shared-types: training Zod schema + 0.36.0 publish (+ pin bumps)
- (Same publish/pin-bump split as A.6/A.6a/A.6b/A.6c.)

#### B.4 — `StaffTrainingService` CRUD
- **Touches:** `server/application/microservices/identity/src/staff/staff-training.service.ts` (NEW)
- **Summary:** getByStaffId, getById, create, update, delete (soft).
- **Validation:** Jest unit test against DDB-mock.

#### B.5 — `StaffTrainingController` + routes
- **Touches:** `staff-training.controller.ts` (NEW)
- **Summary:** GET `/staff/:id/trainings`, POST `/staff/:id/trainings`, PATCH `/staff/:id/trainings/:tid`, DELETE `/staff/:id/trainings/:tid`. Permission `iemis.edit-staff` per existing model.
- **Validation:** Jest e2e.

#### B.6 — API Gateway routes
- **Touches:** [server/lib/tenant-api-prod.json](server/lib/tenant-api-prod.json)
- **Summary:** add 4 routes.
- **Validation:** `cdk diff shared-infra-stack` shows expected.

#### B.7 — IEMIS audit emit on training events
- **Touches:** `staff-training.service.ts` + `StaffModule` already imports IemisModule (S4.7)
- **Summary:** wire `staff.training.{created,edited,deleted}` event types (already pre-registered in shared-types/S4.7). No PII in metadata (staffId, trainingId, trainingType, trainingProvider — no titles, no certificate numbers).
- **Validation:** vitest — emit-call assertions.

**Note:** **No NGINX rproxy ticket.** `location ~ ^/staff` already covers sub-paths per [server/application/reverseproxy/nginx.template:131](server/application/reverseproxy/nginx.template#L131). (Subagent review correction.)

#### B.8 — Smoke: training CRUD + audit
- **Touches:** `scripts/smoke-tests/sprintB-staff-training-smoke.ts` (NEW)
- **Summary:** mirror S4.7 self-contained pattern: provision temp staff → POST training → PATCH → DELETE → GET /iemis/audit → assert 3 training event types present + PII-clean → cleanup. ~13 checks.
- **Validation:** smoke green UAT + prod.

#### B.9 — Frontend: `EditStaffModal` extended with 5 IEMIS fields
- **Touches:** `edforge-saas-frontend/apps/people/src/components/staff/EditStaffModal.tsx`
- **Summary:** add inputs for `emisStaffId` (16-digit, validated), `nationality` (ISO-3166 alpha-3 select), `maritalStatus` (enum from S4.1), `appointmentType` (enum from S4.1), `appointmentDate` (BS-date-picker if PABSON).
- **Validation:** vitest — round-trip.

#### B.10 — Frontend: Staff Trainings tab
- **Touches:** `edforge-saas-frontend/apps/people/src/components/staff/TrainingsTab.tsx` (NEW)
- **Summary:** list view + add/edit modal. Mirror Credentials tab.
- **Validation:** vitest + manual smoke.

#### B.11 — Backfill audit: existing prod staff lacking IEMIS fields
- **Touches:** `scripts/backfill/staff-iemis-fields-coverage.ts` (NEW)
- **Summary:** read-only script that reports how many existing staff records lack each of the 5 IEMIS fields. **Does not** auto-fill (keeps PII admin-driven).
- **Validation:** script runs against UAT + prod; report tee'd to `docs/operations/staff-iemis-coverage-<date>.md`.

#### B.12 — Demo

---

### Sprint C — Pre-pilot compliance baseline

**Goal:** real PII can land on Saraswati tenant safely. KMS-CMK encryption at rest, PITR verified, audit federation across services, alerting wired, ethnicity field added (promoted from Sprint I per review), and security baseline (WAF, MFA, DSAR, IEMIS kill switch) in place.

**Inter-sprint dependencies:** none (parallelizable with A and B).

**Demo:** induce an audit-emit failure on UAT → SNS email arrives within 2 min. Show PITR-restore window. Show DDB CMK ARN. Show Student.ethnicity field in Demographics tab.

**Tickets:**

#### C.1 — KMS CMK in shared-infra-stack (ap-south-1)
- **Touches:** [server/lib/shared-infra/shared-infra-stack.ts](server/lib/shared-infra/shared-infra-stack.ts)
- **Summary:** per-region CMK with rotation enabled. Export ARN as `EdForgePrimaryDataKeyArn`. UAT us-east-2 also gets one for parity.
- **Validation:** `cdk diff shared-infra-stack` shows expected resource.
- **Deploy:** UAT first, then prod, per CLAUDE.md ladder.

#### C.2 — DDB encryption with CMK on identity / academics / finance tables
- **Touches:** [server/lib/tenant-template/ecs-dynamodb.ts](server/lib/tenant-template/ecs-dynamodb.ts)
- **Summary:** swap `TableEncryption.AWS_MANAGED` → `TableEncryption.CUSTOMER_MANAGED` referencing the CMK from C.1.
- **Validation:** `aws dynamodb describe-table` returns `KMSMasterKeyArn` set.

#### C.3 — Verify DDB PITR + regression-assert
- **Touches:** add a CDK assertion test if not present.
- **Summary:** subagent confirmed PITR is on by template default at `ecs-dynamodb.ts:30`. Add a guard test so a future config drift doesn't silently disable it.
- **Validation:** test fails if PITR removed; passes today.

#### C.4 — Academics IEMIS audit-emit-failure CloudWatch alarm
- **Touches:** wherever the identity alarm is defined; mirror.
- **Summary:** metric filter on academics LogGroup for `iemis.audit.emit_failure`; alarm `Sum > 5 in 5min`.
- **Validation:** induced UAT failure → state change to ALARM within 5 min.

#### C.5 — SNS subscription wired on prod operator-alert topic
- **Touches:** controlplane-stack SNS, set `CDK_PARAM_OPERATOR_TOPIC_ARN`.
- **Summary:** subscribe operator email; verify delivery via AWS CLI test publish.
- **Validation:** test publish → email received.

#### C.6 — Audit federation: `/iemis/audit` reads identity + academics
- **Touches:** [server/application/microservices/identity/src/iemis/iemis-audit.controller.ts](server/application/microservices/identity/src/iemis/iemis-audit.controller.ts)
- **Summary:** extend audit-list endpoint to query both DDB tables; merge by timestamp; return combined.
- **Validation:** vitest + smoke. Emit one academics event (`student.descriptor.edited`) + one identity event (`staff.credential.created`) → GET `/iemis/audit` returns both, sorted by ts desc.

#### C.7 — Audit-volume tuning for alarm thresholds
- **Summary:** Sprint B added 6 new event types. Real Saraswati staff bulk edits could push audit volume 10×. Tune the IEMIS audit-emit-failure alarm threshold from "Sum > 5 in 5min" to a percentage ratio if needed (`(failures / total) > 1%`).
- **Validation:** load-test a 50-iter PATCH burst; alarm doesn't false-fire.

#### C.8 — L3-C inline 409 on SchoolWizard (DUPLICATE_IEMIS_CODE)
- **Touches:** edforge-saas-frontend SchoolWizard
- **Summary:** convert toast `(field: emisSchoolCode)` to inline per-field error using `WizardSubmitResult` plumbing from PR #34.
- **Validation:** vitest + manual.

#### C.9 — Student.ethnicity field added (promoted from Sprint I)
- **Touches:** academics Student schema + entity + mapper + Demographics tab
- **Summary:** add optional `ethnicityDescriptor` field (URI string). **Schema-only;** no backfill yet (legal-gate ticket I.1 covers what catalog values are valid). Reason for promoting: subagent flagged that adding the field after Saraswati lands is a schema migration on live PII. Adding it now (empty for all rows) avoids that.
- **Validation:** vitest + Demographics tab renders "Not specified" for null.

#### C.10 — Cognito MFA enforcement for tenant admins (TOTP only)
- **Touches:** [server/lib/tenant-template/identity-provider.ts](server/lib/tenant-template/identity-provider.ts)
- **Summary:** Cognito user pool config `MfaConfiguration: 'ON'` with `EnabledMfas: ['SOFTWARE_TOKEN_MFA']`. **TOTP only — no SMS** (no Pinpoint dependency, no PII over SMS). Tenant admins prompted to enroll on first sign-in post-deploy; existing admins prompted at next login.
- **Validation:** UAT admin login → MFA enroll prompt → TOTP via Authenticator app works → re-login requires TOTP.
- **Risk:** existing tenant admins on UAT/prod must re-enroll on next login. Communicate at least 48h before deploy + provide enrollment runbook.

#### C.11 — AWS WAF / managed rule set on edforge.app route
- **Touches:** [server/lib/shared-infra/shared-infra-stack.ts](server/lib/shared-infra/shared-infra-stack.ts)
- **Summary:** WebACL with `AWSManagedRulesCommonRuleSet` + `AWSManagedRulesAmazonIpReputationList` attached to API Gateway.
- **Validation:** SQLi/XSS test request returns 403 from WAF; legitimate request 200.

#### C.12 — DSAR endpoint draft (tenant data export)
- **Touches:** new `iemis-data-export.controller.ts`
- **Summary:** GET `/iemis/data-export?subjectId=<staffId|studentId>` returns JSON dump of all PII attributes for that subject across identity/academics. Permission `iemis.data-export`. Audit event `iemis.data-export.executed`.
- **Validation:** smoke against test student → JSON shape valid → audit row present.

#### C.13 — IEMIS UI kill switch (per-tenant feature flag)
- **Touches:** `WorkspaceSettings.features.iemisUiEnabled` (default true)
- **Summary:** when flag is false, frontend hides IEMIS-related navigation + components. Backend continues to accept/serve API calls (kill switch is UI-only). Useful for active-incident surface-area reduction.
- **Validation:** vitest — flag false → IEMIS nav hidden.

#### C.14 — Data residency memo doc
- **Touches:** `docs/operations/data-residency-memo.md` (NEW)
- **Summary:** 1-page memo: tenant data lives in ap-south-1 (Mumbai); CMK regional; backups regional; CloudWatch logs regional; Cognito user pool regional; npm registry packets cross-border (operational constants only, no PII). Sign-off line for Shoaib + customer counter-sign.
- **Validation:** doc lands; PR-tagged.

#### C.15 — Saraswati customer data-residency acceptance letter
- **Touches:** `docs/operations/saraswati-data-residency-acceptance.md` (NEW)
- **Summary:** customer counter-signs C.14. Required before H.3.
- **Validation:** signed PDF in repo.

#### C.16 — Pen-test engagement scheduled
- **Touches:** `docs/operations/pen-test-engagement-2026.md` (NEW)
- **Summary:** engage external pen-tester for blind-box test of edforge.app prod (post-import). Engagement letter signed; report due before H.7.
- **Validation:** signed engagement letter in repo.

#### C.17 — Demo

---

### Sprint D — Pilot xlsx import (foundation)

**Goal:** operator uploads pilot xlsx → sees dry-run preview → commits → all rows landed within 5 min, no 504, audit trail complete, S3 bucket compliant.

**Inter-sprint dependencies:** Sprint C (CMK + WAF before any PII bucket).

**Demo:** as TenantAdmin on prod-rehearsal tenant: upload `Students_2082_All.xlsx` (779 rows) → dry-run shows 779 valid + N findings → commit → ImportReport shows 779/779 succeeded → student dashboard shows 779 students.

**Tickets:**

#### D.1 — Guardian-ID uuid fix (v4 S0.1)
- **Touches:** [server/application/microservices/academics/src/common/mappers/student.mapper.ts:233](server/application/microservices/academics/src/common/mappers/student.mapper.ts#L233)
- **Summary:** replace `\`guardian-${Date.now()}\`` with `uuid()`.
- **Validation:** vitest — 2-guardian student → distinct IDs; 10 parallel synchronous → 10 distinct.

#### D.2 — Per-request identity-service cache (v4 S0.4)
- **Summary:** LRU cache on `identityClient.getSchool()` per request, keyed by schoolId.
- **Validation:** vitest — second call same request → 0 HTTP.

#### D.3 — Atomic counter primitive (v4 S0.3)
- **Summary:** DDB `UpdateItem` with `ADD` for counter increments. Used by import progress counter.
- **Validation:** vitest — 100 concurrent increments → final value 100.

#### D.4 — Feature-flag helper (v4 S0.5)
- **Summary:** `WorkspaceSettings.features.<key>` resolver primitive.
- **Validation:** vitest.

#### D.5 — `ImportJob` DDB schema + status enum (v4 S1.4 split)
- **Touches:** `iemis-import-job.entity.ts` (NEW)
- **Summary:** DDB schema only. PK/SK design: `pk=TENANT#<tid>`, `sk=IMPORTJOB#<jobId>`. Fields enum: `pending | dryrun_running | dryrun_complete | commit_running | commit_complete | failed`. Other fields TBD in D.6.
- **Validation:** ADR + Zod schema test.

#### D.6 — `ImportJob` entity fields + findings shape
- **Summary:** correlationId, totalRows, processedRows, findings[] (line, column, severity, message), startedAt, completedAt, retryCount.
- **Validation:** vitest.

#### D.7 — S3 upload bucket — encryption + lifecycle + CORS
- **Touches:** new bucket in tenant-template-stack-basic
- **Summary:** server-side encryption with KMS CMK from C.1; lifecycle expire-in-30-days; CORS for upload from edforge.app; bucket policy denies non-TLS uploads.
- **Validation:** `cdk diff` + `aws s3api get-bucket-encryption` returns CMK ARN.

#### D.8 — S3 upload AV / macro scan
- **Touches:** Lambda triggered on ObjectCreated; uses ClamAV layer or AWS GuardDuty Malware Protection.
- **Summary:** scan uploaded xlsx/xlsm; if infected, delete object + alarm.
- **Validation:** EICAR test file → quarantined; clean file → passes.

#### D.9 — POST `/iemis/import-jobs/upload-url` returns presigned PUT URL
- **Touches:** new controller endpoint.
- **Summary:** returns presigned URL valid for 5 min, scoped to a tenant-prefixed S3 key.
- **Validation:** smoke — PUT succeeds; PUT after 5 min fails 403.

#### D.10 — SQS queue + worker Lambda (consumes ObjectCreated → does dry-run + commit)
- **Touches:** new SQS queue + new Lambda; replaces in-process synchronous import.
- **Summary:** S3 → SQS → Lambda. Lambda parses xlsx, runs dry-run (or commit, depending on action flag in metadata), updates ImportJob state. Use existing identity/academics SDKs (no copy/paste).
- **Validation:** UAT smoke — full path.

#### D.11 — Worker crash recovery / DLQ replay primitive
- **Touches:** SQS DLQ + admin-only POST `/iemis/import-jobs/:id/retry` endpoint.
- **Summary:** if worker crashes mid-batch, ImportJob stays in `commit_running`. A 30-min stale-detector marks it `failed`. Admin can POST to retry; resume picks up at `processedRows + 1`.
- **Validation:** smoke — kill worker mid-import, assert recovery via retry.

#### D.12 — DLQ alarm + admin DLQ inspection UI
- **Touches:** alarm CDK + a small admin-only React route showing DLQ messages.
- **Validation:** induce DLQ message → alarm fires; UI shows message.

#### D.13 — GET `/iemis/import-jobs/:id` status polling endpoint
- **Validation:** smoke.

#### D.14 — Frontend `<ImportWizard>` with polling
- **Touches:** edforge-saas-frontend new wizard.
- **Summary:** Step 1 upload via presigned URL → Step 2 dry-run preview (poll until status=`dryrun_complete`) → Step 3 commit confirmation → Step 4 ImportReport (poll until `commit_complete`).
- **Validation:** vitest + manual smoke.

#### D.15 — Permission `iemis.import-xlsx`
- **Touches:** identity RBAC.
- **Summary:** added to TenantAdmin role only.
- **Validation:** TenantUser POST upload-url → 403.

#### D.16 — Audit events: `iemis.import.dryrun_executed` + `iemis.import.commit_executed`
- **Summary:** metadata: correlationId, totalRows, succeeded, failed, durationMs. NO names.
- **Validation:** vitest.

#### D.17 — Metric-baseline collection on UAT
- **Summary:** before any prod timing, run import 5× on UAT and record p50/p95 duration. Establishes baseline so G.2 can detect regression.
- **Validation:** results in `docs/deploys/uat-import-baseline-<date>.md`.

#### D.18 — Smoke: full import on UAT (779 rows)
- **Touches:** existing pilot xlsx test fixture or anonymized variant.
- **Validation:** dry-run + commit complete; 779/779 in DDB.

#### D.19 — Demo

---

### Sprint E — Pilot xlsx import — Ed-Fi descriptor enrichment

**Goal:** every imported student has correct Ed-Fi descriptor URIs for sex, language, mother tongue, and disability — so downstream UI (Demographics tab from Sprint 3) renders correctly without manual editing.

**Inter-sprint dependencies:** Sprint D.

**Demo:** re-import the same xlsx → existing students enriched with descriptors → Demographics tab shows mapped values.

**Tickets:**

#### E.1 — Mother tongue mapping
- **Touches:** import transformer + Ed-Fi descriptor catalog from Sprint 2.
- **Summary:** xlsx column `Mother Tongue` → `motherTongueDescriptor` URI. Unmappable → finding warning, field left empty.
- **Validation:** vitest — 8 cases (Nepali, Maithili, Tharu, Newari, Bhojpuri + 3 unmappable).

#### E.2 — Disability mapping
- **Summary:** xlsx column `Disability Type` → `disabilityDescriptor` URI(s). Multi-disability rows → multiple URIs.
- **Validation:** vitest — 6 cases.

#### E.3 — Sex normalization
- **Summary:** xlsx → `sexDescriptor` URI. Map `M`/`male`/`Male` → male URI; `F`/`female`/`Female` → female URI; `Other`/`O` → other URI.
- **Validation:** vitest.

#### E.4 — Language descriptor
- **Summary:** xlsx column `Primary Language Spoken` → `languageDescriptor`.
- **Validation:** vitest.

#### E.5 — `isTransferred` preservation
- **Summary:** xlsx → boolean Student field. UI display deferred to F.5.
- **Validation:** vitest.

#### E.6 — ECD/PPC grade default ADR
- **Touches:** `docs/decisions/ecd-ppc-grade-default.md` (NEW)
- **Summary:** decide default-to-PPC vs split-on-import. Recommendation: default-to-PPC + finding warning (lighter UX). Sign off.
- **Validation:** ADR doc lands.

#### E.7 — ECD/PPC implementation
- **Summary:** apply E.6 decision in import transformer.
- **Validation:** vitest.

#### E.8 — Re-import enriches existing students
- **Summary:** GSI7 dedup → existing student updated with enriched descriptors instead of skipped.
- **Validation:** vitest + smoke.

#### E.9 — Findings page in `<ImportReport>`
- **Summary:** warnings tab with per-row finding (line number, column, severity, message).
- **Validation:** vitest.

#### E.10 — Enrichment-revert primitive
- **Touches:** new admin endpoint POST `/iemis/import-jobs/:id/revert`.
- **Summary:** if E.1–E.5 enrichments mis-map, revert writes the prior values back. Uses ImportJob.findings[].priorValue captured during enrichment.
- **Validation:** smoke — enrich + revert; assert prior-values restored.

#### E.11 — Smoke: full enrichment round-trip
- **Validation:** smoke green UAT.

#### E.12 — Demo

---

### Sprint F — Day-one operational validation

**Goal:** every operational UI on edforge.app works correctly with imported Nepal-shaped data. No US-shaped artifacts visible. No broken descriptors. No NPE/null-render bugs.

**Inter-sprint dependencies:** A (Nepal forms render), B (full Staff data), D + E (real data in DDB).

**Demo:** as Saraswati admin → log in → navigate to Students → see 779 students → open one → Demographics tab shows mapped descriptors → take attendance → enter grade → record fee → see NPR currency + BS dates throughout.

**Tickets:**

#### F.1 — Section / Classroom assignment workflow validation
- **Summary:** pick 5 imported students → assign to existing section → Enrollment record created → student dashboard "Total Enrolled" goes up by 5.
- **Validation:** manual UAT + screenshots.

#### F.2 — Attendance UI Nepal-correct
- **Summary:** open attendance page → date picker shows BS by default → mark 5 students present → save → query DDB → record stored as ISO date.
- **Validation:** manual + smoke.

#### F.3 — Grades UI Nepal-correct (ECD/PPC inclusive)
- **Summary:** enter grades for an ECD/PPC class → save → verify display.
- **Validation:** manual + smoke.

#### F.4 — Fees UI NPR
- **Summary:** create fee structure → record payment → invoice shows NPR symbol + Nepali numerals option.
- **Validation:** manual + smoke.

#### F.5 — Staff/Student detail render Nepal-shaped addresses
- **Summary:** open imported student detail → Nepal-shaped address renders → if missing, "Not specified" italic.
- **Validation:** manual + screenshot.

#### F.6 — RBAC validation: TenantUser
- **Summary:** non-admin → Students list visible read-only → "New / Add" hidden or 403.
- **Validation:** manual.

#### F.7 — RBAC validation: TenantAdmin
- **Summary:** admin → can edit all → can view audit → can run import.
- **Validation:** manual.

#### F.8 — RBAC validation: SystemAdmin
- **Summary:** sysadmin via AdminWeb → can provision tenants but not edit tenant-internal data.
- **Validation:** manual.

#### F.9 — Chrome auto-translate test
- **Summary:** enable Chrome's "Translate this page" on a Saraswati admin session → form labels still render correctly → form submits → no broken validation.
- **Validation:** manual + screenshot.

#### F.10 — Smoke: full operational flow
- **Touches:** `scripts/smoke-tests/sprintF-day-one-flow-smoke.ts` (NEW)
- **Validation:** smoke green UAT.

#### F.11 — Demo

---

### Sprint G — Prod rehearsal

**Goal:** §7.3 QA all-green. PITR restore drill passes. Stress test passes. RED triage clean.

**Inter-sprint dependencies:** F.

**Demo:** rehearsal sign-off doc with all boxes green; PITR drill log; import-timing chart.

**Tickets:**

#### G.1 — Run §7.3 QA checklist on rehearsal tenant
- **Summary:** all 7 sections (A–F + new G for Sprint A region forms). Capture PASS/FAIL per row.
- **Validation:** sign-off doc.

#### G.2 — Time the 779-row import on prod ECS
- **Summary:** with Sprint D async pipeline, the API GW is removed from path. Worker Lambda runs the actual commit. Target p95 < 5min for 779 rows.
- **Validation:** result vs D.17 baseline.

#### G.3 — PITR restore drill (DR rehearsal)
- **Touches:** non-prod scratch table.
- **Summary:** restore identity prod table at T-1h to a `-restored` shadow table; verify shape; tear down.
- **Validation:** restored row count matches; doc lands in `docs/operations/pitr-drill-<date>.md`.

#### G.4 — Stress: 50-iter PATCH loop on demographics
- **Summary:** 50× PATCH `/students/:id/descriptors` → all 200 → no audit-emit failures → audit threshold from C.7 doesn't false-fire.
- **Validation:** smoke result.

#### G.5 — RED triage
- **Summary:** any failing checks filed as blockers; fix or accept-with-mitigation before H.

#### G.6 — Sign-off doc
- **Touches:** `docs/deploys/prod-rehearsal-saraswati-signoff-<date>.md`.

---

### Sprint H — Real Saraswati onboarding

**Goal:** real Saraswati tenant live; principal trained; 7-day monitoring active.

**Inter-sprint dependencies:** G sign-off green.

**Demo:** live Saraswati admin signs in, sees N imported students, takes attendance.

**Tickets:**

#### H.0 — Go / no-go criteria check
- **Touches:** `docs/operations/saraswati-go-no-go-<date>.md` (NEW)
- **Summary:** all green-go quantitative gates from §3 met; G.6 sign-off attached; C.15 customer-residency-acceptance signed; C.16 pen-test report received with zero High/Critical open. Shoaib signs go/no-go.
- **Validation:** signed doc.

#### H.1 — Maintenance window announcement
- **Summary:** notify Saraswati of cutover window.

#### H.2 — Provision real Saraswati tenant
- **Touches:** AdminWeb tenant-create flow.
- **Summary:** archetype=PABSON, country=NPL, etc.
- **Validation:** tenant-provision capture log per CLAUDE.md ladder.

#### H.3 — Upload Saraswati xlsx
- **Touches:** operator-driven via `<ImportWizard>` from D.14.
- **Validation:** ImportReport completed.

#### H.4 — Validation pass: 10-sample manual check
- **Summary:** open 10 random students; verify name spelling, DOB conversion, guardian data, descriptors.
- **Validation:** sign-off in onboarding doc.

#### H.5 — Principal training (recorded video)
- **Summary:** **Recorded video sufficient — no live re-run.** Produce a 1-hour walkthrough (Loom or equivalent) covering: login, student list, taking attendance, entering grades, recording fees, viewing audit history, escalation contact. Index in `docs/operations/saraswati-principal-training-<date>.md` with timestamps for each topic. Saraswati team can re-watch on demand.

#### H.6 — Pilot rollback runbook
- **Touches:** `docs/operations/saraswati-pilot-rollback-runbook.md` (NEW)
- **Summary:** if data is wrong on Day-2: how to revert imports (E.10), how to wipe + re-import, how to restore from PITR (G.3 dry-run informed). Specific ECR rollback tags. SNS escalation path.
- **Validation:** runbook PR-tagged + dry-run partial-execute on UAT.

#### H.7 — On-call ramp story
- **Touches:** `docs/operations/saraswati-oncall-7day.md` (extend existing `docs/operations/saraswati-oncall.md` if present)
- **Summary:** explicit primary + escalation; paging rules per alarm; daily check-in cadence with principal.

#### H.8 — 7-day on-call execution
- **Summary:** primary watches alarms; daily principal check-in; weekly retrospective.
- **Validation:** daily logs.

#### H.9 — Sign-off doc
- **Touches:** `docs/operations/saraswati-pilot-go-live-signoff-<date>.md`
- **Summary:** quantitative gates from §3 measured + signed.

---

### Sprint I — CEHRD Flash I export (proof-of-model)

**Goal:** demonstrate the Ed-Fi → IEMIS round-trip. Take Saraswati's data, generate Flash I .xlsm, manually upload to CEHRD portal, confirm acceptance.

**Inter-sprint dependencies:** H green-go (real data to export). C.9 ethnicity field already present.

**Demo:** click "Export Flash I" → receive .xlsm → upload to CEHRD portal → CEHRD accepts.

**Tickets:**

#### I.0 — CEHRD ethnicity legal sign-off
- **Touches:** `docs/operations/ethnicity-classification-legal-signoff.md` (NEW)
- **Summary:** legal review of CEHRD-prescribed ethnicity catalog vs Nepal data-protection law. Sign-off required before I.1.
- **Validation:** signed doc.

#### I.1 — Ethnicity descriptor catalog
- **Touches:** shared-types descriptor catalog (additive)
- **Summary:** publish CEHRD-prescribed ethnicity values as Ed-Fi descriptor URIs. Behind feature flag `WorkspaceSettings.features.ethnicityCaptureEnabled` (default false; flip per tenant after legal accept).
- **Validation:** vitest.

#### I.2 — Ethnicity capture in Demographics tab + import enrichment
- **Summary:** when feature flag on: Demographics tab includes ethnicity select; import maps xlsx column if present.
- **Validation:** vitest + smoke.

#### I.3 — Aggregation queries: grade × gender × ethnicity × disability × age
- **Touches:** new analytics-style query in academics service.
- **Summary:** SQL-like query producing Flash-I-shaped row data. Use existing GSIs where possible; new GSI if needed (cdk-diff-budget).
- **Validation:** vitest + golden-output fixture.

#### I.4 — `.xlsm` template parser
- **Summary:** parse CEHRD-issued Flash I .xlsm → extract cell-injection schema (which cells receive which data; preserve macros).
- **Validation:** golden-fixture round-trip.

#### I.5 — Cell-injection engine
- **Summary:** take row data + parsed schema → write cells → output .xlsm.
- **Validation:** golden-fixture round-trip; macros preserved.

#### I.6 — Flash I template ingestion endpoint + versioning
- **Touches:** POST `/iemis/flash-i/templates`.
- **Summary:** admin uploads CEHRD-issued .xlsm → store in S3 with `flashTemplateVersion` + sha256 hash → tenant settings reference latest. **Hash check on every export:** if operator uploads a hash diverging from the known-good set, alarm.
- **Validation:** smoke.

#### I.7 — Flash I export endpoint
- **Touches:** POST `/iemis/flash-i/export?academicYearId=...`.
- **Summary:** kicks worker → runs aggregation (I.3) → injects (I.5) → returns presigned download URL.
- **Validation:** smoke.

#### I.8 — Permission `iemis.flash-i.export`
- **Validation:** TenantUser → 403.

#### I.9 — Audit event `iemis.flash-i.exported`
- **Summary:** metadata: academicYearId, templateVersion, rowCount, durationMs.
- **Validation:** vitest.

#### I.10 — Frontend Flash I download UI
- **Touches:** new IEMIS Console panel.
- **Validation:** manual.

#### I.11 — Fixture round-trip CI test
- **Touches:** new CI test.
- **Summary:** before any live smoke (I.13), CI runs aggregation against a fixture tenant, generates .xlsm, cell-by-cell-diffs against a known-good output. **Gate:** PR can't merge if diff has unexpected drift.
- **Validation:** CI green on the PR that lands I.5.

#### I.12 — Manual upload to CEHRD portal (V1 forever)
- **Summary:** **Manual upload only — no automation, ever.** Saraswati staff downloads the .xlsm produced by I.7, uploads to CEHRD portal themselves, screenshots the acceptance confirmation. EdForge's responsibility ends at producing a CEHRD-accepted .xlsm; the human-driven upload step stays human (avoids bot-detection / TOS risk; CEHRD portal is designed for school-staff workflow). Design implication: I.10 download UI must include a checklist reminder ("Don't forget to upload to portal.cehrd.gov.np within X days") + a `markUploaded` button so the operator can record completion in EdForge for audit-trail completeness.
- **Validation:** screenshot of CEHRD acceptance + `markUploaded` button click → audit row `iemis.flash-i.upload_recorded` written. File in `docs/operations/saraswati-flash-i-upload-<date>.md`.

#### I.13 — Smoke: full live round-trip
- **Validation:** smoke green prod.

#### I.14 — Demo

---

### Sprint J — SchoolInfrastructure entity (Flash II Infra prep)

**Goal:** schools can record infrastructure data needed for Flash II Infra export.

**Tickets (abbreviated; expand at start of sprint):**
- J.1 SchoolInfrastructure entity + DDB schema (rooms, toilets, water source, electricity, internet, library, lab, playground)
- J.2 SchoolInfrastructure CRUD service + controller
- J.3 API GW route
- J.4 Frontend School Infrastructure tab
- J.5 Audit events `school.infrastructure.{created,edited,deleted}` (pre-register in shared-types)
- J.6 Vitest + smoke
- J.7 Demo

---

### Sprint K — Flash II student export

**Goal:** end-of-academic-year student outcomes exported.

**Tickets (abbreviated):**
- K.1 Student outcome state (`promoted | repeated | dropped | graduated | transferred`) + Ed-Fi `studentSchoolAssociation.exitWithdrawType`
- K.2 `StudentAssessment` entity (exam results) + service + controller + UI
- K.3 Flash II student template ingestion (reuses I.6)
- K.4 Aggregation queries
- K.5 Flash II student export endpoint
- K.6 Permission + audit
- K.7 Frontend
- K.8 Fixture round-trip CI
- K.9 Smoke
- K.10 Demo

---

### Sprint L — Flash II staff/infra/attendance

**Goal:** complete Flash II reporting suite.

**Tickets (abbreviated):**
- L.1 Staff aggregation by role × age × qualification
- L.2 Flash II staff export
- L.3 Flash II infra export (uses Sprint J)
- L.4 Monthly attendance aggregator (reads existing attendance)
- L.5 Flash II attendance export
- L.6 Smoke + demo

---

### Sprint M — Multi-school readiness

**Goal:** when 2nd Nepal school onboards, the platform handles concurrent imports + isolated tenant data without operator hand-holding.

**Tickets (abbreviated):**
- M.1 Async import worker concurrency control (per-tenant lease so two operators on same tenant queue, two operators on different tenants parallel)
- M.2 Tenant template provisioning improvements (template version pin, archetype validation)
- M.3 Per-tenant resource isolation verification (DDB GSI fan-out cost; per-tenant rate limits)
- M.4 Per-tenant SLO dashboard
- M.5 Demo

---

### Sprint N — Compliance / ops backlog

**Tickets (abbreviated):**
- N.1 DSAR delete/correction endpoints (extend C.12 export with delete + correct)
- N.2 Compliance calendar + email reminders
- N.3 IEMIS Console page (single-pane-of-glass for all IEMIS actions)
- N.4 Demo

---

## 7. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | 779-row import latency unverified on prod ECS | Medium | High | D.10 async pipeline removes API GW from path; G.2 measures actual; D.17 baselines on UAT first |
| R2 | Ethnicity legal gate blocks Sprint I | Medium | High | I.0 legal sign-off ticket; ethnicity field already added in C.9 (schema-only) so no live-PII migration needed |
| R3 | CEHRD .xlsm format drift between school years | Low | High | I.6 template-version field + sha256 hash check; alarm on hash divergence |
| R4 | KMS CMK migration breaks UAT tenant | Low | Medium | DDB rotates encryption async; UAT first per CLAUDE.md ladder |
| R5 | Audit federation latency | Low | Low | C.6 fan-out 2 queries acceptable; cache if >200ms |
| R6 | Region-aware forms break GENERIC tenants | Medium | High | A.23 explicit GENERIC regression test; archetype gate at A.10; vitest covers both branches |
| R7 | Pilot xlsx has unknown column variants | Medium | Medium | D.5/E schema mapping data-driven; new variant = config change not code |
| R8 | Vercel preview-URL CORS rejects tenant API calls | Medium | Medium | A.24 adds preview pattern to allowlist |
| R9 | AdminWeb publish-gate breaks on shared-types 0.35.0/0.36.0 | Low | High | A.6 jsdom sim; A.6b explicit AdminWeb pin verification |
| R10 | Backwards-compat: rename of address fields | Low | High | A.0 ADR commits to "extend, don't rename" |
| R11 | Cognito user-pool migration: existing US-format admins fail Sprint A phone validation | Low | Medium | `<PhoneInput>` validates only on submit, not on Cognito login; existing admins unaffected |
| R12 | Audit-log volume explosion from B's 6 new event types | Medium | Medium | C.7 alarm threshold tuning ratio-based |
| R13 | Chrome auto-translate rewrites form labels silently | Low | Medium | F.9 explicit translate-on test |
| R14 | Saraswati admin enters wrong data Day-1 with no rollback | Medium | High | H.6 rollback runbook + E.10 import revert + G.3 PITR drill |
| R15 | ImportJob worker crashes mid-batch leaves stuck `running` state | Medium | High | D.11 stale-detector + retry primitive |
| R16 | Unencrypted PII xlsx in S3 | Low | Critical | D.7 SSE-KMS + lifecycle + non-TLS deny |
| R17 | Saraswati customer doesn't accept ap-south-1 residency | Low | High | C.15 written customer acceptance gates H.0 |
| R18 | Pen-test surfaces High/Critical findings post-cutover | Medium | High | C.16 booked early; H.0 gate requires zero open H/C |

---

## 8. Definition of Done

### 8.1 Per-ticket DoD
1. Code committed on a feature branch.
2. PR opened with description referencing ticket ID.
3. Vitest / NestJS test passes (or alternative validation per ticket).
4. UAT-deployed and smoke-verified per CLAUDE.md ladder.
5. Prod-deployed and smoke-verified per CLAUDE.md ladder (or noted as "UAT-only" if backend-only with no prod implication).
6. Deploy logs tee'd to `docs/deploys/`.
7. Memory updated if architectural fact discovered.

### 8.2 Per-sprint DoD
1. All tickets DoD-met.
2. Demo conducted (recorded or live to Shoaib).
3. Sprint-end summary doc in `docs/sprints/`.
4. Sprint memory updated.

### 8.3 Green-go DoD (gates H.0)
1. All Sprint A–H tickets DoD-met.
2. §3 quantitative gates measured and met.
3. C.15 customer-residency-acceptance signed.
4. C.16 pen-test report received; zero High/Critical findings open.
5. G.6 rehearsal sign-off attached.
6. H.6 rollback runbook executable end-to-end on UAT in dry-run.

---

## 9. Deferred (post-pilot, explicit)

- Parent portal / parent Cognito accounts.
- Real-time CEHRD portal API integration.
- Multi-language UI.
- Advanced/Premium tier features.
- Multi-region replication.
- IndexedDB offline support.
- Mobile native apps.

---

## 10. Reviewer feedback log (incorporated)

The subagent review surfaced and this plan corrects:

1. **Three address schemas, not one** — Sprint A reorganized into A.1 (legacy `addressSchema`), A.2 (`staffAddressSchema`), A.3 (audit existing `schoolAddressSchema`). Mapper-regression tests split per entity (A.20–A.22). GENERIC-tenant regression added (A.23).
2. **NGINX prefix-regex covers `/staff/*`** — B.5 (rproxy) dropped. Framing updated in §2.3.
3. **PITR already on by default** — C.3 reframed as verify+regression-test.
4. **A.5 + A.6 split** — version bump (A.6) separated from per-consumer pin bumps (A.6a/A.6b/A.6c).
5. **`<AddressFields>` split** — A.8 Nepal renderer / A.9 legacy renderer / A.10 archetype switch + A.7 context provider. PhoneInput likewise (A.11/A.17/A.18/A.19).
6. **A.0 divergence policy** — explicit ADR for existing US-shaped data.
7. **A.24 Vercel preview CORS** — new ticket per risk (a).
8. **B.1 split** — DDB schema/GSI design ADR separate from entity (B.2).
9. **B.11 backfill audit** — coverage report for existing staff lacking IEMIS fields.
10. **C.9 ethnicity promoted from Sprint I** — schema-only field added pre-pilot to avoid post-onboarding migration on live PII.
11. **C.10 / C.11 / C.12 / C.13** — Cognito MFA, WAF, DSAR endpoint, IEMIS UI kill switch added.
12. **C.7 audit-volume tuning** — alarm threshold tuned for Sprint B's new event types.
13. **D.5 / D.6 split** — DDB schema separate from entity-fields/findings shape.
14. **D.7 / D.8 explicit** — S3 bucket encryption + lifecycle + AV scan added.
15. **D.11 / D.12 worker recovery + DLQ replay** — added per risk.
16. **D.17 metric baseline** — added before G.2 prod timing.
17. **E.6 / E.7 split** — ECD/PPC ADR separate from impl.
18. **E.10 enrichment-revert primitive** — added per misenrichment risk.
19. **F.7 / F.8 RBAC fully matrixed** — TenantAdmin + SystemAdmin added.
20. **F.9 Chrome auto-translate** — added per risk (h).
21. **G.3 PITR restore drill** — added; required before live data.
22. **H.0 / H.6 / H.7** — go/no-go gate, rollback runbook, on-call ramp story added.
23. **C.15 / C.16** — customer residency acceptance + pen-test booked, both gating H.0.
24. **I.0 / I.1 split** — ethnicity legal sign-off separate from catalog publication.
25. **I.6 + I.11** — template versioning/hash + fixture round-trip CI added.

Subagent's full critique archived alongside this doc as `docs/decisions/saraswati-roadmap-subagent-review-20260426.md` (to write).

---

## 11. Open questions — RESOLVED 2026-04-26

1. **Sprint A.4 Nepal districts catalog source** → **CEHRD canonical** (the same list CEHRD publishes for Flash I/II forms). Reasoning: matches what import xlsx files use AND what Flash exports must produce — single source of truth eliminates drift between import and export. Implementation note: store the catalog version + source URL + sha256 in `nepal-administrative-divisions.ts` header; on CEHRD reorganization (rare; last revised 2017 with 7-province restructuring), bump catalog version + add migration test that legacy district codes still resolve.
2. **Sprint C.10 Cognito MFA** → **TOTP only.** No SMS / Pinpoint dependency in V1. Simpler ops, no PII over SMS.
3. **Sprint C.12 DSAR scope** → defined below in §13 (source-code-grounded).
4. **Sprint H principal training** → **Recorded video sufficient.** No live re-run required.
5. **Sprint I CEHRD portal upload** → **Manual upload, V1 forever.** No headless-browser automation — CEHRD portal is human-driven by school staff; automating it adds bot-detection / TOS risk. Sprint I focuses on producing a CEHRD-accepted .xlsm artifact; the human-upload step stays human.

---

## 13. DSAR scope (source-grounded — answers Q3)

Per source-code survey 2026-04-26, the DSAR endpoint scope is **defined by what's already built**, not what needs to be built. EdForge's foundation already has guardian/family records, parent account provisioning, and the audit-redaction primitives. C.12 wires these together rather than reinventing them.

### 13.1 Subject types (PII-bearing)

| Subject | First-class? | File | PII held |
|---|---|---|---|
| **Student** | Yes | [server/application/microservices/academics/src/common/entities/student.entity.ts:28](server/application/microservices/academics/src/common/entities/student.entity.ts#L28) | identity, demographics, address, descriptors, portalUserId |
| **Guardian** | **No — nested** on `Student.guardians[]` | [student.entity.ts:134](server/application/microservices/academics/src/common/entities/student.entity.ts#L134) | name, email, phone, employer, occupation, address, optional `userId` |
| **EmergencyContact** | No — nested singular on Student | [student.entity.ts:155](server/application/microservices/academics/src/common/entities/student.entity.ts#L155) | name, relationship, phone |
| **MedicalInfo** | No — nested on Student | [student.entity.ts:165](server/application/microservices/academics/src/common/entities/student.entity.ts#L165) | allergies, medications, conditions, physician, insurance |
| **Address** | No — nested on Student & Guardian | [student.entity.ts:122](server/application/microservices/academics/src/common/entities/student.entity.ts#L122) | street, city, etc. |
| **Staff** | Yes | [server/application/microservices/identity/src/common/entities/staff.entity.ts:114](server/application/microservices/identity/src/common/entities/staff.entity.ts#L114) | identity, demographics, employment, IEMIS fields, address |
| **User** | Yes | [server/application/microservices/identity/src/common/entities/user.entity.ts:23](server/application/microservices/identity/src/common/entities/user.entity.ts#L23) | email, cognitoSub, cognitoUsername, names, phone, address. Bridges Student (`portalUserId`), Staff (`userId`), Guardian (`guardianId.userId`) |
| **Enrollment** | Yes | [server/application/microservices/academics/src/common/entities/enrollment.entity.ts:27](server/application/microservices/academics/src/common/entities/enrollment.entity.ts#L27) | studentId reference + dates (no direct PII; lookup chain) |
| **IEMIS audit rows** | Yes (append-only) | tenant DDB `AUDIT#IEMIS#…` | metadata only; PII redacted per role via [iemis-audit-redact.ts](server/application/microservices/identity/src/iemis/iemis-audit-redact.ts) |

### 13.2 Existing primitives DSAR will leverage (no rebuild)

- **`linkGuardianToUser()`** at academics `students.service.ts` — already provisions a Cognito User account for a nested guardian and writes back `Student.guardians[n].userId`.
- **`createParentAccount()`** at identity `users.service.ts` — already creates the Parent role User record.
- **`iemis-audit-redact.ts`** — role-based PII masking (TenantAdmin sees raw; others see masked). DSAR export reuses this redaction logic.
- **`sanitizeForAudit()`** at academics students.service ~L74 — already strips `disabilities[].notes` from audit rows. DSAR export honors the same redaction.
- **Pre-defined audit event types** in [packages/shared-types/src/events/iemis-audit.events.ts](packages/shared-types/src/events/iemis-audit.events.ts): `dsar.requested`, `dsar.fulfilled`, `pii.viewed` are already typed; just need handlers.
- **PATCH `/students/:id/descriptors`** + **PATCH `/staff/:id`** — already-working correction endpoints; DSAR-correction is a thin wrapper.

### 13.3 What's missing (the real C.12 work)

1. **Subject-export endpoint** `GET /iemis/data-subject/:subjectType/:subjectId/export` returning a single JSON document containing:
   - The subject's primary entity row (Student/Staff/User).
   - All related records (e.g., for a Student: guardians[], emergencyContact, medicalInfo, all Enrollments, all IEMIS audit rows where `metadata.studentId === :id`).
   - For a Guardian: the parent Student record reference + the linked User row (if `guardian.userId` is set).
   - Honors `iemis-audit-redact.ts` redaction policy by caller role.
   - Emits `dsar.requested` + `dsar.fulfilled` audit events.
2. **Cascade-delete on `DELETE /students/:id`** — current handler does not cascade. Add cascade to: Enrollments, Section rosters, linked Users (deprovision Cognito `Guardian.userId` and `Student.portalUserId`), audit rows (mark `redacted=true`, do not delete — append-only invariant).
3. **Subject-erasure endpoint** `DELETE /iemis/data-subject/:subjectType/:subjectId` — wraps the cascade-delete above + Cognito deprovisioning + emits `dsar.fulfilled` with `erasure: true`.
4. **`pii.viewed` emit** wired into the export endpoint so every DSAR access leaves an audit trail.
5. **Permission `iemis.dsar`** — add to identity RBAC; assign to TenantAdmin only.

### 13.4 What's explicitly NOT in C.12

- Guardian → Parent first-class refactor (deferred; nested guardian shape is fine for DSAR — we traverse it).
- The `guardianId` collision bug (D.1 already fixes it).
- DSAR request-tracking workflow (operator queues a request → admin approves → fulfilled). C.12 ships immediate-fulfillment endpoints; tracking workflow is N.1.
- FERPA-aligned consent management. Deferred to N.

### 13.5 Tickets (replaces single-line C.12 in §6)

Replace the original C.12 line with:

- **C.12a** — Subject-export endpoint (read). Validation: smoke against test student → JSON shape valid → audit row present → redaction correct per role.
- **C.12b** — Cascade-delete fix on `DELETE /students/:id` and `DELETE /staff/:id`. Validation: e2e — delete a student with 2 enrollments + 3 guardians → all related rows removed/redacted; audit row immutable.
- **C.12c** — Subject-erasure endpoint. Validation: smoke → student deleted; nested guardian users deprovisioned in Cognito; `dsar.fulfilled` audit row with `erasure: true`.
- **C.12d** — Permission + audit-event handlers (`dsar.requested`, `dsar.fulfilled`, `pii.viewed`). Validation: vitest.

---

## 12. Naming-table (for cross-reference with prior plans)

| New ID (this doc) | Old ID (existing) | Notes |
|---|---|---|
| D.1 | v4 S0.1 | Guardian-ID uuid fix |
| D.2 | v4 S0.4 | Identity-service cache |
| D.3 | v4 S0.3 | Atomic counter |
| D.4 | v4 S0.5 | Feature-flag helper |
| D.5–D.14 | v4 S1.x | ImportJob async primitive |
| E.1–E.5 | v4 S2.x | Descriptor enrichment |
| Sprint 4 S4.3 (in original plan) | Sprint B (here) | StaffTraining |
| Sprint 5 (in original plan) | Sprint J (here) | SchoolInfrastructure |
| Sprint 6 (in original plan) | I.0–I.2 (here) | Ethnicity (gated promoted) |
| Sprint 7 (in original plan) | K (here) | StudentAssessment |
| Sprint 8 (in original plan) | M (here) | Async import |
| Sprint 9 (in original plan) | I.4–I.5 (here) | Template injection |
| Sprint 10 (in original plan) | I.7–I.13 + K (here) | Flash I + II student |
| Sprint 11 (in original plan) | L (here) | Staff/Infra/Attendance |
| Sprint 12 (in original plan) | N.2 (here) | Compliance calendar |
| Sprint 13 (in original plan) | C.12 + N.1 (here) | DSAR |
| Sprint 14 (in original plan) | N.3 (here) | IEMIS Console |
