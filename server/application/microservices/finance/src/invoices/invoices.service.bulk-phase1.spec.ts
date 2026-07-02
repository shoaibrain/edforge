/**
 * `InvoicesService` — Sprint C Phase 1 (wizard rewrite import) backend deltas
 *
 * Pins three behaviors landed for Phase 1:
 *
 *   1. `generate()` honors `dto.customLineItems` — synthetic line items
 *      appended after fee-structure lines; `isCustom:true`; no tax/discount;
 *      total = amount; subtotal + grandTotal include them.
 *
 *   2. `generateBulk()` honors `dto.skipZeroTotal` — when the projected
 *      gross is 0 (customSum + sum(feeStructure.amount) === 0), the worker
 *      short-circuits: NO `generate()` calls, all studentIds counted as
 *      skipped, response shows skipped=N + generated=0.
 *
 *   3. `bulkPreview()` returns the 3 derivable-segment counters
 *      (studentsWithBalance / studentsNotBilledThisPeriod /
 *      studentsNewAdmission) and degrades gracefully (counter undefined,
 *      preview NOT 500) when an underlying query fails.
 *
 * Mocks mirror the gradeLevel spec's shape — minimal harness, real service
 * methods. No DI container; the service is constructed directly with
 * jest.fn() collaborators.
 */

import { Logger } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID_2 = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID_3 = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = 'account-uuid';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

function makeFeeStructure(opts: { amount?: number; feeStructureId?: string } = {}) {
  return {
    feeStructureId: opts.feeStructureId ?? 'fs-1',
    name: 'Monthly Tuition',
    amount: opts.amount ?? 1000,
    quantity: 1,
    feeType: 'tuition',
    // monthly skips the one-time-fee duplicate-detection scan
    frequency: 'monthly',
    gradeLevels: [],
    taxRate: 0,
    taxType: 'none',
    version: 1,
  };
}

function buildService(overrides: Record<string, any> = {}) {
  const dynamoDBClient = {
    getClient: jest.fn().mockResolvedValue({}),
    getItem: jest.fn().mockResolvedValue(null),
    putItem: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    transactWrite: jest.fn().mockResolvedValue(undefined),
    getTableName: jest.fn().mockReturnValue('edforge-finance-basic'),
  };
  const identityClient = {
    getStudentInfo: jest.fn().mockResolvedValue({
      studentId: STUDENT_ID,
      firstName: 'Aakriti',
      lastName: 'Sharma',
      gradeLevel: '4',
    }),
    getSchoolName: jest.fn().mockResolvedValue('Test School'),
    getStudentIdsByGrade: jest.fn().mockResolvedValue([STUDENT_ID, STUDENT_ID_2, STUDENT_ID_3]),
  };
  const feeStructuresService = {
    getByIds: jest.fn().mockResolvedValue([makeFeeStructure()]),
  };
  const studentAccountsService = {
    getOrCreate: jest.fn().mockResolvedValue({
      accountId: ACCOUNT_ID,
      studentId: STUDENT_ID,
    }),
    list: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
  };
  const sequenceService = {
    nextInvoiceNumber: jest.fn().mockResolvedValue('INV-2026-0001'),
  };
  const tenantSettings = {
    getCurrency: jest.fn().mockResolvedValue('NPR'),
  };
  const eventsService = {
    publishInvoiceGenerated: jest.fn().mockResolvedValue(undefined),
    publishInvoiceIssued: jest.fn().mockResolvedValue(undefined),
  };

  const collaborators = {
    dynamoDBClient,
    identityClient,
    feeStructuresService,
    studentAccountsService,
    sequenceService,
    tenantSettings,
    eventsService,
    ...overrides,
  };

  const service = new InvoicesService(
    collaborators.dynamoDBClient as any,
    collaborators.eventsService as any,
    collaborators.identityClient as any,
    collaborators.tenantSettings as any,
    collaborators.sequenceService as any,
    collaborators.feeStructuresService as any,
    collaborators.studentAccountsService as any,

    { optimize: jest.fn(async (u) => u) } as any, // pdfLogoOptimizer (Plan §5d)
  );

  return { service, ...collaborators };
}

