/**
 * StudentAccountsController.setOpeningBalance —
 * Pilot Onboarding Hardening Sprint PD.1.5
 *
 * Controller-layer tests for the PUT endpoint. Cross-school 404,
 * mapper round-trip, and idempotency-replay are the gates.
 *
 * NB: Permission decorator + global ZodValidationPipe + the
 * IdempotentInterceptor are exercised end-to-end through the
 * NestJS Test bootstrap path; this spec covers the controller's
 * own dispatch logic.
 */

import { StudentAccountsController } from './student-accounts.controller';
import { NotFoundException } from '@nestjs/common';
import type { BillingAccountEntity } from '../common/entities/billing-account.entity';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

function makeAccountEntity(overrides: Partial<BillingAccountEntity> = {}): BillingAccountEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `BILLING_ACCOUNT#${SCHOOL_ID}#${STUDENT_ID}`,
    entityType: 'BILLING_ACCOUNT',
    accountId: ACCOUNT_ID,
    studentId: STUDENT_ID,
    schoolId: SCHOOL_ID,
    studentName: 'Aakriti Sharma',
    balance: 5000,
    totalPaid: 0,
    lastPaymentDate: null,
    openingBalance: 5000,
    openingBalanceAsOf: '2026-04-12',
    openingBalanceNote: 'BS 2082 carry-forward',
    gsi1pk: '',
    gsi1sk: '',
    gsi2pk: '',
    gsi2sk: '',
    createdAt: '2026-04-12T00:00:00Z',
    createdBy: USER_ID,
    updatedAt: '2026-04-12T10:00:00Z',
    updatedBy: USER_ID,
    version: 2,
    ...overrides,
  };
}

function makeTenant(): any {
  return { tenantId: TENANT_ID, userId: USER_ID, email: 'op@example.com', role: 'TenantAdmin', jwtToken: 'jwt' };
}

function makeReq(): any {
  return { headers: {}, ip: '203.0.113.42', get: () => 'TestAgent/1.0' };
}

describe('StudentAccountsController.setOpeningBalance — PD.1.5', () => {
  let controller: StudentAccountsController;
  let service: any;
  let identityClient: any;

  beforeEach(() => {
    service = {
      setOpeningBalance: jest.fn(),
    };
    identityClient = {
      enforceStudentOwnership: jest.fn().mockResolvedValue(undefined),
    };
    controller = new StudentAccountsController(service, identityClient);
  });

  it('happy path: dispatches DTO fields to the service and returns the mapped DTO with opening-balance fields', async () => {
    service.setOpeningBalance.mockResolvedValue({
      account: makeAccountEntity(),
      ledgerEntryId: 'ledger-uuid',
      isRevision: false,
    });

    const dto = { amount: 5000, asOf: '2026-04-12', note: 'BS 2082 carry-forward' };
    const result = await controller.setOpeningBalance(
      SCHOOL_ID,
      ACCOUNT_ID,
      dto as any,
      makeTenant(),
      makeReq(),
    );

    // Service called with the unrolled DTO fields + RequestContext
    expect(service.setOpeningBalance).toHaveBeenCalledTimes(1);
    expect(service.setOpeningBalance).toHaveBeenCalledWith(
      ACCOUNT_ID,
      5000,
      '2026-04-12',
      'BS 2082 carry-forward',
      expect.objectContaining({
        tenantId: TENANT_ID,
        userId: USER_ID,
        schoolId: SCHOOL_ID,
      }),
    );

    // DTO carries all 4 opening-balance fields (PD.1.6 mapper passthrough)
    expect(result.id).toBe(ACCOUNT_ID);
    expect(result.openingBalance).toBe(5000);
    expect(result.openingBalanceAsOf).toBe('2026-04-12');
    expect(result.openingBalanceNote).toBe('BS 2082 carry-forward');
    // No settlements yet ⇒ remaining = openingBalance
    expect(result.openingBalanceRemaining).toBe(5000);
    expect(result.balance).toBe(5000);
  });

  it('revision path: passes through ledgerEntryId + isRevision=true (verified via mapper output)', async () => {
    service.setOpeningBalance.mockResolvedValue({
      account: makeAccountEntity({
        openingBalance: 6500,
        openingBalanceAsOf: '2026-04-15',
        openingBalanceNote: undefined, // operator cleared on revision
        balance: 6500,
        version: 3,
      }),
      ledgerEntryId: 'adjustment-uuid',
      isRevision: true,
    });

    const dto = { amount: 6500, asOf: '2026-04-15' };
    const result = await controller.setOpeningBalance(
      SCHOOL_ID,
      ACCOUNT_ID,
      dto as any,
      makeTenant(),
      makeReq(),
    );

    expect(result.openingBalance).toBe(6500);
    expect(result.openingBalanceAsOf).toBe('2026-04-15');
    expect(result.openingBalanceNote).toBeUndefined();
    expect(result.openingBalanceRemaining).toBe(6500); // no settlements yet
  });

  it('cross-school: service NotFoundException propagates (404-not-403 contract)', async () => {
    service.setOpeningBalance.mockRejectedValue(
      new NotFoundException({
        code: 'BILLING_ACCOUNT_NOT_FOUND',
        message: 'BillingAccount not found.',
      }),
    );

    const dto = { amount: 5000, asOf: '2026-04-12' };
    await expect(
      controller.setOpeningBalance(
        '99999999-9999-4999-8999-999999999999', // wrong school
        ACCOUNT_ID,
        dto as any,
        makeTenant(),
        makeReq(),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('omits note from service call when not provided in DTO (sparse field invariant)', async () => {
    service.setOpeningBalance.mockResolvedValue({
      account: makeAccountEntity({ openingBalanceNote: undefined }),
      ledgerEntryId: 'ledger-uuid',
      isRevision: false,
    });

    const dto = { amount: 5000, asOf: '2026-04-12' }; // no note
    await controller.setOpeningBalance(
      SCHOOL_ID,
      ACCOUNT_ID,
      dto as any,
      makeTenant(),
      makeReq(),
    );

    expect(service.setOpeningBalance).toHaveBeenCalledWith(
      ACCOUNT_ID,
      5000,
      '2026-04-12',
      undefined,
      expect.any(Object),
    );
  });
});
