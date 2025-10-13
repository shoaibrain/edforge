#!/bin/bash

# =============================================================================
# EdForge School Service API Test Script
# Enterprise-Grade Multi-Tenant Education Management Information System
# =============================================================================

set -e  # Exit on any error

# Configuration - SET THESE VALUES BEFORE RUNNING
# =============================================================================
TENANT_ID="4d2b7c47-2943-4ebd-8173-841745d6a46c"                    # e.g., "f6711469-a248-45c1-be99-894454a2530d"
ACCESS_TOKEN="eyJraWQiOiJXODkwc242cmw4b0FWVURhS2RwalNadm5URmJRclhmMmlnSWZ1U01TY2NZPSIsImFsZyI6IlJTMjU2In0.eyJzdWIiOiI1NGQ4NjRiOC1jMDcxLTcwZjAtMWEzOS1mYjY0MzE1ZjYwMDciLCJjb2duaXRvOmdyb3VwcyI6WyI0ZDJiN2M0Ny0yOTQzLTRlYmQtODE3My04NDE3NDVkNmE0NmMiXSwiZW1haWxfdmVyaWZpZWQiOnRydWUsImN1c3RvbTp0ZW5hbnRUaWVyIjoiQkFTSUMiLCJpc3MiOiJodHRwczpcL1wvY29nbml0by1pZHAudXMtZWFzdC0xLmFtYXpvbmF3cy5jb21cL3VzLWVhc3QtMV9obzVEQnhPTXIiLCJjb2duaXRvOnVzZXJuYW1lIjoicmFpbnNob2FpYi00ZDJiN2M0Ny0yOTQzLTRlYmQtODE3My04NDE3NDVkNmE0NmMiLCJjdXN0b206dGVuYW50TmFtZSI6InJhaW5zaG9haWIiLCJvcmlnaW5fanRpIjoiMDBiNzNkNWEtYzA0Mi00ZDg3LWI5ZTItODQ4NmU0ZTc2NDAyIiwiY3VzdG9tOnRlbmFudElkIjoiNGQyYjdjNDctMjk0My00ZWJkLTgxNzMtODQxNzQ1ZDZhNDZjIiwiYXVkIjoiNmNzdmY1NDVjNXM2bWUzMjhmNzRhZWhqMzciLCJldmVudF9pZCI6ImVjODE5MzdlLTVkYzctNDEyZS05YTM2LWRlZjU5NTcwZWJlNCIsImN1c3RvbTp1c2VyUm9sZSI6IlRlbmFudEFkbWluIiwidG9rZW5fdXNlIjoiaWQiLCJhdXRoX3RpbWUiOjE3NjAzMDYwNzYsInBob25lX251bWJlciI6IisxMTIzNDU2Nzg5MCIsImV4cCI6MTc2MDMwOTY3NiwiaWF0IjoxNzYwMzA2MDc2LCJqdGkiOiIwMTU5NWNmNC00Mzc5LTRkOWItYWJlNy00NzVkN2VkMDI0Y2IiLCJlbWFpbCI6InJhaW5zaG9haWIwMUBnbWFpbC5jb20ifQ.ClZaiRWbLkoWuW57VeIYt3FbfDoC_96MNssvWjQCMqbC2jlIFWtsHeV3vFmJI4951sKoIavp7erTnbBp2FyJe5oX4-uO_I0cElI72kpysp1RPIEGsSAHAimPAy0NPZXkYfsw0BxQ2dMtLu3Seqb7RnMYqXjDpdCmjvpb14gDybgz8RFiA8r9LjUbujrtwdw3G5ir0piDpWTKrX2vsug9ojFk1JkLl3oBSrlE5GfbGAmvghQtV8pREql1VMupedM1PYxbDw_UTVCa8VvtaSgi-k1Xs6LiC8zSwPqtcYrEAhUdtBnuO4NPAlzIAoEPksSrE90aqVC4mK5pMKLK-l88eQ"                 # JWT token from tenant login
API_BASE_URL="https://2etoo7woae.execute-api.us-east-1.amazonaws.com/prod"                 # e.g., "https://j9tpsuz1nf.execute-api.us-east-1.amazonaws.com/prod"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# =============================================================================
# Utility Functions
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
    ((TESTS_PASSED++))
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    ((TESTS_FAILED++))
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Validate configuration
validate_config() {
    if [[ -z "$TENANT_ID" || -z "$ACCESS_TOKEN" || -z "$API_BASE_URL" ]]; then
        log_error "Missing required configuration. Please set TENANT_ID, ACCESS_TOKEN, and API_BASE_URL"
        exit 1
    fi
    log_info "Configuration validated ✓"
}

