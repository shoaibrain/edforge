# EdForge Infrastructure Cost Optimization Guide

## Current Monthly Costs (~$108–200)

```
├── NAT Gateway:        $52.25  (48%)  ← PRIMARY TARGET
├── ELB (ALB + NLB):    $17.38  (16%)  ← KEEP (Required for VPC Link)
├── ECS/Fargate:        $15.42  (14%)  ← Fargate Spot saves 70%
├── DynamoDB:           $6.38   (6%)   ← On-demand saves ~$5–20
├── EC2 (t3.micro):     $3.25   (3%)
├── EBS:                $1.01   (1%)
└── Other (S3, CW):     ~$12    (11%)  ← Flow logs contributing
```

## Optimized Target (~$50–80/month)

| Change | File | Current | Proposed | Monthly Savings |
|--------|------|---------|----------|-----------------|
| AZ count 3→2 | `bin/ecs-saas-ref-template.ts:29` | `AzCount = 3` | `AzCount = 2` | ~$17 |
| NAT Gateways 3→1 | `lib/shared-infra/shared-infra-stack.ts:65` | default (1 per AZ) | `natGateways: 1` | ~$35 |
| DynamoDB billing | `lib/tenant-template/ecs-dynamodb.ts:22` | `PROVISIONED` | `PAY_PER_REQUEST` | ~$6–20 |
| DynamoDB GSI capacity | `ecs-dynamodb.ts:43-106` | `readCapacity/writeCapacity: 5` per GSI | Remove (auto-scales) | included above |
| TenantMappingTable | `lib/shared-infra/shared-infra-stack.ts:265` | No billing mode set | Add `PAY_PER_REQUEST` | ~$1 |
| VPC Flow Logs | `lib/shared-infra/shared-infra-stack.ts:70-75` | `trafficType: ALL` | Remove for dev | ~$5 |
| **Total** | | **~$108–200** | **~$50–80** | **~$46–60** |

---

## Change 1: Reduce AZ Count (3 → 2)

**File:** `server/bin/ecs-saas-ref-template.ts` (line 29)

```typescript
// BEFORE:
const AzCount = 3;

// AFTER:
const AzCount = 2;
```

**Impact:**
- Removes 1 private subnet + 1 public subnet
- Reduces NAT gateways from 3 to 2 (default is 1 per AZ)
- Still maintains multi-AZ for basic high availability
- Existing validation on line 31 already allows `AzCount >= 2`

---

## Change 2: Limit NAT Gateways to 1

**File:** `server/lib/shared-infra/shared-infra-stack.ts` (VPC constructor, ~line 65)

```typescript
// BEFORE:
this.vpc = new ec2.Vpc(this, 'sbt-ecs-vpc', {
  ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
  availabilityZones: selectedAzs,
  flowLogs: {
    'sbt-ecs-vpcFlowLog': {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(),
      trafficType: ec2.FlowLogTrafficType.ALL
    }
  }
});

// AFTER:
this.vpc = new ec2.Vpc(this, 'sbt-ecs-vpc', {
  ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
  availabilityZones: selectedAzs,
  natGateways: 1,  // Single NAT for dev/pilot — saves ~$17/month per gateway removed
  // flowLogs removed for dev cost savings (~$5/month)
});
```

**Impact:**
- Single NAT gateway shared across 2 AZs
- Cross-zone on NLB is already enabled, so traffic flows correctly
- For production: re-enable 1 NAT per AZ and flow logs

---

## Change 3: DynamoDB — PROVISIONED → PAY_PER_REQUEST

### 3a. Per-Tenant Tables

**File:** `server/lib/tenant-template/ecs-dynamodb.ts`

Line 22 — Change billing mode:
```typescript
// BEFORE:
billingMode: dynamodb.BillingMode.PROVISIONED,

// AFTER:
billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
```

Lines 43–106 — Remove `readCapacity`/`writeCapacity` from ALL 6 active GSIs:
```typescript
// BEFORE (each GSI has):
readCapacity: 5,
writeCapacity: 5

// AFTER: Remove these two lines from all 6 GSI definitions
// PAY_PER_REQUEST does not support provisioned capacity on GSIs
```

### 3b. Tenant Mapping Table (Shared)

**File:** `server/lib/shared-infra/shared-infra-stack.ts` (line 265)

```typescript
// BEFORE:
this.tenantMappingTable = new Table(this, 'TenantMappingTable', {
  partitionKey: { name: 'tenantId', type: AttributeType.STRING },
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }
});

// AFTER:
this.tenantMappingTable = new Table(this, 'TenantMappingTable', {
  partitionKey: { name: 'tenantId', type: AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }
});
```

### Cost Analysis: Provisioned vs On-Demand

```
Provisioned Capacity (Current):
- Write Capacity Unit (WCU): $0.00065/hour = $0.47/month per WCU
- Read Capacity Unit (RCU): $0.00013/hour = $0.09/month per RCU
- Base table: 5 RCU + 5 WCU (defaults) = ~$2.80/month
- 6 GSIs × (5 RCU + 5 WCU) = ~$16.80/month
- TOTAL: ~$19.60/month

On-Demand (PAY_PER_REQUEST):
- Write Request: $1.25 per million requests
- Read Request: $0.25 per million requests
- Development usage (5 users, light testing):
  ~1,000 writes/month = $0.00125
  ~10,000 reads/month = $0.0025
- TOTAL: < $0.01/month (essentially FREE for dev)
```

