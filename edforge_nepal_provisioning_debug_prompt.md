# EdForge — Nepal MVP: Debug & Deployment Fix
## Agent Prompt for Claude Code (IDE)

---

## DIAGNOSIS BEFORE YOU START

The following has been determined from evidence by the product lead.
Read this before touching anything.

### What the Evidence Shows

**The `country` field IS being saved to DynamoDB correctly:**
```json
{ "country": { "S": "NPL" } }
```
The AdminWeb UI change (Sprint 1) worked. The field is in DynamoDB. ✓

**But the EventBridge provisioning success event does NOT contain `country`:**
```json
"detail": {
  "jobOutput": {
    "tenantData": {
      "tenantConfig": "...",
      "tenantName": "sseb",
      "tier": "BASIC",
      "tenantId": "...",
      "tenantS3Bucket": "",
      "prices": "[]",
      "email": "rainshoaib@outlook.com"
      // ← NO country field here
    }
  }
}
```

**This is the exact bug.** The `country` field is stored in the tenant registration
record but it was NOT included in the `jobOutput.tenantData` that gets passed to the
TenantSeederLambda via EventBridge. As a result, the seeder lambda receives no
country, calls `createDefaultWorkspaceSettings(tenantId, name, createdBy, undefined)`,
and seeds US defaults (USD, America/New_York, gregorian).

### Root Cause Chain

```
AdminWeb form → saves country to DynamoDB tenant-registrations table ✓
                    ↓
provision-tenant.sh → reads tenantData from DynamoDB
                    ↓
          ← country NOT in tenantData passed to provisioning script ← BUG HERE
                    ↓
EventBridge success event → tenantData missing country
                    ↓
TenantSeederLambda → receives no country
                    ↓
createDefaultWorkspaceSettings(tenantId, name, createdBy, undefined) → US defaults
                    ↓
Nepal tenant gets USD + gregorian + America/New_York ← THE SYMPTOM
```

### This Is a Deployment + Code Bug

Two things need to happen:
1. **Code fix**: `provision-tenant.sh` must include `country` in the tenantData
   passed to the provisioning job, so it flows through to the EventBridge event
   and reaches the TenantSeederLambda.
2. **Redeployment**: After the code fix, the controlplane-stack Lambda must be
   redeployed with the new code. ECS services also need redeployment.
3. **Data fix**: The existing "sseb" Nepal tenant was seeded with wrong defaults.
   Its workspace settings must be manually corrected.

---

## PHASE 1 — VERIFY THE EXACT CODE BUG

### Step 1 — Read provision-tenant.sh

```bash
cat /Users/shoaibrain/edforge/server/lib/provision-scripts/provision-tenant.sh
```

Find exactly where `tenantData` is being constructed and passed to the provisioning
job. Look for:
- Where tenant data is read from (DynamoDB, input params, or environment variables)
- Where the provisioning script constructs the output `jobOutput.tenantData`
- Whether `country` is included in that output

The field is in DynamoDB (confirmed from the tenant record). The question is:
**does the provisioning script read and forward it?**

Record the exact lines.

### Step 2 — Read TenantSeederLambda

```bash
cat /Users/shoaibrain/edforge/server/lib/bootstrap-template/tenant-seeder-lambda.ts
```

Find:
- Where it reads from `event.detail.jobOutput.tenantData`
- Where it calls `createDefaultWorkspaceSettings()` or equivalent
- Whether it reads `country` from the event before that call

Record the exact lines.

### Step 3 — Read workspace-settings entity

```bash
cat /Users/shoaibrain/edforge/server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts
```

Verify:
- Does `COUNTRY_DEFAULTS` map exist? (Sprint 0, S0.2)
- Does `createDefaultWorkspaceSettings()` accept a `country` parameter?
- Does it actually use the COUNTRY_DEFAULTS map when country is 'NPL'?

### Step 4 — Check the lazy initialization guard

```bash
grep -n "getWorkspaceSettings\|createDefaultWorkspaceSettings\|SETTINGS#WORKSPACE" \
  /Users/shoaibrain/edforge/server/application/microservices/identity/src/tenants/tenants.service.ts
```

**Critical:** Verify there is a guard that checks for an existing workspace settings
record BEFORE calling createDefaultWorkspaceSettings. If no guard exists, the lazy
path will overwrite any correctly-seeded Nepal defaults on first API call.

Show the exact code block.

### Step 5 — Confirm the bug location

After reading all four files, write a one-paragraph diagnosis confirming:
- Exactly which file and line the `country` field is being dropped
- Whether `createDefaultWorkspaceSettings` has the correct COUNTRY_DEFAULTS logic
- Whether the lazy init guard exists

Do not proceed to fixing until you have confirmed the exact location.

---

## PHASE 2 — CODE FIX

