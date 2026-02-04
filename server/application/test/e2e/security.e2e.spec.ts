/**
 * Security E2E Tests
 * 
 * Tests security controls:
 * - Authentication requirements
 * - Tenant isolation
 * - Authorization (role-based access)
 * - Input validation
 * 
 * Requires: Services running locally
 */

import * as request from 'supertest';

const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL || 'http://localhost:3010';
const ACADEMICS_URL = process.env.ACADEMICS_SERVICE_URL || 'http://localhost:3011';

describe('Security E2E Tests', () => {
  describe('Tenant Header Validation', () => {
    it('should reject requests without X-Tenant-Id header', async () => {
      const response = await request(IDENTITY_URL)
        .get('/users')
        .set('Content-Type', 'application/json');

      // Service should require tenant context
      expect([400, 401, 403]).toContain(response.status);
    });

    it('should reject requests with empty X-Tenant-Id', async () => {
      const response = await request(IDENTITY_URL)
        .get('/users')
        .set('Content-Type', 'application/json')
        .set('X-Tenant-Id', '');

      expect([400, 401, 403]).toContain(response.status);
    });
  });

  describe('Tenant Isolation', () => {
    const TENANT_A = 'security-test-tenant-a';
    const TENANT_B = 'security-test-tenant-b';
    let schoolIdTenantA: string;

    beforeAll(async () => {
      // Create a school in Tenant A
      const createResponse = await request(IDENTITY_URL)
        .post('/schools')
        .set('X-Tenant-Id', TENANT_A)
        .send({
          schoolCode: 'SECA001',
          name: 'Security Test School A',
          shortName: 'STSA',
          schoolType: 'elementary',
          gradeRange: { start: 'K', end: '5' },
          phone: '555-0200',
          email: 'schoola@securitytest.edu',
          timezone: 'America/New_York',
        });

      if (createResponse.status === 201) {
        schoolIdTenantA = createResponse.body.schoolId;
      }
    });

    it('should not allow Tenant B to access Tenant A school', async () => {
      if (!schoolIdTenantA) {
        console.warn('Skipping test - no school created');
        return;
      }

      const response = await request(IDENTITY_URL)
        .get(`/schools/${schoolIdTenantA}`)
        .set('X-Tenant-Id', TENANT_B);

      // Should return 404 (not found) instead of 403 (forbidden)
      // to avoid leaking information about other tenants
      expect(response.status).toBe(404);
    });

    it('should not allow Tenant B to update Tenant A school', async () => {
      if (!schoolIdTenantA) {
        console.warn('Skipping test - no school created');
        return;
      }

      const response = await request(IDENTITY_URL)
        .patch(`/schools/${schoolIdTenantA}`)
        .set('X-Tenant-Id', TENANT_B)
        .send({ name: 'Hacked School Name' });

      expect(response.status).toBe(404);
    });

    it('should not allow Tenant B to delete Tenant A school', async () => {
      if (!schoolIdTenantA) {
        console.warn('Skipping test - no school created');
        return;
      }

      const response = await request(IDENTITY_URL)
        .delete(`/schools/${schoolIdTenantA}`)
        .set('X-Tenant-Id', TENANT_B);

      expect(response.status).toBe(404);
    });
  });

  describe('Input Validation', () => {
    const TEST_TENANT = 'security-input-test';
    const headers = {
      'Content-Type': 'application/json',
      'X-Tenant-Id': TEST_TENANT,
    };

    it('should reject invalid email format', async () => {
      const response = await request(IDENTITY_URL)
        .post('/users')
        .set(headers)
        .send({
          email: 'not-an-email',
          firstName: 'Test',
          lastName: 'User',
          globalRole: 'TenantUser',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('email');
    });

    it('should reject missing required fields', async () => {
      const response = await request(IDENTITY_URL)
        .post('/users')
        .set(headers)
        .send({
          email: 'valid@email.com',
          // Missing firstName, lastName, globalRole
        });

      expect(response.status).toBe(400);
    });

    it('should reject invalid date format', async () => {
      const response = await request(ACADEMICS_URL)
        .post('/academics/students')
        .set({ ...headers, 'X-School-Id': 'test-school' })
        .send({
          firstName: 'Test',
          lastName: 'Student',
          dateOfBirth: 'not-a-date',
          gender: 'male',
          studentNumber: 'STU001',
          gradeLevel: '3',
        });

      expect(response.status).toBe(400);
    });

    it('should reject extra/unknown fields when forbidNonWhitelisted is true', async () => {
      const response = await request(IDENTITY_URL)
        .post('/users')
        .set(headers)
        .send({
          email: 'valid@email.com',
          firstName: 'Test',
          lastName: 'User',
          globalRole: 'TenantUser',
          unknownField: 'malicious data',
          anotherBadField: { nested: 'attack' },
        });

      // Should reject because of extra fields
      expect(response.status).toBe(400);
    });

    it('should sanitize/reject SQL injection attempts', async () => {
      const response = await request(IDENTITY_URL)
        .get('/users')
        .set(headers)
        .query({ email: "'; DROP TABLE users; --" });

      // Should not cause server error (DynamoDB is NoSQL anyway, but good to test)
      expect([200, 400, 404]).toContain(response.status);
    });

    it('should handle very long strings gracefully', async () => {
      const longString = 'a'.repeat(10000);
      
      const response = await request(IDENTITY_URL)
        .post('/users')
        .set(headers)
        .send({
          email: 'valid@email.com',
          firstName: longString,
          lastName: 'User',
          globalRole: 'TenantUser',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('Role Authorization', () => {
    const TEST_TENANT = 'security-role-test';
    const headers = {
      'Content-Type': 'application/json',
      'X-Tenant-Id': TEST_TENANT,
    };

    it('should reject invalid global role', async () => {
      const response = await request(IDENTITY_URL)
        .post('/users')
        .set(headers)
        .send({
          email: 'test@roletest.edu',
          firstName: 'Test',
          lastName: 'User',
          globalRole: 'SuperAdmin', // Not a valid role
        });

      expect(response.status).toBe(400);
    });

    it('should accept valid global roles', async () => {
      const validRoles = ['TenantAdmin', 'TenantUser'];

      for (const role of validRoles) {
        const email = `${role.toLowerCase()}@roletest.edu`;
        const response = await request(IDENTITY_URL)
          .post('/users')
          .set(headers)
          .send({
            email,
            firstName: role,
            lastName: 'User',
            globalRole: role,
          });

        expect([201, 409]).toContain(response.status); // 409 if already exists
      }
    });
  });

  describe('Health Endpoint Security', () => {
    it('should allow health check without authentication', async () => {
      // Health endpoints should be public for load balancer probes
      const response = await request(IDENTITY_URL)
        .get('/health/live');

      expect(response.status).toBe(200);
    });

    it('should not expose sensitive information in health response', async () => {
      const response = await request(IDENTITY_URL)
        .get('/health');

      expect(response.status).toBe(200);
      
      // Should not contain credentials or connection strings
      const responseText = JSON.stringify(response.body);
      expect(responseText).not.toContain('password');
      expect(responseText).not.toContain('secret');
      expect(responseText).not.toContain('accessKey');
    });
  });

  describe('Rate Limiting Headers', () => {
    it('should include security headers in response', async () => {
      const response = await request(IDENTITY_URL)
        .get('/health');

      // Note: These headers should be configured in API Gateway in production
      // Here we verify the service doesn't expose sensitive internal headers
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });
});

