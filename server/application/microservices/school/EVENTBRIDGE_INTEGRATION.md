# EventBridge Integration with SBT Stack

## 🎯 Your SBT Event Bus Configuration

### You Have TWO Event Buses:

1. **SBT Control Plane Event Bus** (Created by SBT)
   - Name: `controlplanestackcontrolplanesbtEventManagerSbtEventBus1E602009`
   - ARN: `arn:aws:events:us-east-1:346698404105:event-bus/controlplanestackcontrolplanesbtEventManagerSbtEventBus1E602009`
   - Purpose: SBT lifecycle events (tenant onboarding, user management)

2. **AWS Default Event Bus**
   - Name: `default`
   - ARN: `arn:aws:events:us-east-1:346698404105:event-bus/default`
   - Purpose: General AWS events

---

## ✅ **Recommended Approach: Use SBT Event Bus**

**Why:**
- ✅ Consistency with SBT architecture
- ✅ All EdForge events in one place
- ✅ EventManager handles routing
- ✅ Easier to set up event rules
- ✅ Better observability

**How It Works:**

```
Control Plane Events (SBT)          Application Events (EdForge)
├── TenantOnboarded                 ├── SchoolCreated
├── TenantOffboarded                ├── AcademicYearStarted
├── UserCreated                     ├── DepartmentCreated
└── etc.                            └── etc.
         │                                   │
         └─────────────┬─────────────────────┘
                       │
              ┌────────▼────────┐
              │  SBT Event Bus  │
              │  (Shared)       │
              └────────┬────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    ┌────▼───┐   ┌────▼───┐   ┌─────▼────┐
    │Student │   │Academic│   │ Finance  │
    │Service │   │Service │   │ Service  │
    └────────┘   └────────┘   └──────────┘
```

---

## 🔧 **Configuration Steps**

### Step 1: Export Event Bus Name from Control Plane (5 min)

**File:** `server/lib/bootstrap-template/control-plane-stack.ts`

Add after line 44:

```typescript
this.eventManager = controlPlane.eventManager;
this.regApiGatewayUrl = controlPlane.controlPlaneAPIGatewayUrl;
this.auth = cognitoAuth;

// ADD THIS: Export event bus name for application plane services
new cdk.CfnOutput(this, 'SbtEventBusName', {
  value: this.eventManager.busName,
  exportName: 'SbtEventBusName',
  description: 'SBT Event Bus name for application services'
});

new cdk.CfnOutput(this, 'SbtEventBusArn', {
  value: this.eventManager.busArn,
  exportName: 'SbtEventBusArn',
  description: 'SBT Event Bus ARN for application services'
});
```

### Step 2: Import Event Bus Name in Tenant Template Stack (5 min)

**File:** `server/lib/tenant-template/tenant-template-stack.ts`

Add after line 125 (after parsing service-info.json):

```typescript
const serviceInfo = JSON.parse(updateData);
const containerInfo: ContainerInfo[] = serviceInfo.Containers;

// ADD THIS: Get SBT event bus name from control plane
const sbtEventBusName = cdk.Fn.importValue('SbtEventBusName');

// Inject event bus name into school service environment
containerInfo.forEach((info) => {
  if (info.name === 'school' && info.environment) {
    info.environment.EVENT_BUS_NAME = sbtEventBusName;
  }
  
  // ... rest of the forEach loop
});
```

### Step 3: Update service-info.json (Already Done!)

**File:** `server/lib/service-info.json`

```json
{
  "name": "school",
  "environment": {
    "TABLE_NAME": "SCHOOL_TABLE",
    "EVENT_BUS_NAME": "default"  // Will be replaced at runtime
  }
}
```

---

## 🚀 **Alternative: Use Default Bus (Simpler for MVP)**

If you want to get started immediately without CDK changes:

**Pros:**
- ✅ No CDK changes needed
- ✅ Works out of the box
- ✅ Can migrate to SBT bus later

**Cons:**
- ⚠️ Events separated from SBT events
- ⚠️ Need to manage two buses

**Configuration:**
Just keep `EVENT_BUS_NAME=default` in service-info.json (already set!)

---

## 📊 **Comparison**

| Aspect | SBT Event Bus | Default Event Bus |
|--------|---------------|-------------------|
| Setup Complexity | Medium (CDK changes) | Easy (already works) |
| Consistency | High (all events together) | Low (split events) |
| SBT Integration | Native | Separate |
| Migration Effort | None (set up correctly once) | Medium (migrate later) |
| Production Ready | Yes | Yes |

---

## 💡 **My Recommendation for You**

### **For MVP: Use Default Bus** ✅

**Why:**
- ✅ Already configured in service-info.json
- ✅ No CDK changes needed
- ✅ Works immediately
- ✅ Can migrate to SBT bus later (just change ENV variable)

**What you have now:**
```json
{
  "environment": {
    "TABLE_NAME": "SCHOOL_TABLE",
    "EVENT_BUS_NAME": "default"  // ← Using default bus
  }
}
```

**This is perfectly fine for MVP!**

### **For Production: Migrate to SBT Bus** 

When you're ready (after MVP is working):
1. Add CfnOutput in control-plane-stack.ts (export SBT bus name)
2. Import in tenant-template-stack.ts
3. Inject into school service environment
4. Redeploy