---

## ProvisionedThroughputExceededException Fix

**Problem:** Calendar generation (`POST /schools/:id/academic-years/:yearId/generate-calendar`) performs a `batchWriteItems` call that writes many calendar date records at once, exceeding the 5 WCU provisioned capacity.

**Error observed:**
```
ProvisionedThroughputExceededException: The level of configured provisioned
throughput for the table was exceeded.
```

**Stack trace:**
```
at DynamoDBClientService.batchWriteItems (main.js:1207:13)
at CalendarDateService.generateCalendar (main.js:9451:9)
```

**Fix:** Switching to `PAY_PER_REQUEST` billing mode eliminates capacity limits entirely. On-demand mode auto-scales to handle any burst of writes, making calendar generation work reliably regardless of how many dates are generated.

**Alternative fix (if staying on PROVISIONED):** Increase write capacity on the base table:
```typescript
this.table = new dynamodb.Table(this, `${props.tableName}`, {
  billingMode: dynamodb.BillingMode.PROVISIONED,
  readCapacity: 10,   // Increased from default 5
  writeCapacity: 25,  // Increased to handle batch writes
  ...
});
```
Not recommended for dev — adds ~$12/month in unnecessary capacity.

---

## Teardown & Fresh Deploy Procedure

### Prerequisites
- AWS CLI configured with appropriate profile
- CDK bootstrapped in target region/account
- Docker available for building images

### Step-by-Step

```bash
# 1. Verify current state
cd server
AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services identitybasic academicsbasic rproxybasic \
  --query 'services[*].{name:serviceName,status:status,running:runningCount}'

# 2. Tear down all CloudFormation stacks
npx cdk destroy --all --force
# This removes: VPC, ALB, NLB, ECS cluster, DynamoDB tables, Cognito, API Gateway, etc.
# Data in DynamoDB tables will be LOST (RemovalPolicy.DESTROY is set)

# 3. Apply infrastructure code changes (Changes 1-3 above)
# Edit the 3 files listed above

# 4. Clean build
rm -rf node_modules dist cdk.out
npm install
npm run build

# 5. Verify CDK compiles
npx tsc --noEmit

# 6. Bootstrap CDK (may be needed if region/account changed)
npx cdk bootstrap

# 7. Deploy all stacks
npx cdk deploy --all --require-approval=never --concurrency 10 --asset-parallelism true

# 8. Build and push Docker images
cd ../scripts
./build-application.sh

# 9. Force new ECS deployment with fresh images
./fresh-deploy.sh

# 10. Verify services are healthy
AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services identitybasic academicsbasic rproxybasic \
  --query 'services[*].{name:serviceName,status:status,running:runningCount,desired:desiredCount}'
```

### Post-Deploy Verification

```bash
# Check CloudFormation outputs
aws cloudformation describe-stacks --stack-name shared-infra-stack \
  --query "Stacks[0].Outputs[?OutputKey=='adminSiteUrl'].OutputValue" --output text

# Check ECS task health
aws ecs describe-tasks --cluster prod-basic \
  --tasks $(aws ecs list-tasks --cluster prod-basic --query 'taskArns[*]' --output text) \
  --query 'tasks[*].{task:taskDefinitionArn,status:lastStatus,health:healthStatus}'

# Check CloudWatch logs for errors
aws logs tail /ecs/identitybasic --since 10m --format short
aws logs tail /ecs/academicsbasic --since 10m --format short
```

---

## Existing Deploy Scripts Reference

| Script | Location | Purpose |
|--------|----------|---------|
| `install.sh` | `scripts/install.sh` | Initial infrastructure setup (CDK bootstrap + deploy all) |
| `build-application.sh` | `scripts/build-application.sh` | Build Docker images + push to ECR |
| `fresh-deploy.sh` | `scripts/fresh-deploy.sh` | Force ECS service update with latest images |
| `local-setup.sh` | `scripts/local-setup.sh` | Local dev environment setup (DynamoDB, LocalStack) |
| `provision-tenant.sh` | `server/lib/provision-scripts/provision-tenant.sh` | SBT tenant onboarding (Cognito + CDK) |
| `seed-existing-tenant.sh` | `server/lib/provision-scripts/seed-existing-tenant.sh` | Manual tenant metadata seeding |

---

## Production Considerations (When Moving Past Pilot)

When ready for production, revert some dev optimizations:

1. **AZ Count:** Increase back to 3 for full HA
2. **NAT Gateways:** Set to 1 per AZ (or consider NAT instances for further savings)
3. **DynamoDB:** Stay on PAY_PER_REQUEST until traffic patterns are established, then evaluate provisioned with auto-scaling
4. **VPC Flow Logs:** Re-enable with `trafficType: REJECT` (only log rejected traffic)
5. **Container Insights:** Enable for production monitoring
6. **Fargate Spot:** Add capacity provider strategy for non-critical tasks (up to 70% savings)
7. **CloudWatch Log Retention:** Increase from 7 days to 30–90 days
