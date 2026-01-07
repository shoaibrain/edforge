#!/bin/bash
# Debug 401 Unauthorized Issue - Comprehensive Diagnostic Script
# Usage: ./debug-401-issue.sh [USER_POOL_ID] [CLIENT_ID] [USERNAME]

set -e

# Configuration
export AWS_PROFILE=${AWS_PROFILE:-dev}
export AWS_REGION=${AWS_REGION:-us-east-1}
export USER_POOL_ID=${1:-us-east-1_Ituu6vuqD}
export CLIENT_ID=${2:-7931s8p6khga01du6ppmm9hmpm}
export USERNAME=${3:-""}

echo "=========================================="
echo "401 Unauthorized Issue - Diagnostic Tool"
echo "=========================================="
echo "AWS Profile: $AWS_PROFILE"
echo "Region: $AWS_REGION"
echo "User Pool ID: $USER_POOL_ID"
echo "Client ID: $CLIENT_ID"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Verify User Pool Exists
echo -e "${YELLOW}=== Step 1: Verify User Pool Exists ===${NC}"
if aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --region "$AWS_REGION" \
  --query 'UserPool.{Id:Id,Name:Name,Status:Status}' \
  --output table 2>/dev/null; then
  echo -e "${GREEN}✅ User Pool exists${NC}"
else
  echo -e "${RED}❌ User Pool not found or inaccessible${NC}"
  exit 1
fi

# Step 2: Check Custom Attributes
echo -e "\n${YELLOW}=== Step 2: Check Custom Attributes ===${NC}"
CUSTOM_ATTRS=$(aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --region "$AWS_REGION" \
  --query 'UserPool.SchemaAttributes[?contains(Name, `custom:`)].[Name,AttributeDataType]' \
  --output json 2>/dev/null)

REQUIRED_ATTRS=("custom:tenantId" "custom:userRole" "custom:tenantTier")
MISSING_ATTRS=()

for attr in "${REQUIRED_ATTRS[@]}"; do
  if echo "$CUSTOM_ATTRS" | jq -e ".[] | select(.[0] == \"$attr\")" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ $attr exists${NC}"
  else
    echo -e "${RED}❌ $attr MISSING${NC}"
    MISSING_ATTRS+=("$attr")
  fi
done

