#!/bin/bash
# ============================================================
# EdForge API Comprehensive Test Suite
# ============================================================
#
# This script tests all EdForge API endpoints including:
# - Authentication (login, token verification)
# - Identity Service (schools, users, academic years)
# - Academics Service (students, enrollments)
# - Error handling and edge cases
#
# Usage:
#   ./scripts/api-test.sh
#
# ============================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="https://jjz4fkqxvd.execute-api.us-east-2.amazonaws.com/prod"
EMAIL="rainshoaib01@gmail.com"
PASSWORD="Blender_021021"

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Store created resource IDs for cleanup
CREATED_SCHOOL_ID=""
CREATED_USER_ID=""
CREATED_STUDENT_ID=""
CREATED_YEAR_ID=""

# ============================================================
# Helper Functions
# ============================================================

log_header() {
    echo -e "\n${BLUE}============================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================================${NC}"
}

log_test() {
    echo -e "\n${CYAN}▶ TEST: $1${NC}"
}

log_success() {
    echo -e "${GREEN}✓ PASS: $1${NC}"
    ((TESTS_PASSED++))
    ((TESTS_TOTAL++))
}

log_failure() {
    echo -e "${RED}✗ FAIL: $1${NC}"
    echo -e "${RED}  Error: $2${NC}"
    ((TESTS_FAILED++))
    ((TESTS_TOTAL++))
}

log_info() {
    echo -e "${YELLOW}  ℹ $1${NC}"
}

log_response() {
    echo -e "${NC}  Response: $1${NC}"
}

# Check if jq is installed
check_dependencies() {
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Error: jq is required but not installed.${NC}"
        echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
        exit 1
    fi
    if ! command -v curl &> /dev/null; then
        echo -e "${RED}Error: curl is required but not installed.${NC}"
        exit 1
    fi
}

# ============================================================
# Phase 1: Authentication Tests
# ============================================================

test_authentication() {
    log_header "Phase 1: Authentication Tests"
    
    # Test 1.1: Login
    log_test "1.1 Login with email and password"
    
    LOGIN_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/auth/login" \
        -H "Content-Type: application/json" \
        -d "{
            \"email\": \"${EMAIL}\",
            \"password\": \"${PASSWORD}\"
        }" 2>&1)
    
    # Check if login was successful
    if echo "$LOGIN_RESPONSE" | jq -e '.accessToken' > /dev/null 2>&1; then
        TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.accessToken')
        REFRESH_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.refreshToken')
        USER_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.userId')
        TENANT_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.tenantId')
        
        log_success "Login successful"
        log_info "Token length: ${#TOKEN} characters"
        log_info "User ID: $USER_ID"
        log_info "Tenant ID: $TENANT_ID"
        
        # Export for subsequent tests
        export TOKEN
        export REFRESH_TOKEN
        export USER_ID
        export TENANT_ID
    else
        log_failure "Login failed" "$LOGIN_RESPONSE"
        echo -e "${RED}Cannot proceed without authentication. Exiting.${NC}"
        exit 1
    fi
    
    # Test 1.2: Get Current User (/auth/me)
    log_test "1.2 Verify token with GET /auth/me"
    
    ME_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/auth/me" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" 2>&1)
    
    if echo "$ME_RESPONSE" | jq -e '.user.email' > /dev/null 2>&1; then
        EMAIL_FROM_ME=$(echo "$ME_RESPONSE" | jq -r '.user.email')
        log_success "Token verification successful"
        log_info "Email from /auth/me: $EMAIL_FROM_ME"
    else
        log_failure "Token verification failed" "$ME_RESPONSE"
    fi
    
    # Test 1.3: Auth Health Check
    log_test "1.3 Auth health check (public endpoint)"
    
    HEALTH_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/auth/health" 2>&1)
    
    if echo "$HEALTH_RESPONSE" | jq -e '.status == "ok"' > /dev/null 2>&1; then
        log_success "Auth health check passed"
    else
        log_failure "Auth health check failed" "$HEALTH_RESPONSE"
    fi
}

# ============================================================
# Phase 2: Identity Service Tests
# ============================================================