describe('InvoicesService.generate — Sprint C Phase 1 customLineItems', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  function lastPutEntity(dynamoDBClient: any): InvoiceEntity {
    const putCalls = dynamoDBClient.putItem.mock.calls;
    return putCalls[putCalls.length - 1][1] as InvoiceEntity;
  }

  it('appends customLineItems with isCustom:true; totals include them', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.generate(
      SCHOOL_ID,
      {
        studentId: STUDENT_ID,
        feeStructureIds: ['fs-1'],
        academicYear: '2025-2026',
        dueDate: '2026-08-15',
        enrollmentId: 'enr-1',
        customLineItems: [
          { name: 'Annual picnic — voluntary', amount: 500 },
          { name: 'Stationery kit', amount: 250 },
        ],
      } as any,
      ctx,
    );

    const entity = lastPutEntity(dynamoDBClient);
    // 1 fee-structure line (Monthly Tuition NPR 1000) + 2 custom lines
    expect(entity.lineItems).toHaveLength(3);

    const customs = entity.lineItems.filter(li => li.isCustom === true);
    expect(customs).toHaveLength(2);
    expect(customs[0]).toMatchObject({
      description: 'Annual picnic — voluntary',
      amount: 500,
      total: 500,
      isCustom: true,
      taxAmount: 0,
      discount: 0,
    });
    expect(customs[1]).toMatchObject({
      description: 'Stationery kit',
      amount: 250,
      total: 250,
    });

    // Totals: fee=1000 + customs (500+250) = 1750
    expect(entity.subtotal).toBe(1750);
    expect(entity.grandTotal).toBe(1750);
  });

  it('no customLineItems supplied → only fee-structure lines persist', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.generate(
      SCHOOL_ID,
      {
        studentId: STUDENT_ID,
        feeStructureIds: ['fs-1'],
        academicYear: '2025-2026',
        dueDate: '2026-08-15',
        enrollmentId: 'enr-1',
      } as any,
      ctx,
    );

    const entity = lastPutEntity(dynamoDBClient);
    expect(entity.lineItems).toHaveLength(1);
    expect(entity.lineItems[0].isCustom).toBeUndefined();
    expect(entity.subtotal).toBe(1000);
  });
});

describe('InvoicesService.generateBulk — Sprint C Phase 1 skipZeroTotal', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it('projected gross = 0 + skipZeroTotal:true → skipped=N, generated=0, NO generate() calls', async () => {
    const { service, feeStructuresService, dynamoDBClient } = buildService({
      feeStructuresService: {
        // amount 0 fee structure → projected sum = 0 with no custom lines
        getByIds: jest.fn().mockResolvedValue([makeFeeStructure({ amount: 0 })]),
      },
    });
    const generateSpy = jest.spyOn(service, 'generate');

    const result = await service.generateBulk(
      SCHOOL_ID,
      {
        selectionMode: 'students',
        studentIds: [STUDENT_ID, STUDENT_ID_2, STUDENT_ID_3],
        feeStructureIds: ['fs-1'],
        academicYear: '2025-2026',
        dueDate: '2026-08-15',
        skipZeroTotal: true,
      },
      ctx,
    );

    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.resolvedStudentCount).toBe(3);
    expect(generateSpy).not.toHaveBeenCalled();
    expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
  });

  it('projected gross > 0 (custom lines push it positive) → normal flow proceeds', async () => {
    const { service, feeStructuresService } = buildService({
      feeStructuresService: {
        getByIds: jest.fn().mockResolvedValue([makeFeeStructure({ amount: 0 })]),
      },
    });
    const generateSpy = jest
      .spyOn(service, 'generate')
      // mock generate to avoid the deep dependency chain in this test
      .mockResolvedValue({} as any);

    const result = await service.generateBulk(
      SCHOOL_ID,
      {
        selectionMode: 'students',
        studentIds: [STUDENT_ID],
        feeStructureIds: ['fs-1'],
        academicYear: '2025-2026',
        dueDate: '2026-08-15',
        customLineItems: [{ name: 'Annual picnic', amount: 500 }],
        skipZeroTotal: true,
      },
      ctx,
    );

    // generate WAS called (customLines push the projection > 0)
    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(generateSpy.mock.calls[0][1]).toMatchObject({
      customLineItems: [{ name: 'Annual picnic', amount: 500 }],
    });
    expect(result.generated).toBe(1);
  });

  it('skipZeroTotal:false (default) → no pre-filter; generate() always invoked', async () => {
    const { service } = buildService({
      feeStructuresService: {
        getByIds: jest.fn().mockResolvedValue([makeFeeStructure({ amount: 0 })]),
      },
    });
    const generateSpy = jest.spyOn(service, 'generate').mockResolvedValue({} as any);

    const result = await service.generateBulk(
      SCHOOL_ID,
      {
        selectionMode: 'students',
        studentIds: [STUDENT_ID, STUDENT_ID_2],
        feeStructureIds: ['fs-1'],
        academicYear: '2025-2026',
        dueDate: '2026-08-15',
        // skipZeroTotal omitted → defaults to false-y
      },
      ctx,
    );

    expect(generateSpy).toHaveBeenCalledTimes(2);
    expect(result.generated).toBe(2);
  });
});

