---
title: EdForge Production Pre-Optimize Snapshot (T2.1 + T2.8)
date: 2026-05-01
account: 257526644020 (EdForge-Production)
region: ap-south-1
profile: prod
captured-by: Sprint 2 read-only authorization, ReadOnlyAccess attached to edforge-prod-deployer
purpose: Rollback reference for Sprints 5/6 optimization. Captures pre-change state of every prod resource Sprint 2/3/5/6 will touch.
---

# 1. Identity verification

```
$ AWS_PROFILE=prod aws sts get-caller-identity
Account: 257526644020
Arn:     arn:aws:iam::257526644020:user/edforge-prod-deployer
Region:  ap-south-1
```

AZ to AZ-ID mapping (relevant for Sprint 6 NAT-reduction ticket T6.5):

| AZ name | AZ ID |
|---|---|
| ap-south-1a | aps1-az1 |
| ap-south-1b | aps1-az3 |
| ap-south-1c | aps1-az2 |

# 2. CloudFormation stacks

| Stack | Status | TerminationProtection (pre-Sprint-2) |
|---|---|---|
| shared-infra-stack | UPDATE_COMPLETE | **false** |
| controlplane-stack | UPDATE_COMPLETE | **false** |
| analytics-stack | UPDATE_COMPLETE | **false** |
| core-appplane-stack | UPDATE_COMPLETE | **false** |
| tenant-template-stack-basic | UPDATE_COMPLETE | **false** |
| tenant-template-stack-advanced | CREATE_COMPLETE | false (intentional — V1_DEFERRED) |
| CDKToolkit | UPDATE_COMPLETE | (not in scope) |

After Sprint 2 (T2.4) deploys, the first 5 stacks must show `terminationProtection=true`. The advanced stack stays `false` (it is V1_DEFERRED and not protected).

# 3. Networking

## 3.1 VPC + subnets

VPC: **vpc-0a5e1a669f077354b** (10.0.0.0/16, 3 AZs)

| Subnet ID | AZ ID | AZ name | CIDR | Type |
|---|---|---|---|---|
| subnet-00c10890874bd263a | aps1-az1 | ap-south-1a | 10.0.0.0/18 | Private |
| subnet-05d3c7560b6b9b1a7 | aps1-az1 | ap-south-1a | 10.0.192.0/24 | Public |
| subnet-0fc39b38c67f47cf3 | aps1-az3 | ap-south-1b | 10.0.64.0/18 | Private |
| subnet-00f09331da22ceadf | aps1-az3 | ap-south-1b | 10.0.193.0/24 | Public |
| subnet-0aef30cf36cd25103 | aps1-az2 | ap-south-1c | 10.0.128.0/18 | Private |
| subnet-058888edc5d7d7a1b | aps1-az2 | ap-south-1c | 10.0.194.0/24 | Public |

Default-VPC subnets (172.31.0.0/16) also exist but are unused by EdForge.

## 3.2 NAT gateways + EIPs (CRITICAL for Sprint 6 — third-party allowlist coordination)

Three NAT gateways, three EIPs. **These three public IPs are what any IEMIS / payment-gateway / third-party allowlist must reference today.** Sprint 6 NAT 3→1 will retain ONE of these EIPs; the other two are released and rolled into the surviving NAT — third parties allowlisting the released two must be coordinated.

| NAT Gateway | EIP Allocation | **Public IP** | Subnet | AZ |
|---|---|---|---|---|
| nat-0a422c72c3e61f59d | eipalloc-08ff63de8dfc6c9c5 | **13.234.151.182** | subnet-05d3c7560b6b9b1a7 | aps1-az1 |
| nat-0ea08a3c487bae5ec | eipalloc-02ed47d8e1800bb72 | **43.204.201.147** | subnet-00f09331da22ceadf | aps1-az3 |
| nat-01b0181f0692589b5 | eipalloc-0fe98f3ff334b02c6 | **35.154.234.47** | subnet-058888edc5d7d7a1b | aps1-az2 |

## 3.3 VPC Endpoints

**None.** All ECS task egress to AWS service APIs traverses NAT. Sprint 5 (T5.4) will add free Gateway Endpoints for S3 and DynamoDB.

