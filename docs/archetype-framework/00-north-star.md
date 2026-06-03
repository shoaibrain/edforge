# Governance-Body Archetype Framework — North Star

> **Status:** proposed (2026-06-03). Cross-repo architecture + execution map.
> **Companion docs:**
> - Backend execution → [`backend-sprint-plan.md`](./backend-sprint-plan.md) (this repo)
> - Frontend execution → `edforge-saas-frontend/docs/archetype-framework/frontend-sprint-plan.md`
>
> **Source of this plan:** an end-to-end code review of both repos (2026-06-03)
> against the operator framing: *archetype = governance body*. Findings are cited
> inline. This plan **composes with** the in-flight plans listed in §6 — it does
> not re-plan shipped or already-planned work. Per the repeated lesson in
> [CLAUDE.md](../../CLAUDE.md) (`feedback_audit_before_proposing_new_sprints`):
> audit first, then propose only the genuinely-new work.

---

## 1. The thesis

`Tenant.archetype` is not a school-size or community-flavor label. It is a
**governance-body classification** — the body a school answers to, which dictates
its reporting structure, curriculum mandates, calendar, grading, and compliance
obligations:

- **PABSON** — Private and Boarding Schools Organization Nepal. The only
  runtime-valid governance body in V1 (alongside the `GENERIC` null fallback).
  The first 20 customers are all PABSON/Nepal.
- **CBS** (future) — Central Bureau governance for public Nepal schools.
- **NGO-run** (future) — NGO-operated schools.
- Reserved enum-only placeholders: `CBSE_IN`, `NAIS_US`, `GEMS_UAE`.

When an operator provisions a tenant and picks **"Nepal + PABSON"**, they are
declaring *"this school answers to PABSON,"* and the platform must hand them a
**contextually-correct, locked-in configuration** for that governance body —
NPR currency, Bikram Sambat calendar, Sun–Fri week, CEHRD curriculum + grade
taxonomy, IEMIS Flash I/II reporting, PABSON grading scale, board-exam catalog
(BLE/SEE/NEB) — with **zero generic guesswork**.

The platform already does a lot of this. What it does **not** yet have is a
**first-class framework** that makes the governance body the single spine every
config surface resolves through, and makes *adding the next governance body
(CBS, NGO-run) a data-only change with a conformance gate* — no call-site edits,
no scattered `country === 'NPL'` branches, no "we forgot to wire surface X for
the new archetype" bugs.

That framework is this project.

---

## 2. What the code review found (grounding)

The review (three deep passes: backend archetype model, Ed-Fi/IEMIS reporting,
frontend archetype infra) found that **the architecture is fundamentally sound
and most surfaces are already data-driven** — but the governance-body abstraction
is *implicit and scattered*, not *first-class and enforced*.

### 2.1 Already shipped — REUSE, do not rebuild

**Backend**

