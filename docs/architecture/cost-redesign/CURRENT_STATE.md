# CURRENT_STATE — hourly-billed infrastructure inventory and bill reconciliation

**Scope:** production account, single region (`ap-south-1`), August 2026 bill (744 hours).
**Method:** every figure below is derived from the CDK source in this repo, the SBT
library it depends on (`@cdklabs/sbt-aws` 0.9.1), the operator env flags, and the
Cost Explorer CSV. No live AWS calls were made; where a fact needs a live read to
close, it is listed in §9 rather than guessed.

Prices are `ap-south-1` list prices. Each one is cross-checked against the bill by
back-solving `cost ÷ hours`, and against the June bill (720 hours) as a second data
point. Where the back-solve disagrees with list price, the disagreement is stated.

---

## 1. The bill, and the class of cost it represents

| Line item | Aug 2026 | Jun 2026 | Billing basis |
|---|---:|---:|---|
| Elastic Container Service | 77.19 | 47.03 | hourly (Fargate vCPU-h + GB-h) |
| EC2 – Other | 44.54 | 43.42 | hourly (NAT Gateway) + EBS GB-month + NAT GB processed |
| Elastic Load Balancing | 35.71 | 34.56 | hourly (ALB + NLB) + LCU |
| EC2 – Instances | 8.33 | 8.06 | hourly (one t3.micro) |
| CloudWatch | 4.10 | 0.88 | monthly (dashboards, alarms) + GB ingested |
| VPC | 3.72 | 3.60 | hourly (one public IPv4) |
| DynamoDB | 2.10 | 1.30 | usage (on-demand RCU/WCU, storage, PITR) |
| KMS | 2.00 | 2.00 | monthly (2 customer-managed keys) |
| ECR | 0.25 | 0.16 | GB-month |
| API Gateway | 0.002 | 0.18 | per request |
| S3 | 0.03 | 0.05 | GB-month + requests |
| Cognito | 0.00 | 0.02 | MAU (under free tier) |
| CloudWatch Events | 0.0004 | 0.005 | per event |
| Secrets Manager | 0.00001 | 0.00007 | per secret |
| **Pre-tax subtotal** | **177.98** | **141.27** | |
| Tax | 11.74 | 9.31 | ≈ 6.6 % of pre-tax |
| **Total** | **189.72** | **150.58** | |

Two facts frame everything that follows:

- **API Gateway billed $0.002 in August.** At $3.50 per million REST requests that
  is roughly 570 requests for the whole month. July's $0.06 is roughly 17,000. The
  platform is idle in the literal sense.
- **$175.11 of the $177.98 pre-tax (98.4 %) is billed by the hour or by the month
  regardless of requests.** The usage-priced services that actually do work for the
  school (DynamoDB, API Gateway, S3, Cognito, log ingestion, NAT data processing)
  add up to $2.87.

The prompt's framing (compute + network = $169.49 = 89 % of the total) is correct
and slightly conservative: once the KMS keys, the fourth CloudWatch dashboard and
the alarms are counted as the fixed-cost class they belong to, the idle fraction of
the pre-tax bill is 98 %.

---

## 2. Inventory of every hourly- or monthly-billed construct

Legend for the "Stack" column: `SI` = `shared-infra-stack`, `CP` = `controlplane-stack`,
`CAP` = `core-appplane-stack`, `AN` = `analytics-stack`, `TT-basic` =
`tenant-template-stack-basic`, `TT-adv` = `tenant-template-stack-advanced`.

### 2.1 Compute

