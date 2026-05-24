/**
 * EnrollmentFlipService Spec — Sprint D.2.10
 *
 * Coverage:
 *   - Happy path: provisional → enrolled via chunked TransactWriteItems
 *   - Idempotency: pre-filtering already-non-provisional rows → skipped
 *   - Per-row fallback after chunk TransactionCanceledException
 *     - ConditionalCheckFailedException → skipped
 *     - other errors → failures[]
 *   - Per-chunk event emission
 *   - Uses SYSTEM client (not user-JWT) — flip is system-initiated
 */

import { describe, expect, it, jest } from '@jest/globals';
import { EnrollmentFlipService } from './enrollment-flip.service';
import type { Enrollment } from '../common/entities/enrollment.entity';
import { EntityKeyBuilder } from '../common/entities/base.entity';

type AnyArgs = unknown[];

const TENANT = '11111111-1111-1111-1111-111111111111';
const SCHOOL = '22222222-2222-2222-2222-222222222222';
const AY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeProvisional(overrides: Partial<Enrollment> = {}): Enrollment {
  const studentId = overrides.studentId ?? `student-${Math.random().toString(36).slice(2, 8)}`;
  const enrollmentId = overrides.enrollmentId ?? `enroll-${Math.random().toString(36).slice(2, 8)}`;
  return {
    tenantId: TENANT,
    entityKey: EntityKeyBuilder.enrollment(SCHOOL, AY, studentId),
    entityType: 'ENROLLMENT',
    enrollmentId,
    studentId,
    schoolId: SCHOOL,
    academicYearId: AY,
    gradeLevel: '8',
    status: 'provisional',
    entryDate: '2027-04-15',
    enrollmentDate: '2027-04-15',
    startDate: '2027-04-15',
    enrollmentType: 'returning',
    priorEnrollmentId: 'ay1-prior-enrollment',
    createdAt: '2027-04-15T00:00:00Z',
    updatedAt: '2027-04-15T00:00:00Z',
    createdBy: 'user-1',
    updatedBy: 'user-1',
    version: 1,
    gsi1pk: `TENANT#${TENANT}#SCHOOL#${SCHOOL}`,
    gsi1sk: `ENROLLMENT#${AY}#8`,
    gsi2pk: studentId,
    gsi2sk: `ENROLLMENT#${AY}`,
    gsi10pk: 'prior-enrollment#ay1-prior-enrollment',
    gsi10sk: `ENROLLMENT#${AY}#${enrollmentId}`,
    ...overrides,
  };
}

interface MockDdb {
  getSystemClient: jest.Mock<() => unknown>;
  getClient: jest.Mock<(...args: AnyArgs) => Promise<unknown>>;
  getTableName: jest.Mock<() => string>;
  transactWrite: jest.Mock<(...args: AnyArgs) => Promise<void>>;
  updateItem: jest.Mock<(...args: AnyArgs) => Promise<Enrollment>>;
}

function makeMockDdb(): MockDdb {
  return {
    getSystemClient: jest.fn<() => unknown>().mockReturnValue({}),
    getClient: jest
      .fn<(...args: AnyArgs) => Promise<unknown>>()
      .mockResolvedValue({}),
    getTableName: jest.fn<() => string>().mockReturnValue('edforge-academics-test'),
    transactWrite: jest
      .fn<(...args: AnyArgs) => Promise<void>>()
      .mockResolvedValue(undefined),
    updateItem: jest.fn<(...args: AnyArgs) => Promise<Enrollment>>(),
  };
}

function makeMockEvents() {
  return {
    publishEnrollmentFlipped: jest
      .fn<(...args: AnyArgs) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
}

const flipCtx = { tenantId: TENANT, userId: 'system:test', triggeringCardId: 'card-1' };

// ============================================
// Happy path
// ============================================

describe('promoteProvisionalToEnrolled — happy path', () => {
  it('flips a single provisional row via transactWrite', async () => {
    const ddb = makeMockDdb();
    const events = makeMockEvents();
    const svc = new EnrollmentFlipService(ddb as never, events as never);

    const provisional = makeProvisional();
    const result = await svc.promoteProvisionalToEnrolled([provisional], flipCtx);

    expect(result.flipped).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failures).toHaveLength(0);
    expect(ddb.transactWrite).toHaveBeenCalledTimes(1);
    expect(ddb.getSystemClient).toHaveBeenCalled(); // system-initiated; no JWT
    expect(events.publishEnrollmentFlipped).toHaveBeenCalledWith(
      TENANT,
      'card-1',
      1, // flipped
      0, // skipped
      0, // failureCount
    );
  });

  it('chunks rows at 100 per TransactWriteItems (DDB hard limit)', async () => {
    const ddb = makeMockDdb();
    const events = makeMockEvents();
    const svc = new EnrollmentFlipService(ddb as never, events as never);

    const provisionals = Array.from({ length: 150 }, () => makeProvisional());
    const result = await svc.promoteProvisionalToEnrolled(provisionals, flipCtx);

    expect(result.flipped).toBe(150);
    expect(ddb.transactWrite).toHaveBeenCalledTimes(2); // 100 + 50
  });

  it('embeds status=:provisional + attribute_exists(priorEnrollmentId) condition (D.2.10 provenance guard)', async () => {
    const ddb = makeMockDdb();
    const events = makeMockEvents();
    const svc = new EnrollmentFlipService(ddb as never, events as never);

    await svc.promoteProvisionalToEnrolled([makeProvisional()], flipCtx);

    const ops = ddb.transactWrite.mock.calls[0][1] as Array<{
      Update: { ConditionExpression: string };
    }>;
    expect(ops[0]!.Update.ConditionExpression).toContain('#status = :provisional');
    expect(ops[0]!.Update.ConditionExpression).toContain('attribute_exists(priorEnrollmentId)');
  });
});

