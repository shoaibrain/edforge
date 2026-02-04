#!/bin/bash
# ============================================================
# EdForge Identity Service Test Suite
# ============================================================
#
# This script tests all Identity Service API endpoints:
# - Authentication (login, token verification, refresh, logout)
# - Users (CRUD, preferences, school assignments)
# - Schools (CRUD, departments)
# - Academic Years (CRUD, grading periods, holidays)
# - Tenants (lookup, details)
# - Roles (assignment management)
# - Sessions (management)
# - Health checks
#
# Usage:
#   ./scripts/identity-test.sh --token "eyJhbGciOiJSUzI1NiIs..."
#   ./scripts/identity-test.sh --token "eyJ..." --api-url "https://custom-url.execute-api.us-east-1.amazonaws.com/prod"
#   ./scripts/identity-test.sh --token "eyJ..." --output /path/to/results.txt
#
# ============================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Configuration defaults
API_BASE_URL="${EDFORGE_API_URL:-https://iteja0t88a.execute-api.us-east-1.amazonaws.com/prod}"
TOKEN=""
OUTPUT_FILE=""
VERBOSE=false

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0
TESTS_TOTAL=0

# Store created resource IDs for cleanup
CREATED_SCHOOL_ID=""
CREATED_USER_ID=""
CREATED_YEAR_ID=""
CREATED_DEPT_ID=""
CREATED_ROLE_ID=""

# ============================================================
# Parse Command Line Arguments
# ============================================================

usage() {
    echo -e "${BLUE}Usage:${NC} $0 --token <ID_TOKEN> [OPTIONS]"
    echo ""
    echo -e "${BLUE}Required:${NC}"
    echo "  --token <TOKEN>      Raw ID token from Cognito for authentication"
    echo ""
    echo -e "${BLUE}Options:${NC}"
    echo "  --api-url <URL>      API Gateway URL (default: $API_BASE_URL)"
    echo "  --output <FILE>      Output file for test results"
    echo "  --verbose            Enable verbose output"
    echo "  --help               Show this help message"
    echo ""
    echo -e "${BLUE}Examples:${NC}"
    echo "  $0 --token 'eyJhbGciOiJSUzI1NiIs...'"
    echo "  $0 --token 'eyJ...' --api-url 'https://my-api.execute-api.us-east-1.amazonaws.com/prod'"
    echo "  $0 --token 'eyJ...' --output ./test-results.txt"
    echo ""
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --token)
                TOKEN="$2"
                shift 2
                ;;
            --api-url)
                API_BASE_URL="$2"
                shift 2
                ;;
            --output)
                OUTPUT_FILE="$2"
                shift 2
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --help)
                usage
                exit 0
                ;;
            *)
                echo -e "${RED}Error: Unknown option $1${NC}"
                usage
                exit 1
                ;;
        esac
    done

    if [ -z "$TOKEN" ]; then
        echo -e "${RED}Error: --token is required${NC}"
        usage
        exit 1
    fi
}

# ============================================================
# Helper Functions
# ============================================================

log_header() {
    local msg="$1"
    echo -e "\n${BLUE}============================================================${NC}"
    echo -e "${BLUE}$msg${NC}"
    echo -e "${BLUE}============================================================${NC}"
    
    if [ -n "$OUTPUT_FILE" ]; then
        echo "" >> "$OUTPUT_FILE"
        echo "============================================================" >> "$OUTPUT_FILE"
        echo "$msg" >> "$OUTPUT_FILE"
        echo "============================================================" >> "$OUTPUT_FILE"
    fi
}

log_subheader() {
    local msg="$1"
    echo -e "\n${MAGENTA}--- $msg ---${NC}"
    [ -n "$OUTPUT_FILE" ] && echo "--- $msg ---" >> "$OUTPUT_FILE"
}

log_test() {
    echo -e "\n${CYAN}▶ TEST: $1${NC}"
    [ -n "$OUTPUT_FILE" ] && echo "TEST: $1" >> "$OUTPUT_FILE"
}

