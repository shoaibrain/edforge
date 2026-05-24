/**
 * PromotionRuleEntity Spec — Sprint D.2.1
 *
 * Coverage:
 *   - Factory produces correct entity shape + GSI keys
 *   - Lowercase GSI casing per S3.2 invariant
 *   - archetypeDefaulted flag round-trip
 *   - tenantId stored as bare UUID per memory
 *     `edforge_identity_ddb_bare_uuid_partition_key`
 */

import { describe, expect, it } from '@jest/globals';
import {
  createPromotionRuleEntity,
  promotionRuleSchoolGsi1pk,
  promotionRuleSchoolGsi1sk,
} from './promotion-rule.entity';
import { EntityKeyBuilder } from './base.entity';

const TENANT = '11111111-1111-1111-1111-111111111111';
const SCHOOL = '22222222-2222-2222-2222-222222222222';
const RULE   = '33333333-3333-3333-3333-333333333333';

const validData = {
  gradeLevel: '7',
  archetypeId: 'PABSON',
  passingThresholdPct: 35,
  minAttendancePct: 80,
  subjectsRequired: [],
  archetypeDefaulted: true,
  createdBy: 'user-uuid',
};

describe('createPromotionRuleEntity', () => {
  it('returns an entity with the right entityType + entityKey', () => {
    const entity = createPromotionRuleEntity(TENANT, RULE, SCHOOL, validData);
    expect(entity.entityType).toBe('PROMOTION_RULE');
    expect(entity.entityKey).toBe(`PROMOTION_RULE#${SCHOOL}#${RULE}`);
    expect(entity.entityKey).toBe(EntityKeyBuilder.promotionRule(SCHOOL, RULE));
  });

  it('stores tenantId as bare UUID (per memory)', () => {
    const entity = createPromotionRuleEntity(TENANT, RULE, SCHOOL, validData);
    expect(entity.tenantId).toBe(TENANT);
    expect(entity.tenantId.startsWith('TENANT#')).toBe(false);
  });

  it('writes lowercase GSI keys per S3.2 invariant', () => {
    const entity = createPromotionRuleEntity(TENANT, RULE, SCHOOL, validData);
    expect(entity.gsi1pk).toBe(`tenant#${TENANT}#school#${SCHOOL}`);
    expect(entity.gsi1sk).toBe(`promotion-rule#7#${RULE}`);
    // Lowercase guard — no uppercase TENANT or SCHOOL marker
    expect(entity.gsi1pk).not.toMatch(/TENANT|SCHOOL/);
    expect(entity.gsi1sk).not.toMatch(/PROMOTION_RULE/);
  });

  it('matches the published GSI key helpers', () => {
    const entity = createPromotionRuleEntity(TENANT, RULE, SCHOOL, validData);
    expect(entity.gsi1pk).toBe(promotionRuleSchoolGsi1pk(TENANT, SCHOOL));
    expect(entity.gsi1sk).toBe(promotionRuleSchoolGsi1sk('7', RULE));
  });

  it('initializes isActive=true (soft-delete via PATCH)', () => {
    const entity = createPromotionRuleEntity(TENANT, RULE, SCHOOL, validData);
    expect(entity.isActive).toBe(true);
  });

  it('round-trips archetypeDefaulted=true (lazy-seed path)', () => {
    const entity = createPromotionRuleEntity(TENANT, RULE, SCHOOL, {
      ...validData,
      archetypeDefaulted: true,
    });
    expect(entity.archetypeDefaulted).toBe(true);
  });

  it('round-trips archetypeDefaulted=false (operator-create path)', () => {
    const entity = createPromotionRuleEntity(TENANT, RULE, SCHOOL, {
      ...validData,
      archetypeDefaulted: false,
    });
    expect(entity.archetypeDefaulted).toBe(false);
  });

  it('round-trips subjectsRequired array', () => {
    const entity = createPromotionRuleEntity(TENANT, RULE, SCHOOL, {
      ...validData,
      subjectsRequired: ['mathematics', 'english'],
    });
    expect(entity.subjectsRequired).toEqual(['mathematics', 'english']);
  });

  it('round-trips passingThresholdPct + minAttendancePct', () => {
    const entity = createPromotionRuleEntity(TENANT, RULE, SCHOOL, {
      ...validData,
      passingThresholdPct: 60,
      minAttendancePct: 90,
    });
    expect(entity.passingThresholdPct).toBe(60);
    expect(entity.minAttendancePct).toBe(90);
  });

  it('sets createdAt + updatedAt to same ISO timestamp on creation', () => {
    const entity = createPromotionRuleEntity(TENANT, RULE, SCHOOL, validData);
    expect(entity.createdAt).toBe(entity.updatedAt);
    expect(entity.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sets version=1 on creation', () => {
    const entity = createPromotionRuleEntity(TENANT, RULE, SCHOOL, validData);
    expect(entity.version).toBe(1);
  });

  it('stamps createdBy + updatedBy with the same user', () => {
    const entity = createPromotionRuleEntity(TENANT, RULE, SCHOOL, validData);
    expect(entity.createdBy).toBe('user-uuid');
    expect(entity.updatedBy).toBe('user-uuid');
  });
});

describe('promotionRule key builders', () => {
  it('EntityKeyBuilder.promotionRule has expected shape', () => {
    expect(EntityKeyBuilder.promotionRule(SCHOOL, RULE)).toBe(
      `PROMOTION_RULE#${SCHOOL}#${RULE}`,
    );
  });

  it('GSI1PK is lowercase-prefixed', () => {
    expect(promotionRuleSchoolGsi1pk(TENANT, SCHOOL)).toBe(
      `tenant#${TENANT}#school#${SCHOOL}`,
    );
  });

  it('GSI1SK is gradeLevel-then-ruleId sortable', () => {
    expect(promotionRuleSchoolGsi1sk('10', RULE)).toBe(`promotion-rule#10#${RULE}`);
  });
});