describe('InvoicesService.bulkPreview — Sprint C Phase 1 segment counters', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it('all 3 counters populated when underlying queries succeed', async () => {
    const { service, studentAccountsService } = buildService({
      identityClient: {
        getStudentInfo: jest.fn(),
        getSchoolName: jest.fn().mockResolvedValue('Test'),
        getStudentIdsByGrade: jest.fn(),
      },
      studentAccountsService: {
        getOrCreate: jest.fn(),
        // STUDENT_ID + STUDENT_ID_2 have outstanding balance; STUDENT_ID_3 doesn't
        list: jest.fn().mockResolvedValue({
          items: [
            { studentId: STUDENT_ID, balance: 1500 },
            { studentId: STUDENT_ID_2, balance: 300 },
          ],
          hasMore: false,
        }),
      },
    });

    // Mock listForStudents on the service itself: STUDENT_ID has 1 prior invoice
    // (billingPeriod '2026-04'); STUDENT_ID_2 has 1 invoice in '2026-03' (NOT
    // this period); STUDENT_ID_3 has NO invoices (new admission).
    jest.spyOn(service, 'listForStudents').mockResolvedValue({
      items: [
        { studentId: STUDENT_ID, billingPeriod: '2026-04' } as any,
        { studentId: STUDENT_ID_2, billingPeriod: '2026-03' } as any,
      ],
      hasMore: false,
    });

    const result = await service.bulkPreview(
      SCHOOL_ID,
      {
        selectionMode: 'students',
        studentIds: [STUDENT_ID, STUDENT_ID_2, STUDENT_ID_3],
        feeStructureIds: [],
        billingPeriod: '2026-04',
      },
      ctx,
    );

    expect(result.studentCount).toBe(3);
    expect(result.studentsWithBalance).toBe(2);
    // STUDENT_ID has '2026-04' (billed this period) → NOT in not-billed bucket
    // STUDENT_ID_2 + STUDENT_ID_3 not billed this period → 2
    expect(result.studentsNotBilledThisPeriod).toBe(2);
    // Only STUDENT_ID_3 has no prior invoice → 1
    expect(result.studentsNewAdmission).toBe(1);
  });

  it('studentsWithBalance graceful degrade — accounts.list throws → counter undefined; other 2 still populated', async () => {
    const { service } = buildService({
      identityClient: {
        getStudentInfo: jest.fn(),
        getSchoolName: jest.fn().mockResolvedValue('Test'),
      },
      studentAccountsService: {
        getOrCreate: jest.fn(),
        list: jest.fn().mockRejectedValue(new Error('DDB throttled')),
      },
    });
    jest.spyOn(service, 'listForStudents').mockResolvedValue({
      items: [],
      hasMore: false,
    });

    const result = await service.bulkPreview(
      SCHOOL_ID,
      {
        selectionMode: 'students',
        studentIds: [STUDENT_ID, STUDENT_ID_2],
        feeStructureIds: [],
        billingPeriod: '2026-04',
      },
      ctx,
    );

    expect(result.studentsWithBalance).toBeUndefined();
    // Other counters survived
    expect(result.studentsNotBilledThisPeriod).toBe(2);
    expect(result.studentsNewAdmission).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/studentsWithBalance failed/),
    );
  });

  it('listForStudents throws → studentsNotBilledThisPeriod + studentsNewAdmission undefined; studentsWithBalance still populated', async () => {
    const { service } = buildService({
      identityClient: {
        getStudentInfo: jest.fn(),
        getSchoolName: jest.fn().mockResolvedValue('Test'),
      },
      studentAccountsService: {
        getOrCreate: jest.fn(),
        list: jest.fn().mockResolvedValue({
          items: [{ studentId: STUDENT_ID, balance: 500 }],
          hasMore: false,
        }),
      },
    });
    jest.spyOn(service, 'listForStudents').mockRejectedValue(new Error('GSI2 unavailable'));

    const result = await service.bulkPreview(
      SCHOOL_ID,
      {
        selectionMode: 'students',
        studentIds: [STUDENT_ID, STUDENT_ID_2],
        feeStructureIds: [],
        billingPeriod: '2026-04',
      },
      ctx,
    );

    expect(result.studentsWithBalance).toBe(1);
    expect(result.studentsNotBilledThisPeriod).toBeUndefined();
    expect(result.studentsNewAdmission).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/studentsNotBilledThisPeriod\+studentsNewAdmission failed/),
    );
  });

  it('no billingPeriod supplied → studentsNotBilledThisPeriod stays undefined (no anchor); other 2 still populated', async () => {
    const { service } = buildService({
      identityClient: {
        getStudentInfo: jest.fn(),
        getSchoolName: jest.fn().mockResolvedValue('Test'),
      },
      studentAccountsService: {
        getOrCreate: jest.fn(),
        list: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
      },
    });
    jest.spyOn(service, 'listForStudents').mockResolvedValue({
      items: [{ studentId: STUDENT_ID, billingPeriod: '2026-04' } as any],
      hasMore: false,
    });

    const result = await service.bulkPreview(
      SCHOOL_ID,
      {
        selectionMode: 'students',
        studentIds: [STUDENT_ID, STUDENT_ID_2],
        feeStructureIds: [],
        // billingPeriod omitted
      },
      ctx,
    );

    expect(result.studentsWithBalance).toBe(0);
    expect(result.studentsNotBilledThisPeriod).toBeUndefined();
    // ever-billed set has STUDENT_ID; STUDENT_ID_2 is new
    expect(result.studentsNewAdmission).toBe(1);
  });

  // Note: empty studentIds reaches `resolveStudentIdsForBulkGenerate` first
  // (which throws BadRequestException — see C.3); the defense-in-depth
  // length=0 shortcut in computePreviewSegmentCounters is never reached
  // via bulkPreview() in practice, so no test for that path here.
});