# Make HTTP request with proper headers
make_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local expected_status=$4
    
    local url="${API_BASE_URL}${endpoint}"
    local headers=(
        -H "Authorization: Bearer ${ACCESS_TOKEN}"
        -H "Content-Type: application/json"
        -H "X-Tenant-Id: ${TENANT_ID}"
    )
    
    if [[ -n "$data" ]]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "${headers[@]}" -d "$data" "$url")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "${headers[@]}" "$url")
    fi
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [[ "$http_code" == "$expected_status" ]]; then
        log_success "$method $endpoint - Status: $http_code"
        echo "$body"
        return 0
    else
        log_error "$method $endpoint - Expected: $expected_status, Got: $http_code"
        echo "$body"
        return 1
    fi
}

# =============================================================================
# Test Data Templates
# =============================================================================

# Valid school creation payload
SCHOOL_PAYLOAD='{
    "schoolName": "Test Academy International",
    "schoolCode": "TAI001",
    "schoolType": "k12",
    "contactInfo": {
        "primaryEmail": "info@testacademy.edu",
        "primaryPhone": "+1-555-0123",
        "website": "https://testacademy.edu"
    },
    "address": {
        "street": "123 Education Drive",
        "city": "San Francisco",
        "state": "CA",
        "country": "US",
        "postalCode": "94102",
        "timezone": "America/Los_Angeles"
    },
    "maxStudentCapacity": 1000,
    "gradeRange": {
        "lowestGrade": "K",
        "highestGrade": "12"
    },
    "foundedDate": "1985-09-01",
    "description": "A leading educational institution focused on innovation and excellence",
    "motto": "Learning Today, Leading Tomorrow"
}'

# Invalid school payload (missing required fields)
INVALID_SCHOOL_PAYLOAD='{
    "schoolName": "Invalid School",
    "schoolCode": "INV"
}'

# Academic year creation payload
ACADEMIC_YEAR_PAYLOAD='{
    "yearName": "2024-2025",
    "startDate": "2024-09-01",
    "endDate": "2025-06-30",
    "isCurrent": true,
    "description": "Main academic year for 2024-2025"
}'

# Department creation payload
DEPARTMENT_PAYLOAD='{
    "departmentName": "Mathematics",
    "departmentCode": "MATH",
    "headOfDepartment": "Dr. Jane Smith",
    "description": "Mathematics and Statistics Department"
}'

# =============================================================================
# Test Functions
# =============================================================================

test_school_creation() {
    log_info "Testing School Creation..."
    
    # Test valid school creation
    local school_response=$(make_request "POST" "/schools" "$SCHOOL_PAYLOAD" "201")
    if [[ $? -eq 0 ]]; then
        SCHOOL_ID=$(echo "$school_response" | jq -r '.schoolId')
        log_info "Created school with ID: $SCHOOL_ID"
    fi
    
    # Test duplicate school code
    make_request "POST" "/schools" "$SCHOOL_PAYLOAD" "409"
    
    # Test invalid payload
    make_request "POST" "/schools" "$INVALID_SCHOOL_PAYLOAD" "400"
}

test_school_retrieval() {
    log_info "Testing School Retrieval..."
    
    # Get all schools
    make_request "GET" "/schools" "" "200"
    
    # Get specific school
    if [[ -n "$SCHOOL_ID" ]]; then
        make_request "GET" "/schools/$SCHOOL_ID" "" "200"
    fi
    
    # Test non-existent school
    make_request "GET" "/schools/non-existent-id" "" "404"
}

test_school_update() {
    log_info "Testing School Update..."
    
    if [[ -n "$SCHOOL_ID" ]]; then
        local update_payload='{
            "schoolName": "Updated Test Academy International",
            "maxStudentCapacity": 1200,
            "description": "Updated description for the school"
        }'
        
        make_request "PUT" "/schools/$SCHOOL_ID" "$update_payload" "200"
    fi
}

test_academic_year_operations() {
    log_info "Testing Academic Year Operations..."
    
    if [[ -n "$SCHOOL_ID" ]]; then
        # Create academic year
        local year_response=$(make_request "POST" "/schools/$SCHOOL_ID/academic-years" "$ACADEMIC_YEAR_PAYLOAD" "201")
        if [[ $? -eq 0 ]]; then
            ACADEMIC_YEAR_ID=$(echo "$year_response" | jq -r '.academicYearId')
            log_info "Created academic year with ID: $ACADEMIC_YEAR_ID"
        fi
        
        # Get academic years
        make_request "GET" "/schools/$SCHOOL_ID/academic-years" "" "200"
        
        # Get specific academic year
        if [[ -n "$ACADEMIC_YEAR_ID" ]]; then
            make_request "GET" "/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID" "" "200"
        fi
    fi
}

test_department_operations() {
    log_info "Testing Department Operations..."
    
    if [[ -n "$SCHOOL_ID" ]]; then
        # Create department
        make_request "POST" "/schools/$SCHOOL_ID/departments" "$DEPARTMENT_PAYLOAD" "201"
        
        # Get departments
        make_request "GET" "/schools/$SCHOOL_ID/departments" "" "200"
    fi
}

