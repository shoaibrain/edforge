---
title: EdForge Infrastructure Sunset & Cost Optimization — Audit Report
date: 2026-05-01
scope: us-east-2 (715860911762, profile=uat) teardown + ap-south-1 (257526644020, profile=prod) cost optimization
---

# 1. Executive Summary

EdForge currently runs two independent full-stack deployments in two AWS accounts and two regions. The original UAT/dev deployment in `us-east-2` (account `715860911762`, profile `uat`) holds only rehearsal data and is slated for complete teardown. The Nepal pilot production deployment in `ap-south-1` (account `257526644020`, profile `prod`) must be kept live and brought from ~$201/month down to ≤$100/month (stretch ≤$80/month) without impacting pilot tenant data.

**Combined current monthly burn:** ~$413 (uat $212 + prod $201).
**Target steady-state monthly burn:** ≤$100 (single-region prod, optimized).
**Realizable runway recovered:** ~$3,750/year on infrastructure alone, based on a $313/month delta sustained for 12 months.

**Phase fit:** EdForge is pre-revenue and operating a partner-school pilot. This shapes every trade-off in this audit. Multi-AZ NAT redundancy, WAF, prod-grade observability instrumentation, and HA scale-out patterns are not yet justified. They become justified post-PMF and the CDK code is structured so they can be re-enabled by changing a parameter rather than rewriting.

## Headline findings

1. **The single largest cost driver is NAT egress.** The shared VPC defaults to one NAT Gateway per AZ across 3 AZs, costing roughly $96/month before any data processing. Reducing to one NAT Gateway plus free Gateway Endpoints for DynamoDB and S3 alone closes most of the gap to the $100/month target.
2. **The dual-LB architecture (NLB → ALB) is a constraint of API Gateway REST API VPC Link, not a free design choice.** Migrating to API Gateway HTTP API removes the NLB at the cost of a non-trivial refactor of the Lambda authorizer and the OpenAPI spec. Defer to post-pilot.
3. **`DestroyPolicySetter` is correctly NOT applied to tenant-template-stack.** Per-resource `RemovalPolicy.RETAIN` on DynamoDB tables is the intentional source of truth, documented inline at `ecs-saas-ref-template.ts:225-228`. This significantly de-risks both the prod optimization plan and any inadvertent stack-deletion incident, but does not remove the need for stack-level `terminationProtection` (currently NOT enabled).
4. **The cleanup script suite has no account/region/profile guards.** A developer with both `uat` and `prod` profiles configured can destroy production by running `AWS_PROFILE=prod ./scripts/cleanup/cleanup.sh`. Fixing this is non-negotiable Phase 0 work.
5. **The aws-nuke configuration is unusable.** It targets a foreign account (`346698404105`) in `us-east-1` (a region EdForge has never used), is missing the `finance` ECR repo, and the DynamoDB filter does not match any current EdForge table name. Recommend tearing down via the existing `cleanup.sh` (after hardening) instead of regenerating the aws-nuke config.
6. **Frontend `.env.local` files in `edforge-saas-frontend/apps/*/` hardcode the UAT API Gateway URL and the UAT Cognito pool.** After us-east-2 teardown these files point at deleted infrastructure. Local development against UAT-shaped URLs will silently fail. These are not Vercel-deployed envs (Vercel reads from project settings), but they are the local-dev source of truth.
7. **More than 40 smoke-test scripts hardcode `*.execute-api.us-east-2.amazonaws.com` URLs.** Some have an env-var override; many do not. After teardown, every smoke test that lacks an override will fail by hitting a 503/no-such-host. Repointing to ap-south-1 is part of teardown hygiene, not a follow-up.
8. **`scripts/cleanup/aws-nuke-setup.sh` and `scripts/cleanup/delete-remaining-stacks.sh` reference a foreign account `346698404105`.** This account is not in EdForge's organization. The references are stale residue from another project. They must be removed regardless of whether the scripts are reused.

## Confidence on the $100 target

The $100/month target is achievable with high confidence using only the safe optimizations (Phase 1 of the execution plan): single NAT Gateway, DynamoDB+S3 Gateway Endpoints, log-retention reduction, ECR lifecycle, and (optionally) ECS scheduled scale-to-zero overnight in NPT. The NLB/HTTP-API migration is held in reserve as a post-pilot optimization if prod traffic grows and the $100 target slips.

---

# 2. Resource Inventory

## 2.1 us-east-2 (account 715860911762, profile=uat)

This is the teardown target. Structurally identical to ap-south-1 — same CDK stacks, same services, same DynamoDB tables — but with no production tenant data. All numbers below are roughly equivalent to the ap-south-1 inventory in §2.2 and double-published here only where the inventory differs (e.g. the `edforge-pilot-rehearsal.ts` orchestrator was UAT-only).

After teardown is verified by zero daily AWS spend over 7+ days, this account stays as an empty AWS Organizations management account. It cannot be closed while the org exists. It can be left as a near-zero-cost shell.

## 2.2 ap-south-1 (account 257526644020, profile=prod) — keep & optimize

### 2.2.1 shared-infra-stack

