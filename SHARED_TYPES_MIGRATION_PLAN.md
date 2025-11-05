# Shared Types Migration Plan - Monorepo Type Safety

**Last Updated**: 2025-11-04  
**Purpose**: Establish a scalable, type-safe approach to sharing DTOs and types between microservices and frontend in the EdForge monorepo

---

## Current State Analysis

### Current Problems
1. **Manual Type Mapping**: Frontend manually maps DTO field names (e.g., `gradesDueDate` vs `gradeEntryDeadline`)
2. **Type Duplication**: DTOs defined in server microservices, types redefined in frontend
3. **No Type Safety**: Changes to backend DTOs don't automatically update frontend types
4. **Maintenance Burden**: Must manually keep frontend types in sync with backend

### Current Architecture
```
edforge/
├── server/
│   └── application/
│       └── microservices/
│           ├── school/src/schools/dto/school.dto.ts
│           ├── user/src/users/dto/user.dto.ts
│           └── academic/src/.../dto/...
└── client/
    └── edforgewebclient/
        └── src/types/
            ├── school.ts
            ├── user.ts
            └── academic.ts
```

---

## Solution Options

### Option 1: Shared TypeScript Package (Recommended) ⭐
**Best for**: Monorepo with npm/yarn workspaces

**Structure**:
```
edforge/
├── packages/
│   └── shared-types/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── school/
│       │   │   ├── dto.ts          # Request DTOs (interfaces)
│       │   │   ├── entity.ts      # Entity types
│       │   │   └── index.ts
│       │   ├── user/
│       │   ├── academic/
│       │   └── index.ts
│       └── dist/                 # Compiled JS + .d.ts
├── server/
│   └── application/
│       └── microservices/
│           └── school/src/schools/dto/
│               └── school.dto.ts  # Export types to shared package
└── client/
    └── edforgewebclient/
        └── src/types/             # Import from shared package
```

**Pros**:
- ✅ Single source of truth
- ✅ Type safety across entire monorepo
- ✅ Works with npm/yarn workspaces
- ✅ Can be published as npm package for external consumers
- ✅ Supports loose coupling (can deploy independently)

**Cons**:
- ⚠️ Requires build step for shared package
- ⚠️ Need to extract types from NestJS DTO classes (remove decorators)

**Implementation**:
1. Create `packages/shared-types` workspace
2. Extract DTOs as TypeScript interfaces (no decorators)
3. Export from microservices to shared package
4. Import in frontend from shared package

---

### Option 2: Code Generation from OpenAPI/Swagger
**Best for**: Contract-first development

**Structure**:
```
edforge/
├── contracts/
│   └── openapi/
│       └── tenant-api-prod.json
├── scripts/
│   └── generate-types.sh          # Runs openapi-generator
└── server/lib/
    └── tenant-api-prod.json       # Source of truth
```

**Pros**:
- ✅ Single source of truth (OpenAPI spec)
- ✅ Automatic type generation
- ✅ Supports multiple languages (TypeScript, Java, Python)
- ✅ API documentation always in sync

**Cons**:
- ⚠️ Requires maintaining OpenAPI spec manually
- ⚠️ Generated types may not match NestJS DTOs exactly
- ⚠️ Need to keep OpenAPI spec in sync with code

**Tools**:
- `@openapitools/openapi-generator-cli`
- `swagger-codegen`
- `openapi-typescript`

---

### Option 3: TypeScript Path Mapping (Shared Folder)
**Best for**: Simple monorepo without workspaces

**Structure**:
```
edforge/
├── shared/
│   └── types/
│       ├── school.ts
│       ├── user.ts
│       └── academic.ts
├── server/
│   └── tsconfig.json              # paths: { "@shared/*": ["../shared/*"] }
└── client/
    └── edforgewebclient/
        └── tsconfig.json           # paths: { "@shared/*": ["../../shared/*"] }
```

**Pros**:
- ✅ Simple, no build step
- ✅ Direct TypeScript imports
- ✅ Works with existing TypeScript config

**Cons**:
- ⚠️ Less structured than a package
- ⚠️ Harder to version independently
- ⚠️ No npm package benefits

---

## Recommended Approach: Hybrid (Option 1 + Option 3)

**Phase 1**: Start with shared folder (quick win)
**Phase 2**: Migrate to shared package (scalable)

---

## Implementation Plan

### Phase 1: Shared Types Folder (Quick Win - 2-3 days)

**Goal**: Eliminate manual type mapping, establish single source of truth

#### Step 1.1: Create Shared Types Structure
```bash
mkdir -p shared/types/{school,user,academic}
```

