/**
 * FamilyGroup Entities — EPIC-FB Sprint FB-1.2
 *
 * A Family links students within ONE school so operators (and, via the
 * academics API, the finance service) can answer "students in family X".
 * Finance never reads this table directly — it resolves families over HTTP
 * and snapshots what it needs (epic §3.0).
 *
 * Key Structure (DynamoDB single-table; bare-UUID tenantId per memory
 * `edforge_identity_ddb_bare_uuid_partition_key`):
 *
 *   Family row:        PK tenantId   SK FAMILY#{familyId}
 *     GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}     ← school-scoped listing
 *     GSI1SK: FAMILY#{NAME_UPPERCASE}            ← name-prefix search
 *
 *   Member row:        PK tenantId   SK FAMILY_MEMBER#{familyId}#{studentId}
 *     GSI2PK: {studentId}  (BARE — academics GSI2 convention; enrollment +
 *                           section-enrollment rows already key this way.
 *                           GSIs carry NO LeadingKeys/ABAC protection, so
 *                           isolation rests on UUID unguessability — the
 *                           accepted residual risk documented in epic §4.5
 *                           / risk R1 that new academics rows inherit.)
 *     GSI2SK: FAMILY#{familyId}                  ← "family for student X"
 *
 * Existing GSI2 consumers all use sort-key `begins_with` conditions
 * (`ENROLLMENT#`, `SEC_ENROLL#`, …), so `FAMILY#`-prefixed rows cannot leak
 * into their reads — the no-new-GSI property verified in epic §3.0.
 *
 * @see docs/family-billing/family-billing-agreements-epic.md §3.1
 * @see packages/shared-types/src/schemas/academics/family.schema.ts
 */

import {
  BaseEntity,
  EntityKeyBuilder,
  GSIKeyBuilder,
} from './base.entity';
import type { FamilyPrimaryContactDto } from '@aibrains/shared-types';

export interface FamilyEntity extends BaseEntity {
  entityType: 'FAMILY';

  familyId: string;
  schoolId: string;
  /** Operator-facing family label, e.g. "Adhikari family". */
  name: string;
  /** Display/communication snapshot — NOT a foreign key (epic §4.7 L4). */
  primaryContact: FamilyPrimaryContactDto;
  notes?: string;
  isActive: boolean;

  // GSI Keys
  gsi1pk: string;  // TENANT#{tid}#SCHOOL#{schoolId}
  gsi1sk: string;  // FAMILY#{NAME_UPPERCASE}
}

export interface FamilyMemberEntity extends BaseEntity {
  entityType: 'FAMILY_MEMBER';

  familyId: string;
  studentId: string;
  /** Denormalized from the student row at link time (display convenience). */
  studentName: string;
  relationshipNote?: string;
  addedBy: string;

  // GSI Keys
  gsi2pk: string;  // {studentId} — bare, per academics GSI2 convention
  gsi2sk: string;  // FAMILY#{familyId}
}

// ============================================================================
// GSI key builders
// ============================================================================

/** GSI1SK for family rows — uppercase name for case-insensitive prefix search. */
export function familyGsi1sk(name: string): string {
  return `FAMILY#${name.toUpperCase()}`;
}

export function familyMemberGsi2sk(familyId: string): string {
  return `FAMILY#${familyId}`;
}

/**
 * Create a new FamilyEntity with proper keys + audit timestamps.
 * Always emitted with `isActive: true`; deactivation flips later via DELETE.
 */
export function createFamilyEntity(
  tenantId: string,
  familyId: string,
  schoolId: string,
  data: {
    name: string;
    primaryContact: FamilyPrimaryContactDto;
    notes?: string;
    createdBy: string;
  },
): FamilyEntity {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.family(familyId),
    entityType: 'FAMILY',
    familyId,
    schoolId,
    name: data.name,
    primaryContact: data.primaryContact,
    notes: data.notes,
    isActive: true,
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: now,
    updatedBy: data.createdBy,
    version: 1,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: familyGsi1sk(data.name),
  };
}

/**
 * Create a new FamilyMemberEntity with proper keys + audit timestamps.
 * The single-family invariant is enforced service-side (GSI2 pre-check +
 * `attribute_not_exists(entityKey)` conditional put, FB-1.4) — the factory
 * only shapes the row.
 */
export function createFamilyMemberEntity(
  tenantId: string,
  familyId: string,
  studentId: string,
  data: {
    studentName: string;
    relationshipNote?: string;
    addedBy: string;
  },
): FamilyMemberEntity {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.familyMember(familyId, studentId),
    entityType: 'FAMILY_MEMBER',
    familyId,
    studentId,
    studentName: data.studentName,
    relationshipNote: data.relationshipNote,
    addedBy: data.addedBy,
    createdAt: now,
    createdBy: data.addedBy,
    updatedAt: now,
    updatedBy: data.addedBy,
    version: 1,
    gsi2pk: studentId,
    gsi2sk: familyMemberGsi2sk(familyId),
  };
}