Fix the code. Then redeploy. Order matters.

### Fix 2.1 — provision-tenant.sh: include country in tenantData output

**File:** `/Users/shoaibrain/edforge/server/lib/provision-scripts/provision-tenant.sh`

The script reads the tenant registration record from DynamoDB or receives it as
input. It must:
1. Read the `country` field from wherever it gets tenant data
2. Include it in whatever output structure becomes `jobOutput.tenantData`

**Before the fix:** `tenantData` in the EventBridge output has no country field.

**After the fix:** `tenantData` includes `"country": "NPL"` (or whatever was stored).

The exact implementation depends on how the script currently reads tenant data.
Common patterns in SBT provisioning scripts:
- Input comes as environment variables set by Step Functions
- Input comes from a DynamoDB `GetItem` call inside the script
- Input is JSON passed as a parameter

Read the script to understand the actual pattern, then add `country` appropriately.

**Validation:** After the fix, create a test tenant and examine the EventBridge event
in CloudWatch Logs. `detail.jobOutput.tenantData` must contain `country`.

### Fix 2.2 — Verify TenantSeederLambda reads country and passes it

**File:** `/Users/shoaibrain/edforge/server/lib/bootstrap-template/tenant-seeder-lambda.ts`

The lambda receives the EventBridge success event. It must:
1. Read `country` from `event.detail.jobOutput.tenantData.country`
2. Pass it to `createDefaultWorkspaceSettings(tenantId, name, createdBy, country)`

If this was already fixed in Sprint 0 (S0.3) but `country` was never arriving in
the event (because of Fix 2.1 above), then the lambda code may be correct but was
receiving `undefined`. Verify the lambda code is reading country correctly.

If the lambda code is NOT reading country at all, fix it now.

**Validation:** Check CloudWatch Logs for the TenantSeederLambda during the next
test tenant creation. Look for the workspace settings creation log line and confirm
it shows NPL-specific defaults being applied.

### Fix 2.3 — Verify lazy init guard exists in tenants.service.ts

**File:** `/Users/shoaibrain/edforge/server/application/microservices/identity/src/tenants/tenants.service.ts`

If the guard does NOT exist (getWorkspaceSettings checks for existing record before
creating defaults), add it now. This prevents the platform app's first API call
from overwriting correctly-provisioned Nepal settings with US defaults.

Pattern should be:
```typescript
async getWorkspaceSettings(tenantId: string) {
  // First: try to read existing settings
  const existing = await this.dynamoDbService.getItem({
    TableName: TABLE_NAME,
    Key: {
      tenantId: { S: tenantId },
      entityKey: { S: 'SETTINGS#WORKSPACE' }
    }
  });

  // If exists, return it — DO NOT overwrite
  if (existing.Item) {
    return this.mapToWorkspaceSettings(existing.Item);
  }

  // Only create defaults if no record exists
  const defaults = createDefaultWorkspaceSettings(tenantId, orgName, 'SYSTEM', country);
  await this.dynamoDbService.putItem({ ... });
  return defaults;
}
```

---

## PHASE 3 — REDEPLOYMENT

After ALL code fixes are confirmed, redeploy in the correct order.
Per the AWS CLI Operations Guide: infrastructure first, application second.

### Understand what changed and what needs redeployment

| Change | Stack/Service | Redeploy Method |
|--------|--------------|-----------------|
| provision-tenant.sh | `controlplane-stack` Lambda | CDK deploy |
| tenant-seeder-lambda.ts | `controlplane-stack` Lambda | CDK deploy |
| workspace-settings.entity.ts | `identitybasic` ECS service | Build + force-new-deployment |
| tenants.service.ts | `identitybasic` ECS service | Build + force-new-deployment |

### Step 3.1 — Set environment

```bash
export AWS_PROFILE=uat
export AWS_REGION=us-east-2
export CLUSTER_NAME=prod-basic
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Verify credentials
aws sts get-caller-identity
```

### Step 3.2 — Deploy controlplane-stack (fixes Lambda code)

The provision-tenant.sh script and TenantSeederLambda are part of the
`controlplane-stack`. Changes to these require a CDK deploy.

```bash
cd /Users/shoaibrain/edforge/server

# Deploy controlplane-stack
CDK_NAG_ENABLED=false AWS_PROFILE=uat npx cdk deploy controlplane-stack \
  --require-approval=never \
  --region $AWS_REGION

# Wait for completion and verify
aws cloudformation describe-stacks \
  --stack-name controlplane-stack \
  --region $AWS_REGION \
  --query 'Stacks[0].{Status:StackStatus,Updated:LastUpdatedTime}' \
  --output table
```

**Expected output:** `UPDATE_COMPLETE`

