/**
 * `EnrollmentBillingService` × agreement pricing — EPIC-FB FB-3.8
 * (risk R3, the highest-risk integration point).
 *
 * Unlike enrollment-billing.service.spec.ts (which mocks InvoicesService
 * away), this suite wires the REAL InvoicesService into the REAL
 * EnrollmentBillingService so the webhook path provably routes auto-apply
 * fees through the SAME settled-semantics hook:
 *
 *   - billing date = enrollment date (dto.issuedDate)
 *   - covered auto-apply fees suppressed + replaced by agreement lines
 *   - auto-issued invoice carries full provenance
 *   - uncovered students unchanged
 *   - enrollmentId idempotency remains OUTERMOST (short-circuits before
 *     the resolver or the duplicate-billing guard can run)
 */

import { Logger } from '@nestjs/common';
import { EnrollmentBillingService, EnrollmentBillingParams } from './enrollment-billing.service';
import { InvoicesService } from '../invoices/invoices.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const STUDENT_ID = 'student-uuid';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'system-webhook',
  email: 'system@edforge',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

const TUITION_FEE = {
  feeStructureId: 'fs-1',
  name: 'Annual Tuition',
  amount: 10000,
  feeType: 'tuition',
  frequency: 'annual',
  gradeLevels: ['5'],
  taxRate: 0,
  taxType: undefined,
  version: 1,
  proRateOnMidTermEntry: false,
  dueDateRule: undefined,
};
const ACTIVITY_FEE = {
  feeStructureId: 'fs-2',
  name: 'Activity Fee',
  amount: 800,
  feeType: 'miscellaneous',
  frequency: 'annual',
  gradeLevels: ['5'],
  taxRate: 0,
  taxType: undefined,
  version: 1,
  proRateOnMidTermEntry: false,
  dueDateRule: undefined,
};

const AGREEMENT = {
  agreementId: 'agr-1',
  schoolId: SCHOOL_ID,
  title: 'Shrestha Family 2083',
  studentIds: [STUDENT_ID],
  agreementType: 'fixed_total',
  coveredFeeTypes: ['tuition'],
  terms: {
    agreementType: 'fixed_total',
    totalAmount: 7000,
    allocation: [{ studentId: STUDENT_ID, amount: 7000 }],
  },
  status: 'active',
  effectiveFrom: '2026-04-14',
  effectiveTo: '2027-04-13',
  isActive: true,
  version: 1,
};

const baseParams: EnrollmentBillingParams = {
  tenantId: TENANT_ID,
  schoolId: SCHOOL_ID,
  studentId: STUDENT_ID,
  gradeLevel: '5',
  enrollmentDate: '2026-07-10',
  academicYearId: '2082-83',
  studentName: 'Aakriti Sharma',
  enrollmentId: 'enr-1',
  enrollmentType: 'new_admission',
};