test_identity_service() {
    log_header "Phase 2: Identity Service Tests"
    
    # ========================================
    # 2.1 Schools CRUD
    # ========================================
    log_header "2.1 Schools API Tests"
    
    # Test: List Schools
    log_test "2.1.1 List all schools"
    
    SCHOOLS_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/schools" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" 2>&1)
    
    if echo "$SCHOOLS_RESPONSE" | jq -e '.items' > /dev/null 2>&1; then
        SCHOOL_COUNT=$(echo "$SCHOOLS_RESPONSE" | jq '.items | length')
        log_success "List schools successful"
        log_info "Found $SCHOOL_COUNT school(s)"
    else
        log_failure "List schools failed" "$SCHOOLS_RESPONSE"
    fi
    
    # Test: Create School
    log_test "2.1.2 Create new school"
    
    CREATE_SCHOOL_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/schools" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{
            "schoolCode": "TEST01",
            "name": "API Test Elementary School",
            "schoolType": "elementary",
            "gradeRange": { "start": "K", "end": "5" },
            "phone": "555-0100",
            "email": "test-elementary@edforge.test",
            "timezone": "America/New_York",
            "locale": "en-US",
            "academicCalendarType": "semester"
        }' 2>&1)
    
    if echo "$CREATE_SCHOOL_RESPONSE" | jq -e '.schoolId' > /dev/null 2>&1; then
        CREATED_SCHOOL_ID=$(echo "$CREATE_SCHOOL_RESPONSE" | jq -r '.schoolId')
        log_success "Create school successful"
        log_info "Created School ID: $CREATED_SCHOOL_ID"
    else
        log_failure "Create school failed" "$CREATE_SCHOOL_RESPONSE"
    fi
    
    # Test: Get School by ID
    if [ -n "$CREATED_SCHOOL_ID" ]; then
        log_test "2.1.3 Get school by ID"
        
        GET_SCHOOL_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/schools/${CREATED_SCHOOL_ID}" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" 2>&1)
        
        if echo "$GET_SCHOOL_RESPONSE" | jq -e '.schoolId' > /dev/null 2>&1; then
            SCHOOL_NAME=$(echo "$GET_SCHOOL_RESPONSE" | jq -r '.name')
            log_success "Get school successful"
            log_info "School name: $SCHOOL_NAME"
        else
            log_failure "Get school failed" "$GET_SCHOOL_RESPONSE"
        fi
        
        # Test: Update School
        log_test "2.1.4 Update school"
        
        UPDATE_SCHOOL_RESPONSE=$(curl -s -X PUT "${API_BASE_URL}/schools/${CREATED_SCHOOL_ID}" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" \
            -d '{
                "name": "API Test Elementary School (Updated)",
                "phone": "555-0101"
            }' 2>&1)
        
        if echo "$UPDATE_SCHOOL_RESPONSE" | jq -e '.schoolId' > /dev/null 2>&1; then
            UPDATED_NAME=$(echo "$UPDATE_SCHOOL_RESPONSE" | jq -r '.name')
            log_success "Update school successful"
            log_info "Updated name: $UPDATED_NAME"
        else
            log_failure "Update school failed" "$UPDATE_SCHOOL_RESPONSE"
        fi
    fi
    
    # ========================================
    # 2.2 Users API
    # ========================================
    log_header "2.2 Users API Tests"
    
    # Test: List Users
    log_test "2.2.1 List all users"
    
    USERS_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/users" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" 2>&1)
    
    if echo "$USERS_RESPONSE" | jq -e '.items' > /dev/null 2>&1; then
        USER_COUNT=$(echo "$USERS_RESPONSE" | jq '.items | length')
        log_success "List users successful"
        log_info "Found $USER_COUNT user(s)"
    else
        log_failure "List users failed" "$USERS_RESPONSE"
    fi
    
    # Test: Create User
    log_test "2.2.2 Create new user"
    
    TIMESTAMP=$(date +%s)
    CREATE_USER_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/users" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{
            \"email\": \"test-teacher-${TIMESTAMP}@edforge.test\",
            \"firstName\": \"Test\",
            \"lastName\": \"Teacher\",
            \"globalRole\": \"TenantUser\"
        }" 2>&1)
    
    if echo "$CREATE_USER_RESPONSE" | jq -e '.userId' > /dev/null 2>&1; then
        CREATED_USER_ID=$(echo "$CREATE_USER_RESPONSE" | jq -r '.userId')
        log_success "Create user successful"
        log_info "Created User ID: $CREATED_USER_ID"
    else
        log_failure "Create user failed" "$CREATE_USER_RESPONSE"
    fi
    
    # Test: Get User by ID
    if [ -n "$CREATED_USER_ID" ]; then
        log_test "2.2.3 Get user by ID"
        
        GET_USER_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/users/${CREATED_USER_ID}" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" 2>&1)
        
        if echo "$GET_USER_RESPONSE" | jq -e '.userId' > /dev/null 2>&1; then
            USER_EMAIL=$(echo "$GET_USER_RESPONSE" | jq -r '.email')
            log_success "Get user successful"
            log_info "User email: $USER_EMAIL"
        else
            log_failure "Get user failed" "$GET_USER_RESPONSE"
        fi
        
        # Test: Update User
        log_test "2.2.4 Update user"
        
        UPDATE_USER_RESPONSE=$(curl -s -X PUT "${API_BASE_URL}/users/${CREATED_USER_ID}" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" \
            -d '{
                "firstName": "Updated",
                "lastName": "Teacher"
            }' 2>&1)
        
        if echo "$UPDATE_USER_RESPONSE" | jq -e '.userId' > /dev/null 2>&1; then
            UPDATED_FIRST=$(echo "$UPDATE_USER_RESPONSE" | jq -r '.firstName')
            log_success "Update user successful"
            log_info "Updated firstName: $UPDATED_FIRST"
        else
            log_failure "Update user failed" "$UPDATE_USER_RESPONSE"
        fi
    fi
    
    # ========================================
    # 2.3 Academic Years API
    # ========================================
    if [ -n "$CREATED_SCHOOL_ID" ]; then
        log_header "2.3 Academic Years API Tests"
        
        # Test: List Academic Years
        log_test "2.3.1 List academic years for school"
        
        YEARS_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/schools/${CREATED_SCHOOL_ID}/academic-years" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" 2>&1)
        
        if echo "$YEARS_RESPONSE" | jq -e '.items' > /dev/null 2>&1; then
            YEAR_COUNT=$(echo "$YEARS_RESPONSE" | jq '.items | length')
            log_success "List academic years successful"
            log_info "Found $YEAR_COUNT academic year(s)"
        else
            log_failure "List academic years failed" "$YEARS_RESPONSE"
        fi
        
        # Test: Create Academic Year
        log_test "2.3.2 Create academic year"
        
        CREATE_YEAR_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/schools/${CREATED_SCHOOL_ID}/academic-years" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" \
            -d '{
                "name": "2024-2025",
                "startDate": "2024-08-15",
                "endDate": "2025-06-15",
                "calendarType": "semester",
                "setAsCurrent": true
            }' 2>&1)
        
        if echo "$CREATE_YEAR_RESPONSE" | jq -e '.yearId' > /dev/null 2>&1; then
            CREATED_YEAR_ID=$(echo "$CREATE_YEAR_RESPONSE" | jq -r '.yearId')
            log_success "Create academic year successful"
            log_info "Created Year ID: $CREATED_YEAR_ID"
        else
            log_failure "Create academic year failed" "$CREATE_YEAR_RESPONSE"
        fi
        
        # Test: Get Current Academic Year
        log_test "2.3.3 Get current academic year"
        
        CURRENT_YEAR_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/schools/${CREATED_SCHOOL_ID}/academic-years/current" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" 2>&1)
        
        if echo "$CURRENT_YEAR_RESPONSE" | jq -e '.yearId' > /dev/null 2>&1; then
            CURRENT_YEAR_NAME=$(echo "$CURRENT_YEAR_RESPONSE" | jq -r '.name')
            log_success "Get current academic year successful"
            log_info "Current year: $CURRENT_YEAR_NAME"
        else
            log_failure "Get current academic year failed" "$CURRENT_YEAR_RESPONSE"
        fi
    fi
    
    # ========================================
    # 2.4 Departments API
    # ========================================
    if [ -n "$CREATED_SCHOOL_ID" ]; then
        log_header "2.4 Departments API Tests"
        
        # Test: List Departments
        log_test "2.4.1 List departments for school"
        
        DEPTS_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/schools/${CREATED_SCHOOL_ID}/departments" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" 2>&1)
        
        if echo "$DEPTS_RESPONSE" | jq -e '.items' > /dev/null 2>&1; then
            DEPT_COUNT=$(echo "$DEPTS_RESPONSE" | jq '.items | length')
            log_success "List departments successful"
            log_info "Found $DEPT_COUNT department(s)"
        else
            log_failure "List departments failed" "$DEPTS_RESPONSE"
        fi
        
        # Test: Create Department
        log_test "2.4.2 Create department"
        
        CREATE_DEPT_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/schools/${CREATED_SCHOOL_ID}/departments" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" \
            -d '{
                "code": "MATH",
                "name": "Mathematics Department",
                "description": "Mathematics and related courses"
            }' 2>&1)
        
        if echo "$CREATE_DEPT_RESPONSE" | jq -e '.departmentId' > /dev/null 2>&1; then
            CREATED_DEPT_ID=$(echo "$CREATE_DEPT_RESPONSE" | jq -r '.departmentId')
            log_success "Create department successful"
            log_info "Created Department ID: $CREATED_DEPT_ID"
        else
            log_failure "Create department failed" "$CREATE_DEPT_RESPONSE"
        fi
    fi
}

