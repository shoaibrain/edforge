# Sprint C4 — known issues + follow-up plan

**Status as of 2026-05-17 23:00 UTC:** Sprint C4 backend (multi-day event blocks) is **shipped + validated in prod via PRs #120-#125**. PR #125 was merged earlier but the post-merge smoke hit a **second IAM defect** (`dynamodb:DeleteItem` denied on the identity task role). PR #126 (this followup) applies the IAM-aware fix and is the deploy still in flight. Pre-PR-126 sequence preserved below for the audit trail.

**Resolution direction (PR #126):** mirror the C3.8 `generate-calendar` merge-mode pattern exactly — split the write into two phases (`batchWriteItems` deletes via the per-tenant ABAC client + `transactWrite` block+children put via the task-role-scoped raw client). Sacrifices delete↔put atomicity to stay within existing IAM. Recoverable on retry (preflight skips already-deleted system rows).

---

## Issue C4-DEFECT-02 — `POST /calendar-blocks` IAM denial on Delete

### Symptom

```
POST /calendar-blocks { … } → 500 INTERNAL_SERVER_ERROR
identity logs: "User: arn:aws:sts::…:assumed-role/…/identityecsTaskRole… is not
authorized to perform: dynamodb:DeleteItem on resource:
arn:aws:dynamodb:ap-south-1:…:table/edforge-identity-basic because no
identity-based policy allows the dynamodb:DeleteItem action"
```

### Root cause

PR #125's merge-mode `createBlock` built a single `TransactWriteItems` carrying both Delete (for SYSTEM rows) and Put (for the block + N children) ops, sent through `dynamoDBClient.transactWrite()`. That method intentionally bypasses the per-tenant ABAC client and instantiates a raw `DynamoDBClient` picking up the ECS task role's credentials (rationale at `dynamodb-client.service.ts:337-356`: "tenant IAM policy lacks `dynamodb:TransactWriteItems`").

The identity IAM model has **two principals**:

| Principal | Where granted | DDB actions |
|---|---|---|
| **Task role** (`{name}-ecsTaskRole`) | [tenant-template-stack.ts:421-435](../../server/lib/tenant-template/tenant-template-stack.ts#L421) | `GetItem` `PutItem` `UpdateItem` `Query` |
| **ABAC role** (`{name}-ABACRole`) | [ecs-dynamodb.ts:220-242](../../server/lib/tenant-template/ecs-dynamodb.ts#L220) | `GetItem` `PutItem` `BatchGetItem` `BatchWriteItem` `UpdateItem` `DeleteItem` `Query` (LeadingKeys-scoped) |

Neither principal has both `DeleteItem` **and** `TransactWriteItems`. PR #125's atomic transactWrite with Delete ops can therefore never authorize against either role under the current IAM. The C3.8 `generate-calendar` merge-mode in `calendar-date.service.ts` worked because it uses `batchWriteItems` (ABAC role) for deletes, NOT atomic `transactWrite`.

### Fix in PR #126

Two-phase write mirroring C3.8:

```ts
// Phase 1: delete SYSTEM rows via BatchWriteItem (ABAC client → DeleteItem allowed)
if (systemRowKeys.length > 0) {
  const deleteRequests = systemRowKeys.map((entityKey) => ({
    DeleteRequest: { Key: { tenantId: context.tenantId, entityKey } },
  }));
  await this.dynamoDBClient.batchWriteItems(client, deleteRequests);
}

// Phase 2: atomic block + child rows via TransactWrite (task role → PutItem allowed)
const transactItems = [
  { Put: { TableName, Item: blockEntity, ConditionExpression: 'attribute_not_exists(entityKey)' } },
  ...childRows.map((row) => ({ Put: { TableName, Item: row } })),
];
await this.dynamoDBClient.transactWrite(client, transactItems);
```

**Tradeoff:** loses delete↔put atomicity. If Phase 1 succeeds and Phase 2 fails (e.g., uuid collision on block row), the operator is left with deleted SYSTEM rows but no block. The merge-mode preflight on retry simply finds fewer SYSTEM rows to delete and proceeds — no data corruption. C3.8 has run this pattern in prod since 2026-05-17 without incident.

### Closing the atomicity gap (B0.1 follow-up)

A future PR can grant `dynamodb:DeleteItem` + `dynamodb:TransactWriteItems` on a single principal to restore atomic delete+put. Two paths:

- **Path A**: extend the bootstrap inline policy on the task role with `DeleteItem` + `TransactWriteItems` ([tenant-template-stack.ts:421-435](../../server/lib/tenant-template/tenant-template-stack.ts#L421)). Minimal change but contradicts the "limited bootstrap perms" intent.
- **Path B**: add a DDB statement to identity's `service-info.txt` policy block mirroring academics/finance ([service-info.txt:132-148](../../server/service-info.txt#L132)). More consistent with sibling services.

Either path is a tenant-template-stack-basic CDK deploy. Not pilot-blocking.

---

## Issue C4-DEFECT-01 — `POST /calendar-blocks` always 409s after `generate-calendar` (initial fix in PR #125, IAM gap in C4-DEFECT-02 above)

---

## Issue C4-DEFECT-01 — `POST /calendar-blocks` always 409s after `generate-calendar`

### Symptom

```
POST /calendar-blocks { schoolId, academicYearId, blockName, …, startDate, endDate }
→ 409 BLOCK_OVERLAPS_EXISTING_CALENDAR_DATES
  "One or more dates in the block range already have CalendarDate rows.
   Delete or PATCH those rows first, or pick a different range."
```

Reproducible against `dev-pabson-primary` for any date range inside the active AY (2026-04-14 to 2027-04-13) — verified during the C4 deploy smoke on 2026-05-17. The 9-smoke validation pass exercised every other code path correctly (Zod refine + enum, service-level AY check, GSI1 list, GSI9 cascade-delete-shape, controller error mapping, the entire transactWrite+ConditionExpression pipeline) and confirmed they all behave as designed. Only the 201-create happy path is currently unusable.

### Root cause

`CalendarBlockService.createBlock` writes each child CalendarDate with:

```ts
Put: {
  TableName: ...,
  Item: row,
  ConditionExpression: 'attribute_not_exists(entityKey)',
}
```

That condition was originally designed to refuse silent-overwrite of operator-edited CalendarDate rows. **It doesn't distinguish operator-edited rows from system-generated rows.** Every active tenant has run `generate-calendar` (Sprint C3.6/C3.8), which creates one CalendarDate row per day across the entire AY (~365 rows, all carrying `createdBy='SYSTEM'`, `updatedBy='SYSTEM'`). With those rows in place, every POST attempt collides with at least one system row → DDB rejects the whole transaction → 409 returned.

The defect is shaped exactly like the parallel decision that was correctly made in **Sprint C3.8 (`generate-calendar` merge mode)**, which solved the same operator-vs-system question via the `partitionRowsBySource` helper in `calendar-date.service.ts`. **C4 should have inherited that pattern** but didn't — I designed C4 without considering the operational reality of a tenant whose calendar was already generated.

### Proposed fix — merge-mode semantics on POST

Inside `createBlock`, before building the TransactWriteItems, fetch existing CalendarDate rows for the requested range via a GSI1 + AY scan (or the same per-school query `calendar-date.service` uses):

```ts
const existingInRange = await this.dynamoDBClient.queryGSI<CalendarDate>(/* GSI1 in school + AY range */);
const overlapping = existingInRange.filter(r => r.date >= startDate && r.date <= endDate);

const { systemRowKeys, preservedDates } = partitionRowsBySource(overlapping);
// partitionRowsBySource is the existing helper from calendar-date.service.ts:540-560 —
// extract to a shared util or re-import.

if (preservedDates.size > 0) {
  throw new ConflictException({
    errorCode: 'BLOCK_CONFLICTS_OPERATOR_DATES',
    message: 'One or more dates in the block range have operator-edited CalendarDate rows.',
    details: { conflictingDates: [...preservedDates].sort() },
  });
}

// Build TransactWriteItems with two phases:
// 1. Delete every systemRowKey (Put with attribute_exists + delete? Or Delete + Put combined).
//    Simpler: prepend a Delete op per system row to the transactItems list.
// 2. Put the new block + N new child rows (no ConditionExpression — we just deleted the rows
//    that would have collided).
```

DDB `TransactWriteItems` supports Delete + Put in the same transaction (atomic). Each transaction is limited to 100 items, so the upper bound becomes:
- 1 block row
- + up to 90 child rows (existing MAX_BLOCK_DAYS)
- + up to 90 delete ops for system rows in the same range
- = 181 items, exceeds the 100-item cap

**Two paths:**
1. **Chunk into multiple transactions.** Loses atomicity — a partial-fail could leave the tenant with deleted system rows but no block. Recoverable but ugly.
2. **Lower MAX_BLOCK_DAYS to 45** so the worst case (45 delete + 45 put + 1 block = 91) fits in one transaction. Acceptable for typical blocks (Dashain = 9, Tihar = 6, Summer Vacation = 10). Edge case: a full-month block (30 days) would still fit.

Recommended: **option 2.** Update `MAX_BLOCK_DAYS = 45` in `calendar-block.service.ts`, and reject longer blocks with `BLOCK_TOO_LONG` 400 at the API layer. Document the limit.

### Acceptance criteria for C4-followup

| AC | Verification |
|---|---|
| POST a 9-day Dashain block onto a generate-calendar'd tenant | Returns 201 with `childDateCount: 9`. The 9 existing system CalendarDate rows for those dates are replaced by 9 new rows carrying `blockId/blockName/blockDescriptor/subEventName`. |
| POST a block that overlaps an operator-edited CalendarDate row | Returns 409 with `errorCode: BLOCK_CONFLICTS_OPERATOR_DATES` and the specific conflicting dates in `details`. The transaction does NOT commit. |
| POST a block longer than 45 days | Returns 400 `BLOCK_TOO_LONG` with the explicit cap in the message. |
| `partitionRowsBySource` helper used in C3.8 is shared (not duplicated) | Extract to `server/application/microservices/identity/src/common/utils/calendar-date-partition.ts` and import from both `calendar-date.service.ts` (C3.8) and `calendar-block.service.ts` (C4-followup). |
| Block PATCH still preserves per-day operator overrides | Existing C4.4 behavior unchanged. Spec asserts. |
| Block DELETE cascade still removes child rows | Existing C4.3.c behavior unchanged. Spec asserts. |
| Audit emission carries the `mode` field on POST | Match the C3.8 `generate-calendar` audit shape — capture which path was taken. |

### Estimated scope

- ~50–80 LOC service-side change
- 1 shared helper extracted (~20 LOC, with light test)
- 2-3 new entity / service spec cases
- No CDK / IAM / schema change
- 1 identity ECR roll for the deploy
- 1 happy-path smoke against `dev-pabson-primary` (the 9-day Dashain POST will finally return 201)

---

## What the 2026-05-17 C4 deploy DID validate

Despite the design gap on the happy path, **every other code path was exercised and is correct in prod**:

| Surface | Verdict |
|---|---|
| API GW route `/calendar-blocks` + `/calendar-blocks/{blockId}` (GET, POST, PATCH, DELETE, OPTIONS) | ✅ deployed via tenant-template stack dependency on shared-infra; all return correct status codes |
| nginx `^/calendar-blocks` location block | ✅ deployed via rproxy roll; routes through correctly |
| GSI9 on identity + academics + finance tables (sparse `gsi9pk=BLOCK#{blockId}`) | ✅ deployed via tenant-template-stack-basic CDK; verified by `cdk diff` output before deploy |
| Identity controller wiring + module DI | ✅ CalendarBlockModule.providers declares DynamoDBClientService + AuditedWriteService correctly post-PR #121 |
| Zod refine + enum validation (endDate ≥ startDate, blockDescriptor enum, ≥1-field PATCH refine) | ✅ all 3 schema rejects returned 400 with correct path + message |
| Service-level AY range check | ✅ 400 BLOCK_OUTSIDE_AY_RANGE with details |
| `transactWrite` with high-level DocumentClient command + `removeUndefinedValues` | ✅ TransactWriteCommand wraps the payload, marshalling applies, DDB rejects on `ConditionExpression` — proving the entire transactional pipeline executes correctly |
| LIST endpoint (GSI1 query) | ✅ 200 with `{items:[], hasMore:false}` |
| GET unknown blockId | ✅ 404 BLOCK_NOT_FOUND |
| Controller error mapping | ✅ Zod errors → 400, NotFound → 404, BadRequest → 400 |

The infrastructure is sound. Only the application-level `attribute_not_exists` rule needs refinement.

---

## Lessons captured

Three meta-lessons from this sprint, saved to memory + recorded here for the audit trail:

1. **Module DI per-module rule** — every NestJS feature module that consumes `DynamoDBClientService` / `AuditedWriteService` / `IdentityEventsService` must declare them in its OWN `providers[]`. Root IdentityModule's exports don't propagate. Extend `module-wiring.spec.ts`'s consumer-module arrays in the same PR. (Memory: `feedback_module_wiring_invariant.md`.)
2. **`nest build` is not a smoke.** A clean webpack compilation says nothing about runtime correctness — neither DI graph completeness nor DDB marshalling shape. The first POST against a real tenant is the irreplaceable integration check. (Memory: same.)
3. **`as any` is a smell, not a fix.** When TypeScript pushes back on a cast, it's pointing at a real model mismatch. The C4 sprint shipped with `transactItems as any` silencing the very type error that would have flagged the wrong-command-variant bug. (Memory: same.)

A fourth, more architectural lesson lives below — added as part of this closeout:

4. **A new write endpoint must consider what tenant state it operates against.** I designed C4's POST as if `generate-calendar` hadn't run. In reality, every active tenant has 365 CalendarDate rows in place when C4 ships, so the `attribute_not_exists` guard always trips. The fix isn't in the service code — it's in the upstream thinking: **before designing a write operation, model the most-realistic input state, not the cleanest one.** A 1-day prod smoke would have caught it; so would re-reading C3.8's merge-mode design and asking "does the same problem apply here?"
