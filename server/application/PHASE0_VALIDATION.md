# Phase 0: Foundation & Infrastructure - Validation Checklist

## Pre-Validation Setup

### 1. Install Dependencies
```bash
cd server/application
npm install
```

### 2. Verify New Dependencies
- ✅ `axios` - HTTP client library
- ✅ `jest` - Testing framework
- ✅ `ts-jest` - TypeScript support for Jest
- ✅ `@types/jest` - Jest TypeScript types
- ✅ `@types/axios` - Axios TypeScript types

## Validation Steps

### Step 1: TypeScript Type Checking

Run type checking for all libraries and services:

```bash
# Check all libraries
npx tsc --noEmit --project libs/http-client/tsconfig.lib.json
npx tsc --noEmit --project libs/common-utils/tsconfig.lib.json

# Check all services
npx tsc --noEmit --project microservices/school/tsconfig.app.json
npx tsc --noEmit --project microservices/enrollment/tsconfig.app.json
npx tsc --noEmit --project microservices/curriculum/tsconfig.app.json
npx tsc --noEmit --project microservices/assessment/tsconfig.app.json
npx tsc --noEmit --project microservices/attendance/tsconfig.app.json
npx tsc --noEmit --project microservices/finance/tsconfig.app.json
npx tsc --noEmit --project microservices/staff/tsconfig.app.json
npx tsc --noEmit --project microservices/parent-portal/tsconfig.app.json
npx tsc --noEmit --project microservices/analytics/tsconfig.app.json

# Or check everything at once
npx tsc --noEmit
```

### Step 2: Build All Libraries

```bash
# Build shared libraries
npm run build

# Verify build output exists
ls -la dist/libs/http-client/
ls -la dist/libs/common-utils/
```

### Step 3: Verify Path Mappings

Ensure TypeScript path mappings work correctly:

```bash
# This should not show any import errors
npx tsc --noEmit --project tsconfig.json
```

### Step 4: Lint Check

```bash
# Run linter (if configured)
npm run lint
```

### Step 5: Test Compilation

Verify Jest can compile test files:

```bash
# Test compilation for one service
npm run test:school -- --no-coverage --listTests

# Should list test files without errors
```

### Step 6: CDK Validation

Validate CDK infrastructure code:

```bash
cd server/lib
npm run build  # If CDK has build script
# Or
npx tsc --noEmit
```

## Expected Results

### ✅ TypeScript Compilation
- All libraries compile without errors
- All services compile without errors
- No import resolution errors
- Path mappings work correctly

### ✅ Build Output
- `dist/libs/http-client/` contains compiled files
- `dist/libs/common-utils/` contains compiled files
- All services build successfully

### ✅ Test Infrastructure
- Jest configs load without errors
- Test helpers are accessible
- Mock utilities work correctly

### ✅ CDK Infrastructure
- All CDK files compile
- No TypeScript errors in infrastructure code
- EventBridge resources are properly defined

## Common Issues & Fixes

### Issue: "Cannot find module '@app/http-client'"
**Fix**: Verify path mappings in `tsconfig.json`:
```json
"@app/http-client": ["libs/http-client/src"]
```

### Issue: "Cannot find module 'axios'"
**Fix**: Run `npm install axios`

### Issue: "Jest config not found"
**Fix**: Verify `jest.config.js` files exist in each service directory

### Issue: "Type errors in CDK files"
**Fix**: Ensure CDK dependencies are installed in `server/lib`

## Pre-Phase 1 Checklist

Before moving to Phase 1, ensure:

- [ ] All TypeScript files compile without errors
- [ ] All libraries build successfully
- [ ] Path mappings work for `@app/http-client` and `@app/common-utils`
- [ ] Services can import shared utilities
- [ ] Jest configurations are valid
- [ ] CDK infrastructure compiles
- [ ] No linting errors
- [ ] Dependencies are installed (`npm install` completed)

## Next Steps After Validation

Once validation passes:

1. **Phase 1: Core Service Completion**
   - Implement Finance HTTP client (replace stub)
   - Complete Staff Service CRUD operations
   - Complete Parent Portal Service CRUD operations

2. **Integration Testing**
   - Test HTTP client with real services
   - Verify EventBridge rules work
   - Test circuit breaker behavior

3. **Documentation**
   - Update API documentation
   - Document HTTP client usage
   - Document shared utilities

