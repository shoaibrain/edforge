/**
 * `InvoicesService.generate` — gradeLevel snapshot (Sprint A.1)
 *
 * Pins the snapshot logic landed in Sprint A.1:
 *
 *   1. `dto.gradeLevel` supplied (admin override) → wins; status=resolved
 *   2. `dto.gradeLevel` absent, `studentInfo.gradeLevel='5'` (default
 *      snapshot path) → entity.gradeLevel='5'; status=resolved
 *   3. `dto.gradeLevel` absent AND `studentInfo.gradeLevel=''` → entity
 *      .gradeLevel undefined (sparse on GSI14 — Sprint A.3); status=
 *      unresolved; warning logged
 *
 * The snapshot is written ONCE on `generate()`; it's never updated on
 * student promotion — historical accounting filtering stays stable.
 *
 * Sister spec: `invoices.service.getPdf.spec.ts` covers the PDF path.
 * We're using a monthly fee structure to skip the one-time-fee
 * duplicate-detection scan (frequency!=='one_time' short-circuits the
 * `listForStudents` call at invoices.service.ts:93).
 */

import { Logger } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const STUDENT_ID = 'student-uuid';
const ACCOUNT_ID = 'account-uuid';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

function makeFeeStructure(opts: { gradeLevels?: string[] } = {}) {
  return {
    feeStructureId: 'fs-1',
    name: 'Monthly Tuition',
    amount: 1000,
    quantity: 1,
    feeType: 'tuition',
    frequency: 'monthly', // NOT one_time → skips duplicate-detection scan
    gradeLevels: opts.gradeLevels ?? [], // empty → no per-grade restriction
    taxRate: 0,
    taxType: 'none',
    version: 1,
  };
}

function makeDto(overrides: Partial<{ gradeLevel: string; enrollmentId: string }> = {}) {
  return {
    studentId: STUDENT_ID,
    feeStructureIds: ['fs-1'],
    academicYear: '2025-2026',
    dueDate: '2026-08-15',
    enrollmentId: 'enr-1', // bypass duplicate-detection too (defensive)
    ...overrides,
  } as any;
}

describe('InvoicesService.generate — gradeLevel snapshot (Sprint A.1)', () => {
  let service: InvoicesService;
  let dynamoDBClient: any;
  let identityClient: any;
  let feeStructuresService: any;
  let studentAccountsService: any;
  let sequenceService: any;
  let tenantSettings: any;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockResolvedValue(null),
      putItem: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    identityClient = {
      getStudentInfo: jest.fn(),
      getSchoolName: jest.fn().mockResolvedValue('Test School'),
    };
    feeStructuresService = {
      getByIds: jest.fn().mockResolvedValue([makeFeeStructure()]),
    };
    studentAccountsService = {
      getOrCreate: jest.fn().mockResolvedValue({
        accountId: ACCOUNT_ID,
        studentId: STUDENT_ID,
      }),
    };
    sequenceService = {
      nextInvoiceNumber: jest.fn().mockResolvedValue('INV-2026-0001'),
    };
    tenantSettings = {
      getCurrency: jest.fn().mockResolvedValue('NPR'),
    };

    service = new InvoicesService(
      dynamoDBClient,
      {
        // Fire-and-forget event emitter — tested elsewhere; here we
        // just need it not to throw.
        publishInvoiceGenerated: jest.fn().mockResolvedValue(undefined),
        publishInvoiceIssued: jest.fn().mockResolvedValue(undefined),
      } as any,
      identityClient,
      tenantSettings,
      sequenceService,
      feeStructuresService,
      studentAccountsService,
    
      { optimize: jest.fn(async (u) => u) } as any, // pdfLogoOptimizer (Plan §5d)
    );

    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function lastPutItemEntity(): InvoiceEntity {
    const calls = dynamoDBClient.putItem.mock.calls;
    return calls[calls.length - 1][1] as InvoiceEntity;
  }

  it('dto.gradeLevel supplied → wins; status=resolved (admin override path)', async () => {
    identityClient.getStudentInfo.mockResolvedValue({
      studentId: STUDENT_ID,
      firstName: 'Aakriti',
      lastName: 'Sharma',
      gradeLevel: '4', // student is in Grade 4 currently
    });

    // Admin overrides to charge under Grade 5 (e.g. promotion-mid-month
    // billing reconciliation)
    await service.generate(SCHOOL_ID, makeDto({ gradeLevel: '5' }), ctx);

    const entity = lastPutItemEntity();
    expect(entity.gradeLevel).toBe('5');
    expect(entity.gradeLevelResolutionStatus).toBe('resolved');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('dto.gradeLevel absent, studentInfo.gradeLevel populated → snapshot from student; status=resolved (default path)', async () => {
    identityClient.getStudentInfo.mockResolvedValue({
      studentId: STUDENT_ID,
      firstName: 'Aakriti',
      lastName: 'Sharma',
      gradeLevel: '4',
    });

    await service.generate(SCHOOL_ID, makeDto(), ctx);

    const entity = lastPutItemEntity();
    expect(entity.gradeLevel).toBe('4');
    expect(entity.gradeLevelResolutionStatus).toBe('resolved');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('dto.gradeLevel absent, studentInfo.gradeLevel empty → undefined gradeLevel, status=unresolved, warning logged', async () => {
    identityClient.getStudentInfo.mockResolvedValue({
      studentId: STUDENT_ID,
      firstName: 'Aakriti',
      lastName: 'Sharma',
      gradeLevel: '', // identity client returns empty string when student has no grade
    });

    await service.generate(SCHOOL_ID, makeDto(), ctx);

    const entity = lastPutItemEntity();
    // gradeLevel is undefined (NOT empty string, NOT 'UNKNOWN' sentinel)
    // → sparse on the future GSI14, surfaces in the "Unknown" UI bucket
    expect(entity.gradeLevel).toBeUndefined();
    expect(entity.gradeLevelResolutionStatus).toBe('unresolved');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/gradeLevel unresolved for studentId=.*schoolId=/),
    );
  });

  it('dto.gradeLevel empty string → treated as absent; falls back to studentInfo (admin "I forgot to type a grade" path)', async () => {
    // Defensive: a form that posts `gradeLevel: ''` should be the same
    // as omitting it. The `||` coercion in the snapshot resolution
    // handles this naturally; this test pins the behavior.
    identityClient.getStudentInfo.mockResolvedValue({
      studentId: STUDENT_ID,
      firstName: 'Aakriti',
      lastName: 'Sharma',
      gradeLevel: '7',
    });

    await service.generate(SCHOOL_ID, makeDto({ gradeLevel: '' }), ctx);

    const entity = lastPutItemEntity();
    expect(entity.gradeLevel).toBe('7');
    expect(entity.gradeLevelResolutionStatus).toBe('resolved');
  });

  it('snapshot is sealed on the PutItem — no later update path mutates it (verified by inspecting the only DDB write)', async () => {
    identityClient.getStudentInfo.mockResolvedValue({
      studentId: STUDENT_ID,
      firstName: 'Aakriti',
      lastName: 'Sharma',
      gradeLevel: '4',
    });

    await service.generate(SCHOOL_ID, makeDto(), ctx);

    // Single PutItem of the new invoice; no follow-up UpdateItem on
    // gradeLevel. Subsequent paths (issue, pay, void) MUST NOT touch
    // gradeLevel — snapshot semantics depend on this.
    expect(dynamoDBClient.putItem).toHaveBeenCalledTimes(1);
    const entity = lastPutItemEntity();
    expect(entity.entityType).toBe('INVOICE');
    expect(entity.gradeLevel).toBe('4');
  });
});
