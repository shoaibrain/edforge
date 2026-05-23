/**
 * ExamCourse entity spec — Sprint A.3.3
 *
 * Coverage:
 *   - Factory shape + denormalization
 *   - entityKey + GSI keys (lowercase per S3.2)
 *   - GSI sort uses courseCode when present, falls back to courseId UUID
 *   - tenantId bare UUID
 */

import { createExamCourseEntity, ExamCourse } from './exam-course.entity';

describe('ExamCourse entity (A.3.3)', () => {
  const TID = '21aea5da-511f-4dfa-a6f2-6971f63a719f';
  const SID = '4209e3d8-d2e2-4e0e-9961-790341c264f4';
  const EID = '99999999-9999-9999-9999-999999999999';
  const ECID = '88888888-8888-8888-8888-888888888888';
  const CID = '77777777-7777-7777-7777-777777777777';

  function buildData(overrides: Partial<ExamCourse> = {}): Omit<ExamCourse, 'tenantId' | 'entityKey' | 'entityType' | 'examCourseId' | 'examId' | 'schoolId' | 'gsi1pk' | 'gsi1sk' | 'gsi2pk' | 'gsi2sk'> {
    return {
      courseId: CID,
      courseName: 'C. Mathematics',
      courseCode: 'NCF-MATH-G910',
      academicSubject: 'mathematics',
      maxMarks: 100,
      passingMarks: 40,
      createdAt: '2026-05-22T10:00:00.000Z',
      createdBy: 'admin-001',
      updatedAt: '2026-05-22T10:00:00.000Z',
      updatedBy: 'admin-001',
      version: 1,
      ...overrides,
    };
  }

  it('factory produces a fully-keyed entity', () => {
    const ec = createExamCourseEntity(TID, ECID, EID, SID, buildData());
    expect(ec.entityType).toBe('EXAM_COURSE');
    expect(ec.examCourseId).toBe(ECID);
    expect(ec.examId).toBe(EID);
    expect(ec.courseId).toBe(CID);
  });

  it('tenantId is bare UUID', () => {
    const ec = createExamCourseEntity(TID, ECID, EID, SID, buildData());
    expect(ec.tenantId).toBe(TID);
    expect(ec.tenantId.startsWith('TENANT#')).toBe(false);
  });

  it('entityKey uses uppercase EXAM_COURSE# prefix', () => {
    const ec = createExamCourseEntity(TID, ECID, EID, SID, buildData());
    expect(ec.entityKey).toBe(`EXAM_COURSE#${EID}#${ECID}`);
  });

  it('GSI1 keys are lowercase (S3.2 guard)', () => {
    const ec = createExamCourseEntity(TID, ECID, EID, SID, buildData());
    expect(ec.gsi1pk).toBe(`tenant#${TID}#school#${SID}`);
    expect(ec.gsi1pk).not.toMatch(/TENANT#/);
    expect(ec.gsi1pk).not.toMatch(/SCHOOL#/);
    expect(ec.gsi1sk).toBe(`exam-course#${EID}#NCF-MATH-G910`);
  });

  it('GSI2 keys are lowercase + exam-scoped', () => {
    const ec = createExamCourseEntity(TID, ECID, EID, SID, buildData());
    expect(ec.gsi2pk).toBe(`exam#${EID}`);
    expect(ec.gsi2sk).toBe(`course#NCF-MATH-G910`);
  });

  it('GSI sort falls back to courseId UUID when courseCode is absent', () => {
    const ec = createExamCourseEntity(TID, ECID, EID, SID, buildData({ courseCode: undefined }));
    expect(ec.gsi1sk).toBe(`exam-course#${EID}#${CID}`);
    expect(ec.gsi2sk).toBe(`course#${CID}`);
  });

  it('preserves denormalized Course descriptors (courseName, academicSubject)', () => {
    const ec = createExamCourseEntity(TID, ECID, EID, SID, buildData());
    expect(ec.courseName).toBe('C. Mathematics');
    expect(ec.academicSubject).toBe('mathematics');
    expect(ec.courseCode).toBe('NCF-MATH-G910');
  });

  it('preserves marks + optional creditHours', () => {
    const ec = createExamCourseEntity(TID, ECID, EID, SID, buildData({ creditHours: 1.5 }));
    expect(ec.maxMarks).toBe(100);
    expect(ec.passingMarks).toBe(40);
    expect(ec.creditHours).toBe(1.5);
  });
});
