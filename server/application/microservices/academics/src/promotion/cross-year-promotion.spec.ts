/**
 * Cross-Year Promotion Regression Spec — Sprint D.2 invariant-3 guard
 *
 * Phase 2 anchor for invariant 3 (cross-AY identity via `enrollmentId`).
 * The full D.2.10 atomic-flip spec lands in Phase 3 with the flip
 * service; this Phase 2 file locks in the entity-level + schema-level
 * guarantees that the flip relies on:
 *
 *   1. The new D.2.7 fields (`priorEnrollmentId`, `promotionDecision`)
 *      do NOT replace `enrollmentId` as the partition-stable identity.
 *   2. The mapper round-trips both fields without dropping or coercing.
 *   3. Two enrollments under the same studentId in two AYs carry
 *      DISTINCT enrollmentIds — and the AY2 row's `priorEnrollmentId`
 *      points back to the AY1 row's `enrollmentId`.
 *   4. The `provisional` status is reachable only via the D.2.6 commit
 *      path (state machine confirms via `enrollment-state-machine.spec.ts`).
 *
 * What this spec does NOT cover (Phase 3 scope):
 *   - D.2.10 atomic flip TransactWriteItems behavior
 *   - Attendance preservation under the retained-student enrollmentId
 *     across an in-place gradeLevel rewrite (lives in
 *     `enrollment-flip.service.spec.ts` Phase 3)
 *   - GSI4 (priorEnrollmentId-centric) query path (Phase 3 entity update)
 */

import { describe, expect, it } from '@jest/globals';
import {
  Enrollment,
  createEnrollmentEntity,
} from '../common/entities/enrollment.entity';
import { enrollmentEntityToDto } from '../common/mappers/enrollment.mapper';

const TENANT = '11111111-1111-1111-1111-111111111111';
const STUDENT = '22222222-2222-2222-2222-222222222222';
const SCHOOL = '33333333-3333-3333-3333-333333333333';
const AY1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const AY2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
const AY1_ENROLLMENT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const AY2_ENROLLMENT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';

const baseAudit = {
  createdAt: '2026-04-15T10:00:00.000Z',
  updatedAt: '2026-04-15T10:00:00.000Z',
  createdBy: 'user-uuid',
  updatedBy: 'user-uuid',
  version: 1,
};

function ay1Enrollment(): Enrollment {
  return createEnrollmentEntity(TENANT, AY1_ENROLLMENT, STUDENT, SCHOOL, AY1, {
    gradeLevel: '7',
    status: 'enrolled',
    entryDate: '2026-04-15',
    enrollmentDate: '2026-04-15',
    startDate: '2026-04-15',
    enrollmentType: 'returning',
    ...baseAudit,
  });
}

function ay2ProvisionalEnrollment(): Enrollment {
  return createEnrollmentEntity(TENANT, AY2_ENROLLMENT, STUDENT, SCHOOL, AY2, {
    gradeLevel: '8',
    status: 'provisional',
    entryDate: '2027-04-15',
    enrollmentDate: '2027-04-15',
    startDate: '2027-04-15',
    enrollmentType: 'returning',
    // D.2.7 cross-year handoff field
    priorEnrollmentId: AY1_ENROLLMENT,
    ...baseAudit,
  });
}

// ============================================
// Invariant 3 — enrollmentId is the entity key, not (studentId, ay)
// ============================================

describe('Invariant 3 — distinct enrollmentIds across AYs', () => {
  it('two enrollments same studentId in two AYs carry distinct enrollmentIds', () => {
    const ay1 = ay1Enrollment();
    const ay2 = ay2ProvisionalEnrollment();
    expect(ay1.studentId).toBe(ay2.studentId);
    expect(ay1.academicYearId).not.toBe(ay2.academicYearId);
    expect(ay1.enrollmentId).not.toBe(ay2.enrollmentId);
  });

  it('AY2 provisional row carries priorEnrollmentId pointing to AY1', () => {
    const ay2 = ay2ProvisionalEnrollment();
    expect(ay2.priorEnrollmentId).toBe(AY1_ENROLLMENT);
  });

  it('AY1 original row does NOT carry priorEnrollmentId (no upstream)', () => {
    const ay1 = ay1Enrollment();
    expect(ay1.priorEnrollmentId).toBeUndefined();
  });

  it('AY1 entityKey and AY2 entityKey are distinct (different DDB rows)', () => {
    const ay1 = ay1Enrollment();
    const ay2 = ay2ProvisionalEnrollment();
    expect(ay1.entityKey).not.toBe(ay2.entityKey);
  });

  it('AY1 enrollmentId is byte-stable through entity construction (no UUID rewrite)', () => {
    const ay1 = ay1Enrollment();
    expect(ay1.enrollmentId).toBe(AY1_ENROLLMENT);
  });
});

// ============================================
// D.2.7 field round-trip through mapper
// ============================================

describe('Mapper — D.2.7 field round-trip', () => {
  it('priorEnrollmentId surfaces on DTO when set', () => {
    const ay2 = ay2ProvisionalEnrollment();
    const dto = enrollmentEntityToDto(ay2);
    expect(dto.priorEnrollmentId).toBe(AY1_ENROLLMENT);
  });

  it('promotionDecision surfaces on DTO when set', () => {
    const ay1 = ay1Enrollment();
    const ay1Committed: Enrollment = {
      ...ay1,
      promotionDecision: 'promoted',
    };
    const dto = enrollmentEntityToDto(ay1Committed);
    expect(dto.promotionDecision).toBe('promoted');
  });

  it('both fields absent on legacy/uncommitted enrollment (no schema break)', () => {
    const ay1 = ay1Enrollment();
    const dto = enrollmentEntityToDto(ay1);
    expect(dto.priorEnrollmentId).toBeUndefined();
    expect(dto.promotionDecision).toBeUndefined();
  });
});

// ============================================
// AY1 row survives downstream provisional creation
// ============================================

describe('AY1 row stays untouched by AY2 provisional creation', () => {
  it('AY1 enrollmentId equals priorEnrollmentId on the AY2 row (chain integrity)', () => {
    const ay1 = ay1Enrollment();
    const ay2 = ay2ProvisionalEnrollment();
    expect(ay2.priorEnrollmentId).toBe(ay1.enrollmentId);
  });

  it('AY1 gradeLevel is independent of AY2 gradeLevel (grade advances on AY2)', () => {
    const ay1 = ay1Enrollment();
    const ay2 = ay2ProvisionalEnrollment();
    expect(ay1.gradeLevel).toBe('7');
    expect(ay2.gradeLevel).toBe('8');
  });

  it('AY1 GSI2 (student-centric) and AY2 GSI2 have distinct sort keys (different AY suffixes)', () => {
    const ay1 = ay1Enrollment();
    const ay2 = ay2ProvisionalEnrollment();
    expect(ay1.gsi2sk).not.toBe(ay2.gsi2sk);
    expect(ay1.gsi2pk).toBe(ay2.gsi2pk); // same studentId
  });
});