| Resource (logical id) | Type | Cost driver | Monthly est. (ap-south-1) | Notes |
|---|---|---|---|---|
| VPC `EcsVpc` | VPC, /16 | none | $0 | 3 AZs configured; private + public subnets per AZ |
| NAT Gateways (default) | NAT GW | hourly + per-GB | ~$96 | One per AZ; `natGateways` parameter NOT explicitly set in `shared-infra-stack.ts:66-87` so CDK defaults to one-per-AZ |
| EIPs for NATs | EIP | implicit | included | One per NAT, attached, so not separately billed |
| ALB `sbt-ecs-alb` | ALB | hourly + LCU | ~$17 | Internal-only, port 80 (no TLS termination at ALB) |
| NLB `sbt-ecs-nlb` | NLB | hourly + NLCU | ~$17 | Cross-zone enabled; targets ALB listener via `AlbListenerTarget` |
| API Gateway VPC Link | VPCLink | hourly | ~$10 | Required by REST API; targets NLB |
| API Gateway REST API `TenantAPI` | REST API | per-request | ~$1 | Spec from `tenant-api-prod.json`; `apiKeySource = AUTHORIZER` |
| Lambda authorizer | Lambda Python 3.10 | per-invoke | <$0.50 | X-Ray ACTIVE; layered with `LambdaEcsSaaSLayers`; CORS handled in code |
| Tier API keys (3) | API Gateway API Keys | none | $0 | Stored in SSM Parameter Store |
| Usage plans (3 tiers) | UsagePlan | none | $0 | Basic/Advanced/Premium throttling/quotas |
| `TenantMappingTable` DDB | DDB on-demand | per-request | ~$1 | PITR ENABLED; `RemovalPolicy.RETAIN` |
| AdminWeb CloudFront | CF distribution | per-GB + per-request | ~$2 | Origin = AdminWeb S3 bucket; access logs to `AccessLogsBucket` |
| AdminWeb S3 origin bucket | S3 | per-GB | <$1 | `RemovalPolicy.DESTROY`, `autoDeleteObjects:true` (via StaticSiteDistro) |
| `AccessLogsBucket` | S3 | per-GB | ~$1–5 | Receives ALB/NLB/CF logs; `LOG_DELIVERY_WRITE` ACL; `RemovalPolicy.DESTROY` |
| VPC Flow Logs | CW Logs | per-GB ingest+store | ~$15–30 | `FlowLogTrafficType.ALL`; **no retention configured** → never expires |
| API Gateway access logs | CW Logs | per-GB | ~$2–5 | 7-day retention (set explicitly in `api-gateway.ts:114`) |

### 2.2.2 controlplane-stack

| Resource | Type | Cost driver | Monthly est. | Notes |
|---|---|---|---|---|
| SBT ControlPlane EventBus | EventBridge custom bus | per-event | <$0.50 | Wired to AdminWeb-driven onboarding |
| Cognito system-admin pool | Cognito User Pool | MAU > 50k | $0 | Single-digit operator users; deletion protection NOT set |
| ControlPlane API Gateway | REST API | per-request | <$0.50 | Backed by Cognito-authenticated AdminWeb |
| TenantSeeder Lambda | Lambda | per-invoke | <$0.10 | Inline handler stringified at CDK synth time from `packages/shared-types/src/locale/tenant-locale-defaults.ts` |
| AdminWeb StaticSite | CodePipeline + CodeBuild + S3 + CF | mixed | ~$2–4 | Pipeline rebuilds AdminWeb on every controlplane redeploy |
| EventDLQ (sub-stack) | SQS DLQ + alarm | per-message | <$0.50 | Captures failed event routing |

### 2.2.3 analytics-stack (deployed in prod, `CDK_PARAM_ANALYTICS_ENABLED=true`)

| Resource | Type | Cost driver | Monthly est. | Notes |
|---|---|---|---|---|
| Aggregator Lambda | Lambda Node.js | per-invoke | <$0.50 | `RetentionDays.ONE_MONTH` log retention (`analytics-stack.ts:191`) |
| Rollup Lambda | Lambda | per-invoke | <$0.50 | ONE_MONTH retention (`analytics-stack.ts:630`) |
| Analytics API Lambda | Lambda | per-invoke | <$0.50 | ONE_MONTH retention (`analytics-stack.ts:813`) |
| Analytics DDB table | DDB on-demand | per-request | ~$1 | PITR ENABLED; `RemovalPolicy.RETAIN` |
| EventBridge rules (2) | rules | per-event | <$0.10 | `edforge-analytics-native` + `edforge-domain-events`; custom-bus rules carry no per-rule monthly fee, only $1/M events. At pilot volume this is sub-cent. |
| Glue + Athena workgroup | Glue catalog + Athena | per-query | <$1 | Free at idle |
| Operator alerts SNS topic | SNS | per-message | <$0.10 | Email subscription to `CDK_PARAM_OPERATOR_TOPIC_ARN` |

### 2.2.4 core-appplane-stack

| Resource | Type | Cost driver | Monthly est. | Notes |
|---|---|---|---|---|
| ProvisioningScriptJob (CodeBuild) | CodeBuild | per-build-minute | ~$0.05/tenant | Runs `provision-tenant.sh`; reads source tarball from S3 |
| DeprovisioningScriptJob (CodeBuild) | CodeBuild | per-build-minute | <$0.05/tenant | Runs `deprovision-tenant.sh` |
| Provisioning failure alarms + SNS | CloudWatch alarms + SNS | per-alarm | $0 | Free tier covers <10 alarms |
| Source tarball S3 bucket | S3 | per-GB | <$1 | Built by `scripts/utils/update-provision-source.sh` |
| **Aspect: `DestroyPolicySetter`** | CDK Aspect | n/a | n/a | Applied to this stack at `ecs-saas-ref-template.ts:145` — **safe**, this stack contains no business data |

