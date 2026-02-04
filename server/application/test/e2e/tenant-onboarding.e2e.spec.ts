/**
 * Tenant Onboarding E2E Tests
 * 
 * Tests the complete tenant onboarding flow:
 * 1. Create tenant
 * 2. Create school under tenant
 * 3. Create admin user
 * 4. Create academic year
 * 5. Verify events are published
 * 
 * Requires: Services running locally
 *   - Identity: http://localhost:3010
 *   - Academics: http://localhost:3011
 */

import * as request from 'supertest';

const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL || 'http://localhost:3010';
const ACADEMICS_URL = process.env.ACADEMICS_SERVICE_URL || 'http://localhost:3011';
const TEST_TENANT_ID = `e2e-tenant-${Date.now()}`;

describe('Tenant Onboarding E2E', () => {
  let schoolId: string;
  let userId: string;
  let academicYearId: string;

  // Common headers for all requests
  const headers = {
    'Content-Type': 'application/json',
    'X-Tenant-Id': TEST_TENANT_ID,
    'X-Correlation-Id': `e2e-${Date.now()}`,
  };

  describe('Step 1: Create Tenant', () => {
    it('should create a new tenant', async () => {
      const response = await request(IDENTITY_URL)
        .post('/tenants')
        .set(headers)
        .send({
          name: 'E2E Test School District',
          tier: 'basic',
          contactEmail: 'admin@e2etest.edu',
          contactName: 'E2E Admin',
          contactPhone: '555-0100',
          address: {
            street: '123 Test Street',
            city: 'Test City',
            state: 'TS',
            zipCode: '12345',
            country: 'USA',
          },
        });

      // Accept both 201 (created) and 409 (already exists) for idempotency
      expect([201, 409]).toContain(response.status);
      
      if (response.status === 201) {
        expect(response.body.tenantId).toBeDefined();
        expect(response.body.status).toBe('provisioning');
      }
    });
  });

  describe('Step 2: Create School', () => {
    it('should create a school under the tenant', async () => {
      const response = await request(IDENTITY_URL)
        .post('/schools')
        .set(headers)
        .send({
          schoolCode: 'E2E001',
          name: 'E2E Elementary School',
          shortName: 'E2ES',
          schoolType: 'elementary',
          gradeRange: {
            start: 'K',
            end: '5',
          },
          phone: '555-0101',
          email: 'school@e2etest.edu',
          address: {
            street: '456 School Ave',
            city: 'Test City',
            state: 'TS',
            zipCode: '12345',
          },
          timezone: 'America/New_York',
        });

      expect(response.status).toBe(201);
      expect(response.body.schoolId).toBeDefined();
      expect(response.body.name).toBe('E2E Elementary School');
      expect(response.body.status).toBe('setup');

      schoolId = response.body.schoolId;
    });

    it('should retrieve the created school', async () => {
      const response = await request(IDENTITY_URL)
        .get(`/schools/${schoolId}`)
        .set(headers);

      expect(response.status).toBe(200);
      expect(response.body.schoolId).toBe(schoolId);
      expect(response.body.name).toBe('E2E Elementary School');
    });
  });

  describe('Step 3: Create Admin User', () => {
    it('should create an admin user', async () => {
      const response = await request(IDENTITY_URL)
        .post('/users')
        .set(headers)
        .send({
          email: 'admin@e2etest.edu',
          firstName: 'E2E',
          lastName: 'Admin',
          globalRole: 'TenantAdmin',
          phone: '555-0102',
        });

      expect(response.status).toBe(201);
      expect(response.body.userId).toBeDefined();
      expect(response.body.email).toBe('admin@e2etest.edu');
      expect(response.body.globalRole).toBe('TenantAdmin');

      userId = response.body.userId;
    });

    it('should retrieve the created user', async () => {
      const response = await request(IDENTITY_URL)
        .get(`/users/${userId}`)
        .set(headers);

      expect(response.status).toBe(200);
      expect(response.body.userId).toBe(userId);
      expect(response.body.firstName).toBe('E2E');
    });
  });

  describe('Step 4: Create Academic Year', () => {
    it('should create an academic year for the school', async () => {
      const response = await request(IDENTITY_URL)
        .post(`/schools/${schoolId}/academic-years`)
        .set(headers)
        .send({
          name: '2024-2025',
          startDate: '2024-08-15',
          endDate: '2025-06-15',
          terms: [
            {
              name: 'Fall Semester',
              termType: 'semester',
              startDate: '2024-08-15',
              endDate: '2024-12-20',
            },
            {
              name: 'Spring Semester',
              termType: 'semester',
              startDate: '2025-01-06',
              endDate: '2025-06-15',
            },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.academicYearId).toBeDefined();
      expect(response.body.name).toBe('2024-2025');
      expect(response.body.terms).toHaveLength(2);

      academicYearId = response.body.academicYearId;
    });

    it('should set the academic year as current', async () => {
      const response = await request(IDENTITY_URL)
        .post(`/schools/${schoolId}/academic-years/${academicYearId}/set-current`)
        .set(headers);

      expect(response.status).toBe(200);
      expect(response.body.isCurrent).toBe(true);
    });
  });

  describe('Step 5: Verify Cross-Service Communication', () => {
    let studentId: string;

    it('should create a student in academics service', async () => {
      const academicsHeaders = {
        ...headers,
        'X-School-Id': schoolId,
      };

      const response = await request(ACADEMICS_URL)
        .post('/academics/students')
        .set(academicsHeaders)
        .send({
          firstName: 'Test',
          lastName: 'Student',
          dateOfBirth: '2015-05-15',
          gender: 'male',
          studentNumber: 'STU001',
          gradeLevel: '3',
        });

      expect(response.status).toBe(201);
      expect(response.body.studentId).toBeDefined();
      studentId = response.body.studentId;
    });

    it('should enroll student in the school', async () => {
      const academicsHeaders = {
        ...headers,
        'X-School-Id': schoolId,
      };

      const response = await request(ACADEMICS_URL)
        .post('/academics/enrollments')
        .set(academicsHeaders)
        .send({
          studentId,
          schoolId,
          academicYearId,
          gradeLevel: '3',
          enrollmentDate: '2024-08-15',
        });

      expect(response.status).toBe(201);
      expect(response.body.enrollmentId).toBeDefined();
      expect(response.body.status).toBe('enrolled');
    });
  });

  describe('Step 6: Health Check Verification', () => {
    it('should verify identity service is healthy', async () => {
      const response = await request(IDENTITY_URL)
        .get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.service).toBe('identity-service');
    });

    it('should verify academics service is healthy', async () => {
      const response = await request(ACADEMICS_URL)
        .get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.service).toBe('academics-service');
    });

    it('should verify identity service readiness', async () => {
      const response = await request(IDENTITY_URL)
        .get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body.ready).toBe(true);
    });

    it('should verify academics service readiness', async () => {
      const response = await request(ACADEMICS_URL)
        .get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body.ready).toBe(true);
    });
  });
});

