#!/bin/bash

# Script to extract environment variable values for NextJS applications
# from AWS CloudFormation stack outputs
#
# Usage: ./get-nextjs-env-values.sh [adminweb|saasapp]

set -e

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed. Please install it first."
    exit 1
fi

# Determine which app to configure
APP_TYPE="${1:-adminweb}"

if [ "$APP_TYPE" != "adminweb" ] && [ "$APP_TYPE" != "saasapp" ]; then
    echo "Error: Invalid app type. Use 'adminweb' or 'saasapp'"
    echo "Usage: $0 [adminweb|saasapp]"
    exit 1
fi

echo "========================================="
echo "Fetching environment values for: $APP_TYPE"
echo "========================================="
echo ""

# Function to get CloudFormation output
get_cfn_output() {
    local stack_name=$1
    local output_key=$2
    aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
        --output text 2>/dev/null || echo ""
}

# Function to get exported value
get_cfn_export() {
    local export_name=$1
    aws cloudformation list-exports \
        --query "Exports[?Name=='$export_name'].Value" \
        --output text 2>/dev/null || echo ""
}

if [ "$APP_TYPE" == "adminweb" ]; then
    echo "Fetching values for AdminWeb NextJS application..."
    echo ""
    
    # Get values from control-plane-stack
    CONTROL_PLANE_API_URL=$(get_cfn_export "ControlPlaneApiUrl")
    if [ -z "$CONTROL_PLANE_API_URL" ]; then
        CONTROL_PLANE_API_URL=$(get_cfn_output "controlplane-stack" "ControlPlaneApiUrl")
    fi
    
    COGNITO_CLIENT_ID=$(get_cfn_export "CognitoClientId")
    if [ -z "$COGNITO_CLIENT_ID" ]; then
        COGNITO_CLIENT_ID=$(get_cfn_output "controlplane-stack" "CognitoClientId")
    fi
    
    COGNITO_WELL_KNOWN_URL=$(get_cfn_export "CognitoWellKnownUrl")
    if [ -z "$COGNITO_WELL_KNOWN_URL" ]; then
        COGNITO_WELL_KNOWN_URL=$(get_cfn_output "controlplane-stack" "CognitoWellKnownUrl")
    fi
    
    COGNITO_TOKEN_ENDPOINT=$(get_cfn_export "CognitoTokenEndpoint")
    if [ -z "$COGNITO_TOKEN_ENDPOINT" ]; then
        COGNITO_TOKEN_ENDPOINT=$(get_cfn_output "controlplane-stack" "CognitoTokenEndpoint")
    fi
    
    ADMIN_SITE_URL=$(get_cfn_export "AdminSiteUrl")
    if [ -z "$ADMIN_SITE_URL" ]; then
        ADMIN_SITE_URL=$(get_cfn_output "shared-infra-stack" "adminSiteUrl")
    fi
    
    # Generate NEXTAUTH_SECRET
    NEXTAUTH_SECRET=$(openssl rand -base64 32)
    
    echo "======================================"
    echo "Environment Variables for AdminWeb"
    echo "======================================"
    echo ""
    echo "# Cognito Configuration"
    echo "NEXT_PUBLIC_CLIENT_ID=$COGNITO_CLIENT_ID"
    echo "NEXT_PUBLIC_ISSUER=$COGNITO_TOKEN_ENDPOINT"
    echo "NEXT_PUBLIC_API_URL=$CONTROL_PLANE_API_URL"
    echo "NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=$COGNITO_WELL_KNOWN_URL"
    echo ""
    echo "# NextAuth Configuration"
    echo "NEXTAUTH_SECRET=$NEXTAUTH_SECRET"
    echo "NEXTAUTH_URL=http://localhost:3000  # Update for production deployment"
    echo ""
    echo "# Additional Information"
    echo "# CloudFront Admin Site URL: $ADMIN_SITE_URL"
    echo ""
    echo "======================================"
    echo "Copy the above values to your .env.local file"
    echo "File location: client/edforgeadminweb/.env.local"
    echo "======================================"
    
elif [ "$APP_TYPE" == "saasapp" ]; then
    echo "Fetching values for SaaS App NextJS application..."
    echo ""
    
    # Get values for SaaS application (TenantAPI)
    TENANT_API_URL=$(get_cfn_export "TenantApiUrl")
    if [ -z "$TENANT_API_URL" ]; then
        TENANT_API_URL=$(get_cfn_output "shared-infra-stack" "TenantApiUrl")
    fi
    
    APP_SITE_URL=$(get_cfn_export "AppSiteUrl")
    if [ -z "$APP_SITE_URL" ]; then
        APP_SITE_URL=$(get_cfn_output "shared-infra-stack" "appSiteUrl")
    fi
    
    # Note: Tenant-specific Cognito values are dynamically configured per tenant
    # You'll need to fetch these from the tenant-specific stacks or DynamoDB
    
    echo "======================================"
    echo "Environment Variables for SaaS App"
    echo "======================================"
    echo ""
    echo "# API Configuration"
    echo "NEXT_PUBLIC_API_URL=$TENANT_API_URL"
    echo ""
    echo "# Additional Information"
    echo "# CloudFront App Site URL: $APP_SITE_URL"
    echo ""
    echo "# Note: Tenant-specific Cognito configuration is fetched dynamically"
    echo "# based on tenant subdomain/path routing"
    echo ""
    echo "======================================"
    echo "Copy the above values to your .env.local file"
    echo "======================================"
fi

echo ""
echo "Done!"