### 2.2.5 tenant-template-stack-basic

This is the per-tenant stack, instantiated once for the BASIC tier. Holds all pilot-school data.

| Resource | Type | Cost driver | Monthly est. | Notes |
|---|---|---|---|---|
| ECS cluster `prod-basic` | ECS cluster | none | $0 | Container Insights DISABLED (`ecs-cluster.ts:46`) |
| CloudMap HTTP namespace | servicediscovery namespace | hourly | **VERIFY before Phase 3** | Per-tenant namespace, used by ECS Service Connect at `tenant-template-stack.ts:151-153`. HTTP namespaces created by Service Connect for ECS are typically free; private DNS namespaces would be ~$0.50/hosted-zone/month. Confirm with `aws servicediscovery list-namespaces --profile prod` before Phase 3 — if a billable type is in use, factor it into the projection. |
| identity service | Fargate, 256 CPU / 512 MB, **2 tasks** | per-vCPU-hr | ~$21 | desiredCount=2 (critical-path); ap-south-1 Fargate ≈ $0.04656/vCPU-hr + $0.00509/GB-hr |
| academics service | Fargate, **512 CPU / 1024 MB**, 1 task | per-vCPU-hr | ~$21 | Only service with elevated resources |
| finance service | Fargate, 256 CPU / 512 MB, 1 task | per-vCPU-hr | ~$10 | desiredCount=1 |
| rproxy service | Fargate, 256 CPU / 512 MB, **2 tasks** | per-vCPU-hr | ~$21 | NGINX reverse proxy, 2 tasks for HA |
| `edforge-identity-basic` DDB | on-demand | per-request | ~$2 | PITR ENABLED, `RemovalPolicy.RETAIN`, TTL on `ttl` attr; GSI1, GSI2, GSI7, GSI8 active |
| `edforge-academics-basic` DDB | on-demand | per-request | ~$3 | PITR ENABLED, RETAIN, TTL; GSI1–GSI6 active |
| `edforge-finance-basic` DDB | on-demand | per-request | ~$1 | PITR ENABLED, RETAIN, TTL; GSI1–GSI6 active |
| Tenant Cognito User Pool | Cognito | MAU > 50k | $0 | Per-tenant pool; deletion protection NOT set |
| Cognito post-auth Lambda | Lambda | per-invoke | <$0.10 | Emits LoginSuccess to SBT bus |
| ECS service log groups | CW Logs | per-GB | ~$2–3 | identity = ONE_MONTH (IEMIS audit metric filter); academics/finance/rproxy default to ONE_WEEK |
| Service Connect traffic logs | CW Logs | per-GB | ~$1 | ONE_MONTH retention per `services.ts:166` |
| ABAC tenant-isolation roles | IAM | none | $0 | Created per-tenant by `ecs-dynamodb.ts` |

### 2.2.6 What is NOT deployed

These resources are written in CDK but currently consume zero cost in ap-south-1:

- **`tenant-template-stack-advanced`** is synthesized but not instantiated against production traffic. There is no advanced-tier tenant. The CDK file `bin/ecs-saas-ref-template.ts:203-220` constructs the stack template; the conditional logic in `tenant-template-stack.ts:106-113` (`isAdvancedTier && isAdvancedActive`) means no services are created. The advanced Cognito pool was an issue in earlier drafts but has been gated. **Net cost impact: $0.**
- **WAF.** Zero matches for `WebACL`/`wafv2`/`Waf` across `server/lib`. The ALB and AdminWeb CloudFront are unprotected at L7. At pilot scale this is acceptable.
- **VPC Endpoints.** Zero matches for `InterfaceVpcEndpoint`/`GatewayVpcEndpoint`. All ECS task egress to AWS services (DDB, ECR, S3, Cognito, STS, Logs) traverses NAT Gateway today. Adding the **two free Gateway Endpoints** for DynamoDB and S3 is one of the easiest wins on the table.
- **Container Insights.** Disabled in `ecs-cluster.ts:46` ("~$15-20/month for development is cost-prohibitive"). Keep disabled; revisit at scale.
- **Cognito Advanced Security.** Disabled per `identity-provider.ts:21` ("OFF is default"). Keep disabled until reaching a customer-facing security review.

## 2.3 Combined cost model (ap-south-1, current)

The user's reference number is ~$201/month from Amazon Q. Bottom-up inventory at ap-south-1 list pricing (revised after reviewer correction — earlier draft used per-task figures roughly 2× the actual ap-south-1 Fargate rates):

- NAT Gateways (3 × ~$32.85): **~$96**
- Load balancers + VPC Link (ALB ~$18 + NLB ~$17 + VPCLink ~$10): **~$45**
- ECS Fargate (6 tasks across 4 services, sized per §2.2.5): **~$72**
- VPC Flow Logs (`ALL` traffic, no retention): **~$15–30**
- All else (DDB, CW Logs, AdminWeb, API GW, Lambda, EventBridge, S3): **~$10–15**

