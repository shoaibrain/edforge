# DynamoDB Single-Table Design - Architecture Deep Dive

## 🤔 **Your Questions**

### 1. Why store everything in ONE DynamoDB table?
### 2. Do ALL basic tier tenants share one table?
### 3. What happens for Advanced/Premium/Enterprise tiers?

---

## 📊 **Single-Table Design: Why?**

### **The Problem with Multiple Tables**

**Traditional Approach (Anti-Pattern for SaaS):**
```
schools-table
academic-years-table
classrooms-table
assignments-table
grades-table
attendance-table
students-table
teachers-table
...
```

**Issues:**
1. **Cost**: DynamoDB charges per table for reserved capacity
2. **Operations**: Each table needs separate backup, monitoring, scaling
3. **Joins**: DynamoDB doesn't support joins - multiple queries needed
4. **Transactions**: Limited cross-table transaction support
5. **Management**: 100 tenants × 10 tables = 1000 tables to manage

### **Single-Table Design (AWS Best Practice)**

```
One Table: saas-tenant-data-{tier}
├── All Schools
├── All Academic Years
├── All Classrooms
├── All Assignments
├── All Grades
└── All Attendance Records
```

**Benefits:**
1. **Cost Efficiency**: One table to provision, backup, monitor
2. **Performance**: Related data in same partition = fast queries
3. **Transactions**: All tenant data can be in ACID transactions
4. **Scalability**: DynamoDB auto-scales based on access patterns
5. **Simplicity**: One backup strategy, one monitoring setup

---

## 🔐 **Tenant Isolation Strategy**

### **How Data is Isolated**

```typescript
// Every item has tenantId as partition key
{
  "tenantId": "tenant-abc-123",          // ← PK: Physical isolation
  "entityKey": "SCHOOL#school-xyz",      // ← SK: Logical organization
  "entityType": "SCHOOL",
  "schoolName": "Lincoln High School",
  // ... rest of data
}
```

**Physical Isolation:**
- Partition Key = `tenantId`
- DynamoDB **physically separates** data by partition key
- Tenant A can **NEVER** query Tenant B's data (infrastructure-level isolation)
- IAM policies enforce tenant-scoped access

**Query Example:**
```typescript
// This query can ONLY return data for tenant-abc-123
const result = await dynamoDB.query({
  TableName: 'saas-tenant-data-basic',
  KeyConditionExpression: 'tenantId = :tid',
  ExpressionAttributeValues: {
    ':tid': 'tenant-abc-123'  // JWT provides this
  }
});
```

---

## 🏢 **Tier-Based Table Strategy**

### **Current Architecture (From Your Codebase)**

```typescript
// From tenant-template-stack.ts
const tableName = `saas-tenant-data-${tier}`;  // tier = basic | advanced | premium
```

### **How It Works**

**Basic Tier:**
```
Table: saas-tenant-data-basic
├── tenant-001 (School District A)
│   ├── 5 schools
│   ├── 500 students
│   └── 50 teachers
├── tenant-002 (School District B)
│   ├── 3 schools
│   ├── 300 students
│   └── 30 teachers
└── tenant-003 (School District C)
    └── ... (up to ~100 tenants)
```

**Advanced Tier:**
```
Table: saas-tenant-data-advanced
├── tenant-101 (Large District)
│   ├── 20 schools
│   ├── 5,000 students
│   └── 500 teachers
├── tenant-102 (Regional District)
│   ├── 15 schools
│   ├── 3,500 students
│   └── 350 teachers
└── ... (up to ~50 tenants)
```

**Premium/Enterprise Tier:**
```
Table: saas-tenant-data-premium-{tenantId}  ← DEDICATED TABLE
└── tenant-enterprise-xyz (State Department of Education)
    ├── 500 schools
    ├── 100,000 students
    ├── 10,000 teachers
    └── Dedicated resources, custom SLA
```

### **Why Separate Tables by Tier?**

1. **Performance Isolation**: Basic tier usage doesn't impact Enterprise
2. **Cost Optimization**: Different provisioned capacity per tier
3. **SLA Differentiation**: Enterprise gets dedicated resources
4. **Compliance**: Some enterprise clients require dedicated infrastructure
5. **Noisy Neighbor Prevention**: One tenant's spike doesn't affect others

---

## 📈 **Scaling Strategy**

### **When Do You Split Tenants?**

```python
# Decision Matrix
if tier == "basic":
    max_tenants_per_table = 100
    max_schools_per_tenant = 10
    shared_table = True
    
elif tier == "advanced":
    max_tenants_per_table = 50
    max_schools_per_tenant = 50
    shared_table = True
    
elif tier == "premium":
    max_tenants_per_table = 20
    max_schools_per_tenant = 100
    shared_table = True
    
elif tier == "enterprise":
    dedicated_table = True  # One table per tenant
    unlimited_schools = True
```

### **Migration Path**

```
Basic Tenant Growth:
1. Tenant starts: basic tier, shared table
2. Grows to 15 schools: Auto-upgrade to advanced tier
3. Migrated to: saas-tenant-data-advanced (different table)
4. Grows to 75 schools: Upgrade to premium
5. Migrated to: saas-tenant-data-premium-{tenantId} (dedicated table)
```

