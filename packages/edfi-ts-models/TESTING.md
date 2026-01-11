# Testing Guide

## Prerequisites

Before testing, install dependencies:

```bash
npm install
```

## Running the Generator

To test the generator:

```bash
npm run generate
```

This will:
1. Read `schemas/swagger.json`
2. Process all `edFi_*` schemas
3. Generate TypeScript interfaces in `src/models/domains/`
4. Create barrel export files

## Expected Output

The generator should:
- Process ~471 Ed-Fi entities
- Route entities to appropriate domains
- Generate TypeScript interfaces with strict typing
- Create domain barrel exports
- Create root barrel exports

## Verification

After generation, verify:

1. **Domain folders exist**: Check `src/models/domains/` for all 17 domains
2. **Interfaces generated**: Each domain folder should contain `.ts` files
3. **Barrel exports**: Each domain should have an `index.ts` file
4. **Root exports**: `src/models/index.ts` and `src/index.ts` should be populated

## Build Test

After generation, test the build:

```bash
npm run build
```

This should compile all TypeScript files to `dist/` without errors.

## Domain Mapper Test

The domain mapper has been verified with sample entities:
- `edFi_assessment` → `assessment`
- `edFi_student` → `student-identification-and-demographics`
- `edFi_school` → `education-organization`
- `edFi_staff` → `staff`
- `edFi_section` → `teaching-and-learning`
- `edFi_bellSchedule` → `bell-schedule`
- `edFi_reportCard` → `student-academic-record`
- `edFi_balanceSheetDimension` → `finance`
- And more...

## Known Limitations

- Some entities may be mapped to `common` domain if they don't match any pattern
- The generator will log warnings for unmapped entities
- Full testing requires network access for `npm install`