Bottom-up total: **~$240/month at list price.** Cost Explorer reads ~$201/month. The $40 delta is consistent with EBS bursting credits, free-tier residue (Cognito MAU under 50k, Lambda invocations under 1M, CloudWatch dashboards under 3), and the fact that VPC Flow Logs ingestion has been spiky.

**Action item before Phase 3:** Pull the last-30-day Cost Explorer breakdown for account `257526644020` filtered to ap-south-1 and reconcile against this inventory. If the realized number is materially different from $201, the savings projections in §7 must be re-anchored.

The implication is unchanged: even with NAT and LB cost reduced, Fargate is the second-largest line item. The $100 target requires reducing Fargate footprint as well — the execution plan addresses this in Phase 3.2 (drop the identity and rproxy HA pairs at pilot scale) and optionally Phase 3.3 (overnight scale-to-zero).

---

# 3. Dependency Map

## 3.1 Cross-region

There are no cross-region resource dependencies in either deployment. Concrete confirmation:

- All region references in `server/lib` are dynamic (`cdk.Stack.of(this).region`) except for two strings that are templated, not hardcoded: the Cognito well-known endpoint at `tenant-template-stack.ts:287` and the OpenAPI spec placeholders in `tenant-api-prod.json` substituted at `api-gateway.ts:133-134`.
- No CloudFront ACM certificate is configured (CloudFront uses the default `*.cloudfront.net` cert). If a custom domain is added later, the cert MUST be issued in `us-east-1` — but no such cert exists today, so no `us-east-1` dependency.
- No DynamoDB Global Tables. No cross-region replication. No Route 53 hosted zones.

**Conclusion:** us-east-2 teardown does not break any ap-south-1 resource.

## 3.2 Cross-account

Two distinct AWS accounts (`715860911762`, `257526644020`) under one AWS Organizations parent. There are no cross-account IAM trusts, no shared VPCs (no Resource Access Manager shares), no cross-account CodePipeline source/deploy actions. ECR images are pushed to each account independently by `scripts/build-application.sh`.

**Conclusion:** us-east-2 teardown does not break any ap-south-1 resource and does not affect any other AWS account.

## 3.3 Cross-stack (within prod ap-south-1)

The dependency order from `bin/ecs-saas-ref-template.ts:19-25` and the explicit `addDependency` calls:

```
shared-infra-stack
  ├── controlplane-stack
  │     └── analytics-stack
  │           └── core-appplane-stack
  └── tenant-template-stack-basic
```

- `shared-infra-stack` exports VPC ID, private subnet IDs, AZs, ALB listener ARN, ALB SG ID via `cdk.Fn.importValue`.
- `controlplane-stack` provides `eventBusName`, `auth`, and `regApiGatewayUrl` to downstream as constructor props.
- `analytics-stack` consumes `eventBusName` from controlplane.
- `core-appplane-stack` depends on analytics for ordering only; does not import its outputs.
- `tenant-template-stack-basic` depends only on shared-infra; runs in parallel with controlplane.

**Implication for the optimization plan:** Most of the optimization work touches `shared-infra-stack` (VPC + LB) and `tenant-template-stack-basic` (ECS task counts, log retention). These can be deployed independently in either order. NAT-Gateway changes inside `shared-infra-stack` will require ECS tasks to re-establish outbound connections; ECS will retry automatically.

## 3.4 Frontend dependencies

`edforge-saas-frontend/` is deployed by Vercel from git, not by CDK. Its production env (Vercel project settings) reads `API_BASE_URL` and Cognito coordinates separately from local `.env.local` files. The `.env.local` files in `apps/shell/`, `apps/academics/`, etc., are local-dev overrides only. **They still must be updated** because they currently point at us-east-2 endpoints that will be deleted (developers will silently get 503s in local dev otherwise).

`client/AdminWeb/` is deployed by `controlplane-stack`'s CodePipeline, not via direct S3 sync. Its bundle is written by CodeBuild from source zipped at synth time. AdminWeb uses CFN exports from `controlplane-stack` for its config; no env file changes needed in this directory.

---

# 4. Cleanup Tooling Assessment

The repo carries seven cleanup-related files under `scripts/cleanup/`. Status of each:

| File | Status | Recommendation |
|---|---|---|
| `cleanup.sh` | **Reusable AFTER hardening.** Functionally proven across two prior teardown cycles. Critical safety gap: no account/region/profile guard. | **Harden, then reuse for the us-east-2 teardown.** |
| `cleanup-cloudfront.sh` | Reusable after hardening. Tag-based filter on `SaaSFactory=ECS-SaaS-Ref` is correct for EdForge CDK constructs. | **Add account guard, then reuse.** |
| `cleanup-cognito.sh` | Reusable after hardening. Same tag filter. | **Add account guard, then reuse.** |
| `cleanup-secrets.sh` | **Dead code.** Targets the `rds_proxy_multitenant` pattern from the upstream SBT reference architecture. EdForge uses no RDS. | **Delete. Or, if kept, comment-out and add a TODO for the day it's needed.** |
| `aws-nuke-setup.sh` | **Stale and unsafe.** Hardcoded account `346698404105`, region `us-east-1`, profile `dev` — none of which apply to EdForge. ECR filter omits the `finance` repo. DynamoDB filter pattern matches no current EdForge table. Account blocklist is a placeholder (`999999999999`). | **Do not regenerate from this file. If aws-nuke is ever needed, write a fresh config from scratch.** Recommend: tear down with hardened `cleanup.sh` only. |
| `README-AWS-NUKE.md` | Documents the stale config. References `AWS_PROFILE=dev`. | **Mark "ARCHIVED" or delete.** |
| `delete-remaining-stacks.sh` | References stale account `346698404105` and region `us-east-1` in IAM role ARN at line 107. Defaults `AWS_PROFILE=dev`. | **Delete or rewrite. Pattern (handling DELETE_FAILED stacks via `--retain-resources`) is useful but config is unusable.** |