**Migration Process:**
```typescript
// Automated migration service
async function migrateTenant(tenantId: string, fromTier: string, toTier: string) {
  // 1. Create new table/partition
  // 2. Copy all tenant data (maintain partition key = tenantId)
  // 3. Update tenant metadata
  // 4. Switch application traffic
  // 5. Verify & cleanup old data
}
```

---

## 🎯 **Performance Characteristics**

### **DynamoDB Single-Table Performance**

**Reads:**
- **Single-digit millisecond latency** (even with millions of items)
- **Why?** DynamoDB uses partition key for direct lookup
- Query: `PK=tenant-123 AND SK begins_with "SCHOOL#"` → instant

**Writes:**
- **Single-digit millisecond latency**
- **Auto-scaling**: Handles traffic spikes automatically
- **Hot partitions**: Prevented by good partition key design (tenantId)

**Capacity:**
- **Items per table**: Unlimited
- **Item size**: 400KB max
- **Partition capacity**: 1000 WCU, 3000 RCU per partition
- **With 100 tenants**: Each tenant gets their own "virtual table" (partition)

### **Real-World Example**

```
Table: saas-tenant-data-basic (100 tenants)

Tenant-001 has:
- 5 schools × 500 items each = 2,500 items
- 30 teachers × 100 items each = 3,000 items  
- 500 students × 50 items each = 25,000 items
- Total: ~30,000 items

Tenant-100 has: ~40,000 items

Total table: ~3 million items

Query performance for Tenant-001: Still <10ms
Why? DynamoDB ONLY scans Tenant-001's partition
```

---

## ✅ **Advantages of This Design**

### **1. Cost Efficiency**
```
Traditional (Multi-Table):
- 10 tables × $0.25/table/month = $2.50/month
- × 100 tenants = $250/month base cost
- Plus: 10× backup costs, 10× monitoring

Single-Table:
- 1 table × $0.25/table/month = $0.25/month
- 1× backup, 1× monitoring
- Pay only for actual storage/throughput
```

### **2. Operational Simplicity**
- One CloudWatch dashboard
- One backup policy
- One scaling configuration
- One disaster recovery plan

### **3. Data Modeling Flexibility**
```typescript
// Easy to add new entity types
{
  tenantId: "tenant-123",
  entityKey: "SCHOOL#xyz#COURSE#abc",  // New entity!
  entityType: "COURSE",
  // ... no schema migration needed
}
```

### **4. Tenant Migration**
```typescript
// Moving tenant to different tier = copy partition key
// All relationships preserved
// entityKey patterns stay the same
```

---

## ⚠️ **Trade-offs & Considerations**

### **Disadvantages**

1. **Complex Queries**: No SQL joins, must design access patterns carefully
2. **Learning Curve**: Team must understand single-table design
3. **Debugging**: Harder to query data in AWS Console
4. **Schema Visibility**: No obvious schema like SQL tables

### **Mitigations**

1. **GSIs**: 3-5 GSIs cover 90% of query patterns
2. **Documentation**: Clear entity diagrams & access patterns
3. **Admin Tools**: Build custom admin UI for data viewing
4. **EntityType**: Discriminator makes schema explicit

---

## 🚀 **Your Current Architecture**

```typescript
// From your codebase pattern:

Tier: Basic (shared table)
├── 100 tenants max
├── Table: saas-tenant-data-basic
└── Each tenant gets:
    ├── Schools (entityType: SCHOOL)
    ├── Academic Years (entityType: ACADEMIC_YEAR)  
    ├── Classrooms (entityType: CLASSROOM)
    ├── Assignments (entityType: ASSIGNMENT)
    ├── Grades (entityType: GRADE)
    └── Attendance (entityType: ATTENDANCE)

Isolation: tenantId (partition key)
Query: Always scoped to single tenant
Cost: Pay once, serve many
```

---

## 📝 **Best Practices You're Following**

✅ **Partition Key = tenantId**: Perfect for tenant isolation
✅ **EntityType discriminator**: Clear entity identification  
✅ **Hierarchical entityKey**: Enables parent-child queries
✅ **GSIs for access patterns**: Efficient cross-entity queries
✅ **Tier-based tables**: Isolation + performance optimization
✅ **Audit fields**: FERPA compliance built-in

---

## 🎯 **Conclusion**

**Single-table design is the RIGHT choice for multi-tenant SaaS because:**

1. **Proven at Scale**: AWS uses it for their own SaaS products
2. **Cost Effective**: 90% cost reduction vs multi-table
3. **Performance**: Sub-10ms queries regardless of table size
4. **Tenant Isolation**: Infrastructure-level security
5. **Flexible Scaling**: Easy migration between tiers
6. **Operational Excellence**: One table to rule them all

**Your tiering strategy is excellent:**
- Basic tier: Shared table (cost-optimized)
- Advanced tier: Shared table with higher limits
- Premium tier: Shared or dedicated
- Enterprise tier: Dedicated table (performance + compliance)

This is **enterprise-grade architecture** following AWS best practices! 🎉

