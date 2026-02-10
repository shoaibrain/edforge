# @aibrains/shared-types Developer Guide

This package provides **Zod schemas** and **TypeScript types** shared between EdForge frontend and backend services.

## Installation

```bash
npm install @aibrains/shared-types
```

## Quick Start

### Frontend (React)

```typescript
import { 
  createStudentSchema, 
  type CreateStudentDto,
  type StudentResponseDto 
} from '@aibrains/shared-types';

// Form validation
function StudentForm() {
  const handleSubmit = (data: unknown) => {
    const result = createStudentSchema.safeParse(data);
    
    if (!result.success) {
      // Handle validation errors
      console.log(result.error.flatten());
      return;
    }
    
    // Type-safe data
    const student: CreateStudentDto = result.data;
    submitStudent(student);
  };
}
```

### Backend (NestJS)

```typescript
import { createZodDto } from 'nestjs-zod';
import { createStudentSchema, updateStudentSchema } from '@aibrains/shared-types';

// Create DTO classes from Zod schemas
export class CreateStudentDtoZ extends createZodDto(createStudentSchema) {}
export class UpdateStudentDtoZ extends createZodDto(updateStudentSchema) {}

// Use in controller
@Controller('students')
export class StudentsController {
  @Post()
  create(@Body() dto: CreateStudentDtoZ) {
    return this.service.create(dto);
  }
}
```

## Package Structure

```
src/
├── schemas/
│   ├── common.ts          # Shared schemas (pagination, address, etc.)
│   ├── identity/          # Auth, user, school, tenant schemas
│   ├── academics/         # Student, classroom, attendance, grade schemas
│   └── enrollment/        # Staff, parent, enrollment schemas
└── validators/
    ├── password.ts        # Cognito password validation
    ├── grade-level.ts     # Grade level utilities
    ├── date-range.ts      # Date validation utilities
    └── academic-year.ts   # Academic year status transitions
```

## Core Schemas

### Identity Domain

```typescript
import {
  createUserSchema,
  createSchoolSchema,
  createAcademicYearSchema,
  createDepartmentSchema,
} from '@aibrains/shared-types';
```

### Academics Domain

```typescript
import {
  createStudentSchema,
  createClassroomSchema,
  createAttendanceSchema,
  bulkAttendanceSchema,
  createGradeSchema,
  createAssignmentSchema,
} from '@aibrains/shared-types';
```

### Enrollment Domain

```typescript
import {
  createEnrollmentSchema,
  createStaffSchema,
  createParentSchema,
} from '@aibrains/shared-types';
```

## Validators

### Password Validation

```typescript
import { passwordSchema, COGNITO_PASSWORD_REQUIREMENTS } from '@aibrains/shared-types';

const result = passwordSchema.safeParse('MyP@ssw0rd!');
```

### Grade Levels

```typescript
import { 
  GRADE_LEVELS,
  isValidGradeLevel,
  getGradeLevelDisplayName,
  isGradeInRange,
} from '@aibrains/shared-types';

isValidGradeLevel('5');  // true
getGradeLevelDisplayName('5');  // "5th Grade"
isGradeInRange('5', { start: 'K', end: '8' });  // true
```

### Date Utilities

```typescript
import {
  dateSchema,
  dateRangeSchema,
  daysBetween,
  isDateInRange,
} from '@aibrains/shared-types';

daysBetween('2025-08-01', '2025-12-15');  // 136
```

### Academic Year Status

```typescript
import {
  isValidStatusTransition,
  canModifySettings,
  ACADEMIC_YEAR_STATUSES,
} from '@aibrains/shared-types';

isValidStatusTransition('planning', 'active');  // true
isValidStatusTransition('active', 'planning');  // false
canModifySettings('active');  // false
```

## Type Inference

All Zod schemas export inferred TypeScript types:

```typescript
import { z } from 'zod';
import { createStudentSchema } from '@aibrains/shared-types';

// Inferred input type (for forms)
type CreateStudentInput = z.input<typeof createStudentSchema>;

// Inferred output type (after parsing)
type CreateStudentDto = z.infer<typeof createStudentSchema>;
```

## Form Integration (React Hook Form + Zod)

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createStudentSchema, type CreateStudentDto } from '@aibrains/shared-types';

function StudentForm() {
  const form = useForm<CreateStudentDto>({
    resolver: zodResolver(createStudentSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      // ...
    },
  });
}
```

## Error Handling

```typescript
import { createStudentSchema } from '@aibrains/shared-types';

const result = createStudentSchema.safeParse(formData);

if (!result.success) {
  // Flatten errors for easy display
  const errors = result.error.flatten();
  
  // Field errors
  errors.fieldErrors.firstName;  // ["String must contain at least 2 character(s)"]
  
  // Form-level errors
  errors.formErrors;  // ["..."]
}
```

## Adding New Schemas

1. Create schema file in appropriate domain folder
2. Export from domain's `index.ts`
3. Run `npm run build` in shared-types package
4. Import in consuming packages

## Best Practices

1. **Always use safeParse** - Don't use `.parse()` in production as it throws
2. **Export types** - Always export both schema and inferred type
3. **Use refinements** - Add custom validation with `.refine()`
4. **Partial schemas** - Use `.partial()` for update DTOs
5. **Coercion** - Use `z.coerce` for query params that come as strings
