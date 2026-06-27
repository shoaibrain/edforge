/**
 * getDailyAttendanceSummary — section-granular overlay (S6 dashboard-truth).
 *
 * Post-collapse the daily SCH_ATTEND aggregate is present|excused|absent, so the
 * granular late/half_day/remote buckets are sourced from the SECTION layer as
 * informational overlays — but ONLY when includeSectionGranular is set (off by
 * default so the per-date trend loop pays no extra read). present/absent/excused
 * and the rate stay driven by SCH_ATTEND and are unaffected by the overlay.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { AttendanceService } from './attendance.service';

const ctx = { tenantId: 'ten-1', userId: 'u-1', jwtToken: 'jwt', email: 'a@b.c', role: 'TenantAdmin' } as any;

const sch = (studentId: string, status: string) => ({ studentId, status, schoolId: 'sch-1', academicYearId: 'ay-1', date: '2026-06-10' });
const sec = (studentId: string, sectionId: string, status: string) => ({ studentId, sectionId, status, schoolId: 'sch-1', academicYearId: 'ay-1', date: '2026-06-10' });

function makeService(schRows: any[], secRows: any[], scope: any = { type: 'school' }) {
  // Route queryGSI by SK prefix (arg index 3): SCH_ATTEND# / SEC_ATTEND# / ENROLLMENT#.
  const queryGSI = jest.fn<any>((_client: any, _idx: string, _pk: string, skValue: string) => {
    if (skValue === 'SCH_ATTEND#') return Promise.resolve({ items: schRows, lastEvaluatedKey: undefined });
    if (skValue === 'SEC_ATTEND#') return Promise.resolve({ items: secRows, lastEvaluatedKey: undefined });
    return Promise.resolve({ items: [], lastEvaluatedKey: undefined }); // enrollment (skip → record-count denominator)
  });
  const ddb = { getClient: jest.fn<any>().mockResolvedValue({}), queryGSI };
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
  return { svc, ddb };
}

const sawSectionRead = (ddb: any) => ddb.queryGSI.mock.calls.some((c: any[]) => c[3] === 'SEC_ATTEND#');

describe('getDailyAttendanceSummary — section-granular overlay (S6)', () => {
  it('OFF by default (trend path): no SEC_ATTEND read; section-derived present rows show late=0', async () => {
    const { svc, ddb } = makeService(
      [sch('s1', 'present'), sch('s2', 'present')], // section-derived daily aggregate (collapsed)
      [sec('s1', 'secA', 'late')],                  // section says s1 was late — but granular is OFF
    );

    const out = await svc.getDailyAttendanceSummary('sch-1', '2026-06-10', ctx, 'ay-1'); // no flag

    expect(out.present).toBe(2);
    expect(out.late).toBe(0);
    expect(sawSectionRead(ddb)).toBe(false); // trend loop pays nothing
  });

  it('ON: unions section late/half_day into the overlay; present partition unchanged', async () => {
    const { svc, ddb } = makeService(
      [sch('s1', 'present'), sch('s2', 'present')],
      [sec('s1', 'secA', 'late'), sec('s1', 'secB', 'present'), sec('s2', 'secA', 'half_day')],
    );

    const out = await svc.getDailyAttendanceSummary('sch-1', '2026-06-10', ctx, 'ay-1', undefined, true);

    expect(sawSectionRead(ddb)).toBe(true);
    expect(out.present).toBe(2); // exclusive partition unchanged (overlays don't move it)
    expect(out.late).toBe(1);    // s1 late in some section (distinct student)
    expect(out.halfDay).toBe(1); // s2 half-day
  });

  it('ON: a direct late row + the same student late in a section count once (set union, no double)', async () => {
    const { svc } = makeService(
      [sch('s1', 'late'), sch('s2', 'present')], // direct late row (legacy/@Post) for s1
      [sec('s1', 'secA', 'late')],               // section also marks s1 late
    );

    const out = await svc.getDailyAttendanceSummary('sch-1', '2026-06-10', ctx, 'ay-1', undefined, true);

    expect(out.late).toBe(1); // unioned to one distinct student
  });
});