## 3.4 Load balancers

| Type | Scheme | Name | State |
|---|---|---|---|
| ALB | internal | shared-sbtec-S5N1gfFUgH62 | active |
| NLB | internal | shared-sbtec-W5rlAEWYvw71 | active |

# 4. API Gateway

| ID | Name |
|---|---|
| **w5ulch7iyf** | TenantAPI (REST API) |

Per audit, this REST API is the target of the NLB→ALB→ECS chain. Sprint 6's NLB elimination is deferred (Phase 4) because it requires migrating to API Gateway HTTP API, which forces a Lambda authorizer payload-format rewrite.

Control Plane API (separate, AdminWeb):
- ControlPlaneApiUrl: `https://qh3movj8yh.execute-api.ap-south-1.amazonaws.com/`

# 5. ECS

## 5.1 Cluster `prod-basic` (BASIC tier — pilot traffic)

| Service | desiredCount | runningCount | LaunchType |
|---|---|---|---|
| identitybasic | **2** | 2 | FARGATE |
| academicsbasic | 1 | 1 | FARGATE |
| financebasic | 1 | 1 | FARGATE |
| rproxybasic | **2** | 2 | FARGATE |

Total: **6 tasks** running on Fargate. Sprint 6 (T6.8) will reduce identity and rproxy from 2→1.

## 5.2 Cluster `prod-advanced-257526644020` (V1_DEFERRED)

**0 services.** Cluster is deployed via `tenant-template-stack-advanced` but no services are scheduled — the V1_DEFERRED state holds at the workload level. **Note for future V1+:** the cluster itself does deploy, contrary to a strict reading of the audit's "synthesized but not deployed" wording.

# 6. DynamoDB tables (9 total)

PITR is **ENABLED on all 9 tables** ✅ (T2.8 PITR validation — passes).

DeletionProtection is **false on all 9** (pre-Sprint-2 baseline). After Sprint 2 (T2.5 deploys), the 7 EdForge tables (rows below marked PROTECT) must show `DeletionProtectionEnabled=true`.

| Table | Items | Size (bytes) | PITR | DelProt (current) | Sprint 2 target |
|---|---:|---:|---|---|---|
| `edforge-identity-basic` | 839 | (live) | ENABLED | false | **true (PROTECT)** |
| `edforge-academics-basic` | 4245 | (live) | ENABLED | false | **true (PROTECT)** |
| `edforge-finance-basic` | 538 | (live) | ENABLED | false | **true (PROTECT)** |
| `edforge-analytics` | 375 | (live) | ENABLED | false | **true (PROTECT)** |
| `edforge-analytics-landing` | 4498 | (live) | ENABLED | false | **true (PROTECT)** |
| `edforge-user-session-events` | 0 | (empty) | ENABLED | false | **true (PROTECT)** |
| `shared-infra-stack-TenantMappingTable8521321C-96GMWAIFDS9` | 2 | (live) | ENABLED | false | **true (PROTECT)** |
| `controlplane-stack-controlplanesbttenantManagementService...` | 3 | (live) | ENABLED | false | unchanged (SBT-internal, not in our CDK) |
| `controlplane-stack-controlplanesbttenantRegistrationService...` | 3 | (live) | ENABLED | false | unchanged (SBT-internal, not in our CDK) |

**Total business-data row count across the 6 EdForge tables: ~10,495 items.** This is real pilot data.

## 6.1 ⚠️ Sprint 1 follow-up: TenantMappingTable name mismatch

Sprint 1's `cleanup.sh` DDB-delete pass references the literal table name `"TenantMapping"`. The actual table name is **`shared-infra-stack-TenantMappingTable8521321C-96GMWAIFDS9`** (CDK auto-generated, no `tableName` set in the construct). When UAT teardown runs `cleanup.sh`, the explicit DDB-delete pass will not match this table; it will only be removed via `cdk destroy` (which it will, since UAT does not have deletionProtectionEnabled by virtue of the isProdAccount() gate). T3.4 verification will catch any survivor.

