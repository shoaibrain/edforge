/**
 * Family Mapper — EPIC-FB Sprint FB-1.3
 *
 * Translates FamilyEntity / FamilyMemberEntity (DDB shapes) into the
 * response DTOs published by `@aibrains/shared-types`.
 *
 * P1d: `isActive` is a soft-delete flag, NOT operator-facing state — it is
 * intentionally omitted from both response DTOs (deactivated rows are
 * already filtered server-side). See CLAUDE.md "Two orthogonal axes".
 */

import type { FamilyEntity, FamilyMemberEntity } from '../entities/family.entity';
import type { FamilyResponseDto, FamilyMemberDto } from '@aibrains/shared-types';

export function familyEntityToDto(entity: FamilyEntity): FamilyResponseDto {
  return {
    id: entity.familyId,
    schoolId: entity.schoolId,
    name: entity.name,
    primaryContact: entity.primaryContact,
    notes: entity.notes,
    createdBy: entity.createdBy,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function familyMemberEntityToDto(entity: FamilyMemberEntity): FamilyMemberDto {
  return {
    familyId: entity.familyId,
    studentId: entity.studentId,
    studentName: entity.studentName,
    relationshipNote: entity.relationshipNote,
    addedBy: entity.addedBy,
    createdAt: entity.createdAt,
  };
}