# ============================================================
# Phase 3: Academics Service Tests
# ============================================================

test_academics_service() {
    log_header "Phase 3: Academics Service Tests"
    
    # ========================================
    # 3.1 Students API
    # ========================================
    log_header "3.1 Students API Tests"
    
    # Test: List Students
    log_test "3.1.1 List all students"
    
    STUDENTS_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/academics/students" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" 2>&1)
    
    if echo "$STUDENTS_RESPONSE" | jq -e '.items' > /dev/null 2>&1; then
        STUDENT_COUNT=$(echo "$STUDENTS_RESPONSE" | jq '.items | length')
        log_success "List students successful"
        log_info "Found $STUDENT_COUNT student(s)"
    else
        log_failure "List students failed" "$STUDENTS_RESPONSE"
    fi
    
    # Test: Create Student (if we have a school)
    if [ -n "$CREATED_SCHOOL_ID" ]; then
        log_test "3.1.2 Create new student"
        
        TIMESTAMP=$(date +%s)
        CREATE_STUDENT_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/academics/students" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" \
            -d "{
                \"firstName\": \"John\",
                \"lastName\": \"Doe\",
                \"studentNumber\": \"STU${TIMESTAMP}\",
                \"dateOfBirth\": \"2015-05-15\",
                \"gender\": \"male\",
                \"schoolId\": \"${CREATED_SCHOOL_ID}\",
                \"gradeLevel\": \"1\",
                \"enrollmentDate\": \"2024-08-15\"
            }" 2>&1)
        
        if echo "$CREATE_STUDENT_RESPONSE" | jq -e '.studentId' > /dev/null 2>&1; then
            CREATED_STUDENT_ID=$(echo "$CREATE_STUDENT_RESPONSE" | jq -r '.studentId')
            log_success "Create student successful"
            log_info "Created Student ID: $CREATED_STUDENT_ID"
        else
            log_failure "Create student failed" "$CREATE_STUDENT_RESPONSE"
        fi
        
        # Test: Get Student by ID
        if [ -n "$CREATED_STUDENT_ID" ]; then
            log_test "3.1.3 Get student by ID"
            
            GET_STUDENT_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/academics/students/${CREATED_STUDENT_ID}" \
                -H "Authorization: Bearer ${TOKEN}" \
                -H "Content-Type: application/json" 2>&1)
            
            if echo "$GET_STUDENT_RESPONSE" | jq -e '.studentId' > /dev/null 2>&1; then
                STUDENT_NAME=$(echo "$GET_STUDENT_RESPONSE" | jq -r '.firstName + " " + .lastName')
                log_success "Get student successful"
                log_info "Student name: $STUDENT_NAME"
            else
                log_failure "Get student failed" "$GET_STUDENT_RESPONSE"
            fi
            
            # Test: Update Student
            log_test "3.1.4 Update student"
            
            UPDATE_STUDENT_RESPONSE=$(curl -s -X PUT "${API_BASE_URL}/academics/students/${CREATED_STUDENT_ID}" \
                -H "Authorization: Bearer ${TOKEN}" \
                -H "Content-Type: application/json" \
                -d '{
                    "firstName": "Johnny",
                    "notes": "Updated via API test"
                }' 2>&1)
            
            if echo "$UPDATE_STUDENT_RESPONSE" | jq -e '.studentId' > /dev/null 2>&1; then
                UPDATED_NAME=$(echo "$UPDATE_STUDENT_RESPONSE" | jq -r '.firstName')
                log_success "Update student successful"
                log_info "Updated firstName: $UPDATED_NAME"
            else
                log_failure "Update student failed" "$UPDATE_STUDENT_RESPONSE"
            fi
            
            # Test: Get Student Profile
            log_test "3.1.5 Get student profile (comprehensive view)"
            
            PROFILE_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/academics/students/${CREATED_STUDENT_ID}/profile" \
                -H "Authorization: Bearer ${TOKEN}" \
                -H "Content-Type: application/json" 2>&1)
            
            if echo "$PROFILE_RESPONSE" | jq -e '.student' > /dev/null 2>&1; then
                log_success "Get student profile successful"
            else
                log_failure "Get student profile failed" "$PROFILE_RESPONSE"
            fi
        fi
    fi
    
    # ========================================
    # 3.2 Enrollments API
    # ========================================
    log_header "3.2 Enrollments API Tests"
    
    # Test: List Enrollments
    log_test "3.2.1 List all enrollments"
    
    ENROLLMENTS_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/academics/enrollments" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" 2>&1)
    
    if echo "$ENROLLMENTS_RESPONSE" | jq -e '.items' > /dev/null 2>&1; then
        ENROLLMENT_COUNT=$(echo "$ENROLLMENTS_RESPONSE" | jq '.items | length')
        log_success "List enrollments successful"
        log_info "Found $ENROLLMENT_COUNT enrollment(s)"
    else
        log_failure "List enrollments failed" "$ENROLLMENTS_RESPONSE"
    fi
}

