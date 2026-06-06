/**
 * Grading Policy Mapper
 *
 * Translates between GradingPolicyEntity and response DTO.
 *
 * D.1.1-followup (R38, 2026-05-22) — extended to surface `gpaScale` +
 * entry-level `isPassing`/`isTerminalFail?`/`displayName?` in the response
 * DTO. Pre-fix, the mapper silently dropped these fields even though the
 * entity carried them, which prevented AdminWeb from rendering the `NG`
 * Not-Graded sentinel flag or showing per-letter passing thresholds.
 *
 * Backward-compat with PRE-D.1 rows: legacy DDB rows created before
 * 2026-05-22 (e.g. the dev-pabson Saraswati policy from 2026-05-12) may
 * not have `gpaScale` or the new entry fields populated. The mapper:
 *   - Defaults `gpaScale` to `'4.0'` (existing implicit-4.0-scale behavior).
 *   - Treats missing `isPassing` as `true` for backward-compat (existing
 *     consumers assumed every letter row was passing unless the policy's
 *     `minimumPassingGrade` excluded it).
 *   - Passes through `isTerminalFail?` / `displayName?` if present;
 *     undefined otherwise.
 * D.1.5 backfill (when run with proper IAM) materializes these fields on
 * legacy rows; the mapper compatibility shim can be retired then.
 */

import { GradingPolicyEntity } from '../entities/grading-policy.entity';
import type { LetterGradeEntry } from '../entities/grade.entity';
import type { GradingSchemeType, DivisionBand } from '@aibrains/shared-types';

export interface GradingPolicyLetterEntryDto {
  letter: string;
  minPercentage: number;
  maxPercentage: number;
  gpaPoints: number;
  isPassing: boolean;
  isTerminalFail?: boolean;
  displayName?: string;
}

export interface GradingPolicyResponseDto {
  policyId: string;
  schoolId: string;
  tenantId: string;
  policyName: string;
  description?: string;
  /**
   * GPA scale ceiling — `'4.0'` for US + Nepal CEHRD; `'5.0'` for weighted-
   * honors policies. Defaults to `'4.0'` for legacy rows that pre-date D.1.1.
   */
  gpaScale: '4.0' | '5.0';
  schemeType: GradingSchemeType;
  divisions?: DivisionBand[];
  letterGrades: GradingPolicyLetterEntryDto[];
  categoryWeights: {
    categoryId: string;
    categoryName: string;
    weight: number;
  }[];
  dropLowestScores?: { categoryId: string; count: number }[];
  roundingRule: string;
  minimumPassingGrade: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

function entryToDto(entry: LetterGradeEntry): GradingPolicyLetterEntryDto {
  return {
    letter: entry.letter,
    minPercentage: entry.minPercentage,
    maxPercentage: entry.maxPercentage,
    gpaPoints: entry.gpaPoints,
    // Backward-compat: legacy entries (pre-D.1.1) lack isPassing. Treat as
    // passing unless explicitly false — matches the pre-D.1 implicit shape.
    isPassing: entry.isPassing ?? true,
    isTerminalFail: entry.isTerminalFail,
    displayName: entry.displayName,
  };
}

export function gradingPolicyEntityToDto(entity: GradingPolicyEntity): GradingPolicyResponseDto {
  return {
    policyId: entity.policyId,
    schoolId: entity.schoolId,
    tenantId: entity.tenantId,
    policyName: entity.policyName,
    description: entity.description,
    // Backward-compat: legacy rows without `gpaScale` default to '4.0',
    // matching the pre-D.1 implicit 4.0-scale assumption everywhere else.
    gpaScale: entity.gpaScale ?? '4.0',
    schemeType: entity.schemeType ?? 'letter_gpa',
    divisions: entity.divisions,
    letterGrades: (entity.letterGrades ?? []).map(entryToDto),
    categoryWeights: entity.categoryWeights,
    dropLowestScores: entity.dropLowestScores,
    roundingRule: entity.roundingRule,
    minimumPassingGrade: entity.minimumPassingGrade,
    isDefault: entity.isDefault,
    isActive: entity.isActive,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    createdBy: entity.createdBy,
    updatedBy: entity.updatedBy,
  };
}
