/**
 * Flash I generator — grade-level canonical projection (Sprint A.3).
 *
 * Verifies that students enrolled in a PABSON school's operator-chosen local
 * grade codes (PG/NUR/LKG/UKG/1-10) produce the CEHRD-canonical short code
 * (ECD/PPC/1-10) in the Flash I grade_level column.
 *
 * Strategy: build a minimal ReportRow array spanning each grade-band PABSON
 * uses, run the generator, parse the CSV, and assert per-row on the
 * grade_level column. Avoids full snapshot tests to keep the gate stable
 * across template churn.
 */

import { generateFlashICsv } from './flash-i.generator';
import type { ReportRow } from './types';

/**
 * Minimal CSV parser for the generator's quoted-string output. Sufficient for
 * test fixtures (no embedded commas, newlines, or quotes); not a general
 * RFC-4180 parser. Keeps the test free of an extra `csv-parse` dep.
 */
function parseRows(csv: string): Array<Record<string, string>> {
  const lines = csv.trim().split(/\r?\n/);
  const cells = (line: string): string[] =>
    Array.from(line.matchAll(/"((?:[^"\\]|\\.)*)"/g)).map((m) => m[1]);
  const [headerLine, ...dataLines] = lines;
  const headers = cells(headerLine);
  return dataLines.map((line) => {
    const values = cells(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

function makeRow(gradeLevel: string): ReportRow {
  const tag = gradeLevel.replace(/\W+/g, '');
  return {
    student: {
      studentId: `STU-${tag}`,
      firstName: 'Test',
      lastName: 'Student',
      dateOfBirth: '2020-01-01',
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Female',
      ethnicityDescriptor: 'uri://ed-fi.org/EthnicityDescriptor#Brahmin',
      motherTongueDescriptor: 'uri://ed-fi.org/LanguageDescriptor#Nepali',
      disabilities: [],
    },
    enrollment: {
      enrollmentId: `ENR-${tag}`,
      gradeLevel,
      type: 'new',
    },
    session: { yearBs: '2083' },
    school: { schoolId: 'SCH-1', emisCode: '170840012' },
  };
}

describe('generateFlashICsv — grade-level canonical projection (Sprint A.3)', () => {
  it('projects PABSON-school local codes to CEHRD canonical in grade_level column', () => {
    const rows: ReportRow[] = [
      makeRow('PG'),
      makeRow('NUR'),
      makeRow('LKG'),
      makeRow('UKG'),
      makeRow('1'),
      makeRow('5'),
      makeRow('8'),
      makeRow('10'),
    ];

    const { csv, rowCount } = generateFlashICsv(rows);
    expect(rowCount).toBe(rows.length);

    const parsed = parseRows(csv);
    const grades = parsed.map((r) => r.grade_level);

    expect(grades).toEqual(['ECD', 'ECD', 'PPC', 'PPC', '1', '5', '8', '10']);
  });

  it('emits empty grade_level for the lossy ECD/PPC literal', () => {
    const { csv } = generateFlashICsv([makeRow('ECD/PPC')]);
    const parsed = parseRows(csv);
    expect(parsed[0].grade_level).toBe('');
  });

  it('preserves output for verbose alias forms an importer may emit', () => {
    const { csv } = generateFlashICsv([
      makeRow('Grade 1'),
      makeRow('Class 10'),
      makeRow('SEE'),
    ]);
    const parsed = parseRows(csv);
    expect(parsed.map((r) => r.grade_level)).toEqual(['1', '10', '10']);
  });
});
