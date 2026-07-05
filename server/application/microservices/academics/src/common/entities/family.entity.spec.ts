/**
 * Family Entity Spec — EPIC-FB Sprint FB-1.2
 *
 * Coverage:
 *   - Factories produce correct entity shape + EXACT key strings (design
 *     §3.1 of docs/family-billing/family-billing-agreements-epic.md)
 *   - gsi2pk is the BARE studentId (academics GSI2 convention; epic §4.5)
 *   - tenantId stored as bare UUID per memory
 *     `edforge_identity_ddb_bare_uuid_partition_key`
 */

import { describe, expect, it } from '@jest/globals';
import {
  createFamilyEntity,
  createFamilyMemberEntity,
  familyGsi1sk,
  familyMemberGsi2sk,
} from './family.entity';
import { EntityKeyBuilder, GSIKeyBuilder } from './base.entity';

const TENANT  = '11111111-1111-1111-1111-111111111111';
const SCHOOL  = '22222222-2222-2222-2222-222222222222';
const FAMILY  = '33333333-3333-3333-3333-333333333333';
const STUDENT = '44444444-4444-4444-4444-444444444444';
const USER    = 'user-uuid';

const familyData = {
  name: 'Adhikari family',
  primaryContact: { name: 'Ram Adhikari', phone: '+977-9800000000' },
  createdBy: USER,
};

const memberData = {
  studentName: 'Sita Adhikari',
  addedBy: USER,
};

describe('createFamilyEntity', () => {
  it('returns an entity with the right entityType + entityKey', () => {
    const entity = createFamilyEntity(TENANT, FAMILY, SCHOOL, familyData);
    expect(entity.entityType).toBe('FAMILY');
    expect(entity.entityKey).toBe(`FAMILY#${FAMILY}`);
    expect(entity.entityKey).toBe(EntityKeyBuilder.family(FAMILY));
  });

  it('stores tenantId as bare UUID (per memory)', () => {
    const entity = createFamilyEntity(TENANT, FAMILY, SCHOOL, familyData);
    expect(entity.tenantId).toBe(TENANT);
    expect(entity.tenantId.startsWith('TENANT#')).toBe(false);
  });

  it('pins gsi1pk to TENANT#{tid}#SCHOOL#{schoolId} (school-scoped listing)', () => {
    const entity = createFamilyEntity(TENANT, FAMILY, SCHOOL, familyData);
    expect(entity.gsi1pk).toBe(`TENANT#${TENANT}#SCHOOL#${SCHOOL}`);
    expect(entity.gsi1pk).toBe(GSIKeyBuilder.schoolScope(TENANT, SCHOOL));
  });

  it('pins gsi1sk to FAMILY#{NAME_UPPERCASE} (case-insensitive prefix search)', () => {
    const entity = createFamilyEntity(TENANT, FAMILY, SCHOOL, familyData);
    expect(entity.gsi1sk).toBe('FAMILY#ADHIKARI FAMILY');
    expect(entity.gsi1sk).toBe(familyGsi1sk('Adhikari family'));
  });

  it('round-trips name, primaryContact, notes, schoolId', () => {
    const entity = createFamilyEntity(TENANT, FAMILY, SCHOOL, {
      ...familyData,
      notes: 'negotiated 2083 intake',
    });
    expect(entity.familyId).toBe(FAMILY);
    expect(entity.schoolId).toBe(SCHOOL);
    expect(entity.name).toBe('Adhikari family');
    expect(entity.primaryContact).toEqual({ name: 'Ram Adhikari', phone: '+977-9800000000' });
    expect(entity.notes).toBe('negotiated 2083 intake');
  });

  it('initializes isActive=true (soft-delete via DELETE)', () => {
    const entity = createFamilyEntity(TENANT, FAMILY, SCHOOL, familyData);
    expect(entity.isActive).toBe(true);
  });

  it('sets version=1, createdAt=updatedAt, createdBy=updatedBy on creation', () => {
    const entity = createFamilyEntity(TENANT, FAMILY, SCHOOL, familyData);
    expect(entity.version).toBe(1);
    expect(entity.createdAt).toBe(entity.updatedAt);
    expect(entity.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entity.createdBy).toBe(USER);
    expect(entity.updatedBy).toBe(USER);
  });
});

