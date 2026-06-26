/**
 * AttendanceService — monthly aggregate recompute + IEMiS export (S5 / Layer 4).
 *
 * recomputeMonthlyForSchool: groups the month's daily SCH_ATTEND rows by student
 * into present/absent/excused day counts (attending statuses → present), persists
 * one MONTHLY_ATTEND row each. getIemisAttendanceExport: shapes them into IEMiS
 * rows, row-level-scoped to the caller.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { AttendanceService } from './attendance.service';

const ctx = { tenantId: 'ten-1', userId: 'u-1', jwtToken: 'jwt', email: 'a@b.c', role: 'TenantAdmin' } as any;

// One daily SCH_ATTEND row = one student-day.
const day = (studentId: string, status: string, studentName?: string, date = '2026-06-10') =>
  ({ studentId, status, studentName, schoolId: 'sch-1', academicYearId: 'ay-1', date });

function makeService(items: any[], scope: any = { type: 'school' }) {
  const putItem = jest.fn<any>().mockResolvedValue(undefined);
  const ddb = {
    getClient: jest.fn<any>().mockResolvedValue({}),
    query: jest.fn<any>().mockResolvedValue({ items, lastEvaluatedKey: undefined }),
    putItem,
  };
  const dataScope = {
    resolveScope: jest.fn<any>().mockResolvedValue(scope),
    filterByStudentScope: jest.fn((s: any, arr: any[]) => {
      if (s.type === 'school') return arr;
      if (!s.studentIds || s.studentIds.length === 0) return [];
      const set = new Set(s.studentIds);
      return arr.filter((i: any) => set.has(i.studentId));
    }),
  };
  const svc = new (AttendanceService as any)(ddb, {}, {}, dataScope);
  return { svc, ddb, putItem };
}

describe('AttendanceService.recomputeMonthlyForSchool (S5)', () => {
  it('counts present/absent/excused days per student and persists one row each', async () => {
    const { svc, putItem } = makeService([
      day('s1', 'present', 'Asha'),
      day('s1', 'present', 'Asha'),
      day('s1', 'absent', 'Asha'),
      day('s2', 'excused', 'Bina'),
    ]);

    const res = await svc.recomputeMonthlyForSchool('sch-1', '2026-06', 'ay-1', ctx);

    expect(putItem).toHaveBeenCalledTimes(2); // one MONTHLY_ATTEND per student
    const s1 = res.find((r: any) => r.studentId === 's1');
    expect(s1).toMatchObject({ presentDays: 2, absentDays: 1, excusedDays: 0, totalSchoolDays: 3, yearMonth: '2026-06', studentName: 'Asha' });
    const s2 = res.find((r: any) => r.studentId === 's2');
    expect(s2).toMatchObject({ presentDays: 0, absentDays: 0, excusedDays: 1, totalSchoolDays: 1 });
  });

  it('counts attending statuses (late/half_day/remote) as present days', async () => {
    const { svc } = makeService([day('s3', 'late'), day('s3', 'half_day'), day('s3', 'remote')]);

    const res = await svc.recomputeMonthlyForSchool('sch-1', '2026-06', 'ay-1', ctx);

    expect(res[0]).toMatchObject({ studentId: 's3', presentDays: 3, absentDays: 0, excusedDays: 0, totalSchoolDays: 3 });
  });

  it('drains multiple base-table pages (cursor decode)', async () => {
    const putItem = jest.fn<any>().mockResolvedValue(undefined);
    const ddb = {
      getClient: jest.fn<any>().mockResolvedValue({}),
      query: jest.fn<any>()
        .mockResolvedValueOnce({ items: [day('s1', 'present')], lastEvaluatedKey: Buffer.from(JSON.stringify({ k: 1 })).toString('base64') })
        .mockResolvedValueOnce({ items: [day('s1', 'absent')], lastEvaluatedKey: undefined }),
      putItem,
    };
    const dataScope = { resolveScope: jest.fn<any>(), filterByStudentScope: jest.fn() };
    const svc = new (AttendanceService as any)(ddb, {}, {}, dataScope);

    const res = await svc.recomputeMonthlyForSchool('sch-1', '2026-06', 'ay-1', ctx);

    expect(ddb.query).toHaveBeenCalledTimes(2);
    expect(res[0]).toMatchObject({ studentId: 's1', presentDays: 1, absentDays: 1, totalSchoolDays: 2 });
  });
});

describe('AttendanceService.getIemisAttendanceExport (S5)', () => {
  it('shapes monthly aggregates into IEMiS rows with metadata', async () => {
    const { svc } = makeService([day('s1', 'present', 'Asha'), day('s2', 'absent', 'Bina')]);

    const out = await svc.getIemisAttendanceExport('sch-1', '2026-06', 'ay-1', ctx);

    expect(out.schoolId).toBe('sch-1');
    expect(out.yearMonth).toBe('2026-06');
    expect(typeof out.generatedAt).toBe('string');
    expect(out.rowCount).toBe(2);
    expect(out.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ studentId: 's1', studentName: 'Asha', presentDays: 1, absentDays: 0, excusedDays: 0, totalSchoolDays: 1 }),
        expect.objectContaining({ studentId: 's2', studentName: 'Bina', presentDays: 0, absentDays: 1, excusedDays: 0, totalSchoolDays: 1 }),
      ]),
    );
  });

  it('row-level scopes the export (section-scoped caller sees only their roster)', async () => {
    const { svc } = makeService(
      [day('s1', 'present'), day('s2', 'present')],
      { type: 'section', sectionIds: ['secA'], studentIds: ['s1'] },
    );

    const out = await svc.getIemisAttendanceExport('sch-1', '2026-06', 'ay-1', ctx);

    expect(out.rowCount).toBe(1);
    expect(out.rows.map((r: any) => r.studentId)).toEqual(['s1']);
  });
});