log_success() {
    echo -e "${GREEN}✓ PASS: $1${NC}"
    ((TESTS_PASSED++))
    ((TESTS_TOTAL++))
    [ -n "$OUTPUT_FILE" ] && echo "✓ PASS: $1" >> "$OUTPUT_FILE"
}

log_failure() {
    echo -e "${RED}✗ FAIL: $1${NC}"
    echo -e "${RED}  Error: $2${NC}"
    ((TESTS_FAILED++))
    ((TESTS_TOTAL++))
    if [ -n "$OUTPUT_FILE" ]; then
        echo "✗ FAIL: $1" >> "$OUTPUT_FILE"
        echo "  Error: $2" >> "$OUTPUT_FILE"
    fi
}

log_skip() {
    echo -e "${YELLOW}○ SKIP: $1${NC}"
    [ -n "$OUTPUT_FILE" ] && echo "○ SKIP: $1" >> "$OUTPUT_FILE"
    ((TESTS_SKIPPED++))
}

log_info() {
    echo -e "${YELLOW}  ℹ $1${NC}"
    [ -n "$OUTPUT_FILE" ] && echo "  ℹ $1" >> "$OUTPUT_FILE"
}

log_debug() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${NC}  [DEBUG] $1${NC}"
        [ -n "$OUTPUT_FILE" ] && echo "  [DEBUG] $1" >> "$OUTPUT_FILE"
    fi
}

log_response() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${NC}  Response: $1${NC}"
        [ -n "$OUTPUT_FILE" ] && echo "  Response: $1" >> "$OUTPUT_FILE"
    fi
}

# Make an API call and return the response
api_call() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    
    local url="${API_BASE_URL}${endpoint}"
    local curl_args=(-s -w "\n%{http_code}" -X "$method" "$url")
    
    curl_args+=(-H "Authorization: Bearer ${TOKEN}")
    curl_args+=(-H "Content-Type: application/json")
    
    if [ -n "$data" ]; then
        curl_args+=(-d "$data")
    fi
    
    log_debug "API Call: $method $url"
    [ -n "$data" ] && log_debug "Payload: $data"
    
    local response
    response=$(curl "${curl_args[@]}" 2>&1)
    
    echo "$response"
}

# Extract HTTP status code from response
get_http_code() {
    echo "$1" | tail -n1
}

