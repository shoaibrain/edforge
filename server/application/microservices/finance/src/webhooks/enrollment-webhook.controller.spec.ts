/**
 * Enrollment Webhook Controller Integration Tests
 *
 * Tests the HTTP endpoint layer: Zod validation, API key guard,
 * JWT extraction, enrollmentType normalization, and grade normalization.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { EnrollmentWebhookController } from './enrollment-webhook.controller';
import { EnrollmentBillingService } from './enrollment-billing.service';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';

// ============================================================================
// Mocks
// ============================================================================

const mockBillingService = {
  handleEnrollment: jest.fn().mockResolvedValue({
    accountId: 'account-001',
    invoiceId: 'invoice-001',
    feeCount: 1,
  }),
  handleWithdrawal: jest.fn().mockResolvedValue({
    cancelledCount: 1,
    skippedCount: 0,
  }),
};

const VALID_API_KEY = 'test-internal-api-key';

const validPayload = {
  tenantId: 'tenant-001',
  studentId: 'student-001',
  schoolId: 'school-001',
  academicYearId: 'year-001',
  gradeLevel: '5',
  enrollmentId: 'enrollment-001',
  enrollmentType: 'new',
  enrollmentDate: '2026-04-01',
  studentName: 'Test Student',
};

describe('EnrollmentWebhookController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Set the API key env var before module init
    process.env.INTERNAL_API_KEY = VALID_API_KEY;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EnrollmentWebhookController],
      providers: [
        { provide: EnrollmentBillingService, useValue: mockBillingService },
        InternalApiKeyGuard,
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.INTERNAL_API_KEY;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockBillingService.handleEnrollment.mockResolvedValue({
      accountId: 'account-001',
      invoiceId: 'invoice-001',
      feeCount: 1,
    });
  });

  // --------------------------------------------------------------------------
  // Valid payload
  // --------------------------------------------------------------------------

  it('should return 200 with valid payload and API key', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/webhooks/enrollment-completed')
      .set('x-internal-api-key', VALID_API_KEY)
      .set('Authorization', 'Bearer test-jwt-token')
      .send(validPayload)
      .expect(HttpStatus.CREATED);

    expect(response.body).toEqual({
      accountId: 'account-001',
      invoiceId: 'invoice-001',
      feeCount: 1,
    });
  });

  // --------------------------------------------------------------------------
  // API key validation
  // --------------------------------------------------------------------------

  it('should return 401 when API key is missing', async () => {
    await request(app.getHttpServer())
      .post('/internal/webhooks/enrollment-completed')
      .send(validPayload)
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('should return 401 when API key is wrong', async () => {
    await request(app.getHttpServer())
      .post('/internal/webhooks/enrollment-completed')
      .set('x-internal-api-key', 'wrong-key')
      .send(validPayload)
      .expect(HttpStatus.UNAUTHORIZED);
  });

  // --------------------------------------------------------------------------
  // Zod validation — missing required fields
  // --------------------------------------------------------------------------

  it('should return 400 when tenantId is missing', async () => {
    const { tenantId, ...noTenant } = validPayload;
    await request(app.getHttpServer())
      .post('/internal/webhooks/enrollment-completed')
      .set('x-internal-api-key', VALID_API_KEY)
      .send(noTenant)
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('should return 400 when studentId is missing', async () => {
    const { studentId, ...noStudent } = validPayload;
    await request(app.getHttpServer())
      .post('/internal/webhooks/enrollment-completed')
      .set('x-internal-api-key', VALID_API_KEY)
      .send(noStudent)
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('should return 400 when gradeLevel is missing', async () => {
    const { gradeLevel, ...noGrade } = validPayload;
    await request(app.getHttpServer())
      .post('/internal/webhooks/enrollment-completed')
      .set('x-internal-api-key', VALID_API_KEY)
      .send(noGrade)
      .expect(HttpStatus.BAD_REQUEST);
  });

  // --------------------------------------------------------------------------
  // enrollmentType normalization: 'new' → 'new_admission'
  // --------------------------------------------------------------------------

  it('should normalize enrollmentType "new" to "new_admission"', async () => {
    await request(app.getHttpServer())
      .post('/internal/webhooks/enrollment-completed')
      .set('x-internal-api-key', VALID_API_KEY)
      .set('Authorization', 'Bearer test-jwt')
      .send({ ...validPayload, enrollmentType: 'new' })
      .expect(HttpStatus.CREATED);

    expect(mockBillingService.handleEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentType: 'new_admission' }),
      expect.any(Object),
    );
  });

  it('should pass "transfer" enrollmentType unchanged', async () => {
    await request(app.getHttpServer())
      .post('/internal/webhooks/enrollment-completed')
      .set('x-internal-api-key', VALID_API_KEY)
      .set('Authorization', 'Bearer test-jwt')
      .send({ ...validPayload, enrollmentType: 'transfer' })
      .expect(HttpStatus.CREATED);

    expect(mockBillingService.handleEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentType: 'transfer' }),
      expect.any(Object),
    );
  });

  // --------------------------------------------------------------------------
  // Grade level normalization: lowercase → uppercase
  // --------------------------------------------------------------------------

  it('should normalize gradeLevel to uppercase', async () => {
    await request(app.getHttpServer())
      .post('/internal/webhooks/enrollment-completed')
      .set('x-internal-api-key', VALID_API_KEY)
      .set('Authorization', 'Bearer test-jwt')
      .send({ ...validPayload, gradeLevel: 'pk' })
      .expect(HttpStatus.CREATED);

    expect(mockBillingService.handleEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ gradeLevel: 'PK' }),
      expect.any(Object),
    );
  });

  // --------------------------------------------------------------------------
  // JWT extraction from Authorization header
  // --------------------------------------------------------------------------

  it('should extract JWT from Authorization header', async () => {
    await request(app.getHttpServer())
      .post('/internal/webhooks/enrollment-completed')
      .set('x-internal-api-key', VALID_API_KEY)
      .set('Authorization', 'Bearer my-jwt-token')
      .send(validPayload)
      .expect(HttpStatus.CREATED);

    expect(mockBillingService.handleEnrollment).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ jwtToken: 'my-jwt-token' }),
    );
  });

  it('should fall back to body jwtToken when no Authorization header', async () => {
    await request(app.getHttpServer())
      .post('/internal/webhooks/enrollment-completed')
      .set('x-internal-api-key', VALID_API_KEY)
      .send({ ...validPayload, jwtToken: 'body-jwt-token' })
      .expect(HttpStatus.CREATED);

    expect(mockBillingService.handleEnrollment).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ jwtToken: 'body-jwt-token' }),
    );
  });

  // --------------------------------------------------------------------------
  // Idempotency: same enrollmentId returns same invoice
  // --------------------------------------------------------------------------

  it('should return same result when called twice with same enrollmentId', async () => {
    const idempotentResult = { accountId: 'account-001', invoiceId: 'invoice-001', feeCount: 1 };
    mockBillingService.handleEnrollment.mockResolvedValue(idempotentResult);

    const first = await request(app.getHttpServer())
      .post('/internal/webhooks/enrollment-completed')
      .set('x-internal-api-key', VALID_API_KEY)
      .set('Authorization', 'Bearer jwt')
      .send(validPayload)
      .expect(HttpStatus.CREATED);

    const second = await request(app.getHttpServer())
      .post('/internal/webhooks/enrollment-completed')
      .set('x-internal-api-key', VALID_API_KEY)
      .set('Authorization', 'Bearer jwt')
      .send(validPayload)
      .expect(HttpStatus.CREATED);

    expect(first.body).toEqual(second.body);
  });

  // --------------------------------------------------------------------------
  // Student withdrawn endpoint
  // --------------------------------------------------------------------------

  it('should handle student withdrawal', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/webhooks/student-withdrawn')
      .set('x-internal-api-key', VALID_API_KEY)
      .set('Authorization', 'Bearer jwt')
      .send({ tenantId: 'tenant-001', studentId: 'student-001', schoolId: 'school-001' })
      .expect(HttpStatus.CREATED);

    expect(response.body).toEqual({ cancelledCount: 1, skippedCount: 0 });
  });

  it('should return 400 for withdrawal with missing schoolId', async () => {
    await request(app.getHttpServer())
      .post('/internal/webhooks/student-withdrawn')
      .set('x-internal-api-key', VALID_API_KEY)
      .send({ tenantId: 'tenant-001', studentId: 'student-001' })
      .expect(HttpStatus.BAD_REQUEST);
  });
});
