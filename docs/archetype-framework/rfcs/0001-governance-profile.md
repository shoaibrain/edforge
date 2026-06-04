# RFC 0001 — `GovernanceProfile` aggregator + conformance harness

> **Status:** Accepted (2026-06-04) · **Sprint:** GB0 · **Owner:** archetype-framework
> **North star:** [`../00-north-star.md`](../00-north-star.md) §3.1 · **Plan:** [`../backend-sprint-plan.md`](../backend-sprint-plan.md) GB0
> **Scope of change:** `@aibrains/shared-types` only (types + one pure function + tests). No runtime behavior change until consumers adopt it (GB1.1, GB2).

## 1. Problem

EdForge's thesis is **archetype = governance body**, and adding a new body
(CBS, NGO-run) must be a *data-only* change with a conformance gate — **zero
call-site edits**. Today the per-archetype facts are correct but **scattered
across ≥4 tables with no single profile object and no conformance test** that
proves a newly-added archetype is fully wired:

| Fact | Lives in |
|---|---|
| Regional settings (currency/timezone/calendar/locale/numberFormat/weekStart) | `ARCHETYPE_DEFAULTS` — `locale/tenant-locale-defaults.ts:202` |
| Grading scale, promotion defaults, exam pattern, board exams, primary curriculum ref, compliance forms | `ARCHETYPE_DEFAULTS_TABLE` — `archetype/archetype-defaults.ts:200` |
| Bell-schedule presets | `ARCHETYPE_BELL_PRESETS` — `archetype/bell-schedule-presets.ts:166` |
| Activation requirements | `ARCHETYPE_ACTIVATION_REQUIREMENTS` — `archetype/activation-requirements.ts:65` |
| School-config defaults (school days, etc.) | `getDefaultConfigForArchetype` — *added by GB1.2a* |

There are also **two** active-archetype symbols that can silently drift:
`activeArchetypeSchema` (zod, `schemas/identity/tenant.schema.ts:29`) and
`ACTIVE_ARCHETYPES` / `ActiveArchetype` (`locale/tenant-locale-defaults.ts:194`).

## 2. Decision

Introduce a **thin aggregator** — `GovernanceProfile` — that is a **view over
the existing tables, never a copy**, plus a **conformance harness** that fails
CI if any archetype in the enum lacks a complete, internally-consistent profile.

### 2.1 The shape (`packages/shared-types/src/archetype/governance-profile.ts`, NEW)

```ts
interface GovernanceProfile {
  archetype: ActiveArchetype;                       // 'PABSON' | 'GENERIC' (+ future 'CBS')
  regional: RegionalSettings;                       // ← ARCHETYPE_DEFAULTS
  grading: LetterGrade[];                            // ← ARCHETYPE_DEFAULTS_TABLE
  promotionDefaults: PromotionDefaults;              // ← ARCHETYPE_DEFAULTS_TABLE
  examPattern: ExamPattern;                          // ← ARCHETYPE_DEFAULTS_TABLE
  boardExams: BoardExamSpec[];                       // ← ARCHETYPE_DEFAULTS_TABLE
  primaryCurriculumRef: string;                      // ← ARCHETYPE_DEFAULTS_TABLE (e.g. 'CDC_NCF_2076')
  complianceForms: string[];                         // ← ARCHETYPE_DEFAULTS_TABLE (template IDs)
  bellPresets: BellSchedulePreset[];                 // ← ARCHETYPE_BELL_PRESETS
  activation: ActivationRequirement[];               // ← ARCHETYPE_ACTIVATION_REQUIREMENTS
  schoolConfigDefaults: SchoolConfigDefaults;        // ← getDefaultConfigForArchetype (GB1.2b closes this slot)
  complianceRequiredDescriptors: DescriptorType[];   // NET-NEW first-class data (GB0.2b) — see §2.3
}
```

All slot types are the **real source types** imported from their tables — not
re-declared. The aggregator file declares no domain literals.

### 2.2 The core rule — "a view, not a rewrite"

`getGovernanceProfile(archetype)` **imports the existing constants and references
them**; it inlines **no** literal facts. This is enforced, not just asserted in
prose, by the **drift guard** (GB0.6): for every archetype,
`getGovernanceProfile(a).regional` deep-equals `ARCHETYPE_DEFAULTS[a]`, and every
`ArchetypeDefaults`-sourced slot deep-equals `ARCHETYPE_DEFAULTS_TABLE[a]`. A
manual divergence (temp edit) fails the test. This makes "second source of truth
that drifts" structurally impossible.

### 2.3 The one net-new slot — `complianceRequiredDescriptors`