## 4.1 The single most dangerous failure mode

`cleanup.sh` derives both account and region from the current shell environment:

```
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws ec2 describe-availability-zones --output text ...)
```

There is **no validation** that the resolved account is the intended target. The user-confirmation prompt is the only gate, and it can be bypassed with `SKIP_CONFIRM=true`.

**Operator workflow risk:** A developer running `unset AWS_PROFILE; ./scripts/cleanup/cleanup.sh` (or any session where `AWS_PROFILE=prod` was last set) will destroy the production deployment. The `cleanup.sh` script will not warn, prompt differently, or refuse. The same risk applies to `cleanup-cloudfront.sh`, `cleanup-cognito.sh`, and `delete-remaining-stacks.sh`.

This is the highest-priority item in the entire plan and must be fixed in Phase 0 before any teardown step is attempted.

## 4.2 Resource-coverage gaps in `cleanup.sh`

Even after hardening, `cleanup.sh` has the following coverage gaps to be aware of (most are caught by `cdk destroy --all --force` mid-script, but documented here for verification):

- **No explicit DynamoDB cleanup.** Tables are deleted only via the CDK stack delete chain. Tables with `RemovalPolicy.RETAIN` survive — this is correct in production, but in us-east-2 teardown the tables MUST be explicitly removed since no production data is on them. Add an explicit DDB delete pass at the end.
- **S3 bucket-name patterns** (`tenant-update-stack-*`, `controlplane-stack-*`, `core-appplane-*`, `saas-reference-architecture-*`, `shared-infra-stack-*`) cover all known buckets but do not include any analytics-export bucket if one were ever added under a different naming prefix. Verify with `aws s3 ls` after the script completes.
- **CloudWatch log-group prefixes** cover the documented set, but Service Connect traffic log groups and Cognito post-auth Lambda log groups use service-name prefixes that may not match the stack-name patterns. Verify with `aws logs describe-log-groups` after the script completes.
- **SSM parameter cleanup** matches `apiKey*` only — sufficient for the API key parameters but not for any future CDK-introduced parameters.
- **Cognito wildcard name patterns** (`*UserPool*`, `*basicUserPool*`) are overly broad. In a single-tenant account this is fine, but the tag-based path in `cleanup-cognito.sh` is the safer default.

## 4.3 Recommended teardown approach for us-east-2

Use **hardened `cleanup.sh`** plus a thin wrapper script. Do **not** use aws-nuke. Reasons:

1. `cleanup.sh` is functionally proven across two prior teardown cycles in this repo. The only thing wrong with it is the absence of safety guards.
2. `aws-nuke` is powerful but its config is wrong for EdForge today. Regenerating it correctly costs more time than hardening `cleanup.sh`.
3. The "stuck CloudFormation stacks" pattern in `delete-remaining-stacks.sh` is a useful manual fallback for `DELETE_FAILED` cases. Keep it as a reference but rewrite it once with current account/region.

---

# 5. Risk Register

The entries below are ordered by the magnitude of consequence, not by likelihood. All risks are pilot-relevant; this is not a generic SaaS risk register.

