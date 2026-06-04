/**
 * BoardExam entity — Sprint GB2.
 *
 * Per-school materialization of an archetype `boardExams[]` definition (the
 * national/municipal exam structure: BLE, SEE, NEB_11, NEB_12 for PABSON).
 * Lazily seeded on first list (GB2.2/GB2.3) from
 * `getArchetypeDefaults(archetype).boardExams`, grade-gated to the school's
 * coverage. These are *definitions* the setup checklist reads — student
 * registrations/results live in the separate `external-exam-*` entity family.
 *
 * Key: `BOARD_EXAM#{schoolId}#{examType}` on the main table (PK = tenantId).
 * `examType` is the per-school natural key, so `attribute_not_exists(entityKey)`
 * is the double-seed guard. Listed via `begins_with(entityKey, 'BOARD_EXAM#{schoolId}#')`
 * — no GSI required.
 */

import type { BoardExamDefinition } from '@aibrains/shared-types';
import { BaseEntity, EntityKeyBuilder } from './base.entity';

export interface BoardExamEntity extends BaseEntity, BoardExamDefinition {
  entityType: 'BOARD_EXAM';
  schoolId: string;
  /** Archetype this definition was seeded from (e.g. 'PABSON'). */
  archetypeId: string;
  /** True when seeded from the archetype default (vs operator-created/edited). */
  archetypeDefaulted: boolean;
}

export function createBoardExamEntity(
  tenantId: string,
  schoolId: string,
  archetypeId: string,
  definition: BoardExamDefinition,
  actor: string,
): BoardExamEntity {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.boardExam(schoolId, definition.examType),
    entityType: 'BOARD_EXAM',
    schoolId,
    archetypeId,
    archetypeDefaulted: true,
    ...definition,
    createdAt: now,
    createdBy: actor,
    updatedAt: now,
    updatedBy: actor,
    version: 1,
  };
}