test_grading_period_operations() {
    log_info "Testing Grading Period Operations..."
    
    if [[ -n "$SCHOOL_ID" && -n "$ACADEMIC_YEAR_ID" ]]; then
        local grading_period_payload='{
            "periodName": "Fall Semester",
            "startDate": "2024-09-01",
            "endDate": "2024-12-20",
            "periodType": "semester",
            "weight": 50
        }'
        
        # Create grading period
        make_request "POST" "/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/grading-periods" "$grading_period_payload" "201"
        
        # Get grading periods
        make_request "GET" "/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/grading-periods" "" "200"
    fi
}

test_holiday_operations() {
    log_info "Testing Holiday Operations..."
    
    if [[ -n "$SCHOOL_ID" && -n "$ACADEMIC_YEAR_ID" ]]; then
        local holiday_payload='{
            "holidayName": "Thanksgiving Break",
            "startDate": "2024-11-25",
            "endDate": "2024-11-29",
            "holidayType": "academic_break",
            "description": "Thanksgiving holiday break"
        }'
        
        # Create holiday
        make_request "POST" "/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/holidays" "$holiday_payload" "201"
        
        # Get holidays
        make_request "GET" "/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/holidays" "" "200"
    fi
}

test_error_handling() {
    log_info "Testing Error Handling..."
    
    # Test unauthorized access
    local unauthorized_response=$(curl -s -w "\n%{http_code}" -X GET "${API_BASE_URL}/schools" -H "Content-Type: application/json")
    local http_code=$(echo "$unauthorized_response" | tail -n1)
    if [[ "$http_code" == "401" ]]; then
        log_success "Unauthorized access properly rejected - Status: $http_code"
    else
        log_error "Unauthorized access test failed - Expected: 401, Got: $http_code"
    fi
    
    # Test malformed JSON
    make_request "POST" "/schools" '{"invalid": json}' "400"
    
    # Test missing tenant ID
    local no_tenant_response=$(curl -s -w "\n%{http_code}" -X GET "${API_BASE_URL}/schools" \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -H "Content-Type: application/json")
    local http_code=$(echo "$no_tenant_response" | tail -n1)
    if [[ "$http_code" == "400" || "$http_code" == "401" ]]; then
        log_success "Missing tenant ID properly handled - Status: $http_code"
    else
        log_error "Missing tenant ID test failed - Expected: 400/401, Got: $http_code"
    fi
}

# =============================================================================
# Main Test Execution
# =============================================================================

main() {
    echo "============================================================================="
    echo "EdForge School Service API Test Suite"
    echo "Enterprise-Grade Multi-Tenant Education Management Information System"
    echo "============================================================================="
    echo
    
    validate_config
    echo
    
    log_info "Starting comprehensive API tests..."
    echo
    
    # Core School Operations
    test_school_creation
    echo
    
    test_school_retrieval
    echo
    
    test_school_update
    echo
    
    # Academic Structure Operations
    test_academic_year_operations
    echo
    
    test_department_operations
    echo
    
    test_grading_period_operations
    echo
    
    test_holiday_operations
    echo
    
    # Error Handling
    test_error_handling
    echo
    
    # Test Summary
    echo "============================================================================="
    echo "Test Summary"
    echo "============================================================================="
    echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
    echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
    echo "Total Tests: $((TESTS_PASSED + TESTS_FAILED))"
    
    if [[ $TESTS_FAILED -eq 0 ]]; then
        echo -e "${GREEN}🎉 All tests passed! School Service is working correctly.${NC}"
        exit 0
    else
        echo -e "${RED}❌ Some tests failed. Please review the errors above.${NC}"
        exit 1
    fi
}

# =============================================================================
# Script Usage Instructions
# =============================================================================

usage() {
    echo "Usage: $0"
    echo
    echo "Before running this script, set the following variables at the top of the file:"
    echo "  TENANT_ID      - Your tenant ID (from JWT token)"
    echo "  ACCESS_TOKEN   - JWT token from tenant login"
    echo "  API_BASE_URL   - Your tenant API base URL"
    echo
    echo "Example:"
    echo "  TENANT_ID=\"f6711469-a248-45c1-be99-894454a2530d\""
    echo "  ACCESS_TOKEN=\"eyJraWQiOiJtOVwvQ3VwZXdSTzh2SVdBb3JLaVJMNU14MHBBdmZsMjRcL1BrQkM5eDhxbzA9IiwiYWxnIjoiUlMyNTYifQ...\""
    echo "  API_BASE_URL=\"https://j9tpsuz1nf.execute-api.us-east-1.amazonaws.com/prod\""
    echo
    echo "Then run: $0"
}

# Check if help is requested
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    usage
    exit 0
fi

# Run main function
main
