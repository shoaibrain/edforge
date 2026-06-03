/**
 * Flash I CSV generator — Sprint E.1.3
 *
 * Walks the FLASH_I_COLUMNS template descriptor + each row in the merged
 * student/enrollment/session/school population. Emits one CSV row per
 * enrollment.
 *
 * Conditional columns (grade1Only, grade11_12Only) emit empty string when
 * the predicate doesn't match — preserves column-count parity across rows.
 */

import { stringify as csvStringify } from 'csv-stringify/sync';
import {
  FLASH_I_COLUMNS,
  type FlashIColumnSpec,
} from '@aibrains/shared-types';
import type { ReportRow } from './types';
import {
  disabilityFirstDescriptorToName,
  ethnicityDescriptorToBand,
  gregorianDateToBsString,
  languageDescriptorToName,
  schoolGradeToCanonical,
  sexDescriptorToMF,
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
    case 'sexDescriptorToMF':
      return sexDescriptorToMF(value);
    case 'ethnicityDescriptorToBand':
      return ethnicityDescriptorToBand(value);
    case 'languageDescriptorToName':
      return languageDescriptorToName(value);
    case 'disabilityFirstDescriptorToName':
      return disabilityFirstDescriptorToName(value);
    case 'gregorianDateToBs':
      return gregorianDateToBsString(value);
    case 'schoolGradeToCanonical':
      return schoolGradeToCanonical(value);
    default:
      // Unknown transform — fall through to stringification.
      return value === undefined || value === null ? '' : String(value);
  }
}

function applyConditional(row: ReportRow, conditional: string | undefined): boolean {
  if (conditional === undefined) return true;
  const grade = row.enrollment.gradeLevel;
  if (conditional === 'grade1Only') return grade === '1' || grade === '01';
  if (conditional === 'grade11_12Only') {
    return grade === '11' || grade === '12' || grade === '11_12';
  }
  return true;
}

function buildCellValue(row: ReportRow, col: FlashIColumnSpec): string {
  if (!applyConditional(row, col.source.conditional)) return '';
  const raw = resolvePath(row, col.source.path);
  return applyTransform(raw, col.source.transform);
}

export function generateFlashICsv(rows: ReportRow[]): { csv: string; rowCount: number } {
  const headers = FLASH_I_COLUMNS.map((c) => c.header);
  const dataRows = rows.map((row) =>
    FLASH_I_COLUMNS.map((col) => buildCellValue(row, col)),
  );
  const csv = csvStringify([headers, ...dataRows], { quoted_string: true });
  return { csv, rowCount: dataRows.length };
}
