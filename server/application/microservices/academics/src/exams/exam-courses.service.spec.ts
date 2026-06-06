/**
 * ExamCoursesService spec — ELS.2 grade-level overlap guard.
 *
 * Covers the new `addExamCourse` check that rejects attaching a Course
 * whose `gradeLevels[]` has no overlap with the parent Exam's `gradeLevels[]`.
 * Pre-ELS.1 legacy exams (no gradeLevels) and pre-curated courses (no
 * gradeLevels) skip the check — both degrade to the legacy "all-grades"
 * behavior so already-deployed data is unaffected.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { ExamCoursesService } from './exam-courses.service';
import { RequestContext } from '../common/entities/base.entity';
import type { Exam } from '../common/entities/exam.entity';
import type { Course } from '../common/entities/course.entity';

const ctx: RequestContext = {
  userId: 'user-uuid',
  tenantId: '11111111-1111-1111-1111-111111111111',
  email: 'op@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt',
};

const SCHOOL_ID = '22222222-2222-2222-2222-222222222222';
const EXAM_ID = '33333333-3333-3333-3333-333333333333';
const COURSE_ID = '44444444-4444-4444-4444-444444444444';

const baseDto = {
  schoolId: SCHOOL_ID,
  courseId: COURSE_ID,
  maxMarks: 100,
  passingMarks: 40,
};

function makeService(exam: Partial<Exam>, course: Partial<Course> | null) {
  const dynamoDBClient = {
    getClient: jest.fn(async () => ({}) as any),
    getItem: jest.fn(async (_client: any, _tid: string, entityKey: string) => {
      if (entityKey.startsWith('EXAM#')) {
        return exam ? ({ status: 'draft', schoolId: SCHOOL_ID, ...exam } as Exam) : null;
      }
      if (entityKey.startsWith('COURSE#')) {
        return course as Course | null;
      }
      return null;
    }),
    putItem: jest.fn(async () => undefined),
  } as any;
  const eventsService = {
    publishExamCourseAdded: jest.fn(async () => undefined),
  } as any;
  return new ExamCoursesService(dynamoDBClient, eventsService);
}

describe('ExamCoursesService.addExamCourse — ELS.2 grade-level overlap', () => {
  it('accepts a course whose gradeLevels overlap with exam.gradeLevels', async () => {
    const service = makeService(
      { gradeLevels: ['2'] },
      {
        courseId: COURSE_ID,
        courseName: 'Mathematics Grade 2',
        courseCode: 'MATH2',
        academicSubject: 'mathematics',
        gradeLevels: ['1', '2', '3'],
      } as Course,
    );
    await expect(service.addExamCourse(EXAM_ID, baseDto, ctx)).resolves.toBeDefined();
  });

  it('accepts a grade-split exam ["9","10"] paired with a multi-grade course', async () => {
    const service = makeService(
      { gradeLevels: ['9', '10'] },
      {
        courseId: COURSE_ID,
        courseName: 'Optional Mathematics G9/G10',
        courseCode: 'OPMATH910',
        academicSubject: 'optional_mathematics',
        gradeLevels: ['9', '10'],
      } as Course,
    );
    await expect(service.addExamCourse(EXAM_ID, baseDto, ctx)).resolves.toBeDefined();
  });

  it('rejects a Grade 8-only course on a Grade 2 exam (no overlap)', async () => {
    const service = makeService(
      { gradeLevels: ['2'] },
      {
        courseId: COURSE_ID,
        courseName: 'Algebra Grade 8',
        courseCode: 'ALG8',
        academicSubject: 'mathematics',
        gradeLevels: ['8'],
      } as Course,
    );
    await expect(service.addExamCourse(EXAM_ID, baseDto, ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('error payload uses EXAM_COURSE_GRADE_MISMATCH and surfaces both sets', async () => {
    const service = makeService(
      { gradeLevels: ['2'] },
      {
        courseId: COURSE_ID,
        courseName: 'Algebra Grade 8',
        courseCode: 'ALG8',
        academicSubject: 'mathematics',
        gradeLevels: ['8'],
      } as Course,
    );
    try {
      await service.addExamCourse(EXAM_ID, baseDto, ctx);
      throw new Error('expected BadRequestException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(BadRequestException);
      const body = err.getResponse();
      expect(body.errorCode).toBe('EXAM_COURSE_GRADE_MISMATCH');
      expect(body.courseGradeLevels).toEqual(['8']);
      expect(body.examGradeLevels).toEqual(['2']);
    }
  });

  it('back-compat: legacy exam without gradeLevels skips overlap check', async () => {
    const service = makeService(
      { gradeLevels: undefined },
      {
        courseId: COURSE_ID,
        courseName: 'Algebra Grade 8',
        courseCode: 'ALG8',
        academicSubject: 'mathematics',
        gradeLevels: ['8'],
      } as Course,
    );
    await expect(service.addExamCourse(EXAM_ID, baseDto, ctx)).resolves.toBeDefined();
  });

  it('back-compat: course without gradeLevels skips overlap check', async () => {
    const service = makeService(
      { gradeLevels: ['2'] },
      {
        courseId: COURSE_ID,
        courseName: 'Legacy Course',
        courseCode: 'LEG',
        academicSubject: 'mathematics',
        gradeLevels: [],
      } as unknown as Course,
    );
    await expect(service.addExamCourse(EXAM_ID, baseDto, ctx)).resolves.toBeDefined();
  });
});
