# Sprint A.5 close — dev-pabson-primary backfill (2026-06-30)

Operational close-out for the Finance Bulk-Ops EPIC's Sprint A.5 backfill against the `dev-pabson-primary` internal test tenant (Saraswati pilot tenant `21aea5da-511f-4dfa-a6f2-6971f63a719f` is OUT of scope — gated by [issue #343](https://github.com/shoaibrain/edforge/issues/343) spike).

## TL;DR

**100% resolution rate, zero errors, zero corruption.** The script (post-parallelization PR [#348](https://github.com/shoaibrain/edforge/pull/348)) populated `gradeLevel` snapshot + GSI14 sparse keys on **691 rows** (675 INVOICE + 16 PAYMENT) in ~94s. The sibling FE chip ([PR #261](https://github.com/shoaibrain/edforge-saas-frontend/pull/261)) for surfacing `gradeLevelResolutionStatus='unresolved'` rows is now operator-deployable as soon as it merges — though for this tenant the chip filters an empty bucket because no rows landed in the `unresolved` state.

## Timeline (UTC)

| Time | Event |
|---|---|
| 01:22:58Z | Dry-run start (after PR #348 merge — parallelized script) |
| 01:24:16Z | Dry-run complete: 691/691 resolved in 78.4s; CSV captured |
| 01:24-01:35Z | First `--apply` attempt → blocked by IAM (`edforge-prod-deployer` lacks `dynamodb:UpdateItem`); DDB stayed UNCHANGED thanks to Codex P1 safety net |
| 01:35Z (~) | Operator opens inline IAM grant `temp-a5-backfill-finance-updateitem-20260630` (scoped to `UpdateItem` on `edforge-finance-basic` only) |
| 01:36:30Z | IAM grant verified via `simulate-principal-policy` → `Decision: allowed`, `MatchedStatements: 1` |
| 01:36:47Z | `--apply` start (fresh JWT) |
| 01:38:21Z | `--apply` complete: 691/691 resolved + WRITTEN; DDB query confirms `attribute_not_exists(gradeLevel)` count = 0 for both INVOICE and PAYMENT |
| (post) | Operator revokes the inline IAM grant |

## Pre/post DDB state

| Entity | Rows missing `gradeLevel` (before) | Rows missing `gradeLevel` (after) |
|---|---|---|
| `INVOICE#…` | 383+ (paginated COUNT — actual full count was ~675) | **0** |
| `PAYMENT#…` | 16 | **0** |

Verification command (run any time as a regression check):

```bash
AWS_PROFILE=prod aws dynamodb query \
  --table-name edforge-finance-basic \
  --key-condition-expression 'tenantId = :t AND begins_with(entityKey, :sk)' \
  --filter-expression 'attribute_not_exists(gradeLevel)' \
  --expression-attribute-values '{":t":{"S":"21aea5da-511f-4dfa-a6f2-6971f63a719f"},":sk":{"S":"INVOICE#"}}' \
  --select COUNT --region ap-south-1
```

## Apply summary (from the script's terminal output)

```
Summary
  scanned=691
  invoicesResolved=675
  invoicesUnresolved=0
  invoicesSkipped=0
  paymentsResolved=16
  paymentsUnresolved=0
  paymentsSkipped=0
  alreadyFilled=0
  errors=0
  durationSec=94.3
  findings=dev-pabson-primary-finance-grade-backfill-apply-20260630-013647.csv
```

`alreadyFilled=0` means no rows had `gradeLevel` populated before this run — the `attribute_not_exists` ConditionExpression on UpdateItem fired zero times. A fully clean fresh fill.

## Artifacts

| File | Purpose |
|---|---|
| `dev-pabson-primary-finance-grade-backfill-dryrun-20260630-012258.csv` | Dry-run findings — 691 rows, all `resolution=resolved` |
| `dev-pabson-primary-finance-grade-backfill-apply-20260630-013647.csv` | Apply findings — same shape, with the writes actually committed |

Both CSVs use the standard backfill schema: `tenantId,entityType,entityKey,schoolId,studentId,invoiceId,resolution,resolvedGradeLevel,reason`.

## Discovered: IAM permission gap (NOT a regression; least-privilege working as designed)

The `edforge-prod-deployer` IAM user has `dynamodb:Scan` + `dynamodb:Query` on `edforge-finance-basic` (sufficient for the script's read passes), but **does NOT** have `dynamodb:UpdateItem`. The finance ECS task role (`tenant-template-stack-basic-financeABACRole…`) has full DDB CRUD on `edforge-finance-*`, but it's not designed for human STS assume.

**Fix today** (used here): operator opened a narrowly-scoped temporary inline policy on the user via CloudShell:

```bash
aws iam put-user-policy \
  --user-name edforge-prod-deployer \
  --policy-name temp-a5-backfill-finance-updateitem-20260630 \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "TempA5BackfillUpdateItem",
      "Effect": "Allow",
      "Action": "dynamodb:UpdateItem",
      "Resource": "arn:aws:dynamodb:ap-south-1:257526644020:table/edforge-finance-basic"
    }]
  }'
```

Revoked immediately after the apply confirmed clean — see `aws iam delete-user-policy --user-name edforge-prod-deployer --policy-name temp-a5-backfill-finance-updateitem-20260630`.

**Follow-up to file** (lower priority — out of scope for this PR): a dedicated `edforge-finance-backfill` IAM role managed by CDK with the minimum `Scan` + `UpdateItem` grants on `edforge-finance-*`, assumable from operator sessions. The Saraswati run ([#343](https://github.com/shoaibrain/edforge/issues/343)) and any future backfills (e.g. Sprint F PDF lifecycle work) will need the same grant repeatedly; standing up a reusable role is the right shape. Not blocking — dev-pabson-primary close stands today.

## Saraswati gate

The Saraswati pilot tenant backfill ([#343](https://github.com/shoaibrain/edforge/issues/343)) is the next step. Per that issue's decision tree, the recon-spike queries DDB read-only to count rows first; if `<50` unfilled rows the script runs immediately (likely no IAM gymnastics needed since the volume is small enough for a careful manual review). If `>50` or surprising state, halt and discuss with operator.

This dev-pabson-primary close proves:
1. The parallelized script (PR #348) is correct + fast (~80-100s for 700 rows)
2. The Codex P1 safety net is real — IAM denial → zero data corruption
3. The IAM grant pattern works end-to-end with narrow scope + simulator-verified propagation
4. 100% resolution rate is achievable on a non-trivial backfill scope

## Refs

- Plan: `.claude/plans/finance-module-bulk-mighty-honey.md` §A.5
- BE parallelize PR: https://github.com/shoaibrain/edforge/pull/348 (merged)
- FE Unknown-chip PR: https://github.com/shoaibrain/edforge-saas-frontend/pull/261 (open)
- Saraswati gate: https://github.com/shoaibrain/edforge/issues/343
- Script: `scripts/operations/finance-backfill-grade-snapshot.ts`
