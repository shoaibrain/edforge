# Grade Data Model

## Overview

The grading system uses DynamoDB single-table design with two entity types:
- **GRADE** — Student grade for a course in a term (embedded assignments model)
- **GRADEPOLICY** — School-level grading policy (scale, category weights, rules)

## Entity: GRADE

Represents a student's grade for a specific course and term. Contains embedded arrays for
individual assignment grades and category summaries.

### Key Structure

| Key | Pattern | Example |
|-----|---------|---------|
| PK | `TENANT#{tenantId}` | `TENANT#t-001` |
| SK | `GRADE#{studentId}#{courseId}#{termId}` | `GRADE#stu-001#crs-001#term-Q1` |

### GSI Access Patterns

| GSI | PK | SK | Use Case |
|-----|----|----|----------|
| GSI1 | `TENANT#{tid}#SCHOOL#{schoolId}` | `GRADE#{courseId}#{termId}` | All grades for a course+term (teacher view) |
| GSI2 | `{studentId}` | `GRADE#{academicYearId}#{termId}` | All grades for a student in an academic year (report card, GPA) |

### Fields

```typescript
interface Grade extends BaseEntity {
  entityType: 'GRADE';
  gradeId: string;
  studentId: string;
  schoolId: string;
  courseId: string;
  sectionId?: string;
  teacherId: string;
  academicYearId: string;
  termId: string;

  // Computed grade
  numericGrade?: number;    // 0-100
  letterGrade?: GradeLetter;
  gpaPoints?: number;       // 0-4.0 (or 5.0 for weighted)
  credits?: number;

  // Embedded assignments and category summaries
  categoryGrades?: CategoryGrade[];
  assignments?: AssignmentGrade[];

  // Status
  isFinal: boolean;
  isPassFail?: boolean;
  isPassing?: boolean;

  // Comments
  teacherComment?: string;
  conductGrade?: string;
  effortGrade?: string;

  // Audit
  lastCalculatedAt?: string;
  publishedAt?: string;
}
```

### Embedded: AssignmentGrade

```typescript
interface AssignmentGrade {
  assignmentId: string;
  assignmentName: string;
  assignmentType: 'homework' | 'quiz' | 'test' | 'project' | 'participation' | 'final' | 'other';
  categoryId?: string;
  dueDate?: string;
  submittedDate?: string;
  earnedPoints?: number;
  possiblePoints: number;
  percentage?: number;
  letterGrade?: GradeLetter;
  weight?: number;
  isExtraCredit?: boolean;
  isDropped?: boolean;
  isMissing?: boolean;
  isExcused?: boolean;
  comment?: string;
  gradedBy?: string;
  gradedAt?: string;
}
```

### Embedded: CategoryGrade

```typescript
interface CategoryGrade {
  categoryId: string;
  categoryName: string;
  weight: number;
  earnedPoints: number;
  possiblePoints: number;
  percentage: number;
  letterGrade?: GradeLetter;
}
```

## Entity: GRADEPOLICY

School-level grading policy that defines how grades are calculated.

### Key Structure

| Key | Pattern | Example |
|-----|---------|---------|
| PK | `TENANT#{tenantId}` | `TENANT#t-001` |
| SK | `GRADEPOLICY#{schoolId}#{policyId}` | `GRADEPOLICY#sch-001#pol-001` |

### GSI Access Patterns

| GSI | PK | SK | Use Case |
|-----|----|----|----------|
| GSI1 | `TENANT#{tid}#SCHOOL#{schoolId}` | `GRADEPOLICY#{policyName}` | List grading policies for a school |

### Fields

```typescript
interface GradingPolicyEntity extends BaseEntity {
  entityType: 'GRADEPOLICY';
  policyId: string;
  schoolId: string;
  policyName: string;
  description?: string;
  gradingScale: GradingScaleEntry[];
  categoryWeights: CategoryWeight[];
  dropLowestScores?: { categoryId: string; count: number }[];
  roundingRule: 'up' | 'down' | 'nearest';
  minimumPassingGrade: number;
  isDefault: boolean;
  isActive: boolean;
}
```

## Grade Calculation Flow

1. Teacher records an assignment grade via `POST /academics/grades/record`
2. Service finds or creates the Grade document for student+course+term
3. Assignment is appended/updated in `assignments[]`
4. Recalculation:
   a. Look up school's grading policy
   b. Group assignments by `categoryId`
   c. Calculate category averages (handling drops, extra credit, excused)
   d. Apply category weights → overall `numericGrade`
   e. Map numeric → `letterGrade` + `gpaPoints` via grading scale
5. Updated Grade document is written back to DynamoDB

## GPA Calculation

- Query all Grade documents for a student via GSI2
- For each finalized grade: `gpaPoints × credits`
- GPA = Σ(gpaPoints × credits) / Σ(credits)
- Supports weighted GPA (honors/AP courses use higher scale)
