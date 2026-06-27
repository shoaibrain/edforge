/**
 * AttendanceService — monthly aggregate recompute + IEMiS export (S5 / Layer 4).
 *
 * recomputeMonthlyForSchool aggregates the month from the daily SCH_ATTEND rows
 * via one SCHOOL-SCOPED GSI3 query per date (no tenant-wide scan), grouping by
 * student into present/absent/excused day counts (attending statuses → present),
 * persisting one MONTHLY_ATTEND row each. getIemisAttendanceExport recomputes
 * fresh and shapes the result into IEMiS rows, row-level-scoped to the caller.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { AttendanceService } from './attendance.service';

const ctx = { tenantId: 'ten-1', userId: 'u-1', jwtToken: 'jwt', email: 'a@b.c', role: 'TenantAdmin' } as any;

// One daily SCH_ATTEND row = one student-day, on a given date within the month.
const day = (studentId: string, status: string, date: string, studentName?: string) =>
  ({ studentId, status, date, studentName, schoolId: 'sch-1', academicYearId: 'ay-1' });

function makeService(items: any[], scope: any = { type: 'school' }) {
  const byDate: Record<string, any[]> = {};
  for (const it of items) (byDate[it.date] ||= []).push(it);
  const putItem = jest.fn<any>().mockResolvedValue(undefined);
  const ddb = {
    getClient: jest.fn<any>().mockResolvedValue({}),
    // queryGSI is called once per date with GSI3 PK ...#DATE#{date}; return that day's rows.
    queryGSI: jest.fn<any>((_client: any, _idx: string, pk: string) => {
      const date = String(pk).split('#DATE#')[1];
      return Promise.resolve({ items: byDate[date] || [], lastEvaluatedKey: undefined });
    }),
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
  it('accumulates per-student day counts across the month and persists one row each', async () => {
    const { svc, ddb, putItem } = makeService([
      day('s1', 'present', '2026-06-10', 'Asha'),
      day('s1', 'present', '2026-06-11', 'Asha'),
      day('s1', 'absent', '2026-06-12', 'Asha'),
      day('s2', 'excused', '2026-06-10', 'Bina'),
    ]);

    const res = await svc.recomputeMonthlyForSchool('sch-1', '2026-06', 'ay-1', ctx);

    expect(ddb.queryGSI).toHaveBeenCalledTimes(30); // one school-scoped query per day of June
    expect(putItem).toHaveBeenCalledTimes(2);
    expect(res.find((r: any) => r.studentId === 's1')).toMatchObject({ presentDays: 2, absentDays: 1, excusedDays: 0, totalSchoolDays: 3, studentName: 'Asha', yearMonth: '2026-06' });
    expect(res.find((r: any) => r.studentId === 's2')).toMatchObject({ presentDays: 0, absentDays: 0, excusedDays: 1, totalSchoolDays: 1 });
  });

  it('counts attending statuses (late/half_day/remote) as present days', async () => {
    const { svc } = makeService([
      day('s3', 'late', '2026-06-10'),
      day('s3', 'half_day', '2026-06-11'),
      day('s3', 'remote', '2026-06-12'),
    ]);

    const res = await svc.recomputeMonthlyForSchool('sch-1', '2026-06', 'ay-1', ctx);

    expect(res[0]).toMatchObject({ studentId: 's3', presentDays: 3, absentDays: 0, excusedDays: 0, totalSchoolDays: 3 });
  });
});

describe('AttendanceService.recomputeMonthlyForSchool — pagination (P1b regression)', () => {
  const enc = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64');

  it('drains ALL pages for a day so a large school is never silently truncated', async () => {
    // 2026-06-10 returns two pages; every other day is empty. A non-draining
    // reader would lose s3 (page 2).
    const ddb = {
      getClient: jest.fn<any>().mockResolvedValue({}),
      queryGSI: jest.fn<any>((..._args: any[]) => {
        const pk = _args[2];
        const startKey = _args[10];
        const date = String(pk).split('#DATE#')[1];
        if (date !== '2026-06-10') return Promise.resolve({ items: [], lastEvaluatedKey: undefined });
        if (!startKey) {
          return Promise.resolve({
            items: [day('s1', 'present', date), day('s2', 'absent', date)],
            lastEvaluatedKey: enc({ pk: 'cursor-1' }),
          });
        }
        return Promise.resolve({ items: [day('s3', 'excused', date)], lastEvaluatedKey: undefined });
      }),
      putItem: jest.fn<any>().mockResolvedValue(undefined),
    };
    const dataScope = {
      resolveScope: jest.fn<any>().mockResolvedValue({ type: 'school' }),
      filterByStudentScope: jest.fn((_s: any, arr: any[]) => arr),
    };
    const svc = new (AttendanceService as any)(ddb, {}, {}, dataScope);

    const res = await svc.recomputeMonthlyForSchool('sch-1', '2026-06', 'ay-1', ctx);

    expect(res.map((r: any) => r.studentId).sort()).toEqual(['s1', 's2', 's3']);
  });

  it('fails loud (does not persist a partial month) when a day pages past the cap', async () => {
    const putItem = jest.fn<any>().mockResolvedValue(undefined);
    const ddb = {
      getClient: jest.fn<any>().mockResolvedValue({}),
      // Always returns a cursor for 2026-06-10 → must abort at the page cap.
      queryGSI: jest.fn<any>((..._args: any[]) => {
        const date = String(_args[2]).split('#DATE#')[1];
        if (date !== '2026-06-10') return Promise.resolve({ items: [], lastEvaluatedKey: undefined });
        return Promise.resolve({ items: [day('s1', 'present', date)], lastEvaluatedKey: enc({ pk: 'cursor' }) });
      }),
      putItem,
    };
    const dataScope = {
      resolveScope: jest.fn<any>().mockResolvedValue({ type: 'school' }),
      filterByStudentScope: jest.fn((_s: any, arr: any[]) => arr),
    };
    const svc = new (AttendanceService as any)(ddb, {}, {}, dataScope);

    await expect(svc.recomputeMonthlyForSchool('sch-1', '2026-06', 'ay-1', ctx)).rejects.toThrow(/partial IEMiS export/);
    expect(putItem).not.toHaveBeenCalled();
  });
});

describe('AttendanceService.getIemisAttendanceExport (S5)', () => {
  it('shapes monthly aggregates into IEMiS rows with metadata', async () => {
    const { svc } = makeService([day('s1', 'present', '2026-06-10', 'Asha'), day('s2', 'absent', '2026-06-10', 'Bina')]);

    const out = await svc.getIemisAttendanceExport('sch-1', '2026-06', 'ay-1', ctx);

    expect(out.schoolId).toBe('sch-1');
    expect(out.yearMonth).toBe('2026-06');
    expect(typeof out.generatedAt).toBe('string');
    expect(out.rowCount).toBe(2);
    expect(out.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ studentId: 's1', studentName: 'Asha', presentDays: 1, absentDays: 0, totalSchoolDays: 1 }),
        expect.objectContaining({ studentId: 's2', studentName: 'Bina', presentDays: 0, absentDays: 1, totalSchoolDays: 1 }),
      ]),
    );
  });

  it('row-level scopes the export (section-scoped caller sees only their roster)', async () => {
    const { svc } = makeService(
      [day('s1', 'present', '2026-06-10'), day('s2', 'present', '2026-06-10')],
      { type: 'section', sectionIds: ['secA'], studentIds: ['s1'] },
    );

    const out = await svc.getIemisAttendanceExport('sch-1', '2026-06', 'ay-1', ctx);

    expect(out.rowCount).toBe(1);
    expect(out.rows.map((r: any) => r.studentId)).toEqual(['s1']);
  });

  it('enriches rows with school-local gradeLevel from the AY enrollment, omitting it when unknown', async () => {
    const byDate: Record<string, any[]> = {
      '2026-06-10': [day('s1', 'present', '2026-06-10', 'Asha'), day('s2', 'absent', '2026-06-10', 'Bina')],
    };
    const ddb = {
      getClient: jest.fn<any>().mockResolvedValue({}),
      queryGSI: jest.fn<any>((_client: any, _idx: string, _pk: string, sk: string) => {
        // The export's enrollment enrichment query uses sk `ENROLLMENT#{ayId}`.
        if (String(sk).startsWith('ENROLLMENT#')) {
          return Promise.resolve({
            items: [{ studentId: 's1', gradeLevel: '1' }], // s2 has no enrollment row → gradeLevel omitted
            lastEvaluatedKey: undefined,
          });
        }
        const date = String(_pk).split('#DATE#')[1];
        return Promise.resolve({ items: byDate[date] || [], lastEvaluatedKey: undefined });
      }),
      putItem: jest.fn<any>().mockResolvedValue(undefined),
    };
    const dataScope = {
      resolveScope: jest.fn<any>().mockResolvedValue({ type: 'school' }),
      filterByStudentScope: jest.fn((_s: any, arr: any[]) => arr),
    };
    const svc = new (AttendanceService as any)(ddb, {}, {}, dataScope);

    const out = await svc.getIemisAttendanceExport('sch-1', '2026-06', 'ay-1', ctx);

    const s1 = out.rows.find((r: any) => r.studentId === 's1');
    const s2 = out.rows.find((r: any) => r.studentId === 's2');
    expect(s1.gradeLevel).toBe('1');
    expect(s2.gradeLevel).toBeUndefined();
  });
});
