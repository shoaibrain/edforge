# ADR — Sprint 4 (S4.2): reuse `StaffCredential` with a `credentialCategory` enum; do NOT create a separate `StaffQualification` entity

**Status:** **SUPERSEDED 2026-04-24** by [`sprint4-credentials-vs-qualifications-revised.md`](sprint4-credentials-vs-qualifications-revised.md)

> The "use one entity, not two" decision (Option A vs Option B) is correct and stays. The specific implementation this ADR proposed — adding a new `credentialCategory` enum field — is replaced by the cleaner approach of using the existing Ed-Fi-aligned `credentialTypeDescriptor` and mapping to IEMIS's Flash-II 4-bucket at export time. The revised ADR explains why and what changes for S4.7 + Sprint 11.

**Deciders:** Shoaib (operator) + Claude (pair)
**Context:** Sprint 4 Staff IEMIS ship

## Problem

CEHRD's Flash-II Staff register needs two kinds of staff-attached records:

1. **Academic qualifications** — degrees / diplomas the staff member holds (e.g. `B.Ed`, `M.A.`, `PGCE`).
2. **Teaching licences / endorsements** — certifications from a state or licensing authority (e.g. CEHRD teaching licence, subject-area endorsements, first-aid certificates).

The original Sprint 4 plan wording said "Staff + StaffQualification + StaffTraining". An audit of the existing code found that a `StaffCredential` entity + full CRUD stack (endpoints, UI tab, tests) is **already live on prod** — covering the "licences / endorsements / certificates" half of this need. The unanswered question was whether to:

- **Option A** — reuse `StaffCredential` with a new `credentialCategory` enum that tags each row as `qualification | licence | endorsement | certificate`. One CRUD surface, one entity, one audit stream, one UI tab with category filters.
- **Option B** — stand up a separate `StaffQualification` entity + service + controller + DDB SK pattern + audit events + UI tab + tests. Two CRUD surfaces, two entities, two audit streams, two UI tabs.

## Decision

**Reuse `StaffCredential` with a `credentialCategory` enum (Option A).**

## Rationale

### For Option A
1. **Shipping cost** — the CRUD surface is already built. Adding an enum field + filter query cost is measured in hours, not days. Standing up a parallel entity is measured in days.
2. **UX cost** — one "Credentials" tab on Staff Detail with a category chip + filter is less noisy than two tabs. Pilot admins told us in the rehearsal walkthrough that they think about these records as "the paperwork we attach to a teacher" — not as two cognitively-separate inventories.
3. **Audit cost** — one audit event type (`staff.credential.edited` with category in metadata) is cheaper than two. Fewer event types also means less churn in the `IEMIS_AUDIT_EVENT_TYPES` enum (which is public API via shared-types).
4. **Flash-II export mapping** — CEHRD's Staff export distinguishes qualifications vs licences via a **column mapping**, not a separate sheet. The export engine (Sprint 9/10/11) can branch on `credentialCategory` when writing Flash-II cells — one loop over `StaffCredential`, two output columns.
5. **Migration cost** — existing rows stay valid. New column defaults to `'certificate'` (backfill-friendly) or is left null initially with UI nudge to categorize. Pilot's existing credential data is small enough that a one-shot UI-driven categorization is tractable.
6. **Reversibility** — if Sprint 11 discovers an export pain point that actually requires a separate `StaffQualification` entity (e.g. credit-hour computations that don't apply to licences), splitting later is a mechanical migration: new entity + `credentialCategory='qualification'` rows copy over, delete them from `StaffCredential`. Deferring this split costs nothing; committing early costs a week.

### Against Option B
1. **Duplicate code** — two services, two controllers, two API Gateway blocks, two NGINX blocks, two sets of tests. Each of these is not hard, but each is a place a future bug or drift can happen.
2. **Category ambiguity** — "is a first-aid certificate a qualification or a licence?" gets debated more when there are two entities. When there's one entity with a category, the answer is "it's a credential tagged `certificate`" — classification is a UI concern, not a data-model concern.
3. **Pilot fit** — Saraswati has ~20 staff records. The overhead of two entities is disproportionate to the volume.

## What changes because of this decision

### Shared-types (next PR — S4.7 scope)
Add a new enum and extend the credential schema:
```ts
export const credentialCategorySchema = z.enum([
  'qualification',  // e.g. B.Ed, M.A., PGCE
  'licence',        // e.g. CEHRD teaching licence, subject-area endorsement
  'endorsement',    // e.g. subject-matter authorisations
  'certificate',    // e.g. first-aid, professional-development certificates
]);
export type CredentialCategory = z.infer<typeof credentialCategorySchema>;
```
Add `credentialCategory` as an optional field on `createStaffCredentialSchema` + `staffCredentialResponseSchema`. Backward-compatible — existing callers stay valid.

### Backend (next PR — S4.7)
- `StaffCredential` entity interface gains the new optional field.
- Credential service write paths pass it through.
- Credential mapper's entity→DTO passes it through (with a regression test, same lesson as the 2026-04-24 student-mapper hotfix and the 2026-04-24 staff-mapper PR #24).
- Audit event `staff.credential.edited` includes `credentialCategory` in metadata so auditors can filter.

### Frontend (later)
- Existing Credentials tab on Staff Detail gains a Category column + filter chips.
- Edit modal gets a Category dropdown.
- No new tab; no navigation change.

## What this decision does NOT do

- **Does not create** a `StaffQualification` entity, service, or DDB key pattern.
- **Does not add** a separate `/staff/:id/qualifications` route. All credential reads continue to use `/staff/:id/credentials` with an optional `?category=` filter query param.
- **Does not split** the audit stream. One `staff.credential.edited` event type covers all four categories.

## Validation trigger — revisit if any of these

1. CEHRD publishes a Staff export spec that requires fundamentally different data shapes per category (e.g. qualifications need credit-hours, licences need issuing-authority — we can accommodate both as optional columns on one entity, but if they need contradictory schemas, split).
2. Pilot admins give consistent feedback that the one-tab model is hiding credentials from them. Measure by: support-ticket count mentioning "can't find my qualifications" during the first month of go-live.
3. We onboard a second pilot tenant (post-Saraswati) whose workflow truly does treat qualifications and licences as separate inventories.

## Related memory + docs

- `project_iemis_sprint_1_uat.md` / `project_iemis_sprint_3_uat.md` — prior sprint summaries
- Historical deploy evidence for Sprint 0-3 backend primitives and Sprint 4 S4.1+S4.6 — raw deploy summaries were removed from tracked source during the July 2026 deploy-evidence hygiene cleanup.
- Plan: `~/.claude/plans/peaceful-meandering-alpaca.md` §6.1 (original ticket table naming S4.2 as the decision gate)
