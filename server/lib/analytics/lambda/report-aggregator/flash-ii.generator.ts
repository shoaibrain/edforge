/**
 * Flash II CSV generator — Sprint E.1.3
 *
 * End-of-year outcomes/retention. Per research §12 (10 columns).
 *
 * V1 caveat — three columns depend on the Exam→Score→Result pipeline that
 * lands in Sprint C5+C6+C7 (V1 master plan):
 *   - exam_total_marks
 *   - exam_gpa
 *   - academic_status (partial — endStatus mapping works; promotion logic gated on C7)
 *
 * These emit empty string in V1 + a single console.log warning per snapshot
 * generation (handler aggregates count). Saraswati operator manually fills
 * the three columns post-export until C5+ ships.
 */

import { stringify as csvStringify } from 'csv-stringify/sync';
import {
  FLASH_II_COLUMNS,
  type FlashIIColumnSpec,
} from '@aibrains/shared-types';
import type { ReportRow } from './types';
import {
  computeAcademicStatus,
  computeExamGpa,
  computeExamTotalMarks,
  scholarshipCategoryToName,
  schoolGradeToCanonical,
  sumAttendancePresentDays,
} from './transforms';

function resolvePath(row: ReportRow, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let cursor: unknown = row;
  for (const part of parts) {
    if (cursor && typeof cursor === 'object' && part in (cursor as object)) {
      cursor = (cursor as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cursor;
}

function applyTransform(value: unknown, transform: string | undefined): string {
  if (transform === undefined) {
    return value === undefined || value === null ? '' : String(value);
  }
  switch (transform) {
    case 'sumAttendancePresentDays':
      return sumAttendancePresentDays(value);
    case 'scholarshipCategoryToName':
      return scholarshipCategoryToName(value);
    case 'computeExamTotalMarks':
      return computeExamTotalMarks(value);
    case 'computeExamGpa':
      return computeExamGpa(value);
    case 'computeAcademicStatus':
      return computeAcademicStatus(value);
    case 'schoolGradeToCanonical':
      return schoolGradeToCanonical(value);
    default:
      return value === undefined || value === null ? '' : String(value);
  }
}

function buildCellValue(row: ReportRow, col: FlashIIColumnSpec): string {
  const raw = resolvePath(row, col.source.path);
  return applyTransform(raw, col.source.transform);
}

export function generateFlashIICsv(rows: ReportRow[]): {
  csv: string;
  rowCount: number;
  missingExamPipelineCount: number;
} {
  const headers = FLASH_II_COLUMNS.map((c) => c.header);
  let missingExamPipelineCount = 0;
  const dataRows = rows.map((row) => {
    if (!row.resultCards || row.resultCards.length === 0) missingExamPipelineCount += 1;
    return FLASH_II_COLUMNS.map((col) => buildCellValue(row, col));
  });
  const csv = csvStringify([headers, ...dataRows], { quoted_string: true });
  return { csv, rowCount: dataRows.length, missingExamPipelineCount };
}
