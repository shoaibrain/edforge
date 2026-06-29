/**
 * BulkOpsController.getJob — Sprint D.3 controller-layer tests.
 *
 * Pins the 404-not-403 contract (CRITICAL — making this 403 would let
 * an operator probe jobIds across schools by observing the response
 * code). All three flavors of denial (missing, cross-school,
 * billing:view-denied) must come back as NotFoundException with no
 * body distinction.
 *
 * Also pins:
 *   - happy path: TenantAdmin sees any job in the tenant (bypasses
 *     checkPermission entirely, consistent with PermissionGuard's
 *     TenantAdmin bypass).
 *   - happy path: non-admin operator with checkPermission allowed=true
 *     for billing:view at the job's schoolId.
 *   - 404 for missing jobId.
 *   - 404 for non-admin operator with checkPermission allowed=false
 *     — this is the post-#339-review path; it covers Teacher (which
 *     has school-role presence but NOT billing:view in the real RBAC
 *     matrix) attempting to read a finance job at their own school.
 *   - 404 (fail-closed) when identityClient.checkPermission throws
 *     (transport failure).
 *
 * Other guards (JwtAuthGuard, route registration) are exercised end-to-end
 * via the NestJS bootstrap path in higher-level integration tests; this
 * spec covers the controller's own dispatch logic.
 */

import { Logger, NotFoundException } from '@nestjs/common';
import { BulkOpsController } from './bulk-ops.controller';
import type { FinanceJobEntity } from '../common/entities/finance-job.entity';

const TENANT = '11111111-1111-4111-8111-111111111111';
const SCHOOL = '22222222-2222-4222-8222-222222222222';
const OTHER_SCHOOL = '99999999-9999-4999-8999-999999999999';
const OPERATOR = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';

function makeJob(overrides: Partial<FinanceJobEntity> = {}): FinanceJobEntity {
  return {
    tenantId: TENANT,
    entityKey: `FINANCE_JOB#${JOB_ID}`,
    entityType: 'FINANCE_JOB',
    jobId: JOB_ID,
    schoolId: SCHOOL,
    operatorId: OPERATOR,
    jobType: 'bulk_invoice_generate',
    status: 'running',
    counters: { requested: 100, succeeded: 28, failed: 2, skipped: 0 },
    outputFormat: null,
    failedStudentIds: [],
    errors: [],
    createdAt: '2026-06-28T10:00:00.000Z',
    createdBy: OPERATOR,
    updatedAt: '2026-06-28T10:02:00.000Z',
    updatedBy: OPERATOR,
    version: 3,
    ...overrides,
  };
}

function makeTenantAdmin(): any {
  return {
    userId: OPERATOR,
    tenantId: TENANT,
    email: 'admin@example.com',
    globalRole: 'TenantAdmin',
  };
}

function makeNonAdminOperator(): any {
  return {
    userId: OPERATOR,
    tenantId: TENANT,
    email: 'principal@example.com',
    globalRole: 'SchoolAdmin', // any non-TenantAdmin role
  };
}

function makeReq(): any {
  return {
    headers: { authorization: 'Bearer test-jwt-token' },
    ip: '203.0.113.42',
  };
}