| ID | Risk | Likelihood | Consequence | Mitigation |
|---|---|---|---|---|
| R1 | Operator runs hardened-but-untested cleanup script with `AWS_PROFILE=prod` and destroys pilot tenant data | Low (after Phase 0) | **Catastrophic** — total data loss; pilot ends | Hardened `cleanup.sh` MUST refuse account `257526644020`, region `ap-south-1`, and profile `prod` via explicit blocklist (defense-in-depth). Cognito and CloudFront cleanups must inherit the same guard. |
| R2 | NAT Gateway reduction from 3→1 lands in an AZ that later has a regional outage during pilot | Very low | Brief egress outage for ECS tasks until manual NAT recreation in another AZ | Document the recovery procedure; pilot tolerance for ~1 hour outage is high; risk acceptable. |
| R3 | rproxy elimination misroutes traffic, returns 404 to real tenant traffic | Medium if attempted before pilot launch | API outage until rolled back | Defer to post-pilot. The current dual-LB-plus-NGINX path has a long uptime track record. |
| R4 | API Gateway REST→HTTP migration breaks Lambda authorizer (payload format changes from v1 to v2) | High if attempted during pilot | API outage until rolled back | Defer to post-pilot entirely. Not in scope of Phase 1–3. |
| R5 | Frontend `.env.local` files left pointing at deleted us-east-2 endpoints | Certain unless updated | Local dev silently broken; smoke tests fail | Update before us-east-2 teardown completes (Phase 5). |
| R6 | Smoke tests fail after teardown because of hardcoded us-east-2 base URLs | Certain for tests without env-var override | Pilot validation broken; CI red | Audit and convert all hardcoded URLs to env-var-driven (Phase 5). |
| R7 | Tenant-template-stack accidentally `cdk destroy`'d while `RemovalPolicy.RETAIN` is intact | Low | DDB tables survive but Cognito pool, ECS cluster, IAM roles, etc., are destroyed → tenants cannot log in even though their data still exists | Enable `terminationProtection:true` on prod stacks (Phase 0). |
| R8 | `DestroyPolicySetter` mis-applied to tenant-template-stack in a future PR | Low | Catastrophic — overrides per-resource RETAIN, deletes DDB tables on stack delete | **Already mitigated** — explicit comment block at `ecs-saas-ref-template.ts:225-228` warns against re-enabling. Keep that comment intact in any refactor. Add a unit test? — out of scope. |
| R9 | Cognito tenant pool deleted accidentally; tenant users locked out even though DDB data is intact | Medium | Pilot users cannot log in until pool restored from backup | Set `deletionProtection: true` on tenant Cognito pools (Phase 0). |
| R10 | aws-nuke run by an operator who reads README-AWS-NUKE.md and copy-pastes the stale config against the wrong account | Low | Catastrophic if the resolved account happens to be `prod` (it won't, since the config has `346698404105`, but the resource filters are loose enough that confusion is plausible) | Delete or archive aws-nuke files entirely (Phase 0). |
| R11 | Foreign account `346698404105` in `delete-remaining-stacks.sh` and `aws-nuke-setup.sh` triggers operator confusion | Low | Time wasted, possible escalation | Remove all references (Phase 0). |
| R12 | A `--retain-resources` fallback during teardown leaves resources orphaned in us-east-2; charges continue | Medium | Leaks ~$10–50/month against a torn-down account | Phase 1 verification step: zero daily AWS spend in us-east-2 over 7 days post-teardown; investigate any leak. |
| R13 | Vercel previews deployed against retired UAT API endpoints fail silently | Medium | PR previews 503 | Update Vercel project env vars during Phase 5. |
| R14 | Container Insights or other "production-grade" toggle re-enabled by future PR without budget review | Medium | $15–30/month creep per toggle | Enforce via PR-review checklist; no automated mitigation. |
| R15 | Cognito post-auth trigger Lambda for the BASIC tenant pool is currently named per-tier and would break if pool is recreated under a different name during cost-optimization rolling deploy | Low | Login-event analytics drop temporarily | Test in UAT-ish bench (one of the spare DDB rows) before applying. UAT is being torn down so this regression cannot be pre-verified — keep this risk in mind during deploy. |

---

# 6. Critical Findings

These findings carry consequences large enough to drive Phase 0 work in the execution plan. They are listed here by order of severity.

## CF-1 (CRITICAL): Cleanup scripts have no production-account blocklist

`cleanup.sh`, `cleanup-cloudfront.sh`, `cleanup-cognito.sh`, and `delete-remaining-stacks.sh` will all execute against whatever AWS profile is set in the current shell. The user-confirmation prompt is bypass-able. A developer with both `uat` and `prod` profiles configured can destroy production by accident.

**Required Phase 0 fixes:**
- Add an account-id allowlist `[715860911762]` and region allowlist `[us-east-2]` at the top of `cleanup.sh`. Refuse to proceed if the resolved values fall outside the lists.
- Add a profile blocklist that refuses to run if `AWS_PROFILE=prod` (defense-in-depth).
- Mirror the same guards in `cleanup-cloudfront.sh` and `cleanup-cognito.sh`.
- Display the resolved account/region/profile in the WARNING banner so the operator sees them before typing `y`.

## CF-2 (CRITICAL): Foreign account `346698404105` in cleanup tooling

`scripts/cleanup/aws-nuke-setup.sh:57` hardcodes account `346698404105` (a foreign account) in `us-east-1` (a region EdForge has never used). `scripts/cleanup/delete-remaining-stacks.sh:107` references the same account in an IAM role ARN. These references are stale residue from another project and have no relevance to EdForge.

**Required Phase 0 fixes:** Remove all references to account `346698404105` and region `us-east-1` from the cleanup tooling. If aws-nuke is not used (recommended), delete the files outright.

## CF-3 (CRITICAL): Frontend local-dev env files point at deletion-targeted infrastructure

`edforge-saas-frontend/apps/shell/.env.local` and the per-app `.env.local` files in `apps/academics/`, `apps/finance/`, `apps/people/`, etc., hardcode:
- `VITE_API_URL=https://tw8pfmqsdi.execute-api.us-east-2.amazonaws.com/prod`
- `VITE_COGNITO_USER_POOL_ID=us-east-2_CjGEBNa9X`
- `VITE_COGNITO_REGION=us-east-2`
- `VITE_COGNITO_DOMAIN=edforge-uat.auth.us-east-2.amazoncognito.com`

After us-east-2 teardown these endpoints disappear. Local development will silently 503. Vercel-deployed envs are unaffected (they read from project settings, not these files), but every developer who runs `pnpm dev` will see broken auth.

**Required Phase 5 fixes:** Update each `.env.local` to point at the ap-south-1 production API Gateway, Cognito pool, and Cognito domain. Confirm with a `pnpm dev` smoke that the shell renders and login redirects to the correct hosted UI.

## CF-4 (HIGH): 40+ smoke-test scripts hardcode us-east-2 base URLs

`scripts/smoke-tests/golden-thread-flow.ts`, `identity-service-flow.ts`, `finance-e2e-comprehensive.ts`, `nepal-school-e2e.ts`, `academics-full-flow.ts`, and ~40 others contain literal strings of the form `https://*.execute-api.us-east-2.amazonaws.com/prod`. Some have an `process.env.API_BASE_URL ||` fallback; many do not. After teardown these tests will hit deleted infrastructure and fail with DNS or 503 errors. The test logs in `scripts/smoke-tests/logs/*.json` are historical and can be left alone.

**Required Phase 5 fixes:** Convert every smoke-test base-URL constant to an env-var-driven default. Set the default to the ap-south-1 prod URL where it makes sense. CI must export `API_BASE_URL` explicitly. Old logs stay (they are post-mortem evidence).

## CF-5 (HIGH): VPC Flow Logs have no retention configured

`shared-infra-stack.ts:70-76` enables `FlowLogTrafficType.ALL` (every accept and reject) and writes to a CloudWatch Log Group with no retention setting. This creates an unbounded log group at ~$0.50/GB/month storage forever. At pilot traffic this is ~$15/month and growing.

**Required Phase 2 fixes:** Set retention to 7 or 14 days for pilot. Consider switching `FlowLogTrafficType` from `ALL` to `REJECT` (only failed connections) if flow logs remain enabled — drops volume by 90%+. At pilot scale, flow logs can probably be turned off entirely; turn back on if a network issue is being investigated.

## CF-6 (HIGH): No CloudFormation termination protection on prod stacks

`server/bin/ecs-saas-ref-template.ts` does not set `terminationProtection: true` on any stack. A `cdk destroy tenant-template-stack-basic` against the prod profile would proceed without an additional CFN-level confirmation. The per-resource `RemovalPolicy.RETAIN` on DynamoDB and `TenantMappingTable` would preserve data, but the Cognito pool, ECS cluster, IAM roles, ALB rules, and security groups would be deleted, locking pilot users out indefinitely until the stack is rebuilt.

**Required Phase 0 fixes:** Set `terminationProtection: true` on `shared-infra-stack`, `controlplane-stack`, `analytics-stack`, `core-appplane-stack`, and `tenant-template-stack-basic` in production. This is a one-line change per stack.

## CF-7 (HIGH): No Cognito-pool deletion protection

`identity-provider.ts` (tenant pools) and `controlplane-stack.ts` (system-admin pool) do not configure deletion protection. Cognito User Pool deletion is irreversible and not covered by `RemovalPolicy.RETAIN` in practice (the pool is created by L2 construct; the L2 has not surfaced deletion protection in the EdForge code path).

**Required Phase 0 fixes:** Enable `deletionProtection: 'ACTIVE'` on tenant Cognito pools in `identity-provider.ts` (UserPool L2 supports this property). Apply the same to the control plane pool if SBT-CognitoAuth allows passthrough.

## CF-8 (FYI): `DestroyPolicySetter` is correctly NOT applied to tenant stacks

This is a positive finding. The CDK Aspect at `server/lib/utilities/destroy-policy-setter.ts` is applied **only** to `core-appplane-stack` (`ecs-saas-ref-template.ts:145`), which contains no business data. It is **explicitly NOT applied** to `tenant-template-stack-basic` — see the inline comment block at `ecs-saas-ref-template.ts:225-228` that documents the reasoning: per-resource `RemovalPolicy.RETAIN` on DDB tables is the source of truth, and applying the destroy aspect would override it.

**No fix required.** Do **not** re-enable the aspect on tenant stacks in any future refactor. The comment block must remain visible.

## CF-9 (HIGH): DynamoDB tables lack `deletionProtectionEnabled`

The CDK L2 `Table` construct supports `deletionProtectionEnabled: true` as a last-line-of-defence guard against `aws dynamodb delete-table` even after `RemovalPolicy.RETAIN` is bypassed. None of the EdForge production tables — `TenantMappingTable`, `edforge-identity-basic`, `edforge-academics-basic`, `edforge-finance-basic`, the analytics table — set this property. Grep confirms zero matches in `server/lib`.

The `RemovalPolicy.RETAIN` defends only against CloudFormation-driven deletion. A direct API call (`aws dynamodb delete-table`) or a manual console deletion bypasses RETAIN entirely. For irrecoverable pilot data, the AWS-recommended pattern is to combine RETAIN with `deletionProtectionEnabled: true` so that a manual delete attempt also fails until protection is explicitly toggled off.

**Required Phase 0.5b fixes (added after reviewer feedback):** Set `deletionProtectionEnabled: true` on all five production tables. This is a one-line property addition per table; the change is in-place (no table recreation).

## CF-10 (MEDIUM): No CI assertion against re-enabling `DestroyPolicySetter` on tenant stacks

CF-8 documents that the aspect is correctly NOT applied to tenant-template-stack. The protection is a **comment block** in `ecs-saas-ref-template.ts:225-228` and the absence of a `cdk.Aspects.of(...).add(new DestroyPolicySetter(...))` call. A future PR that adds the aspect to tenant stacks (e.g. via blanket "apply destroy aspect to every stack" refactor) would silently override every `RemovalPolicy.RETAIN` on the tenant DynamoDB tables.

**Required Phase 0.8 fix (added after reviewer feedback):** Add a pre-commit or CI check that fails if `DestroyPolicySetter` and `tenantTemplateStack` (or `tenant-template-stack`) appear on adjacent lines in `server/bin/ecs-saas-ref-template.ts`. A 3–5 line grep test in `.github/workflows/` (or whatever CI is in use) is sufficient. Pilot data is irrecoverable — this is cheap insurance.

## CF-11 (MEDIUM): No DynamoDB Point-in-Time Recovery validation in CI

PITR is enabled in CDK code on every business-critical table — `TenantMappingTable`, all three `edforge-*-basic` tables, the analytics table — but there is no automated check that confirms the deployed table actually has PITR ON. A future PR could silently flip the property.

**Optional fix (post-pilot):** Add a CI assertion that snapshots the `pointInTimeRecoverySpecification` of all production tables. Out of scope for this audit's phases.

## CF-12 (MEDIUM): Service-info.json prod-shape baseline can mask a wrong-region deploy

`server/lib/service-info.json` is a generated artifact carrying prod-shape `<REGION>` / `<ACCOUNT_ID>` placeholders. The deploy wrapper's preflight check catches unsubstituted placeholders. After us-east-2 teardown there is only one deploy target, so mis-substitution against a deleted region will fail loudly rather than silently — but during the transition (before logs are rotated and before muscle memory adjusts), an operator might run `source server/.env.uat` out of habit. The same wrapper preflight catches this.

**No code fix required.** Phase 5 includes archiving `server/.env.uat` so the file is no longer in the autocomplete path. After Phase 1 teardown, `server/.env.uat` should be either deleted or renamed `server/.env.uat.archived` to break the `source .env.uat` reflex.

---

# 7. Where the Cost Comes Down (Projected)

The execution-plan tracks specific changes; this is the cost ladder summary as a single table.

| State | NAT GWs | LBs | ECS tasks | Other delta | Est. monthly cost (ap-south-1) |
|---|---|---:|---:|---|---:|
| Current (Cost Explorer reference) | 3 | NLB+ALB (2) | 6 (identity×2, academics, finance, rproxy×2) | baseline | ~$201 |
| + Reduce NAT 3→1 | 1 | 2 | 6 | -$64 | ~$137 |
| + DDB+S3 Gateway Endpoints | 1 | 2 | 6 | -$1 (modest egress saving) + latency win | ~$136 |
| + Drop 1 rproxy task and 1 identity task (pilot scale) | 1 | 2 | 4 | -$21 (per ap-south-1 Fargate corrected math) | ~$115 |
| + VPC Flow Logs retention 7d (or off) | 1 | 2 | 4 | -$10 to -$25 | **~$90–105** ← target near |
| + CloudWatch log-retention reductions, ECR lifecycle | 1 | 2 | 4 | -$1 to -$3 | ~$87–104 |
| + ECS scheduled scale-to-zero overnight (optional) | 1 | 2 | 4 (5h/day off) | -$10 to -$15 | ~$77–94 (stretch achievable) |
| + (Post-pilot) NLB elimination via API Gateway HTTP API | 1 | 1 (ALB) | 4 | -$27 (NLB+VPCLink) | ~$50–67 |
| + (Post-pilot) rproxy elimination | 1 | 1 | 3 | -$10 | ~$40–57 |

The first four rows (safe + rproxy/identity right-sizing) plus log-retention work clear the $100/month bar with margin in the top half of the projection. The optional overnight scale-down clears the $80/month stretch in good cases. Post-pilot rows are for the second optimization pass once revenue or scale justifies the migration cost.

Caveat: pricing is anchored to ap-south-1 list-price (~+5% over us-east-2 base). Realized Cost Explorer numbers will be modestly lower than list because of free-tier offsets on Lambda invocations, Cognito MAU, and CloudWatch dashboards. Reconcile the projection against last-30-day Cost Explorer before finalizing the Phase 3 maintenance window.

---

# 8. What's Out of Scope (and Why)

To keep this audit tight, the following were considered and intentionally deferred:

- **Multi-region failover / DR.** Pre-revenue pilot. Single region is the right choice for at least the next year. The CDK code already supports multi-region by parameterizing `cdk.Stack.of(this).region`; re-enabling is a deployment-time decision, not a code rewrite.
- **HA tuning, auto-scaling policies, predictive scaling.** Pilot traffic is a few hundred req/s peak. Static `desiredCount` is appropriate.
- **WAF deployment.** ~$10/month for limited security uplift at this scale; defer.
- **Customer-managed KMS for DDB / S3.** AWS-managed encryption is sufficient for FERPA-equivalent compliance during pilot. Re-evaluate before signing the first paid customer.
- **Container Insights and detailed ECS observability.** Basic logs cover the pilot's incident-response needs. Container Insights is a $15–30/month commitment per cluster; defer.
- **Per-tenant resource limits and cost attribution.** Single tenant in BASIC tier today; not yet required.
