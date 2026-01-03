#!/bin/bash
# ============================================================
# EdForge Local Development Setup Script
# ============================================================
#
# This script initializes the local development environment:
# 1. Waits for LocalStack and DynamoDB Local to be healthy
# 2. Creates DynamoDB tables for Identity and Academics services
# 3. Creates EventBridge bus in LocalStack
# 4. Creates mock Cognito User Pool in LocalStack
# 5. Seeds test data for development
#
# Prerequisites:
#   - Docker Compose services running: 
#     cd server && docker-compose -f docker-compose.local.yml up -d localstack dynamodb-local
#   - AWS CLI installed
#
# Usage:
#   ./scripts/local-setup.sh
#
# ============================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
LOCALSTACK_ENDPOINT="http://localhost:4566"
DYNAMODB_ENDPOINT="http://localhost:8000"
REGION="us-east-1"
EVENT_BUS_NAME="edforge-local-bus"
IDENTITY_TABLE="edforge-identity-local"
ACADEMICS_TABLE="edforge-academics-local"
TEST_TENANT_ID="test-tenant-001"

# Set dummy AWS credentials for local development
# DynamoDB Local and LocalStack don't validate credentials but AWS CLI requires them
export AWS_ACCESS_KEY_ID=local
export AWS_SECRET_ACCESS_KEY=local
export AWS_DEFAULT_REGION=$REGION

echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}EdForge Local Development Setup${NC}"
echo -e "${BLUE}============================================================${NC}"

# ============================================================
# Helper Functions
# ============================================================

wait_for_localstack() {
    local max_attempts=30
    local attempt=1

    echo -e "${YELLOW}Waiting for LocalStack to be ready...${NC}"
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s "$LOCALSTACK_ENDPOINT/_localstack/health" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ LocalStack is ready${NC}"
            return 0
        fi
        echo -e "  Attempt $attempt/$max_attempts..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo -e "${RED}✗ LocalStack failed to start${NC}"
    return 1
}

wait_for_dynamodb() {
    local max_attempts=30
    local attempt=1

    echo -e "${YELLOW}Waiting for DynamoDB Local to be ready...${NC}"
    
    while [ $attempt -le $max_attempts ]; do
        # DynamoDB Local doesn't have a health endpoint, so we try to list tables
        # This command will succeed even with empty results if DynamoDB is running
        if aws dynamodb list-tables --endpoint-url $DYNAMODB_ENDPOINT --region $REGION 2>/dev/null | grep -q "TableNames"; then
            echo -e "${GREEN}✓ DynamoDB Local is ready${NC}"
            return 0
        fi
        echo -e "  Attempt $attempt/$max_attempts..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo -e "${RED}✗ DynamoDB Local failed to start${NC}"
    return 1
}

# ============================================================
# Step 1: Wait for Services
# ============================================================

echo -e "\n${BLUE}Step 1: Checking service health${NC}"

wait_for_localstack
wait_for_dynamodb

# ============================================================
# Step 2: Create DynamoDB Tables
# ============================================================

echo -e "\n${BLUE}Step 2: Creating DynamoDB tables${NC}"

# Identity Service Table
echo -e "${YELLOW}Creating $IDENTITY_TABLE table...${NC}"
aws dynamodb create-table \
    --endpoint-url $DYNAMODB_ENDPOINT \
    --table-name $IDENTITY_TABLE \
    --attribute-definitions \
        AttributeName=tenantId,AttributeType=S \
        AttributeName=entityKey,AttributeType=S \
        AttributeName=gsi1pk,AttributeType=S \
        AttributeName=gsi1sk,AttributeType=S \
    --key-schema \
        AttributeName=tenantId,KeyType=HASH \
        AttributeName=entityKey,KeyType=RANGE \
    --global-secondary-indexes \
        "[{
            \"IndexName\": \"GSI1\",
            \"KeySchema\": [{\"AttributeName\":\"gsi1pk\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"gsi1sk\",\"KeyType\":\"RANGE\"}],
            \"Projection\": {\"ProjectionType\":\"ALL\"},
            \"ProvisionedThroughput\": {\"ReadCapacityUnits\":5,\"WriteCapacityUnits\":5}
        }]" \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
    --region $REGION \
    2>/dev/null || echo -e "${YELLOW}  Table $IDENTITY_TABLE already exists${NC}"

echo -e "${GREEN}✓ $IDENTITY_TABLE table ready${NC}"

