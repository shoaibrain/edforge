/**
 * PromotionCommitService Spec — Sprint D.2.6
 *
 * Focus areas:
 *   - Happy path: chunked transactWrite produces the right ops mix
 *     (Update AY1 + Put AY2 provisional for promoted decisions)
 *   - retained → only Update AY1, no AY2 row created
 *   - graduated/withdrawn → AY1 status transitions, no AY2 row
 *   - Source-enrollment-not-found → row appears in failures, NOT in chunk
 *   - Chunk failure rolls back chunk only; failures list populated
 */

import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { PromotionCommitService } from './promotion-commit.service';
import type { Enrollment } from '../common/entities/enrollment.entity';

type AnyArgs = unknown[];

const TENANT = '11111111-1111-1111-1111-111111111111';
const SCHOOL = '22222222-2222-2222-2222-222222222222';
const FROM_AY = 'ay-2025';
const TARGET_AY = 'ay-2026';
const CTX = {
  userId: 'user-1',
  tenantId: TENANT,
  email: 'op@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt',
};

function makeAy1Enrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  const enrollmentId = overrides.enrollmentId ?? '00000000-0000-0000-0000-000000000001';
  const studentId = overrides.studentId ?? '00000000-0000-0000-0000-000000000aaa';
  return {
    tenantId: TENANT,
    entityKey: `ENROLLMENT#${SCHOOL}#${FROM_AY}#${studentId}`,
    entityType: 'ENROLLMENT',
    enrollmentId,
    studentId,
    schoolId: SCHOOL,
    academicYearId: FROM_AY,
    gradeLevel: '7',
    status: 'enrolled',
    entryDate: '2025-04-15',
    enrollmentDate: '2025-04-15',
    startDate: '2025-04-15',
    enrollmentType: 'returning',
    gsi1pk: `TENANT#${TENANT}#SCHOOL#${SCHOOL}`,
    gsi1sk: `ENROLLMENT#${FROM_AY}#7`,
    gsi2pk: studentId,
    gsi2sk: `ENROLLMENT#${FROM_AY}`,
    version: 1,
    createdAt: '2025-04-15T00:00:00Z',
    updatedAt: '2025-04-15T00:00:00Z',
    createdBy: 'user-1',
    updatedBy: 'user-1',
    ...overrides,
  };
}

