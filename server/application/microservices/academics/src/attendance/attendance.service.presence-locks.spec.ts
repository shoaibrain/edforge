/**
 * AttendanceService.getPresenceLocks (D4) — cross-section presence locks.
 *
 * For a school + date, returns one lock per student who physically attended ANY
 * section that day (deduped by sectionId order), excluding absent/excused, then
 * row-level-scoped to the caller (a section-scoped Teacher sees only their own
 * roster's students). Read-only; the frontend uses it to lock already-present
 * rows under daily_presence.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { AttendanceService } from './attendance.service';

const ctx = { tenantId: 'ten-1', userId: 'u-1', jwtToken: 'jwt', email: 'a@b.c', role: 'TenantAdmin' } as any;

const rec = (studentId: string, sectionId: string, status: string, courseName?: string) => ({
  studentId, sectionId, status, courseName, schoolId: 'sch-1', date: '2026-06-16',
});

// Faithful-enough data-scope mock: school scope passes all through; section
// scope keeps only items whose studentId is in scope.studentIds (mirrors the
// real filterByStudentScope, incl. fail-closed on empty studentIds).
function makeDataScope(scope: any = { type: 'school' }) {
  return {
    resolveScope: jest.fn<any>().mockResolvedValue(scope),
    filterByStudentScope: jest.fn((s: any, items: any[]) => {
      if (s.type === 'school') return items;
      if (!s.studentIds || s.studentIds.length === 0) return [];
      const set = new Set(s.studentIds);
      return items.filter((i: any) => i.studentId && set.has(i.studentId));
    }),
  };
}

function makeService(items: any[], scope?: any) {
  const ddb = {
    getClient: jest.fn<any>().mockResolvedValue({}),
    queryGSI: jest.fn<any>().mockResolvedValue({ items, lastEvaluatedKey: undefined, hasMore: false }),
  };
  const svc = new (AttendanceService as any)(ddb, {}, {}, makeDataScope(scope));
  return { svc, ddb };
}

describe('AttendanceService.getPresenceLocks (D4)', () => {
  it('returns one lock per attended student — the first section wins', async () => {
    const { svc } = makeService([
      rec('s1', 'secA', 'present', 'Math'),
      rec('s1', 'secB', 'present', 'Science'), // later section ignored (first wins)
      rec('s2', 'secA', 'late', 'Math'),       // late = physically attended → locks
    ]);

    const res = await svc.getPresenceLocks('sch-1', '2026-06-16', ctx);

    expect(res.schoolId).toBe('sch-1');
    expect(res.date).toBe('2026-06-16');
    expect(res.locks).toHaveLength(2);
    expect(res.locks.find((l: any) => l.studentId === 's1')).toEqual({
      studentId: 's1', lockedBySectionId: 'secA', lockedBySectionName: 'Math', status: 'present',
    });
    expect(res.locks.find((l: any) => l.studentId === 's2').status).toBe('late');
  });

  it('treats half_day / remote / early_departure as attended (they lock too)', async () => {
    const { svc } = makeService([
      rec('s1', 'secA', 'half_day', 'Math'),
      rec('s2', 'secA', 'remote', 'Math'),
      rec('s3', 'secA', 'early_departure', 'Math'),
    ]);

    const res = await svc.getPresenceLocks('sch-1', '2026-06-16', ctx);

    expect(res.locks.map((l: any) => l.studentId).sort()).toEqual(['s1', 's2', 's3']);
  });

  it('excludes absent and excused (not physically present → no lock)', async () => {
    const { svc } = makeService([
      rec('s1', 'secA', 'absent', 'Math'),
      rec('s2', 'secA', 'excused', 'Math'),
    ]);

    const res = await svc.getPresenceLocks('sch-1', '2026-06-16', ctx);

    expect(res.locks).toHaveLength(0);
  });

  it('row-level scopes locks to the caller (section-scoped Teacher sees only their roster)', async () => {
    // Two students present school-wide, but the teacher's scope only covers s1.
    const { svc } = makeService(
      [rec('s1', 'secA', 'present', 'Math'), rec('s2', 'secB', 'present', 'Science')],
      { type: 'section', sectionIds: ['secA'], studentIds: ['s1'] },
    );

    const res = await svc.getPresenceLocks('sch-1', '2026-06-16', ctx);

    // s2 is present elsewhere but NOT on the teacher's roster → not disclosed.
    expect(res.locks.map((l: any) => l.studentId)).toEqual(['s1']);
  });

  it('drains multiple GSI pages (cursor decode)', async () => {
    const ddb = {
      getClient: jest.fn<any>().mockResolvedValue({}),
      queryGSI: jest.fn<any>()
        .mockResolvedValueOnce({
          items: [rec('s1', 'secA', 'present', 'Math')],
          lastEvaluatedKey: Buffer.from(JSON.stringify({ k: 1 })).toString('base64'),
        })
        .mockResolvedValueOnce({ items: [rec('s2', 'secB', 'present', 'Science')], lastEvaluatedKey: undefined }),
    };
    const svc = new (AttendanceService as any)(ddb, {}, {}, makeDataScope());

    const res = await svc.getPresenceLocks('sch-1', '2026-06-16', ctx);

    expect(ddb.queryGSI).toHaveBeenCalledTimes(2);
    expect(res.locks).toHaveLength(2);
  });
});