If this fails with `ROLLBACK`, check CloudFormation events:
```bash
aws cloudformation describe-stack-events \
  --stack-name controlplane-stack \
  --region $AWS_REGION \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`].{Resource:LogicalResourceId,Reason:ResourceStatusReason}' \
  --output table
```

### Step 3.3 — Build and push Docker images (fixes ECS application code)

The identity service changes (workspace-settings entity, tenants.service) require
rebuilding and pushing the Docker image.

```bash
cd /Users/shoaibrain/edforge/scripts

# Build all images and push to ECR
AWS_PROFILE=uat ./build-application.sh

# Verify the identity image was pushed with a recent timestamp
aws ecr describe-images \
  --repository-name identity \
  --region $AWS_REGION \
  --query 'sort_by(imageDetails,&imagePushedAt)[-1].{pushed:imagePushedAt,tags:imageTags}' \
  --output table
```

The timestamp should be within the last few minutes.

### Step 3.4 — Force redeploy of identitybasic ECS service

```bash
AWS_PROFILE=uat aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service identitybasic \
  --force-new-deployment \
  --region $AWS_REGION

echo "Identity service redeployment triggered"
```

### Step 3.5 — Monitor deployment until stable

```bash
# Watch until running count stabilizes at desired count
# Run this every 30 seconds until you see runningCount == desiredCount

aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --services identitybasic \
  --region $AWS_REGION \
  --query 'services[0].{status:status,running:runningCount,desired:desiredCount,deployments:deployments[*].{status:status,running:runningCount,desired:desiredCount}}' \
  --output table
```

**Expected stable state:**
- `runningCount` == `desiredCount` (typically 1)
- Only one deployment with status `PRIMARY`

### Step 3.6 — Verify identity service is healthy

```bash
# Check recent logs for startup confirmation
AWS_PROFILE=uat aws logs tail /ecs/identitybasic \
  --since 5m \
  --region $AWS_REGION | tail -30

# Should see:
# Identity Service running on port 3010
# DynamoDB Table: edforge-identity-basic
# No errors
```

---

## PHASE 4 — DATA FIX (Correct Existing Broken Tenant)

The "sseb" tenant (ID: `ebddd419-239b-47c3-9ef3-ee2d378d2592`) was created with
US defaults. Its workspace settings in DynamoDB must be corrected manually.

### Step 4.1 — Check what is currently in DynamoDB for this tenant

```bash
aws dynamodb get-item \
  --table-name edforge-identity-basic \
  --key '{"tenantId":{"S":"ebddd419-239b-47c3-9ef3-ee2d378d2592"},"entityKey":{"S":"SETTINGS#WORKSPACE"}}' \
  --region $AWS_REGION \
  --profile uat \
  --output json
```

Record the current values. If the record shows USD/gregorian/America/New_York,
it needs to be corrected.

### Step 4.2 — Update workspace settings to Nepal defaults

```bash
aws dynamodb update-item \
  --table-name edforge-identity-basic \
  --key '{"tenantId":{"S":"ebddd419-239b-47c3-9ef3-ee2d378d2592"},"entityKey":{"S":"SETTINGS#WORKSPACE"}}' \
  --update-expression "SET #regional.defaultCurrency = :currency,
                           #regional.defaultTimezone = :timezone,
                           #regional.defaultCalendarSystem = :calendar,
                           #regional.enableDualDateDisplay = :dual,
                           #regional.defaultNumberFormat = :numformat,
                           #regional.defaultLocale = :locale,
                           #regional.defaultDateFormat = :dateformat,
                           #regional.defaultWeekStartsOn = :weekstart,
                           updatedAt = :now,
                           #ver = #ver + :one" \
  --expression-attribute-names '{"#regional":"regional","#ver":"version"}' \
  --expression-attribute-values '{
    ":currency":{"S":"NPR"},
    ":timezone":{"S":"Asia/Kathmandu"},
    ":calendar":{"S":"bikram_sambat"},
    ":dual":{"BOOL":true},
    ":numformat":{"S":"south_asian"},
    ":locale":{"S":"ne-NP"},
    ":dateformat":{"S":"DD/MM/YYYY"},
    ":weekstart":{"S":"sunday"},
    ":now":{"S":"2026-03-22T00:00:00.000Z"},
    ":one":{"N":"1"}
  }' \
  --region $AWS_REGION \
  --profile uat
```

**If the DynamoDB schema stores regional settings as a nested map, you may need
to update the entire regional map rather than individual fields. Check the
current item structure first (Step 4.1) and adjust the update expression
if the schema is different.**

### Step 4.3 — Verify the correction

```bash
aws dynamodb get-item \
  --table-name edforge-identity-basic \
  --key '{"tenantId":{"S":"ebddd419-239b-47c3-9ef3-ee2d378d2592"},"entityKey":{"S":"SETTINGS#WORKSPACE"}}' \
  --region $AWS_REGION \
  --profile uat \
  --output json | jq '.Item.regional'
