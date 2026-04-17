#!/bin/bash -e

# Install only necessary dependencies (most tools already in STANDARD_7_0)
echo "Using pre-installed tools from CodeBuild STANDARD_7_0 image"
node --version
npm --version
aws --version

# Only install CDK (not pre-installed)
sudo npm install -g aws-cdk

# Upgrade setuptools if needed
python3 -m pip install --upgrade setuptools --user

# Enable nocasematch option
shopt -s nocasematch

export REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]' 2>&1)
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Download from the ecs reference solution Bucket
export CDK_PARAM_S3_BUCKET_NAME="saas-reference-architecture-ecs-$ACCOUNT_ID-$REGION"
export CDK_SOURCE_NAME="source.tar.gz"

VERSIONS=$(aws s3api list-object-versions --bucket "$CDK_PARAM_S3_BUCKET_NAME" --prefix "$CDK_SOURCE_NAME" --query 'Versions[?IsLatest==`true`].{VersionId:VersionId}' --output text 2>&1)
CDK_PARAM_COMMIT_ID=$(echo "$VERSIONS" | awk 'NR==1{print $1}')

aws s3api get-object --bucket "$CDK_PARAM_S3_BUCKET_NAME" --key "$CDK_SOURCE_NAME" --version-id "$CDK_PARAM_COMMIT_ID" "$CDK_SOURCE_NAME" 2>&1 
tar --warning=no-unknown-keyword -xzf $CDK_SOURCE_NAME 2>/dev/null || tar -xzf $CDK_SOURCE_NAME
cd ./server

# Use DynamoDB only
# Replace all placeholders in service-info.txt including EVENT_BUS_NAME from SBT
sed "s/<REGION>/$REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g; s/<EVENT_BUS_NAME>/$EVENT_BUS_NAME/g" ./service-info.txt > ./lib/service-info.json

cat ./lib/service-info.json

npm install

# Parse tenant details from the input message from step function
export CDK_PARAM_TENANT_ID=$tenantId
export TIER=$tier
export TENANT_ADMIN_EMAIL=$email
export TENANT_NAME=$tenantName
export USE_FEDERATION=$useFederation
export COUNTRY="${country:-}"

# ============================================
# V1_DEFERRED: Only BASIC tier is supported in V1 MVP.
# Advanced and Premium tier provisioning code is preserved below but bypassed.
# The Advanced/Premium code paths have known issues:
#   1. CDK Nag errors block per-tenant stack deployment
#   2. Table naming mismatch: TenantSeeder expects edforge-identity-advanced
#      but CDK creates edforge-identity-{tenantName} per tenant
#   3. SBT ISSUE-008: Step Functions mask CodeBuild failures as success
#
# To re-enable Advanced/Premium provisioning:
#   1. Fix CDK Nag suppressions in tenant-template-nag.ts for actual service names
#   2. Fix TenantSeeder Lambda to dynamically resolve table names per tenant
#   3. Add error handling for cdk deploy failures (set -e not catching CDK Nag exit)
#   4. Remove this guard
# ============================================
if [[ $TIER != "BASIC" ]]; then
  echo "ERROR: V1 only supports BASIC tier. Received tier: $TIER"
  echo "Advanced and Premium tiers are deferred to a future release."
  exit 1
fi

# Dynamic configuration processing (Premium only)
if [[ $TIER == "PREMIUM" ]]; then
    export CDK_PARAM_USE_EC2_PREMIUM="${useEc2:-true}"  # Premium: dynamic from onboarding
fi
# Advanced and Basic use fixed settings from .env file
export CDK_PARAM_USE_RPROXY="${useRProxy:-true}"

