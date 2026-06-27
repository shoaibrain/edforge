# ADR — Region-aware forms: divergence policy for existing tenant data

**Date:** 2026-04-26
**Status:** Accepted
**Sprint:** A.0 (Region-aware UX foundation — first ticket)
**Decision-maker:** Shoaib Rain
**Supersedes:** none
**Companion:** [pilot-greenlight sprint plan](../pilot-greenlight/sprint-plan.md) (region-aware Sprint A lineage)

---

## 1. Context

EdForge is being extended with region-aware form components in Sprint A. PABSON-archetype tenants (Nepal pilot) will see Nepal-shaped address fields (Province / District / Municipality / Ward / Tole / Postal Code); GENERIC-archetype tenants (existing customers + future markets) continue to see the US-shaped fields they have today (Street / City / State / ZIP / Country).

The data layer already accommodates Nepal-shaped data on Schools — `schoolAddressSchema` at [packages/shared-types/src/schemas/identity/school.schema.ts:85](../../packages/shared-types/src/schemas/identity/school.schema.ts#L85) carries `wardNumber/municipality/district/province/region` plus NPL-conditional refinements (lines 103–121). But the legacy `addressSchema` (used by Student / Family / Guardian) at [packages/shared-types/src/schemas/common.ts:119](../../packages/shared-types/src/schemas/common.ts#L119) and the Ed-Fi `staffAddressSchema` at [packages/shared-types/src/schemas/identity/staff.schema.ts:124](../../packages/shared-types/src/schemas/identity/staff.schema.ts#L124) do not.

Existing edforge.app tenants (the prod-rehearsal tenant with 20 imported students; any other test tenants) already have address data — most of it US-shaped or partial. Adding Nepal-aware fields to the legacy schemas raises a divergence question: do we migrate the existing rows, wipe them, or tolerate the new schema living alongside legacy data?

## 2. Options considered

### Option 1 — Migrate all existing addresses to Nepal-shaped fields (PABSON tenants only)

**Rejected.** There is no mechanical mapping from `{state: 'TX', zipCode: '76909', city: 'McKinney'}` to `{province: 3, district: '30', municipality: 'Kathmandu Metropolitan', wardNumber: '12'}`. Every existing address row would require human review per row. For a single 20-student test tenant this is mildly acceptable; for any future tenant adopted later it is not. We would also need to lock writes during the migration window.

### Option 2 — Wipe existing PABSON-tenant addresses + force re-entry

**Rejected.** Destructive. Some downstream features (Student Detail page address render, future BI queries) assume non-null address. Wiping creates gaps that surface as broken UI. The reputational cost of "we threw away your data" outweighs the cleanup benefit.

### Option 3 — Tolerate divergence: additive schema, frontend gates rendering by archetype, backend accepts both shapes

**Accepted.** Lowest-risk, backwards-compatible, no data loss, no migration window.

## 3. Decision

We adopt **Option 3 — tolerate divergence**.

### 3.1 Schema rules
- Sprint A schema changes are **additive only**. New optional fields (`wardNumber`, `municipality`, `district`, `province`) are added to legacy `addressSchema` and Ed-Fi `staffAddressSchema`. **No existing fields are renamed, removed, or made required.**
- No NPL-conditional `refine()` is added to `addressSchema` — keeps GENERIC tenants validating as-is. PABSON-specific validation runs at the frontend `<AddressFields>` component layer.
- Mappers preserve all extension fields on entity ↔ DTO round-trip (Sprint A.20–A.22).

### 3.2 Frontend rendering rules
- `<AddressFields>` (Sprint A.10) branches on `tenantArchetype === 'PABSON'`:
  - **PABSON tenant + new record** → Nepal-shaped form (Province / District / Municipality / Ward / Tole / Postal Code), writes Nepal fields.
  - **PABSON tenant + record with legacy US-shaped fields populated** → form renders Nepal-shaped (empty); legacy fields preserved invisibly on save (not displayed, not modified). The operator can choose to populate the Nepal-shaped fields, which then live alongside the legacy fields. Future enhancement (post-pilot) may add a "convert legacy to Nepal-shaped" wizard.
  - **GENERIC tenant** → US-shaped form, unchanged from today. Existing fields preserved.

### 3.3 Backend regression test
- Sprint A.23 e2e test: GENERIC tenant POST /staff with US-shaped address still validates and round-trips. **This test is the load-bearing guard against future drift.**

### 3.4 Existing-tenant policy
- **Rehearsal tenant (prod):** 20 imported student addresses stay as-is. Admin can re-enter Nepal-shaped addresses post-Sprint A if desired (manual, opt-in).
- **Real Saraswati tenant (Sprint H):** all addresses entered through Sprint A's UI from day one — no legacy rows.
- **Any other existing GENERIC tenant:** unchanged.

## 4. Consequences

### 4.1 Positive
- Zero data loss, zero migration window, zero production lockwrite.
- GENERIC tenants are not disturbed.
- The Nepal-shaped form is available immediately to PABSON tenants.

### 4.2 Negative / debt
- For **N years** after Sprint A ships, the rehearsal tenant + any pre-existing tenants will carry addresses in legacy fields (`street1`, `state`, etc.). New PABSON tenants populate Nepal fields. Reports/queries that aggregate addresses must read both shapes.
- Future BI/aggregation work depending on Nepal address granularity (e.g., per-province student count for CEHRD reporting in Sprint I) will report "unknown province" for legacy-shaped rows. **Acceptable for V1.**
- A future "convert legacy to Nepal-shaped" wizard is a known follow-up, not in this sprint's scope.

### 4.3 What this does NOT decide
- Whether to deprecate the legacy fields long-term — out of scope for V1.
- Whether GENERIC tenants ever get optional Nepal fields exposed in the UI — no.
- Whether the rehearsal tenant's pre-existing US-shaped data should be displayed differently from new Nepal-shaped data — no UI distinction in V1; both render through the same `<AddressFields>` legacy branch when archetype is GENERIC, or the Nepal branch with a fallback "no Nepal-shaped data — please enter" state when archetype is PABSON and Nepal fields are empty.

## 5. Sign-off

- [ ] Shoaib Rain — _________________ (date)

---

## Appendix A — Affected files / scope

**Backend schemas extended:**
- [packages/shared-types/src/schemas/common.ts](../../packages/shared-types/src/schemas/common.ts) — `addressSchema` (Sprint A.1)
- [packages/shared-types/src/schemas/identity/staff.schema.ts](../../packages/shared-types/src/schemas/identity/staff.schema.ts) — `staffAddressSchema` (Sprint A.2)

**Backend schemas already Nepal-aware (audited only, not modified):**
- [packages/shared-types/src/schemas/identity/school.schema.ts](../../packages/shared-types/src/schemas/identity/school.schema.ts) — `schoolAddressSchema` (Sprint A.3)

**Frontend components introduced:**
- `edforge-saas-frontend/packages/forms/src/sections/AddressFieldsNepal.tsx` (Sprint A.8 — NEW)
- `edforge-saas-frontend/packages/forms/src/sections/AddressFieldsLegacy.tsx` (Sprint A.9 — NEW)
- `edforge-saas-frontend/packages/forms/src/sections/AddressFields.tsx` (Sprint A.10 — switch)

**Backend mapper-regression tests:**
- Sprint A.20 (Staff), A.21 (Student), A.22 (School)

**Backend GENERIC regression e2e:**
- Sprint A.23
