# EdForge Production Deployment Checklist

## Overview
Checklist for deploying EdForge EMIS SaaS to a dedicated production AWS account
for pilot school tenant onboarding.

---

## Phase 1: AWS Account & Foundation

### Account Setup
- [ ] Create dedicated production AWS account in AWS Organization
- [ ] Enable AWS CloudTrail (all regions, management + data events)
- [ ] Enable AWS GuardDuty
- [ ] Enable AWS Security Hub with CIS Benchmark
- [ ] Configure billing alerts ($100, $500, $1000 thresholds)
- [ ] Set up AWS SSO / IAM Identity Center for human access
- [ ] Create deployment IAM role with least-privilege for CDK (avoid long-lived access keys)
- [ ] Enable S3 Block Public Access at account level
- [ ] Enable EBS default encryption

### Networking Verification
- [ ] Verify VPC CIDR (10.0.0.0/16) doesn't conflict with other accounts if using VPC peering later
- [ ] Confirm 3-AZ deployment (us-east-2a, 2b, 2c)
- [ ] Verify NAT Gateway deployed in each AZ for HA

---

## Phase 2: Deploy Infrastructure

### Control Plane
```bash
cd /path/to/edforge/server
CDK_PARAM_COMMIT_ID=$(git rev-parse HEAD) npx cdk deploy controlplane-stack --require-approval=never
```
- [ ] Control Plane API Gateway deployed
- [ ] System admin Cognito user pool created
- [ ] EventBridge bus created

### Shared Infrastructure
```bash
CDK_PARAM_COMMIT_ID=$(git rev-parse HEAD) npx cdk deploy shared-infra-stack --require-approval=never
```
- [ ] VPC with private/public subnets
- [ ] ALB + NLB + VPC Link
- [ ] API Gateway with Lambda Authorizer
- [ ] Usage plans (Basic/Premium/Advanced)
- [ ] ECR repositories created

### Application Build & Push
```bash
./build-application.sh
```
- [ ] Identity service image pushed to ECR
- [ ] Academics service image pushed to ECR
- [ ] Finance service image pushed to ECR
- [ ] rProxy (NGINX) image pushed to ECR

### Tenant Template (Basic tier for pilot)
- [ ] ECS cluster (prod-basic) created
- [ ] DynamoDB tables created with PITR enabled
- [ ] ECS services running and healthy

---

## Phase 3: Security Hardening (CRITICAL before real school data)

### WAF (Currently disabled - CDK Nag suppressed)
**Files to modify:**
- `server/lib/cdknag/shared-infra-nag.ts` (remove AwsSolutions-CFR2 suppression)
- `server/lib/shared-infra/api-gateway.ts` (add WAF WebACL)

- [ ] Enable AWS WAF on API Gateway
  - Rate limiting rule (2000 req/5min per IP)
  - SQL injection rule set
  - XSS rule set
  - Known bad inputs rule set
- [ ] Enable AWS WAF on CloudFront distribution
- [ ] Configure WAF logging to S3

### Authentication Hardening
**Files to modify:**
- `server/lib/cdknag/tenant-template-nag.ts` (remove MFA suppression)
- `server/lib/tenant-template/identity-provider.ts`

- [ ] Enable Cognito MFA (OPTIONAL mode minimum for pilot, REQUIRED for GA)
- [ ] Enable Cognito Advanced Security Mode (FULL)
  - Compromised credentials detection
  - Adaptive authentication
- [ ] Review password policy (currently: 8 chars, upper, lower, digit, symbol — acceptable)
- [ ] Verify email verification is enforced

### CORS Lockdown
**File:** `server/lib/bootstrap-template/control-plane-stack.ts` (lines 39-100)

- [ ] Remove all localhost origins from CORS allowOrigins
- [ ] Verify only `https://edforge.app` is allowed
- [ ] TODO (noted in code): Implement dynamic CORS handling in Lambda Authorizer before GA

### Logging & Monitoring
- [ ] Set CloudWatch Logs retention to 365 days minimum (FERPA compliance)
  - **File:** `server/lib/tenant-template/services.ts` (log group retention)
- [ ] Enable ALB access logs to S3
  - **File:** `server/lib/shared-infra/shared-infra-stack.ts`
- [ ] Enable ECS Container Insights on all clusters
  - **File:** `server/lib/tenant-template/ecs-cluster.ts`
- [ ] Enable API Gateway access logging
- [ ] Set up CloudWatch Alarms:
  - ECS service CPU > 80%
  - ECS service memory > 80%
  - API Gateway 5xx error rate > 1%
  - DynamoDB throttled requests > 0
  - Lambda Authorizer errors > 0

### ECS Security
- [ ] Disable `enableExecuteCommand` in production (or restrict via IAM policy)
  - **File:** `server/lib/tenant-template/services.ts`
- [ ] Verify Fargate platform version is LATEST
- [ ] Confirm security groups restrict ingress to ALB only

### Data Protection
- [ ] Verify DynamoDB encryption at rest (AWS managed key, or upgrade to CMK)
- [ ] Verify DynamoDB Point-in-Time Recovery enabled on all tables
- [ ] Verify S3 buckets have versioning + encryption
- [ ] Review DynamoDB TTL for audit logs (2-year FERPA retention)

