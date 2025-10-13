# School Service Refactoring Plan

## 📊 Current State Analysis

### ✅ New Files (Keep - Already Created)
1. `entities/school.entity.enhanced.ts` - Enhanced entities with DynamoDB keys ✅
2. `services/validation.service.ts` - Input validation ✅
3. `services/academic-year.service.ts` - Temporal boundary management ✅
4. `services/event.service.ts` - EventBridge integration ✅

### ⚠️ Old Files (Needs Refactoring)
1. `schools.service.ts` - REFACTOR (uses old entity structure, no validation, no events)
2. `schools.controller.ts` - UPDATE (add RequestContext, new endpoints)
3. `schools.module.ts` - UPDATE (add new services as providers)
4. `dto/create-school.dto.ts` - UPDATE (match enhanced entities)

### ❌ Redundant Files (Delete)
1. `entities/school.entity.ts` - REPLACE with enhanced version

---

## 🎯 Refactoring Steps

### Step 1: Delete Old Entity File
- **File:** `entities/school.entity.ts`
- **Reason:** Replaced by `school.entity.enhanced.ts`

### Step 2: Update DTOs
- **File:** `dto/create-school.dto.ts`
- **Changes:** Match enhanced entity structure (contactInfo, address objects)

### Step 3: Completely Refactor schools.service.ts
- **Changes:**
  - Use enhanced entities
  - Add validation calls
  - Use EntityKeyBuilder for keys
  - Add optimistic locking
  - Publish events
  - Add RequestContext parameter

### Step 4: Update schools.controller.ts
- **Changes:**
  - Build RequestContext from request
  - Delegate academic year endpoints to AcademicYearService
  - Add grading period endpoints
  - Add holiday endpoints

### Step 5: Update schools.module.ts
- **Changes:**
  - Add ValidationService, AcademicYearService, EventService as providers

### Step 6: Update CDK Stack for GSIs
- **File:** `server/lib/tenant-template/ecs-dynamodb.ts`
- **Changes:** Add 4 Global Secondary Indexes

---

## 📝 Detailed Implementation

### DELETE: Old Entity File

