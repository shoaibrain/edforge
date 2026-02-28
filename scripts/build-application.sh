#!/bin/bash
# Build and push EdForge core application services to ECR
# Services: identity (ECS), academics (ECS), finance (ECS), rproxy (ECS)
# Note: tenant service is Lambda-based and deployed via CDK

export DOCKER_DEFAULT_PLATFORM=linux/amd64

# Core EdForge ECS services only
SERVICE_REPOS=(
  "identity"
  "academics"
  "finance"
  "rproxy"
)

REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin $REGISTRY

deploy_service () {
    local SERVICE_NAME="$1"
    local VERSION="$2"

    if [[ -z "$SERVICE_NAME" ]]; then
      echo "Please provide a SERVICE NAME"
      exit 1
    fi

    local SERVICEECR="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/$SERVICE_NAME"

    echo "Building $SERVICE_NAME service from server/application context..."
    docker build -t "$SERVICEECR" -f Dockerfile.$SERVICE_NAME .
    
    docker tag "$SERVICEECR" "$SERVICEECR:$VERSION"
    docker push "$SERVICEECR:$VERSION"

    echo '************************' 
    echo "AWS_REGION:" $REGION
    echo "$SERVICE_NAME SERVICE_ECR_REPO: $SERVICEECR VERSION: $VERSION"
}

CWD=$(pwd)
cd ../server/application

for SERVICE in "${SERVICE_REPOS[@]}"; do
  echo -e "\033[0;33m==========\033[0;32m Repository [$SERVICE] checking... \033[0;33m==========\033[0m"
  REPO_EXISTS=$(aws ecr describe-repositories --repository-names "$SERVICE" --query 'repositories[0].repositoryUri' --output text)

  if [ "$REPO_EXISTS" == "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/$SERVICE" ]; then
    echo "Repository [$SERVICE] already exists."
  else
    echo "Repository [$SERVICE] does not exist, creating it..."
    aws ecr create-repository --repository-name "$SERVICE" | cat
    echo "Repository [$SERVICE] created."
  fi

  VERSION="latest"

  # identity and academics build from monorepo root (Dockerfiles reference server/application/ paths)
  if [[ "$SERVICE" == "identity" || "$SERVICE" == "academics" || "$SERVICE" == "finance" ]]; then
    SERVICEECR="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/$SERVICE"
    CURRENT_DIR=$(pwd)
    cd ../..
    echo "Building $SERVICE service from monorepo root..."
    docker build -t "$SERVICEECR" -f server/application/Dockerfile.$SERVICE .
    docker tag "$SERVICEECR" "$SERVICEECR:$VERSION"
    docker push "$SERVICEECR:$VERSION"
    echo '************************'
    echo "AWS_REGION:" $REGION
    echo "$SERVICE SERVICE_ECR_REPO: $SERVICEECR VERSION: $VERSION"
    cd "$CURRENT_DIR"
  else
    # rproxy builds from server/application context
    deploy_service $SERVICE $VERSION
  fi
done

cd $CWD

echo ""
echo "=============================================="
echo "EdForge Core Services Build Complete"
echo "=============================================="
echo "Built services: ${SERVICE_REPOS[@]}"
echo ""
echo "Note: Tenant service is Lambda-based and deployed via CDK (cdk deploy)"
echo "=============================================="
