# ADR — StaffTraining: separate first-class entity, not a CredentialType variant

**Date:** 2026-04-28
**Status:** Accepted
**Sprint:** B.1 (StaffTraining DDB schema + GSI design)
**Decision-maker:** Shoaib Rain
**Companion:** [SARASWATI_PILOT_REVISED_ROADMAP.md §6.B](../../SARASWATI_PILOT_REVISED_ROADMAP.md)

---

## 1. Context

The existing [`Credential`](../../server/application/microservices/identity/src/common/entities/credential.entity.ts) entity has `'training'` as one of its `CredentialType` values. So in principle, training records could be modeled as `Credential` rows where `credentialTypeDescriptor === 'training'`. The Sprint 4 backlog originally lumped credentials and training together; the `staff.training.{created,edited,deleted}` IEMIS audit-event types were pre-registered separately in Sprint S4.7 ([packages/shared-types/src/events/iemis-audit.events.ts:53-55](../../packages/shared-types/src/events/iemis-audit.events.ts#L53-L55)) anticipating a future split.

This ADR decides whether to **split now** (separate `StaffTraining` entity) or **stay merged** (continue using `Credential` with `credentialTypeDescriptor='training'`).

## 2. Why CEHRD reporting forces the split

Nepal's CEHRD IEMIS Flash-II Staff register asks for two separate aggregations:

1. **Staff qualifications** (Credentials): degrees, professional licenses, endorsements — these are point-in-time *achievements* a teacher holds. Static metadata, set once.
2. **Staff training/professional development hours** (Trainings): cumulative *events* a teacher attended — pedagogical workshops, technology training, inclusion seminars. CEHRD wants **total hours per academic year** broken down by training type. Each training has a start date, end date, duration, attendance status.

Modeling both as `Credential` rows would force every Flash-II export query to filter by `credentialTypeDescriptor === 'training'` AND assume `description`/`name`/`subjects` semantically encode duration + status — which they don't. The Credential entity has no `durationHours` field, no `status` enum (it has `verificationStatus`, which is different), and no clean way to express "scheduled" / "in progress" vs "completed". Coercing training data into Credential would either lose information or pollute the Credential model with training-specific fields that confuse downstream consumers.

## 3. Why audit-event-type semantics force the split

Sprint S4.7 wired six staff IEMIS audit event types: three for credentials (`staff.credential.{c,e,d}`) and three pre-registered for training (`staff.training.{c,e,d}`). Operators triaging audit logs need different downstream policy for each:

- **Credentials** are typically **verified by HR** — a `staff.credential.created` event implies a verification workflow. Audit metadata captures `credentialIdentifier`, `credentialTypeDescriptor`, `verificationStatus` (per [credentials.service.ts](../../server/application/microservices/identity/src/credentials/credentials.service.ts)).
- **Trainings** are typically **self-reported or HR-recorded** — a `staff.training.created` event reflects attendance, not achievement. Metadata captures `trainingType`, `trainingProvider`, `durationHours`, `status` — all distinct concepts from credential verification.

Routing both event types to the same underlying entity makes the audit metadata semantically ambiguous and breaks downstream filters that expect `staff.credential.*` to imply a Credential row exists.

## 4. Options considered

### Option A — Continue with `Credential` rows where `credentialTypeDescriptor='training'`

**Rejected.** Coerces semantically distinct data into one shape. Adds training-specific fields (`durationHours`, `status`, `attendanceConfirmed`) onto the Credential schema that don't apply to non-training credentials. CEHRD aggregations need to filter every query by `credentialTypeDescriptor='training'`. Audit-event-type → entity mapping becomes ambiguous.

### Option B — Add a discriminated union inside Credential (`credentialKind: 'qualification' | 'training'`)

**Rejected.** Same data-model coercion problem as Option A. The TypeScript discriminated-union approach helps at compile time but doesn't help DDB queries (still need to filter by the discriminator). Adds complexity without addressing the underlying split.

### Option C — Separate first-class `StaffTraining` entity, parallel to `Credential`

**Accepted.** Clean separation of concerns. CEHRD aggregations query the dedicated `STAFF#{id}#TRAIN#` keyspace directly. Audit event types map 1:1 to entities. Frontend UI can render distinct tabs (Credentials, Trainings) without conditional logic. Future `'training'` values in `CredentialType` remain valid for **legacy data** but new training records go to the new entity (deprecated path; documented in §7).

## 5. Decision

We adopt **Option C — separate first-class `StaffTraining` entity** mirroring the Credential entity pattern.

### 5.1 DDB key design

```
PK:  TENANT#{tenantId}
SK:  STAFF#{staffId}#TRAIN#{trainingId}
```

Mirrors the existing Credential pattern (`STAFF#{staffId}#CRED#{credentialId}`). Co-locates trainings with the staff record they belong to — a single `Query` on `pk=TENANT#x AND begins_with(sk, "STAFF#{staffId}#TRAIN#")` lists all trainings for a staff member.

### 5.2 GSI design

**GSI1 — Training-type lookup** (mirrors Credential's GSI1):

```
GSI1PK:  TRAINTYPE#{trainingType}
GSI1SK:  STARTDATE#{startDate}
```

Use case: "all pedagogical trainings tenant-wide sorted by date" — used by Flash-II export aggregation in Sprint K. Sparse on `trainingType` so trainings without one are excluded from the index.

**No GSI2 in V1.** Credential uses an expiry-based GSI for "credentials expiring soon" reminders; training certificates rarely have the same renewal cadence. If/when CEHRD requires "trainings expiring this month" queries, add GSI2 in a follow-up sprint with `EXPIRY#{date}` keys.

### 5.3 Entity field shape

| Field | Type | Required | Notes |
|---|---|---|---|
| `trainingId` | uuid | yes | server-generated |
| `staffId` | uuid | yes | foreign key |
| `tenantId` | uuid | yes | DDB partition |
| `trainingTitle` | string (1–150) | yes | human-readable |
| `trainingType` | enum | yes | see §5.4 |
| `trainingProvider` | string (max 150) | yes | who delivered it |
| `startDate` | YYYY-MM-DD | yes | Ed-Fi `BeginDate` analog |
| `endDate` | YYYY-MM-DD | optional | absent for ongoing |
| `durationHours` | int (0–9999) | yes | CEHRD reporting input |
| `status` | enum | yes | see §5.5 |
| `certificateNumber` | string (max 100) | optional | self-reported |
| `certificateUrl` | url | optional | future S3 upload — out of scope V1 |
| `notes` | string (max 1000) | optional | free text |
| `createdAt`, `updatedAt`, `version` | per BaseEntity | — | — |

### 5.4 `trainingType` enum (CEHRD-aligned)

```ts
'pedagogical'      // teaching methods, classroom management
'subject_matter'   // content knowledge in subject area
'technology'       // digital literacy, ed-tech
'inclusion'        // inclusive ed, special needs, gender sensitivity
'leadership'       // school admin / management
'safety'           // school safety, first aid, child protection
'assessment'       // evaluation, formative/summative methods
'language'         // language proficiency, English language teaching
'induction'        // new-teacher onboarding, probation training
'other'            // catch-all — operator can add freeform `notes`
```

Source: CEHRD's published Teacher Professional Development categories + observation that pilot xlsx imports use a small fixed vocabulary. `'other'` is the safety valve. Future expansion (e.g., `'research'`, `'administrative'`) is an additive change to the Zod enum + a shared-types minor bump, no DDB migration needed.

### 5.5 `status` enum

```ts
'scheduled'    // start_date in the future
'in_progress' // start_date <= today < end_date
'completed'   // end_date < today (or no end_date AND status set explicitly)
'cancelled'   // training did not happen
```

Status is **operator-set**, not derived from dates. Reason: trainings can be retroactively recorded (operator backfills "completed" months later) where derived status would say "in_progress" if `endDate` wasn't entered. Trusting the operator-set status is simpler than maintaining a derive-from-dates rule that needs to be re-evaluated on every read.

### 5.6 What's NOT in V1 (deferred)

- **Multi-attendee trainings.** A workshop with 50 staff attending creates 50 separate StaffTraining rows. No `Training` (singular) entity that aggregates attendees. Reason: CEHRD reports per-staff hours, not per-event metadata. Adding a many-to-many would solve nothing for V1.
- **Document upload.** `certificateUrl` is in the schema but no upload UI. S3 + presigned URL flow comes with the import pipeline (Sprint D).
- **Renewal reminders.** Out of scope per §5.2.
- **`completedDate` vs `endDate` distinction.** Some training certificates issue weeks after the training ends. We use `endDate` to mean "when training stopped happening"; certificate-issue-date can be `notes` for now.

## 6. Audit-event metadata shape (per S4.7 PII-clean pattern)

```jsonc
// staff.training.created
{
  "staffId":         "<uuid>",
  "trainingId":      "<uuid>",
  "trainingType":    "pedagogical",
  "trainingProvider":"<string>",      // org name — not PII
  "durationHours":   16,
  "status":          "completed"
  // NOT in metadata: trainingTitle, certificateNumber, notes
}

// staff.training.edited
{
  "staffId":      "<uuid>",
  "trainingId":   "<uuid>",
  "changedFields":["status","durationHours"]
  // optional `before`/`after` ONLY for status field (per S4.7 verify-path pattern)
}

// staff.training.deleted
{
  "staffId":    "<uuid>",
  "trainingId": "<uuid>",
  "softDelete": true
}
```

PII guard: per S4.7, no free-text title / notes / certificate-number in metadata. Only typed Ed-Fi-aligned fields. Same `assertNoPiiInMetadata` smoke check as S4.7 will catch leaks.

## 7. Migration policy for legacy `credentialTypeDescriptor='training'` rows

Existing `Credential` rows with `credentialTypeDescriptor === 'training'` (if any — none in current Saraswati pilot) are **left in place**. The new `StaffTraining` entity is the canonical home for new training records. Frontend Trainings tab queries the new entity exclusively.

If CEHRD reporting in Sprint K or L requires aggregating both, a one-shot migration script can `Scan` Credentials + filter type='training' + write to StaffTraining. **Not in V1 scope.**

## 8. Consequences

### Positive
- CEHRD aggregation queries are direct (`Query` on `STAFF#{id}#TRAIN#` prefix or GSI1 on `TRAINTYPE#`).
- Audit-event-type → entity mapping is unambiguous.
- Frontend can render distinct Credentials and Trainings tabs cleanly.
- Adding training-specific fields (e.g., `attendanceConfirmedBy`) doesn't pollute the Credential schema.

### Negative / debt
- One additional entity to maintain — though it follows the Credential pattern exactly so the maintenance overhead is low.
- The CredentialType enum still includes `'training'` — leaving it in keeps the door open for legacy data but means future readers might be confused. Mitigated by this ADR + a JSDoc deprecation note on `'training'` in the CredentialType enum (deferred to a cleanup PR).

## 9. Sign-off

- [ ] Shoaib Rain — _____________ (date)
