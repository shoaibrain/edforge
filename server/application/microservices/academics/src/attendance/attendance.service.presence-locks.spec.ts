/**
 * AttendanceService.getPresenceLocks (D4) — cross-section presence locks.
 *
 * For a school + date, returns one lock per student who physically attended ANY
 * section that day (first section wins), excluding absent/excused. Read-only;
 * the frontend uses it to lock already-present rows under daily_presence.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { AttendanceService } from './attendance.service';

const ctx = { tenantId: 'ten-1', userId: 'u-1', jwtToken: 'jwt', email: 'a@b.c', role: 'TenantAdmin' } as any;

const rec = (studentId: string, sectionId: string, status: string, courseName?: string) => ({
  studentId, sectionId, status, courseName, schoolId: 'sch-1', date: '2026-06-16',
});

function makeService(items: any[]) {
  const ddb = {
    getClient: jest.fn<any>().mockResolvedValue({}),
    queryGSI: jest.fn<any>().mockResolvedValue({ items, lastEvaluatedKey: undefined, hasMore: false }),
  };
  const svc = new (AttendanceService as any)(ddb, {}, {}, {});
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
    const svc = new (AttendanceService as any)(ddb, {}, {}, {});

    const res = await svc.getPresenceLocks('sch-1', '2026-06-16', ctx);

    expect(ddb.queryGSI).toHaveBeenCalledTimes(2);
    expect(res.locks).toHaveLength(2);
  });
});
