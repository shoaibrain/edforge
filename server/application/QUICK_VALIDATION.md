# Quick Validation Guide - Phase 0

## Quick Start

### 1. Install Dependencies
```bash
cd server/application
npm install
```

### 2. Run Validation Script
```bash
./validate-phase0.sh
```

Or run manually:

### Manual Validation Steps

#### A. TypeScript Type Checking
```bash
# Check all libraries
npx tsc --noEmit --project libs/http-client/tsconfig.lib.json
npx tsc --noEmit --project libs/common-utils/tsconfig.lib.json

# Check key services
npx tsc --noEmit --project microservices/school/tsconfig.app.json
npx tsc --noEmit --project microservices/enrollment/tsconfig.app.json
npx tsc --noEmit --project microservices/curriculum/tsconfig.app.json
```

#### B. Build Libraries
```bash
npm run build
```

#### C. Verify Build Output
```bash
ls -la dist/libs/http-client/
ls -la dist/libs/common-utils/
```

#### D. Check CDK Infrastructure
```bash
cd ../lib
npx tsc --noEmit shared-infra/Resources/*.ts
```

## Expected Results

✅ All TypeScript files compile without errors
✅ Build output exists in `dist/libs/`
✅ Jest configs exist for all services
✅ CDK infrastructure compiles

## Common Issues

### "Cannot find module 'axios'"
```bash
npm install axios
```

### "Cannot find module '@app/http-client'"
- Verify `tsconfig.json` has path mappings
- Check that `libs/http-client/src/index.ts` exports correctly

### "Jest config not found"
- Verify `jest.config.js` exists in each service directory
- Check that base config path is correct

## Next Steps

Once validation passes:
1. ✅ Phase 0 complete
2. → Proceed to Phase 1: Core Service Completion

