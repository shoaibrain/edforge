/**
 * EnrollmentTransitionHandlerService Spec — Sprint D.2.9
 *
 * Coverage:
 *   - Non-terminal events → early return, no DDB calls
 *   - Terminal events with provisional rows → flipService.promoteProvisionalToEnrolled invoked
 *   - Terminal events with NO provisional rows → no-op (returns null)
 *   - Idempotency: GSI10 query is the source of truth; re-fire = no-op
 *   - Errors INSIDE the handler are swallowed (never poison ResultCardsService.publish)
 *   - GSI10 query uses the correct partition key shape
 */

import { describe, expect, it, jest } from '@jest/globals';
import { EnrollmentTransitionHandlerService } from './enrollment-transition-handler.service';
import type { Enrollment } from '../common/entities/enrollment.entity';
import { enrollmentPriorGsi10pk } from '../common/entities/enrollment.entity';
import { EntityKeyBuilder } from '../common/entities/base.entity';

type AnyArgs = unknown[];

const TENANT = '11111111-1111-1111-1111-111111111111';
const SCHOOL = '22222222-2222-2222-2222-222222222222';
const AY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AY1_ENROLLMENT = 'ay1-enrollment-1';

function makeProvisional(): Enrollment {
  const studentId = 'student-1';
  const enrollmentId = 'ay2-enrollment-1';
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
    priorEnrollmentId: AY1_ENROLLMENT,
    createdAt: '2027-04-15T00:00:00Z',
    updatedAt: '2027-04-15T00:00:00Z',
    createdBy: 'user-1',
    updatedBy: 'user-1',
    version: 1,
    gsi1pk: `TENANT#${TENANT}#SCHOOL#${SCHOOL}`,
    gsi1sk: `ENROLLMENT#${AY}#8`,
    gsi2pk: studentId,
    gsi2sk: `ENROLLMENT#${AY}`,
    gsi10pk: `prior-enrollment#${AY1_ENROLLMENT}`,
    gsi10sk: `ENROLLMENT#${AY}#${enrollmentId}`,
  };
}

function makeMockDdb() {
  return {
    getSystemClient: jest.fn<() => unknown>().mockReturnValue({}),
    queryGSI: jest
      .fn<(...args: AnyArgs) => Promise<{ items: Enrollment[]; hasMore: boolean }>>()
      .mockResolvedValue({ items: [], hasMore: false }),
  };
}

function makeMockFlip() {
  return {
    promoteProvisionalToEnrolled: jest
      .fn<(...args: AnyArgs) => Promise<{ flipped: number; skipped: number; failures: unknown[] }>>()
      .mockResolvedValue({ flipped: 0, skipped: 0, failures: [] }),
  };
}

const baseNotification = {
  tenantId: TENANT,
  cardId: 'card-1',
  enrollmentId: AY1_ENROLLMENT,
  schoolId: SCHOOL,
  termId: 'term-1',
  examId: 'exam-final-1',
  isTerminal: true,
};

// ============================================
// Non-terminal early return
// ============================================

describe('handleResultPublished — non-terminal events', () => {
  it('returns null without any DDB call when isTerminal=false', async () => {
    const ddb = makeMockDdb();
    const flip = makeMockFlip();
    const svc = new EnrollmentTransitionHandlerService(ddb as never, flip as never);

    const result = await svc.handleResultPublished({ ...baseNotification, isTerminal: false });

    expect(result).toBeNull();
    expect(ddb.queryGSI).not.toHaveBeenCalled();
    expect(flip.promoteProvisionalToEnrolled).not.toHaveBeenCalled();
  });
});

// ============================================
// Terminal — happy path
// ============================================

describe('handleResultPublished — terminal events', () => {
  it('queries GSI10 by prior-enrollment#{enrollmentId} and forwards to flip service', async () => {
    const ddb = makeMockDdb();
    const flip = makeMockFlip();
    const svc = new EnrollmentTransitionHandlerService(ddb as never, flip as never);

    const provisional = makeProvisional();
    ddb.queryGSI.mockResolvedValueOnce({ items: [provisional], hasMore: false });
    flip.promoteProvisionalToEnrolled.mockResolvedValueOnce({
      flipped: 1, skipped: 0, failures: [],
    });

    const result = await svc.handleResultPublished(baseNotification);

    expect(ddb.queryGSI).toHaveBeenCalledWith(
      expect.anything(),
      'GSI10',
      enrollmentPriorGsi10pk(AY1_ENROLLMENT),
      'ENROLLMENT#',
      'begins_with',
      '#status = :provisional',
      { ':provisional': 'provisional' },
      { '#status': 'status' },
      100,
    );
    expect(flip.promoteProvisionalToEnrolled).toHaveBeenCalledWith(
      [provisional],
      expect.objectContaining({
        tenantId: TENANT,
        triggeringCardId: 'card-1',
        userId: 'system:enrollment-transition-handler',
      }),
    );
    expect(result?.flipped).toBe(1);
  });

  it('terminal event with NO provisional rows in GSI10 → returns null, no flip call', async () => {
    const ddb = makeMockDdb();
    const flip = makeMockFlip();
    const svc = new EnrollmentTransitionHandlerService(ddb as never, flip as never);

    // GSI10 query returns empty (no AY2 provisional rows ever created)
    ddb.queryGSI.mockResolvedValueOnce({ items: [], hasMore: false });

    const result = await svc.handleResultPublished(baseNotification);

    expect(result).toBeNull();
    expect(flip.promoteProvisionalToEnrolled).not.toHaveBeenCalled();
  });
});

// ============================================
// Error containment
// ============================================

describe('handleResultPublished — error containment', () => {
  it('GSI10 query failure → returns null + DOES NOT throw (must not poison ResultCardsService.publish)', async () => {
    const ddb = makeMockDdb();
    const flip = makeMockFlip();
    const svc = new EnrollmentTransitionHandlerService(ddb as never, flip as never);

    ddb.queryGSI.mockRejectedValueOnce(new Error('DDB throttled'));

    await expect(
      svc.handleResultPublished(baseNotification),
    ).resolves.toBeNull();
    expect(flip.promoteProvisionalToEnrolled).not.toHaveBeenCalled();
  });

  it('Flip service throw → returns null + DOES NOT throw', async () => {
    const ddb = makeMockDdb();
    const flip = makeMockFlip();
    const svc = new EnrollmentTransitionHandlerService(ddb as never, flip as never);

    ddb.queryGSI.mockResolvedValueOnce({ items: [makeProvisional()], hasMore: false });
    flip.promoteProvisionalToEnrolled.mockRejectedValueOnce(new Error('flip exploded'));

    await expect(
      svc.handleResultPublished(baseNotification),
    ).resolves.toBeNull();
  });
});
