# EdForge Testing Guide

This document describes the testing infrastructure for EdForge EMIS microservices.

## Test Types

### 1. Unit Tests

Unit tests mock external dependencies (AWS SDK clients, databases) and test individual service methods in isolation.

```bash
# Run all unit tests
npm run test

# Run with coverage report
npm run test:coverage

# Watch mode for development
npm run test:watch

# Run tests for specific service
npm run test:identity
npm run test:academics
```

**Location**: `microservices/*/src/**/*.spec.ts`, `libs/**/*.spec.ts`

### 2. Integration Tests

Integration tests run against LocalStack services to verify AWS service interactions (DynamoDB, EventBridge, Cognito).

```bash
# Prerequisites: Start LocalStack
cd server
docker-compose -f docker-compose.local.yml up -d localstack dynamodb-local

# Run setup script
./scripts/local-setup.sh

# Run integration tests
npm run test:integration
```

**Location**: `test/integration/**/*.integration.spec.ts`

### 3. End-to-End (E2E) Tests

E2E tests run against fully running services to test complete user flows.

```bash
# Prerequisites: Start all services
cd server
docker-compose -f docker-compose.local.yml up -d

# Wait for services to be healthy
./scripts/wait-for-services.sh

# Run E2E tests
npm run test:e2e
```

**Location**: `test/e2e/**/*.e2e.spec.ts`

### 4. Run All Tests

```bash
npm run test:all
```

## Local Development Setup

### Quick Start

```bash
# 1. Start infrastructure
cd server
docker-compose -f docker-compose.local.yml up -d

# 2. Wait for services
./scripts/wait-for-services.sh

# 3. Setup tables and test data
./scripts/local-setup.sh

# 4. Verify health
curl http://localhost:3010/health
curl http://localhost:3011/health
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| LocalStack | 4566 | EventBridge, Cognito, STS |
| DynamoDB Local | 8000 | Database |
| Identity Service | 3010 | Auth, Users, Schools, Tenants |
| Academics Service | 3011 | Students, Enrollment, Attendance |

### Environment Variables

The `docker-compose.local.yml` sets these automatically:

```bash
NODE_ENV=development
AWS_REGION=us-east-1
DYNAMODB_ENDPOINT=http://dynamodb-local:8000
EVENTBRIDGE_ENDPOINT=http://localstack:4566
EVENT_BUS_NAME=edforge-local-bus
SKIP_ABAC=true  # Disables Token Vending Machine for local dev
```

## Test Data

The `local-setup.sh` script creates:

- **Test Tenant**: `test-tenant-001` (Test School District)
- **Test School**: `school-001` (Test Elementary School)
- **Test User**: `user-admin-001` (admin@testdistrict.edu)
- **EventBridge Bus**: `edforge-local-bus`

## Health Endpoints

Both services expose Kubernetes-compatible health probes:

```bash
# Comprehensive health (200 = healthy, 503 = unhealthy)
curl http://localhost:3010/health

# Readiness probe (can accept traffic?)
curl http://localhost:3010/health/ready

# Liveness probe (is service running?)
curl http://localhost:3010/health/live
```

Example response:
```json
{
  "status": "healthy",
  "service": "identity-service",
  "version": "0.0.1",
  "timestamp": "2024-12-31T21:00:00.000Z",
  "uptime": 3600,
  "checks": {
    "dynamodb": { "status": "up", "latency": 5 },
    "eventbridge": { "status": "up", "latency": 12 }
  }
}
```

## Test Coverage Targets

| Category | Target |
|----------|--------|
| Branches | 60% |
| Functions | 60% |
| Lines | 60% |
| Statements | 60% |

## Writing Tests

### Unit Test Example

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let mockDynamoDBClient: jest.Mocked<DynamoDBClientService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should return user when found', async () => {
    mockDynamoDBClient.getItem.mockResolvedValue(mockUser);
    const result = await service.getUser('user-123', mockContext);
    expect(result.userId).toBe('user-123');
  });
});
```

### Integration Test Example

```typescript
import { createEventBridgeClient, EVENT_BUS_NAME } from '../setup';

describe('EventBridge Integration', () => {
  it('should publish event', async () => {
    const client = createEventBridgeClient();
    const result = await client.send(new PutEventsCommand({
      Entries: [{
        Source: 'edforge.identity-service',
        DetailType: 'UserCreated',
        Detail: JSON.stringify({ userId: 'test-user' }),
        EventBusName: EVENT_BUS_NAME,
      }],
    }));
    expect(result.FailedEntryCount).toBe(0);
  });
});
```

### E2E Test Example

```typescript
import * as request from 'supertest';

describe('Tenant Onboarding E2E', () => {
  it('should create school', async () => {
    const response = await request('http://localhost:3010')
      .post('/schools')
      .set('X-Tenant-Id', 'test-tenant')
      .send({ name: 'Test School', ... });
    
    expect(response.status).toBe(201);
  });
});
```

## Troubleshooting

### LocalStack not responding

```bash
# Check container status
docker-compose -f docker-compose.local.yml ps

# View logs
docker-compose -f docker-compose.local.yml logs localstack

# Restart
docker-compose -f docker-compose.local.yml restart localstack
```

### DynamoDB tables not found

```bash
# Re-run setup script
./scripts/local-setup.sh

# List tables
aws dynamodb list-tables --endpoint-url http://localhost:8000
```

### Services not starting

```bash
# Check health endpoint
curl http://localhost:3010/health

# View service logs
docker-compose -f docker-compose.local.yml logs identity-service
```

## CI/CD Integration

For CI/CD pipelines, use the same commands:

```yaml
# GitHub Actions example
- name: Start LocalStack
  run: docker-compose -f server/docker-compose.local.yml up -d localstack dynamodb-local

- name: Run Setup
  run: ./scripts/local-setup.sh

- name: Run Tests
  run: |
    cd server/application
    npm run test:coverage
    npm run test:integration
```

