# GSI inventory — `edforge-data-table` (per-tenant DDB)

**Source of truth:** [`server/lib/tenant-template/ecs-dynamodb.ts`](../../server/lib/tenant-template/ecs-dynamodb.ts).
**Last reviewed:** 2026-05-17 (Sprint C4.0).

The tenant-template DynamoDB table reserves a numeric GSI slot per cross-entity access pattern. Slots are numbered linearly to keep the CDK shape predictable and the IAM policy stable. Adding a new GSI = pick the next free slot, claim it explicitly here, then add the `addGlobalSecondaryIndex(...)` call.

All GSI attributes use **lowercase** names (`gsiNpk`, `gsiNsk`) per the S3.2 contract — the historical uppercase rows on CalendarDate silently failed to populate the index until the 2026-05-14 backfill (memory `project_s3_2_gsi_casing_shipped`). New GSIs must follow the lowercase convention.

The table is **`PAY_PER_REQUEST`** (on-demand). Don't add `readCapacity` / `writeCapacity` fields to a new GSI — they're ignored at synth and add noise to the diff.

## Active GSIs (deployed in prod)

| Slot | PK / SK | Purpose | Notes |
|---|---|---|---|
| **GSI1** | `gsi1pk` / `gsi1sk` | School scope — entities under `TENANT#{tid}#SCHOOL#{sid}` | Backbone — most cross-school queries go here |
| **GSI2** | `gsi2pk` / `gsi2sk` | Academic year scope | AY-wide aggregations + student-timeline (cross-AY) |
| **GSI3** | `gsi3pk` / `gsi3sk` | Date-based attendance lookup | `attendanceDate(tenant, school, date)` — one query per date |
| **GSI4** | `gsi4pk` / `gsi4sk` | Grade category index | Grades by category |
| **GSI5** | `gsi5pk` / `gsi5sk` | Term index | Grades by academic term |
| **GSI6** | `gsi6pk` / `gsi6sk` | Academic data by school | Sibling to GSI1 for academic-only queries |
| **GSI7** | `gsi7pk` / `gsi7sk` | EMIS / government-ID lookup + future student-rollup | Overloaded by PK pattern (`EMIS#…` or `STUDENT#…`). See entity comment in `ecs-dynamodb.ts:110-124` |
| **GSI8** | `gsi8pk` / `gsi8sk` | IEMIS school code uniqueness (cross-tenant) | Sparse — populated only on School rows of tenants that supplied `emisSchoolCode`. Sprint 1 / S1.3 |

## Reserved-but-unused slots

| Slot | Originally reserved for | Status | Available? |
|---|---|---|---|
| GSI10 | Invoice overdue index | Commented in CDK | ✅ |
| GSI11 | Staff-by-department index | Commented in CDK | ✅ |
| GSI12 | Parent-student relationship index | Commented in CDK | ✅ |

The above slots were sketched in v0 but never implemented. They remain commented for documentation continuity. **A new feature should claim them only if its access pattern matches the reserved intent**; otherwise pick the next free slot (currently GSI13+).

## Claimed in this sprint

### **GSI9 — Block → CalendarDate child rows (Sprint C4.2)**

Use case: "Given a `blockId`, return every CalendarDate row that's a child of that block, sorted by date." Drives the `GET /calendar-blocks/:id` shape (return block metadata + ordered child dates) and the cascading `DELETE /calendar-blocks/:id` operation.

```
gsi9pk = BLOCK#{blockId}
gsi9sk = DATE#{date}           (YYYY-MM-DD)
```

Sparse: `gsi9pk` is populated only on CalendarDate rows that are part of a multi-day block (i.e., `blockId !== undefined`). Single-day CalendarDate rows (95%+ of rows in a typical tenant) leave `gsi9pk` unset → invisible to this index, so cardinality stays bounded to "rows in active blocks".

The original GSI9 sketch was *"Parent-centric: get all children + notifications for a parent"*. That feature has been parked for V1+; per the §C4.0 audit, the slot is free for re-use. If the parent-centric pattern ships later, it moves to GSI13+.

## Next free slot after Sprint C4

**GSI13.** GSI10–GSI12 remain reserved (commented) per the table above; new patterns should use GSI13+ unless the access pattern matches the slot's original intent verbatim.

---

## Adding a new GSI — checklist

1. Read this file. Pick the next free slot (or claim a documented reserved slot only if the access pattern matches).
2. Add the entry to "Claimed in this sprint" above with PK/SK shape + sparseness note + use case.
3. Add the `addGlobalSecondaryIndex(...)` call to `server/lib/tenant-template/ecs-dynamodb.ts` with lowercase `gsiNpk` / `gsiNsk` attribute names. No capacity fields.
4. Update `server/application/microservices/<service>/src/common/entities/<entity>.entity.ts` to populate the new attributes at write time. Default unset for sparse indexes.
5. CDK diff against `tenant-template-stack-basic` should show **only** an `AddGsi` on the data table — no other resource churn. Verify the prior-deploy CFN didn't drift.
6. Deploy via `./scripts/deploy-analytics.sh tenant-template-stack-basic prod`. Allow ~5–10 min for DDB to provision + backfill (on-demand tables are quick but not instant).
7. Identity / academics ECR roll picks up the entity-side write changes.

Backfill: existing rows that should now appear in the new index need an explicit backfill script. For sparse indexes claimed for a new feature (like block→dates), there's nothing to backfill — historical rows don't have `blockId` so they're correctly invisible.
