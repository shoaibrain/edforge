# DynamoDB GSI Deployment Failure Analysis

## Root Cause

### The Problem
The `tenant-template-stack-basic` deployment failed with:
```
Cannot perform more than one GSI creation or deletion in a single update
```

### Technical Explanation

1. **AWS DynamoDB Limitation:**
   - AWS DynamoDB has a **hard constraint**: Only **ONE Global Secondary Index (GSI)** can be created or deleted per table update operation
   - This is a fundamental DynamoDB service limitation, not a CDK/CloudFormation issue

2. **What Happened:**
   - Current table state: Has GSI1-GSI6 (6 indexes)
   - Code change: Added GSI7-GSI12 (6 new indexes) in `ecs-dynamodb.ts`
   - Deployment attempt: Tried to create all 6 GSIs in a single CloudFormation update
   - Result: DynamoDB rejected the update, causing full stack rollback

3. **Cascade Effect:**
   - The DynamoDB failure caused the entire stack update to rollback
   - This also cancelled the **Cognito UserPool email template update** (our actual goal)
   - The email template migration was blocked by an unrelated schema change

### Current State
- **Table**: `school-table-v2-basic`
- **Existing GSIs**: GSI1, GSI2, GSI3, GSI4, GSI5, GSI6
- **New GSIs to Add**: GSI7, GSI8, GSI9, GSI10, GSI11, GSI12
- **Stack Status**: `UPDATE_ROLLBACK_COMPLETE` (rolled back to previous state)

## Strategic Solution

### Option 1: Separate Concerns (Recommended)

**Phase 1: Deploy Email Template Changes First**
- Temporarily remove/comment out GSI7-GSI12 from the code
- Deploy email template migration (our primary goal)
- Verify email templates work correctly

**Phase 2: Add GSIs Incrementally**
- Add GSIs one at a time in separate deployments
- Each deployment creates exactly ONE GSI
- Wait for each GSI to reach `ACTIVE` status before proceeding

### Option 2: Use AWS CLI for GSI Creation

Create GSIs directly via AWS CLI, bypassing CloudFormation:
- More control over timing
- Can create GSIs independently of stack updates
- Requires manual coordination

### Option 3: Two-Phase Deployment Strategy

1. **Phase 1**: Deploy email templates (remove GSI changes temporarily)
2. **Phase 2**: Add GSIs via separate script or incremental CDK deployments

## Recommended Implementation: Option 1

### Step 1: Temporarily Remove GSI7-GSI12

Comment out the GSI7-GSI12 additions in `server/lib/tenant-template/ecs-dynamodb.ts`:

```typescript
// GSI7-GSI12: Enrollment Service (students, staff, parents, finance)
// TEMPORARILY COMMENTED OUT - Will be added incrementally after email template migration
// See: DYNAMODB_GSI_DEPLOYMENT_ISSUE.md for deployment strategy

/*
this.table.addGlobalSecondaryIndex({
  indexName: 'GSI7',
  // ... rest of GSI7 definition
});
// ... repeat for GSI8-GSI12
*/
```

### Step 2: Deploy Email Template Changes

```bash
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./deploy-incremental.sh deploy-tenant-basic
```

This will now succeed because:
- No DynamoDB GSI changes
- Only Cognito UserPool email template updates
- No conflicts

### Step 3: Add GSIs Incrementally (After Email Templates)

Create a script to add GSIs one at a time:

```bash
# Add GSI7
# Wait for completion
# Add GSI8
# Wait for completion
# ... continue for each GSI
```

Or use CDK with conditional logic to add one GSI per deployment.

## Why This Approach Works

1. **Separation of Concerns**: Email template migration is independent of database schema changes
2. **Risk Mitigation**: Complete critical migration first, then add schema enhancements
3. **Compliance with AWS Limits**: Respects DynamoDB's one-GSI-per-update constraint
4. **Rollback Safety**: If GSI addition fails, email templates remain updated

## Alternative: Incremental GSI Addition Script

If you need to add GSIs immediately, create a script that:
1. Adds one GSI at a time
2. Waits for GSI to become `ACTIVE`
3. Proceeds to next GSI
4. Uses AWS CLI or CDK with conditional deployment

## Summary

**Root Cause**: AWS DynamoDB limitation - only one GSI per update  
**Impact**: Blocked email template migration  
**Solution**: Separate email template deployment from GSI additions  
**Next Steps**: Remove GSI changes temporarily, deploy email templates, then add GSIs incrementally