# Define variables
# Use email as username (consistent with how TenantAdmin creates users in users.service.ts)
TENANT_ADMIN_USERNAME=$(echo "$TENANT_ADMIN_EMAIL" | tr '[:upper:]' '[:lower:]')
STACK_NAME="tenant-template-stack-basic"
USER_POOL_OUTPUT_PARAM_NAME="TenantUserpoolId"
API_GATEWAY_URL_OUTPUT_PARAM_NAME="ApiGatewayUrl"
APP_CLIENT_ID_OUTPUT_PARAM_NAME="UserPoolClientId"
BOOTSTRAP_STACK_NAME="shared-infra-stack"


# Deploy the tenant template for premium && advanced tier(silo)
if [[ $TIER == "PREMIUM" || $TIER == "ADVANCED" ]]; then
    STACK_NAME="tenant-template-stack-$CDK_PARAM_TENANT_ID"
    if [[ $TIER == "PREMIUM" ]]; then
      export CDK_ADV_CLUSTER='INACTIVE'
    else
      export CDK_ADV_CLUSTER='ACTIVE'
    fi

    export CDK_PARAM_CONTROL_PLANE_SOURCE='sbt-control-plane-api'
    export CDK_PARAM_ONBOARDING_DETAIL_TYPE='Onboarding'
    export CDK_PARAM_PROVISIONING_DETAIL_TYPE=$CDK_PARAM_ONBOARDING_DETAIL_TYPE
    export CDK_PARAM_OFFBOARDING_DETAIL_TYPE='Offboarding'
    export CDK_PARAM_DEPROVISIONING_DETAIL_TYPE=$CDK_PARAM_OFFBOARDING_DETAIL_TYPE
    export CDK_PARAM_PROVISIONING_EVENT_SOURCE="sbt-application-plane-api"
    export CDK_PARAM_APPLICATION_NAME_PLANE_SOURCE="sbt-application-plane-api"
    export CDK_PARAM_TIER=$TIER
    export CDK_PARAM_TENANT_NAME=$TENANT_NAME  #Added for demonstration during the workshop
    export CDK_PARAM_USE_FEDERATION=$USE_FEDERATION ###Federation check for selfSign

    
    # Optimization flags for faster deployment
    export SKIP_AUTOSCALING=true
    export CDK_DISABLE_VERSION_CHECK=true

    # cdk deploy $STACK_NAME --exclusively --require-approval never --concurrency 10 --asset-parallelism true

    # Added to buildspec.yml
    export CDK_ASSET_PARALLELISM=true
    export CDK_DISABLE_STACK_TRACE=true

    # Clean up zombie stacks from prior failed provisioning attempts
    STACK_STATUS=$(aws cloudformation describe-stacks \
      --stack-name "$STACK_NAME" \
      --query 'Stacks[0].StackStatus' \
      --output text 2>/dev/null || echo "DOES_NOT_EXIST")

    if [[ "$STACK_STATUS" == "ROLLBACK_COMPLETE" || "$STACK_STATUS" == "CREATE_FAILED" ]]; then
      echo "Stack $STACK_NAME is in $STACK_STATUS state, deleting before re-provisioning..."
      aws cloudformation delete-stack --stack-name "$STACK_NAME"
      aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME"
      echo "Zombie stack deleted successfully."
    elif [[ "$STACK_STATUS" == *"FAILED"* ]]; then
      echo "ERROR: Stack $STACK_NAME is in $STACK_STATUS state. Manual intervention required."
      echo "For UPDATE_ROLLBACK_FAILED, run: aws cloudformation continue-update-rollback --stack-name $STACK_NAME"
      exit 1
    fi

    cdk deploy $STACK_NAME \
      --exclusively \
      --require-approval never \
      --concurrency 10 \
      --asset-parallelism true

fi

