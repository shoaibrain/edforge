#!/bin/bash
# ============================================
# Seed Existing Tenant Metadata
# ============================================
# One-time script to seed tenant metadata for existing tenants
# that were provisioned before the TenantSeeder Lambda was deployed.
#
# This script inserts the tenant metadata record into the identity
# service DynamoDB table with the correct entityKey format.
#
# Usage:
#   chmod +x seed-existing-tenant.sh
#   AWS_PROFILE=dev ./seed-existing-tenant.sh
#
# ============================================

set -e

# Configuration - Update these values for your tenant
TENANT_ID="${TENANT_ID:-6c24289d-2c03-4612-93b2-3a21a6785bcc}"
TENANT_NAME="${TENANT_NAME:-Lincoln High School}"
SUBDOMAIN="${SUBDOMAIN:-rainshoaib}"
EMAIL="${EMAIL:-rainshoaib01@gmail.com}"
TIER="${TIER:-BASIC}"
TABLE_NAME="${TABLE_NAME:-edforge-identity-basic}"
REGION="${AWS_REGION:-us-east-1}"

# Generate timestamp
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
CREATED_AT="${CREATED_AT:-2026-01-07T00:00:00.000Z}"

# Convert subdomain to lowercase for GSI key
SUBDOMAIN_LOWER=$(echo "$SUBDOMAIN" | tr '[:upper:]' '[:lower:]')

echo "============================================"
echo "Seeding Tenant Metadata"
echo "============================================"
echo "Tenant ID:    $TENANT_ID"
echo "Tenant Name:  $TENANT_NAME"
echo "Subdomain:    $SUBDOMAIN"
echo "Email:        $EMAIL"
echo "Tier:         $TIER"
echo "Table:        $TABLE_NAME"
echo "Region:       $REGION"
echo "============================================"

# Default features based on tier
if [[ "$TIER" == "BASIC" ]]; then
  FEATURES='{
    "maxSchools": 1,
    "maxUsersPerSchool": 50,
    "maxStudentsPerSchool": 500,
    "enrollment": true,
    "attendance": true,
    "grades": true,
    "curriculum": true,
    "scheduling": true,
    "finance": false,
    "parentPortal": true,
    "studentPortal": false,
    "reporting": true,
    "analytics": false
  }'
elif [[ "$TIER" == "PREMIUM" ]]; then
  FEATURES='{
    "maxSchools": 5,
    "maxUsersPerSchool": 200,
    "maxStudentsPerSchool": 2000,
    "enrollment": true,
    "attendance": true,
    "grades": true,
    "curriculum": true,
    "scheduling": true,
    "finance": true,
    "parentPortal": true,
    "studentPortal": true,
    "reporting": true,
    "analytics": true
  }'
else
  FEATURES='{
    "maxSchools": 100,
    "maxUsersPerSchool": 1000,
    "maxStudentsPerSchool": 10000,
    "enrollment": true,
    "attendance": true,
    "grades": true,
    "curriculum": true,
    "scheduling": true,
    "finance": true,
    "parentPortal": true,
    "studentPortal": true,
    "reporting": true,
    "analytics": true
  }'
fi

# Escape features JSON for DynamoDB
FEATURES_ESCAPED=$(echo "$FEATURES" | jq -c .)

# Insert tenant metadata into DynamoDB
echo ""
echo "Inserting tenant metadata..."

aws dynamodb put-item \
  --table-name "$TABLE_NAME" \
  --item '{
    "tenantId": {"S": "'"$TENANT_ID"'"},
    "entityKey": {"S": "METADATA"},
    "entityType": {"S": "TENANT"},
    "name": {"S": "'"$TENANT_NAME"'"},
    "subdomain": {"S": "'"$SUBDOMAIN_LOWER"'"},
    "tier": {"S": "'"$TIER"'"},
    "status": {"S": "active"},
    "contactEmail": {"S": "'"$EMAIL"'"},
    "features": {"S": "'"${FEATURES_ESCAPED//\"/\\\"}"'"},
    "gsi1pk": {"S": "SUBDOMAIN#'"$SUBDOMAIN_LOWER"'"},
    "gsi1sk": {"S": "TENANT"},
    "schoolCount": {"N": "0"},
    "userCount": {"N": "0"},
    "studentCount": {"N": "0"},
    "createdAt": {"S": "'"$CREATED_AT"'"},
    "updatedAt": {"S": "'"$NOW"'"},
    "createdBy": {"S": "SYSTEM"},
    "updatedBy": {"S": "SYSTEM"},
    "version": {"N": "1"}
  }' \
  --region "$REGION"

echo ""
echo "✅ Tenant metadata seeded successfully!"
echo ""
echo "Verifying insertion..."

# Verify the insertion
aws dynamodb get-item \
  --table-name "$TABLE_NAME" \
  --key '{
    "tenantId": {"S": "'"$TENANT_ID"'"},
    "entityKey": {"S": "METADATA"}
  }' \
  --region "$REGION" \
  --query 'Item.{tenantId:tenantId.S,entityKey:entityKey.S,name:name.S,status:status.S,tier:tier.S}' \
  --output table

echo ""
echo "============================================"
echo "Done! You can now test the tenant API:"
echo "  GET /tenants/$TENANT_ID"
echo "============================================"