# Academics Service Table
echo -e "${YELLOW}Creating $ACADEMICS_TABLE table...${NC}"
aws dynamodb create-table \
    --endpoint-url $DYNAMODB_ENDPOINT \
    --table-name $ACADEMICS_TABLE \
    --attribute-definitions \
        AttributeName=tenantId,AttributeType=S \
        AttributeName=entityKey,AttributeType=S \
        AttributeName=gsi1pk,AttributeType=S \
        AttributeName=gsi1sk,AttributeType=S \
    --key-schema \
        AttributeName=tenantId,KeyType=HASH \
        AttributeName=entityKey,KeyType=RANGE \
    --global-secondary-indexes \
        "[{
            \"IndexName\": \"GSI1\",
            \"KeySchema\": [{\"AttributeName\":\"gsi1pk\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"gsi1sk\",\"KeyType\":\"RANGE\"}],
            \"Projection\": {\"ProjectionType\":\"ALL\"},
            \"ProvisionedThroughput\": {\"ReadCapacityUnits\":5,\"WriteCapacityUnits\":5}
        }]" \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
    --region $REGION \
    2>/dev/null || echo -e "${YELLOW}  Table $ACADEMICS_TABLE already exists${NC}"

echo -e "${GREEN}✓ $ACADEMICS_TABLE table ready${NC}"

# ============================================================
# Step 3: Create EventBridge Bus
# ============================================================

echo -e "\n${BLUE}Step 3: Creating EventBridge event bus${NC}"

aws events create-event-bus \
    --endpoint-url $LOCALSTACK_ENDPOINT \
    --name $EVENT_BUS_NAME \
    --region $REGION \
    2>/dev/null || echo -e "${YELLOW}  Event bus $EVENT_BUS_NAME already exists${NC}"

echo -e "${GREEN}✓ EventBridge bus '$EVENT_BUS_NAME' ready${NC}"

# Create a rule to log all events (useful for debugging)
echo -e "${YELLOW}Creating event logging rule...${NC}"
aws events put-rule \
    --endpoint-url $LOCALSTACK_ENDPOINT \
    --name "log-all-events" \
    --event-bus-name $EVENT_BUS_NAME \
    --event-pattern '{"source": [{"prefix": "edforge"}]}' \
    --state ENABLED \
    --region $REGION \
    2>/dev/null || echo -e "${YELLOW}  Rule already exists${NC}"

echo -e "${GREEN}✓ Event logging rule ready${NC}"

# ============================================================
# Step 4: Create Cognito User Pool (Mock)
# ============================================================

echo -e "\n${BLUE}Step 4: Creating Cognito User Pool${NC}"

USER_POOL_RESPONSE=$(aws cognito-idp create-user-pool \
    --endpoint-url $LOCALSTACK_ENDPOINT \
    --pool-name "edforge-local-pool" \
    --auto-verified-attributes email \
    --username-attributes email \
    --region $REGION \
    2>/dev/null || echo '{"UserPool":{"Id":"local-user-pool"}}')

USER_POOL_ID=$(echo $USER_POOL_RESPONSE | grep -o '"Id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo -e "${GREEN}✓ Cognito User Pool created: $USER_POOL_ID${NC}"

# Create User Pool Client
CLIENT_RESPONSE=$(aws cognito-idp create-user-pool-client \
    --endpoint-url $LOCALSTACK_ENDPOINT \
    --user-pool-id "$USER_POOL_ID" \
    --client-name "edforge-local-client" \
    --generate-secret false \
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --region $REGION \
    2>/dev/null || echo '{"UserPoolClient":{"ClientId":"local-client-id"}}')

CLIENT_ID=$(echo $CLIENT_RESPONSE | grep -o '"ClientId":"[^"]*"' | head -1 | cut -d'"' -f4)
echo -e "${GREEN}✓ Cognito Client created: $CLIENT_ID${NC}"

# ============================================================
# Step 5: Seed Test Data
# ============================================================

echo -e "\n${BLUE}Step 5: Seeding test data${NC}"

# Create test tenant
echo -e "${YELLOW}Creating test tenant...${NC}"
aws dynamodb put-item \
    --endpoint-url $DYNAMODB_ENDPOINT \
    --table-name $IDENTITY_TABLE \
    --item '{
        "tenantId": {"S": "'$TEST_TENANT_ID'"},
        "entityKey": {"S": "METADATA"},
        "entityType": {"S": "TENANT"},
        "name": {"S": "Test School District"},
        "tier": {"S": "basic"},
        "status": {"S": "active"},
        "contactEmail": {"S": "admin@testdistrict.edu"},
        "createdAt": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"},
        "createdBy": {"S": "system"},
        "updatedAt": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"},
        "updatedBy": {"S": "system"},
        "version": {"N": "1"}
    }' \
    --region $REGION \
    2>/dev/null && echo -e "${GREEN}✓ Test tenant created${NC}" || echo -e "${YELLOW}  Test tenant already exists${NC}"

