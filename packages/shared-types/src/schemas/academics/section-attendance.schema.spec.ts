/**
 * Classroom-UX Sprint 1.1 — the bulk section-attendance record schema must carry
 * the attendance reason fields end-to-end. Previously omitted, so the UI-selected
 * reason was stripped before reaching the backend.
 */

import { bulkSectionAttendanceRecordSchema } from './section-attendance.schema';

describe('bulkSectionAttendanceRecordSchema — reason fields (Sprint 1.1)', () => {
  const base = { studentId: '11111111-1111-1111-1111-111111111111', status: 'absent' };

  it('accepts a bulk record carrying excuseType + excuseReason', () => {
    const parsed = bulkSectionAttendanceRecordSchema.parse({
      ...base,
      excuseType: 'medical',
      excuseReason: 'flu, doctor note on file',
    });
    expect(parsed.excuseType).toBe('medical');
    expect(parsed.excuseReason).toBe('flu, doctor note on file');
  });

  it('keeps the reason fields optional (back-compat)', () => {
    const parsed = bulkSectionAttendanceRecordSchema.parse(base);
    expect(parsed.excuseType).toBeUndefined();
    expect(parsed.excuseReason).toBeUndefined();
  });

  it('rejects an invalid excuseType', () => {
    expect(() =>
      bulkSectionAttendanceRecordSchema.parse({ ...base, excuseType: 'not_a_type' }),
    ).toThrow();
  });

  it('rejects an over-long excuseReason (>500 chars)', () => {
    expect(() =>
      bulkSectionAttendanceRecordSchema.parse({ ...base, excuseReason: 'x'.repeat(501) }),
    ).toThrow();
  });
});
