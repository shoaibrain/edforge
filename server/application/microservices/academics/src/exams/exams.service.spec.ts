/**
 * ExamsService spec — GB2.5 getExamPattern + ELS.1 grade-level allowlist.
 *
 * Covers:
 *   - GB2.5 getExamPattern: archetype-driven examPattern + fallbacks
 *   - ELS.1 createExam: gradeLevels[] ⊆ school.enabledGradeLevels
 *
 * Uses the REAL getArchetypeDefaults('PABSON').examPattern.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ExamsService } from './exams.service';
import { examPatternKeySchema, getArchetypeDefaults } from '@aibrains/shared-types';
import { RequestContext } from '../common/entities/base.entity';

const ctx: RequestContext = {
  userId: 'user-uuid',
  tenantId: '11111111-1111-1111-1111-111111111111',
  email: 'op@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt',
};

function makeService(getArchetype: () => Promise<any>) {
  const reader = { getArchetype: jest.fn(getArchetype) } as any;
  return new ExamsService({} as any, {} as any, {} as any, reader);
}

const FULL_ENUM = [...examPatternKeySchema.options];

describe('ExamsService.getExamPattern (GB2.5)', () => {
  it('returns the PABSON examPattern for a PABSON tenant', async () => {
    const service = makeService(async () => 'PABSON');
    const result = await service.getExamPattern(ctx);
    expect(result.archetype).toBe('PABSON');
    expect(result.examPattern).toEqual(getArchetypeDefaults('PABSON').examPattern);
  });

  it('falls back to the full enum when the tenant has no archetype', async () => {
    const service = makeService(async () => undefined);
    const result = await service.getExamPattern(ctx);
    expect(result.archetype).toBeNull();
    expect(result.examPattern).toEqual(FULL_ENUM);
  });

  it('falls back to the full enum when the archetype is unknown (getArchetypeDefaults throws)', async () => {
    const service = makeService(async () => 'NOT_REAL');
    const result = await service.getExamPattern(ctx);
    expect(result.archetype).toBeNull();
    expect(result.examPattern).toEqual(FULL_ENUM);
  });

  it('falls back to the full enum when metadata lookup fails', async () => {
    const service = makeService(async () => {
      throw new Error('METADATA not found');
    });
    const result = await service.getExamPattern(ctx);
    expect(result.archetype).toBeNull();
    expect(result.examPattern).toEqual(FULL_ENUM);
  });
});

// ============================================================================
// ELS.1 — createExam gradeLevels[] ⊆ school.enabledGradeLevels
// ============================================================================

describe('ExamsService.createExam — ELS.1 grade-level allowlist', () => {
  const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
  const AY_ID = '22222222-2222-2222-2222-222222222222';
  const TERM_ID = '33333333-3333-3333-3333-333333333333';

  function makeCreateService(
    school: { enabledGradeLevels?: string[] } | null,
    options: { schoolFetchThrows?: any } = {},
  ) {
    const dynamoDBClient = {
      getClient: jest.fn(async () => ({}) as any),
      putItem: jest.fn(async () => undefined),
    } as any;
    const eventsService = {
      publishExamCreated: jest.fn(async () => undefined),
    } as any;
    const identityClient = {
      getSchool: jest.fn(async () => {
        if (options.schoolFetchThrows) throw options.schoolFetchThrows;
        if (!school) {
          const err: any = new Error('404 Not Found');
          err.response = { status: 404 };
          throw err;
        }
        return school;
      }),
      validateSchoolExists: jest.fn(async () => school !== null),
    } as any;
    const reader = {
      getArchetype: jest.fn(async () => 'PABSON'),
    } as any;
    return {
      service: new ExamsService(dynamoDBClient, eventsService, identityClient, reader),
      mocks: { dynamoDBClient, eventsService, identityClient, reader },
    };
  }

  const baseDto = {
    examName: 'First Term Exam · Grade 2',
    schoolId: SCHOOL_ID,
    academicYearId: AY_ID,
    termId: TERM_ID,
    examType: 'terminal' as const,
    gradeLevels: ['2'],
    startDate: '2026-06-01',
    endDate: '2026-06-15',
  };

  it('accepts when every entry in gradeLevels is in school.enabledGradeLevels', async () => {
    const { service, mocks } = makeCreateService({
      enabledGradeLevels: ['ECD', 'PPC', '1', '2', '3'],
    });
    const result = await service.createExam(baseDto, ctx);
    expect(result.examName).toBe('First Term Exam · Grade 2');
    expect(mocks.dynamoDBClient.putItem).toHaveBeenCalledTimes(1);
  });

  it('accepts a grade-split exam ["9","10"] when both are enabled', async () => {
    const { service } = makeCreateService({
      enabledGradeLevels: ['8', '9', '10'],
    });
    await expect(
      service.createExam({ ...baseDto, gradeLevels: ['9', '10'] }, ctx),
    ).resolves.toBeDefined();
  });

  it('rejects when any entry is missing from school.enabledGradeLevels', async () => {
    const { service } = makeCreateService({
      enabledGradeLevels: ['1', '2', '3'],
    });
    await expect(
      service.createExam({ ...baseDto, gradeLevels: ['2', '10'] }, ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('error payload names the offending grade and shows the allowed set', async () => {
    const { service } = makeCreateService({
      enabledGradeLevels: ['1', '2'],
    });
    try {
      await service.createExam({ ...baseDto, gradeLevels: ['7'] }, ctx);
      throw new Error('expected BadRequestException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(BadRequestException);
      const body = err.getResponse();
      expect(body.errorCode).toBe('EXAM_GRADE_LEVEL_NOT_ENABLED');
      expect(body.invalidGradeLevels).toEqual(['7']);
      expect(body.schoolEnabledGradeLevels).toEqual(['1', '2']);
    }
  });

  it('back-compat: when school has no enabledGradeLevels, allowlist check is skipped', async () => {
    const { service } = makeCreateService({ enabledGradeLevels: undefined });
    await expect(
      service.createExam({ ...baseDto, gradeLevels: ['anything'] }, ctx),
    ).resolves.toBeDefined();
  });

  it('throws NotFoundException when the school 404s', async () => {
    const { service } = makeCreateService(null);
    await expect(service.createExam(baseDto, ctx)).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ============================================================================
// Tombstone gate (A1) + active-only list default (A2) + GSI1SK recompute (S4)
// ============================================================================

const ACTIVE_EXAM = {
  examId: 'e1',
  schoolId: 's1',
  tenantId: ctx.tenantId,
  examName: 'Old Name',
  academicYearId: 'ay-1',
  termId: 'term-1',
  examType: 'final',
  startDate: '2026-01-01',
  endDate: '2026-06-01',
  status: 'draft',
  description: '',
  isActive: true,
  version: 3,
  createdAt: 'x',
  updatedAt: 'x',
  createdBy: 'u',
  updatedBy: 'u',
};
const TOMBSTONED_EXAM = { ...ACTIVE_EXAM, isActive: false };

function makeServiceWith(ddb: any, events: any = {}) {
  return new ExamsService(
    ddb,
    {
      publishExamUpdated: jest.fn(async () => undefined),
      publishExamStatusTransitioned: jest.fn(async () => undefined),
      ...events,
    } as any,
    {} as any,
    { getArchetype: jest.fn(async () => 'PABSON') } as any,
  );
}

describe('ExamsService tombstone gate (A1)', () => {
  it('updateExam rejects a soft-deleted exam with EXAM_TOMBSTONED and writes nothing', async () => {
    const updateItem = jest.fn();
    const service = makeServiceWith({
      getClient: jest.fn(async () => ({})),
      getItem: jest.fn(async () => TOMBSTONED_EXAM),
      updateItem,
    });
    const err: any = await service
      .updateExam('e1', 's1', { examName: 'New Name' } as any, ctx)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ errorCode: 'EXAM_TOMBSTONED' });
    expect(updateItem).not.toHaveBeenCalled();
  });

  it('transitionStatus rejects a soft-deleted exam with EXAM_TOMBSTONED and writes nothing', async () => {
    const updateItem = jest.fn();
    const service = makeServiceWith({
      getClient: jest.fn(async () => ({})),
      getItem: jest.fn(async () => TOMBSTONED_EXAM),
      updateItem,
    });
    const err: any = await service
      .transitionStatus('e1', 's1', { targetStatus: 'scheduled' } as any, ctx)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ errorCode: 'EXAM_TOMBSTONED' });
    expect(updateItem).not.toHaveBeenCalled();
  });
});

describe('ExamsService.listExams active-only default (A2)', () => {
  function captureListFilter(filters?: { isActive?: boolean }) {
    const queryGSI = jest.fn(async () => ({ items: [], lastEvaluatedKey: undefined, hasMore: false }));
    const service = makeServiceWith({ getClient: jest.fn(async () => ({})), queryGSI });
    return { queryGSI, run: () => service.listExams('s1', ctx, 50, undefined, filters) };
  }

  it('defaults to isActive=true when the caller does not specify it', async () => {
    const { queryGSI, run } = captureListFilter(undefined);
    await run();
    const [, , , , , filterExpr, exprValues] = queryGSI.mock.calls[0] as any[];
    expect(filterExpr).toContain('isActive = :isActive');
    expect(exprValues[':isActive']).toBe(true);
  });

  it('honors an explicit isActive=false (admin show-deleted view)', async () => {
    const { queryGSI, run } = captureListFilter({ isActive: false });
    await run();
    const [, , , , , , exprValues] = queryGSI.mock.calls[0] as any[];
    expect(exprValues[':isActive']).toBe(false);
  });
});

describe('ExamsService.updateExam GSI1SK recompute on rename (S4)', () => {
  it('recomputes gsi1sk from the new examName so list-by-name is not stale', async () => {
    const updateItem = jest.fn(async () => ACTIVE_EXAM);
    const service = makeServiceWith({
      getClient: jest.fn(async () => ({})),
      getItem: jest.fn(async () => ACTIVE_EXAM),
      updateItem,
    });
    await service.updateExam('e1', 's1', { examName: 'New Name' } as any, ctx);
    const [, , , updateExpr, exprValues] = updateItem.mock.calls[0] as any[];
    expect(updateExpr).toContain('gsi1sk = :gsi1sk');
    expect(exprValues[':gsi1sk']).toBe(
      `exam#${ACTIVE_EXAM.academicYearId}#${ACTIVE_EXAM.termId}#NEW NAME`,
    );
  });
});