#### Step 1.2: Extract DTOs as Interfaces
Create `shared/types/school/dto.ts`:
```typescript
// Extracted from CreateGradingPeriodDto (no decorators)
export interface CreateGradingPeriodRequest {
  periodName: string;
  periodType: 'semester' | 'quarter' | 'trimester' | 'custom';
  periodNumber: number;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
  instructionalDays?: number;
  gradesDueDate?: string;  // Matches backend DTO exactly
  reportCardDate?: string;
}

export interface CreateHolidayRequest {
  name: string;
  type: 'holiday' | 'professional_day' | 'weather_closure' | 'emergency';
  startDate: string;
  endDate: string;
  allDay?: boolean;
  description?: string;
  isRecurring?: boolean;
  affectsAttendance?: boolean;
  affectsPayroll?: boolean;
}

// ... more DTOs
```

#### Step 1.3: Configure TypeScript Paths

**server/tsconfig.json**:
```json
{
  "compilerOptions": {
    "paths": {
      "@shared/types/*": ["../shared/types/*"]
    }
  }
}
```

**client/edforgewebclient/tsconfig.json**:
```json
{
  "compilerOptions": {
    "paths": {
      "@shared/types/*": ["../../shared/types/*"]
    }
  }
}
```

#### Step 1.4: Update Frontend Imports
```typescript
// Before
import type { CreateGradingPeriodRequest } from '@/types/school';

// After
import type { CreateGradingPeriodRequest } from '@shared/types/school/dto';
```

#### Step 1.5: Update Server Actions
```typescript
// Remove manual mapping - use shared types directly
export async function createGradingPeriodAction(
  schoolId: string,
  academicYearId: string,
  periodData: CreateGradingPeriodRequest  // From @shared/types
): Promise<GradingPeriod> {
  // No mapping needed - types match exactly
  const response = await serverApiClient.post<GradingPeriod>(
    `/schools/${schoolId}/academic-years/${academicYearId}/grading-periods`,
    periodData  // Direct pass-through
  );
  return response;
}
```

#### Step 1.6: Create Sync Script
```bash
# scripts/sync-dtos.sh
# Extracts DTOs from microservices to shared/types
# Run after DTO changes in microservices
```

**Benefits**:
- ✅ Immediate type safety
- ✅ No build step needed
- ✅ Works with existing setup
- ✅ Can migrate incrementally

---

### Phase 2: Shared TypeScript Package (Scalable - 1 week)

**Goal**: Independent versioning, npm package support, better structure

#### Step 2.1: Create Workspace Package
```bash
mkdir -p packages/shared-types
cd packages/shared-types
npm init -y
```

