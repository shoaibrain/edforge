/**
 * PromotionRulesService Spec — Sprint D.2.1 + D.2.2 + D.2.3
 *
 * Focus areas:
 *   - CRUD basics: create / get / list / update / soft-delete
 *   - D.2.3 lazy-seed kicks in only on empty list with gradeLevel
 *   - Uniqueness: 409 on duplicate active rule for (schoolId, gradeLevel)
 *   - archetypeDefaulted flag flips false on first PATCH (D.2.2 AC)
 *   - 404 on missing rule
 *   - Race-on-seed: ConditionalCheckFailedException → re-read, return winner
 *
 * DDB client + events service are mocked. TenantMetadataReader is mocked
 * by patching the lazy getter on the service instance (so we don't need
 * real AWS creds in unit tests).
 */

import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PromotionRulesService } from './promotion-rules.service';
import type { PromotionRuleEntity } from '../common/entities/promotion-rule.entity';
import { promotionRuleSchoolGsi1pk } from '../common/entities/promotion-rule.entity';
import { EntityKeyBuilder, RequestContext } from '../common/entities/base.entity';
import { TenantMetadataNotFoundError } from '../common/services/tenant-metadata-reader.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const SCHOOL = '22222222-2222-2222-2222-222222222222';
const USER = 'user-uuid';

const ctx: RequestContext = {
  userId: USER,
  tenantId: TENANT,
  email: 'op@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt',
};

function makeEntity(overrides: Partial<PromotionRuleEntity> = {}): PromotionRuleEntity {
  const ruleId = overrides.ruleId ?? 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr';
  return {
    tenantId: TENANT,
    entityKey: EntityKeyBuilder.promotionRule(SCHOOL, ruleId),
    entityType: 'PROMOTION_RULE',
    ruleId,
    schoolId: SCHOOL,
    gradeLevel: '7',
    archetypeId: 'PABSON',
    passingThresholdPct: 35,
    minAttendancePct: 80,
    subjectsRequired: [],
    archetypeDefaulted: true,
    isActive: true,
    createdAt: '2026-05-23T10:00:00.000Z',
    updatedAt: '2026-05-23T10:00:00.000Z',
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    gsi1pk: promotionRuleSchoolGsi1pk(TENANT, SCHOOL),
    gsi1sk: `promotion-rule#7#${ruleId}`,
    ...overrides,
  };
}

// Jest mock typings: single function-signature generic per @types/jest 29.x.
type AnyArgs = unknown[];
type QueryResult = { items: PromotionRuleEntity[]; hasMore: boolean };

interface MockDdb {
  getClient: jest.Mock<(...args: AnyArgs) => Promise<unknown>>;
  putItem: jest.Mock<(...args: AnyArgs) => Promise<void>>;
  getItem: jest.Mock<(...args: AnyArgs) => Promise<PromotionRuleEntity | null>>;
  queryGSI: jest.Mock<(...args: AnyArgs) => Promise<QueryResult>>;
  updateItem: jest.Mock<(...args: AnyArgs) => Promise<PromotionRuleEntity>>;
}

function makeMockDdb(): MockDdb {
  return {
    getClient: jest
      .fn<(...args: AnyArgs) => Promise<unknown>>()
      .mockResolvedValue({}),
    putItem: jest
      .fn<(...args: AnyArgs) => Promise<void>>()
      .mockResolvedValue(undefined),
    getItem: jest
      .fn<(...args: AnyArgs) => Promise<PromotionRuleEntity | null>>()
      .mockResolvedValue(null),
    queryGSI: jest
      .fn<(...args: AnyArgs) => Promise<QueryResult>>()
      .mockResolvedValue({ items: [], hasMore: false }),
    updateItem: jest.fn<(...args: AnyArgs) => Promise<PromotionRuleEntity>>(),
  };
}

interface MockEvents {
  publishPromotionRuleCreated: jest.Mock<(...args: AnyArgs) => Promise<void>>;
  publishPromotionRuleUpdated: jest.Mock<(...args: AnyArgs) => Promise<void>>;
}