# Create test school
echo -e "${YELLOW}Creating test school...${NC}"
SCHOOL_ID="school-001"
aws dynamodb put-item \
    --endpoint-url $DYNAMODB_ENDPOINT \
    --table-name $IDENTITY_TABLE \
    --item '{
        "tenantId": {"S": "'$TEST_TENANT_ID'"},
        "entityKey": {"S": "SCHOOL#'$SCHOOL_ID'"},
        "entityType": {"S": "SCHOOL"},
        "schoolId": {"S": "'$SCHOOL_ID'"},
        "schoolCode": {"S": "TES001"},
        "name": {"S": "Test Elementary School"},
        "shortName": {"S": "TES"},
        "schoolType": {"S": "elementary"},
        "status": {"S": "active"},
        "timezone": {"S": "America/New_York"},
        "locale": {"S": "en-US"},
        "gsi1pk": {"S": "TENANT#'$TEST_TENANT_ID'#SCHOOLS"},
        "gsi1sk": {"S": "SCHOOL#'$SCHOOL_ID'"},
        "createdAt": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"},
        "createdBy": {"S": "system"},
        "updatedAt": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"},
        "updatedBy": {"S": "system"},
        "version": {"N": "1"}
    }' \
    --region $REGION \
    2>/dev/null && echo -e "${GREEN}✓ Test school created${NC}" || echo -e "${YELLOW}  Test school already exists${NC}"

# Create test admin user
echo -e "${YELLOW}Creating test admin user...${NC}"
USER_ID="user-admin-001"
aws dynamodb put-item \
    --endpoint-url $DYNAMODB_ENDPOINT \
    --table-name $IDENTITY_TABLE \
    --item '{
        "tenantId": {"S": "'$TEST_TENANT_ID'"},
        "entityKey": {"S": "USER#'$USER_ID'"},
        "entityType": {"S": "USER"},
        "userId": {"S": "'$USER_ID'"},
        "email": {"S": "admin@testdistrict.edu"},
        "firstName": {"S": "Test"},
        "lastName": {"S": "Admin"},
        "globalRole": {"S": "TenantAdmin"},
        "status": {"S": "active"},
        "gsi1pk": {"S": "EMAIL#admin@testdistrict.edu"},
        "gsi1sk": {"S": "TENANT#'$TEST_TENANT_ID'"},
        "createdAt": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"},
        "createdBy": {"S": "system"},
        "updatedAt": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"},
        "updatedBy": {"S": "system"},
        "version": {"N": "1"}
    }' \
    --region $REGION \
    2>/dev/null && echo -e "${GREEN}✓ Test admin user created${NC}" || echo -e "${YELLOW}  Test admin user already exists${NC}"

# ============================================================
# Summary
# ============================================================

echo -e "\n${BLUE}============================================================${NC}"
echo -e "${GREEN}Local Development Environment Ready!${NC}"
echo -e "${BLUE}============================================================${NC}"
echo -e ""
echo -e "Services:"
echo -e "  ${GREEN}●${NC} LocalStack:     $LOCALSTACK_ENDPOINT"
echo -e "  ${GREEN}●${NC} DynamoDB Local: $DYNAMODB_ENDPOINT"
echo -e "  ${GREEN}●${NC} Identity API:   http://localhost:3010"
echo -e "  ${GREEN}●${NC} Academics API:  http://localhost:3011"
echo -e ""
echo -e "Test Credentials:"
echo -e "  Tenant ID:  $TEST_TENANT_ID"
echo -e "  School ID:  $SCHOOL_ID"
echo -e "  User ID:    $USER_ID"
echo -e "  Email:      admin@testdistrict.edu"
echo -e ""
echo -e "Cognito (LocalStack):"
echo -e "  User Pool ID: $USER_POOL_ID"
echo -e "  Client ID:    $CLIENT_ID"
echo -e ""
echo -e "EventBridge:"
echo -e "  Bus Name: $EVENT_BUS_NAME"
echo -e ""
echo -e "Quick Commands:"
echo -e "  ${YELLOW}# Check service health${NC}"
echo -e "  curl http://localhost:3010/health"
echo -e "  curl http://localhost:3011/health"
echo -e ""
echo -e "  ${YELLOW}# List tables${NC}"
echo -e "  aws dynamodb list-tables --endpoint-url $DYNAMODB_ENDPOINT"
echo -e ""
echo -e "  ${YELLOW}# List events${NC}"
echo -e "  aws events list-rules --event-bus-name $EVENT_BUS_NAME --endpoint-url $LOCALSTACK_ENDPOINT"
echo -e ""
echo -e "  ${YELLOW}# Run tests${NC}"
echo -e "  cd server/application && npm run test"
echo -e ""
echo -e "${BLUE}============================================================${NC}"