**Recommended fix (to land before Sprint 3 Phase 1):** change cleanup.sh's `DDB_TABLES` array entry from `"TenantMapping"` to a glob/loop that matches `shared-infra-stack-TenantMappingTable*`. Out of scope for this snapshot doc; tracked as Sprint 1 follow-up.

# 7. Cognito User Pools

Three pools currently in production:

| Pool ID | Name | DeletionProtection (current) | Sprint 2 target |
|---|---|---|---|
| ap-south-1_IvK2wLe27 | CognitoAuthUserPool9F7F9231-HMIDJfrCzjkG (system-admin / SBT) | INACTIVE | **ACTIVE (T2.7)** |
| ap-south-1_spYeNvNJt | basicUserPoolbasic-mcnoSnbPfAoB | INACTIVE | **ACTIVE (T2.6)** |
| ap-south-1_RDu4HQHZy | advancedUserPooladvanced-hDeQWcq9xfIU | INACTIVE | unchanged (V1_DEFERRED — not on protection list) |

# 8. ECR repositories

| Repository | Purpose |
|---|---|
| identity | NestJS identity service container |
| academics | NestJS academics service container |
| finance | NestJS finance service container |
| rproxy | NGINX reverse proxy container |
| cdk-hnb659fds-container-assets-257526644020-ap-south-1 | CDK asset staging |

No lifecycle policies set on any repo. Sprint 5 (T5.3) adds the 10-image-keep policy.

# 9. CloudFront

One distribution: **E1VMC9HX3U93AT** at `d13ht6qeozyzvy.cloudfront.net` (AdminWeb origin, S3-backed). Enabled.

# 10. SNS topics

Captured raw at `/tmp/edforge-prod-snapshot-20260501/sns-topics.json`. Includes `edforge-event-dlq-prod` SQS DLQ, operator-alerts topics. Not displayed inline since they're peripheral to the optimization plan.

# 11. Cost Explorer reference (last 30 days, ap-south-1)

See companion doc `cost-baseline-reconciliation-20260501.md` for the full breakdown. Headline:

- Total monthly cost: **$203.69** (audit estimated $201, within 1.5% — reconciles).
- Single biggest line: **EC2-Other = $103.22** (NAT GWs + EIPs + data transfer).
- ECS Fargate: **$54.08** (audit overstated this at $72; reviewer flag was correct).
- Load balancers: **$28.70**.

# 12. Snapshot file inventory

Raw JSON outputs are at `/tmp/edforge-prod-snapshot-20260501/`. Move to a more durable location (or commit a sanitized copy to the repo) if anything beyond this summary is needed for Sprint 5/6 rollback.

```
cfn-stacks.json        cognito/                    ddb/
cloudfront.json        cognito-pools.json          ddb-tables.json
cost-30d.json          ecr-repos.json              ecs-clusters.json
ecs-services-basic.json ecs-services-basic-detail.json ecs-services-advanced.json
eips.json              lbs.json                    nat-gws.json
rest-apis.json         sns-topics.json             subnets.json
vpc-endpoints.json     vpcs.json                   cfn-outputs/
```

# 13. Findings to surface to the project log

1. **Three tenants in production**, not one as audit assumed (3 distinct UUIDs in `SETTINGS#WORKSPACE` rows of `edforge-identity-basic`). One tenant's METADATA may be in a different shape than the audit assumed. Worth investigating whether all three are pilot schools or if one is a test residue. **Action: T2.2 confirms data is real; bulk-scan to enumerate METADATA shape was deliberately not run** — operator can decide whether to investigate further.
2. **TenantMappingTable shows 2 items**, but identity table shows 3 distinct tenants. Off-by-one. Possible explanations: (a) one tenant is registered in identity but never went through TenantMapping write path; (b) audit's "1 row per tenant" model was wrong. Not blocking but worth a 5-minute investigation.
3. **Advanced cluster is deployed but unused**: `prod-advanced-257526644020` exists with 0 services. Cost impact: ~$0 (no Fargate tasks). Future cleanup item.
4. **PITR is on for every table.** Excellent.
5. **Sprint 1 follow-up**: cleanup.sh DDB delete pass needs a glob for the auto-generated TenantMapping name (see §6.1).