```

**Expected output:**
```json
{
  "defaultCurrency": { "S": "NPR" },
  "defaultTimezone": { "S": "Asia/Kathmandu" },
  "defaultCalendarSystem": { "S": "bikram_sambat" },
  "enableDualDateDisplay": { "BOOL": true },
  "defaultNumberFormat": { "S": "south_asian" },
  "defaultLocale": { "S": "ne-NP" }
}
```

---

## PHASE 5 — END-TO-END VERIFICATION

### Step 5.1 — Create a brand new Nepal test tenant

Use AdminWeb to create a new tenant:
- Tenant Name: `nepal-test-v2`
- Email: (your test email)
- Country: Nepal
- Tier: Basic

Wait for provisioning to complete (registration status = "Complete").

### Step 5.2 — Verify the EventBridge event now contains country

Immediately after provisioning, check CloudWatch Logs for the TenantSeederLambda:

```bash
# Find the Lambda function name
aws lambda list-functions \
  --region $AWS_REGION \
  --profile uat \
  --query 'Functions[?contains(FunctionName,`seeder`) || contains(FunctionName,`Seeder`)].FunctionName' \
  --output table

# Or find it via the controlplane-stack outputs
aws cloudformation describe-stack-resources \
  --stack-name controlplane-stack \
  --region $AWS_REGION \
  --query 'StackResources[?ResourceType==`AWS::Lambda::Function`].{Name:LogicalResourceId,Physical:PhysicalResourceId}' \
  --output table
```

Then check its recent logs:
```bash
LAMBDA_NAME="[name from above]"

aws logs tail /aws/lambda/$LAMBDA_NAME \
  --since 10m \
  --region $AWS_REGION \
  --profile uat | grep -A 5 "country\|NPL\|workspace\|Nepal"
```

**Expected:** You should see log lines indicating:
- `country: "NPL"` was received
- Nepal workspace settings were applied

### Step 5.3 — Verify new tenant settings via API

```bash
# Get your JWT token (from the platform app's network tab or AdminWeb auth)
TOKEN="[your bearer token]"
NEW_TENANT_ID="[new tenant ID from AdminWeb]"

curl -s "https://edforge.app/api/tenants/$NEW_TENANT_ID/settings" \
  -H "Authorization: Bearer $TOKEN" | jq '.regional'
```

**Expected:**
```json
{
  "defaultCurrency": "NPR",
  "defaultTimezone": "Asia/Kathmandu",
  "defaultCalendarSystem": "bikram_sambat",
  "enableDualDateDisplay": true,
  "defaultNumberFormat": "south_asian"
}
```

**If you still see USD/gregorian/America/New_York → the Lambda code is still
not reading country correctly. Go back to Phase 2.**

### Step 5.4 — Log in as the new Nepal tenant

1. Check the invitation email
2. Log in with temporary password
3. Change password
4. **Does the WorkspaceSetupGate appear?** It should.
5. **Does it show NPR + Bikram Sambat + Asia/Kathmandu?** It should.
6. Confirm settings. Navigate to Finance. Verify NPR amounts.

---

## PHASE 6 — WRITE THE BUG REPORT

After completing Phases 1–5, write `docs/nepal-mvp-bug-report.md` with:

```markdown
# Nepal MVP Bug Report — country field not passed through provisioning

## Root Cause
[Exact file and line where country was dropped]

## What Was Broken
[describe the chain — country saved to DynamoDB, not forwarded in tenantData,
EventBridge event missing country, seeder got undefined, US defaults applied]

## Fixes Applied

### Fix 1 — [file changed]
[what was changed and why]

### Fix 2 — [file changed]
[what was changed and why]

## Redeployment Steps Taken
[commands run, in order]

## Data Correction Applied
[DynamoDB UpdateItem for tenant ebddd419-...]

## Verification
[Results of Step 5.3 showing Nepal settings for new test tenant]

## Prevention
[Note: The lazy init guard in tenants.service.ts ensures that if provisioning
correctly seeds Nepal settings, a subsequent API call will never overwrite them.
This guard was added as part of Sprint 0 S0.3.]
```

---

## CONSTRAINTS

- Do not change AdminWeb — S1.1–S1.4 are working correctly (country is saved to DynamoDB)
- Do not change the frontend platform app — the issue is entirely in the provisioning pipeline
- Do not change the WorkspaceSetupGate — it works, it just needs correct settings to display
- Do not change shared-infra-stack or tenant-template-stack unless the investigation reveals the bug is there
- Always check CloudWatch Logs to verify behavior — do not assume a fix worked without log evidence
- The DynamoDB UpdateItem in Phase 4 is a one-time manual correction for an existing broken tenant
- New tenants created after the fix should auto-seed correctly without manual intervention
