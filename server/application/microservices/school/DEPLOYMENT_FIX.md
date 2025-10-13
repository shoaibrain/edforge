# 🚀 School Service Deployment Fix

## ❌ **Issue Identified**

The deployment failed due to **DynamoDB CloudFormation limitation**: 
> "Cannot perform more than one GSI creation or deletion in a single update"

**Root Cause**: Our enhanced design tried to add 4 GSIs simultaneously, but DynamoDB only allows 1 GSI operation per CloudFormation update.

## ✅ **Solution: Phased GSI Deployment**

### **Phase 1: Deploy with GSI1 Only** ⭐ (Current)
- ✅ Modified `ecs-dynamodb.ts` to add only GSI1 initially
- ✅ Updated `service-info.json` with new sort key (`entityKey`) and EventBridge permissions
- ✅ Fixed build errors in school service code

### **Phase 2-4: Add Remaining GSIs** (Future deployments)
- GSI2: Academic Year Index
- GSI3: Status Index  
- GSI4: Activity Log Index

## 🔧 **Changes Made**

### 1. **CDK Infrastructure** (`ecs-dynamodb.ts`)
```typescript
// BEFORE: Tried to add 4 GSIs at once ❌
this.table.addGlobalSecondaryIndex({...}); // GSI1
this.table.addGlobalSecondaryIndex({...}); // GSI2  
this.table.addGlobalSecondaryIndex({...}); // GSI3
this.table.addGlobalSecondaryIndex({...}); // GSI4

// AFTER: Only GSI1 for now ✅
this.table.addGlobalSecondaryIndex({
  indexName: 'GSI1',
  partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
  // ... other config
});
```

### 2. **Service Configuration** (`service-info.json`)
```json
{
  "database": {
    "sortKey": "entityKey"  // Changed from "entityId"
  },
  "policy": {
    "Statement": [
      // ... existing permissions
      {
        "Effect": "Allow",
        "Action": ["events:PutEvents"],  // Added EventBridge
        "Resource": "*"
      }
    ]
  },
  "environment": {
    "EVENT_BUS_NAME": "default"  // Added EventBridge config
  }
}
```

### 3. **Build Fixes**
- ✅ Added `@aws-sdk/client-eventbridge` dependency
- ✅ Fixed duplicate `entityType` declarations in enhanced entities

## 🚀 **Deployment Steps**

### **Step 1: Deploy Infrastructure**
```bash
cd /Users/shoaibrain/edforge/server
npm run cdk deploy tenant-template-stack-basic
```

### **Step 2: Build & Deploy School Service**
```bash
cd /Users/shoaibrain/edforge/server/application
npm run build
./scripts/build-application.sh school
```

### **Step 3: Verify Deployment**
- Check DynamoDB table has GSI1
- Test school service APIs
- Verify EventBridge integration

## 📊 **Current Table State**

**Existing Table**: `school-table-basic`
- ✅ 3 items (can be deleted/recreated)
- ❌ No GSIs currently
- ✅ Will be updated to new schema

**New Table Schema** (after deployment):
```
Primary Key: tenantId (HASH) + entityKey (RANGE)
GSI1: gsi1pk (HASH) + gsi1sk (RANGE)  ← Will be added
TTL: 'ttl' attribute for audit log cleanup
```

## 🔮 **Future Phases**

### **Phase 2: Add GSI2** (Academic Year Index)
```typescript
this.table.addGlobalSecondaryIndex({
  indexName: 'GSI2',
  partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
  // ... config
});
```

### **Phase 3: Add GSI3** (Status Index)
### **Phase 4: Add GSI4** (Activity Log Index)

## 🎯 **Expected Outcome**

After this deployment:
- ✅ School service will build successfully
- ✅ DynamoDB table will have GSI1 for school-centric queries
- ✅ EventBridge integration will work
- ✅ Enhanced school service APIs will be functional
- ✅ Foundation ready for additional GSIs in future deployments

## 🚨 **Important Notes**

1. **Data Loss**: The 3 existing items in `school-table-basic` will be lost during schema update
2. **GSI Limitations**: Only 1 GSI can be added per deployment
3. **EventBridge**: Using "default" bus for MVP, can migrate to SBT bus later
4. **Rollback**: If deployment fails, CloudFormation will automatically rollback

---

**Status**: ✅ Ready for deployment
**Next Action**: Deploy infrastructure with `npm run cdk deploy tenant-template-stack-basic`