---

## Phase 4: Pilot Tenant Onboarding

### First Tenant
- [ ] Provision tenant via SBT Control Plane API
- [ ] Verify Cognito user pool created for tenant
- [ ] Verify DynamoDB items seeded (TenantSeederLambda)
- [ ] Verify admin user receives welcome email
- [ ] Test admin login and school creation
- [ ] Verify ABAC isolation (tenant can only see own data)

### Smoke Tests
- [ ] Create school under tenant
- [ ] Create student enrollment
- [ ] Verify attendance tracking
- [ ] Verify grade management
- [ ] Test user role assignment (TenantAdmin → TenantUser)
- [ ] Verify cross-tenant isolation (tenant A cannot see tenant B data)

---

## Phase 5: Operational Readiness

### Backup & Recovery
- [ ] Test DynamoDB Point-in-Time Recovery restore
- [ ] Document ECS service recovery procedure (force-new-deployment)
- [ ] Document tenant deprovisioning procedure

### Runbook Items
- [ ] How to deploy a new version:
  ```bash
  ./build-application.sh
  aws ecs update-service --cluster prod-basic --service <service>basic --force-new-deployment --region us-east-2
  ```
- [ ] How to provision a new tenant (SBT API call)
- [ ] How to deprovision a tenant
- [ ] How to view tenant-specific logs (CloudWatch log group filtering)
- [ ] How to check ECS service health

### Future Improvements (Post-Pilot)
- [ ] CI/CD pipeline (CodePipeline or GitHub Actions)
- [ ] Blue/green deployments for zero-downtime updates
- [ ] Custom domain + ACM certificate for API Gateway
- [ ] AWS Backup for automated DynamoDB backup scheduling
- [ ] Cost optimization review (Reserved Fargate, DynamoDB capacity mode)
- [ ] Load testing with realistic school data volumes

---

## CDK Nag Suppressions to Resolve

The following suppressions exist for "demo/reference architecture" reasons and must be
addressed before production:

### shared-infra-nag.ts
| Suppression | Risk | Action |
|-------------|------|--------|
| AwsSolutions-CFR2 | No WAF on CloudFront | Deploy WAF WebACL |
| AwsSolutions-APIG4 | API Gateway auth | Verify Lambda Authorizer covers all routes |
| AwsSolutions-COG4 | Cognito authorizer | Using custom Lambda authorizer (acceptable) |
| AwsSolutions-APIG1 | API Gateway access logging | Enable access logging |
| AwsSolutions-APIG6 | API Gateway execution logging | Enable execution logging |

### tenant-template-nag.ts
| Suppression | Risk | Action |
|-------------|------|--------|
| AwsSolutions-COG2 | No MFA required | Enable MFA |
| AwsSolutions-COG3 | No Advanced Security | Enable Advanced Security Mode |
| AwsSolutions-ECS4 | No Container Insights | Enable Container Insights |

---

## Architecture Diagram (Text)

```
                    ┌─────────────┐
                    │  CloudFront │
                    │  (Admin UI) │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ API Gateway │◄── Lambda Authorizer (JWT + ABAC)
                    │  + WAF      │    ├─ Validates Cognito JWT
                    │  + UsagePlan│    ├─ STS AssumeRole with tenant tags
                    └──────┬──────┘    └─ Returns tier API key
                           │
                    ┌──────▼──────┐
                    │  VPC Link   │
                    │    (NLB)    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │     ALB     │ (Internal)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼───┐ ┌─────▼─────┐
        │  rProxy   │ │rProxy │ │  rProxy   │
        │  (basic)  │ │(prem) │ │  (adv)    │
        └─────┬─────┘ └───┬───┘ └─────┬─────┘
              │            │            │
    ┌─────────┼─────┐     │     ┌──────┼──────┐
    │         │     │     │     │      │      │
┌───▼──┐ ┌───▼──┐ ┌▼──┐ ...  ┌─▼──┐ ┌─▼──┐ ┌▼──┐
│Ident │ │Acad  │ │Fin│      │Id  │ │Ac  │ │Fn │
│(pool)│ │(pool)│ │(p)│      │(si)│ │(si)│ │(s)│
└───┬──┘ └───┬──┘ └┬──┘      └─┬──┘ └─┬──┘ └┬──┘
    │         │     │            │      │     │
    └─────────┼─────┘            └──────┼─────┘
              │                         │
    ┌─────────▼─────────┐    ┌─────────▼─────────┐
    │   DynamoDB        │    │   DynamoDB        │
    │  (shared tables)  │    │ (dedicated tables) │
    │  ABAC: LeadingKeys│    │  per-tenant        │
    └───────────────────┘    └───────────────────┘

Control Plane (SBT):
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Cognito      │  │ EventBridge  │  │ Provisioning │
│ (SysAdmin)   │  │ (lifecycle)  │  │ (ScriptJob)  │
└──────────────┘  └──────────────┘  └──────────────┘
```
