# ADR — Sprint 4 (S4.2 revised): use existing `credentialTypeDescriptor`; map to IEMIS Flash-II 4-bucket at export time

**Status:** accepted 2026-04-24, **supersedes** [`sprint4-credentials-vs-qualifications.md`](sprint4-credentials-vs-qualifications.md)
**Reason for supersession:** the original ADR proposed adding a new `credentialCategory` enum to `StaffCredential`. A subsequent read of the existing `Credential` entity revealed that `credentialTypeDescriptor` already covers this concept at higher granularity and is Ed-Fi-aligned. Adding a Nepal-specific 4-bucket enum on top would duplicate state and pull a Nepal-ism into the data spine.

## Restated problem

CEHRD's Flash-II Staff register requires reporting staff records under four buckets — **qualification / licence / endorsement / certificate**. Where does that bucket live in our data model?

## Original ADR's answer (now superseded)

Add a new `credentialCategory: 'qualification' | 'licence' | 'endorsement' | 'certificate'` field on `StaffCredential`.

## Sharper answer (this ADR)

**Don't add the field.** Use the existing `credentialTypeDescriptor` (which already enumerates `certification | license | endorsement | degree | registration | permit | clearance | training | other`) and derive the IEMIS Flash-II 4-bucket at export time via a pure function in `@aibrains/shared-types`.

```ts
// shared-types/src/mappers/iemis/credential-category-mapper.ts (lands in S4.7 or Sprint 11)
export function credentialTypeToIemisFlashIICategory(
  type: CredentialType,
): 'qualification' | 'licence' | 'endorsement' | 'certificate' {
  switch (type) {
    case 'degree':                                     return 'qualification';
    case 'license':
    case 'permit':
    case 'registration':
    case 'clearance':                                   return 'licence';
    case 'endorsement':                                 return 'endorsement';
    case 'certification':
    case 'training':
    case 'other':
    default:                                            return 'certificate';
  }
}
```

## Why this is better

1. **Zero schema change.** No new field, no migration, no read-write asymmetry, no UI form choice ("category vs type — which do I edit?"), no risk of the two fields drifting out of sync over time.

2. **Ed-Fi alignment is preserved at the spine.** `credentialTypeDescriptor` is already an Ed-Fi-aligned vocabulary (Ed-Fi defines `Certification | License | Endorsement | Master/Bachelor's Degree | Letter of Eligibility | Permit | Registration | Reciprocal License | Clearance | Other`). Forcing a Nepal-specific 4-bucket onto the entity would create a competing classification at the data layer.

3. **Nepal is an adapter, not a mutation.** The 4-bucket exists ONLY at the Flash-II Staff export boundary. The export engine (Sprint 9-11) is the right place to apply it. Other markets (India, US, etc.) will need different bucketings — they get their own export-time mappers without touching the spine.

4. **Reversibility is automatic.** If CEHRD changes its bucketing, only the mapper changes — no DDB migration, no UI update.

5. **The mapping function itself is testable in isolation** — pure input → output, easy unit-test fixture per `CredentialType` value.

## What this means for S4.7 (audit events) — the immediate PR

**Drop** the `credentialCategory` field addition (originally listed under "Shared-types (next PR — S4.7 scope)" in the superseded ADR).

**Keep:** add the 9 new audit event types (`staff.credential.created | edited | deleted`, `staff.assignment.created | edited | deleted`, `staff.training.created | edited | deleted`) to `IEMIS_AUDIT_EVENT_TYPES`. The audit metadata for credential events naturally includes `credentialTypeDescriptor` (already on the entity), so auditors filter by that — same end-result as the original plan, no extra field needed.

**Defer to Sprint 11:** add `credentialTypeToIemisFlashIICategory()` as a pure mapper in shared-types under `mappers/iemis/`. Sprint 11's Flash-II export driver consumes it. Including the function in S4.7 also works — purely additive, costs ~10 lines + 9 unit tests — but it does no work until Sprint 11 wires the export driver, so deferring is fine if S4.7 wants to stay narrow.

## What does NOT change from the original ADR

- One CRUD surface (`StaffCredential`), one entity, one set of endpoints, one UI tab. No `StaffQualification` parallel entity. **This part of the original ADR stays correct.**
- The "validation triggers — revisit if any of these" list still applies (see superseded ADR §"Validation trigger").

## Frontend consequence

The existing Credentials tab on Staff Detail shows the existing `credentialTypeDescriptor` field. UI labels can localize the 9 Ed-Fi types into Nepal-friendly copy (e.g. show "Qualification" alongside "Degree"), but the underlying data field stays unchanged. No new dropdown, no new filter chip is required for IEMIS Flash-II export to succeed.

## Validation trigger — revisit this revised ADR if

- CEHRD publishes a Flash-II spec that requires a Nepal-only field for which the existing 9-value enum genuinely cannot derive a value (e.g. a 5th bucket that isn't a strict mapping of any existing type). Then we add a small Nepal-specific tag, but locate it in a Nepal-extension namespace — not pollute the Ed-Fi-aligned core.
- A later pilot tenant outside Nepal needs a credential bucketing that conflicts with the Nepal mapper. Then the mapper becomes context-aware (`credentialTypeToFlashIICategory(type, country)`) — still pure, still at the export boundary.

## Action items

- [ ] **(this PR — S4.7)** Add the 9 new audit event types. **Do NOT add `credentialCategory` field.**
- [ ] **(Sprint 11)** Implement `credentialTypeToIemisFlashIICategory()` + unit tests.
- [x] Mark the original ADR as superseded. ([sprint4-credentials-vs-qualifications.md](sprint4-credentials-vs-qualifications.md) header gets an "Status: superseded by sprint4-credentials-vs-qualifications-revised.md" line in this same PR.)
