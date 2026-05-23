/**
 * ExamCourse schema spec — Sprint A.3.3 + A.3.6
 *
 * Coverage:
 *   - createExamCourseSchema positives + negatives
 *   - passingMarks ≤ maxMarks refinement
 *   - PABSON_DEFAULT_PASSING_MARKS = 32
 *   - update / response / filter shapes
 */

import {
  createExamCourseSchema,
  updateExamCourseSchema,
  examCourseResponseSchema,
  examCourseFilterSchema,
  PABSON_DEFAULT_PASSING_MARKS,
} from './exam-course.schema';

describe('ExamCourse schemas (A.3.3 + A.3.6)', () => {
  // ============================================
  // Constants
  // ============================================
  it('PABSON_DEFAULT_PASSING_MARKS is 32 (CDC standard, master plan A.3.3)', () => {
    expect(PABSON_DEFAULT_PASSING_MARKS).toBe(32);
  });

  // ============================================
  // createExamCourseSchema
  // ============================================
  describe('createExamCourseSchema', () => {
    const validBase = {
      schoolId: '11111111-1111-1111-1111-111111111111',
      courseId: '22222222-2222-2222-2222-222222222222',
      maxMarks: 100,
      passingMarks: 40,
    };

    it('accepts a valid create payload', () => {
      const r = createExamCourseSchema.safeParse(validBase);
      expect(r.success).toBe(true);
    });

    it('defaults passingMarks to 32 (PABSON CDC) when not supplied', () => {
      const r = createExamCourseSchema.safeParse({
        schoolId: validBase.schoolId,
        courseId: validBase.courseId,
        maxMarks: 100,
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.passingMarks).toBe(PABSON_DEFAULT_PASSING_MARKS);
      }
    });

    it('rejects passingMarks > maxMarks', () => {
      const r = createExamCourseSchema.safeParse({
        ...validBase,
        maxMarks: 50,
        passingMarks: 60,
      });
      expect(r.success).toBe(false);
    });

    it('accepts passingMarks === maxMarks (edge: only perfect passes)', () => {
      const r = createExamCourseSchema.safeParse({
        ...validBase,
        maxMarks: 100,
        passingMarks: 100,
      });
      expect(r.success).toBe(true);
    });

    it('accepts passingMarks === 0 (edge: pass-through grading)', () => {
      const r = createExamCourseSchema.safeParse({
        ...validBase,
        maxMarks: 100,
        passingMarks: 0,
      });
      expect(r.success).toBe(true);
    });

    it('rejects maxMarks <= 0', () => {
      expect(
        createExamCourseSchema.safeParse({ ...validBase, maxMarks: 0 }).success,
      ).toBe(false);
      expect(
        createExamCourseSchema.safeParse({ ...validBase, maxMarks: -5 }).success,
      ).toBe(false);
    });

    it('rejects maxMarks > 1000', () => {
      const r = createExamCourseSchema.safeParse({ ...validBase, maxMarks: 1001 });
      expect(r.success).toBe(false);
    });

    it('rejects non-integer marks', () => {
      const r = createExamCourseSchema.safeParse({
        ...validBase,
        maxMarks: 100,
        passingMarks: 32.5,
      });
      expect(r.success).toBe(false);
    });

    it('rejects non-UUID courseId / schoolId', () => {
      expect(
        createExamCourseSchema.safeParse({ ...validBase, courseId: 'bad' }).success,
      ).toBe(false);
      expect(
        createExamCourseSchema.safeParse({ ...validBase, schoolId: 'bad' }).success,
      ).toBe(false);
    });

    it('accepts optional creditHours', () => {
      const r = createExamCourseSchema.safeParse({ ...validBase, creditHours: 1.5 });
      expect(r.success).toBe(true);
    });
  });

  // ============================================
  // updateExamCourseSchema
  // ============================================
  describe('updateExamCourseSchema', () => {
    it('accepts partial update with maxMarks only', () => {
      const r = updateExamCourseSchema.safeParse({ maxMarks: 80 });
      expect(r.success).toBe(true);
    });

    it('accepts empty update', () => {
      const r = updateExamCourseSchema.safeParse({});
      expect(r.success).toBe(true);
    });

    // Note: passingMarks ≤ maxMarks invariant on update is enforced
    // server-side (needs to read existing entity to compare). Schema
    // alone allows passingMarks-only PATCH; service combines and refines.
    it('accepts passingMarks-only update (service combines with existing maxMarks)', () => {
      const r = updateExamCourseSchema.safeParse({ passingMarks: 50 });
      expect(r.success).toBe(true);
    });
  });

  // ============================================
  // examCourseResponseSchema (smoke — shape only)
  // ============================================
  describe('examCourseResponseSchema', () => {
    it('accepts a full response with denormalized fields', () => {
      const r = examCourseResponseSchema.safeParse({
        examCourseId: '99999999-9999-9999-9999-999999999999',
        examId: '88888888-8888-8888-8888-888888888888',
        schoolId: '11111111-1111-1111-1111-111111111111',
        tenantId: 'tenant-001',
        courseId: '22222222-2222-2222-2222-222222222222',
        courseName: 'C. Mathematics',
        courseCode: 'NCF-MATH-G910',
        academicSubject: 'mathematics',
        maxMarks: 100,
        passingMarks: 40,
        version: 1,
        createdAt: '2026-05-22T10:00:00.000Z',
        updatedAt: '2026-05-22T10:00:00.000Z',
      });
      expect(r.success).toBe(true);
    });

    it('accepts response without optional denormalized fields (back-compat)', () => {
      const r = examCourseResponseSchema.safeParse({
        examCourseId: '99999999-9999-9999-9999-999999999999',
        examId: '88888888-8888-8888-8888-888888888888',
        schoolId: '11111111-1111-1111-1111-111111111111',
        tenantId: 'tenant-001',
        courseId: '22222222-2222-2222-2222-222222222222',
        maxMarks: 100,
        passingMarks: 40,
        version: 1,
        createdAt: '2026-05-22T10:00:00.000Z',
        updatedAt: '2026-05-22T10:00:00.000Z',
      });
      expect(r.success).toBe(true);
    });

    it('rejects invalid academicSubject in response', () => {
      const r = examCourseResponseSchema.safeParse({
        examCourseId: '99999999-9999-9999-9999-999999999999',
        examId: '88888888-8888-8888-8888-888888888888',
        schoolId: '11111111-1111-1111-1111-111111111111',
        tenantId: 'tenant-001',
        courseId: '22222222-2222-2222-2222-222222222222',
        academicSubject: 'not_a_descriptor',
        maxMarks: 100,
        passingMarks: 40,
        version: 1,
        createdAt: '2026-05-22T10:00:00.000Z',
        updatedAt: '2026-05-22T10:00:00.000Z',
      });
      expect(r.success).toBe(false);
    });
  });

  // ============================================
  // examCourseFilterSchema
  // ============================================
  describe('examCourseFilterSchema', () => {
    it('accepts empty filter', () => {
      const r = examCourseFilterSchema.safeParse({});
      expect(r.success).toBe(true);
    });

    it('accepts filter by academicSubject (A.2 descriptor)', () => {
      const r = examCourseFilterSchema.safeParse({ academicSubject: 'mathematics' });
      expect(r.success).toBe(true);
    });
  });
});
