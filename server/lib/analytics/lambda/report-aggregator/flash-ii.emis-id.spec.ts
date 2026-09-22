/**
 * Flash II generator — missing `student_iemis_id` detection (#481).
 *
 * Student creation no longer requires an IEMIS student ID, because CEHRD
 * issues it *after* Flash I: the intake template marks the column optional
 * ("blank for new ECED/Grade 1 intakes") and only Flash II, at year end,
 * marks it required. The create-time gate therefore demanded an identifier at
 * the one moment it provably could not exist, and blocked the largest intake
 * cohort of every school year from being enrolled at all.
 *
 * Removing that gate is only safe if the rule is enforced where it actually
 * bites. IEMIS rejects the *entire* Excel upload on a row-level validation
 * failure, so an operator who discovers a missing ID from CEHRD rather than
 * from us has already lost the submission window. These pin that the
 * generator surfaces the problem — counted and sampled, not blocked, since
 * refusing to generate would withhold the very file that says who to fix.
 */

import { generateFlashIICsv } from './flash-ii.generator';
import type { ReportRow } from './types';

function row(overrides: Record<string, unknown> = {}): ReportRow {
  const { student: studentOverrides, ...rest } = overrides;
  return {
    ...{ resultCards: [{ id: 'rc-1' }] },
    ...rest,
    student: {
      studentId: 'stu-1',
      firstName: 'Asha',
      lastName: 'Gurung',
      currentGradeLevel: '5',
      emisStudentId: '1234567890123456',
      ...((studentOverrides as Record<string, unknown>) ?? {}),
    },
  } as unknown as ReportRow;
}

describe('generateFlashIICsv — missing student_iemis_id (#481)', () => {
  it('reports zero when every row carries an ID', () => {
    const out = generateFlashIICsv([row(), row({ student: { studentId: 'stu-2' } })]);

    expect(out.missingEmisStudentIdCount).toBe(0);
    expect(out.missingEmisStudentIdSample).toEqual([]);
  });

  it('counts rows whose ID is absent', () => {
    const out = generateFlashIICsv([
      row(),
      row({ student: { studentId: 'stu-2', emisStudentId: undefined } }),
      row({ student: { studentId: 'stu-3', emisStudentId: undefined } }),
    ]);

    expect(out.missingEmisStudentIdCount).toBe(2);
  });

  it('treats an empty-string ID as missing, not as present', () => {
    // A blank column is exactly what CEHRD rejects; `''` must not pass as set.
    const out = generateFlashIICsv([row({ student: { emisStudentId: '' } })]);

    expect(out.missingEmisStudentIdCount).toBe(1);
  });

  it('names the students so the operator knows who to fix', () => {
    const out = generateFlashIICsv([
      row({ student: { studentId: 'stu-9', firstName: 'Bina', lastName: 'Rai', emisStudentId: undefined } }),
    ]);

    expect(out.missingEmisStudentIdSample).toHaveLength(1);
    expect(out.missingEmisStudentIdSample[0]).toContain('stu-9');
    expect(out.missingEmisStudentIdSample[0]).toContain('Bina');
  });

  it('bounds the sample so a whole roster cannot land in one log line', () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row({ student: { studentId: `stu-${i}`, emisStudentId: undefined } }),
    );
    const out = generateFlashIICsv(rows);

    expect(out.missingEmisStudentIdCount).toBe(50);
    expect(out.missingEmisStudentIdSample).toHaveLength(20);
  });

  it('still generates the CSV — the file is how the operator finds the gaps', () => {
    const out = generateFlashIICsv([row({ student: { emisStudentId: undefined } })]);

    expect(out.rowCount).toBe(1);
    expect(out.csv.length).toBeGreaterThan(0);
  });

  it('keeps the existing exam-pipeline count independent', () => {
    // Two separate data-quality signals; one must not mask the other.
    const out = generateFlashIICsv([
      row({ student: { emisStudentId: undefined }, resultCards: [] }),
      row({ student: { studentId: 'stu-2' }, resultCards: [] }),
    ]);

    expect(out.missingEmisStudentIdCount).toBe(1);
    expect(out.missingExamPipelineCount).toBe(2);
  });
});
