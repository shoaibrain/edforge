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
  getTableName: jest.Mock<() => string>;
  putItem: jest.Mock<(...args: AnyArgs) => Promise<void>>;
  getItem: jest.Mock<(...args: AnyArgs) => Promise<PromotionRuleEntity | null>>;
  queryGSI: jest.Mock<(...args: AnyArgs) => Promise<QueryResult>>;
  updateItem: jest.Mock<(...args: AnyArgs) => Promise<PromotionRuleEntity>>;
  transactWrite: jest.Mock<(...args: AnyArgs) => Promise<void>>;
}

function makeMockDdb(): MockDdb {
  return {
    getClient: jest
      .fn<(...args: AnyArgs) => Promise<unknown>>()
      .mockResolvedValue({}),
    getTableName: jest.fn<() => string>().mockReturnValue('edforge-academics-test'),
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
    transactWrite: jest
      .fn<(...args: AnyArgs) => Promise<void>>()
      .mockResolvedValue(undefined),
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
  it('creates a PromotionRule via transactWrite (rule + uniqueness lock) and publishes PromotionRuleCreated', async () => {
    const { service, ddb, events } = makeService();
    const dto = {
      schoolId: SCHOOL,
      gradeLevel: '7',
      archetypeId: 'PABSON',
      passingThresholdPct: 35,
      minAttendancePct: 80,
    };

    const result = await service.createPromotionRule(dto, ctx);

    expect(ddb.transactWrite).toHaveBeenCalledTimes(1);
    const transactItems = ddb.transactWrite.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(transactItems).toHaveLength(2);
    // Op 1: Put PromotionRule entity with attribute_not_exists(entityKey)
    const ruleOp = (transactItems[0] as { Put: { Item: PromotionRuleEntity; ConditionExpression: string } }).Put;
    expect(ruleOp.Item.entityType).toBe('PROMOTION_RULE');
    expect(ruleOp.Item.archetypeDefaulted).toBe(false); // operator-create path
    expect(ruleOp.Item.isActive).toBe(true);
    expect(ruleOp.ConditionExpression).toBe('attribute_not_exists(entityKey)');
    // Op 2: Put deterministic uniqueness lock
    const lockOp = (transactItems[1] as { Put: { Item: Record<string, unknown>; ConditionExpression: string } }).Put;
    expect(lockOp.Item.entityType).toBe('PROMOTION_RULE_LOCK');
    expect(lockOp.Item.entityKey).toBe(`PROMOTION_RULE_LOCK#${SCHOOL}#7`);
    expect(lockOp.ConditionExpression).toBe('attribute_not_exists(entityKey)');
    expect(events.publishPromotionRuleCreated).toHaveBeenCalled();
    expect(result.archetypeDefaulted).toBe(false);
    expect(result.schoolId).toBe(SCHOOL);
  });

  it('rejects with 409 if an active rule already exists for (schoolId, gradeLevel) [pre-check path]', async () => {
    const { service, ddb } = makeService();
    // findActiveRule pre-check finds an existing winner.
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
    // transactWrite NOT invoked — pre-check short-circuited.
    expect(ddb.transactWrite).not.toHaveBeenCalled();
  });

  it('rejects with 409 on lock collision via TransactionCanceledException [race-recovery path]', async () => {
    const { service, ddb } = makeService();
    // 1st queryGSI = pre-check: empty (race window — both callers see empty).
    // 2nd queryGSI = post-CCFE re-read: returns the winner.
    ddb.queryGSI
      .mockResolvedValueOnce({ items: [], hasMore: false })
      .mockResolvedValueOnce({
        items: [makeEntity({ ruleId: 'winner-rule' })],
        hasMore: false,
      });
    // transactWrite throws because the lock collided with the winner's earlier write.
    const txCanceled = Object.assign(new Error('lock collision'), {
      name: 'TransactionCanceledException',
    });
    ddb.transactWrite.mockRejectedValueOnce(txCanceled);

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
    ).rejects.toMatchObject({
      // ConflictException carrying the winner's ruleId in the message.
      message: expect.stringContaining('winner-rule'),
    });
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
    expect(ddb.transactWrite).not.toHaveBeenCalled();
  });

  it('lazy-seeds when (schoolId, gradeLevel) is empty (D.2.3) via transactWrite + lock', async () => {
    const { service, ddb, events } = makeService();
    // listPromotionRules first query returns empty → triggers ensureDefaultRule.
    // transactWrite resolves cleanly (no race) → seed succeeds.
    ddb.queryGSI.mockResolvedValue({ items: [], hasMore: false });

    const result = await service.listPromotionRules({ schoolId: SCHOOL, gradeLevel: '7' }, ctx);

    expect(result).toHaveLength(1);
    expect(result[0].archetypeDefaulted).toBe(true);
    expect(result[0].archetypeId).toBe('PABSON');
    expect(result[0].passingThresholdPct).toBe(35);
    expect(result[0].minAttendancePct).toBe(80);
    expect(ddb.transactWrite).toHaveBeenCalledTimes(1);
    const items = ddb.transactWrite.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2); // rule + lock
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
    expect(ddb.transactWrite).not.toHaveBeenCalled();
  });

  it('does NOT lazy-seed when activeOnly=false (audit/admin view)', async () => {
    const { service, ddb } = makeService();
    ddb.queryGSI.mockResolvedValueOnce({ items: [], hasMore: false });

    const result = await service.listPromotionRules(
      { schoolId: SCHOOL, gradeLevel: '7', activeOnly: false },
      ctx,
    );
    expect(result).toEqual([]);
    expect(ddb.transactWrite).not.toHaveBeenCalled();
  });

  it('on lazy-seed race (concurrent first-GET, TransactionCanceledException on lock), re-reads and returns the winner', async () => {
    const { service, ddb } = makeService();
    const winner = makeEntity({ ruleId: 'winner-rule', archetypeDefaulted: true });

    // The real race: ensureDefaultRule generates a fresh uuid each call, so
    // the rule's entityKey never collides. The collision is on the
    // deterministic PROMOTION_RULE_LOCK#{schoolId}#{gradeLevel} key, which
    // surfaces as TransactionCanceledException from the transactWrite.
    //
    // Sequence:
    //   - listPromotionRules query #1: empty → triggers ensureDefaultRule
    //   - ensureDefaultRule transactWrite → TransactionCanceledException
    //   - ensureDefaultRule findActiveRule query #2: returns the winner
    ddb.queryGSI
      .mockResolvedValueOnce({ items: [], hasMore: false })
      .mockResolvedValueOnce({ items: [winner], hasMore: false });

    const txCanceled = Object.assign(new Error('lock collision'), {
      name: 'TransactionCanceledException',
    });
    ddb.transactWrite.mockRejectedValueOnce(txCanceled);

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
  it('atomically updates isActive=false on the rule AND deletes the uniqueness lock via transactWrite', async () => {
    const { service, ddb, events } = makeService();
    ddb.getItem.mockResolvedValueOnce(makeEntity({ isActive: true }));

    await service.softDeletePromotionRule(
      'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr',
      SCHOOL,
      ctx,
    );

    expect(ddb.transactWrite).toHaveBeenCalledTimes(1);
    const items = ddb.transactWrite.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    // Op 1: Update rule with isActive=false + version-check condition
    const updateOp = (items[0] as { Update: { ExpressionAttributeValues: Record<string, unknown>; ConditionExpression: string } }).Update;
    expect(updateOp.ExpressionAttributeValues[':isActive']).toBe(false);
    expect(updateOp.ConditionExpression).toBe('version = :currentVersion');
    // Op 2: Delete the deterministic lock with attribute_exists guard
    const deleteOp = (items[1] as { Delete: { Key: { entityKey: string }; ConditionExpression: string } }).Delete;
    expect(deleteOp.Key.entityKey).toBe(`PROMOTION_RULE_LOCK#${SCHOOL}#7`);
    expect(deleteOp.ConditionExpression).toBe('attribute_exists(entityKey)');
    expect(events.publishPromotionRuleUpdated).toHaveBeenCalledWith(
      ctx.tenantId,
      'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr',
      SCHOOL,
      ['isActive'],
    );
  });

  it('throws 404 when the rule does not exist', async () => {
    const { service, ddb } = makeService();
    ddb.getItem.mockResolvedValueOnce(null);

    await expect(
      service.softDeletePromotionRule('missing-rule', SCHOOL, ctx),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ddb.transactWrite).not.toHaveBeenCalled();
  });
});