if [ ${#MISSING_ATTRS[@]} -gt 0 ]; then
  echo -e "\n${RED}⚠️  Missing required custom attributes: ${MISSING_ATTRS[*]}${NC}"
  echo "   This User Pool may not have been created by EdForge TenantTemplateStack"
fi

# Step 3: Check App Client Configuration
echo -e "\n${YELLOW}=== Step 3: Check App Client Configuration ===${NC}"
CLIENT_CONFIG=$(aws cognito-idp describe-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$CLIENT_ID" \
  --region "$AWS_REGION" \
  --output json 2>/dev/null)

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ App Client found${NC}"
  CLIENT_NAME=$(echo "$CLIENT_CONFIG" | jq -r '.UserPoolClient.ClientName')
  echo "   Client Name: $CLIENT_NAME"
  
  # Check ReadAttributes
  READ_ATTRS=$(echo "$CLIENT_CONFIG" | jq -r '.UserPoolClient.ReadAttributes[]?' 2>/dev/null || echo "")
  echo "   ReadAttributes:"
  echo "$READ_ATTRS" | while read -r attr; do
    if [[ "$attr" == custom:* ]]; then
      echo -e "     ${GREEN}✅ $attr${NC}"
    elif [[ "$attr" != "" ]]; then
      echo "     - $attr"
    fi
  done
  
  # Check if custom attributes are in ReadAttributes
  for attr in "${REQUIRED_ATTRS[@]}"; do
    if echo "$READ_ATTRS" | grep -q "$attr"; then
      echo -e "   ${GREEN}✅ $attr is readable${NC}"
    else
      echo -e "   ${RED}❌ $attr NOT in ReadAttributes${NC}"
      echo "      This means tokens won't include this attribute!"
    fi
  done
  
  # Check WriteAttributes
  WRITE_ATTRS=$(echo "$CLIENT_CONFIG" | jq -r '.UserPoolClient.WriteAttributes[]?' 2>/dev/null || echo "")
  echo "   WriteAttributes configured: $(echo "$WRITE_ATTRS" | wc -l | tr -d ' ') attributes"
else
  echo -e "${RED}❌ App Client not found${NC}"
fi

# Step 4: Test JWKS Endpoint
echo -e "\n${YELLOW}=== Step 4: Test JWKS Endpoint ===${NC}"
JWKS_URL="https://cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json"
if curl -s -f "$JWKS_URL" > /dev/null 2>&1; then
  echo -e "${GREEN}✅ JWKS endpoint accessible${NC}"
  KID=$(curl -s "$JWKS_URL" | jq -r '.keys[0].kid' 2>/dev/null)
  if [ -n "$KID" ] && [ "$KID" != "null" ]; then
    echo "   Key ID: $KID"
  fi
else
  echo -e "${RED}❌ JWKS endpoint not accessible${NC}"
  echo "   URL: $JWKS_URL"
fi

# Step 5: Check User Attributes (if username provided)
if [ -n "$USERNAME" ]; then
  echo -e "\n${YELLOW}=== Step 5: Check User Attributes ===${NC}"
  USER_ATTRS=$(aws cognito-idp admin-get-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$USERNAME" \
    --region "$AWS_REGION" \
    --output json 2>/dev/null)
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ User found${NC}"
    for attr in "${REQUIRED_ATTRS[@]}"; do
      VALUE=$(echo "$USER_ATTRS" | jq -r ".UserAttributes[]? | select(.Name == \"$attr\") | .Value" 2>/dev/null)
      if [ -n "$VALUE" ] && [ "$VALUE" != "null" ]; then
        echo -e "   ${GREEN}✅ $attr = $VALUE${NC}"
      else
        echo -e "   ${RED}❌ $attr NOT SET${NC}"
        echo "      User must have this attribute set to authenticate"
      fi
    done
  else
    echo -e "${RED}❌ User not found${NC}"
  fi
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
    
    # Get tenant ID
    TENANT_ID=$(aws cloudformation describe-stacks \
      --stack-name "$STACK" \
      --region "$AWS_REGION" \
      --query 'Stacks[0].Parameters[?ParameterKey==`TenantId`].ParameterValue' \
      --output text 2>/dev/null)
    
    if [ -n "$TENANT_ID" ]; then
      echo "   Tenant ID: $TENANT_ID"
    fi
    break
  fi
done

if [ -z "$FOUND_STACK" ]; then
  echo -e "${YELLOW}⚠️  No matching tenant stack found${NC}"
  echo "   This User Pool may have been created outside of EdForge"
fi

# Step 7: Check Authorizer Logs
echo -e "\n${YELLOW}=== Step 7: Check Authorizer Logs (Last 10 minutes) ===${NC}"
AUTHORIZER_FUNCTION=$(aws lambda list-functions \
  --region "$AWS_REGION" \
  --query 'Functions[?contains(FunctionName, `Authorizer`) || contains(FunctionName, `authorizer`)].FunctionName' \
  --output text 2>/dev/null | head -1)

if [ -n "$AUTHORIZER_FUNCTION" ]; then
  echo "Authorizer Function: $AUTHORIZER_FUNCTION"
  echo ""
  echo "Recent errors:"
  aws logs tail "/aws/lambda/$AUTHORIZER_FUNCTION" \
    --since 10m \
    --region "$AWS_REGION" \
    --filter-pattern "ERROR" \
    --format short 2>/dev/null | tail -10 || echo "   No recent errors found"
  
  echo ""
  echo "JWT validation messages:"
  aws logs tail "/aws/lambda/$AUTHORIZER_FUNCTION" \
    --since 10m \
    --region "$AWS_REGION" \
    --filter-pattern "JWT validation" \
    --format short 2>/dev/null | tail -10 || echo "   No JWT validation messages found"
else
  echo -e "${RED}❌ Authorizer function not found${NC}"
fi

# Step 8: Summary and Recommendations
echo -e "\n${YELLOW}=== Summary and Recommendations ===${NC}"

if [ ${#MISSING_ATTRS[@]} -gt 0 ]; then
  echo -e "${RED}❌ ISSUE FOUND: Missing custom attributes in User Pool schema${NC}"
  echo "   Solution: This User Pool needs to be recreated via EdForge CDK"
  echo "   OR manually add custom attributes (requires User Pool recreation)"
fi

# Check if custom attributes are readable
READABLE_ISSUE=false
for attr in "${REQUIRED_ATTRS[@]}"; do
  if [ -n "$READ_ATTRS" ] && ! echo "$READ_ATTRS" | grep -q "$attr"; then
    READABLE_ISSUE=true
    break
  fi
done

if [ "$READABLE_ISSUE" = true ]; then
  echo -e "${RED}❌ ISSUE FOUND: Custom attributes not in ReadAttributes${NC}"
  echo "   Solution: Redeploy tenant stack to update App Client configuration"
  echo "   Command: cd server && AWS_PROFILE=dev npx cdk deploy $FOUND_STACK"
fi

if [ -z "$FOUND_STACK" ]; then
  echo -e "${YELLOW}⚠️  User Pool not managed by EdForge${NC}"
  echo "   Solution: Update frontend .env.local to use correct User Pool"
  echo "   OR create a new tenant via EdForge provisioning"
fi

echo ""
echo "=========================================="
echo "Diagnostic Complete"
echo "=========================================="
echo ""
echo "Next Steps:"
echo "1. Review the issues above"
echo "2. Check CloudWatch logs for detailed error messages"
echo "3. Verify user has custom attributes set"
echo "4. Test with a fresh token after fixing issues"
echo ""
echo "For detailed debugging guide, see:"
echo "docs/DEBUGGING_401_UNAUTHORIZED_GUIDE.md"