**packages/shared-types/package.json**:
```json
{
  "name": "@edforge/shared-types",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

#### Step 2.2: Configure Root Workspaces

**package.json** (root):
```json
{
  "name": "edforge-monorepo",
  "private": true,
  "workspaces": [
    "packages/*",
    "server",
    "client/edforgewebclient"
  ]
}
```

#### Step 2.3: Move Types to Package
```bash
mv shared/types/* packages/shared-types/src/
```

#### Step 2.4: Build and Link
```bash
cd packages/shared-types
npm run build
# Package is automatically linked via workspaces
```

#### Step 2.5: Update Imports
```typescript
// All packages import from workspace
import type { CreateGradingPeriodRequest } from '@edforge/shared-types';
```

**Benefits**:
- ✅ Independent versioning
- ✅ Can publish as npm package
- ✅ Better structure for large codebase
- ✅ Supports loose coupling

---

## Migration Steps (Detailed)

### Step 1: Fix Current TypeScript Error ✅
- [x] Fix `api-errors.ts` type error (completed)

### Step 2: Create Shared Types Folder
- [ ] Create `shared/types/` directory structure
- [ ] Extract DTOs from `school.dto.ts` to `shared/types/school/dto.ts`
- [ ] Extract DTOs from `user.dto.ts` to `shared/types/user/dto.ts`
- [ ] Extract DTOs from `academic` microservice to `shared/types/academic/dto.ts`

### Step 3: Configure TypeScript Paths
- [ ] Update `server/tsconfig.json` with path mapping
- [ ] Update `client/edforgewebclient/tsconfig.json` with path mapping
- [ ] Test imports work from both locations

### Step 4: Update Frontend to Use Shared Types
- [ ] Remove duplicate types from `client/edforgewebclient/src/types/school.ts`
- [ ] Update imports in `school-actions.ts` to use shared types
- [ ] Update dialog components to use shared types
- [ ] Remove manual DTO mapping code

### Step 5: Update Microservices to Export Types
- [ ] Create type exports in microservice DTO files
- [ ] Ensure DTOs match shared type definitions
- [ ] Add validation to ensure sync

### Step 6: Create Sync Script (Optional)
- [ ] Create `scripts/sync-dtos.sh` to extract types from DTOs
- [ ] Add pre-commit hook to ensure types are synced
- [ ] Document sync process

### Step 7: Phase 2 Migration (Future)
- [ ] Convert shared folder to workspace package
- [ ] Set up npm workspaces in root
- [ ] Publish package for external use (if needed)

---

## DTO Extraction Strategy

### From NestJS Class to TypeScript Interface

**Backend DTO (NestJS)**:
```typescript
export class CreateGradingPeriodDto {
  @IsString()
  periodName: string;

  @IsEnum(['semester', 'quarter', 'trimester', 'custom'])
  periodType: 'semester' | 'quarter' | 'trimester' | 'custom';

  @IsNumber()
  @Min(1)
  periodNumber: number;

  @IsString()
  startDate: string;

  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}
```

**Shared Type (TypeScript Interface)**:
```typescript
export interface CreateGradingPeriodRequest {
  periodName: string;
  periodType: 'semester' | 'quarter' | 'trimester' | 'custom';
  periodNumber: number;
  startDate: string;
  isCurrent?: boolean;
}
```

**Rules**:
1. Remove all decorators (`@IsString()`, `@IsEnum()`, etc.)
2. Keep property names exactly as-is
3. Keep type annotations exactly as-is
4. Keep optional modifiers (`?`)
5. Remove validation-only information (min/max can be documented in comments)

---

## Automation Script

### `scripts/extract-dtos.sh`
```bash
#!/bin/bash
# Extracts DTOs from microservices to shared/types

# Extract school DTOs
echo "Extracting school DTOs..."
# Use grep/awk or TypeScript AST parser to extract interfaces

# Extract user DTOs
echo "Extracting user DTOs..."

# Extract academic DTOs
echo "Extracting academic DTOs..."

echo "✅ DTO extraction complete"
```

### Alternative: TypeScript AST Parser
```typescript
// scripts/extract-dtos.ts
import * as ts from 'typescript';
import * as fs from 'fs';

// Parse DTO file, extract class properties, generate interface
```

---

## Validation & Testing

### Type Safety Tests
```typescript
// tests/type-safety.test.ts
import type { CreateGradingPeriodRequest } from '@shared/types/school/dto';
import { CreateGradingPeriodDto } from '@server/microservices/school/dto';

// Ensure shared type matches DTO structure
type DtoKeys = keyof CreateGradingPeriodDto;
type RequestKeys = keyof CreateGradingPeriodRequest;

// TypeScript compile-time check
const _: DtoKeys = {} as RequestKeys;  // Should compile if types match
```

### Sync Verification
```bash
# scripts/verify-dto-sync.sh
# Compares backend DTOs with shared types
# Fails if mismatches found
```

---

## Deployment Strategy

### Loose Coupling
Since shared types are in a folder (Phase 1) or workspace package (Phase 2):

1. **Frontend Build**: Reads from `shared/types/` or `@edforge/shared-types`
2. **Server Build**: Uses same types for validation
3. **Independent Deployment**: 
   - Frontend can deploy without rebuilding server
   - Server can deploy without rebuilding frontend
   - Types are read at build time, not runtime

### CI/CD Integration
```yaml
# .github/workflows/build.yml
- name: Build shared types
  run: cd packages/shared-types && npm run build

- name: Build frontend
  run: cd client/edforgewebclient && npm run build
  # Uses built shared types

- name: Build server
  run: cd server && npm run build
  # Uses built shared types
```

---

## Best Practices

1. **Single Source of Truth**: Backend DTOs are the source, shared types are extracted
2. **Type First**: Define types in shared location, use in both places
3. **Validation**: Run sync verification in CI/CD
4. **Documentation**: Document type changes in commit messages
5. **Versioning**: Tag shared types package versions when APIs change

---

## Success Metrics

- ✅ Zero manual type mapping in server actions
- ✅ TypeScript errors if backend DTO changes without updating shared types
- ✅ Frontend types always match backend DTOs
- ✅ Build time < 5 seconds for shared types
- ✅ No runtime overhead (types compile away)

---

## Timeline Estimate

- **Phase 1 (Shared Folder)**: 2-3 days
- **Phase 2 (Shared Package)**: 1 week (can be done later)
- **Total**: 3-5 days for immediate type safety

---

## Next Steps

1. ✅ Fix TypeScript error (completed)
2. Create `shared/types/` structure
3. Extract first DTO (CreateGradingPeriodRequest) as proof of concept
4. Update one server action to use shared type
5. Validate approach works
6. Roll out to all DTOs incrementally

