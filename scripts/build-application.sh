#!/bin/bash
# build and push application services into ECR



export DOCKER_DEFAULT_PLATFORM=linux/amd64


SERVICE_REPOS=("user" "rproxy" "school" "academic" "enrollment")
# SERVICE_REPOS=("product")  # Legacy - no longer used
# RPROXY_VERSIONS=("v1" "v2")

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

    # Standard build from server/application context
    # This works for services that don't need shared-types (user, rproxy)
    echo "Building $SERVICE_NAME service from server/application context..."
    docker build -t "$SERVICEECR" -f Dockerfile.$SERVICE_NAME .
    
    # Docker Image Tag
    docker tag "$SERVICEECR" "$SERVICEECR:$VERSION"
    # Docker Image Push to ECR
    docker push "$SERVICEECR:$VERSION"

    echo '************************' 
    echo "AWS_REGION:" $REGION
    echo "$SERVICE_NAME SERVICE_ECR_REPO: $SERVICEECR VERSION: $VERSION"

}



# Build shared-types first
echo "Building shared-types package..."
cd ../packages/shared-types
npm install
npm run build
cd ../../scripts

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
  # Services that need shared-types (school, academic) build from monorepo root
  # Services that don't (user, rproxy) build from server/application using deploy_service
  if [ "$SERVICE" == "school" ] || [ "$SERVICE" == "academic" ] || [ "$SERVICE" == "enrollment" ]; then
    SERVICEECR="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/$SERVICE"
    # Save current directory
    CURRENT_DIR=$(pwd)
    # Go to monorepo root (two levels up from server/application)
    cd ../..
    echo "Building $SERVICE service from monorepo root..."
    docker build -t "$SERVICEECR" -f server/application/Dockerfile.$SERVICE .
    docker tag "$SERVICEECR" "$SERVICEECR:$VERSION"
    docker push "$SERVICEECR:$VERSION"
    echo '************************' 
    echo "AWS_REGION:" $REGION
    echo "$SERVICE SERVICE_ECR_REPO: $SERVICEECR VERSION: $VERSION"
    # Return to original directory
    cd "$CURRENT_DIR"
  else
    # user and rproxy use simple deploy_service (builds from server/application)
    deploy_service $SERVICE $VERSION
  fi
done

cd $CWD

# cloud9 SSM plugins to connect to the inside of Container
# sudo dnf install -y https://s3.amazonaws.com/session-manager-downloads/plugin/latest/linux_64bit/session-manager-plugin.rpm