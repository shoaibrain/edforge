---
title: DDB Recovery Posture (Sprint 0, T0.2)
date: 2026-05-07
status: All in-scope tables verified PITR + RETAIN + deletionProtection
---

# DDB Recovery Posture

## Why this exists

Sprint 5 (CLI deprovision with DDB row deletion) is the highest-stakes sprint in the plan. PITR (point-in-time recovery) is the rollback mechanism if the deletion script ever over-deletes. Before Sprint 5 ships, every in-scope table must have:

1. **`pointInTimeRecoverySpecification.pointInTimeRecoveryEnabled = true`** — enables 35-day rolling restore
2. **`removalPolicy: cdk.RemovalPolicy.RETAIN`** — CloudFormation cannot drop the table
3. **`deletionProtection: isProdAccount()`** — `aws dynamodb delete-table` and console deletes are blocked in prod

This document captures static evidence that all three are in place. Combined defense:

- A code bug deletes rows → PITR restores them
- A `cdk destroy` removes the stack → RETAIN preserves the table
- A console click or CLI typo tries to drop the table → deletionProtection refuses
- The IAM role somehow gets `dynamodb:DeleteTable` → deletionProtection still refuses (it's a table-level setting, not IAM-controlled)

## Verification method

Static grep against the CDK source:

```
grep -n -E "(pointInTimeRecovery|deletionProtection|removalPolicy|new dynamodb\.Table|new Table)" \
  server/lib/analytics/analytics-stack.ts \
  server/lib/shared-infra/shared-infra-stack.ts \
  server/lib/tenant-template/ecs-dynamodb.ts
```

For tenant per-service tables (identity / academics / finance), the construct is reused — confirmed at [ecs-dynamodb.ts:21-41](../../server/lib/tenant-template/ecs-dynamodb.ts#L21-L41).

## Results — all in-scope tables

| Table | CDK location | PITR | RETAIN | deletionProtection (prod) |
|---|---|---|---|---|
| `edforge-identity-basic` | [ecs-dynamodb.ts:21-41](../../server/lib/tenant-template/ecs-dynamodb.ts#L21-L41) | ✅ | ✅ | ✅ |
| `edforge-academics-basic` | (same construct) | ✅ | ✅ | ✅ |
| `edforge-finance-basic` | (same construct) | ✅ | ✅ | ✅ |
| `EdForge-AnalyticsTable` | [analytics-stack.ts:110-119](../../server/lib/analytics/analytics-stack.ts#L110-L119) | ✅ | ✅ | ✅ |
| `EdForge-AnalyticsLandingTable` | [analytics-stack.ts:136-144](../../server/lib/analytics/analytics-stack.ts#L136-L144) | ✅ | ✅ | ✅ |
| `EdForge-UserSessionEventsTable` | [analytics-stack.ts:155-164](../../server/lib/analytics/analytics-stack.ts#L155-L164) | ✅ | ✅ | ✅ |
| `shared-infra-stack-TenantMappingTable*` | [shared-infra-stack.ts:317-323](../../server/lib/shared-infra/shared-infra-stack.ts#L317-L323) | ✅ | ✅ | ✅ |

## Notes / caveats

1. **`deletionProtection` is gated on `isProdAccount()`**. UAT account had this off so the cleanup scripts could tear down. This is fine for the dev tenant system because we operate exclusively in the prod account (715860911762 was teardown-only and is now empty) — `isProdAccount()` returns true, so the protection is engaged.

2. **PITR has a cost**: ~$0.20 per GB per month (in addition to base storage). Acceptable at current data volumes (Saraswati pilot is pre-launch; tables are near-empty). Worth confirming if dev tenant data ever materially grows the per-table footprint.

3. **PITR window is 35 days** (AWS-fixed). If a row deletion is discovered later than that, recovery is impossible. The deploy log + audit log convention is the secondary backstop for "we deleted X on day N" forensics.

4. **`removalPolicy: cdk.RemovalPolicy.DESTROY`** appears at [shared-infra-stack.ts:296](../../server/lib/shared-infra/shared-infra-stack.ts#L296). This is a different table (out of scope — it's an SBT-internal resource that doesn't carry tenant data). Confirmed not in the dev tenant deprovision blast radius.

5. **DDB rows not protected by deletionProtection**. Table-level deletionProtection blocks dropping the *table*, not individual `delete-item` calls. Row-level protection is provided by:
   - Sprint 5 multi-layered tag-gating (API + CLI library + CLI orchestrator) — refuses `delete-item` against any tenantId whose METADATA tenantTag === `'production'`
   - PITR for rollback if the tag-gate is somehow bypassed

## Conclusion

**No additional CDK work needed before Sprint 5 ships.** PITR is universal across in-scope tables. Sprint 5's destruction operations land on tables that are recoverable up to 35 days back.

Sprint 5 task T5.13 (backout drill) will prove this end-to-end by deliberately making a partial-deprovision mistake on a throwaway tenant and recovering it via PITR. That drill is the live confirmation that the recovery posture documented here actually works in practice.
