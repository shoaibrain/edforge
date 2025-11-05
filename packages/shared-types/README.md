# @edforge/shared-types

Shared TypeScript types for EdForge monorepo.

This package provides type-safe interfaces for DTOs and entities shared between microservices and frontend applications.

## Structure

```
packages/shared-types/
├── src/
│   ├── school/
│   │   ├── dto.ts      # Request/Response DTOs
│   │   ├── entity.ts   # Entity types
│   │   └── index.ts
│   └── index.ts
└── dist/               # Compiled output
```

## Usage

### In Microservices (NestJS)

```typescript
import type { CreateSchoolRequest } from '@edforge/shared-types';

// Use in DTOs - types match exactly
const dto: CreateSchoolRequest = {
  schoolName: 'Example School',
  // ...
};
```

### In Frontend (Next.js)

```typescript
import type { School, CreateSchoolRequest } from '@edforge/shared-types';

// Use in server actions - no manual mapping needed
export async function createSchool(data: CreateSchoolRequest): Promise<School> {
  const response = await api.post('/schools', data);
  return response;
}
```

## Development

### Build

```bash
npm run build
```

### Watch Mode (for development)

```bash
npm run watch
```

### Validate Sync with Backend DTOs

```bash
npm run validate:sync
```

This script checks that shared types match the NestJS DTO classes in the microservices.

## Adding New Types

When adding new DTOs or entities:

1. **Extract from NestJS DTO**: Copy the DTO class from the microservice
2. **Convert to Interface**: Remove all decorators (`@IsString()`, etc.)
3. **Add JSDoc**: Document validation rules in comments
4. **Update Index**: Export from `src/school/index.ts` and `src/index.ts`
5. **Validate**: Run `npm run validate:sync` to ensure types match

### Example: Extracting a DTO

**Backend DTO (NestJS)**:
```typescript
export class CreateGradingPeriodDto {
  @IsString()
  periodName: string;

  @IsEnum(['semester', 'quarter', 'trimester', 'custom'])
  periodType: 'semester' | 'quarter' | 'trimester' | 'custom';

  @IsOptional()
  @IsString()
  gradesDueDate?: string;
}
```

**Shared Type**:
```typescript
/**
 * Create Grading Period Request
 * @validation - periodName: required, string
 * @validation - periodType: required, enum ['semester', 'quarter', 'trimester', 'custom']
 * @validation - gradesDueDate: optional, string (YYYY-MM-DD format)
 */
export interface CreateGradingPeriodRequest {
  periodName: string;
  periodType: 'semester' | 'quarter' | 'trimester' | 'custom';
  gradesDueDate?: string;
}
```

## Rules for Extraction

1. **Remove all decorators** - Keep only type information
2. **Preserve property names** - Must match backend DTO exactly
3. **Keep optional modifiers** - Use `?` for optional fields
4. **Preserve union types** - Keep enums and union types as-is
5. **Add JSDoc comments** - Document validation rules for reference

## Sync Process

1. Make changes to DTO in microservice
2. Update corresponding interface in this package
3. Run `npm run validate:sync` to verify
4. Build package: `npm run build`
5. Update frontend/server actions to use new types

## Type Safety

This package ensures:
- ✅ Zero manual type mapping in server actions
- ✅ TypeScript errors if backend DTO changes without updating shared types
- ✅ Frontend types always match backend DTOs
- ✅ Single source of truth for API contracts

## Build Integration

The package is automatically built:
- Before microservice builds (via `scripts/build-application.sh`)
- Before frontend builds (via `prebuild` script in `client/edforgewebclient/package.json`)
- In Docker builds (multi-stage build in `Dockerfile.school`)

## Versioning

Currently using version `1.0.0`. When APIs change significantly, consider:
- Incrementing version number
- Documenting breaking changes
- Tagging releases for external consumers

## Troubleshooting

### Type errors after DTO changes

1. Run `npm run validate:sync` to find mismatches
2. Update shared types to match DTOs
3. Rebuild: `npm run build`
4. Restart TypeScript server in your IDE

### Build fails in Docker

Ensure:
- Shared-types is built before microservice build
- Docker build context includes `packages/` directory
- Path mappings in `tsconfig.json` are correct

### Import errors

Check:
- TypeScript path mappings in `tsconfig.json`
- Package is built (`dist/` exists)
- Workspace is properly configured in root `package.json`

