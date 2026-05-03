# EdForge Infrastructure Sunset & Cost Optimization — Project Log

Rolling log of sprint demos, deploys, and signoffs. One H2 section per sprint per the canonical plan in `03-sprint-plan.md`.

## Sprint 1 — Safety Foundation

**Status:** Code complete and validated; awaiting commit + sign-off.

**Demo evidence:**
- 7/7 cleanup-guard scenarios pass (`scripts/ci/test-cleanup-guard.sh`):
  - Prod account ID blocklisted ✅
  - `AWS_PROFILE=prod` blocklisted regardless of account ✅
  - Non-allowlisted account refused ✅
  - Wrong region refused even for UAT account ✅
  - UAT account + us-east-2 + uat profile passes through ✅
  - Empty account ID refused (bad credentials) ✅
  - `GUARD_REQUIRE_REGION=false` works for CloudFront use ✅
- Synth-time DDB Retain assertion passes (`scripts/ci/assert-tenant-ddb-retain.sh`): 3 tables checked, 0 violations.
- All shell scripts pass `bash -n`.
- `grep -rEn "346698404105|aws-nuke|delete-remaining-stacks|rds_proxy_multitenant" scripts/` returns 0 matches — stale tooling fully removed.

**Files changed (uncommitted, ready for review):**
- `scripts/cleanup/_safety-guard.sh` (new)
- `scripts/cleanup/cleanup.sh` (hardened + DDB delete pass + drop dead caller)
- `scripts/cleanup/cleanup-cloudfront.sh` (guard sourced)
- `scripts/cleanup/cleanup-cognito.sh` (guard sourced)
- `scripts/cleanup/cleanup-secrets.sh` (deleted — dead code)
- `scripts/cleanup/aws-nuke-setup.sh` (deleted — stale config)
- `scripts/cleanup/README-AWS-NUKE.md` (deleted — stale doc)
- `scripts/cleanup/delete-remaining-stacks.sh` (deleted — stale ARN)
- `scripts/ci/assert-tenant-ddb-retain.sh` (new — synth-time assertion)
- `scripts/ci/test-cleanup-guard.sh` (new — guard regression test)

**Sprint 1 follow-up flagged during Sprint 2 snapshot:** the `cleanup.sh` DDB delete-pass references the literal name `"TenantMapping"`, but the actual prod table name is auto-generated (`shared-infra-stack-TenantMappingTable8521321C-96GMWAIFDS9`). UAT will mirror this pattern. Recommended fix before Sprint 3: convert the literal-name array into a glob loop matching `shared-infra-stack-TenantMappingTable*`. **Tracked.**

## Sprint 2 — Production Data Hardening

**Status:** Code complete + read-only tickets complete + validated. Deploys awaiting operator authorization.

### Read-only tickets (completed 2026-05-01)

ReadOnlyAccess managed policy attached to `edforge-prod-deployer` for the duration of these tickets. **MUST be detached after sign-off:**

```
aws iam detach-user-policy \
  --user-name edforge-prod-deployer \
  --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
```

| Ticket | Output | Headline finding |
|---|---|---|
| T2.1 + T2.8 | [snapshot-prod-pre-optimize-20260501.md](snapshot-prod-pre-optimize-20260501.md) | All 5 prod stacks `terminationProtection=false`. PITR ENABLED on all 9 DDB tables. DeletionProtection OFF on all tables and pools. Three NAT EIPs captured for Sprint 6 third-party allowlist coordination. |
| T2.2 | [sprint-2-data-verification-20260501.md](sprint-2-data-verification-20260501.md) | **3 tenants in prod**, ~10,500 business rows. Real pilot data confirmed. |
| T2.3 | [cost-baseline-reconciliation-20260501.md](cost-baseline-reconciliation-20260501.md) | **Realized $203.69/month** vs audit $201 estimate (within 1.5%). Audit overstated Fargate by ~$18 (reviewer was right). $100 target is on the edge — likely $115–120 from Sprint 5+6 alone, $100–105 only with optional Sprint 7.5 overnight scale-down. |

### Read-only ticket findings to action

1. **Three tenants in prod, not one.** Worth a 5-minute investigation by operator to confirm all three are pilot schools (vs. test residue).
2. **TenantMappingTable shows 2 items but 3 tenants in identity** — possible off-by-one. Not blocking.
3. **Advanced cluster `prod-advanced-257526644020` deployed but unused** (0 services). Cost ~$0; future cleanup item.
4. **Sprint 1 follow-up** for cleanup.sh TenantMapping name pattern (above).
5. **Cost target re-anchored.** $100/month is achievable only with Sprint 7.5 stretch optimization. $115–120/month is the realistic Sprint 5+6 outcome.

### Code-change tickets (T2.4 – T2.7) — uncommitted, ready for review

| Ticket | Files | Notes |
|---|---|---|
| T2.4 — terminationProtection on 5 stacks | `bin/ecs-saas-ref-template.ts`, `lib/utilities/account-guards.ts` (new), `lib/shared-infra/shared-infra-stack.ts` | Includes a latent-bug fix: `super(scope, id)` was dropping all StackProps. |
| T2.5 — DDB deletionProtection on 7 tables | `lib/shared-infra/shared-infra-stack.ts`, `lib/tenant-template/ecs-dynamodb.ts`, `lib/analytics/analytics-stack.ts` | Audit said 5 tables; analytics has 3 not 1, total 7. |
| T2.6 — Cognito tenant pool deletionProtection | `lib/tenant-template/identity-provider.ts` | Property is `boolean`, not the `DeletionProtection` enum. |
| T2.7 — System-admin pool deletionProtection | `lib/bootstrap-template/control-plane-stack.ts` | L1 escape hatch on SBT-managed `cognito.CfnUserPool` (cleaner than custom resource). |

**Synth-simulation validation (passed):**
- Prod-account synth → all 5 stacks `terminationProtection=true`, all 7 DDB tables `DeletionProtectionEnabled=true`, both Cognito pools `DeletionProtection=ACTIVE`.
- UAT-account synth → all properties OFF (UAT teardown remains unblocked).
- T1.6 retain assertion still passes after Sprint 2 changes.

### What still needs operator (Sprint 2)

1. Review and commit Sprint 1 + Sprint 2 code diffs.
2. `cdk diff` per stack against prod (5 stacks). Capture each diff to `docs/deploys/`.
3. Deploy each stack via `./scripts/deploy-analytics.sh <stack> prod` in dependency order:
   - `shared-infra-stack` → `controlplane-stack` → `analytics-stack` → `core-appplane-stack` → `tenant-template-stack-basic`
4. Post-deploy verification of T2.4 / T2.5 / T2.6 / T2.7 (commands ready in `02-execution-plan.md`).
5. **Detach ReadOnlyAccess from `edforge-prod-deployer`** after sign-off:
   ```
   aws iam detach-user-policy \
     --user-name edforge-prod-deployer \
     --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
   ```
