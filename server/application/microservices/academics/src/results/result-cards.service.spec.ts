/**
 * ResultCardsService Spec — Sprint A.4.4 + A.4.5
 *
 * Covers:
 *   - GET single + LIST filter routing (GSI3 by exam vs GSI2 by enrollment vs GSI1 by school)
 *   - PATCH conduct / remark: happy path + RESULT_LOCKED on published
 *   - PATCH publish: draft → published + isTerminal pass-through to event
 *   - Re-publish → 409 RESULT_ALREADY_PUBLISHED (NOT 200 no-op)
 *   - 404 ENROLLMENT_ID_REQUIRED behavior at controller layer is covered there
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { ResultCardsService } from './result-cards.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { ResultCard } from '../common/entities/result-card.entity';
import type { ResultCardCourseScore } from '../common/entities/result-card.entity';
import { RequestContext } from '../common/entities/base.entity';

const mockDynamo = {
  getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
  getItem: jest.fn(),
  putItem: jest.fn(),
  queryGSI: jest.fn(),
};

const mockEvents = {
  publishResultCardUpdated: jest.fn().mockResolvedValue(undefined),
  publishResultPublished: jest.fn().mockResolvedValue(undefined),
};

function buildCard(overrides: Partial<ResultCard> = {}): ResultCard {
  const courseScores: ResultCardCourseScore[] = [
    {
      courseId: 'c-1',
      examCourseId: 'ec-1',
      academicSubject: 'mathematics',
      rawScore: 85,
      maxMarks: 100,
      grade: 'A',
      gpa: 3.6,
      isPassing: true,
    },
  ];
  return {
    tenantId: 'tenant-1',
    entityKey: 'RESULT_CARD#enroll-1#card-1',
    entityType: 'RESULT_CARD',
    cardId: 'card-1',
    enrollmentId: 'enroll-1',
    examId: 'exam-1',
    termId: 'term-1',
    academicYearId: 'ay-1',
    schoolId: 'school-1',
    studentId: 'student-real-1',
    courseScores,
    totalScore: 85,
    totalMaxMarks: 100,
    termGpa: 3.6,
    overallGrade: 'A',
    classRank: null,
    sectionRank: null,
    conduct: null,
    classTeacherRemark: null,
    status: 'draft',
    publishedAt: null,
    publishedBy: null,
    isTerminalExam: false,
    isActive: true,
    gsi1pk: 'tenant#tenant-1#school#school-1',
    gsi1sk: 'result-card#ay-1#term-1#exam-1#enroll-1',
    gsi2pk: 'enrollment#enroll-1',
    gsi2sk: 'result-card#ay-1#term-1#exam-1',
    gsi3pk: 'exam#exam-1',
    gsi3sk: 'result-card#enroll-1',
    createdAt: '2026-06-01T00:00:00.000Z',
    createdBy: 'lambda',
    updatedAt: '2026-06-01T00:00:00.000Z',
    updatedBy: 'lambda',
    version: 1,
    ...overrides,
  };
}

const ctx: RequestContext = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  email: 'u@example.com',
  role: 'teacher',
  jwtToken: 'jwt',
};

describe('ResultCardsService', () => {
  let service: ResultCardsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ResultCardsService,
        { provide: DynamoDBClientService, useValue: mockDynamo },
        { provide: AcademicsEventsService, useValue: mockEvents },
      ],
    }).compile();
    service = moduleRef.get(ResultCardsService);
  });

  // ============================================
  // GET single
  // ============================================

  describe('getResultCard', () => {
    it('returns the card DTO when found and active', async () => {
      mockDynamo.getItem.mockResolvedValue(buildCard());
      const result = await service.getResultCard('card-1', 'enroll-1', ctx);
      expect(result.cardId).toBe('card-1');
      expect(result.studentId).toBe('student-real-1');
      // R42: must NOT be 'unknown'
      expect(result.studentId).not.toBe('unknown');
    });

    it('throws 404 RESULT_CARD_NOT_FOUND when missing', async () => {
      mockDynamo.getItem.mockResolvedValue(null);
      await expect(service.getResultCard('card-x', 'enroll-x', ctx)).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when isActive=false (soft-deleted)', async () => {
      mockDynamo.getItem.mockResolvedValue(buildCard({ isActive: false }));
      await expect(service.getResultCard('card-1', 'enroll-1', ctx)).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================
  // LIST filter routing
  // ============================================

  describe('listResultCards filter routing', () => {
    beforeEach(() => {
      mockDynamo.queryGSI.mockResolvedValue({ items: [], lastEvaluatedKey: undefined, hasMore: false });
    });

    it('routes examId-filter via GSI3', async () => {
      await service.listResultCards({ examId: 'exam-1' } as any, ctx);
      expect(mockDynamo.queryGSI).toHaveBeenCalledWith(
        expect.anything(),
        'GSI3',
        'exam#exam-1',
        'result-card#',
        'begins_with',
        undefined,
        undefined,
        undefined,
        50,
        true,
        undefined,
      );
    });

    it('routes enrollmentId-only filter via GSI2', async () => {
      await service.listResultCards({ enrollmentId: 'enroll-1' } as any, ctx);
      expect(mockDynamo.queryGSI).toHaveBeenCalledWith(
        expect.anything(),
        'GSI2',
        'enrollment#enroll-1',
        'result-card#',
        'begins_with',
        undefined,
        undefined,
        undefined,
        50,
        true,
        undefined,
      );
    });

    it('routes schoolId-only filter via GSI1', async () => {
      await service.listResultCards({ schoolId: 'school-1' } as any, ctx);
      expect(mockDynamo.queryGSI).toHaveBeenCalledWith(
        expect.anything(),
        'GSI1',
        'tenant#tenant-1#school#school-1',
        'result-card#',
        'begins_with',
        'schoolId = :schoolId',
        { ':schoolId': 'school-1' },
        undefined,
        50,
        true,
        undefined,
      );
    });

    it('rejects when no schoolId/examId/enrollmentId is provided', async () => {
      await expect(service.listResultCards({} as any, ctx)).rejects.toThrow(BadRequestException);
    });

    it('combines secondary filters into FilterExpression', async () => {
      await service.listResultCards(
        {
          examId: 'exam-1',
          status: 'published',
          isTerminalExam: true,
        } as any,
        ctx,
      );
      const call = mockDynamo.queryGSI.mock.calls[0];
      expect(call[5]).toMatch(/#status = :status/);
      expect(call[5]).toMatch(/isTerminalExam = :isTerminalExam/);
      expect(call[6]).toMatchObject({ ':status': 'published', ':isTerminalExam': true });
    });

    it('filters out soft-deleted (isActive=false) results from response', async () => {
      mockDynamo.queryGSI.mockResolvedValue({
        items: [buildCard({ cardId: 'a', isActive: true }), buildCard({ cardId: 'b', isActive: false })],
        hasMore: false,
      });
      const out = await service.listResultCards({ examId: 'exam-1' } as any, ctx);
      expect(out.items.map((c) => c.cardId)).toEqual(['a']);
    });
  });

  // ============================================
  // PATCH conduct
  // ============================================

  describe('updateConduct', () => {
    it('updates conduct + audits + emits event', async () => {
      mockDynamo.getItem.mockResolvedValue(buildCard());
      mockDynamo.putItem.mockResolvedValue(undefined);

      const result = await service.updateConduct(
        'card-1',
        'enroll-1',
        { conduct: 'Excellent' },
        ctx,
      );

      expect(result.conduct).toBe('Excellent');
      expect(mockDynamo.putItem).toHaveBeenCalled();
      expect(mockEvents.publishResultCardUpdated).toHaveBeenCalledWith(
        'tenant-1',
        'card-1',
        'enroll-1',
        'school-1',
        'exam-1',
        ['conduct'],
      );
    });

    it('rejects 409 RESULT_LOCKED on published card', async () => {
      mockDynamo.getItem.mockResolvedValue(buildCard({ status: 'published' }));
      await expect(
        service.updateConduct('card-1', 'enroll-1', { conduct: 'X' }, ctx),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects 404 on missing card', async () => {
      mockDynamo.getItem.mockResolvedValue(null);
      await expect(
        service.updateConduct('card-x', 'enroll-x', { conduct: 'X' }, ctx),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================
  // PATCH remark
  // ============================================

  describe('updateRemark', () => {
    it('updates remark + audits + emits event', async () => {
      mockDynamo.getItem.mockResolvedValue(buildCard());
      mockDynamo.putItem.mockResolvedValue(undefined);

      const result = await service.updateRemark(
        'card-1',
        'enroll-1',
        { classTeacherRemark: 'Great improvement' },
        ctx,
      );

      expect(result.classTeacherRemark).toBe('Great improvement');
      expect(mockEvents.publishResultCardUpdated).toHaveBeenCalledWith(
        'tenant-1',
        'card-1',
        'enroll-1',
        'school-1',
        'exam-1',
        ['classTeacherRemark'],
      );
    });

    it('rejects 409 RESULT_LOCKED on published card', async () => {
      mockDynamo.getItem.mockResolvedValue(buildCard({ status: 'published' }));
      await expect(
        service.updateRemark('card-1', 'enroll-1', { classTeacherRemark: 'X' }, ctx),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ============================================
  // PATCH publish (state machine)
  // ============================================

  describe('publishResultCard', () => {
    it('flips draft → published + sets publishedAt/By + emits result.published', async () => {
      mockDynamo.getItem.mockResolvedValue(buildCard({ status: 'draft' }));
      mockDynamo.putItem.mockResolvedValue(undefined);

      const result = await service.publishResultCard('card-1', 'enroll-1', {}, ctx);

      expect(result.status).toBe('published');
      expect(result.publishedAt).toBeDefined();
      expect(result.publishedBy).toBe('user-1');
      expect(mockEvents.publishResultPublished).toHaveBeenCalledWith(
        'tenant-1',
        'card-1',
        'enroll-1',
        'school-1',
        'term-1',
        'exam-1',
        false,                                  // isTerminalExam from entity
        expect.any(String),                     // publishedAt timestamp
        undefined,                              // notes (absent)
      );
    });

    it('forwards isTerminalExam=true to event for C.9.5 cross-year handoff', async () => {
      mockDynamo.getItem.mockResolvedValue(buildCard({ status: 'draft', isTerminalExam: true }));
      mockDynamo.putItem.mockResolvedValue(undefined);

      await service.publishResultCard('card-1', 'enroll-1', {}, ctx);

      expect(mockEvents.publishResultPublished).toHaveBeenCalledWith(
        'tenant-1',
        'card-1',
        'enroll-1',
        'school-1',
        'term-1',
        'exam-1',
        true,                                   // <-- the assertion
        expect.any(String),
        undefined,
      );
    });

    it('forwards optional notes through to event audit trail', async () => {
      mockDynamo.getItem.mockResolvedValue(buildCard({ status: 'draft' }));
      mockDynamo.putItem.mockResolvedValue(undefined);

      await service.publishResultCard(
        'card-1',
        'enroll-1',
        { notes: 'Approved by principal' },
        ctx,
      );

      const call = mockEvents.publishResultPublished.mock.calls[0];
      expect(call[8]).toBe('Approved by principal');
    });

    it('rejects 409 RESULT_ALREADY_PUBLISHED on re-publish (NOT 200 no-op)', async () => {
      mockDynamo.getItem.mockResolvedValue(buildCard({ status: 'published' }));
      await expect(
        service.publishResultCard('card-1', 'enroll-1', {}, ctx),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects 404 on missing card', async () => {
      mockDynamo.getItem.mockResolvedValue(null);
      await expect(
        service.publishResultCard('card-x', 'enroll-x', {}, ctx),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