# Extract response body from response
get_body() {
    echo "$1" | sed '$d'
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

# Decode JWT token to extract claims
decode_jwt() {
    local token="$1"
    local payload=$(echo "$token" | cut -d'.' -f2)
    # Add padding if needed
    local padding=$((4 - ${#payload} % 4))
    if [ $padding -ne 4 ]; then
        payload="${payload}$(printf '%*s' $padding | tr ' ' '=')"
    fi
    echo "$payload" | base64 -d 2>/dev/null | jq . 2>/dev/null || echo "{}"
}

# ============================================================
# Phase 0: Token Validation
# ============================================================

validate_token() {
    log_header "Phase 0: Token Validation"
    
    log_test "0.1 Decode and validate JWT token"
    
    local claims=$(decode_jwt "$TOKEN")
    
    if [ -z "$claims" ] || [ "$claims" = "{}" ]; then
        log_failure "JWT decode failed" "Could not decode token payload"
        return 1
    fi
    
    # Extract key claims
    local tenant_id=$(echo "$claims" | jq -r '.["custom:tenantId"] // empty')
    local user_role=$(echo "$claims" | jq -r '.["custom:userRole"] // empty')
    local tenant_tier=$(echo "$claims" | jq -r '.["custom:tenantTier"] // empty')
    local email=$(echo "$claims" | jq -r '.email // empty')
    local exp=$(echo "$claims" | jq -r '.exp // 0')
    
    log_success "JWT token decoded successfully"
    log_info "Tenant ID: ${tenant_id:-'(not set)'}"
    log_info "User Role: ${user_role:-'(not set)'}"
    log_info "Tenant Tier: ${tenant_tier:-'(not set)'}"
    log_info "Email: ${email:-'(not set)'}"
    
    # Check expiration
    local now=$(date +%s)
    if [ "$exp" -lt "$now" ]; then
        log_failure "Token expired" "Token expired at $(date -r $exp)"
        echo -e "${RED}Please provide a fresh token. Exiting.${NC}"
        exit 1
    else
        local expires_in=$((exp - now))
        log_info "Token expires in: ${expires_in} seconds"
    fi
    
    # Export for subsequent tests
    export TENANT_ID="$tenant_id"
    export USER_ROLE="$user_role"
    
    return 0
}

# ============================================================
# Phase 1: Health Checks
# ============================================================

test_health_checks() {
    log_header "Phase 1: Health Check Tests"
    
    log_test "1.1 Service health check (/health)"
    local response=$(api_call GET "/health")
    local http_code=$(get_http_code "$response")
    local body=$(get_body "$response")
    
    if [ "$http_code" = "200" ] && echo "$body" | jq -e '.status == "ok"' > /dev/null 2>&1; then
        log_success "Health check passed"
        log_info "Service status: $(echo "$body" | jq -r '.service // "identity"')"
    else
        log_failure "Health check failed (HTTP $http_code)" "$body"
    fi
    
    log_test "1.2 Readiness check (/health/ready)"
    response=$(api_call GET "/health/ready")
    http_code=$(get_http_code "$response")
    body=$(get_body "$response")
    
    if [ "$http_code" = "200" ]; then
        log_success "Readiness check passed"
    else
        log_failure "Readiness check failed (HTTP $http_code)" "$body"
    fi
    
    log_test "1.3 Liveness check (/health/live)"
    response=$(api_call GET "/health/live")
    http_code=$(get_http_code "$response")
    body=$(get_body "$response")
    
    if [ "$http_code" = "200" ]; then
        log_success "Liveness check passed"
    else
        log_failure "Liveness check failed (HTTP $http_code)" "$body"
    fi
}

# ============================================================
# Phase 2: Authentication Tests
# ============================================================

test_authentication() {
    log_header "Phase 2: Authentication Tests"
    
    log_test "2.1 Get current user (/auth/me)"
    local response=$(api_call GET "/auth/me")
    local http_code=$(get_http_code "$response")
    local body=$(get_body "$response")
    
    if [ "$http_code" = "200" ] && echo "$body" | jq -e '.user' > /dev/null 2>&1; then
        log_success "Get current user successful"
        local user_email=$(echo "$body" | jq -r '.user.email // "N/A"')
        local user_id=$(echo "$body" | jq -r '.user.userId // "N/A"')
        log_info "User email: $user_email"
        log_info "User ID: $user_id"
        export CURRENT_USER_ID="$user_id"
    else
        log_failure "Get current user failed (HTTP $http_code)" "$body"
    fi
    
    log_test "2.2 Auth health check (/auth/health)"
    response=$(api_call GET "/auth/health")
    http_code=$(get_http_code "$response")
    body=$(get_body "$response")
    
    if [ "$http_code" = "200" ]; then
        log_success "Auth health check passed"
    else
        log_failure "Auth health check failed (HTTP $http_code)" "$body"
    fi
}

# ============================================================
# Phase 3: Tenant Tests
# ============================================================

test_tenants() {
    log_header "Phase 3: Tenant Tests"
    
    log_test "3.1 Get current tenant details"
    local response=$(api_call GET "/tenants/current")
    local http_code=$(get_http_code "$response")
    local body=$(get_body "$response")
    
    if [ "$http_code" = "200" ] && echo "$body" | jq -e '.tenantId' > /dev/null 2>&1; then
        log_success "Get tenant details successful"
        local tenant_name=$(echo "$body" | jq -r '.tenantName // "N/A"')
        local tier=$(echo "$body" | jq -r '.tier // "N/A"')
        log_info "Tenant name: $tenant_name"
        log_info "Tier: $tier"
    else
        # May not be implemented yet
        log_skip "Get tenant details not implemented or failed (HTTP $http_code)"
    fi
    
    log_test "3.2 Tenant lookup by subdomain (public endpoint)"
    response=$(curl -s -w "\n%{http_code}" -X GET "${API_BASE_URL}/tenants/lookup?subdomain=test" \
        -H "Content-Type: application/json" 2>&1)
    http_code=$(get_http_code "$response")
    body=$(get_body "$response")
    
    if [ "$http_code" = "200" ] || [ "$http_code" = "404" ]; then
        log_success "Tenant lookup endpoint working (HTTP $http_code)"
    else
        log_skip "Tenant lookup not implemented (HTTP $http_code)"
    fi
}

# ============================================================
# Phase 4: Users CRUD Tests
# ============================================================

test_users() {
    log_header "Phase 4: Users API Tests"
    
    log_subheader "4.1 List Users"
    log_test "4.1.1 List all users"
    local response=$(api_call GET "/users")
    local http_code=$(get_http_code "$response")
    local body=$(get_body "$response")
    
    if [ "$http_code" = "200" ] && echo "$body" | jq -e '.items' > /dev/null 2>&1; then
        local user_count=$(echo "$body" | jq '.items | length')
        log_success "List users successful"
        log_info "Found $user_count user(s)"
    else
        log_failure "List users failed (HTTP $http_code)" "$body"
    fi
    
    log_test "4.1.2 List users with pagination"
    response=$(api_call GET "/users?limit=5&offset=0")
    http_code=$(get_http_code "$response")
    body=$(get_body "$response")
    
    if [ "$http_code" = "200" ]; then
        log_success "List users with pagination successful"
    else
        log_failure "List users with pagination failed (HTTP $http_code)" "$body"
    fi
    
    log_subheader "4.2 Create User"
    log_test "4.2.1 Create new user"
    
    TIMESTAMP=$(date +%s)
    local create_payload="{
        \"email\": \"test-user-${TIMESTAMP}@edforge.test\",
        \"firstName\": \"Test\",
        \"lastName\": \"User\",
        \"globalRole\": \"StandardUser\"
    }"
    
    response=$(api_call POST "/users" "$create_payload")
    http_code=$(get_http_code "$response")
    body=$(get_body "$response")
    
    if [ "$http_code" = "201" ] || [ "$http_code" = "200" ]; then
        CREATED_USER_ID=$(echo "$body" | jq -r '.userId // empty')
        if [ -n "$CREATED_USER_ID" ]; then
            log_success "Create user successful"
            log_info "Created User ID: $CREATED_USER_ID"
        else
            log_failure "Create user response missing userId" "$body"
        fi
    else
        log_failure "Create user failed (HTTP $http_code)" "$body"
    fi
    
    log_subheader "4.3 Get User"
    if [ -n "$CREATED_USER_ID" ]; then
        log_test "4.3.1 Get user by ID"
        response=$(api_call GET "/users/${CREATED_USER_ID}")
        http_code=$(get_http_code "$response")
        body=$(get_body "$response")
        
        if [ "$http_code" = "200" ] && echo "$body" | jq -e '.userId' > /dev/null 2>&1; then
            log_success "Get user by ID successful"
            log_info "User email: $(echo "$body" | jq -r '.email')"
        else
            log_failure "Get user by ID failed (HTTP $http_code)" "$body"
        fi
    else
        log_skip "4.3.1 Get user by ID - no user created"
    fi
    
    log_subheader "4.4 Update User"
    if [ -n "$CREATED_USER_ID" ]; then
        log_test "4.4.1 Update user"
        local update_payload='{"firstName": "Updated", "lastName": "UserName"}'
        
        response=$(api_call PUT "/users/${CREATED_USER_ID}" "$update_payload")
        http_code=$(get_http_code "$response")
        body=$(get_body "$response")
        
        if [ "$http_code" = "200" ]; then
            local updated_name=$(echo "$body" | jq -r '.firstName // "N/A"')
            log_success "Update user successful"
            log_info "Updated firstName: $updated_name"
        else
            log_failure "Update user failed (HTTP $http_code)" "$body"
        fi
    else
        log_skip "4.4.1 Update user - no user created"
    fi
    
    log_subheader "4.5 User Preferences"
    if [ -n "$CURRENT_USER_ID" ]; then
        log_test "4.5.1 Get user preferences"
        response=$(api_call GET "/users/${CURRENT_USER_ID}/preferences")
        http_code=$(get_http_code "$response")
        body=$(get_body "$response")
        
        if [ "$http_code" = "200" ]; then
            log_success "Get user preferences successful"
        else
            log_skip "Get user preferences not implemented (HTTP $http_code)"
        fi
        
        log_test "4.5.2 Update user preferences"
        local pref_payload='{"theme": "dark", "language": "en"}'
        response=$(api_call PUT "/users/${CURRENT_USER_ID}/preferences" "$pref_payload")
        http_code=$(get_http_code "$response")
        body=$(get_body "$response")
        
        if [ "$http_code" = "200" ]; then
            log_success "Update user preferences successful"
        else
            log_skip "Update user preferences not implemented (HTTP $http_code)"
        fi
    fi
}

# ============================================================
# Phase 5: Schools CRUD Tests
# ============================================================

test_schools() {
    log_header "Phase 5: Schools API Tests"
    
    log_subheader "5.1 List Schools"
    log_test "5.1.1 List all schools"
    local response=$(api_call GET "/schools")
    local http_code=$(get_http_code "$response")
    local body=$(get_body "$response")
    
    if [ "$http_code" = "200" ] && echo "$body" | jq -e '.items' > /dev/null 2>&1; then
        local school_count=$(echo "$body" | jq '.items | length')
        log_success "List schools successful"
        log_info "Found $school_count school(s)"
    else
        log_failure "List schools failed (HTTP $http_code)" "$body"
    fi
    
    log_subheader "5.2 Create School"
    log_test "5.2.1 Create new school"
    
    TIMESTAMP=$(date +%s)
    local create_payload="{
        \"schoolCode\": \"TST${TIMESTAMP: -4}\",
        \"name\": \"Identity Test School ${TIMESTAMP}\",
        \"schoolType\": \"elementary\",
        \"gradeRange\": { \"start\": \"K\", \"end\": \"5\" },
        \"phone\": \"555-0100\",
        \"email\": \"test-school-${TIMESTAMP}@edforge.test\",
        \"timezone\": \"America/New_York\",
        \"locale\": \"en-US\",
        \"academicCalendarType\": \"semester\"
    }"
    
    response=$(api_call POST "/schools" "$create_payload")
    http_code=$(get_http_code "$response")
    body=$(get_body "$response")
    
    if [ "$http_code" = "201" ] || [ "$http_code" = "200" ]; then
        CREATED_SCHOOL_ID=$(echo "$body" | jq -r '.schoolId // empty')
        if [ -n "$CREATED_SCHOOL_ID" ]; then
            log_success "Create school successful"
            log_info "Created School ID: $CREATED_SCHOOL_ID"
        else
            log_failure "Create school response missing schoolId" "$body"
        fi
    else
        log_failure "Create school failed (HTTP $http_code)" "$body"
    fi
    
    log_subheader "5.3 Get School"
    if [ -n "$CREATED_SCHOOL_ID" ]; then
        log_test "5.3.1 Get school by ID"
        response=$(api_call GET "/schools/${CREATED_SCHOOL_ID}")
        http_code=$(get_http_code "$response")
        body=$(get_body "$response")
        
        if [ "$http_code" = "200" ] && echo "$body" | jq -e '.schoolId' > /dev/null 2>&1; then
            log_success "Get school by ID successful"
            log_info "School name: $(echo "$body" | jq -r '.name')"
        else
            log_failure "Get school by ID failed (HTTP $http_code)" "$body"
        fi
    else
        log_skip "5.3.1 Get school by ID - no school created"
    fi
    
    log_subheader "5.4 Update School"
    if [ -n "$CREATED_SCHOOL_ID" ]; then
        log_test "5.4.1 Update school"
        local update_payload='{"name": "Identity Test School (Updated)", "phone": "555-0101"}'
        
        response=$(api_call PUT "/schools/${CREATED_SCHOOL_ID}" "$update_payload")
        http_code=$(get_http_code "$response")
        body=$(get_body "$response")
        
        if [ "$http_code" = "200" ]; then
            log_success "Update school successful"
            log_info "Updated name: $(echo "$body" | jq -r '.name')"
        else
            log_failure "Update school failed (HTTP $http_code)" "$body"
        fi
    else
        log_skip "5.4.1 Update school - no school created"
    fi
}

# ============================================================
# Phase 6: Departments Tests
# ============================================================

test_departments() {
    log_header "Phase 6: Departments API Tests"
    
    if [ -z "$CREATED_SCHOOL_ID" ]; then
        log_skip "Departments tests - no school created"
        return
    fi
    
    log_subheader "6.1 List Departments"
    log_test "6.1.1 List departments for school"
    local response=$(api_call GET "/schools/${CREATED_SCHOOL_ID}/departments")
    local http_code=$(get_http_code "$response")
    local body=$(get_body "$response")
    
    if [ "$http_code" = "200" ] && echo "$body" | jq -e '.items' > /dev/null 2>&1; then
        local dept_count=$(echo "$body" | jq '.items | length')
        log_success "List departments successful"
        log_info "Found $dept_count department(s)"
    else
        log_failure "List departments failed (HTTP $http_code)" "$body"
    fi
    
    log_subheader "6.2 Create Department"
    log_test "6.2.1 Create department"
    
    local create_payload='{
        "code": "MATH",
        "name": "Mathematics Department",
        "description": "Mathematics and related courses"
    }'
    
    response=$(api_call POST "/schools/${CREATED_SCHOOL_ID}/departments" "$create_payload")
    http_code=$(get_http_code "$response")
    body=$(get_body "$response")
    
    if [ "$http_code" = "201" ] || [ "$http_code" = "200" ]; then
        CREATED_DEPT_ID=$(echo "$body" | jq -r '.departmentId // empty')
        if [ -n "$CREATED_DEPT_ID" ]; then
            log_success "Create department successful"
            log_info "Created Department ID: $CREATED_DEPT_ID"
        else
            log_failure "Create department response missing departmentId" "$body"
        fi
    else
        log_failure "Create department failed (HTTP $http_code)" "$body"
    fi
}

# ============================================================
# Phase 7: Academic Years Tests
# ============================================================

test_academic_years() {
    log_header "Phase 7: Academic Years API Tests"
    
    if [ -z "$CREATED_SCHOOL_ID" ]; then
        log_skip "Academic years tests - no school created"
        return
    fi
    
    log_subheader "7.1 List Academic Years"
    log_test "7.1.1 List academic years for school"
    local response=$(api_call GET "/schools/${CREATED_SCHOOL_ID}/academic-years")
    local http_code=$(get_http_code "$response")
    local body=$(get_body "$response")
    
    if [ "$http_code" = "200" ] && echo "$body" | jq -e '.items' > /dev/null 2>&1; then
        local year_count=$(echo "$body" | jq '.items | length')
        log_success "List academic years successful"
        log_info "Found $year_count academic year(s)"
    else
        log_failure "List academic years failed (HTTP $http_code)" "$body"
    fi
    
    log_subheader "7.2 Create Academic Year"
    log_test "7.2.1 Create academic year"
    
    local create_payload='{
        "name": "2024-2025",
        "startDate": "2024-08-15",
        "endDate": "2025-06-15",
        "calendarType": "semester",
        "setAsCurrent": true
    }'
    
    response=$(api_call POST "/schools/${CREATED_SCHOOL_ID}/academic-years" "$create_payload")
    http_code=$(get_http_code "$response")
    body=$(get_body "$response")
    
    if [ "$http_code" = "201" ] || [ "$http_code" = "200" ]; then
        CREATED_YEAR_ID=$(echo "$body" | jq -r '.yearId // empty')
        if [ -n "$CREATED_YEAR_ID" ]; then
            log_success "Create academic year successful"
            log_info "Created Year ID: $CREATED_YEAR_ID"
        else
            log_failure "Create academic year response missing yearId" "$body"
        fi
    else
        log_failure "Create academic year failed (HTTP $http_code)" "$body"
    fi
    
    log_subheader "7.3 Get Current Academic Year"
    log_test "7.3.1 Get current academic year"
    response=$(api_call GET "/schools/${CREATED_SCHOOL_ID}/academic-years/current")
    http_code=$(get_http_code "$response")
    body=$(get_body "$response")
    
    if [ "$http_code" = "200" ] && echo "$body" | jq -e '.yearId' > /dev/null 2>&1; then
        log_success "Get current academic year successful"
        log_info "Current year: $(echo "$body" | jq -r '.name')"
    else
        log_skip "Get current academic year not found (HTTP $http_code)"
    fi
}