describe('EnrollmentBillingService — agreement pricing on the webhook path (FB-3.8)', () => {
  const ORIGINAL_FLAG = process.env.BILLING_AGREEMENTS_ENABLED;
  let service: EnrollmentBillingService;
  let dynamoDBClient: any;
  let agreementResolver: { getActiveAgreementForStudent: jest.Mock };
  let feeStructuresService: any;

  beforeEach(() => {
    delete process.env.BILLING_AGREEMENTS_ENABLED;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockResolvedValue(null),
      putItem: jest.fn().mockResolvedValue(undefined),
      // BH-1.1 — agreement-priced invoices persist via a lock+invoice transact.
      transactWrite: jest.fn().mockResolvedValue(undefined),
      getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
      queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    agreementResolver = {
      getActiveAgreementForStudent: jest.fn().mockResolvedValue(null),
    };
    feeStructuresService = {
      getEnrollmentFees: jest.fn().mockResolvedValue([TUITION_FEE, ACTIVITY_FEE]),
      getByIds: jest.fn(async (_school: string, ids: string[]) =>
        [TUITION_FEE, ACTIVITY_FEE].filter((f) => ids.includes(f.feeStructureId)),
      ),
    };
    const identityClient = {
      getStudentInfo: jest.fn().mockResolvedValue({
        studentId: STUDENT_ID,
        firstName: 'Aakriti',
        lastName: 'Sharma',
        gradeLevel: '5',
      }),
      getSchoolName: jest.fn().mockResolvedValue('Test School'),
    };
    const studentAccountsService = {
      getOrCreate: jest.fn().mockResolvedValue({
        accountId: 'account-uuid',
        studentId: STUDENT_ID,
      }),
      recordLedgerEntry: jest.fn().mockResolvedValue(undefined),
    };

    const invoicesService = new InvoicesService(
      dynamoDBClient,
      { publishInvoiceGenerated: jest.fn().mockResolvedValue(undefined) } as any,
      identityClient as any,
      { getCurrency: jest.fn().mockResolvedValue('NPR') } as any,
      { nextInvoiceNumber: jest.fn().mockResolvedValue('INV-2026-0001') } as any,
      feeStructuresService,
      studentAccountsService as any,
      { optimize: jest.fn(async (u: string) => u) } as any,
      agreementResolver as any,
    );

    service = new EnrollmentBillingService(
      feeStructuresService,
      invoicesService,
      studentAccountsService as any,
      { calculateProRatedAmount: jest.fn() } as any,
      { publishBillingAccountCreated: jest.fn().mockResolvedValue(undefined) } as any,
      identityClient as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (ORIGINAL_FLAG === undefined) delete process.env.BILLING_AGREEMENTS_ENABLED;
    else process.env.BILLING_AGREEMENTS_ENABLED = ORIGINAL_FLAG;
  });

  // BH-1.1 — standard invoices use the bare putItem; agreement-priced ones
  // are the INVOICE Put inside the lock+invoice transactWrite.
  function putEntity(): InvoiceEntity {
    const putCalls = dynamoDBClient.putItem.mock.calls;
    if (putCalls.length > 0) return putCalls[putCalls.length - 1][1] as InvoiceEntity;
    const transactCalls = dynamoDBClient.transactWrite.mock.calls;
    expect(transactCalls.length).toBeGreaterThan(0);
    const items = transactCalls[transactCalls.length - 1][1] as any[];
    return items.find((it) => it.Put?.Item?.entityType === 'INVOICE').Put.Item as InvoiceEntity;
  }

  it('covered student enrolls → auto-ISSUED invoice carries agreement lines + provenance; billing date = enrollment date', async () => {
    agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
      agreement: AGREEMENT,
      allocationForStudent: 7000,
    });

    const result = await service.handleEnrollment(baseParams, ctx);

    // Resolver consulted on the ENROLLMENT date (issuedDate), not "today".
    expect(agreementResolver.getActiveAgreementForStudent).toHaveBeenCalledWith(
      STUDENT_ID,
      SCHOOL_ID,
      '2026-07-10',
      ctx,
      undefined,
    );

    const entity = putEntity();
    expect(entity.status).toBe('issued'); // webhook auto-issues
    expect(entity.issuedDate).toBe('2026-07-10');
    expect(entity.enrollmentId).toBe('enr-1');
    expect(entity.billingPeriod).toBe('Enrollment');

    // Tuition suppressed → activity standard + ONE agreement line.
    expect(entity.lineItems).toHaveLength(2);
    const [activityLine, agreementLine] = entity.lineItems;
    expect(activityLine.feeStructureId).toBe('fs-2');
    expect(agreementLine).toEqual(
      expect.objectContaining({
        description: 'Shrestha Family 2083 (family agreement)',
        amount: 7000,
        total: 7000,
        agreementId: 'agr-1',
        agreementVersion: 1,
        suppressedFeeStructureIds: ['fs-1'],
      }),
    );

    expect(entity.feeOverrideMode).toBe('agreement');
    expect(entity.agreementId).toBe('agr-1');
    expect(entity.agreementVersion).toBe(1);
    expect(entity.grandTotal).toBe(7800); // 800 activity + 7000 agreement

    // gradeLevel snapshot ran identically (hook before the snapshot block).
    expect(entity.gradeLevel).toBe('5');
    expect(result.invoiceId).toBe(entity.invoiceId);
    expect(result.feeCount).toBe(2);
  });

  it('uncovered student (no agreement) → standard auto-invoice, unchanged shape', async () => {
    const result = await service.handleEnrollment(baseParams, ctx);

    const entity = putEntity();
    expect(entity.lineItems.map((li) => li.feeStructureId)).toEqual(['fs-1', 'fs-2']);
    expect(entity.feeOverrideMode).toBeUndefined();
    expect(entity.agreementId).toBeUndefined();
    expect(entity.grandTotal).toBe(10800);
    expect(entity.status).toBe('issued');
    expect(result.feeCount).toBe(2);
  });

  it('enrollmentId idempotency stays OUTERMOST — re-delivered webhook short-circuits before the resolver runs', async () => {
    agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
      agreement: AGREEMENT,
      allocationForStudent: 7000,
    });
    // The student's GSI2 partition already holds the invoice from the
    // first delivery of this enrollment event.
    dynamoDBClient.queryGSI.mockResolvedValue({
      items: [
        {
          invoiceId: 'inv-first',
          invoiceNumber: 'INV-2026-0001',
          enrollmentId: 'enr-1',
          studentId: STUDENT_ID,
          lineItems: [{ feeStructureId: 'fs-2' }],
          status: 'issued',
          dueDate: '2026-08-15',
          issuedDate: '2026-07-10',
          createdAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T00:00:00.000Z',
          subtotal: 800,
          taxTotal: 0,
          discountTotal: 0,
          grandTotal: 800,
          amountPaid: 0,
          amountDue: 800,
          currency: 'NPR',
        },
      ],
      hasMore: false,
    });

    const result = await service.handleEnrollment(baseParams, ctx);

    expect(result.invoiceId).toBe('inv-first');
    expect(agreementResolver.getActiveAgreementForStudent).not.toHaveBeenCalled();
    expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
  });

  it("flag off → webhook path stays standard, resolver never consulted (FB-3.9 on the webhook path)", async () => {
    process.env.BILLING_AGREEMENTS_ENABLED = 'false';
    agreementResolver.getActiveAgreementForStudent.mockResolvedValue({
      agreement: AGREEMENT,
      allocationForStudent: 7000,
    });

    await service.handleEnrollment(baseParams, ctx);

    expect(agreementResolver.getActiveAgreementForStudent).not.toHaveBeenCalled();
    const entity = putEntity();
    expect(entity.feeOverrideMode).toBeUndefined();
    expect(entity.lineItems).toHaveLength(2);
  });
});
