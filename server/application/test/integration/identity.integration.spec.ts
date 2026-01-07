/**
 * Identity Service Integration Tests
 * 
 * Tests full flows with LocalStack DynamoDB
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { DynamoDBClient, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { testConfig, createLocalDynamoDBClient } from './setup';

// Mock JWT guard for testing
jest.mock('@app/auth/jwt-auth.guard', () => ({
  JwtAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: () => true,
  })),
}));

// Mock tenant credentials decorator
jest.mock('@app/auth/auth.decorator', () => ({
  TenantCredentials: () => () => ({
    userId: 'test-user-123',
    username: 'testuser',
    tenantId: 'test-tenant-123',
    tenantTier: 'BASIC',
    tenantName: 'TestTenant',
    email: 'test@example.com',
    globalRole: 'TenantAdmin',
    userPoolId: 'us-east-1_test',
    appClientId: 'test-client-id',
  }),
}));

describe('Identity Service Integration Tests', () => {
  let app: INestApplication;
  let dynamoDBClient: DynamoDBClient;

  const testTenantId = 'test-tenant-123';
  const testUserId = 'test-user-123';

  beforeAll(async () => {
    dynamoDBClient = createLocalDynamoDBClient();

    // Import the module dynamically to apply mocks
    const { IdentityModule } = await import('../../microservices/identity/src/identity.module');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [IdentityModule],
    })
      .overrideProvider('DYNAMODB_CLIENT')
      .useValue(dynamoDBClient)
      .compile();

    app = moduleFixture.createNestApplication();
    
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();

    // Set environment variables for test
    process.env.TABLE_NAME = testConfig.tableName;
    process.env.AWS_REGION = testConfig.region;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await cleanupTestData();
  });

  async function cleanupTestData(): Promise<void> {
    try {
      await dynamoDBClient.send(new DeleteItemCommand({
        TableName: testConfig.tableName,
        Key: marshall({
          tenantId: testTenantId,
          entityKey: `USER#${testUserId}`,
        }),
      }));
    } catch {
      // Ignore if not exists
    }
  }

  async function seedTestUser(): Promise<void> {
    await dynamoDBClient.send(new PutItemCommand({
      TableName: testConfig.tableName,
      Item: marshall({
        tenantId: testTenantId,
        entityKey: `USER#${testUserId}`,
        entityType: 'USER',
        userId: testUserId,
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        globalRole: 'TenantAdmin',
        status: 'active',
        gsi1pk: 'EMAIL#test@example.com',
        gsi1sk: `TENANT#${testTenantId}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      }),
    }));
  }

  describe('Health Endpoints', () => {
    it('GET /health should return 200', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
    });

    it('GET /auth/health should return 200', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
    });
  });

  describe('User Endpoints', () => {
    describe('GET /users', () => {
      it('should return empty list when no users exist', async () => {
        const response = await request(app.getHttpServer())
          .get('/users')
          .set('Authorization', 'Bearer mock-token')
          .expect(200);

        expect(response.body.items).toBeDefined();
        expect(Array.isArray(response.body.items)).toBe(true);
      });

      it('should return users with pagination', async () => {
        await seedTestUser();

        const response = await request(app.getHttpServer())
          .get('/users?limit=10')
          .set('Authorization', 'Bearer mock-token')
          .expect(200);

        expect(response.body.items).toBeDefined();
        expect(response.body.hasMore).toBeDefined();
      });
    });

    describe('GET /users/me', () => {
      it('should return current user profile', async () => {
        await seedTestUser();

        const response = await request(app.getHttpServer())
          .get('/users/me')
          .set('Authorization', 'Bearer mock-token')
          .expect(200);

        expect(response.body).toBeDefined();
        expect(response.body.email).toBe('test@example.com');
      });
    });

    describe('GET /users/:id', () => {
      it('should return user by ID', async () => {
        await seedTestUser();

        const response = await request(app.getHttpServer())
          .get(`/users/${testUserId}`)
          .set('Authorization', 'Bearer mock-token')
          .expect(200);

        expect(response.body.userId).toBe(testUserId);
        expect(response.body.email).toBe('test@example.com');
      });

      it('should return 404 for non-existent user', async () => {
        await request(app.getHttpServer())
          .get('/users/non-existent-id')
          .set('Authorization', 'Bearer mock-token')
          .expect(404);
      });
    });

    describe('POST /users', () => {
      it('should create a new user', async () => {
        const newUser = {
          email: 'newuser@example.com',
          firstName: 'New',
          lastName: 'User',
          globalRole: 'StandardUser',
        };

        const response = await request(app.getHttpServer())
          .post('/users')
          .set('Authorization', 'Bearer mock-token')
          .send(newUser)
          .expect(201);

        expect(response.body.email).toBe('newuser@example.com');
        expect(response.body.firstName).toBe('New');
      });

      it('should validate required fields', async () => {
        const invalidUser = {
          firstName: 'New',
          // Missing email
        };

        await request(app.getHttpServer())
          .post('/users')
          .set('Authorization', 'Bearer mock-token')
          .send(invalidUser)
          .expect(400);
      });
    });

    describe('PATCH /users/:id', () => {
      it('should update user fields', async () => {
        await seedTestUser();

        const updates = {
          firstName: 'Updated',
          lastName: 'Name',
        };

        const response = await request(app.getHttpServer())
          .patch(`/users/${testUserId}`)
          .set('Authorization', 'Bearer mock-token')
          .send(updates)
          .expect(200);

        expect(response.body.firstName).toBe('Updated');
        expect(response.body.lastName).toBe('Name');
      });
    });

    describe('DELETE /users/:id', () => {
      it('should soft delete user', async () => {
        await seedTestUser();

        await request(app.getHttpServer())
          .delete(`/users/${testUserId}`)
          .set('Authorization', 'Bearer mock-token')
          .expect(204);
      });
    });
  });

  describe('School Endpoints', () => {
    const testSchoolId = 'test-school-123';

    async function seedTestSchool(): Promise<void> {
      await dynamoDBClient.send(new PutItemCommand({
        TableName: testConfig.tableName,
        Item: marshall({
          tenantId: testTenantId,
          entityKey: `SCHOOL#${testSchoolId}`,
          entityType: 'SCHOOL',
          schoolId: testSchoolId,
          schoolCode: 'TST001',
          name: 'Test School',
          shortName: 'TS',
          schoolType: 'elementary',
          status: 'active',
          gsi1pk: 'SCHOOL_CODE#TST001',
          gsi1sk: `TENANT#${testTenantId}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        }),
      }));
    }

    describe('GET /schools', () => {
      it('should return schools list', async () => {
        await seedTestSchool();

        const response = await request(app.getHttpServer())
          .get('/schools')
          .set('Authorization', 'Bearer mock-token')
          .expect(200);

        expect(response.body.items).toBeDefined();
      });
    });

    describe('POST /schools', () => {
      it('should create a new school', async () => {
        const newSchool = {
          schoolCode: 'NEW001',
          name: 'New School',
          shortName: 'NS',
          schoolType: 'high',
          address: {
            street: '123 Main St',
            city: 'Springfield',
            state: 'IL',
            zipCode: '62701',
            country: 'USA',
          },
          contact: {
            phone: '555-1234',
            email: 'school@test.com',
          },
        };

        const response = await request(app.getHttpServer())
          .post('/schools')
          .set('Authorization', 'Bearer mock-token')
          .send(newSchool)
          .expect(201);

        expect(response.body.schoolCode).toBe('NEW001');
      });
    });
  });

  describe('Error Handling', () => {
    it('should return consistent error format', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/non-existent')
        .set('Authorization', 'Bearer mock-token')
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.errorCode).toBeDefined();
      expect(response.body.message).toBeDefined();
      expect(response.body.timestamp).toBeDefined();
    });

    it('should validate request body', async () => {
      const response = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', 'Bearer mock-token')
        .send({ invalid: 'data' })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
    });
  });
});

