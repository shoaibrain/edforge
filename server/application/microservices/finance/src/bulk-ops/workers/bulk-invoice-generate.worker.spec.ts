/**
 * BulkInvoiceGenerateWorker — Sprint E.4 unit tests.
 *
 * Pinned worker behaviors (regressions here either break the 90s
 * acceptance gate or corrupt the per-student counter trail):
 *
 *   1. Happy path: 10 students all succeed. Sequence reserved ONCE
 *      (incrementSequenceBy called with n=10), schoolName + currency
 *      fetched ONCE each (audit HIGH #3 cache), per-student generate
 *      called 10× with pre-allocated invoice numbers in [start, start+10).
 *      markRunning + markCompleted called in order. Audit emits
 *      `finance.bulk_generate.started` + `finance.bulk_generate.succeeded`.
 *
 *   2. Worker-level catastrophe: incrementSequenceBy throws →
 *      markFailed + audit `finance.bulk_generate.failed`. No
 *      per-student work attempted.
 *
 *   3. Per-student failure isolation: 1 of 5 generate calls throws →
 *      appendFailedStudent recorded for that student; remaining 4 succeed;
 *      job ends in `markCompleted` (not markFailed). incrementCounter
 *      'succeeded' fired 4× for the survivors. No rethrow leaks past
 *      the worker.
 *
 *   4. DRAFT-only invariant (operator decision 1): generateForBulkWorker
 *      called WITHOUT `autoIssue:true`. The pre-allocated invoice number
 *      is passed in; the worker NEVER calls invoicesService.issue.
 *
 *   5. Per-school lock held + released. Two concurrent run() invocations
 *      for the SAME schoolId serialize; the second's markRunning fires
 *      after the first's markCompleted. release() is called even when
 *      the worker throws (try/finally).
 *
 *   6. Duplicate detection: checkDuplicateInvoice → true bumps `skipped`
 *      counter; generateForBulkWorker NOT called for that student.
 *
 *   7. SchoolName fallback: if identityClient.getSchoolName throws,
 *      worker uses schoolId as the cached schoolName and STILL proceeds
 *      (no per-student fallout from a single identity blip).
 *
 *   8. appendFailedStudent failure does NOT brick the loop: if the
 *      per-student error recorder itself throws (CCFE on stale version),
 *      worker logs + continues to the next student.
 *
 * Test harness: handwritten jest.fn collaborators (mirror of
 * invoices.service.bulk-phase1.spec.ts). No Nest DI bootstrap.
 */

import { Logger } from '@nestjs/common';
import { BulkInvoiceGenerateWorker } from './bulk-invoice-generate.worker';
import { PerSchoolLock } from '../util/per-school-lock';

const TENANT = '11111111-1111-4111-8111-111111111111';
const SCHOOL = '22222222-2222-4222-8222-222222222222';
const SCHOOL_B = '99999999-9999-4999-8999-999999999999';
const OPERATOR = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID_B = '55555555-5555-4555-8555-555555555555';

function ctx(overrides: Partial<any> = {}): any {
  return {
    tenantId: TENANT,
    userId: OPERATOR,
    role: 'TenantAdmin',
    jwtToken: 'jwt',
    schoolId: SCHOOL,
    ...overrides,
  };
}

function studentIds(n: number, prefix = 'student'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
}

interface MockCollaborators {
  jobsService: {
    markRunning: jest.Mock;
    markCompleted: jest.Mock;
    markFailed: jest.Mock;
    appendFailedStudent: jest.Mock;
    incrementCounter: jest.Mock;
  };
  invoicesService: {
    checkDuplicateInvoice: jest.Mock;
    generateForBulkWorker: jest.Mock;
    issue: jest.Mock;
  };
  sequenceService: {
    incrementSequenceBy: jest.Mock;
    getInvoiceSequenceType: jest.Mock;
    formatInvoiceNumber: jest.Mock;
  };
  identityClient: {
    getSchoolName: jest.Mock;
  };
  feeStructuresService: {
    getByIds: jest.Mock;
  };
  tenantSettings: {
    getCurrency: jest.Mock;
  };
  auditService: {
    emit: jest.Mock;
  };
  dynamoDBClient: {
    getClient: jest.Mock;
  };
  perSchoolLock: PerSchoolLock;
}

