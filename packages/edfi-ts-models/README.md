# Ed-Fi TypeScript Data Models

TypeScript interfaces generated from Ed-Fi Data Standard JSON schemas. This package provides type-safe models organized by Ed-Fi domains for use in enterprise EMIS applications.

## Features

- ✅ **Offline Schema-First**: Uses local JSON schemas (no network required)
- ✅ **Domain-Organized**: Models organized into 17 Ed-Fi domains
- ✅ **Strict Typing**: Full TypeScript strict mode with no `any` types
- ✅ **Modular Imports**: Import specific domains or use barrel exports
- ✅ **Runtime Validation**: AJV-based validator for JSON payloads

## Installation

```bash
npm install @your-org/edfi-ts-models
```

## Usage

### Basic Import

```typescript
import { Student, School } from '@your-org/edfi-ts-models';
```

### Domain-Specific Import

```typescript
import { Student } from '@your-org/edfi-ts-models/student-identification-and-demographics';
import { Assessment } from '@your-org/edfi-ts-models/assessment';
```

### Runtime Validation

```typescript
import { validateEntity } from '@your-org/edfi-ts-models/utils/validator';

const result = await validateEntity('student', studentData);
if (result.valid) {
  console.log('Valid student data');
} else {
  console.error('Validation errors:', result.errors);
}
```

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

1. Install dependencies:
```bash
npm install
```

2. Generate TypeScript models:
```bash
npm run generate
```

3. Build the package:
```bash
npm run build
```

### Project Structure

```
edfi-ts-models/
├── schemas/                # Git-versioned raw JSON files
│   └── swagger.json
├── src/
│   ├── models/
│   │   ├── domains/        # Generated domain folders
│   │   │   ├── assessment/
│   │   │   ├── student-identification-and-demographics/
│   │   │   └── ...
│   │   └── index.ts        # Barrel export
│   ├── utils/
│   │   └── validator.ts    # Runtime validation
│   └── index.ts            # Main entry point
├── scripts/
│   ├── generate-local.ts   # Generation script
│   └── domain-mapper.ts    # Domain routing logic
└── package.json
```

## Ed-Fi Domains

The models are organized into the following domains:

- `assessment` - Assessment-related entities
- `student-identification-and-demographics` - Student core data
- `education-organization` - Schools, LEAs, etc.
- `staff` - Staff and personnel
- `teaching-and-learning` - Sections, courses, schedules
- `bell-schedule` - Bell schedules and periods
- `student-academic-record` - Grades, transcripts, report cards
- `finance` - Financial entities
- `calendar` - Academic calendars and dates
- `intervention` - Intervention programs
- `discipline` - Discipline incidents
- `attendance` - Attendance events
- `special-education` - Special education services
- `enrollment` - Enrollment and withdrawal
- `credential` - Credentials and certifications
- `program` - Educational programs
- `master-schedule` - Master scheduling

## Multi-Tenant Integration

Extend the generated interfaces in your application layer:

```typescript
import { Student } from '@your-org/edfi-ts-models';

export interface TenantStudent extends Student {
  tenantId: string;
  metadata: {
    syncTimestamp: Date;
  };
}
```

## License

Apache-2.0