# ============================================================
# Phase 4: Error Handling Tests
# ============================================================

test_error_handling() {
    log_header "Phase 4: Error Handling Tests"
    
    # Test: No Authorization Header
    log_test "4.1 Request without Authorization header (expect 401)"
    
    NO_AUTH_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_BASE_URL}/users" \
        -H "Content-Type: application/json" 2>&1)
    
    HTTP_CODE=$(echo "$NO_AUTH_RESPONSE" | tail -n1)
    RESPONSE_BODY=$(echo "$NO_AUTH_RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" = "401" ]; then
        log_success "Correctly returned 401 for missing auth"
    else
        log_failure "Expected 401, got $HTTP_CODE" "$RESPONSE_BODY"
    fi
    
    # Test: Invalid Token
    log_test "4.2 Request with invalid token (expect 401)"
    
    INVALID_TOKEN_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_BASE_URL}/users" \
        -H "Authorization: Bearer invalid-token-here" \
        -H "Content-Type: application/json" 2>&1)
    
    HTTP_CODE=$(echo "$INVALID_TOKEN_RESPONSE" | tail -n1)
    RESPONSE_BODY=$(echo "$INVALID_TOKEN_RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
        log_success "Correctly returned $HTTP_CODE for invalid token"
    else
        log_failure "Expected 401/403, got $HTTP_CODE" "$RESPONSE_BODY"
    fi
    
    # Test: Non-existent Resource
    log_test "4.3 Request for non-existent resource (expect 404)"
    
    NOT_FOUND_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_BASE_URL}/schools/non-existent-id-12345" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" 2>&1)
    
    HTTP_CODE=$(echo "$NOT_FOUND_RESPONSE" | tail -n1)
    RESPONSE_BODY=$(echo "$NOT_FOUND_RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" = "404" ]; then
        log_success "Correctly returned 404 for non-existent resource"
    else
        log_failure "Expected 404, got $HTTP_CODE" "$RESPONSE_BODY"
    fi
    
    # Test: Invalid Payload
    log_test "4.4 Create school with invalid payload (expect 400)"
    
    INVALID_PAYLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE_URL}/schools" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"name": ""}' 2>&1)
    
    HTTP_CODE=$(echo "$INVALID_PAYLOAD_RESPONSE" | tail -n1)
    RESPONSE_BODY=$(echo "$INVALID_PAYLOAD_RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" = "400" ]; then
        log_success "Correctly returned 400 for invalid payload"
    else
        log_failure "Expected 400, got $HTTP_CODE" "$RESPONSE_BODY"
    fi
}

