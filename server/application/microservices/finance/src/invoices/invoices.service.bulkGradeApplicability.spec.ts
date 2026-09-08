/**
 * `InvoicesService` — #477 grade applicability in bulk generation.
 *
 * The defect: `generate()` validates fee/grade compatibility only when the
 * caller passes `dto.gradeLevel`, and neither bulk path did. A live run billed
 * three students in grades 5 and 9 the full grade-2 + grade-3 tuition catalog,
 * NPR 33,000 each, while the wizard showed a NPR 20,000 total.
 *
 * These pin the settled behaviour: bulk filters per student, skips a student
 * nothing applies to, and never drops fees when the grade cannot be resolved.
 *
 * Harness mirrors invoices.service.bulk-phase1.spec.ts.
 */

import { Logger } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const G2_STUDENT = '11111111-1111-4111-8111-111111111111';
const G3_STUDENT = '22222222-2222-4222-8222-222222222222';
const G9_STUDENT = '33333333-3333-4333-8333-333333333333';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

const GRADE_BY_STUDENT: Record<string, string> = {
  [G2_STUDENT]: '2',
  [G3_STUDENT]: '3',
  [G9_STUDENT]: '9',
};

/** The two fee structures from the live #477 run. */
const FEE_G2 = {
  feeStructureId: 'fs-g2',
  name: 'Grade 2 Annual School Fee',
  amount: 15000,
  quantity: 1,
  feeType: 'tuition',
  frequency: 'annual',
  gradeLevels: ['2'],
  taxRate: 0,
  taxType: 'none',
  version: 1,
};
const FEE_G3 = {
  feeStructureId: 'fs-g3',
  name: 'Grade 3 Annual School Fee',
  amount: 18000,
  quantity: 1,
  feeType: 'tuition',
  frequency: 'annual',
  gradeLevels: ['3'],
  taxRate: 0,
  taxType: 'none',
  version: 1,
};
/** Applies to every grade — must survive filtering for all students. */
const FEE_UNIFORM = {
  feeStructureId: 'fs-uniform',
  name: 'Elementary School Uniform',
  amount: 5000,
  quantity: 1,
  feeType: 'uniform',
  frequency: 'one_time',
  gradeLevels: [],
  taxRate: 0,
  taxType: 'none',
  version: 1,
};

function buildService(
  opts: { fees?: any[]; gradeLookup?: (id: string) => any; roster?: Map<string, string> } = {},
) {
  const fees = opts.fees ?? [FEE_G2, FEE_G3];
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
    getStudentInfo: jest.fn(async (studentId: string) =>
      opts.gradeLookup
        ? opts.gradeLookup(studentId)
        : {
            studentId,
            firstName: 'Test',
            lastName: 'Student',
            gradeLevel: GRADE_BY_STUDENT[studentId],
          },
    ),
    getSchoolName: jest.fn().mockResolvedValue('Test School'),
    getStudentIdsByGrade: jest.fn().mockResolvedValue([]),
    // #477 — one roster read seeds every grade the bulk run needs.
    getStudentGradesBySchool: jest.fn(async () =>
      opts.roster ?? new Map(Object.entries(GRADE_BY_STUDENT)),
    ),
  };
  const feeStructuresService = {
    getByIds: jest.fn(async (_s: string, ids: string[]) =>
      fees.filter(f => ids.includes(f.feeStructureId)),
    ),
  };
  const studentAccountsService = {
    getOrCreate: jest.fn(async (_s: string, studentId: string) => ({
      accountId: `acct-${studentId}`,
      studentId,
    })),
    list: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
  };
  const sequenceService = { nextInvoiceNumber: jest.fn().mockResolvedValue('INV-2026-0001') };
  const tenantSettings = { getCurrency: jest.fn().mockResolvedValue('NPR') };
  const eventsService = {
    publishInvoiceGenerated: jest.fn().mockResolvedValue(undefined),
    publishInvoiceIssued: jest.fn().mockResolvedValue(undefined),
  };

  const service = new InvoicesService(
    dynamoDBClient as any,
    eventsService as any,
    identityClient as any,
    tenantSettings as any,
    sequenceService as any,
    feeStructuresService as any,
    studentAccountsService as any,
    { optimize: jest.fn(async (u: any) => u) } as any,
  );

  return { service, identityClient, feeStructuresService, dynamoDBClient };
}

/** Fee ids handed to generate(), per student. */
function billedFeeIdsByStudent(generateSpy: jest.SpyInstance): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const call of generateSpy.mock.calls) {
    const dto = call[1] as any;
    out[dto.studentId] = dto.feeStructureIds;
  }
  return out;
}

const bulkDto = (studentIds: string[], feeStructureIds: string[]) => ({
  selectionMode: 'students' as const,
  studentIds,
  feeStructureIds,
  academicYear: '2083-academic-year',
  billingPeriod: 'First Term',
  dueDate: '2026-10-07',
});