function makeWorker(overrides: Partial<{
  jobsService: Partial<MockCollaborators['jobsService']>;
  invoicesService: Partial<MockCollaborators['invoicesService']>;
  sequenceService: Partial<MockCollaborators['sequenceService']>;
  identityClient: Partial<MockCollaborators['identityClient']>;
  feeStructuresService: Partial<MockCollaborators['feeStructuresService']>;
  tenantSettings: Partial<MockCollaborators['tenantSettings']>;
  auditService: Partial<MockCollaborators['auditService']>;
  dynamoDBClient: Partial<MockCollaborators['dynamoDBClient']>;
  perSchoolLock: PerSchoolLock;
}> = {}): { worker: BulkInvoiceGenerateWorker; mocks: MockCollaborators } {
  const jobsService = {
    markRunning: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    appendFailedStudent: jest.fn().mockResolvedValue(undefined),
    incrementCounter: jest.fn().mockResolvedValue(undefined),
    ...overrides.jobsService,
  };
  const invoicesService = {
    checkDuplicateInvoice: jest.fn().mockResolvedValue(false),
    generateForBulkWorker: jest.fn().mockResolvedValue({}),
    issue: jest.fn(),
    ...overrides.invoicesService,
  };
  const sequenceService = {
    incrementSequenceBy: jest.fn().mockResolvedValue({ startValue: 1000, endValue: 1010 }),
    getInvoiceSequenceType: jest.fn().mockReturnValue('INVOICE#2606'),
    formatInvoiceNumber: jest.fn((schoolId: string, n: number) => `INV-XYZ-2606-${String(n).padStart(4, '0')}`),
    ...overrides.sequenceService,
  };
  const identityClient = {
    getSchoolName: jest.fn().mockResolvedValue('Test School'),
    ...overrides.identityClient,
  };
  const feeStructuresService = {
    getByIds: jest.fn().mockResolvedValue([{ feeStructureId: 'fs-1' }]),
    ...overrides.feeStructuresService,
  };
  const tenantSettings = {
    getCurrency: jest.fn().mockResolvedValue('NPR'),
    ...overrides.tenantSettings,
  };
  const auditService = {
    emit: jest.fn().mockResolvedValue(undefined),
    ...overrides.auditService,
  };
  const dynamoDBClient = {
    getClient: jest.fn().mockResolvedValue({}),
    ...overrides.dynamoDBClient,
  };
  const perSchoolLock = overrides.perSchoolLock ?? new PerSchoolLock();

  // PR #341 F5: worker no longer injects FinanceAuditService — lifecycle
  // audit emits live on the service (single audit gatekeeper). `auditService`
  // mock is kept in the harness so the existing fixture override surface
  // doesn't break callers; the worker just no longer receives it.
  const worker = new BulkInvoiceGenerateWorker(
    jobsService as any,
    invoicesService as any,
    sequenceService as any,
    identityClient as any,
    feeStructuresService as any,
    tenantSettings as any,
    dynamoDBClient as any,
    perSchoolLock,
  );

  return {
    worker,
    mocks: {
      jobsService,
      invoicesService,
      sequenceService,
      identityClient,
      feeStructuresService,
      tenantSettings,
      auditService,
      dynamoDBClient,
      perSchoolLock,
    },
  };
}