| Surface | Where | Status |
|---|---|---|
| Archetype defaults table (letter grades, board exams BLE/SEE/NEB, exam patterns, grading scales, promotion defaults, curriculum refs, compliance forms) | [`archetype-defaults.ts`](../../packages/shared-types/src/archetype/archetype-defaults.ts) | ✅ comprehensive, data-driven |
| Archetype enum + `activeArchetypeSchema` (PABSON\|GENERIC) + immutability | [`tenant.schema.ts:29`](../../packages/shared-types/src/schemas/identity/tenant.schema.ts#L29), [`field-governance.ts:35`](../../packages/shared-types/src/identity/field-governance.ts#L35) | ✅ write-once enforced |
| Regional defaults + archetype-over-country precedence | [`tenant-locale-defaults.ts:235`](../../packages/shared-types/src/locale/tenant-locale-defaults.ts#L235) | ✅ `resolveArchetypeDefaults()` |
| Provisioning archetype flow + seeding | [`provision-tenant.sh:46`](../../server/lib/provision-scripts/provision-tenant.sh#L46), [`tenant-seeder-lambda.ts`](../../server/lib/bootstrap-template/tenant-seeder-lambda.ts) | ✅ archetype validated + seeded |
| Grading policy seed-from-archetype | [`grading-policy.service.ts:322`](../../server/application/microservices/academics/src/grades/grading-policy.service.ts#L322) | ✅ (read-path wiring = platform-hardening Sprint B) |
| Promotion-rule seed-from-archetype | [`promotion-rules.service.ts:645`](../../server/application/microservices/academics/src/promotion-rules/promotion-rules.service.ts#L645) | ✅ |
| Bell-schedule presets registry + resolver | [`bell-schedule-presets.ts:166`](../../packages/shared-types/src/archetype/bell-schedule-presets.ts#L166) | ✅ (archetype seed + activation gate = platform-hardening Sprint C) |
| Activation-requirements per archetype | [`activation-requirements.ts:65`](../../packages/shared-types/src/archetype/activation-requirements.ts#L65) | ✅ |
| Holiday-seed registry (archetype:region:bsYear) | [`holiday-seeds/index.ts:56`](../../packages/shared-types/src/locale/holiday-seeds/index.ts#L56) | ✅ |
| Exam-pattern validation per archetype | [`exams.service.ts:395`](../../server/application/microservices/academics/src/exams/exams.service.ts#L395) | ✅ |
| Ed-Fi descriptor catalogs (GradeLevel, Sex, Language, Disability, ExitWithdrawType) + alias resolver | [`ed-fi/descriptors/`](../../packages/shared-types/src/ed-fi/descriptors/) | ✅ |
| `schoolGradeToCanonical` wired into Flash I/II | [`transforms.ts:148`](../../server/lib/analytics/lambda/report-aggregator/transforms.ts#L148) | ✅ (Sprint A.3, commit `5181100`) |

**Frontend**

| Surface | Where | Status |
|---|---|---|
| Archetype/country broadcast across MFEs + React hook | [`school-context-channel.ts`](https://github.com/shoaibrain/edforge-saas-frontend/blob/main/packages/config/src/school-context-channel.ts), `packages/forms/src/hooks/useTenantContext.ts` | ✅ |
| **Module-Federation singleton** for the broadcast (load-bearing; a missing singleton caused the 2026-04-28 archetype=null bug) | `packages/config/src/mf-shared.ts` | ✅ |
| `resolveAddressVariant(archetype, country)` + Nepal/Legacy address forms | `packages/forms/src/sections/AddressFields*.tsx` | ✅ the canonical overlay precedent |
| `phoneFormatForArchetype` + `PhoneInput` | `packages/forms/src/inputs/PhoneInput.tsx` | ✅ |
| BS↔AD date-utils + `BSDateInput` (MF singleton) | `packages/date-utils/` | ✅ |
| i18n en + ne (11 namespaces) | `packages/i18n/` | ✅ |
| `TenantBadge`, `IemisCodeBadge` | `packages/shell-components/`, `apps/shell/.../IemisCodeBadge.tsx` | ✅ |

### 2.2 The real gaps (this is the project)

These are the only genuinely-new findings. Everything in the sprint plans below
targets exactly these — nothing more.

**G-CORE — the abstraction is implicit, not first-class.**
The governance-body config is spread across **≥6 backend files/tables**
(`archetype-defaults.ts`, `tenant-locale-defaults.ts`, the duplicated
`ARCHETYPE_DEFAULTS` in [`workspace-settings.entity.ts:167`](../../server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts#L167),
`bell-schedule-presets.ts`, `activation-requirements.ts`, `holiday-seeds/`, and
the country-keyed `COUNTRY_CONFIG_OVERRIDES` in
[`department.entity.ts:230`](../../server/application/microservices/identity/src/common/entities/department.entity.ts#L230))
and **≥2 frontend resolvers** (`resolveAddressVariant`, `phoneFormatForArchetype`)
— with no single profile object and **no conformance test** that proves a new
governance body is fully wired across *every* surface. Adding CBS today means
hunting down each table by hand and hoping you found them all.

**G-BUG — one country-branch anti-pattern in runtime code.**
[`schools.service.ts:358`](../../server/application/microservices/identity/src/schools/schools.service.ts#L358)
branches on `countryCode === 'NPL'` to choose `bikram_sambat`, even though the
archetype is already in scope at L246–251. CLAUDE.md explicitly forbids this; a
future Nepal governance body (CBS) would silently inherit BS calendar. This is
the canonical example of why the abstraction must be enforced, not conventional.

**G-SEED — archetype defaults exist but are not *applied* at the right lifecycle seams.**
School-config defaults still flow from `getDefaultConfigForCountry()` (country,
not archetype); board exams (BLE/SEE/NEB) and curriculum-ref are defined in the
archetype table but never auto-seeded for a new PABSON school. The data exists;
the wiring at school-create / first-use does not.

**G-EDFI — one compliance-blocking descriptor catalog is missing.**
`Student.ethnicityDescriptor` exists and Flash I needs `caste_ethnicity`, but
there is **no EthnicityDescriptor catalog** — the transform falls back to
hardcoded regex ([`transforms.ts:28`](../../server/lib/analytics/lambda/report-aggregator/transforms.ts#L28)),
and caste is never imported. This is the one Ed-Fi gap that blocks a *complete,
compliant* PABSON Flash I at scale (exam/attendance gaps are tracked elsewhere —
see §6).

**G-FE — identifier display + feature matrix.**
~14 UI sites render raw UUID fragments (`id.slice(0, 8)`) where governance-compliant
identifiers belong (e.g., PABSON students must show `emisStudentId`, not
`studentNumber`); there is no archetype identifier registry, no archetype
feature/availability matrix, and the referenced
`docs/decisions/region-aware-forms-divergence.md` does not exist. PR
[#95](https://github.com/shoaibrain/edforge-saas-frontend/pull/95) already designs
the identifier-resolver in depth — the frontend plan **absorbs and sequences it**
as the first consumer of the FE archetype registry rather than redesigning it.

---

## 3. The framework (target architecture)

One governance body = **one cohesive, validated profile module** that *composes*
(does not duplicate) the existing tables, on each side of the stack, behind a
**conformance gate**.

### 3.1 Backend: `GovernanceProfile` aggregator + conformance harness

A thin aggregator type that *references* the already-shipped tables so there is a
single object — and a single place to look — per governance body:

```ts
// packages/shared-types/src/archetype/governance-profile.ts  (NEW, aggregator only)
interface GovernanceProfile {
  archetype: ActiveArchetype;            // 'PABSON' | 'GENERIC' (+ future 'CBS')
  regional:   RegionalSettings;          // from ARCHETYPE_DEFAULTS (tenant-locale-defaults.ts:202)
  grading:    LetterGrade[];             // from ARCHETYPE_DEFAULTS_TABLE (archetype-defaults.ts)
  promotionDefaults: PromotionDefaults;  // from ARCHETYPE_DEFAULTS_TABLE
  examPattern: ExamPattern;              // from ARCHETYPE_DEFAULTS_TABLE
  boardExams: BoardExamSpec[];           // from ARCHETYPE_DEFAULTS_TABLE
  primaryCurriculumRef: string;          // from ARCHETYPE_DEFAULTS_TABLE (a code, e.g. 'CDC_NCF_2076')
  complianceForms: string[];             // from ARCHETYPE_DEFAULTS_TABLE (template IDs)
  bellPresets: BellSchedulePreset[];     // from ARCHETYPE_BELL_PRESETS (bell-schedule-presets.ts)
  activation: ActivationRequirement[];   // from ARCHETYPE_ACTIVATION_REQUIREMENTS
  schoolConfigDefaults: SchoolConfigDefaults; // from getDefaultConfigForArchetype (GB1.2)
  complianceRequiredDescriptors: DescriptorType[]; // NET-NEW first-class data, added in GB0.2b
}
```

> **Two source tables, not one** (verified): regional defaults live in
> `ARCHETYPE_DEFAULTS: Record<ActiveArchetype, RegionalSettings>`
> ([`tenant-locale-defaults.ts:202`](../../packages/shared-types/src/locale/tenant-locale-defaults.ts#L202));
> everything else lives in `ARCHETYPE_DEFAULTS_TABLE: Record<ActiveArchetype, ArchetypeDefaults>`
> ([`archetype-defaults.ts:200`](../../packages/shared-types/src/archetype/archetype-defaults.ts#L200)).
> `ArchetypeDefaults` carries `complianceForms: string[]` but **no**
> `requiredDescriptors` — so `complianceRequiredDescriptors` is the one slot that
> is *net-new data* (GB0.2b adds it to the table as first-class data). Every other
> slot is a **view** over an existing constant — never an inline literal. The
> aggregator's value is (a) one import for any consumer, (b) the surface the
> conformance test iterates, (c) the one place the "adding a governance body"
> runbook points. A deep-equal drift guard (GB0.6) proves it never diverges.

**Conformance harness** (`governance-profile.conformance.spec.ts`): for **every**
`activeArchetypeSchema` value, assert every profile slot is present and internally
consistent (e.g., every `boardExam.gradeLevel` resolves via the GradeLevel
descriptor; every compliance template's required descriptors have catalogs;
regional `calendarSystem` is a known value). **CI fails red** if a new archetype
is added to the enum without a complete, consistent profile. *This is the gate
that makes extensibility safe.*

### 3.2 Frontend: `ARCHETYPE_PROFILE` registry + conformance harness

Generalize the existing `resolve<X>(archetype, country)` precedent into one
registry (extend `@edforge/config` or a new `@edforge/archetype`), with the same
delta-overlay-on-GENERIC model PR #95 designs for identifiers:

```ts
interface ArchetypeUiProfile {
  addressVariant: 'nepal' | 'legacy';
  phoneFormat: PhoneFormat;
  calendarSystem: 'bikram_sambat' | 'gregorian';
  identifiers: Record<EntityKind, IdentifierSpec>;  // PR #95's resolver plugs in here
  features: ArchetypeFeatureMatrix;                  // what's required/optional/hidden
  allowedValues: { currency: string[]; timezone: string[]; calendar: string[] };
}
```

Same conformance discipline: an i18n-coverage + profile-completeness test that
fails CI if a registry edit lacks a translation (en + ne) or leaves a slot empty.

### 3.3 The framework's Definition of Done

> **Adding a new governance body (e.g., CBS) is a single, well-tested data
> module + locale pack on each side, with ZERO call-site edits, proven by a
> green conformance suite and a provisioned dev tenant that receives fully
> contextual defaults end-to-end.**

The final sprint on each side *proves* this by adding a real second governance
body (**CBS**) skeleton end-to-end, behind the existing `activeArchetypeSchema`
flag so it stays non-runtime-valid in production until product greenlights it.

---

## 4. Cross-repo execution map

```
                    ┌─────────────────────────────────────────────┐
                    │  00-north-star.md  (this doc — the contract) │
                    └───────────────┬──────────────────┬──────────┘
                                    │                   │
        ┌───────────────────────────▼──────┐   ┌────────▼─────────────────────────┐
        │  BACKEND  (edforge)               │   │  FRONTEND (edforge-saas-frontend) │
        │  backend-sprint-plan.md           │   │  frontend-sprint-plan.md          │
        │                                   │   │                                   │
        │  GB0  Profile aggregator +        │   │  GF0  ARCHETYPE_PROFILE registry  │
        │       conformance harness         │   │       + conformance harness       │
        │  GB1  Kill country-branch         │   │  GF1  Identifier-resolver         │
        │       anti-patterns + lint        │   │       foundation (PR#95 S0–S2)    │
        │  GB2  Apply defaults at lifecycle │   │  GF2  Thin-slice + sweep          │
        │       seams (board exams,         │   │       (PR#95 S3–S5)               │
        │       curriculum, school config)  │   │  GF3  Feature matrix +            │
        │  GB3  Ethnicity descriptor +      │   │       archetype-gated dropdowns   │
        │       caste import (compliance)   │   │  GF4  PDF payload contract +      │
        │  GB4  Add CBS skeleton e2e        │   │       hardening (PR#95 S6–S7)     │
        │       (extensibility proof)       │   │  GF5  Add CBS UI profile          │
        │                                   │   │       (extensibility proof)       │
        └───────────────────────────────────┘   └───────────────────────────────────┘

  Contract handshakes (cross-repo, versioned via @aibrains/shared-types):
   • GB3 ethnicity catalog  ──▶ GF (address/demographics forms surface caste)
   • GB (emisStudentId DTO)  ──▶ GF1 identifier registry (already present per PR#95 S0-T2)
   • GB4 / GF5 CBS profiles land in the SAME shared-types minor + consumer pin bump
```

**Sequencing rule:** GB0/GF0 are independent and can start in parallel. The FE
identifier work (GF1–GF2) only depends on the `emisStudentId` field already in
`@aibrains/shared-types` (confirmed present), so FE is *not* blocked on backend.
The only hard cross-repo dependency is **GB3 → FE caste display** and the
coordinated CBS landing (GB4 + GF5).

> **The CBS landing is two publishes, not one.** Backend CBS data lives in
> `@aibrains/shared-types` (published, AdminWeb-visible); frontend CBS data lives
> in the new **`@edforge/archetype`** package, which is **workspace-private,
> shell/MFE-only — AdminWeb must never import it** (the CLAUDE.md
> workspace-only-in-Docker trap). "Coordinated" means *landed in the same
> change-window with matching pin bumps*, not a single package version. Each
> publish follows its own consumer-pin discipline.

---

## 5. Conventions (apply to every ticket in both plans)

Inherited from the existing in-flight plans so this work reads like the rest of
the codebase:

- **Every ticket = one commit + one PR.** If a ticket reads like >1 day, split it.
- **Every ticket has a `Validation:` line** — a unit/integration test, a
  conformance-suite assertion, a route-shape test, an ESLint-rule fixture, or an
  explicit manual smoke with saved evidence. No ticket is "done" on typecheck alone.
- **CLAUDE.md traps apply:** three-way route registration; module-wiring
  invariant + `module-wiring.spec.ts`; shared-types caret-pin bump in the same
  PR; two-repo `cd <repo>` git hygiene; DDB bare-UUID partition key.
- **Frontend tickets begin with the URL→router→page→tab→component trace** pasted
  into the commit body (per the "route → component" trap).
- **Branch on `archetype`, never on `country`.** GB1 makes this enforceable.
- **Demo gate per sprint:** a runnable, observable artifact (test suite, dev
  route, provisioned dev tenant, generated report) — described in each sprint.

---

## 6. Relationship to in-flight plans (do not duplicate)

This framework **sits underneath** the pilot/hardening roadmaps and gives them a
spine. Explicit boundaries:

| In-flight plan | Overlap | This framework's stance |
|---|---|---|
| [`MIDNIGHT_LOCKIN_SPRINT_PLAN.md`](../../MIDNIGHT_LOCKIN_SPRINT_PLAN.md) **P2 Archetype Generalization** (P2.1 enum+configs, P2.2 region-gated dropdowns, P2.6 archetype reporting) + **P3.8** (`COUNTRY_CONFIG_OVERRIDES` dedup) | **High — this is the concrete, atomic, conformance-gated execution of P2 + P3.8.** | **Supersedes/operationalizes** P2/P3.8. Marks them done when GB1/GB2/GB4 + GF3/GF5 land. |
| [`platform-hardening/sprint-plan.md`](../platform-hardening/sprint-plan.md) Sprints A–D (CLAUDE framing, grading seed, bell defaults, regional-field removal) | Adjacent — they wire *individual* surfaces. | **Prerequisite/companion.** GB0 references their shipped state; GB does not redo them. Land platform-hardening A–D first or alongside. |
| [`SARASWATI_PILOT_REVISED_ROADMAP.md`](../../SARASWATI_PILOT_REVISED_ROADMAP.md) Sprints A–N (pilot green-go, xlsx import, Flash I/II exports, exam/attendance pipeline C5/C6/K/L) | Reporting completeness (exam marks, attendance aggregation) | **Out of scope — explicit dependency.** GB3 closes only the *descriptor/compliance* gap (ethnicity/caste). Exam-marks + attendance-aggregation Flash II columns remain owned by Saraswati C5/C6. |
| PR [#95](https://github.com/shoaibrain/edforge-saas-frontend/pull/95) identifier display (8 sprints, ~55 tickets) | The FE identifier slice | **Absorbed.** GF1–GF2/GF4 re-sequence PR #95 as consumers of the GF0 registry; the frontend plan cites PR #95 ticket IDs rather than rewriting them. |
| [`v1_basic_only_tier_deferral_sprint_plan.md`](../../v1_basic_only_tier_deferral_sprint_plan.md) | None | Untouched. |

### 6.1 Governance surfaces explicitly out of scope (acknowledged, not forgotten)

A governance body could in principle drive *every* surface. To stay exhaustive
*by acknowledgment*, here is where the remaining surfaces sit and why they are
not in GB/GF:

| Surface | Stance |
|---|---|
| **Per-archetype Cognito invite email / locale templates** | Owned by **Midnight Lockin P2.5** ([`identity-provider.ts`](../../server/lib/tenant-template/identity-provider.ts)). Real archetype surface; deferred there, not duplicated here. |
| **AdminWeb tenant-create archetype dropdown** | Already `ARCHETYPE_OPTIONS`-driven ([`client/AdminWeb/src/pages/Tenants/TenantCreate.tsx`](../../client/AdminWeb/src/pages/Tenants/TenantCreate.tsx)); a new archetype appears by adding to that data array — covered by **GB4.5** (with the zod-pin / jsdom-bundle-sim trap called out). |
| **RBAC role catalog per governance body** | Out of scope. The default role set is governance-agnostic in V1; if a future body needs different roles, it becomes a new `GovernanceProfile.roles` slot — a clean extension, not a rewrite. Stated here so the omission is deliberate. |
| **Org-hierarchy / reporting-line differences** | Out of scope for V1 (single-school PABSON operators). Ed-Fi `EducationOrganizationNetwork` models exist ([`edfi-ts-models`](../../packages/edfi-ts-models/)) but are unused at runtime; revisit when a multi-tier governance body (e.g., a district-reporting CBS structure) is on the roadmap. |
| **Deprovisioning archetype cleanup** | Out of scope; archetype is immutable and tenant teardown is governance-agnostic (SBT deprovision path). No archetype-specific deprovision logic is needed. |
| **Defaults-migration / backfill for already-provisioned schools** | **Partially in scope, flagged.** GB2/GB3 seeds are idempotent and fire *on empty* — so a school already carrying partial board-exam rows or a missing ethnicity catalog value is **not** auto-upgraded. A one-shot backfill (mirroring the platform-hardening Sprint-B `seed-missing-*` script pattern) for existing PABSON schools is the positive-migration companion to GB2/GB3; tracked as **GB2/GB3 backfill follow-ups** (`scripts/backfill/seed-missing-board-exams.ts`, dry-run + live, dev-pabson first) rather than silently assumed. |

---

## 7. Risks & mitigations (framework-level)

| Risk | Mitigation |
|---|---|
| Aggregator becomes a second source of truth that drifts from the underlying tables | GB0 aggregator **imports** the existing constants (no copied literals); a conformance test asserts aggregator output `===` table output for PABSON/GENERIC. |
| "Adding an archetype" still needs scattered edits despite the framework | GB4/GF5 *prove* the ZERO-call-site-edit claim by adding CBS; if any call-site edit is required, that's a framework bug fixed before CBS merges. |
| Coordinated CBS shared-types publish breaks Docker/AdminWeb consumers | Single-minor batch + consumer pin bumps in the same PR (CLAUDE.md caret-pin rule); AdminWeb jsdom bundle-sim before controlplane redeploy. |
| Country-branch regressions creep back | GB1 ships an ESLint/grep CI rule banning `country === 'NPL'`-style branches in runtime service code. |
| FE registry edit ships without `ne` translation | GF0 i18n-coverage conformance test fails CI on any uncovered `labelKey`. |
| Over-rigidity: archetype locks out a legitimate operator override | Profiles define *defaults + allowed-value sets*, not hard locks; `GENERIC`/`OTHER` remains the freedom escape hatch (mirrors Midnight Lockin P2.2 note). |

---

*Generated 2026-06-03 from an end-to-end review of `shoaibrain/edforge` and
`shoaibrain/edforge-saas-frontend`. Reviewed by a subagent against the
atomic-ticket / demoable-sprint / no-duplication criteria before finalization.*
