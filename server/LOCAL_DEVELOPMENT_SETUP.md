# Local Development Setup Guide

This guide explains how to set up and use the local development environment for EdForge microservices.

## Prerequisites

- Docker and Docker Compose
- Node.js >= 16.13
- npm or yarn

## Quick Start

### 1. Start Local DynamoDB

```bash
cd server
docker-compose -f docker-compose.local.yml up -d dynamodb-local
```

This starts DynamoDB Local on port 8000.

### 2. Create Tables

```bash
cd server/application
npm run dynamodb:create-tables
```

This creates all required tables and GSIs in local DynamoDB.

### 3. Set Environment Variables

For local development, set these environment variables:

```bash
export DYNAMODB_ENDPOINT=http://localhost:8000
export AWS_REGION=us-east-1
export TABLE_NAME=school-table-v2-basic
export FINANCE_TABLE_NAME=finance-table-v2-basic
export NODE_ENV=development
```

### 4. Run Tests

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# All tests with coverage
npm run test:coverage
```

## Architecture

### DynamoDB Setup

- **Local DynamoDB**: Runs in Docker container on port 8000
- **Tables**: 
  - `school-table-v2-basic` - Shared table for most services
  - `finance-table-v2-basic` - Separate table for finance service (PCI compliance)
- **GSIs**: All 12 GSIs (GSI1-GSI12) are created automatically

### Service Configuration

All microservices automatically detect local vs AWS environment:
- If `DYNAMODB_ENDPOINT` contains `localhost`, uses local DynamoDB
- Otherwise, uses AWS DynamoDB (production)

### Logging

- **Development**: Human-readable format
- **Production**: Structured JSON (CloudWatch-compatible)
- Includes: timestamp, level, service, context, message, requestId, tenantId, userId

### Exception Handling

All exceptions are caught by `GlobalExceptionFilter` and return consistent error responses:
```json
{
  "statusCode": 400,
  "errorCode": "VALIDATION_ERROR",
  "message": "Invalid input",
  "details": {...},
  "timestamp": "2025-01-21T...",
  "requestId": "..."
}
```

## Available Scripts

- `npm run docker:dynamodb:up` - Start local DynamoDB
- `npm run docker:dynamodb:down` - Stop local DynamoDB
- `npm run dynamodb:create-tables` - Create tables in local DynamoDB
- `npm run test` - Run all tests
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests only
- `npm run test:e2e` - Run E2E tests only
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Generate coverage report

## Testing

### Unit Tests

Unit tests mock DynamoDB and test business logic in isolation.

Example:
```typescript
describe('ClassroomService', () => {
  it('should create classroom', async () => {
    // Mock DynamoDB client
    // Test service logic
  });
});
```

### Integration Tests

Integration tests use real local DynamoDB and test full request/response cycles.

Example:
```typescript
describe('ClassroomController Integration', () => {
  beforeEach(async () => {
    await cleanupTestDatabase();
  });
  
  it('should create classroom via API', async () => {
    // Use real DynamoDB
    // Test full HTTP request/response
  });
});
```

## Troubleshooting

### DynamoDB Not Starting

```bash
# Check if port 8000 is in use
lsof -i :8000

# Restart Docker
docker-compose -f docker-compose.local.yml restart
```

### Tables Not Found

```bash
# Recreate tables
npm run dynamodb:create-tables

# Check table status
aws dynamodb describe-table --table-name school-table-v2-basic --endpoint-url http://localhost:8000
```

### Tests Failing

1. Ensure DynamoDB is running: `docker ps`
2. Ensure tables are created: `npm run dynamodb:create-tables`
3. Check environment variables are set correctly
4. Clear test data: Tables are automatically cleared between tests

## Next Steps

1. Write unit tests for all services
2. Write integration tests for all controllers
3. Write E2E tests for complete workflows
4. Integrate structured logging into all services
5. Replace generic exceptions with custom exception classes