describe('createFamilyMemberEntity', () => {
  it('returns an entity with the right entityType + entityKey', () => {
    const entity = createFamilyMemberEntity(TENANT, FAMILY, STUDENT, memberData);
    expect(entity.entityType).toBe('FAMILY_MEMBER');
    expect(entity.entityKey).toBe(`FAMILY_MEMBER#${FAMILY}#${STUDENT}`);
    expect(entity.entityKey).toBe(EntityKeyBuilder.familyMember(FAMILY, STUDENT));
  });

  it('stores tenantId as bare UUID (per memory)', () => {
    const entity = createFamilyMemberEntity(TENANT, FAMILY, STUDENT, memberData);
    expect(entity.tenantId).toBe(TENANT);
    expect(entity.tenantId.startsWith('TENANT#')).toBe(false);
  });

  // gsi2pk MUST be the bare studentId — the documented academics GSI2
  // convention (enrollment.entity.ts gsi2pk, section-enrollment likewise).
  // GSIs have no LeadingKeys/ABAC protection; isolation rests on UUID
  // unguessability + JWT-scoped query paths — the accepted residual risk
  // per epic §4.5 / risk R1 that FAMILY_MEMBER rows inherit.
  it('pins gsi2pk to the BARE studentId (no TENANT#/STUDENT# prefix — epic §4.5)', () => {
    const entity = createFamilyMemberEntity(TENANT, FAMILY, STUDENT, memberData);
    expect(entity.gsi2pk).toBe(STUDENT);
    expect(entity.gsi2pk).not.toContain('TENANT#');
    expect(entity.gsi2pk).not.toContain('STUDENT#');
    expect(entity.gsi2pk).not.toContain(TENANT);
  });

  it('pins gsi2sk to FAMILY#{familyId}', () => {
    const entity = createFamilyMemberEntity(TENANT, FAMILY, STUDENT, memberData);
    expect(entity.gsi2sk).toBe(`FAMILY#${FAMILY}`);
    expect(entity.gsi2sk).toBe(familyMemberGsi2sk(FAMILY));
  });

  it('round-trips studentName (denorm), relationshipNote, addedBy', () => {
    const entity = createFamilyMemberEntity(TENANT, FAMILY, STUDENT, {
      ...memberData,
      relationshipNote: 'eldest sibling',
    });
    expect(entity.familyId).toBe(FAMILY);
    expect(entity.studentId).toBe(STUDENT);
    expect(entity.studentName).toBe('Sita Adhikari');
    expect(entity.relationshipNote).toBe('eldest sibling');
    expect(entity.addedBy).toBe(USER);
  });

  it('stamps createdBy/updatedBy from addedBy, version=1, createdAt=updatedAt', () => {
    const entity = createFamilyMemberEntity(TENANT, FAMILY, STUDENT, memberData);
    expect(entity.createdBy).toBe(USER);
    expect(entity.updatedBy).toBe(USER);
    expect(entity.version).toBe(1);
    expect(entity.createdAt).toBe(entity.updatedAt);
  });
});

describe('family key builders', () => {
  it('EntityKeyBuilder.family has expected shape', () => {
    expect(EntityKeyBuilder.family(FAMILY)).toBe(`FAMILY#${FAMILY}`);
  });

  it('EntityKeyBuilder.familyMember has expected shape', () => {
    expect(EntityKeyBuilder.familyMember(FAMILY, STUDENT)).toBe(
      `FAMILY_MEMBER#${FAMILY}#${STUDENT}`,
    );
  });

  it('familyGsi1sk uppercases the name', () => {
    expect(familyGsi1sk('shrestha Family')).toBe('FAMILY#SHRESTHA FAMILY');
  });

  it('familyMemberGsi2sk carries the FAMILY# prefix (begins_with discriminator)', () => {
    expect(familyMemberGsi2sk(FAMILY)).toBe(`FAMILY#${FAMILY}`);
  });
});