function makeService(opts: { pre: Enrollment[] } = { pre: [] }) {
  const ddb = {
    getClient: jest.fn<(...args: AnyArgs) => Promise<unknown>>().mockResolvedValue({}),
    getTableName: jest.fn<() => string>().mockReturnValue('edforge-academics-test'),
    queryGSI: jest
      .fn<(...args: AnyArgs) => Promise<{ items: Enrollment[]; hasMore: boolean }>>()
      .mockImplementation(async (...args: AnyArgs) => {
        // findEnrollmentById uses GSI1 begins_with + filter on enrollmentId
        const filterValues = args[6] as Record<string, unknown> | undefined;
        const enrollmentId = filterValues?.[':enrollmentId'];
        const match = opts.pre.find((e) => e.enrollmentId === enrollmentId);
        return { items: match ? [match] : [], hasMore: false };
      }),
    transactWrite: jest
      .fn<(...args: AnyArgs) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
  const events = {
    publishEnrollmentPromoted: jest
      .fn<(...args: AnyArgs) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
  return {
    service: new PromotionCommitService(ddb as never, events as never),
    ddb,
    events,
  };
}

// ============================================
// BadRequest guards
// ============================================

describe('commit — guards', () => {
  it('rejects fromAyId === targetAyId', async () => {
    const { service } = makeService();
    await expect(
      service.commit(SCHOOL, FROM_AY, FROM_AY, { decisions: [{ enrollmentId: 'e1', decision: 'retained' }] }, CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects oversized decisions[]', async () => {
    const { service } = makeService();
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      enrollmentId: `e${i}`,
      decision: 'retained' as const,
    }));
    await expect(
      service.commit(SCHOOL, FROM_AY, TARGET_AY, { decisions: tooMany }, CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ============================================
// Happy path — promoted decision
// ============================================

describe('commit — promoted decision', () => {
  it('writes BOTH Update (AY1) + Put (AY2 provisional) in transactWrite', async () => {
    const ay1 = makeAy1Enrollment();
    const { service, ddb, events } = makeService({ pre: [ay1] });

    const result = await service.commit(
      SCHOOL,
      FROM_AY,
      TARGET_AY,
      {
        decisions: [
          { enrollmentId: ay1.enrollmentId, decision: 'promoted', targetGradeLevel: '8' },
        ],
      },
      CTX,
    );

    expect(result.committedCount).toBe(1);
    expect(result.chunksSucceeded).toBe(1);

    const ops = ddb.transactWrite.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(ops).toHaveLength(2);
    // Op 1: Update AY1
    const updateOp = (ops[0] as { Update: { UpdateExpression: string; ConditionExpression: string; ExpressionAttributeValues: Record<string, unknown> } }).Update;
    expect(updateOp.ConditionExpression).toBe('attribute_not_exists(promotionDecision)');
    expect(updateOp.ExpressionAttributeValues[':decision']).toBe('promoted');
    // Op 2: Put AY2 provisional
    const putOp = (ops[1] as { Put: { Item: Enrollment; ConditionExpression: string } }).Put;
    expect(putOp.ConditionExpression).toBe('attribute_not_exists(entityKey)');
    expect(putOp.Item.status).toBe('provisional');
    expect(putOp.Item.priorEnrollmentId).toBe(ay1.enrollmentId);
    expect(putOp.Item.gradeLevel).toBe('8');
    expect(putOp.Item.gsi10pk).toBe(`prior-enrollment#${ay1.enrollmentId}`);
    expect(events.publishEnrollmentPromoted).toHaveBeenCalled();
  });
});

// ============================================
// retained / graduated / withdrawn
// ============================================

describe('commit — terminal decisions', () => {
  it('retained → only Update AY1, NO AY2 Put', async () => {
    const ay1 = makeAy1Enrollment();
    const { service, ddb } = makeService({ pre: [ay1] });

    await service.commit(
      SCHOOL,
      FROM_AY,
      TARGET_AY,
      { decisions: [{ enrollmentId: ay1.enrollmentId, decision: 'retained' }] },
      CTX,
    );

    const ops = ddb.transactWrite.mock.calls[0][1] as unknown[];
    expect(ops).toHaveLength(1); // only the Update; no AY2 Put
  });

  it('graduated → Update AY1 with status=graduated', async () => {
    const ay1 = makeAy1Enrollment();
    const { service, ddb } = makeService({ pre: [ay1] });

    await service.commit(
      SCHOOL,
      FROM_AY,
      TARGET_AY,
      { decisions: [{ enrollmentId: ay1.enrollmentId, decision: 'graduated' }] },
      CTX,
    );

    const ops = ddb.transactWrite.mock.calls[0][1] as Array<{
      Update: { ExpressionAttributeValues: Record<string, unknown> };
    }>;
    expect(ops).toHaveLength(1);
    expect(ops[0]!.Update.ExpressionAttributeValues[':newStatus']).toBe('graduated');
  });

  it('transferred_out → Update AY1 with status=transferred', async () => {
    const ay1 = makeAy1Enrollment();
    const { service, ddb } = makeService({ pre: [ay1] });

    await service.commit(
      SCHOOL,
      FROM_AY,
      TARGET_AY,
      { decisions: [{ enrollmentId: ay1.enrollmentId, decision: 'transferred_out' }] },
      CTX,
    );
    const ops = ddb.transactWrite.mock.calls[0][1] as Array<{
      Update: { ExpressionAttributeValues: Record<string, unknown> };
    }>;
    expect(ops[0]!.Update.ExpressionAttributeValues[':newStatus']).toBe('transferred');
  });
});

// ============================================
// Pre-read failure handling
// ============================================

describe('commit — pre-read failures', () => {
  it('missing source AY1 enrollment → failures[] populated, NOT in transactWrite chunk', async () => {
    const { service, ddb } = makeService({ pre: [] /* no pre-existing rows */ });

    const result = await service.commit(
      SCHOOL,
      FROM_AY,
      TARGET_AY,
      { decisions: [{ enrollmentId: 'missing-uuid', decision: 'retained' }] },
      CTX,
    );

    expect(result.committedCount).toBe(0);
    expect(result.failures).toEqual([
      { enrollmentId: 'missing-uuid', reason: 'source AY1 enrollment not found' },
    ]);
    expect(ddb.transactWrite).not.toHaveBeenCalled();
  });
});

// ============================================
// Chunk failure
// ============================================

describe('commit — chunk failure', () => {
  it('TransactionCanceledException on a chunk → every decision in chunk shows up in failures[]', async () => {
    const ay1a = makeAy1Enrollment({ enrollmentId: 'e1', studentId: 's1' });
    const ay1b = makeAy1Enrollment({ enrollmentId: 'e2', studentId: 's2' });
    const { service, ddb } = makeService({ pre: [ay1a, ay1b] });

    const tx = Object.assign(new Error('chunk canceled'), { name: 'TransactionCanceledException' });
    ddb.transactWrite.mockRejectedValueOnce(tx);

    const result = await service.commit(
      SCHOOL,
      FROM_AY,
      TARGET_AY,
      {
        decisions: [
          { enrollmentId: 'e1', decision: 'retained' },
          { enrollmentId: 'e2', decision: 'retained' },
        ],
      },
      CTX,
    );

    expect(result.committedCount).toBe(0);
    expect(result.chunksSucceeded).toBe(0);
    expect(result.failures).toHaveLength(2);
    expect(result.failures!.map((f) => f.enrollmentId).sort()).toEqual(['e1', 'e2']);
  });
});
