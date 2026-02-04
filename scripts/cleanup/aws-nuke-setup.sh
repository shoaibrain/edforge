#!/bin/bash -e

# Setup and configure aws-nuke for edforge cleanup
# WARNING: This will delete ALL resources matching the filters!

export AWS_PROFILE=${AWS_PROFILE:-dev}

echo "=============================================="
echo "aws-nuke Setup for EdForge Cleanup"
echo "=============================================="
echo ""
echo "⚠️  WARNING: aws-nuke will DELETE resources!"
echo "This script will help you set it up safely."
echo ""

# Check if aws-nuke is installed
if ! command -v aws-nuke &> /dev/null; then
    echo "aws-nuke is not installed. Installing..."
    echo ""
    echo "Option 1: Install via Homebrew (macOS):"
    echo "  brew install ekristen/tap/aws-nuke@3"
    echo ""
    echo "Option 2: Download binary:"
    echo "  Visit: https://github.com/ekristen/aws-nuke/releases"
    echo "  Download the latest release for your platform"
    echo ""
    echo "Option 3: Install via go:"
    echo "  go install github.com/ekristen/aws-nuke/v3@latest"
    echo ""
    read -p "Press Enter after installing aws-nuke..."
fi

if ! command -v aws-nuke &> /dev/null; then
    echo "ERROR: aws-nuke is still not installed"
    exit 1
fi

echo "✓ aws-nuke is installed"
echo ""

# Create config directory
CONFIG_DIR="$HOME/.aws-nuke"
mkdir -p "$CONFIG_DIR"

# Create edforge-specific config
CONFIG_FILE="$CONFIG_DIR/edforge-config.yaml"

echo "Creating aws-nuke configuration file..."
cat > "$CONFIG_FILE" << 'EOF'
regions:
  - us-east-1

account-blocklist:
  - "999999999999"  # Add your production account ID here if needed

accounts:
  "346698404105":  # Your dev account ID
    default-region: us-east-1
    account-alias: edforge-dev  # Required by aws-nuke for safety
    filters:
      # CloudFormation Stacks
      CloudFormationStack:
        - type: regex
          value: '^(shared-infra-stack|controlplane-stack|core-appplane-stack|tenant-template-stack-.*)$'
      
      # S3 Buckets
      S3Bucket:
        - type: regex
          value: '^(shared-infra-stack-|controlplane-stack-|core-appplane-|tenant-update-stack-|saas-reference-architecture-).*'
      
      # ECS Clusters and Services
      ECSCluster:
        - type: regex
          value: '^prod-.*'
      
      ECSService:
        - type: regex
          value: '.*'
      
      # Lambda Functions
      LambdaFunction:
        - type: regex
          value: '^(shared-infra-stack-|controlplane-stack-).*'
      
      # EventBridge Rules
      EventBridgeRule:
        - type: regex
          value: '.*edforge.*|.*tenant.*'
      
      # DynamoDB Tables
      DynamoDBTable:
        - type: regex
          value: '^(TenantMapping|.*tenant.*|.*controlplane.*)$'
      
      # API Gateway
      APIGatewayRestAPI:
        - type: regex
          value: '.*'
      
      # CloudFront Distributions
      CloudFrontDistribution:
        - type: regex
          value: '.*'
      
      # Cognito User Pools
      CognitoUserPool:
        - type: regex
          value: '.*'
      
      # ECR Repositories
      ECRRepository:
        - type: regex
          value: '^(identity|academics|rproxy)$'
      
      # VPCs (be careful!)
      VPC:
        - type: regex
          value: '^shared-infra-.*'
      
      # Security Groups
      SecurityGroup:
        - type: regex
          value: '^shared-infra-.*|^controlplane-.*'
      
      # Load Balancers
      LoadBalancer:
        - type: regex
          value: '.*'
      
      # IAM Roles (be very careful!)
      IAMRole:
        - type: regex
          value: '^(shared-infra-stack-|controlplane-stack-|core-appplane-stack-|tenant-template-stack-).*'
      
      # IAM Policies
      IAMPolicy:
        - type: regex
          value: '^(shared-infra-stack-|controlplane-stack-|core-appplane-stack-|tenant-template-stack-).*'
      
      # CloudWatch Log Groups
      CloudWatchLogGroup:
        - type: regex
          value: '^/aws/(lambda|ecs)/(shared-infra|controlplane|tenant).*'
      
      # Secrets Manager
      SecretsManagerSecret:
        - type: regex
          value: '^(shared-infra|controlplane|tenant).*'
EOF

echo "✓ Configuration file created: $CONFIG_FILE"
echo ""

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
if [[ -n "$ACCOUNT_ID" ]]; then
    echo "Current AWS Account ID: $ACCOUNT_ID"
    echo "Please verify the account ID in the config file matches: $ACCOUNT_ID"
    echo ""
fi

echo "=============================================="
echo "Next Steps:"
echo "=============================================="
echo ""
echo "1. Review the configuration file:"
echo "   cat $CONFIG_FILE"
echo ""
echo "2. DRY RUN (see what will be deleted):"
echo "   AWS_PROFILE=dev aws-nuke explain-config -c $CONFIG_FILE --with-filtered --with-included"
echo ""
echo "3. If the dry run looks correct, run:"
echo "   AWS_PROFILE=dev aws-nuke run -c $CONFIG_FILE"
echo ""
echo "⚠️  IMPORTANT:"
echo "   - Review the explain output carefully"
echo "   - aws-nuke will ask for confirmation before deleting"
echo "   - Type the account ID to confirm deletion"
echo "   - This is IRREVERSIBLE!"
echo ""