# Read tenant details from the cloudformation stack output parameters
SAAS_APP_USERPOOL_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$USER_POOL_OUTPUT_PARAM_NAME'].OutputValue" --output text)
SAAS_APP_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$APP_CLIENT_ID_OUTPUT_PARAM_NAME'].OutputValue" --output text)
API_GATEWAY_URL=$(aws cloudformation describe-stacks --stack-name $BOOTSTRAP_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$API_GATEWAY_URL_OUTPUT_PARAM_NAME'].OutputValue" --output text)

# EMAIL TEMPLATE CONFIGURATION FLOW:
# ====================================
# Email templates (subject, body, SMS) are configured at User Pool creation time via CDK.
# The IdentityProvider construct in server/lib/tenant-template/identity-provider.ts sets:
#   - Email Subject: "Welcome to EdForge - Your Account is Ready"
#   - Email Body: Contains EdForge application URL (edforge.app) for tenant onboarding
#   - SMS Message: Contains EdForge application URL
#
# The client app URL is passed from SharedInfraStack -> TenantTemplateStack -> IdentityProvider
# via the clientAppUrl parameter, which is configured via CDK_PARAM_CLIENT_APP_URL environment variable.
#
# IMPORTANT: The User Pool must be created by CDK BEFORE this script runs, ensuring email
# templates are already configured with the client app URL. When admin-create-user is called below,
# Cognito automatically uses the pre-configured email templates from the User Pool.
#
# Validation: The CDK stack deployment (above) creates the User Pool with correct email templates.
# This script only creates the user, which triggers the email using the pre-configured templates.

# Create tenant admin user 
aws cognito-idp admin-create-user \
  --user-pool-id "$SAAS_APP_USERPOOL_ID" \
  --username "$TENANT_ADMIN_USERNAME" \
  --user-attributes Name=email,Value="$TENANT_ADMIN_EMAIL" Name=email_verified,Value="True" Name=phone_number,Value="+11234567890" Name="custom:userRole",Value="TenantAdmin" Name="custom:tenantId",Value="$CDK_PARAM_TENANT_ID" Name="custom:tenantTier",Value="$TIER" Name="custom:tenantName",Value="$TENANT_NAME"\
  --desired-delivery-mediums EMAIL

# Create tenant user group
aws cognito-idp create-group \
  --user-pool-id "$SAAS_APP_USERPOOL_ID" \
  --group-name "$CDK_PARAM_TENANT_ID"

# Add tenant admin user to tenant user group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$SAAS_APP_USERPOOL_ID" \
  --username "$TENANT_ADMIN_USERNAME" \
  --group-name "$CDK_PARAM_TENANT_ID"

# ============================================
# Export tier for SBT ScriptJob outgoing event
# ============================================
# SBT's ProvisioningScriptJob will automatically emit sbt_aws_provisionSuccess event
# with all exported environment variables. The TenantSeeder Lambda listens for this
# event and uses the tier to determine which DynamoDB table to write to.
export tier=$TIER

# Export tenantId for TenantSeeder Lambda (CRITICAL)
# This ensures the TENANT METADATA record is created with the correct tenantId
# that matches JWT tokens and all other data
export tenantId=$CDK_PARAM_TENANT_ID

# Export country for TenantSeeder Lambda (workspace settings initialization)
export country=$COUNTRY

echo "Provisioning complete. SBT will emit sbt_aws_provisionSuccess event with:"
echo "  Tenant ID: $CDK_PARAM_TENANT_ID"
echo "  Tenant Name: $TENANT_NAME"
echo "  Tier: $TIER"
echo "  Country: $COUNTRY"

# ============================================
# Layer 3.1 — Analytics alert topic provisioning
# ============================================
# Create a per-tenant SNS topic for tenant-scoped alerts (Layer 2 creates the
# operator topic; this covers the other half). Subscribe the TenantAdmin email.
# Persist the topic ARN on the METADATA row in the identity table so API/UI
# code can route alerts later.
#
# Failure is non-fatal — the migration script
# (scripts/analytics/migrate-tenant-alert-topics.ts) can backfill any tenant
# whose provisioning raced the seeder.
echo ""
echo "Provisioning tenant alert topic…"
ALERT_TOPIC_NAME="edforge-alerts-tenant-${CDK_PARAM_TENANT_ID}"
ALERT_TOPIC_ARN=$(aws sns create-topic \
  --name "$ALERT_TOPIC_NAME" \
  --query 'TopicArn' \
  --output text 2>/dev/null || echo "")

if [[ -n "$ALERT_TOPIC_ARN" && "$ALERT_TOPIC_ARN" != "None" ]]; then
  echo "  Topic: $ALERT_TOPIC_ARN"

  # Subscribe TenantAdmin email. SNS dedupes on protocol+endpoint, so this
  # is idempotent across re-provisioning.
  aws sns subscribe \
    --topic-arn "$ALERT_TOPIC_ARN" \
    --protocol email \
    --notification-endpoint "$TENANT_ADMIN_EMAIL" >/dev/null 2>&1 \
    && echo "  Subscribed: $TENANT_ADMIN_EMAIL (pending confirmation)" \
    || echo "  WARNING: failed to subscribe $TENANT_ADMIN_EMAIL to $ALERT_TOPIC_ARN"

  # Attach the topic ARN to the tenant METADATA row. The TenantSeeder Lambda
  # creates the METADATA row asynchronously after SBT emits the success event,
  # so poll-retry up to 60s. If the seeder is slow, the migration script will
  # attach the ARN on its next run.
  IDENTITY_TABLE="edforge-identity-basic"
  UPDATE_ATTEMPTS=0
  UPDATE_MAX_ATTEMPTS=4
  UPDATE_DELAY=15
  until [[ $UPDATE_ATTEMPTS -ge $UPDATE_MAX_ATTEMPTS ]]; do
    if aws dynamodb update-item \
        --table-name "$IDENTITY_TABLE" \
        --key "{\"tenantId\":{\"S\":\"$CDK_PARAM_TENANT_ID\"},\"entityKey\":{\"S\":\"METADATA\"}}" \
        --update-expression 'SET alertTopicArn = :arn, updatedAt = :ts' \
        --condition-expression 'attribute_exists(tenantId)' \
        --expression-attribute-values "{\":arn\":{\"S\":\"$ALERT_TOPIC_ARN\"},\":ts\":{\"S\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}}" \
        >/dev/null 2>&1; then
      echo "  Attached alertTopicArn to $IDENTITY_TABLE METADATA row"
      break
    fi
    UPDATE_ATTEMPTS=$((UPDATE_ATTEMPTS + 1))
    if [[ $UPDATE_ATTEMPTS -lt $UPDATE_MAX_ATTEMPTS ]]; then
      echo "  METADATA row not yet present (seeder still running?); retrying in ${UPDATE_DELAY}s…"
      sleep $UPDATE_DELAY
    fi
  done
  if [[ $UPDATE_ATTEMPTS -ge $UPDATE_MAX_ATTEMPTS ]]; then
    echo "  WARNING: alertTopicArn not attached after $((UPDATE_MAX_ATTEMPTS * UPDATE_DELAY))s. Run migrate-tenant-alert-topics.ts to backfill."
  fi

  # Export for any downstream tooling that wants the ARN via the SBT event.
  export alertTopicArn="$ALERT_TOPIC_ARN"
else
  echo "  WARNING: failed to create $ALERT_TOPIC_NAME. Run migrate-tenant-alert-topics.ts to backfill."
fi

# Create JSON response of output parameters
export tenantConfig=$(jq --arg SAAS_APP_USERPOOL_ID "$SAAS_APP_USERPOOL_ID" \
--arg SAAS_APP_CLIENT_ID "$SAAS_APP_CLIENT_ID" \
--arg API_GATEWAY_URL "$API_GATEWAY_URL" \
-n '{"userPoolId":$SAAS_APP_USERPOOL_ID,"appClientId":$SAAS_APP_CLIENT_ID,"apiGatewayUrl":$API_GATEWAY_URL}')
export registrationStatus="Created"
