/**
 * ExamsService — GB2.5 getExamPattern spec.
 *
 * Covers the setup-checklist read endpoint: returns the tenant archetype's
 * examPattern, and falls back to the full ExamPatternKey enum (permissive,
 * matching the create-path validation fallback) when the archetype can't be
 * resolved. Only TenantMetadataReader matters here; the other constructor deps
 * are inert mocks. Uses the REAL getArchetypeDefaults('PABSON').examPattern.
 */

import { describe, expect, it, jest } from '@jest/globals';
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
