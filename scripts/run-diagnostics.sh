#!/bin/bash
# Run Diagnostics for 401 Unauthorized Issue
# This script can be run directly in your terminal

set -e

# Configuration
export AWS_PROFILE=${AWS_PROFILE:-dev}
export AWS_REGION=us-east-1
export USER_POOL_ID=us-east-1_Ituu6vuqD
export CLIENT_ID=7931s8p6khga01du6ppmm9hmpm

echo "=========================================="
echo "401 Unauthorized Diagnostic Script"
echo "=========================================="
echo "AWS Profile: $AWS_PROFILE"
echo "Region: $AWS_REGION"
echo "User Pool ID: $USER_POOL_ID"
echo "Client ID: $CLIENT_ID"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Step 1: Verify User Pool
echo -e "${YELLOW}=== Step 1: Verify User Pool Exists ===${NC}"
if aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --region "$AWS_REGION" \
  --query 'UserPool.{Id:Id,Name:Name,Status:Status}' \
  --output table 2>/dev/null; then
  echo -e "${GREEN}✅ User Pool exists${NC}"
else
  echo -e "${RED}❌ User Pool not found${NC}"
  exit 1
fi

# Step 2: Check Custom Attributes
echo -e "\n${YELLOW}=== Step 2: Check Custom Attributes in Schema ===${NC}"
CUSTOM_ATTRS=$(aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --region "$AWS_REGION" \
  --query 'UserPool.SchemaAttributes[?contains(Name, `custom:`)].[Name,AttributeDataType]' \
  --output json 2>/dev/null)

echo "$CUSTOM_ATTRS" | jq -r '.[] | "\(.[0]): \(.[1])"' || echo "No custom attributes found"

REQUIRED=("custom:tenantId" "custom:userRole" "custom:tenantTier")
MISSING=()

for attr in "${REQUIRED[@]}"; do
  if echo "$CUSTOM_ATTRS" | jq -e ".[] | select(.[0] == \"$attr\")" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✅ $attr${NC}"
  else
    echo -e "  ${RED}❌ $attr MISSING${NC}"
    MISSING+=("$attr")
  fi
done