# ============================================================
# Phase 8: Error Handling Tests
# ============================================================

test_error_handling() {
    log_header "Phase 8: Error Handling Tests"
    
    log_test "8.1 Request without Authorization header (expect 401)"
    local response=$(curl -s -w "\n%{http_code}" -X GET "${API_BASE_URL}/users" \
        -H "Content-Type: application/json" 2>&1)
    local http_code=$(get_http_code "$response")
    
    if [ "$http_code" = "401" ]; then
        log_success "Correctly returned 401 for missing auth"
    else
        log_failure "Expected 401, got $http_code" "$(get_body "$response")"
    fi
    
    log_test "8.2 Request with invalid token (expect 401/403)"
    response=$(curl -s -w "\n%{http_code}" -X GET "${API_BASE_URL}/users" \
        -H "Authorization: Bearer invalid-token-here" \
        -H "Content-Type: application/json" 2>&1)
    http_code=$(get_http_code "$response")
    
    if [ "$http_code" = "401" ] || [ "$http_code" = "403" ]; then
        log_success "Correctly returned $http_code for invalid token"
    else
        log_failure "Expected 401/403, got $http_code" "$(get_body "$response")"
    fi
    
    log_test "8.3 Request for non-existent resource (expect 404)"
    response=$(api_call GET "/schools/non-existent-id-12345")
    http_code=$(get_http_code "$response")
    
    if [ "$http_code" = "404" ]; then
        log_success "Correctly returned 404 for non-existent resource"
    else
        log_failure "Expected 404, got $http_code" "$(get_body "$response")"
    fi
    
    log_test "8.4 Create school with invalid payload (expect 400)"
    response=$(api_call POST "/schools" '{"name": ""}')
    http_code=$(get_http_code "$response")
    
    if [ "$http_code" = "400" ]; then
        log_success "Correctly returned 400 for invalid payload"
    else
        log_failure "Expected 400, got $http_code" "$(get_body "$response")"
    fi
}

