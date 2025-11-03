# Academic Service - Architecture Pattern Analysis

## 🎯 **Key Findings from School Service**

### 1. **Entity Type Pattern**
Every entity has an **explicit `entityType` field** as a discriminator:

```typescript
// From school.entity.enhanced.ts
export interface BaseEntity {
  tenantId: string;        // PK
  entityKey: string;       // SK - hierarchical composite key
  entityType: string;      // ✅ DISCRIMINATOR - identifies entity type
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

// Concrete implementations use LITERAL types
export interface School extends BaseEntity {
  entityType: 'SCHOOL';    // ✅ Literal string type
  entityKey: string;       // Format: SCHOOL#schoolId
  // ... rest of fields
}

export interface AcademicYear extends BaseEntity {
  entityType: 'ACADEMIC_YEAR';  // ✅ Literal string type
  entityKey: string;            // Format: SCHOOL#schoolId#YEAR#yearId
  // ... rest of fields
}
```

### 2. **EntityKey Format (Hierarchical)**
```
SCHOOL#schoolId
SCHOOL#schoolId#CONFIG
SCHOOL#schoolId#YEAR#yearId
SCHOOL#schoolId#YEAR#yearId#PERIOD#periodId
SCHOOL#schoolId#YEAR#yearId#HOLIDAY#holidayId
SCHOOL#schoolId#DEPT#deptId
SCHOOL#schoolId#DEPT#deptId#BUDGET#yearId
LOG#schoolId#timestamp#activityId
```

### 3. **GSI Key Patterns**
```typescript
// GSI1: Entity-scentric (all data for a school/entity)
gsi1pk: schoolId
gsi1sk: METADATA#schoolId  // or specific entity pattern

// GSI2: Parent-child relationships
gsi2pk: schoolId#yearId
gsi2sk: PERIOD#periodId

// GSI3: Tenant-wide queries
gsi3pk: tenantId#SCHOOL
gsi3sk: status#createdAt  // For filtering and sorting

// GSI4: Time-series
gsi4pk: DATE#YYYY-MM-DD
gsi4sk: ACTIVITY#timestamp#id
```

### 4. **Service Layer Pattern**
```typescript
// In schools.service.ts
const school: School = {
  tenantId,
  entityKey: EntityKeyBuilder.school(schoolId),
  entityType: 'SCHOOL',  // ✅ Always set explicitly
  schoolId,
  // ... all other fields
  createdAt: timestamp,
  createdBy: context.userId,
  updatedAt: timestamp,
  updatedBy: context.userId,
  version: 1,
  gsi1pk: schoolId,
  gsi1sk: `METADATA#${schoolId}`,
  gsi3pk: `${tenantId}#SCHOOL`,
  gsi3sk: `active#${timestamp}`
};
```

## 🔧 **Required Changes for Academic Service**

### ❌ **Current Issues**
1. **Missing explicit `entityType` in entities** - We only have it as a property name, not a discriminator
2. **Wrong EntityKeyBuilder usage** - Our keys don't match the pattern
3. **GSI keys not following convention** - Our GSI keys are too simplistic
4. **BaseEntity definition incomplete** - Missing `entityType` field

### ✅ **Correct Pattern for Academic**

```typescript
// academic.entity.ts (corrected)
export interface BaseEntity {
  tenantId: string;
  entityKey: string;
  entityType: string;  // ✅ ADD THIS
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface Classroom extends BaseEntity {
  entityType: 'CLASSROOM';  // ✅ Literal type
  entityKey: string;        // Format: SCHOOL#schoolId#YEAR#yearId#CLASSROOM#classroomId
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  // ... rest
}

export interface Assignment extends BaseEntity {
  entityType: 'ASSIGNMENT';  // ✅ Literal type
  entityKey: string;         // Format: SCHOOL#schoolId#YEAR#yearId#CLASSROOM#classroomId#ASSIGNMENT#assignmentId
  assignmentId: string;
  schoolId: string;
  academicYearId: string;
  classroomId: string;
  // ... rest
}

export interface Grade extends BaseEntity {
  entityType: 'GRADE';  // ✅ Literal type
  entityKey: string;    // Format: SCHOOL#schoolId#YEAR#yearId#STUDENT#studentId#ASSIGNMENT#assignmentId#GRADE
  gradeId: string;
  schoolId: string;
  academicYearId: string;
  studentId: string;
  assignmentId: string;
  // ... rest
}

export interface AttendanceRecord extends BaseEntity {
  entityType: 'ATTENDANCE';  // ✅ Literal type
  entityKey: string;         // Format: SCHOOL#schoolId#YEAR#yearId#CLASSROOM#classroomId#DATE#date#STUDENT#studentId
  attendanceId: string;
  schoolId: string;
  academicYearId: string;
  classroomId: string;
  studentId: string;
  date: string;
  // ... rest
}
```

### ✅ **EntityKeyBuilder (corrected)**
```typescript
export class EntityKeyBuilder {
  static classroom(schoolId: string, academicYearId: string, classroomId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#CLASSROOM#${classroomId}`;
  }
  
  static assignment(schoolId: string, academicYearId: string, classroomId: string, assignmentId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#CLASSROOM#${classroomId}#ASSIGNMENT#${assignmentId}`;
  }
  
  static grade(schoolId: string, academicYearId: string, studentId: string, assignmentId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#STUDENT#${studentId}#ASSIGNMENT#${assignmentId}#GRADE`;
  }
  
  static attendance(schoolId: string, academicYearId: string, classroomId: string, date: string, studentId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#CLASSROOM#${classroomId}#DATE#${date}#STUDENT#${studentId}`;
  }
}
```

### ✅ **Service Layer (corrected)**
```typescript
// classroom.service.ts
const classroom: Classroom = {
  tenantId,
  entityKey: EntityKeyBuilder.classroom(schoolId, academicYearId, classroomId),
  entityType: 'CLASSROOM',  // ✅ Always set
  classroomId,
  schoolId,
  academicYearId,
  name: createDto.name,
  // ... all other fields
  createdAt: timestamp,
  createdBy: context.userId,
  updatedAt: timestamp,
  updatedBy: context.userId,
  version: 1,
  gsi1pk: `${schoolId}#${academicYearId}`,
  gsi1sk: `CLASSROOM#${classroomId}`,
  gsi2pk: `${createDto.teacherId}#${academicYearId}`,
  gsi2sk: `CLASSROOM#${classroomId}`,
};
```

## 📋 **Implementation Plan**

### Phase 1: Fix Entity Definitions (4 files)
1. ✅ Add `entityType: string` to BaseEntity
2. ✅ Add literal `entityType` to each concrete entity
3. ✅ Verify EntityKeyBuilder formats match school service pattern

### Phase 2: Fix Service Layer (4 files)
1. ✅ Ensure `entityType` is set when creating entities
2. ✅ Verify all GSI keys follow convention
3. ✅ Ensure entityKey uses EntityKeyBuilder

### Phase 3: Update Controllers (Already Done)
- ✅ Classroom controller updated
- ⏳ Assignment controller needs auth updates
- ⏳ Grading controller needs auth updates  
- ⏳ Attendance controller needs auth updates

### Phase 4: Build & Test
- ⏳ Run `npm run build academic`
- ⏳ Fix TypeScript errors
- ⏳ Verify patterns match school service

## 🎯 **Success Criteria**
1. All entities have explicit `entityType` field
2. All entity keys follow hierarchical pattern
3. GSI keys follow school service conventions
4. Service layer creates entities correctly
5. Code compiles without errors
6. Pattern consistency with school service

