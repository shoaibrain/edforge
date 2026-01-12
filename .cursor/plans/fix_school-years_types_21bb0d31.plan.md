---
name: Fix School-Years Types
overview: Migrate the school-years module from hardcoded DTOs to proper Zod schemas in @edforge/shared-types, add missing Ed-Fi calendar schemas export, and create Ed-Fi calendar mappers for future compliance export.
todos:
  - id: create-school-year-schema
    content: Create school-year.schema.ts with SchoolYearResponseDto extending AcademicYearResponseDto
    status: completed
  - id: export-calendar-schemas
    content: Export bell-schedule, calendar-date, and school-year schemas from identity index
    status: completed
  - id: create-edfi-calendar-mapper
    content: Create Ed-Fi calendar mapper for Calendar and CalendarDate resources
    status: completed
  - id: update-school-years-service
    content: Update school-years module to import DTOs from @edforge/shared-types
    status: completed
---

# Fix School-Years Module with Proper Shared Types

## Problem Summary

The `school-years` module uses hardcoded inline DTOs instead of importing from `@edforge/shared-types`:

```typescript
// Current - Hardcoded in school-years.service.ts (lines 25-38)
export interface SchoolYearDto {
  yearId: string;
  schoolId: string;
  schoolName: string;  // Added field for aggregation
  name: string;
  ...
}
```

Meanwhile, `academic-years` properly uses shared types:

```typescript
// Correct pattern in academic-years.service.ts (lines 29-36)
import type {
  CreateAcademicYearDto,
  UpdateAcademicYearDto,
  AcademicYearResponseDto,
  ...
} from '@edforge/shared-types';
```

## Implementation Plan

### Phase 1: Create School Year Aggregation Schema

Create a new schema in [`packages/shared-types/src/schemas/identity/school-year.schema.ts`](packages/shared-types/src/schemas/identity/school-year.schema.ts):

```typescript
// School Year Response - Extends AcademicYearResponseDto with school context
export const schoolYearResponseSchema = academicYearResponseSchema.extend({
  schoolName: z.string(),
});

export const schoolYearListResponseSchema = z.object({
  items: z.array(schoolYearResponseSchema),
  total: z.number().int(),
});
```

### Phase 2: Export Missing Calendar Schemas

Update [`packages/shared-types/src/schemas/identity/index.ts`](packages/shared-types/src/schemas/identity/index.ts) to export the bell-schedule and calendar-date schemas that were created earlier but not exported:

```typescript
// Calendar Management (Ed-Fi aligned)
export * from './bell-schedule.schema';
export * from './calendar-date.schema';
export * from './school-year.schema';
```

### Phase 3: Update School-Years Module

Update [`server/application/microservices/identity/src/school-years/school-years.service.ts`](server/application/microservices/identity/src/school-years/school-years.service.ts):

1. Remove hardcoded `SchoolYearDto` and `SchoolYearsListDto` interfaces
2. Import types from `@edforge/shared-types`
3. Update response mapping to use schema types

### Phase 4: Add Ed-Fi Calendar Mapper

Create [`packages/shared-types/src/mappers/edfi/calendar.mapper.ts`](packages/shared-types/src/mappers/edfi/calendar.mapper.ts) for future Ed-Fi compliance export:

- Map `AcademicYearResponseDto` to Ed-Fi `Calendar` resource
- Map `CalendarDateResponseDto` to Ed-Fi `CalendarDate` resource
- Map `GradingPeriodResponseDto` to Ed-Fi grading period structures

## Files to Modify

| File | Change |

|------|--------|

| `packages/shared-types/src/schemas/identity/school-year.schema.ts` | NEW - Create aggregation schema |

| `packages/shared-types/src/schemas/identity/index.ts` | Export new calendar and school-year schemas |

| `packages/shared-types/src/mappers/edfi/calendar.mapper.ts` | NEW - Ed-Fi calendar mapper |

| `packages/shared-types/src/mappers/edfi/index.ts` | Export calendar mapper |

| `server/.../school-years/school-years.service.ts` | Use shared types, remove hardcoded DTOs |

| `server/.../school-years/school-years.controller.ts` | Update response type imports |

## Architecture Alignment

```mermaid
flowchart TB
    subgraph frontend [Frontend Shell Context]
        FE[React App]
    end

    subgraph identity [Identity Microservice]
        SY[school-years - Tenant Aggregation]
        AY[academic-years - Per-School Management]
    end

    subgraph sharedTypes [Shared Types Package]
        SYSchema[SchoolYearResponseDto]
        AYSchema[AcademicYearResponseDto]
        CalSchema[CalendarDateResponseDto]
    end

    subgraph edfi [Ed-Fi Mappers]
        CalMapper[calendar.mapper.ts]
    end

    FE -->|GET /school-years| SY
    SY -->|aggregates| AY
    SY -.->|uses| SYSchema
    AY -.->|uses| AYSchema
    SYSchema -->|extends| AYSchema
    AYSchema -->|maps to| CalMapper
    CalSchema -->|maps to| CalMapper
```

## Ed-Fi Alignment

The Ed-Fi calendar domain includes:

- `Calendar` - Maps from `AcademicYear` (calendar type, school year range)
- `CalendarDate` - Maps from our `CalendarDate` entity (instructional days, events)
- `CalendarGradeLevel` - Grade levels associated with calendar

This implementation positions EdForge for future Ed-Fi certification without breaking current functionality.