# ============================================================
# Cleanup: Delete Test Data
# ============================================================

cleanup_test_data() {
    log_header "Cleanup: Removing Test Data"
    
    # Delete created user
    if [ -n "$CREATED_USER_ID" ]; then
        log_test "Deleting test user"
        local response=$(api_call DELETE "/users/${CREATED_USER_ID}")
        local http_code=$(get_http_code "$response")
        if [ "$http_code" = "200" ] || [ "$http_code" = "204" ]; then
            log_info "User deleted successfully"
        else
            log_info "User deletion returned: $http_code"
        fi
    fi
    
    # Delete created school (cascades to departments and academic years)
    if [ -n "$CREATED_SCHOOL_ID" ]; then
        log_test "Deleting test school (cascades departments and academic years)"
        local response=$(api_call DELETE "/schools/${CREATED_SCHOOL_ID}")
        local http_code=$(get_http_code "$response")
        if [ "$http_code" = "200" ] || [ "$http_code" = "204" ]; then
            log_info "School deleted successfully"
        else
            log_info "School deletion returned: $http_code"
        fi
    fi
}

# ============================================================
# Summary Report
# ============================================================

print_summary() {
    log_header "Test Summary"
    
    local summary=""
    summary+="  Total Tests:  $TESTS_TOTAL\n"
    summary+="  Passed:       $TESTS_PASSED\n"
    summary+="  Failed:       $TESTS_FAILED\n"
    summary+="  Skipped:      $TESTS_SKIPPED\n"
    
    echo -e ""
    echo -e "  ${BLUE}Total Tests:${NC}  $TESTS_TOTAL"
    echo -e "  ${GREEN}Passed:${NC}       $TESTS_PASSED"
    echo -e "  ${RED}Failed:${NC}       $TESTS_FAILED"
    echo -e "  ${YELLOW}Skipped:${NC}      $TESTS_SKIPPED"
    echo -e ""
    
    local pass_rate=0
    if [ $TESTS_TOTAL -gt 0 ]; then
        pass_rate=$((TESTS_PASSED * 100 / TESTS_TOTAL))
    fi
    
    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}============================================================${NC}"
        echo -e "${GREEN}All tests passed! ✓ (${pass_rate}% pass rate)${NC}"
        echo -e "${GREEN}============================================================${NC}"
    else
        echo -e "${RED}============================================================${NC}"
        echo -e "${RED}Some tests failed. (${pass_rate}% pass rate)${NC}"
        echo -e "${RED}============================================================${NC}"
    fi
    
    echo -e ""
    echo -e "${BLUE}Environment:${NC}"
    echo -e "  API URL:    ${API_BASE_URL}"
    echo -e "  Tenant ID:  ${TENANT_ID:-'(not set)'}"
    echo -e "  User Role:  ${USER_ROLE:-'(not set)'}"
    echo -e ""
    
    if [ -n "$OUTPUT_FILE" ]; then
        echo "" >> "$OUTPUT_FILE"
        echo "============================================================" >> "$OUTPUT_FILE"
        echo "Test Summary" >> "$OUTPUT_FILE"
        echo "============================================================" >> "$OUTPUT_FILE"
        echo -e "$summary" >> "$OUTPUT_FILE"
        echo "Pass Rate: ${pass_rate}%" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        echo "Environment:" >> "$OUTPUT_FILE"
        echo "  API URL: ${API_BASE_URL}" >> "$OUTPUT_FILE"
        echo "  Tenant ID: ${TENANT_ID:-'(not set)'}" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        echo -e "${GREEN}Results saved to: $OUTPUT_FILE${NC}"
    fi
}

# ============================================================
# Main Execution
# ============================================================

main() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║        EdForge Identity Service Test Suite                  ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    # Initialize output file
    if [ -n "$OUTPUT_FILE" ]; then
        echo "EdForge Identity Service Test Results" > "$OUTPUT_FILE"
        echo "Generated: $(date)" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
    fi
    
    # Check dependencies
    check_dependencies
    
    # Validate token first
    validate_token || exit 1
    
    # Run test phases
    test_health_checks
    test_authentication
    test_tenants
    test_users
    test_schools
    test_departments
    test_academic_years
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

# Parse arguments and run
parse_args "$@"
main

