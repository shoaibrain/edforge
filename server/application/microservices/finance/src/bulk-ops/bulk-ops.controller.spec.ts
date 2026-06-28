/**
 * BulkOpsController.getJob — Sprint D.3 controller-layer tests.
 *
 * Pins the 404-not-403 contract (CRITICAL — making this 403 would let
 * an operator probe jobIds across schools by observing the response
 * code). Both flavors of denial (missing + cross-school) must come back
 * as NotFoundException with no body distinction.
 *
 * Also pins:
 *   - happy path: TenantAdmin sees any job in the tenant
 *   - happy path: non-admin operator with a role at the job's schoolId
 *   - 404 for missing jobId
 *   - 404 for non-admin operator with NO role at the job's schoolId
 *     (the cross-school case)
 *   - 404 (fail-closed) when identityClient throws on getUserRole
 *
 * Other guards (JwtAuthGuard, route registration) are exercised end-to-end
 * via the NestJS bootstrap path in higher-level integration tests; this
 * spec covers the controller's own dispatch logic.
 */

import { NotFoundException } from '@nestjs/common';
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
    counters: { requested: 100, processed: 30, succeeded: 28, failed: 2, skipped: 0 },
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
    identityClient = { getUserRole: jest.fn() };
    controller = new BulkOpsController(jobsService, identityClient);
  });

  it('returns the job when a TenantAdmin requests any job in the tenant (bypasses school-scope check)', async () => {
    jobsService.get.mockResolvedValue(makeJob());

    const out = await controller.getJob(JOB_ID, makeTenantAdmin(), makeReq());

    expect(out.jobId).toBe(JOB_ID);
    // TenantAdmin bypass: no identity-service round-trip needed.
    expect(identityClient.getUserRole).not.toHaveBeenCalled();
  });

  it('returns the job when a non-admin operator holds a role at the job schoolId', async () => {
    jobsService.get.mockResolvedValue(makeJob());
    identityClient.getUserRole.mockResolvedValue({ role: 'Principal' });

    const out = await controller.getJob(JOB_ID, makeNonAdminOperator(), makeReq());

    expect(out.jobId).toBe(JOB_ID);
    expect(identityClient.getUserRole).toHaveBeenCalledWith(
      OPERATOR,
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

  it('throws NotFoundException (404, NOT 403) when a non-admin operator has no role at the job schoolId — CRITICAL non-enumerability invariant', async () => {
    // Job belongs to OTHER_SCHOOL; operator's role lookup returns null
    // (no membership at that school).
    jobsService.get.mockResolvedValue(makeJob({ schoolId: OTHER_SCHOOL }));
    identityClient.getUserRole.mockResolvedValue(null);

    let thrown: any;
    try {
      await controller.getJob(JOB_ID, makeNonAdminOperator(), makeReq());
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(NotFoundException);
    // Cross-school MUST come back as identical 404 to "missing" — no
    // body distinction. NotFoundException with no message is the
    // contract. If a future PR adds a message string here, the
    // non-enumerability invariant is broken.
    expect(thrown.message).toBe('Not Found');
  });

  it('throws NotFoundException (404, fail-closed) when identityClient.getUserRole throws', async () => {
    jobsService.get.mockResolvedValue(makeJob());
    identityClient.getUserRole.mockRejectedValue(new Error('identity unreachable'));

    await expect(
      controller.getJob(JOB_ID, makeNonAdminOperator(), makeReq()),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns 404 identical for missing job AND cross-school job (response-shape symmetry)', async () => {
    // Missing
    jobsService.get.mockResolvedValueOnce(null);
    let missingErr: any;
    try {
      await controller.getJob('missing', makeTenantAdmin(), makeReq());
    } catch (e) {
      missingErr = e;
    }

    // Cross-school
    jobsService.get.mockResolvedValueOnce(makeJob({ schoolId: OTHER_SCHOOL }));
    identityClient.getUserRole.mockResolvedValueOnce(null);
    let crossSchoolErr: any;
    try {
      await controller.getJob(JOB_ID, makeNonAdminOperator(), makeReq());
    } catch (e) {
      crossSchoolErr = e;
    }

    expect(missingErr).toBeInstanceOf(NotFoundException);
    expect(crossSchoolErr).toBeInstanceOf(NotFoundException);
    expect(missingErr.message).toBe(crossSchoolErr.message);
    expect(missingErr.getStatus()).toBe(crossSchoolErr.getStatus());
  });
});
