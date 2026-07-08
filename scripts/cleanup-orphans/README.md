# scripts/cleanup-orphans/

One-shot ops scripts written for **Sprint 0.5** of the dev-tenant-system project. They cleaned up 3 test tenants from prod (us, rainshoaiborg, prodtestadmin) so prod has only Saraswati live, and produced live evidence informing Sprint 5 design.

These scripts are **throwaway**: they are productized as proper library modules + tests in Sprint 5 (T5.5 / T5.6 / T5.11). Don't take dependencies on this directory; the long-term home is `scripts/dev-tenant/lib/`.

## Files

| File | Sprint task | Mutation? | Purpose |
|---|---|---|---|
| `sweep-tenant-rows.ts` | T0.9a | yes | Defensively delete tenant rows across 5 tenant-data tables (identity/academics/finance/analytics/analytics-landing). Catches SBT-script-bug survivors AND closes the analytics-table gap. |
| `sweep-tenant-sns.ts` | T0.9b | yes | Delete the per-tenant SNS topic `edforge-alerts-tenant-<tenantId>`. Idempotent if missing. Refuses to touch operator-level topics. |
| `verify-sbt-state.ts` | T0.9c | no | Read-only — confirms SBT marked the tenant as `sbtaws_active=false` in both control plane tables. |
| `cleanup-test-tenant.sh` | T0.9d | yes (delegated) | Orchestrator composing the above with typed-confirmation gate. Trigger SBT first, then run this to gap-fill. |
| `orphan-school-configs.ts` | grade-level-fix T5 / F-CONFIG-2 | yes | Tenant-wide scan of `edforge-identity-basic` for orphan `SCHOOL#<id>#CONFIG` rows (parent METADATA missing) and deletes them. Different shape from the Sprint 0.5 scripts: no tenant whitelist (orphans can exist in any tenant); the orphan check itself is the structural safety. Re-checks the parent METADATA right before each delete to handle the race-with-createSchool window. Dry-run default; `--apply` required to delete. Audit log written to `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-orphan-config-cleanup-T5-<ts>-{DRYRUN,APPLY}.log`. |

## Layered safety

Every destructive script enforces:

1. **Saraswati refuse-list constant** — hardcoded `34f49822-ae1d-4188-95f0-04e14bc6c662`. Process aborts before any AWS call if argv matches.
2. **Whitelist of allowed tenantIds** — only the 3 test tenants listed at the top of each script. Any other tenantId (including unknown ones) is refused.
3. **Dry-run default** — must explicitly pass `--apply` to mutate.
4. **Resource pattern checks** — `sweep-tenant-sns.ts` re-checks that the topic ARN literally contains `edforge-alerts-tenant-<tenantId>` before delete, and refuses operator topic patterns explicitly.
5. **PITR rollback** — all 5 in-scope DDB tables have point-in-time recovery enabled (35-day window). See `docs/dev-tenant-system/ddb-recovery-posture.md`.

Plus, Sprint 0.5's IAM policy was resource-scoped to ONLY the 3 test tenant SNS ARNs and the 5 in-scope DDB table ARNs. Saraswati's SNS topic + the operator alert topics were physically un-deletable under that policy.

## How Sprint 0.5 was run (for posterity / replay)

### IAM policy

`edforge-prod-deployer` user needed temporary write permissions. Inline policy attached via CloudShell with admin creds:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Sprint05DDBCleanup",
      "Effect": "Allow",
      "Action": ["dynamodb:BatchWriteItem", "dynamodb:DeleteItem"],
      "Resource": [
        "arn:aws:dynamodb:ap-south-1:257526644020:table/edforge-identity-basic",
        "arn:aws:dynamodb:ap-south-1:257526644020:table/edforge-academics-basic",
        "arn:aws:dynamodb:ap-south-1:257526644020:table/edforge-finance-basic",
        "arn:aws:dynamodb:ap-south-1:257526644020:table/edforge-analytics",
        "arn:aws:dynamodb:ap-south-1:257526644020:table/edforge-analytics-landing"
      ]
    },
    {
      "Sid": "Sprint05SNSCleanupTestTenantsOnly",
      "Effect": "Allow",
      "Action": ["sns:DeleteTopic"],
      "Resource": [
        "arn:aws:sns:ap-south-1:257526644020:edforge-alerts-tenant-34392ed6-2e51-4fc8-ae2c-242eb5710e40",
        "arn:aws:sns:ap-south-1:257526644020:edforge-alerts-tenant-fc9ea1c1-1cc2-45b3-b8c4-7e953e8e30d7",
        "arn:aws:sns:ap-south-1:257526644020:edforge-alerts-tenant-04ce4a00-c39a-4185-afd4-6e764ef44647"
      ]
    }
  ]
}
```

Attached:
```bash
aws iam put-user-policy --user-name edforge-prod-deployer \
  --policy-name Sprint05CleanupThrowaway \
  --policy-document file:///tmp/sprint-0.5-cleanup-policy.json
```

Detached after Sprint 0.5 complete:
```bash
aws iam delete-user-policy --user-name edforge-prod-deployer \
  --policy-name Sprint05CleanupThrowaway
```

### Per-tenant cleanup flow

For each test tenant:

1. Operator triggered SBT deprovision via AdminWeb (DELETE `/tenant-registrations/<id>`)
2. Polled CodeBuild project `deprovisioningScriptJobcode-A1OuMNKRPgHF` until terminal state
3. Re-inventoried tenant resources to identify orphans (almost everything, due to SBT bugs at scale)
4. Ran defensive sweep:
   ```bash
   AWS_PROFILE=prod npx ts-node \
     --compiler-options '{"module":"CommonJS","esModuleInterop":true}' \
     --transpile-only \
     scripts/cleanup-orphans/sweep-tenant-rows.ts <tenantId> --apply
   ```
5. Ran SNS sweep:
   ```bash
   AWS_PROFILE=prod npx ts-node \
     --compiler-options '{"module":"CommonJS","esModuleInterop":true}' \
     --transpile-only \
     scripts/cleanup-orphans/sweep-tenant-sns.ts <tenantId> --apply
   ```
6. Re-inventoried to confirm zero orphans

All output tee'd to `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-cleanup-test-tenant-<name>-<timestamp>-<sha>.log`.

## Why ts-node needs `--compiler-options '{"module":"CommonJS"}'`

The repo's `package.json` has no `"type"` field. Node's ESM loader nevertheless rejects the `.ts` extension under default config. Passing `--compiler-options '{"module":"CommonJS","esModuleInterop":true}' --transpile-only` makes ts-node compile to CommonJS and skip type-checking (faster), avoiding the ESM/CJS detection issue.

Sprint 5 will move these scripts under a proper `tsconfig.json`-rooted package and remove the workaround.

## SBT bugs documented (informing Sprint 5)

Confirmed in production via T0.8/T0.11/T0.12 evidence:

1. **`for ITEM in $(jq -c '.Items[]')`** — bash word-splits on whitespace inside JSON strings. Items with map/list attributes get mangled into empty keys → `ValidationException`. The script logs misleading "Deleted item" messages.
2. **`Argument list too long`** at scale (~400+ items). Bash exec arg limit overflows. Subsequent `describe-table` calls in the same shell session also fail (cascading state corruption).

See `docs/dev-tenant-system/cleanup-snapshots/T0.8-usbasic-sbt-deprovision-evidence.md` and `docs/dev-tenant-system/post-cleanup-state.md` for full evidence + Sprint 5 design implications.