function makeMockEvents(): MockEvents {
  return {
    publishPromotionRuleCreated: jest
      .fn<(...args: AnyArgs) => Promise<void>>()
      .mockResolvedValue(undefined),
    publishPromotionRuleUpdated: jest
      .fn<(...args: AnyArgs) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
}

function makeService(): {
  service: PromotionRulesService;
  ddb: MockDdb;
  events: MockEvents;
  mockArchetype: (archetype: string | TenantMetadataNotFoundError) => void;
} {
  const ddb = makeMockDdb();
  const events = makeMockEvents();
  const service = new PromotionRulesService(ddb as never, events as never);

  function mockArchetype(archetype: string | TenantMetadataNotFoundError): void {
    const reader = {
      getTenantMetadata: jest.fn().mockImplementation(async () => {
        if (archetype instanceof TenantMetadataNotFoundError) throw archetype;
        return { archetype };
      }),
    };
    // Force the lazy getter to return our mock.
    (service as unknown as { _tenantMetadataReader: typeof reader })._tenantMetadataReader = reader;
  }
  // Default: PABSON archetype.
  mockArchetype('PABSON');

  return { service, ddb, events, mockArchetype };
}

// ============================================
// createPromotionRule
// ============================================

describe('createPromotionRule', () => {
  it('creates a PromotionRule and publishes PromotionRuleCreated', async () => {
    const { service, ddb, events } = makeService();
    const dto = {
      schoolId: SCHOOL,
      gradeLevel: '7',
      archetypeId: 'PABSON',
      passingThresholdPct: 35,
      minAttendancePct: 80,
    };

    const result = await service.createPromotionRule(dto, ctx);

    expect(ddb.putItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: 'PROMOTION_RULE',
        schoolId: SCHOOL,
        gradeLevel: '7',
        passingThresholdPct: 35,
        minAttendancePct: 80,
        archetypeDefaulted: false, // operator-create path
        isActive: true,
      }),
      'attribute_not_exists(entityKey)',
    );
    expect(events.publishPromotionRuleCreated).toHaveBeenCalled();
    expect(result.archetypeDefaulted).toBe(false);
    expect(result.schoolId).toBe(SCHOOL);
  });

  it('rejects with 409 if an active rule already exists for (schoolId, gradeLevel)', async () => {
    const { service, ddb } = makeService();
    ddb.queryGSI.mockResolvedValueOnce({
      items: [makeEntity({ ruleId: 'existing-rule' })],
      hasMore: false,
    });

    await expect(
      service.createPromotionRule(
        {
          schoolId: SCHOOL,
          gradeLevel: '7',
          archetypeId: 'PABSON',
          passingThresholdPct: 35,
          minAttendancePct: 80,
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

// ============================================
// getPromotionRule
// ============================================

describe('getPromotionRule', () => {
  it('returns the entity when found', async () => {
    const { service, ddb } = makeService();
    ddb.getItem.mockResolvedValueOnce(makeEntity());

    const result = await service.getPromotionRule('rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr', SCHOOL, ctx);
    expect(result.ruleId).toBe('rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr');
  });

  it('throws 404 when missing', async () => {
    const { service, ddb } = makeService();
    ddb.getItem.mockResolvedValueOnce(null);

    await expect(
      service.getPromotionRule('rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr', SCHOOL, ctx),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ============================================
// listPromotionRules + D.2.3 lazy-seed
// ============================================

describe('listPromotionRules', () => {
  it('returns existing rules without seeding when result is non-empty', async () => {
    const { service, ddb } = makeService();
    ddb.queryGSI.mockResolvedValueOnce({
      items: [makeEntity()],
      hasMore: false,
    });

    const result = await service.listPromotionRules({ schoolId: SCHOOL, gradeLevel: '7' }, ctx);
    expect(result).toHaveLength(1);
    expect(ddb.putItem).not.toHaveBeenCalled();
  });

  it('lazy-seeds when (schoolId, gradeLevel) is empty (D.2.3)', async () => {
    const { service, ddb, events } = makeService();
    // First query returns empty (no existing rule); second is the
    // findActiveRule probe inside ensureDefaultRule which also returns
    // empty (no race). Then put succeeds.
    ddb.queryGSI.mockResolvedValue({ items: [], hasMore: false });

    const result = await service.listPromotionRules({ schoolId: SCHOOL, gradeLevel: '7' }, ctx);

    expect(result).toHaveLength(1);
    expect(result[0].archetypeDefaulted).toBe(true);
    expect(result[0].archetypeId).toBe('PABSON');
    expect(result[0].passingThresholdPct).toBe(35);
    expect(result[0].minAttendancePct).toBe(80);
    expect(ddb.putItem).toHaveBeenCalledTimes(1);
    expect(events.publishPromotionRuleCreated).toHaveBeenCalled();
  });

  it('lazy-seed falls back to GENERIC (60/90) when METADATA is missing', async () => {
    const { service, ddb, mockArchetype } = makeService();
    mockArchetype(new TenantMetadataNotFoundError('not found'));
    ddb.queryGSI.mockResolvedValue({ items: [], hasMore: false });

    const result = await service.listPromotionRules({ schoolId: SCHOOL, gradeLevel: '5' }, ctx);

    expect(result).toHaveLength(1);
    expect(result[0].archetypeId).toBe('GENERIC');
    expect(result[0].passingThresholdPct).toBe(60);
    expect(result[0].minAttendancePct).toBe(90);
    expect(result[0].archetypeDefaulted).toBe(true);
  });

  it('does NOT lazy-seed when gradeLevel is absent (LIST-all variant)', async () => {
    const { service, ddb } = makeService();
    ddb.queryGSI.mockResolvedValueOnce({ items: [], hasMore: false });

    const result = await service.listPromotionRules({ schoolId: SCHOOL }, ctx);
    expect(result).toEqual([]);
    expect(ddb.putItem).not.toHaveBeenCalled();
  });

  it('does NOT lazy-seed when activeOnly=false (audit/admin view)', async () => {
    const { service, ddb } = makeService();
    ddb.queryGSI.mockResolvedValueOnce({ items: [], hasMore: false });

    const result = await service.listPromotionRules(
      { schoolId: SCHOOL, gradeLevel: '7', activeOnly: false },
      ctx,
    );
    expect(result).toEqual([]);
    expect(ddb.putItem).not.toHaveBeenCalled();
  });

  it('on race (concurrent first-GET, CCFE on put), re-reads and returns the winner', async () => {
    const { service, ddb } = makeService();
    const winner = makeEntity({ ruleId: 'winner-rule', archetypeDefaulted: true });

    // First listPromotionRules query: empty → triggers seed.
    // Second query (findActiveRule inside ensureDefaultRule re-read after CCFE): returns winner.
    ddb.queryGSI
      .mockResolvedValueOnce({ items: [], hasMore: false })
      .mockResolvedValueOnce({ items: [winner], hasMore: false });

    const ccfe = Object.assign(new Error('exists'), {
      name: 'ConditionalCheckFailedException',
    });
    ddb.putItem.mockRejectedValueOnce(ccfe);

    const result = await service.listPromotionRules({ schoolId: SCHOOL, gradeLevel: '7' }, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe('winner-rule');
  });
});

// ============================================
// updatePromotionRule
// ============================================

describe('updatePromotionRule', () => {
  it('flips archetypeDefaulted to false on first operator PATCH', async () => {
    const { service, ddb, events } = makeService();
    ddb.getItem.mockResolvedValueOnce(makeEntity({ archetypeDefaulted: true }));
    ddb.updateItem.mockResolvedValueOnce(
      makeEntity({ archetypeDefaulted: false, passingThresholdPct: 40 }),
    );

    const result = await service.updatePromotionRule(
      'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr',
      SCHOOL,
      { passingThresholdPct: 40 },
      ctx,
    );

    const updateCall = ddb.updateItem.mock.calls[0];
    const exprValues = updateCall[4] as Record<string, unknown>;
    expect(exprValues[':archetypeDefaulted']).toBe(false);
    expect(exprValues[':passingThresholdPct']).toBe(40);
    expect(result.archetypeDefaulted).toBe(false);
    expect(events.publishPromotionRuleUpdated).toHaveBeenCalled();
  });

  it('throws 404 when rule does not exist', async () => {
    const { service, ddb } = makeService();
    ddb.getItem.mockResolvedValueOnce(null);

    await expect(
      service.updatePromotionRule(
        'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr',
        SCHOOL,
        { passingThresholdPct: 40 },
        ctx,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects empty update body with 409', async () => {
    const { service } = makeService();
    await expect(
      service.updatePromotionRule(
        'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr',
        SCHOOL,
        {},
        ctx,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('aliases `description` via expressionAttributeNames (DDB reserved word)', async () => {
    const { service, ddb } = makeService();
    ddb.getItem.mockResolvedValueOnce(makeEntity());
    ddb.updateItem.mockResolvedValueOnce(makeEntity({ description: 'updated note' }));

    await service.updatePromotionRule(
      'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr',
      SCHOOL,
      { description: 'updated note' },
      ctx,
    );

    const attributeNames = ddb.updateItem.mock.calls[0][6] as Record<string, string> | undefined;
    expect(attributeNames).toEqual({ '#desc': 'description' });
  });
});

// ============================================
// softDeletePromotionRule
// ============================================

describe('softDeletePromotionRule', () => {
  it('PATCHes isActive: false (no hard delete in V1)', async () => {
    const { service, ddb } = makeService();
    ddb.getItem.mockResolvedValueOnce(makeEntity({ isActive: true }));
    ddb.updateItem.mockResolvedValueOnce(makeEntity({ isActive: false }));

    await service.softDeletePromotionRule(
      'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr',
      SCHOOL,
      ctx,
    );

    const exprValues = ddb.updateItem.mock.calls[0][4] as Record<string, unknown>;
    expect(exprValues[':isActive']).toBe(false);
  });
});