describe('BulkOpsController.getJob — Sprint D.3', () => {
  let controller: BulkOpsController;
  let jobsService: any;
  let identityClient: any;

  beforeEach(() => {
    jobsService = { get: jest.fn() };
    identityClient = { checkPermission: jest.fn() };
    controller = new BulkOpsController(jobsService, identityClient);
    // Silence the fail-closed log noise from the transport-failure case.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the job when a TenantAdmin requests any job in the tenant (bypasses checkPermission)', async () => {
    jobsService.get.mockResolvedValue(makeJob());

    const out = await controller.getJob(JOB_ID, makeTenantAdmin(), makeReq());

    expect(out.jobId).toBe(JOB_ID);
    // TenantAdmin bypass: no identity-service round-trip needed.
    expect(identityClient.checkPermission).not.toHaveBeenCalled();
  });

  it('returns the job when checkPermission allows billing:view at the job schoolId', async () => {
    jobsService.get.mockResolvedValue(makeJob());
    identityClient.checkPermission.mockResolvedValue({ allowed: true });

    const out = await controller.getJob(JOB_ID, makeNonAdminOperator(), makeReq());

    expect(out.jobId).toBe(JOB_ID);
    expect(identityClient.checkPermission).toHaveBeenCalledWith(
      OPERATOR,
      'billing',
      'view',
      SCHOOL,
      expect.objectContaining({ tenantId: TENANT, userId: OPERATOR }),
    );
  });

  it('throws NotFoundException (404) for a non-existent jobId', async () => {
    jobsService.get.mockResolvedValue(null);

    await expect(
      controller.getJob('does-not-exist', makeTenantAdmin(), makeReq()),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException (404, NOT 403) when checkPermission denies billing:view — CRITICAL post-#339-review invariant (Teacher with school role but no billing:view)', async () => {
    // Job belongs to OPERATOR's school (SCHOOL) — same-school case so
    // we're isolating the permission-deny branch, NOT the cross-school
    // null-from-service.get branch. The reviewer's case: a Teacher has a
    // role row at SCHOOL (so getUserRole would have returned non-null
    // and the pre-#339 code would have over-granted) but DOES NOT hold
    // billing:view in identity's real RBAC matrix.
    jobsService.get.mockResolvedValue(makeJob());
    identityClient.checkPermission.mockResolvedValue({ allowed: false, reason: 'No billing:view' });

    let thrown: any;
    try {
      await controller.getJob(JOB_ID, makeNonAdminOperator(), makeReq());
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(NotFoundException);
    // Permission-denied MUST come back as identical bare 404 to "missing"
    // — no body distinction. NotFoundException with no message is the
    // contract. If a future PR adds a message string here OR translates
    // to ForbiddenException, the non-enumerability invariant is broken.
    expect(thrown.message).toBe('Not Found');
  });

  it('throws NotFoundException (404, fail-closed) when checkPermission throws — transport failure must NOT leak identity health', async () => {
    jobsService.get.mockResolvedValue(makeJob());
    identityClient.checkPermission.mockRejectedValue(new Error('identity unreachable'));

    let thrown: any;
    try {
      await controller.getJob(JOB_ID, makeNonAdminOperator(), makeReq());
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(NotFoundException);
    expect(thrown.message).toBe('Not Found');
  });

  it('throws NotFoundException for cross-school: service.get returns null (defense-in-depth path)', async () => {
    // When context.schoolId is set and doesn't match, FinanceJobsService.get
    // returns null and the controller short-circuits before checkPermission.
    jobsService.get.mockResolvedValue(null);
    await expect(
      controller.getJob(JOB_ID, makeNonAdminOperator(), makeReq()),
    ).rejects.toThrow(NotFoundException);
    expect(identityClient.checkPermission).not.toHaveBeenCalled();
  });

  it('returns 404 identical across all three denial paths (missing, permission-denied, transport-failed)', async () => {
    // Missing
    jobsService.get.mockResolvedValueOnce(null);
    let missingErr: any;
    try {
      await controller.getJob('missing', makeTenantAdmin(), makeReq());
    } catch (e) {
      missingErr = e;
    }

    // Permission-denied (allowed:false)
    jobsService.get.mockResolvedValueOnce(makeJob());
    identityClient.checkPermission.mockResolvedValueOnce({ allowed: false });
    let denyErr: any;
    try {
      await controller.getJob(JOB_ID, makeNonAdminOperator(), makeReq());
    } catch (e) {
      denyErr = e;
    }

    // Transport-failed (rejected promise)
    jobsService.get.mockResolvedValueOnce(makeJob());
    identityClient.checkPermission.mockRejectedValueOnce(new Error('boom'));
    let transportErr: any;
    try {
      await controller.getJob(JOB_ID, makeNonAdminOperator(), makeReq());
    } catch (e) {
      transportErr = e;
    }

    expect(missingErr).toBeInstanceOf(NotFoundException);
    expect(denyErr).toBeInstanceOf(NotFoundException);
    expect(transportErr).toBeInstanceOf(NotFoundException);
    expect(missingErr.message).toBe(denyErr.message);
    expect(missingErr.message).toBe(transportErr.message);
    expect(missingErr.getStatus()).toBe(denyErr.getStatus());
    expect(missingErr.getStatus()).toBe(transportErr.getStatus());
  });
});
