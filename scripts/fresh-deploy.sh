#!/bin/bash

# Clean Fresh Deployment Script for EdForge
# Purpose: Complete redeployment of all services with fresh Docker images and ECS tasks
# without destroying infrastructure (VPC, DynamoDB tables, etc.)

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_PROFILE="${AWS_PROFILE:-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"
CLUSTER_NAME="${CLUSTER_NAME:-prod-basic}"

# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)

echo -e "${GREEN}=== EdForge Clean Fresh Deployment ===${NC}"
echo "Profile: $AWS_PROFILE"
echo "Region: $AWS_REGION"
echo "Cluster: $CLUSTER_NAME"
echo "Account ID: $ACCOUNT_ID"
echo ""

# Step 1: Verify AWS credentials
echo -e "${YELLOW}Step 1: Verifying AWS credentials...${NC}"
if ! aws sts get-caller-identity --profile "$AWS_PROFILE" &>/dev/null; then
    echo -e "${RED}Error: AWS credentials not configured for profile '$AWS_PROFILE'${NC}"
    exit 1
fi
echo -e "${GREEN}✓ AWS credentials verified${NC}"
echo ""

# Step 2: Pre-deployment health check
echo -e "${YELLOW}Step 2: Checking current service status...${NC}"
aws ecs describe-services \
    --profile "$AWS_PROFILE" \
    --cluster "$CLUSTER_NAME" \
    --services identitybasic academicsbasic financebasic rproxybasic \
    --region "$AWS_REGION" \
    --query 'services[*].{name:serviceName,status:status,running:runningCount,desired:desiredCount}' \
    --output table
echo ""

# Step 3: Verify ECR repositories
echo -e "${YELLOW}Step 3: Verifying ECR repositories...${NC}"
for repo in identity academics finance rproxy; do
    if aws ecr describe-repositories \
        --profile "$AWS_PROFILE" \
        --repository-names "$repo" \
        --region "$AWS_REGION" \
        --query 'repositories[0].repositoryName' \
        --output text &>/dev/null; then
        echo -e "${GREEN}✓ Repository '$repo' exists${NC}"
    else
        echo -e "${RED}Error: Repository '$repo' not found${NC}"
        exit 1
    fi
done
echo ""

# Step 4: Build and push Docker images
echo -e "${YELLOW}Step 4: Building and pushing Docker images...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "./build-application.sh" ]; then
    echo -e "${RED}Error: build-application.sh not found in $SCRIPT_DIR${NC}"
    exit 1
fi

AWS_PROFILE="$AWS_PROFILE" ./build-application.sh

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Docker build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Docker images built and pushed${NC}"
echo ""

# Step 5: Verify images were pushed
echo -e "${YELLOW}Step 5: Verifying images in ECR...${NC}"
for repo in identity academics finance rproxy; do
    LATEST_IMAGE=$(aws ecr describe-images \
        --profile "$AWS_PROFILE" \
        --repository-name "$repo" \
        --region "$AWS_REGION" \
        --query 'sort_by(imageDetails,& imagePushedAt)[-1].imagePushedAt' \
        --output text)
    echo -e "${GREEN}✓ $repo: Latest image pushed at $LATEST_IMAGE${NC}"
done
echo ""

# Step 6: Force fresh deployment of all services
echo -e "${YELLOW}Step 6: Deploying services...${NC}"

services=("identitybasic" "academicsbasic" "financebasic" "rproxybasic")

for service in "${services[@]}"; do
    echo -e "  Deploying $service..."
    aws ecs update-service \
        --profile "$AWS_PROFILE" \
        --cluster "$CLUSTER_NAME" \
        --service "$service" \
        --force-new-deployment \
        --region "$AWS_REGION" \
        --output text > /dev/null
    
    if [ $? -eq 0 ]; then
        echo -e "  ${GREEN}✓ $service deployment initiated${NC}"
    else
        echo -e "  ${RED}✗ $service deployment failed${NC}"
        exit 1
    fi
done
echo ""

# Step 7: Monitor deployment progress
echo -e "${YELLOW}Step 7: Monitoring deployment progress...${NC}"
echo "Waiting 30 seconds for deployments to initialize..."
sleep 30

# Check deployment status
for i in {1..12}; do  # Check for up to 2 minutes (12 * 10 seconds)
    echo -e "\n${YELLOW}Deployment status check ($i/12)...${NC}"
    aws ecs describe-services \
        --profile "$AWS_PROFILE" \
        --cluster "$CLUSTER_NAME" \
        --services identitybasic academicsbasic financebasic rproxybasic \
        --region "$AWS_REGION" \
        --query 'services[*].{name:serviceName,running:runningCount,desired:desiredCount,pending:pendingCount,deployments:deployments[*].{status:status,desired:desiredCount,running:runningCount}}' \
        --output table
    
    # Check if all services are stable
    ALL_STABLE=true
    for service in "${services[@]}"; do
        PENDING=$(aws ecs describe-services \
            --profile "$AWS_PROFILE" \
            --cluster "$CLUSTER_NAME" \
            --services "$service" \
            --region "$AWS_REGION" \
            --query 'services[0].pendingCount' \
            --output text)
        
        if [ "$PENDING" != "0" ]; then
            ALL_STABLE=false
            break
        fi
    done
    
    if [ "$ALL_STABLE" = true ]; then
        echo -e "\n${GREEN}✓ All services are stable${NC}"
        break
    fi
    
    if [ $i -lt 12 ]; then
        echo "Waiting 10 seconds before next check..."
        sleep 10
    fi
done
echo ""

# Step 8: Final verification
echo -e "${YELLOW}Step 8: Final verification...${NC}"
aws ecs describe-services \
    --profile "$AWS_PROFILE" \
    --cluster "$CLUSTER_NAME" \
    --services identitybasic academicsbasic financebasic rproxybasic \
    --region "$AWS_REGION" \
    --query 'services[*].{name:serviceName,status:status,running:runningCount,desired:desiredCount,events:events[0].message}' \
    --output table
echo ""

# Step 9: Check recent logs
echo -e "${YELLOW}Step 9: Checking recent logs (last 5 minutes)...${NC}"
for service in "${services[@]}"; do
    echo -e "\n${YELLOW}Recent logs for $service:${NC}"
    aws logs tail "/ecs/$service" \
        --profile "$AWS_PROFILE" \
        --since 5m \
        --region "$AWS_REGION" \
        --format short 2>/dev/null | tail -5 || echo "  No recent logs"
done
echo ""

echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo "Next steps:"
echo "  1. Monitor logs: AWS_PROFILE=$AWS_PROFILE aws logs tail /ecs/{service} --follow --region $AWS_REGION"
echo "  2. Check service health: AWS_PROFILE=$AWS_PROFILE aws ecs describe-services --cluster $CLUSTER_NAME --services identitybasic academicsbasic financebasic rproxybasic --region $AWS_REGION"
echo "  3. Test endpoints: Use your API testing tools or curl commands"
echo ""