describe('InvoicesService.generateBulk — grade applicability (#477)', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('never bills a student a fee scoped to another grade — the #477 regression', async () => {
    const { service } = buildService();
    const generateSpy = jest.spyOn(service, 'generate').mockResolvedValue({} as any);

    await service.generateBulk(
      SCHOOL_ID,
      bulkDto([G2_STUDENT, G3_STUDENT, G9_STUDENT], ['fs-g2', 'fs-g3']),
      ctx,
    );

    const billed = billedFeeIdsByStudent(generateSpy);
    // The grade-9 student is what the live run billed NPR 33,000.
    expect(billed[G9_STUDENT]).toBeUndefined();
    expect(billed[G2_STUDENT]).toEqual(['fs-g2']);
    expect(billed[G3_STUDENT]).toEqual(['fs-g3']);
  });

  it('counts a student with no applicable fee as skipped, not generated', async () => {
    const { service } = buildService();
    jest.spyOn(service, 'generate').mockResolvedValue({} as any);

    const res = await service.generateBulk(
      SCHOOL_ID,
      bulkDto([G2_STUDENT, G9_STUDENT], ['fs-g2']),
      ctx,
    );

    expect(res.generated).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.errors).toEqual([]);
  });

  it('keeps fees that apply to every grade alongside grade-scoped ones', async () => {
    const { service } = buildService({ fees: [FEE_G2, FEE_G3, FEE_UNIFORM] });
    const generateSpy = jest.spyOn(service, 'generate').mockResolvedValue({} as any);

    await service.generateBulk(
      SCHOOL_ID,
      bulkDto([G2_STUDENT, G9_STUDENT], ['fs-g2', 'fs-g3', 'fs-uniform']),
      ctx,
    );

    const billed = billedFeeIdsByStudent(generateSpy);
    expect(billed[G2_STUDENT]).toEqual(['fs-g2', 'fs-uniform']);
    // Grade 9 matches no tuition band but still owes the uniform fee.
    expect(billed[G9_STUDENT]).toEqual(['fs-uniform']);
  });

  it('passes the resolved gradeLevel through so generate() can assert it', async () => {
    const { service } = buildService();
    const generateSpy = jest.spyOn(service, 'generate').mockResolvedValue({} as any);

    await service.generateBulk(SCHOOL_ID, bulkDto([G2_STUDENT], ['fs-g2']), ctx);

    expect((generateSpy.mock.calls[0][1] as any).gradeLevel).toBe('2');
  });

  it('bills the full requested set when the grade cannot be resolved', async () => {
    // Roster read empty AND the per-student fallback down: under-filtering is
    // the safe direction — dropping fees on an unresolved grade would
    // silently under-bill.
    const { service } = buildService({
      roster: new Map(),
      gradeLookup: () => {
        throw new Error('identity unavailable');
      },
    });
    const generateSpy = jest.spyOn(service, 'generate').mockResolvedValue({} as any);

    const res = await service.generateBulk(
      SCHOOL_ID,
      bulkDto([G9_STUDENT], ['fs-g2', 'fs-g3']),
      ctx,
    );

    expect(res.generated).toBe(1);
    expect(billedFeeIdsByStudent(generateSpy)[G9_STUDENT]).toEqual(['fs-g2', 'fs-g3']);
  });

  it('reads the roster once instead of asking identity per student', async () => {
    // The whole point of the seed: applicability must not add a round trip
    // per student to a loop that already runs hundreds (#345).
    const { service, identityClient } = buildService();
    jest.spyOn(service, 'generate').mockResolvedValue({} as any);

    await service.generateBulk(
      SCHOOL_ID,
      bulkDto([G2_STUDENT, G3_STUDENT, G9_STUDENT], ['fs-g2', 'fs-g3']),
      ctx,
    );

    expect(identityClient.getStudentGradesBySchool).toHaveBeenCalledTimes(1);
    expect(identityClient.getStudentInfo).not.toHaveBeenCalled();
  });

  it('falls back to a per-student lookup only for students the roster missed', async () => {
    // Roster is capped, so a large school can return a partial list. The
    // students it did cover must not trigger individual lookups.
    const { service, identityClient } = buildService({
      roster: new Map([[G2_STUDENT, '2']]),
    });
    jest.spyOn(service, 'generate').mockResolvedValue({} as any);

    await service.generateBulk(
      SCHOOL_ID,
      bulkDto([G2_STUDENT, G3_STUDENT], ['fs-g2', 'fs-g3']),
      ctx,
    );

    const looked = identityClient.getStudentInfo.mock.calls.map((c: any[]) => c[0]);
    expect(looked).toEqual([G3_STUDENT]);
  });
});

describe('InvoicesService.bulkPreview — grade applicability (#477)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('excludes students with no applicable fee from eligibleCount', async () => {
    const { service } = buildService();

    const res = await service.bulkPreview(
      SCHOOL_ID,
      {
        selectionMode: 'students',
        studentIds: [G2_STUDENT, G3_STUDENT, G9_STUDENT],
        feeStructureIds: ['fs-g2', 'fs-g3'],
        billingPeriod: 'First Term',
      },
      ctx,
    );

    expect(res.studentCount).toBe(3);
    expect(res.noApplicableFeesCount).toBe(1);
    expect(res.eligibleCount).toBe(2);
  });

  it('reports zero when every student has something billable', async () => {
    const { service } = buildService({ fees: [FEE_UNIFORM] });

    const res = await service.bulkPreview(
      SCHOOL_ID,
      {
        selectionMode: 'students',
        studentIds: [G2_STUDENT, G9_STUDENT],
        feeStructureIds: ['fs-uniform'],
        billingPeriod: 'First Term',
      },
      ctx,
    );

    expect(res.noApplicableFeesCount).toBe(0);
    expect(res.eligibleCount).toBe(2);
  });

  it('agrees with what generateBulk will actually produce', async () => {
    const students = [G2_STUDENT, G3_STUDENT, G9_STUDENT];
    const feeIds = ['fs-g2', 'fs-g3'];

    const previewSvc = buildService().service;
    const preview = await previewSvc.bulkPreview(
      SCHOOL_ID,
      { selectionMode: 'students', studentIds: students, feeStructureIds: feeIds, billingPeriod: 'First Term' },
      ctx,
    );

    const genSvc = buildService().service;
    jest.spyOn(genSvc, 'generate').mockResolvedValue({} as any);
    const generated = await genSvc.generateBulk(SCHOOL_ID, bulkDto(students, feeIds), ctx);

    // The mismatch behind #363: preview promised more than generation made.
    expect(preview.eligibleCount).toBe(generated.generated);
  });
});