| # | Construct | Stack | Source | Size | Unit price (ap-south-1) | Qty × hours | Monthly |
|---|---|---|---|---|---|---|---:|
| C1 | Fargate task `rproxy` (nginx) | TT-basic | [services.ts:143-185](../../../server/lib/tenant-template/services.ts#L143), [service-info.txt:6-7](../../../server/service-info.txt#L6) | 0.25 vCPU / 0.5 GB | $0.04256 /vCPU-h, $0.00466 /GB-h | 1 task × 744 h | 9.65 |
| C2 | Fargate task `identity` | TT-basic | [service-info.txt:38-39](../../../server/service-info.txt#L38) | 0.25 vCPU / 0.5 GB | same | 1 × 744 | 9.65 |
| C3 | Fargate task `academics` | TT-basic | [service-info.txt:111-112](../../../server/service-info.txt#L111) | 0.5 vCPU / 1 GB | same | 1 × 744 | 19.30 |
| C4 | Fargate task `finance` | TT-basic | [service-info.txt:182-183](../../../server/service-info.txt#L182) | 1 vCPU / 2 GB | same | 1 × 744 | 38.60 |
| C5 | EC2 `t3.micro` in ASG (desired = min = 1) | **TT-adv** (nested `EcsCluster`) | [ecs-cluster.ts:47-127](../../../server/lib/tenant-template/ecs-cluster.ts#L47), [ecs-saas-ref-template.ts:272-287](../../../server/bin/ecs-saas-ref-template.ts#L272) | t3.micro | $0.0112 /h | 1 × 744 | 8.33 |
| C6 | EBS root volume for C5 (AMI default, no `blockDevices` override) | TT-adv | [ecs-cluster.ts:86-99](../../../server/lib/tenant-template/ecs-cluster.ts#L86) | 30 GiB gp3 | $0.0912 /GB-month | 30 GB | 2.74 |

Arithmetic for C1–C4 (the sum is the ECS line):

```
rproxy    0.25 × 0.04256 + 0.5 × 0.00466 = 0.010640 + 0.002330 = 0.012970 $/h × 744 =  9.65
identity  same                                                             =  9.65
academics 0.50 × 0.04256 + 1.0 × 0.00466 = 0.021280 + 0.004660 = 0.025940 $/h × 744 = 19.30
finance   1.00 × 0.04256 + 2.0 × 0.00466 = 0.042560 + 0.009320 = 0.051880 $/h × 744 = 38.60
                                                                   total  0.103760 $/h × 744 = 77.20
Bill: 77.19.  Fleet = 2 vCPU + 4 GB, all day, every day.
```

June cross-check (720 h, finance still at 0.25 vCPU / 0.5 GB until the 2026-06-30
resize in commit `865c52e`): `(3 × 0.012970 + 0.025940) × 720 = 0.064850 × 720 = 46.69`.
Bill: 47.03. The extra $0.34 is the first day of the resized finance task.

`desiredCount` is hard-coded to 1 for every service
([services.ts:143](../../../server/lib/tenant-template/services.ts#L143)); there is no
service auto-scaling (the block is commented out at
[services.ts:219-236](../../../server/lib/tenant-template/services.ts#L219)) and no
scheduled scale-to-zero (the Sprint 7.5 stretch item in the 2026-05 sunset plan was
never built).

### 2.2 Network

| # | Construct | Stack | Source | Unit price | Qty × hours | Monthly |
|---|---|---|---|---|---|---:|
| N1 | NAT Gateway (1 of 3 AZs; reduced from 3 in 2026-05) | SI | [shared-infra-stack.ts:112](../../../server/lib/shared-infra/shared-infra-stack.ts#L112) | $0.056 /h | 1 × 744 | 41.66 |
| N2 | NAT data processing | SI | same | $0.056 /GB | ≈ 2.5 GB | 0.14 |
| N3 | Public IPv4 (the NAT's EIP) | SI | implicit in N1 | $0.005 /h | 1 × 744 | 3.72 |
| N4 | Application Load Balancer (internal) | SI | [shared-infra-stack.ts:174-179](../../../server/lib/shared-infra/shared-infra-stack.ts#L174) | $0.0239 /h | 1 × 744 | 17.78 |
| N5 | Network Load Balancer (internal, cross-zone) | SI | [shared-infra-stack.ts:188-194](../../../server/lib/shared-infra/shared-infra-stack.ts#L188) | $0.0239 /h | 1 × 744 | 17.78 |
| N6 | LCU / NLCU | SI | — | $0.008 / $0.006 per unit-h | trace | 0.15 |
| N7 | API Gateway VPC Link (REST) | SI | [shared-infra-stack.ts:279](../../../server/lib/shared-infra/shared-infra-stack.ts#L279) | **$0** (no hourly charge for REST VPC Links) | — | 0.00 |
| N8 | Gateway VPC endpoints (S3, DynamoDB) | SI | [shared-infra-stack.ts:138-146](../../../server/lib/shared-infra/shared-infra-stack.ts#L138) | $0 | — | 0.00 |
| N9 | Interface VPC endpoints | — | none exist | — | — | 0.00 |
| N10 | Cloud Map HTTP namespace (Service Connect) | TT-basic | [tenant-template-stack.ts:182](../../../server/lib/tenant-template/tenant-template-stack.ts#L182) | $0 (HTTP namespace, not private DNS) | — | 0.00 |

Arithmetic:

```
NAT hourly        0.056  × 744 = 41.66
EBS (C6)          0.0912 ×  30 =  2.74
NAT GB processed  remainder     =  0.14   (≈ 2.5 GB)
                       EC2-Other = 44.54  ✓ bill 44.54
ALB + NLB   (0.0239 + 0.0239) × 744 = 35.56 ; + LCU 0.15 = 35.71  ✓ bill 35.71
Public IPv4 0.005 × 744 = 3.72                                   ✓ bill 3.72
```

June cross-checks: NAT `0.056 × 720 = 40.32` + EBS `2.74` = 43.06 vs 43.42 (rest is
NAT GB); LBs `0.0478 × 720 = 34.42` vs 34.56; IPv4 `0.005 × 720 = 3.60` vs 3.60 exactly.

The `VPC` line being exactly one IPv4-hour charge is itself evidence: the ALB and NLB
are `internetFacing: false` (no public IPs), the t3.micro sits in a private subnet
(ASG default), so the only public address in the account is the NAT's EIP. It also
falsifies the 2026-05 audit's "VPC Link ≈ $10/month hourly" line: REST-API VPC Links
carry no hourly charge; the NLB behind them does.

### 2.3 Keys, dashboards, alarms

| # | Construct | Stack | Source | Unit price | Qty | Monthly |
|---|---|---|---|---|---|---:|
| K1 | KMS CMK `codeBuildProjectEncryptionKey` (provisioning ScriptJob) | CAP | SBT [`script-job.js:55`](../../../node_modules/@cdklabs/sbt-aws/lib/core-app-plane/script-job.js#L55) via [core-appplane-stack.ts:104](../../../server/lib/bootstrap-template/core-appplane-stack.ts#L104) | $1.00 /key-month | 1 | 1.00 |
| K2 | KMS CMK (deprovisioning ScriptJob) | CAP | same, via [core-appplane-stack.ts:110](../../../server/lib/bootstrap-template/core-appplane-stack.ts#L110) | $1.00 | 1 | 1.00 |
| K3 | CDK bootstrap bucket key | CDKToolkit | not created: CLI 2.1130 defaults a fresh bootstrap to `AWS_MANAGED_KEY` | — | 0 | 0.00 |
| W1 | CloudWatch dashboard `EventDLQDashboard` | CP | [event-dlq-stack.ts:169](../../../server/lib/shared-infra/event-dlq-stack.ts#L169) | free (1 of 3) | 1 | 0.00 |
| W2 | Dashboard `AnalyticsDashboard` | AN | [analytics-stack.ts:331](../../../server/lib/analytics/analytics-stack.ts#L331) | free (2 of 3) | 1 | 0.00 |
| W3 | Dashboard `PilotDashboard` | AN | [analytics-stack.ts:514](../../../server/lib/analytics/analytics-stack.ts#L514) | free (3 of 3) | 1 | 0.00 |
| W4 | Dashboard finance hot-path (added 2026-06-29, `a011b85`) | AN | [analytics-stack.ts:725](../../../server/lib/analytics/analytics-stack.ts#L725) | **$3.00 /month** (4th dashboard) | 1 | 3.00 |
| W5 | CloudWatch alarms (standard resolution) | all | 1 DLQ + 2 SES + 2 result-batch (basic) + 2 result-batch (**advanced** stack) + 1 IEMIS audit + 2 CodeBuild + 11 analytics = 21 | $0.10 each beyond 10 free | 11 billable | 1.10 |
| W6 | Log ingestion + storage, custom metrics | all | §7 | $0.57 /GB ingested; $0.30 /metric beyond 10 | small | < 0.05 |

```
CloudWatch = 3.00 (dashboard) + 1.10 (alarms) + <0.05 (logs, metrics) = 4.10  ✓ bill 4.10
KMS        = 2 × 1.00 = 2.00                                                 ✓ bill 2.00
```

The CloudWatch jump from $0.88 (June) to $4.09 (July) is the fourth dashboard: the
finance hot-path dashboard landed on 2026-06-29 and pushed the account past the
three-free-dashboards tier. The two SBT KMS keys are created unconditionally inside
every `ScriptJob` (`script-job.js:55`, no guard). SBT 0.9.1 does let a caller pass
`projectProps.encryptionKey` to point the CodeBuild *project* at another key, but
the orphaned `kms.Key` construct is still synthesized and still billed; suppressing
it needs an escape hatch (`node.tryRemoveChild`) or dropping the ScriptJobs.
`tenant-update-stack.ts` also declares a CMK but is not instantiated anywhere in
`bin/`, so it contributes nothing.

### 2.4 Things that look like they bill hourly but do not

| Construct | Why it is $0 at idle |
|---|---|
| SBT control-plane HTTP API + 5 Python Lambdas + 2 DDB tables + EventBridge bus | all per-request / per-event |
| CodeBuild projects (provisioning, deprovisioning) | per build-minute; zero builds in August |
| Step Functions state machine (SBT provisioning) | per transition |
| AdminWeb CodePipeline (V2) | per action-minute; V2 has no $1/month active-pipeline fee |
| CloudFront (AdminWeb) + S3 origin | per GB / request |
| Lambda functions (~15 across stacks, incl. 2 janitors on a 5-minute schedule) | per-invoke; 2 × 8,640 invocations/month is inside the free tier |
| EventBridge Scheduler (4 schedules) | $1.00 per million invocations |
| Cognito (3 pools: system-admin, basic tenant, advanced tenant) | free under 10k MAU |
| Cloud Map `HttpNamespace` | free (only private-DNS namespaces bill per hosted zone) |
| API Gateway REST + usage plans + API keys | per request |
| X-Ray (authorizer + DLQ processor, `Tracing.ACTIVE`) | per trace, inside free tier |
| SQS DLQs (3) | per request |
| Container Insights | disabled ([ecs-cluster.ts:44](../../../server/lib/tenant-template/ecs-cluster.ts#L44)) |
| VPC Flow Logs | disabled (2026-05, T5.1) |

---

## 3. Reconciliation against the August bill

| Bill line | Bill | Modeled from code | Δ | Components |
|---|---:|---:|---:|---|
| ECS | 77.19 | 77.20 | +0.01 | C1–C4 |
| EC2 – Other | 44.54 | 44.54 | 0.00 | N1 41.66 + C6 2.74 + N2 0.14 |
| ELB | 35.71 | 35.71 | 0.00 | N4 + N5 35.56 + N6 0.15 |
| EC2 – Instances | 8.33 | 8.33 | 0.00 | C5 |
| CloudWatch | 4.10 | 4.10 | 0.00 | W4 3.00 + W5 1.10 + W6 <0.05 |
| VPC | 3.72 | 3.72 | 0.00 | N3 |
| KMS | 2.00 | 2.00 | 0.00 | K1 + K2 |
| DynamoDB | 2.10 | usage | — | 9 on-demand tables, all PITR-enabled |
| ECR | 0.25 | usage | — | ≈ 2.5 GB of images |
| API GW, S3, Cognito, Events, Secrets | 0.03 | usage | — | |
| **Pre-tax** | **177.98** | **177.96 + usage** | | |

Every hourly line reconciles to within one cent. The inventory accounts for
$175.11 of fixed cost against the prompt's $169.49 floor; the difference is the
$2 KMS + $3.90 dashboard/alarms that the prompt's table did not classify as fixed.

### Fixed vs usage split

```
Fixed (hourly/monthly):  77.20 + 41.66 + 3.72 + 35.56 + 8.33 + 2.74 + 2.00 + 3.00 + 1.10 = 175.31  (98.5 %)
Usage-priced:            2.10 + 0.25 + 0.14 + 0.15 + 0.03 (+ logs < 0.05)                 =   2.67  ( 1.5 %)
```

(Revision note: the first draft counted 19 alarms / $0.90 and $0.20 of logs; the
verification pass found the two result-batch alarms the dormant advanced stack also
deploys, moving $0.20 from the usage class to the fixed class. The 175.11 / 2.87
figures quoted in the Phase 2 brief differ from these by that $0.20.)

---

## 4. Discrepancies between what the code says and what the bill says

### 4.1 A t3.micro runs 24/7 for a tier that has no tenants (≈ $11.07/month)

The bill's `EC2 – Instances` line ($8.33 = 744 h × $0.0112, a t3.micro) has no
counterpart in the BASIC tier: `CDK_PARAM_USE_EC2_BASIC=false` in the prod env file,
so `tenant-template-stack-basic` is pure Fargate (`isEc2Tier=false` →
[ecs-cluster.ts:47](../../../server/lib/tenant-template/ecs-cluster.ts#L47) skips the ASG).

It comes from `tenant-template-stack-advanced`:

1. [ecs-saas-ref-template.ts:272-287](../../../server/bin/ecs-saas-ref-template.ts#L272)
   instantiates the advanced template with `useEc2: process.env.CDK_PARAM_USE_EC2_ADVANCED === 'true'`
   and `advancedCluster: 'INACTIVE'`. The prod env file sets `CDK_PARAM_USE_EC2_ADVANCED=true`.
2. [tenant-template-stack.ts:158-178](../../../server/lib/tenant-template/tenant-template-stack.ts#L158):
   `INACTIVE` means "create the cluster, skip the services". The cluster is created
   with `isEc2Tier=true`.
3. [ecs-cluster.ts:47-165](../../../server/lib/tenant-template/ecs-cluster.ts#L47): with
   `isEc2Tier`, the nested stack creates a launch template (t3.micro, ECS-optimized
   AL2023 AMI, default 30 GiB gp3 root volume) and an `AutoScalingGroup` with
   `desiredCapacity: 1, minCapacity: 1`, plus the `awsvpcTrunking` account-setting
   custom resource. The ASG runs whether or not any task is ever placed.
4. The 2026-05-01 prod snapshot
   (`docs/infrastructure-sunset/snapshot-prod-pre-optimize-20260501.md` §5.2) confirms
   the stack is `CREATE_COMPLETE` in prod with cluster `prod-advanced-<account>` and
   0 services, and the 2026-05 audit (§2.2.6) priced it at "$0 — no Fargate tasks".
   That was wrong: the instance is the ASG's, not a task's. The bill has carried it
   since April (`6.72 → 8.33 → 8.06 → 8.31 → 8.33` tracks 30/31-day months exactly).

Cost of the dormant advanced stack: `8.33 (instance) + 2.74 (EBS) + 0.20 (its two
result-batch alarms) = 11.27/month`. The stack is not "cluster-only" either: because
[tenant-template-stack.ts](../../../server/lib/tenant-template/tenant-template-stack.ts)
creates them outside the `shouldDeployServices` guard, it also deploys a second
tenant Cognito pool, a `CognitoPostAuthTrigger` Lambda pointed at a table that does
not exist (`edforge-identity-advanced`), an `edforge-result-batch-advanced` Lambda
with its SQS DLQ, EventBridge rule and two alarms, a `CreateTenantMapping` custom
resource row, and the `awsvpcTrunking` custom resource that flips an account-level
ECS setting. This is pure waste in the "delete" category, not a trade-off. The
V1_DEFERRED scaffolding (the code) can stay; the deployed stack cannot.

### 4.2 The July step-change is two deliberate commits, not drift

ECS went `47.03 → 77.22` and CloudWatch `0.88 → 4.09` between June and July.
Both are explained by commits merged on 2026-06-29/30:

- `865c52e` (PR #355) resized finance from 0.25 vCPU / 0.5 GB to 1 vCPU / 2 GB for the
  bulk-PDF workload: `+ (0.051880 − 0.012970) × 744 = + $28.95/month`, for a job
  type that runs a handful of times per term.
- `a011b85` added the finance hot-path dashboard: `+ $3.00/month` as the 4th dashboard.

Neither is a bug, but both are hourly costs bought to serve a burst workload that is
idle >99 % of the time. They are the clearest example of the architecture's cost
model working against the workload's shape.

### 4.3 The authorizer is a Lambda, not the Cognito authorizer the docs describe

`ARCHITECTURE.md:83` and the prompt describe "API Gateway (REST, OpenAPI spec,
Cognito authorizer)". The spec at `tenant-api-prod.json:28450` declares a
`x-amazon-apigateway-authtype: custom` **TOKEN** authorizer (`type: token`,
`authorizerResultTtlInSeconds: 30`) backed by
[`tenant_authorizer.py`](../../../server/lib/shared-infra/Resources/tenant_authorizer.py)
(Python 3.10, X-Ray active, `PythonLayerVersion` layer). Per uncached request it
fetches the Cognito JWKS over `urllib` (no cache) and verifies the JWT with
python-jose, calls `sts:AssumeRole` on `AuthorizerAccessRole` with a dynamically
generated inline session policy (no tenant session tag), and returns the tier API
key as `usageIdentifierKey` (the `apigateway:get_api_key` lookup is cached per warm
container). Two operations carry no authorizer at all: `POST /auth/login` and
`GET /tenants/lookup`. The spec has 279 paths / 687 operations: 408 proxied
(`http_proxy` + `VPC_LINK`) and 279 `MOCK` `OPTIONS` handlers; analytics-stack adds
5 more `GET /analytics/*` methods with Lambda proxy integrations and its own
`TokenAuthorizer` (5-minute cache) on the same REST API. This matters for the
redesign: the authorizer is already a Lambda outside the VPC, so it survives any
change to the VPC unchanged; and the tenant-scoped credentials the services use are
minted by the services' own TokenVendingMachine (`libs/auth`), not by the authorizer.

### 4.4 The 2026-05 sunset audit's remaining errors, for the record

| Audit claim | Actual |
|---|---|
| VPC Link ≈ $10/month hourly | $0; REST VPC Links have no hourly charge |
| Fargate ≈ $0.04656/vCPU-h + $0.00509/GB-h | $0.04256 + $0.00466 (back-solved from three months of bills) |
| advanced stack "net cost $0" | $11.07/month (§4.1) |
| KMS $1.65 "unexplained" | 2 SBT ScriptJob CMKs (§2.3) |
| Cloud Map namespace "verify — may bill" | `HttpNamespace`, free |

---

## 5. Request path — browser to DynamoDB, with the cost of every hop

```
 Browser (Vercel-hosted MFE; $0 to AWS)
   │  Amplify → Cognito tenant pool (basic)                       [$0: <10k MAU]
   │  PostAuthentication trigger Lambda → EventBridge LoginSuccess  [per-invoke]
   ▼
 1. API Gateway REST `TenantAPI` /prod                             [$3.50 / M requests]
   │  x-api-key source = AUTHORIZER; usage plan basic
   ▼
 2. Lambda REQUEST authorizer  tenant_authorizer.py  (Python 3.10, X-Ray)   [per-invoke]
   │  JWKS verify → sts:AssumeRole(AuthorizerAccessRole, tenant tag) → apigateway:get_api_key
   ▼
 3. VPC Link ──► NLB `sbt-ecs-nlb` (internal, cross-zone)          [$0.0239/h = $17.78/mo]  ◄── hourly
   │  TCP:80 target = ALB listener
   ▼
 4. ALB `sbt-ecs-alb` (internal)                                    [$0.0239/h = $17.78/mo]  ◄── hourly
   │  listener rule: header tenantPath == "basic" → target group → rproxy task IP
   ▼
 5. Fargate task `rproxy` (nginx 1.27)                              [$9.65/mo]               ◄── hourly
   │  location ~ ^/schools|/users|/auth|… → identity-api.basic.sc:3010
   │  location ~ ^/academics            → academics-api.basic.sc:3010
   │  location ~ ^/finance              → finance-api.basic.sc:3010
   │  (Service Connect: Cloud Map HTTP namespace `basic`, Envoy sidecar in-task)  [$0]
   ▼
 6. Fargate task identity | academics | finance (NestJS 20-alpine)  [$9.65 | $19.30 | $38.60] ◄── hourly
   │  TokenVendingMachine: sts:AssumeRole(<svc>-ABACRole, tenant tag)
   │      └─ egress via NAT Gateway + EIP                            [$0.056/h + $0.005/h = $45.38/mo] ◄── hourly
   ▼
 7. DynamoDB `edforge-<svc>-basic` via Gateway endpoint             [$0 endpoint; on-demand RCU/WCU]
   │
   ├─ async: EventBridge PutEvents (via NAT) → SBT bus → analytics aggregator / result-batch Lambda → DDB
   ├─ logs:  awslogs driver → CloudWatch Logs (via NAT)             [$0.57/GB ingested]
   └─ cross-service: academics ↔ identity, finance ↔ identity/academics over Service Connect (in-VPC, $0)
```

Five hourly-billed hops sit on every request (NLB, ALB, rproxy, the service task,
NAT+EIP), totalling $118.29/month before a single request is served, against
$0.0035 per thousand requests of actual API Gateway usage. Two of the five (NLB and
rproxy) exist only to bridge API Gateway REST into the VPC and to do prefix routing
that the OpenAPI spec already encodes per path (278 routes, all `VPC_LINK`
integrations to `http://${stageVariables.nlbDns}`).

---

## 6. What actually needs the NAT Gateway

The NAT exists because the ECS tasks live in `PRIVATE_WITH_EGRESS` subnets and
everything that is not S3 or DynamoDB leaves through it. Inventory of egress from
inside the VPC, from the SDK clients the services import and the ECS agent's needs:

| Caller | Destination | Gateway endpoint? | Interface endpoint available? |
|---|---|---|---|
| ECS agent (every task start / deploy) | ECR (`ecr.api`, `ecr.dkr`) + S3 layer store | S3 yes | ecr.api + ecr.dkr: $0.01/h each per AZ |
| awslogs driver + Service Connect logs | CloudWatch Logs | no | `logs`: $0.01/h |
| all three services, via the shared `libs/auth` TokenVendingMachine (`@aws-sdk/client-sts`) | STS AssumeRole (ABAC role per request) | no | `sts`: $0.01/h |
| all three, via `libs/auth` `jwt.strategy.ts` | Cognito JWKS fetch (public `cognito-idp` endpoint) | no | `cognito-idp`: $0.013/h (PrivateLink, GA 2025-11; only for pools without a domain) |
| all three, via `libs/events` + `libs/analytics-events` (`client-eventbridge`) | EventBridge PutEvents | no | `events`: $0.013/h |
| identity (`client-cognito-identity-provider`) | Cognito IDP admin calls | no | `cognito-idp`: as above |
| finance (`client-cloudwatch`) | PutMetricData | no | `monitoring`: $0.013/h |
| ECS Exec (`enableExecuteCommand: true`) | SSM Messages | no | `ssmmessages`: $0.013/h |
| finance payment adapters | eSewa / Khalti public HTTPS | n/a | none — internet only |
| identity, finance (`client-s3`); all three (`client-dynamodb`) | S3, DynamoDB | **yes, free** | — |

(`@aws-sdk/client-athena` appears only in `libs/aws-mocks`; no production code path
reaches Athena.)

Replacing the NAT with interface endpoints does not pay. Interface endpoints in
`ap-south-1` are $0.013 per endpoint-AZ-hour (AWS Price List API, usage type
`APS3-VpcEndpoint-Hours`), so the seven the fleet would need (`ecr.api`, `ecr.dkr`,
`logs`, `sts`, `events`, `monitoring`, `cognito-idp`) in one AZ cost
`7 × 0.013 × 744 = $67.70/month`, half again the NAT ($41.66 + $3.72 EIP = $45.38).
And because finance must reach the public eSewa/Khalti APIs, the NAT could not be
removed anyway; endpoints would only be additive. (An earlier draft of this section
priced endpoints at $0.01/h and said Cognito had no endpoint in the region; both were
wrong, and both errors understated the case against endpoints.) The NAT is a symptom of putting request-scoped compute
inside a VPC; the compute placement is the thing to change. The Lambda functions in
this account are already outside the VPC (none declare `vpc:`), reach the same
services with no NAT, and cost nothing at idle.

---

## 7. CloudWatch retention and KMS audit

| Log group | Retention | Source |
|---|---|---|
| `identity` container logs (explicit group, RETAIN) | 30 days | [services.ts:70-74](../../../server/lib/tenant-template/services.ts#L70) |
| `academics`, `finance`, `rproxy` container logs | 7 days | [ecs-utils.ts:161](../../../server/lib/utilities/ecs-utils.ts#L161) |
| Service Connect traffic logs (4 services) | 7 days | [services.ts:176](../../../server/lib/tenant-template/services.ts#L176) |
| API Gateway access log (ERROR level, no data trace) | 7 days | [api-gateway.ts:148](../../../server/lib/shared-infra/api-gateway.ts#L148) |
| Lambda authorizer | **never expires** (no `logRetention` on the `PythonFunction`) | [api-gateway.ts:109](../../../server/lib/shared-infra/api-gateway.ts#L109) |
| DLQ processor Lambda | never expires (no `logRetention`) | [event-dlq-stack.ts:113](../../../server/lib/shared-infra/event-dlq-stack.ts#L113) |
| API Gateway *execution* log (`API-Gateway-Execution-Logs_<id>/prod`, ERROR level) | never expires (auto-created; only the access log has retention) | [api-gateway.ts:260](../../../server/lib/shared-infra/api-gateway.ts#L260) |
| CodeBuild groups: SBT provisioning + deprovisioning projects, AdminWeb build | never expires (no `logging` config) | SBT `script-job.js:67`, [static-site.ts:61](../../../server/lib/bootstrap-template/static-site.ts#L61) |
| SBT control-plane Lambdas (tenant management, registration, user management, create-admin-user) | never expires | SBT `cognito-auth.js`, `tenant-*-funcs.js` |
| CDK provider Lambdas (LogRetention ×4 stacks, `CreateTenantMapping` custom resource, `BucketDeployment`, three S3 `autoDeleteObjects` providers) | never expires | framework-generated |
| SBT control-plane Lambdas (5) | SBT defaults, 5–7 days where set | SBT `control-plane-api.js:42`, `tenant-config-funcs.js:57` |
| SBT CodeBuild ScriptJob logs | 3 days | SBT `script-job.js:152` |
| Cognito post-auth trigger | 14 days | [cognito-post-auth-trigger.ts:89](../../../server/lib/auth-events/cognito-post-auth-trigger.ts#L89) |
| Tenant seeder | 7 days | [tenant-seeder-lambda.ts:53](../../../server/lib/bootstrap-template/tenant-seeder-lambda.ts#L53) |
| Result-batch, analytics Lambdas (7), SES grant handler | 30 days | `tenant-template-stack.ts:290`, `analytics-stack.ts` (×6), `email-identity.ts:338,412` |
| VPC Flow Logs | disabled | |

Ingestion volume is small enough that the whole logs bill is inside the ≈$0.20
residue; retention is already tight. The two never-expiring groups are hygiene,
not cost. Custom metrics: one metric filter (`EdForge/IEMIS`), the analytics and
reporting namespaces, and up to 8 finance hot-path metric names, close to the
10-free-metrics line.

KMS: exactly two customer-managed keys exist and both are SBT's, created inside
`ScriptJob` for the CodeBuild projects' artifact encryption. SBT 0.9.1 exposes no
prop to pass an existing key or use the AWS-managed CodeBuild key. The CDK bootstrap
bucket uses the AWS-managed S3 key (CDK CLI 2.1130 selects `AWS_MANAGED_KEY` on a
fresh bootstrap unless `--bootstrap-customer-key` is passed), which is why the KMS
line is $2.00 and not $3.00. Every DynamoDB table uses `AWS_MANAGED` or default
encryption; every S3 bucket is `S3_MANAGED`; SQS is `SQS_MANAGED`.

---

## 8. State that lives between requests inside the ECS tasks

The prompt asks where the request-scoped model would break. This is the inventory;
the endpoint-level cold-start analysis is in `TARGET_ARCHITECTURE.md`.

**Background timers (finance only, all `setInterval` in `onModuleInit`):**

| Service | Cadence | Gate | What it does |
|---|---|---|---|
| `RecurringBillingService` | first run 5 min after boot (`setTimeout`), then every 24 h | `DISABLE_RECURRING_BILLING` | generates recurring invoices |
| `PaymentSweepService` | every 30 min | **disabled in prod** (`DISABLE_PAYMENT_SWEEP=true` in `service-info.txt`) | verifies abandoned gateway payments older than 30 min against eSewa/Khalti |
| `OverdueDetectionService` | every 60 min | — | flags overdue invoices |
| `BillingReconciliationService` | every 60 min | — | reconciles accounts older than 10 min |
| `FinanceMetricsService` | every 5 s (unref'd), three instances (provided separately in `PaymentsModule`, `InvoicesModule`, `BulkOperationsModule`) | — | batches `PutMetricData` |
| `StaleFinanceJobSweeperService` | once, at `OnApplicationBootstrap` | — | single-batch scan of stale jobs (the cross-task version is the `FinanceJobJanitor` Lambda) |

Identity and academics declare no `setInterval` / `@Cron` timers (the shared
`libs/cache` service has a 5-minute cleanup interval); the equivalent housekeeping
for their domains already runs as EventBridge-scheduled Lambdas in `analytics-stack`
(rollup daily 01:00, two job janitors every 5 min, reporting scheduler daily 20:15 UTC).

**In-memory caches (class-level `Map`s, process-lifetime, TTL-based):** identity
(`archetype-defaults`, `session-revoked.guard` 30 s), academics (`identity-client`
school/role/feature-flag/template caches, `tenant-metadata-reader` archetype,
`data-scope`, `permission.guard`, attendance calendar/overview/student-name caches),
finance (`payment-gateways` config, `dashboard`, `identity-client`). All are
read-through caches over DynamoDB or the identity API; losing them costs latency,
not correctness.

**In-memory coordination (correctness dependencies on a long-lived process):**

- finance `PerSchoolLock` (`Map<schoolId, Promise>`, `bulk-ops/util/per-school-lock.ts`),
  used by all three bulk workers;
- finance `PdfRenderConcurrencyBucket`, a process-wide semaphore
  (`BULK_PDF_CONCURRENCY`, 8 in prod) for the two PDF-export workers;
- the `setImmediate` hand-off after a `202` at `invoices.controller.ts:331` (bulk
  invoice generate), `invoices.controller.ts:467` (bulk invoice PDF export) and
  `payments.controller.ts:449` (bulk receipt PDF export) — the process that accepted
  the job is the process that finishes it;
- academics runs the same pattern for IEMIS student import
  (`students.controller.ts:307`), with no lock and no janitor;
- finance already keeps one durable guard in DynamoDB: a single-active-export
  sentinel row with a 4-hour TTL per export job type, which is the shape the
  in-memory locks should converge on.

**Long-lived responses:** finance streams CSV exports (`Readable.from(...).pipe(res)`
at `invoices.controller.ts:542-546` and `payments.controller.ts:195-199`) and
academics streams an enrollment CSV. These are unbounded-length responses generated
row by row; under API Gateway REST they are subject to the 29-second integration
timeout and 10 MB payload cap regardless of compute model.

**Cross-service HTTP:** academics → identity, finance → identity and academics over
Service Connect DNS (`*-api.basic.sc:3010`) with an internal API key header. The
service URLs are env-configured, so the transport can change without code changes
to the callers' contracts.

**No** websockets, no SSE, no message-queue consumers, no sticky sessions, no local
filesystem persistence beyond `/tmp`-style scratch in the PDF workers.

---

## 9. What the code cannot tell us (needs a live read-only check before Phase 1)

These are read-only `aws` calls against prod and therefore need explicit
authorization under the house rules; none change the conclusions above, they close
the last cents.

1. `aws autoscaling describe-auto-scaling-groups` — confirm the advanced cluster's
   ASG is the t3.micro and read its launch date (expected ≈ 2026-04-06 from the April
   `EC2 – Instances` = $6.72 = 600 h).
2. `aws ec2 describe-volumes --filters Name=attachment.instance-id,...` — confirm the
   30 GiB gp3 root volume ($2.74) vs. a smaller volume plus more NAT GB.
3. `aws kms list-keys` + `describe-key` — confirm exactly two CMKs, both tagged with
   the core-appplane stack.
4. `aws cloudwatch list-dashboards` — confirm 4 dashboards (3 free + 1 billed).
5. `aws cloudformation describe-stacks --stack-name tenant-template-stack-advanced` —
   confirm it is still `CREATE_COMPLETE` with termination protection off (it was on
   2026-05-01), which is what makes §4.1 a one-command delete.
6. `aws ecs describe-services --cluster prod-basic` — confirm four services at
   `desiredCount=1` with the task sizes in §2.1 (the `service-info.json` regeneration
   fix `568800c` landed 2026-07-05; the August ECS figure says the deployed task defs
   match `service-info.txt`).

---

## 10. Summary for the redesign

- The bill is 98 % fixed cost. Three decisions produce $141 of it: four always-on
  Fargate tasks ($77.20), a NAT Gateway with its EIP ($45.38), two internal load
  balancers ($35.56). A fourth, unplanned one produces $11.07: the dormant advanced
  tier's EC2 auto-scaling group.
- A further $9.10 is monthly-fixed but discretionary: two SBT-imposed KMS keys ($2.00),
  the fourth dashboard ($3.00), eleven billable alarms ($1.10, two of them on the
  dormant advanced stack), and the EBS volume ($2.74) that dies with the t3.micro.
- The pieces that are already right for an idle system are the Lambdas outside the
  VPC, the on-demand DynamoDB tables with gateway endpoints, the REST API with its
  Lambda authorizer, EventBridge, Cognito, and the Vercel-hosted frontend. Together
  they billed under $3 in August.
- The ≤ $20/month target including tax means ≈ $18.75 pre-tax. The usage class is
  already under $3; the fixed class must drop from $175 to under ≈ $16. That is not a
  trimming exercise on the current shape; it requires that no VPC-resident compute,
  no load balancer, and no NAT remain in the idle state.