describe('BulkInvoiceGenerateWorker — Sprint E.4', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  // ────────────────────────────────────────────────────────────────────
  // 1. Happy path
  // ────────────────────────────────────────────────────────────────────
  it('happy path: 10 students all succeed; sequence reserved ONCE; schoolName + currency fetched ONCE each', async () => {
    const { worker, mocks } = makeWorker({
      sequenceService: {
        incrementSequenceBy: jest.fn().mockResolvedValue({ startValue: 100, endValue: 110 }),
      },
    });
    const ids = studentIds(10);

    await worker.run(
      JOB_ID,
      {
        schoolId: SCHOOL,
        resolvedStudentIds: ids,
        feeStructureIds: ['fs-1', 'fs-2'],
        academicYear: '2026-2027',
        dueDate: '2026-08-15',
      } as any,
      ctx(),
    );

    // Lifecycle: markRunning then markCompleted, no markFailed.
    expect(mocks.jobsService.markRunning).toHaveBeenCalledTimes(1);
    expect(mocks.jobsService.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.jobsService.markFailed).not.toHaveBeenCalled();

    // Sequence reservation: ONE call, n=10 (audit BLOCKER #1).
    expect(mocks.sequenceService.incrementSequenceBy).toHaveBeenCalledTimes(1);
    expect(mocks.sequenceService.incrementSequenceBy).toHaveBeenCalledWith(
      expect.anything(), // client
      TENANT,
      SCHOOL,
      'INVOICE#2606',
      10,
    );

    // School-level metadata fetched ONCE each (audit HIGH #3).
    expect(mocks.identityClient.getSchoolName).toHaveBeenCalledTimes(1);
    expect(mocks.tenantSettings.getCurrency).toHaveBeenCalledTimes(1);

    // Per-student generate: 10 calls, no duplicates, each with the right
    // pre-allocated invoice number.
    expect(mocks.invoicesService.generateForBulkWorker).toHaveBeenCalledTimes(10);
    const calls = mocks.invoicesService.generateForBulkWorker.mock.calls;
    const seenStudentIds = new Set<string>();
    const seenInvoiceNumbers = new Set<string>();
    for (const [schoolArg, dtoArg] of calls) {
      expect(schoolArg).toBe(SCHOOL);
      expect(dtoArg.cachedSchoolName).toBe('Test School');
      expect(dtoArg.cachedCurrency).toBe('NPR');
      expect(dtoArg).not.toHaveProperty('autoIssue', true);
      seenStudentIds.add(dtoArg.studentId);
      seenInvoiceNumbers.add(dtoArg.preAllocatedInvoiceNumber);
    }
    expect(seenStudentIds.size).toBe(10);
    expect(seenInvoiceNumbers.size).toBe(10); // distinct per student

    // Counters: 10 increments to 'succeeded'.
    const succeededCalls = mocks.jobsService.incrementCounter.mock.calls.filter(
      (c: any) => c[1] === 'succeeded',
    );
    expect(succeededCalls).toHaveLength(10);

    // PR #341 F5: lifecycle audit emits moved into FinanceJobsService.
    // The worker no longer emits `bulk_generate.{started,succeeded,failed}`
    // directly — markRunning/markCompleted/markFailed do it via emitAudit
    // (covered by finance-jobs.service.spec.ts). The worker's contract is
    // therefore the lifecycle call ordering, asserted above.
    expect(mocks.auditService.emit).not.toHaveBeenCalled();

    // Worker NEVER issued (DRAFT-only invariant — operator decision 1).
    expect(mocks.invoicesService.issue).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. Worker-level catastrophe
  // ────────────────────────────────────────────────────────────────────
  it('worker-level catastrophe (sequence reservation fails) → markFailed + audit failed; no per-student work', async () => {
    const { worker, mocks } = makeWorker({
      sequenceService: {
        incrementSequenceBy: jest.fn().mockRejectedValue(
          new Error('incrementSequenceBy: gave up after 4 attempts'),
        ),
      },
    });

    await worker.run(
      JOB_ID,
      {
        schoolId: SCHOOL,
        resolvedStudentIds: studentIds(5),
        feeStructureIds: ['fs-1'],
        academicYear: '2026-2027',
        dueDate: '2026-08-15',
      } as any,
      ctx(),
    );

    expect(mocks.jobsService.markRunning).toHaveBeenCalledTimes(1);
    expect(mocks.jobsService.markCompleted).not.toHaveBeenCalled();
    expect(mocks.jobsService.markFailed).toHaveBeenCalledTimes(1);
    expect(mocks.jobsService.markFailed.mock.calls[0][1]).toMatch(/gave up after 4 attempts/);

    expect(mocks.invoicesService.generateForBulkWorker).not.toHaveBeenCalled();

    // PR #341 F5: audit emits live on FinanceJobsService (covered by its
    // spec). The worker no longer emits directly — assert that.
    expect(mocks.auditService.emit).not.toHaveBeenCalled();
  });

  it('worker-level catastrophe (no fee structures match) → markFailed', async () => {
    const { worker, mocks } = makeWorker({
      feeStructuresService: { getByIds: jest.fn().mockResolvedValue([]) },
    });

    await worker.run(
      JOB_ID,
      {
        schoolId: SCHOOL,
        resolvedStudentIds: studentIds(3),
        feeStructureIds: ['fs-1'],
        academicYear: '2026-2027',
        dueDate: '2026-08-15',
      } as any,
      ctx(),
    );

    expect(mocks.jobsService.markFailed).toHaveBeenCalledTimes(1);
    expect(mocks.jobsService.markFailed.mock.calls[0][1]).toMatch(/No valid fee structures/);
    expect(mocks.invoicesService.generateForBulkWorker).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. Per-student failure isolation
  // ────────────────────────────────────────────────────────────────────
  it('per-student failure isolation: 1 of 5 throws → appendFailedStudent for failed; markCompleted (not markFailed)', async () => {
    const failingId = 'student-2';
    const { worker, mocks } = makeWorker({
      invoicesService: {
        checkDuplicateInvoice: jest.fn().mockResolvedValue(false),
        generateForBulkWorker: jest.fn((schoolId, dto) => {
          if (dto.studentId === failingId) {
            return Promise.reject(new Error('synthetic-fail-on-student-2'));
          }
          return Promise.resolve({});
        }),
        issue: jest.fn(),
      },
    });

    await worker.run(
      JOB_ID,
      {
        schoolId: SCHOOL,
        resolvedStudentIds: studentIds(5),
        feeStructureIds: ['fs-1'],
        academicYear: '2026-2027',
        dueDate: '2026-08-15',
      } as any,
      ctx(),
    );

    expect(mocks.jobsService.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.jobsService.markFailed).not.toHaveBeenCalled();

    // The failing student should have been recorded exactly once.
    expect(mocks.jobsService.appendFailedStudent).toHaveBeenCalledTimes(1);
    expect(mocks.jobsService.appendFailedStudent.mock.calls[0][1]).toBe(failingId);
    expect(mocks.jobsService.appendFailedStudent.mock.calls[0][2]).toMatch(
      /synthetic-fail-on-student-2/,
    );

    // 4 succeeded counter bumps for the survivors.
    const succeededCalls = mocks.jobsService.incrementCounter.mock.calls.filter(
      (c: any) => c[1] === 'succeeded',
    );
    expect(succeededCalls).toHaveLength(4);
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. Duplicate detection skips
  // ────────────────────────────────────────────────────────────────────
  it('duplicate detection: skipped students bump the `skipped` counter; generateForBulkWorker NOT called for them', async () => {
    const dupId = 'student-1';
    const { worker, mocks } = makeWorker({
      invoicesService: {
        checkDuplicateInvoice: jest.fn((schoolId, studentId) =>
          Promise.resolve(studentId === dupId),
        ),
        generateForBulkWorker: jest.fn().mockResolvedValue({}),
        issue: jest.fn(),
      },
    });

    await worker.run(
      JOB_ID,
      {
        schoolId: SCHOOL,
        resolvedStudentIds: studentIds(4),
        feeStructureIds: ['fs-1'],
        academicYear: '2026-2027',
        billingPeriod: '2026-07',
        dueDate: '2026-08-15',
      } as any,
      ctx(),
    );

    const generateCalls = mocks.invoicesService.generateForBulkWorker.mock.calls;
    const generatedIds = generateCalls.map((c: any) => c[1].studentId);
    expect(generatedIds).not.toContain(dupId);
    expect(generatedIds).toHaveLength(3);

    const skippedCalls = mocks.jobsService.incrementCounter.mock.calls.filter(
      (c: any) => c[1] === 'skipped',
    );
    expect(skippedCalls).toHaveLength(1);
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. Per-school lock release on success + failure
  // ────────────────────────────────────────────────────────────────────
  it('per-school lock: serializes two concurrent runs on the same schoolId', async () => {
    const sharedLock = new PerSchoolLock();
    const events: string[] = [];

    // First worker — succeeds, slow markRunning to give second a chance to queue.
    const first = makeWorker({
      perSchoolLock: sharedLock,
      jobsService: {
        markRunning: jest.fn(async () => {
          events.push('A:markRunning');
          await new Promise((r) => setImmediate(r));
        }),
        markCompleted: jest.fn(async () => {
          events.push('A:markCompleted');
        }),
        markFailed: jest.fn(),
        appendFailedStudent: jest.fn(),
        incrementCounter: jest.fn(),
      },
    });
    const second = makeWorker({
      perSchoolLock: sharedLock,
      jobsService: {
        markRunning: jest.fn(async () => {
          events.push('B:markRunning');
        }),
        markCompleted: jest.fn(async () => {
          events.push('B:markCompleted');
        }),
        markFailed: jest.fn(),
        appendFailedStudent: jest.fn(),
        incrementCounter: jest.fn(),
      },
    });

    const inputA = {
      schoolId: SCHOOL,
      resolvedStudentIds: studentIds(2, 'a'),
      feeStructureIds: ['fs-1'],
      academicYear: '2026-2027',
      dueDate: '2026-08-15',
    } as any;
    const inputB = {
      schoolId: SCHOOL, // SAME school → must serialize
      resolvedStudentIds: studentIds(2, 'b'),
      feeStructureIds: ['fs-1'],
      academicYear: '2026-2027',
      dueDate: '2026-08-15',
    } as any;

    await Promise.all([
      first.worker.run(JOB_ID, inputA, ctx()),
      second.worker.run(JOB_ID_B, inputB, ctx()),
    ]);

    // B's markRunning MUST come strictly after A's markCompleted because
    // the lock is held for the whole run.
    const aDone = events.indexOf('A:markCompleted');
    const bStart = events.indexOf('B:markRunning');
    expect(aDone).toBeGreaterThanOrEqual(0);
    expect(bStart).toBeGreaterThan(aDone);

    // Lock fully released after both runs.
    expect(sharedLock.size()).toBe(0);
  });

  it('per-school lock: two runs for DIFFERENT schoolIds do NOT block each other', async () => {
    const sharedLock = new PerSchoolLock();
    const events: string[] = [];

    const first = makeWorker({
      perSchoolLock: sharedLock,
      jobsService: {
        markRunning: jest.fn(async () => {
          events.push('A:markRunning');
          // Park here so we can prove B continues independently.
          await new Promise((r) => setTimeout(r, 30));
        }),
        markCompleted: jest.fn(async () => { events.push('A:markCompleted'); }),
        markFailed: jest.fn(),
        appendFailedStudent: jest.fn(),
        incrementCounter: jest.fn(),
      },
    });
    const second = makeWorker({
      perSchoolLock: sharedLock,
      jobsService: {
        markRunning: jest.fn(async () => { events.push('B:markRunning'); }),
        markCompleted: jest.fn(async () => { events.push('B:markCompleted'); }),
        markFailed: jest.fn(),
        appendFailedStudent: jest.fn(),
        incrementCounter: jest.fn(),
      },
    });

    const inputA = {
      schoolId: SCHOOL,
      resolvedStudentIds: studentIds(1, 'a'),
      feeStructureIds: ['fs-1'],
      academicYear: '2026-2027',
      dueDate: '2026-08-15',
    } as any;
    const inputB = {
      schoolId: SCHOOL_B, // DIFFERENT school
      resolvedStudentIds: studentIds(1, 'b'),
      feeStructureIds: ['fs-1'],
      academicYear: '2026-2027',
      dueDate: '2026-08-15',
    } as any;

    await Promise.all([
      first.worker.run(JOB_ID, inputA, ctx()),
      second.worker.run(JOB_ID_B, inputB, ctx({ schoolId: SCHOOL_B })),
    ]);

    // B must complete BEFORE A because A's markRunning parks for 30ms;
    // they don't share a lock.
    const bDone = events.indexOf('B:markCompleted');
    const aDone = events.indexOf('A:markCompleted');
    expect(bDone).toBeGreaterThanOrEqual(0);
    expect(aDone).toBeGreaterThan(bDone);
    expect(sharedLock.size()).toBe(0);
  });

  it('per-school lock: released even when the worker throws (try/finally invariant)', async () => {
    const sharedLock = new PerSchoolLock();
    const { worker } = makeWorker({
      perSchoolLock: sharedLock,
      sequenceService: {
        incrementSequenceBy: jest.fn().mockRejectedValue(new Error('boom')),
      },
    });

    await worker.run(
      JOB_ID,
      {
        schoolId: SCHOOL,
        resolvedStudentIds: studentIds(2),
        feeStructureIds: ['fs-1'],
        academicYear: '2026-2027',
        dueDate: '2026-08-15',
      } as any,
      ctx(),
    );

    expect(sharedLock.size()).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. SchoolName fallback
  // ────────────────────────────────────────────────────────────────────
  it('schoolName fetch throws → falls back to schoolId; worker still completes', async () => {
    const { worker, mocks } = makeWorker({
      identityClient: {
        getSchoolName: jest.fn().mockRejectedValue(new Error('identity 5xx')),
      },
    });

    await worker.run(
      JOB_ID,
      {
        schoolId: SCHOOL,
        resolvedStudentIds: studentIds(2),
        feeStructureIds: ['fs-1'],
        academicYear: '2026-2027',
        dueDate: '2026-08-15',
      } as any,
      ctx(),
    );

    expect(mocks.jobsService.markCompleted).toHaveBeenCalledTimes(1);
    const generateCalls = mocks.invoicesService.generateForBulkWorker.mock.calls;
    for (const [, dto] of generateCalls) {
      expect(dto.cachedSchoolName).toBe(SCHOOL);
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 8. appendFailedStudent failure does NOT brick the loop
  // ────────────────────────────────────────────────────────────────────
  it('appendFailedStudent itself throws → worker logs + continues with the remaining students', async () => {
    const { worker, mocks } = makeWorker({
      invoicesService: {
        checkDuplicateInvoice: jest.fn().mockResolvedValue(false),
        generateForBulkWorker: jest.fn((schoolId, dto) =>
          dto.studentId === 'student-1'
            ? Promise.reject(new Error('synthetic-fail'))
            : Promise.resolve({}),
        ),
        issue: jest.fn(),
      },
      jobsService: {
        markRunning: jest.fn().mockResolvedValue(undefined),
        markCompleted: jest.fn().mockResolvedValue(undefined),
        markFailed: jest.fn().mockResolvedValue(undefined),
        appendFailedStudent: jest.fn().mockRejectedValue(new Error('append-failed')),
        incrementCounter: jest.fn().mockResolvedValue(undefined),
      },
    });

    await worker.run(
      JOB_ID,
      {
        schoolId: SCHOOL,
        resolvedStudentIds: studentIds(3),
        feeStructureIds: ['fs-1'],
        academicYear: '2026-2027',
        dueDate: '2026-08-15',
      } as any,
      ctx(),
    );

    // The worker still completed (didn't go to markFailed).
    expect(mocks.jobsService.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.jobsService.markFailed).not.toHaveBeenCalled();
    // 2 succeeded counter bumps for the survivors.
    const succeededCalls = mocks.jobsService.incrementCounter.mock.calls.filter(
      (c: any) => c[1] === 'succeeded',
    );
    expect(succeededCalls).toHaveLength(2);
  });

  // ────────────────────────────────────────────────────────────────────
  // BULK_INVOICE_GENERATE_CONCURRENCY env override
  // ────────────────────────────────────────────────────────────────────
  it('BULK_INVOICE_GENERATE_CONCURRENCY env clamps to MAX_CONCURRENCY (sanity cap)', async () => {
    const prev = process.env.BULK_INVOICE_GENERATE_CONCURRENCY;
    process.env.BULK_INVOICE_GENERATE_CONCURRENCY = '999'; // way above cap

    try {
      const { worker, mocks } = makeWorker();
      let maxInFlight = 0;
      let inFlight = 0;
      mocks.invoicesService.generateForBulkWorker.mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight--;
      });

      await worker.run(
        JOB_ID,
        {
          schoolId: SCHOOL,
          resolvedStudentIds: studentIds(100),
          feeStructureIds: ['fs-1'],
          academicYear: '2026-2027',
          dueDate: '2026-08-15',
        } as any,
        ctx(),
      );

      expect(maxInFlight).toBeLessThanOrEqual(64); // MAX_CONCURRENCY
      expect(maxInFlight).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) delete process.env.BULK_INVOICE_GENERATE_CONCURRENCY;
      else process.env.BULK_INVOICE_GENERATE_CONCURRENCY = prev;
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // PR #341 F3: counter-write failure ≠ student failure
  // The bug: incrementCounter('succeeded') after a successful generate
  // shared the outer try/catch; if it threw, the student was marked
  // failed even though the invoice was already durably in DDB. On retry,
  // duplicate-detection would mis-record it as failed AGAIN. The fix
  // splits into outer try (generation) + inner try (counter bump):
  // generation failure → failedStudentIds; counter failure → log only.
  // ────────────────────────────────────────────────────────────────────
  it('PR #341 F3: succeeded-counter increment failure does NOT mark the student as failed (invoice already durable)', async () => {
    const { worker, mocks } = makeWorker({
      jobsService: {
        markRunning: jest.fn().mockResolvedValue(undefined),
        markCompleted: jest.fn().mockResolvedValue(undefined),
        markFailed: jest.fn().mockResolvedValue(undefined),
        appendFailedStudent: jest.fn().mockResolvedValue(undefined),
        // Every succeeded-bump throws; every skipped-bump succeeds (defensive
        // — we want the assertion to be unambiguous about which counter
        // path raised).
        incrementCounter: jest.fn((_jid: string, counter: string) =>
          counter === 'succeeded'
            ? Promise.reject(new Error('counter-write race'))
            : Promise.resolve(undefined),
        ),
      },
    });

    await worker.run(
      JOB_ID,
      {
        schoolId: SCHOOL,
        resolvedStudentIds: studentIds(3),
        feeStructureIds: ['fs-1'],
        academicYear: '2026-2027',
        dueDate: '2026-08-15',
      } as any,
      ctx(),
    );

    // Generation succeeded for all 3 students.
    expect(mocks.invoicesService.generateForBulkWorker).toHaveBeenCalledTimes(3);

    // CRITICAL: counter-write failure must NOT mark students as failed.
    // Pre-fix: appendFailedStudent would be called 3× because the catch
    // block treated the counter failure as a student failure.
    expect(mocks.jobsService.appendFailedStudent).not.toHaveBeenCalled();

    // Job still completes successfully (counter drift is bookkeeping,
    // not a generation problem).
    expect(mocks.jobsService.markCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.jobsService.markFailed).not.toHaveBeenCalled();
  });

  it('PR #341 F3: skipped-counter increment failure also does NOT mark the duplicate as failed', async () => {
    const { worker, mocks } = makeWorker({
      invoicesService: {
        checkDuplicateInvoice: jest.fn().mockResolvedValue(true), // all dupes
        generateForBulkWorker: jest.fn().mockResolvedValue({}),
        issue: jest.fn(),
      },
      jobsService: {
        markRunning: jest.fn().mockResolvedValue(undefined),
        markCompleted: jest.fn().mockResolvedValue(undefined),
        markFailed: jest.fn().mockResolvedValue(undefined),
        appendFailedStudent: jest.fn().mockResolvedValue(undefined),
        incrementCounter: jest.fn((_jid: string, counter: string) =>
          counter === 'skipped'
            ? Promise.reject(new Error('skipped-counter race'))
            : Promise.resolve(undefined),
        ),
      },
    });

    await worker.run(
      JOB_ID,
      {
        schoolId: SCHOOL,
        resolvedStudentIds: studentIds(2),
        feeStructureIds: ['fs-1'],
        academicYear: '2026-2027',
        dueDate: '2026-08-15',
      } as any,
      ctx(),
    );

    // generateForBulkWorker NOT called because every student was a dupe.
    expect(mocks.invoicesService.generateForBulkWorker).not.toHaveBeenCalled();
    // Students were dupes, not failures — appendFailedStudent never invoked.
    expect(mocks.jobsService.appendFailedStudent).not.toHaveBeenCalled();
    expect(mocks.jobsService.markCompleted).toHaveBeenCalledTimes(1);
  });

  // ────────────────────────────────────────────────────────────────────
  // PR #341 F4: skipZeroTotal pre-filter (sync↔async parity)
  // Sync generateBulk() at invoices.service.ts ~§1418-1442 short-circuits
  // the whole batch when customLineItems sum + fee-structure amount sum
  // === 0 AND skipZeroTotal is true. The async worker MUST mirror that
  // gate BEFORE reserving sequence numbers (otherwise the operator gets
  // different behavior across the sync/async fork).
  // ────────────────────────────────────────────────────────────────────
  it('PR #341 F4: skipZeroTotal + zero projected gross → early-exit; NO sequence reservation, NO generate calls', async () => {
    const { worker, mocks } = makeWorker({
      // Fee structures sum to 0 — would fail the skipZeroTotal gate.
      feeStructuresService: {
        getByIds: jest.fn().mockResolvedValue([
          { feeStructureId: 'fs-zero', amount: 0 },
        ]),
      },
    });

    await worker.run(
      JOB_ID,
      {
        schoolId: SCHOOL,
        resolvedStudentIds: studentIds(20),
        feeStructureIds: ['fs-zero'],
        academicYear: '2026-2027',
        dueDate: '2026-08-15',
        skipZeroTotal: true,
        // no customLineItems
      } as any,
      ctx(),
    );

    // No sequence reservation — the bug pre-fix wasted 20 numbers per call.
    expect(mocks.sequenceService.incrementSequenceBy).not.toHaveBeenCalled();
    // No per-student work whatsoever.
    expect(mocks.invoicesService.generateForBulkWorker).not.toHaveBeenCalled();
    expect(mocks.jobsService.appendFailedStudent).not.toHaveBeenCalled();
    // Job terminalizes as success with skipped=N, succeeded=0, failed=0.
    expect(mocks.jobsService.markCompleted).toHaveBeenCalledTimes(1);
    const [, completion] = mocks.jobsService.markCompleted.mock.calls[0];
    expect(completion.counters).toEqual({
      succeeded: 0,
      skipped: 20,
      failed: 0,
    });
  });

  it('PR #341 F4: skipZeroTotal:false (or unset) → all students processed even with zero fees (no pre-filter applies)', async () => {
    const { worker, mocks } = makeWorker({
      feeStructuresService: {
        getByIds: jest.fn().mockResolvedValue([
          { feeStructureId: 'fs-zero', amount: 0 },
        ]),
      },
    });

    await worker.run(
      JOB_ID,
      {
        schoolId: SCHOOL,
        resolvedStudentIds: studentIds(5),
        feeStructureIds: ['fs-zero'],
        academicYear: '2026-2027',
        dueDate: '2026-08-15',
        // skipZeroTotal omitted → gate does not fire
      } as any,
      ctx(),
    );

    // Full sequence reservation and full per-student loop.
    expect(mocks.sequenceService.incrementSequenceBy).toHaveBeenCalledTimes(1);
    expect(mocks.invoicesService.generateForBulkWorker).toHaveBeenCalledTimes(5);
  });

  it('PR #341 F4: skipZeroTotal + non-zero customLineItems → pre-filter does NOT fire (customSum saves the batch)', async () => {
    const { worker, mocks } = makeWorker({
      feeStructuresService: {
        getByIds: jest.fn().mockResolvedValue([
          { feeStructureId: 'fs-zero', amount: 0 },
        ]),
      },
    });

    await worker.run(
      JOB_ID,
      {
        schoolId: SCHOOL,
        resolvedStudentIds: studentIds(3),
        feeStructureIds: ['fs-zero'],
        academicYear: '2026-2027',
        dueDate: '2026-08-15',
        skipZeroTotal: true,
        customLineItems: [{ name: 'Picnic', amount: 500 }],
      } as any,
      ctx(),
    );

    // Custom lines push projected gross > 0 → batch runs normally.
    expect(mocks.sequenceService.incrementSequenceBy).toHaveBeenCalledTimes(1);
    expect(mocks.invoicesService.generateForBulkWorker).toHaveBeenCalledTimes(3);
  });
});