# ============================================================
# Cleanup: Delete Test Data
# ============================================================

cleanup_test_data() {
    log_header "Cleanup: Removing Test Data"
    
    # Delete created student
    if [ -n "$CREATED_STUDENT_ID" ]; then
        log_test "Deleting test student"
        DELETE_STUDENT=$(curl -s -w "\n%{http_code}" -X DELETE "${API_BASE_URL}/academics/students/${CREATED_STUDENT_ID}" \
            -H "Authorization: Bearer ${TOKEN}" 2>&1)
        HTTP_CODE=$(echo "$DELETE_STUDENT" | tail -n1)
        if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
            log_info "Student deleted successfully"
        else
            log_info "Student deletion returned: $HTTP_CODE"
        fi
    fi
    
    # Delete created user
    if [ -n "$CREATED_USER_ID" ]; then
        log_test "Deleting test user"
        DELETE_USER=$(curl -s -w "\n%{http_code}" -X DELETE "${API_BASE_URL}/users/${CREATED_USER_ID}" \
            -H "Authorization: Bearer ${TOKEN}" 2>&1)
        HTTP_CODE=$(echo "$DELETE_USER" | tail -n1)
        if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
            log_info "User deleted successfully"
        else
            log_info "User deletion returned: $HTTP_CODE"
        fi
    fi
    
    # Delete created school (this should cascade delete academic years and departments)
    if [ -n "$CREATED_SCHOOL_ID" ]; then
        log_test "Deleting test school"
        DELETE_SCHOOL=$(curl -s -w "\n%{http_code}" -X DELETE "${API_BASE_URL}/schools/${CREATED_SCHOOL_ID}" \
            -H "Authorization: Bearer ${TOKEN}" 2>&1)
        HTTP_CODE=$(echo "$DELETE_SCHOOL" | tail -n1)
        if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
            log_info "School deleted successfully"
        else
            log_info "School deletion returned: $HTTP_CODE"
        fi
    fi
}