// ============================================
// Idempotency — pre-filter
// ============================================

describe('promoteProvisionalToEnrolled — idempotency', () => {
  it('counts already-non-provisional rows as skipped without calling transactWrite', async () => {
    const ddb = makeMockDdb();
    const events = makeMockEvents();
    const svc = new EnrollmentFlipService(ddb as never, events as never);

    const alreadyFlipped = makeProvisional({ status: 'enrolled' });
    const result = await svc.promoteProvisionalToEnrolled([alreadyFlipped], flipCtx);

    expect(result.flipped).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(ddb.transactWrite).not.toHaveBeenCalled();
  });

  it('mixed batch: provisional + already-flipped → only provisional submitted to transactWrite', async () => {
    const ddb = makeMockDdb();
    const events = makeMockEvents();
    const svc = new EnrollmentFlipService(ddb as never, events as never);

    const provisional = makeProvisional();
    const alreadyFlipped = makeProvisional({ status: 'enrolled' });
    const result = await svc.promoteProvisionalToEnrolled([provisional, alreadyFlipped], flipCtx);

    expect(result.flipped).toBe(1);
    expect(result.skipped).toBe(1);
    const ops = ddb.transactWrite.mock.calls[0][1] as unknown[];
    expect(ops).toHaveLength(1);
  });
});

// ============================================
// Per-row fallback on chunk failure
// ============================================

describe('promoteProvisionalToEnrolled — per-row fallback after TransactionCanceledException', () => {
  it('CCFE on a single row → skipped (idempotent re-flip on already-flipped)', async () => {
    const ddb = makeMockDdb();
    const events = makeMockEvents();
    const svc = new EnrollmentFlipService(ddb as never, events as never);

    const tx = Object.assign(new Error('chunk canceled'), { name: 'TransactionCanceledException' });
    ddb.transactWrite.mockRejectedValueOnce(tx);
    // Per-row fallback: first update CCFE-fails (already flipped)
    const ccfe = Object.assign(new Error('precondition'), { name: 'ConditionalCheckFailedException' });
    ddb.updateItem.mockRejectedValueOnce(ccfe);

    const result = await svc.promoteProvisionalToEnrolled([makeProvisional()], flipCtx);

    expect(result.flipped).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failures).toHaveLength(0);
  });

  it('non-CCFE error in per-row fallback → failures[]', async () => {
    const ddb = makeMockDdb();
    const events = makeMockEvents();
    const svc = new EnrollmentFlipService(ddb as never, events as never);

    const tx = Object.assign(new Error('chunk canceled'), { name: 'TransactionCanceledException' });
    ddb.transactWrite.mockRejectedValueOnce(tx);
    ddb.updateItem.mockRejectedValueOnce(new Error('throughput exceeded'));

    const provisional = makeProvisional();
    const result = await svc.promoteProvisionalToEnrolled([provisional], flipCtx);

    expect(result.flipped).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failures).toEqual([
      { enrollmentId: provisional.enrollmentId, reason: 'throughput exceeded' },
    ]);
  });

  it('non-TransactionCanceledException error → PROPAGATES (no per-row fallback burst on transient infra error)', async () => {
    const ddb = makeMockDdb();
    const events = makeMockEvents();
    const svc = new EnrollmentFlipService(ddb as never, events as never);

    // ProvisionedThroughputExceededException (or any non-TX error) must
    // rethrow — converting it into 100 per-row Updates would just amplify
    // the throughput pressure and make recovery harder.
    const throughput = Object.assign(new Error('Throughput exceeded'), {
      name: 'ProvisionedThroughputExceededException',
    });
    ddb.transactWrite.mockRejectedValueOnce(throughput);

    await expect(
      svc.promoteProvisionalToEnrolled([makeProvisional()], flipCtx),
    ).rejects.toThrow(/Throughput exceeded/);
    expect(ddb.updateItem).not.toHaveBeenCalled(); // no per-row fallback
  });

  it('mixed per-row outcomes split correctly between flipped / skipped / failures', async () => {
    const ddb = makeMockDdb();
    const events = makeMockEvents();
    const svc = new EnrollmentFlipService(ddb as never, events as never);

    const tx = Object.assign(new Error('chunk canceled'), { name: 'TransactionCanceledException' });
    ddb.transactWrite.mockRejectedValueOnce(tx);

    const ccfe = Object.assign(new Error('precondition'), { name: 'ConditionalCheckFailedException' });
    ddb.updateItem
      .mockResolvedValueOnce(makeProvisional({ status: 'enrolled' }))  // row 1 flipped
      .mockRejectedValueOnce(ccfe)                                      // row 2 already-flipped (skipped)
      .mockRejectedValueOnce(new Error('boom'));                        // row 3 failure

    const result = await svc.promoteProvisionalToEnrolled(
      [
        makeProvisional({ enrollmentId: 'e1' }),
        makeProvisional({ enrollmentId: 'e2' }),
        makeProvisional({ enrollmentId: 'e3' }),
      ],
      flipCtx,
    );

    expect(result.flipped).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.enrollmentId).toBe('e3');
  });
});