`ArchetypeDefaults` carries `complianceForms: string[]` but **no**
`requiredDescriptors`. Rather than have the aggregator *invent* this list (which
would violate §2.2), GB0.2b adds `complianceRequiredDescriptors: DescriptorType[]`
to `ArchetypeDefaults` as **first-class table data**:
- **PABSON:** `GradeLevel / Sex / Language / Disability / Ethnicity / ExitWithdrawType` descriptors (the CEHRD Flash I required set).
- **GENERIC:** `[]` (intentionally empty — the conformance harness allows this).

It then becomes a normal view slot like the others. It is the gate input for
GB0.5 (cross-check) and GB3.5 (Flash I compliance).

### 2.4 Enum unification (GB0.0)

Make the **zod schema canonical**: `activeArchetypeSchema` (`tenant.schema.ts`)
is the single source; `ACTIVE_ARCHETYPES` / `ActiveArchetype` in
`tenant-locale-defaults.ts` are **derived from / re-export** it. A guard test
asserts `activeArchetypeSchema.options` deep-equals `[...ACTIVE_ARCHETYPES]`, so
adding a value to one without the other fails CI. **Constraint:** verify with a
build/`madge` check that this introduces **no import cycle** (`tenant.schema.ts`
must not import from `tenant-locale-defaults.ts`); if a cycle would form, the
canonical const moves to a leaf module both import.

### 2.5 Conformance harness (`governance-profile.conformance.spec.ts`)

`it.each(activeArchetypeSchema.options)` over **every** active archetype:
- **Completeness (GB0.4):** every slot present + non-empty — *except* GENERIC's
  intentionally-empty `complianceForms` / `complianceRequiredDescriptors`.
- **Consistency cross-checks (GB0.5):**
  - every `boardExams[].gradeLevel` resolves via `resolveDescriptor('GradeLevelDescriptor', …)`;
  - every `complianceRequiredDescriptors[]` has a registered catalog in `ed-fi/descriptors/catalogs.ts`;
  - `regional.calendarSystem ∈ { 'bikram_sambat', 'gregorian' }`.
- **Drift (GB0.6):** the deep-equal guard in §2.2.

A fixture archetype missing a slot / carrying a bogus board-exam grade / an
unregistered descriptor **fails red**. *This is the gate that makes
extensibility safe.*

## 3. Definition of Done (the framework's contract this RFC anchors)

> Adding a governance body = **a single data module per side + a locale pack,
> with ZERO call-site edits**, proven green by this conformance suite and a
> provisioned dev tenant that receives fully contextual defaults.

For GB0 specifically: `npx jest governance-profile` runs green for PABSON +
GENERIC; a temporarily-added fixture archetype with a missing/inconsistent slot
fails red; the drift guard fails on any manual divergence.

## 4. Non-goals / boundaries

- **No behavior change in GB0.** The aggregator is additive; consumers adopt it
  in GB1.1 (calendar resolution), GB1.2b (`schoolConfigDefaults` slot), GB2
  (lifecycle seeding). Until then nothing calls it in a hot path.
- **`schoolConfigDefaults` ships stubbed** in GB0.3 and is finalized by GB1.2b —
  land GB1.2a/b before closing that slot (ordering constraint from the plan).
- **Frontend mirror is separate** — the FE `ARCHETYPE_PROFILE` registry
  (north-star §3.2) already exists as `@edforge/archetype`; **GF4.1b** converges
  the BE identifier resolution onto one published source so BE + FE never drift.
  Out of scope for this RFC; tracked in `execution-and-orchestration.md` §2.1.
- **Aggregator is a read-model.** It does not persist anything and is not a
  DI-injected service; it is a pure function over compile-time constants.

## 5. Deploy / rollout

`@aibrains/shared-types` is ECS-consumed (identity + academics) and AdminWeb-
consumed. Per CLAUDE.md: the GB0.7 publish bumps the minor + **all** consumer
pins (`server/application/package.json`, `server/package.json`, root
`package-lock.json`) in the same PR, and the AdminWeb **jsdom bundle-sim** must
pass before any `controlplane-stack` redeploy (zod `~3.24.4` white-screen fence).
GB0 types+function alone change no runtime path, so the ECS rolling update is
low-risk; the publish is the only coordination barrier.

## 6. Ticket map

| Ticket | Deliverable |
|---|---|
| GB0.0 | Unify the dual active-archetype symbols (zod canonical; §2.4) + guard test |
| **GB0.1** | **This RFC** |
| GB0.2 | `GovernanceProfile` + slot types (real source types); re-export from index |
| GB0.2b | Net-new `complianceRequiredDescriptors` on `ArchetypeDefaults` (§2.3) |
| GB0.3 | `getGovernanceProfile(archetype)` — compose existing constants only |
| GB0.4 | Conformance: completeness |
| GB0.5 | Conformance: consistency cross-checks |
| GB0.6 | Drift guard (deep-equal view ≡ source) |
| GB0.7 | Publish `@aibrains/shared-types` minor + consumer pin bumps |