# ============================================================
# Summary Report
# ============================================================

print_summary() {
    log_header "Test Summary"
    
    echo -e ""
    echo -e "  ${BLUE}Total Tests:${NC}  $TESTS_TOTAL"
    echo -e "  ${GREEN}Passed:${NC}       $TESTS_PASSED"
    echo -e "  ${RED}Failed:${NC}       $TESTS_FAILED"
    echo -e ""
    
    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}============================================================${NC}"
        echo -e "${GREEN}All tests passed! ✓${NC}"
        echo -e "${GREEN}============================================================${NC}"
    else
        echo -e "${RED}============================================================${NC}"
        echo -e "${RED}Some tests failed. See above for details.${NC}"
        echo -e "${RED}============================================================${NC}"
    fi
    
    echo -e ""
    echo -e "${BLUE}Environment:${NC}"
    echo -e "  API URL: ${API_BASE_URL}"
    echo -e "  Email:   ${EMAIL}"
    echo -e "  Tenant:  ${TENANT_ID:-'(not set)'}"
    echo -e ""
}

# ============================================================
# Main Execution
# ============================================================

main() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║           EdForge API Comprehensive Test Suite              ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    # Check dependencies
    check_dependencies
    
    # Run test phases
    test_authentication
    test_identity_service
    test_academics_service
    test_error_handling
    
    # Cleanup
    cleanup_test_data
    
    # Print summary
    print_summary
    
    # Exit with error if any tests failed
    if [ $TESTS_FAILED -gt 0 ]; then
        exit 1
    fi
}

# Run main function
main "$@"

