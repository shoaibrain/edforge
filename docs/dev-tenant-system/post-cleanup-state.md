---
title: T0.13 — Post-Cleanup State Verification
date: 2026-05-07
status: Sprint 0.5 closed; prod has only Saraswati live
---

# T0.13 — Post-Cleanup State Verification

## Final state — prod ap-south-1 (account 257526644020)

### Active tenants

| Tenant | tenantId | Archetype | Status |
|---|---|---|---|
| **saraswatiboardingschool** | `34f49822-ae1d-4188-95f0-04e14bc6c662` | PABSON | **LIVE — pilot** (untouched throughout Sprint 0.5) |

### Deprovisioned tenants (audit rows preserved)

| Tenant | tenantId | DDB data | Cognito | SNS | SBT audit |
|---|---|---|---|---|---|
| usbasicfoundationtenant | `34392ed6-2e51-4fc8-ae2c-242eb5710e40` | 0 rows ✓ | group missing ✓ | topic gone ✓ | sbtaws_active=false, registrationStatus="Deleted" ✓ |
| rainshoaiborg | `fc9ea1c1-1cc2-45b3-b8c4-7e953e8e30d7` | 0 rows ✓ | group missing ✓ | topic gone ✓ | sbtaws_active=false, registrationStatus="" ⚠️ (SBT crashed mid-run) |
| prodtestadmin | `04ce4a00-c39a-4185-afd4-6e764ef44647` | 0 rows ✓ | group missing ✓ | (never had topic) ✓ | sbtaws_active=false, registrationStatus="" ⚠️ (SBT crashed mid-run) |

### Saraswati control check

```
edforge-identity-basic       6 rows (METADATA, SCHOOL+CONFIG, SETTINGS#WORKSPACE, USER+PREFS) — UNCHANGED
edforge-analytics            37 rows                                                          — UNCHANGED
edforge-analytics-landing    3 rows                                                           — UNCHANGED
sns topic                    arn:aws:sns:...edforge-alerts-tenant-34f49822-...                — INTACT
cognito group users          1                                                                — UNCHANGED
```

### Surviving SNS topics (correct end state)

```
arn:aws:sns:ap-south-1:257526644020:edforge-alerts-operator              (operator-level — preserve)
arn:aws:sns:ap-south-1:257526644020:edforge-alerts-tenant-34f49822-...   (Saraswati — preserve)
arn:aws:sns:ap-south-1:257526644020:edforge-provisioning-alerts          (operator-level — preserve)
```

## Cleanup tally

| Sprint task | Tenant | DDB rows deleted | SNS topic deleted | Wall clock |
|---|---|---:|---|---|
| T0.10 | usbasicfoundationtenant | 36 | 1 | 27s |
| T0.11 | rainshoaiborg | 8,021 | 1 | 2m13s |
| T0.12 | prodtestadmin | 3,345 | 0 (no topic existed) | 67s |
| **Total** | | **11,402** | **2** | ~4 min wall clock |

Zero failed deletes. Zero collateral damage. Saraswati untouched.

## Sprint 5 design implications (from T0.8/T0.11/T0.12 evidence)

### SBT `deprovision-tenant.sh` is fundamentally broken at scale

Two confirmed bugs:

1. **`for ITEM in $(jq -c '.Items[]')` word-splits on whitespace inside JSON strings.** Complex items with map/list attributes get mangled into empty keys → `ValidationException` → silently logged as "Deleted" but actually failed.
2. **At scale (~400+ items), bash hits `Argument list too long`.** The `for ... in $(...)` expansion overflows the kernel arg limit, killing the function. Subsequent `describe-table` calls in the same session also fail (cascading shell corruption), so the script wrongly reports "Table does not exist" for academics + finance.

Real-world impact across our 3 test cleanups:
- `usbasic` (44 rows): 6 of 7 identity rows deleted (1 survivor due to bug #1)
- `rainshoaiborg` (8,023 rows): **0** rows deleted (full bug #2 — script crashed early)
- `prodtestadmin` (3,347 rows): bug #2 region — likely similar

### Recommendation for Sprint 5

**Stop using SBT's DDB row deletion entirely.** The CLI deprovision flow should:

1. Trigger SBT only for: Cognito group + users teardown, SBT control plane row flags
2. Do ALL DDB row deletion itself via `sweep-tenant-rows.ts` (productized from T0.9a)
3. Do per-tenant SNS topic deletion via `sweep-tenant-sns.ts` (productized from T0.9b)

Alternative: 5-line patch to fix SBT's bash bugs (replace `for ITEM in $(jq -c ...)` with `while IFS= read -r ITEM; do ...; done < <(jq -c ...)`). But given the script's complexity and the difficulty of regression-testing a CodeBuild-embedded bash script, building proper deletion in the CLI is more robust long-term.

**Sprint 5 T5.5 (DDB row deletion) is now load-bearing**, not optional. The CLI is the source of truth for tenant data deletion; SBT is reduced to a Cognito-cleanup helper.

### Sprint 5 verifier (T5.X) must accept partial registration states

Current verifier (T0.9c) expects `registrationStatus="Deleted"`. Reality: when SBT crashes mid-run (rainshoaiborg, prodtestadmin), this field stays empty. Sprint 5's verifier should accept either:
- `sbtaws_active=false AND registrationStatus="Deleted"` → SBT completed cleanly
- `sbtaws_active=false AND registrationStatus=""` → SBT crashed mid-run; ALL gap-fill mandatory (don't trust anything SBT claims to have done)

In either case, the CLI does its own deletion regardless.

## Saraswati's tenantTag backfill (Sprint 1)

Now trivial. One row to update:

```bash
AWS_PROFILE=prod aws dynamodb update-item \
  --table-name edforge-identity-basic --region ap-south-1 \
  --key '{"tenantId":{"S":"34f49822-ae1d-4188-95f0-04e14bc6c662"},"entityKey":{"S":"METADATA"}}' \
  --update-expression "SET tenantTag = :t" \
  --condition-expression "attribute_not_exists(tenantTag)" \
  --expression-attribute-values '{":t":{"S":"production"}}'
```

Operator can do this at the keyboard during Sprint 1 deploy. No script needed. The `condition-expression` makes it idempotent (subsequent runs are no-ops once the field is set).

## Operator checklist — actions you still need to do

1. **Detach the Sprint 0.5 IAM throwaway policy** (Sprint 0.5 closed; permission no longer needed):
   ```bash
   aws iam delete-user-policy \
     --user-name edforge-prod-deployer \
     --policy-name Sprint05CleanupThrowaway
   ```
2. **Detach `ReadOnlyAccess`** (overdue from infra-sunset Sprint 2):
   ```bash
   aws iam detach-user-policy \
     --user-name edforge-prod-deployer \
     --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
   ```
   Both run from CloudShell with admin creds.

3. **Decide commit strategy for Sprint 0.5 artifacts** — see closeout summary.
