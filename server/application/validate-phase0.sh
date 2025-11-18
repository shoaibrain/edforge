#!/bin/bash

# Phase 0 Validation Script
# Validates TypeScript compilation, builds, and test infrastructure

set -e  # Exit on error

echo "=========================================="
echo "Phase 0: Foundation & Infrastructure"
echo "Validation Script"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track errors
ERRORS=0

# Function to check command result
check_result() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
    else
        echo -e "${RED}✗${NC} $1"
        ERRORS=$((ERRORS + 1))
    fi
}

echo "Step 1: Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    check_result "Dependencies installed"
else
    echo -e "${GREEN}✓${NC} Dependencies already installed"
fi

echo ""
echo "Step 2: TypeScript Type Checking..."

echo "  Checking http-client library..."
npx tsc --noEmit --project libs/http-client/tsconfig.lib.json 2>&1 | head -20
check_result "http-client library type check"

echo "  Checking common-utils library..."
npx tsc --noEmit --project libs/common-utils/tsconfig.lib.json 2>&1 | head -20
check_result "common-utils library type check"

echo "  Checking school service..."
npx tsc --noEmit --project microservices/school/tsconfig.app.json 2>&1 | head -20
check_result "school service type check"

echo "  Checking enrollment service..."
npx tsc --noEmit --project microservices/enrollment/tsconfig.app.json 2>&1 | head -20
check_result "enrollment service type check"

echo "  Checking curriculum service..."
npx tsc --noEmit --project microservices/curriculum/tsconfig.app.json 2>&1 | head -20
check_result "curriculum service type check"

echo "  Checking assessment service..."
npx tsc --noEmit --project microservices/assessment/tsconfig.app.json 2>&1 | head -20
check_result "assessment service type check"

echo "  Checking attendance service..."
npx tsc --noEmit --project microservices/attendance/tsconfig.app.json 2>&1 | head -20
check_result "attendance service type check"

echo ""
echo "Step 3: Building libraries..."
npm run build 2>&1 | tail -30
check_result "Build completed"

echo ""
echo "Step 4: Verifying build output..."
if [ -d "dist/libs/http-client" ]; then
    echo -e "${GREEN}✓${NC} http-client build output exists"
else
    echo -e "${RED}✗${NC} http-client build output missing"
    ERRORS=$((ERRORS + 1))
fi

if [ -d "dist/libs/common-utils" ]; then
    echo -e "${GREEN}✓${NC} common-utils build output exists"
else
    echo -e "${RED}✗${NC} common-utils build output missing"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "Step 5: Checking Jest configurations..."
for service in school enrollment curriculum assessment attendance finance staff parent-portal analytics; do
    if [ -f "microservices/$service/jest.config.js" ]; then
        echo -e "${GREEN}✓${NC} $service jest.config.js exists"
    else
        echo -e "${RED}✗${NC} $service jest.config.js missing"
        ERRORS=$((ERRORS + 1))
    fi
done

echo ""
echo "Step 6: Checking test infrastructure..."
for service in school enrollment curriculum assessment attendance finance staff parent-portal analytics; do
    if [ -f "microservices/$service/test/setup.ts" ]; then
        echo -e "${GREEN}✓${NC} $service test/setup.ts exists"
    else
        echo -e "${YELLOW}⚠${NC} $service test/setup.ts missing (optional)"
    fi
done

echo ""
echo "Step 7: Checking CDK infrastructure..."
cd ../lib
if npx tsc --noEmit shared-infra/Resources/*.ts 2>&1 | grep -q "error"; then
    echo -e "${RED}✗${NC} CDK infrastructure has TypeScript errors"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✓${NC} CDK infrastructure compiles"
fi
cd ../application

echo ""
echo "=========================================="
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓ All validations passed!${NC}"
    echo ""
    echo "Phase 0 is ready for Phase 1 implementation."
    exit 0
else
    echo -e "${RED}✗ Found $ERRORS error(s)${NC}"
    echo ""
    echo "Please fix the errors above before proceeding to Phase 1."
    exit 1
fi

