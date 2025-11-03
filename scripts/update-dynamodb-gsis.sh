#!/bin/bash

# 🔧 Update DynamoDB Table with Missing GSIs
# This script adds GSI3-GSI6 to the existing school-table-v2-basic table

set -e

echo "🚀 Starting DynamoDB GSI Update Process..."

# Check if AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "❌ AWS CLI not configured. Please run 'aws configure' first."
    exit 1
fi

# Set variables
TABLE_NAME="school-table-v2-basic"
REGION="us-east-1"
PROFILE="dev"

echo "📋 Table: $TABLE_NAME"
echo "🌍 Region: $REGION"
echo "👤 Profile: $PROFILE"

# Check if table exists
echo "🔍 Checking if table exists..."
if ! aws dynamodb describe-table --table-name $TABLE_NAME --region $REGION --profile $PROFILE > /dev/null 2>&1; then
    echo "❌ Table $TABLE_NAME not found!"
    exit 1
fi

echo "✅ Table found. Current GSIs:"
aws dynamodb describe-table --table-name $TABLE_NAME --region $REGION --profile $PROFILE \
  --query 'Table.GlobalSecondaryIndexes[*].{IndexName:IndexName,IndexStatus:IndexStatus}' \
  --output table

# Add GSI3: Assignment Index
echo "🔧 Adding GSI3: Assignment Index..."
aws dynamodb update-table \
  --table-name $TABLE_NAME \
  --region $REGION \
  --profile $PROFILE \
  --attribute-definitions AttributeName=gsi3pk,AttributeType=S AttributeName=gsi3sk,AttributeType=S \
  --global-secondary-index-updates '[{
    "Create": {
      "IndexName": "GSI3",
      "KeySchema": [
        {"AttributeName": "gsi3pk", "KeyType": "HASH"},
        {"AttributeName": "gsi3sk", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"},
      "ProvisionedThroughput": {"ReadCapacityUnits": 5, "WriteCapacityUnits": 5}
    }
  }]' \
  --query 'TableDescription.GlobalSecondaryIndexes[?IndexName==`GSI3`].{IndexName:IndexName,IndexStatus:IndexStatus}' \
  --output table

echo "⏳ Waiting for GSI3 to be created..."
aws dynamodb wait table-not-exists --table-name $TABLE_NAME --region $REGION --profile $PROFILE || true
aws dynamodb wait table-exists --table-name $TABLE_NAME --region $REGION --profile $PROFILE

# Add GSI4: Category Index
echo "🔧 Adding GSI4: Category Index..."
aws dynamodb update-table \
  --table-name $TABLE_NAME \
  --region $REGION \
  --profile $PROFILE \
  --attribute-definitions AttributeName=gsi4pk,AttributeType=S AttributeName=gsi4sk,AttributeType=S \
  --global-secondary-index-updates '[{
    "Create": {
      "IndexName": "GSI4",
      "KeySchema": [
        {"AttributeName": "gsi4pk", "KeyType": "HASH"},
        {"AttributeName": "gsi4sk", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"},
      "ProvisionedThroughput": {"ReadCapacityUnits": 5, "WriteCapacityUnits": 5}
    }
  }]' \
  --query 'TableDescription.GlobalSecondaryIndexes[?IndexName==`GSI4`].{IndexName:IndexName,IndexStatus:IndexStatus}' \
  --output table

echo "⏳ Waiting for GSI4 to be created..."
aws dynamodb wait table-not-exists --table-name $TABLE_NAME --region $REGION --profile $PROFILE || true
aws dynamodb wait table-exists --table-name $TABLE_NAME --region $REGION --profile $PROFILE

# Add GSI5: Term Index
echo "🔧 Adding GSI5: Term Index..."
aws dynamodb update-table \
  --table-name $TABLE_NAME \
  --region $REGION \
  --profile $PROFILE \
  --attribute-definitions AttributeName=gsi5pk,AttributeType=S AttributeName=gsi5sk,AttributeType=S \
  --global-secondary-index-updates '[{
    "Create": {
      "IndexName": "GSI5",
      "KeySchema": [
        {"AttributeName": "gsi5pk", "KeyType": "HASH"},
        {"AttributeName": "gsi5sk", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"},
      "ProvisionedThroughput": {"ReadCapacityUnits": 5, "WriteCapacityUnits": 5}
    }
  }]' \
  --query 'TableDescription.GlobalSecondaryIndexes[?IndexName==`GSI5`].{IndexName:IndexName,IndexStatus:IndexStatus}' \
  --output table

echo "⏳ Waiting for GSI5 to be created..."
aws dynamodb wait table-not-exists --table-name $TABLE_NAME --region $REGION --profile $PROFILE || true
aws dynamodb wait table-exists --table-name $TABLE_NAME --region $REGION --profile $PROFILE

# Add GSI6: School Index
echo "🔧 Adding GSI6: School Index..."
aws dynamodb update-table \
  --table-name $TABLE_NAME \
  --region $REGION \
  --profile $PROFILE \
  --attribute-definitions AttributeName=gsi6pk,AttributeType=S AttributeName=gsi6sk,AttributeType=S \
  --global-secondary-index-updates '[{
    "Create": {
      "IndexName": "GSI6",
      "KeySchema": [
        {"AttributeName": "gsi6pk", "KeyType": "HASH"},
        {"AttributeName": "gsi6sk", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"},
      "ProvisionedThroughput": {"ReadCapacityUnits": 5, "WriteCapacityUnits": 5}
    }
  }]' \
  --query 'TableDescription.GlobalSecondaryIndexes[?IndexName==`GSI6`].{IndexName:IndexName,IndexStatus:IndexStatus}' \
  --output table

echo "⏳ Waiting for GSI6 to be created..."
aws dynamodb wait table-not-exists --table-name $TABLE_NAME --region $REGION --profile $PROFILE || true
aws dynamodb wait table-exists --table-name $TABLE_NAME --region $REGION --profile $PROFILE

# Final verification
echo "✅ Final verification - All GSIs:"
aws dynamodb describe-table --table-name $TABLE_NAME --region $REGION --profile $PROFILE \
  --query 'Table.GlobalSecondaryIndexes[*].{IndexName:IndexName,IndexStatus:IndexStatus,KeySchema:KeySchema}' \
  --output table

echo "🎉 DynamoDB GSI update completed successfully!"
echo "📊 Table now has 6 GSIs (GSI1-GSI6) for optimal academic service performance"
echo "🚀 You can now deploy the updated CDK stack or test the academic service APIs"