# Step 3: Check App Client ReadAttributes
echo -e "\n${YELLOW}=== Step 3: Check App Client ReadAttributes ===${NC}"
READ_ATTRS=$(aws cognito-idp describe-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$CLIENT_ID" \
  --region "$AWS_REGION" \
  --query 'UserPoolClient.ReadAttributes' \
  --output json 2>/dev/null)

echo "ReadAttributes configured:"
echo "$READ_ATTRS" | jq -r '.[]' | while read -r attr; do
  if [[ "$attr" == custom:* ]]; then
    echo -e "  ${GREEN}✅ $attr${NC}"
  else
    echo "  - $attr"
  fi
done

# Check if required custom attributes are readable
echo ""
echo "Checking if required custom attributes are in ReadAttributes:"
for attr in "${REQUIRED[@]}"; do
  if echo "$READ_ATTRS" | jq -e ".[] | select(. == \"$attr\")" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✅ $attr is readable${NC}"
  else
    echo -e "  ${RED}❌ $attr NOT in ReadAttributes${NC}"
    echo "     ⚠️  This means tokens won't include this attribute!"
  fi
done

# Step 4: List Users and Check Their Attributes
echo -e "\n${YELLOW}=== Step 4: List Users and Check Custom Attributes ===${NC}"
USERS=$(aws cognito-idp list-users \
  --user-pool-id "$USER_POOL_ID" \
  --region "$AWS_REGION" \
  --max-items 10 \
  --output json 2>/dev/null)

USER_COUNT=$(echo "$USERS" | jq '.Users | length')
echo "Found $USER_COUNT user(s)"

if [ "$USER_COUNT" -gt 0 ]; then
  echo ""
  echo "$USERS" | jq -r '.Users[] | "Username: \(.Username), Status: \(.UserStatus)"'
  echo ""
  echo "Checking custom attributes for each user:"
  
  echo "$USERS" | jq -c '.Users[]' | while read -r user; do
    USERNAME=$(echo "$user" | jq -r '.Username')
    echo ""
    echo "  User: $USERNAME"
    
    for attr in "${REQUIRED[@]}"; do
      VALUE=$(echo "$user" | jq -r ".Attributes[]? | select(.Name == \"$attr\") | .Value" 2>/dev/null)
      if [ -n "$VALUE" ] && [ "$VALUE" != "null" ]; then
        echo -e "    ${GREEN}✅ $attr = $VALUE${NC}"
      else
        echo -e "    ${RED}❌ $attr NOT SET${NC}"
      fi
    done
  done
else
  echo -e "${YELLOW}⚠️  No users found in User Pool${NC}"
fi

# Step 5: Test JWKS Endpoint
echo -e "\n${YELLOW}=== Step 5: Test JWKS Endpoint ===${NC}"
JWKS_URL="https://cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json"
if curl -s -f "$JWKS_URL" > /dev/null 2>&1; then
  echo -e "${GREEN}✅ JWKS endpoint accessible${NC}"
  KID=$(curl -s "$JWKS_URL" | jq -r '.keys[0].kid' 2>/dev/null)
  if [ -n "$KID" ] && [ "$KID" != "null" ]; then
    echo "   Key ID: $KID"
  fi
else
  echo -e "${RED}❌ JWKS endpoint not accessible${NC}"
fi

# Step 6: Find Tenant Stack
echo -e "\n${YELLOW}=== Step 6: Find Tenant Stack ===${NC}"
FOUND_STACK=""
for STACK in $(aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --region "$AWS_REGION" \
  --query 'StackSummaries[?contains(StackName, `tenant-template`)].StackName' \
  --output text 2>/dev/null); do
  
  STACK_UP=$(aws cloudformation describe-stacks \
    --stack-name "$STACK" \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`TenantUserpoolId`].OutputValue' \
    --output text 2>/dev/null)
  
  if [ "$STACK_UP" == "$USER_POOL_ID" ]; then
    echo -e "${GREEN}✅ Found matching stack: $STACK${NC}"
    FOUND_STACK="$STACK"
    break
  fi
done

if [ -z "$FOUND_STACK" ]; then
  echo -e "${YELLOW}⚠️  No matching tenant stack found${NC}"
fi

# Step 7: Check Authorizer Logs
echo -e "\n${YELLOW}=== Step 7: Check Authorizer Logs (Last 15 minutes) ===${NC}"
AUTHORIZER_FUNCTION=$(aws lambda list-functions \
  --region "$AWS_REGION" \
  --query 'Functions[?contains(FunctionName, `Authorizer`) || contains(FunctionName, `authorizer`)].FunctionName' \
  --output text 2>/dev/null | head -1)

if [ -n "$AUTHORIZER_FUNCTION" ]; then
  echo "Authorizer Function: $AUTHORIZER_FUNCTION"
  echo ""
  echo "Recent errors:"
  aws logs tail "/aws/lambda/$AUTHORIZER_FUNCTION" \
    --since 15m \
    --region "$AWS_REGION" \
    --filter-pattern "ERROR" \
    --format short 2>/dev/null | tail -10 || echo "  No recent errors"
  
  echo ""
  echo "JWT validation messages:"
  aws logs tail "/aws/lambda/$AUTHORIZER_FUNCTION" \
    --since 15m \
    --region "$AWS_REGION" \
    --filter-pattern "JWT validation" \
    --format short 2>/dev/null | tail -10 || echo "  No JWT validation messages"
else
  echo -e "${RED}❌ Authorizer function not found${NC}"
fi

# Summary
echo -e "\n${YELLOW}=== Summary ===${NC}"

if [ ${#MISSING[@]} -gt 0 ]; then
  echo -e "${RED}❌ ISSUE: Missing custom attributes in User Pool schema${NC}"
  echo "   Missing: ${MISSING[*]}"
  echo "   Solution: Recreate User Pool via CDK or manually add attributes"
fi

# Check ReadAttributes issue
READ_ISSUE=false
for attr in "${REQUIRED[@]}"; do
  if ! echo "$READ_ATTRS" | jq -e ".[] | select(. == \"$attr\")" > /dev/null 2>&1; then
    READ_ISSUE=true
    break
  fi
done

if [ "$READ_ISSUE" = true ]; then
  echo -e "${RED}❌ ISSUE: Custom attributes not in ReadAttributes${NC}"
  echo "   Solution: Redeploy tenant stack to update App Client"
  if [ -n "$FOUND_STACK" ]; then
    echo "   Command: cd server && AWS_PROFILE=$AWS_PROFILE npx cdk deploy $FOUND_STACK"
  fi
fi

if [ "$USER_COUNT" -eq 0 ]; then
  echo -e "${YELLOW}⚠️  No users found - create a user first${NC}"
fi

echo ""
echo "=========================================="
echo "Diagnostic Complete"
echo "=========================================="