**Change required:** Just environment variable!
```json
{
  "EVENT_BUS_NAME": "controlplanestackcontrolplanesbtEventManagerSbtEventBus1E602009"
}
```

---

## 🔍 **How to Verify Event Publishing**

### Method 1: CloudWatch Logs

```bash
# Check school service logs
aws logs tail /ecs/school --follow

# Look for:
"🔄 EventService initialized with bus: default"
"Event published: SchoolCreated { schoolId: 'xxx', tenantId: 'yyy', eventId: 'zzz' }"
```

### Method 2: EventBridge Console

1. Go to AWS Console → EventBridge
2. Click "Event buses" → Select "default" (or SBT bus)
3. Click "Events" tab
4. Create rule to send events to CloudWatch Logs:
   ```
   Event pattern:
   {
     "source": ["edforge.school-service"]
   }
   ```
5. Create a school → See event appear

### Method 3: Create Test Rule

**File:** Create `server/lib/test/eventbridge-test-rule.ts`

```typescript
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';

// In your stack
const testLogGroup = new logs.LogGroup(this, 'SchoolEventsTestLog', {
  retention: logs.RetentionDays.ONE_DAY
});

new events.Rule(this, 'SchoolEventsTestRule', {
  eventBus: events.EventBus.fromEventBusName(this, 'DefaultBus', 'default'),
  eventPattern: {
    source: ['edforge.school-service']
  },
  targets: [new targets.CloudWatchLogGroup(testLogGroup)]
});
```

Then check CloudWatch Logs group for events!

---

## 📝 **Event Publishing Examples**

### School Service Publishes:

```typescript
// In schools.service.ts after creating a school
await this.eventService.publishEvent({
  eventType: 'SchoolCreated',
  timestamp: new Date().toISOString(),
  tenantId: 'tenant-123',
  schoolId: 'school-456',
  schoolName: 'Demo School',
  schoolCode: 'DEMO-001',
  schoolType: 'k12',
  timezone: 'America/New_York',
  maxCapacity: 2000
});
```

### Other Services Subscribe:

**Option 1: Lambda (Easiest for MVP)**

```typescript
// In CDK stack (future: student-service-stack.ts)
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

const studentServiceHandler = new lambda.Function(...);

new events.Rule(this, 'OnSchoolCreated', {
  eventBus: events.EventBus.fromEventBusName(this, 'DefaultBus', 'default'),
  eventPattern: {
    source: ['edforge.school-service'],
    detailType: ['SchoolCreated']
  },
  targets: [new targets.LambdaFunction(studentServiceHandler)]
});
```

**Option 2: SQS Queue (Better for high volume)**

```typescript
const queue = new sqs.Queue(this, 'SchoolEventsQueue');

new events.Rule(this, 'SchoolEventsToQueue', {
  eventBus: events.EventBus.fromEventBusName(this, 'DefaultBus', 'default'),
  eventPattern: {
    source: ['edforge.school-service']
  },
  targets: [new targets.SqsQueue(queue)]
});

// Then Student Service polls queue
```

---

## 🎯 **For Your MVP: Keep It Simple**

### Current Configuration (Works Great!):

```json
// service-info.json
{
  "name": "school",
  "environment": {
    "TABLE_NAME": "SCHOOL_TABLE",
    "EVENT_BUS_NAME": "default"  // ← Simple, works immediately
  },
  "policy": {
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["events:PutEvents"],
        "Resource": "*"  // ← Allows publishing to any bus
      }
    ]
  }
}
```

### What Happens:

1. **School Service starts** → EventService initializes with "default" bus
2. **School created** → Event published to default bus
3. **EventBridge receives event** → Routes based on rules (when you create them)
4. **Logs to CloudWatch** → You can see "Event published: SchoolCreated"

### When to Switch to SBT Bus:

- When you want all events centralized
- When you have multiple application services
- When you need SBT EventManager features

**For now: default bus is perfect! ✅**

---

## 🚨 **Important: Don't Break Existing Functionality**

### SBT Events (Already Working):
- ✅ Tenant onboarding
- ✅ Tenant offboarding  
- ✅ User management

**These use SBT event bus and will continue to work!**

### School Service Events (New):
- 🆕 SchoolCreated
- 🆕 AcademicYearStarted
- 🆕 DepartmentCreated

**These use default bus (separate) - no conflict!**

**Both work independently - existing functionality preserved! ✅**

---

## 🎓 **Summary**

### For Your MVP:
```typescript
// event.service.ts (already configured!)
this.eventBusName = process.env.EVENT_BUS_NAME || 'default';
```

```json
// service-info.json (already configured!)
{
  "environment": {
    "EVENT_BUS_NAME": "default"
  }
}
```

**No changes needed! It works as-is! 🎉**

### Future Enhancement (Optional):

1. Export SBT bus name in control-plane-stack.ts
2. Import in tenant-template-stack.ts
3. Inject into school service environment
4. Change EVENT_BUS_NAME to SBT bus

**But for MVP: stick with default bus!**

---

*Recommendation: Use default bus for MVP, migrate to SBT bus later if needed*
*Status: ✅ Ready to use as-is*

