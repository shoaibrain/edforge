import { RequestScopedSchoolCache } from './identity-client.service';
import type { SchoolResponse } from './identity-client.service';
import type { RequestContext } from '@app/http-client';

const makeSchool = (id: string): SchoolResponse => ({
  schoolId: id,
  schoolCode: `CODE-${id}`,
  name: `School ${id}`,
  schoolType: 'primary',
  gradeRange: { start: '1', end: '10' },
  status: 'active',
  timezone: 'Asia/Kathmandu',
  locale: 'ne-NP',
  academicCalendarType: 'semester',
});

const ctx: RequestContext = {
  tenantId: 't1',
  userId: 'u1',
  jwtToken: 'jwt',
  userRole: 'TenantAdmin',
  userName: 'admin',
} as any;

describe('RequestScopedSchoolCache', () => {
  it('fetches once for the same schoolId across repeated sequential calls', async () => {
    const getSchool = jest.fn(async (id: string) => makeSchool(id));
    const cache = new RequestScopedSchoolCache({ getSchool } as any);

    for (let i = 0; i < 50; i++) {
      const r = await cache.getSchool('school-1', ctx);
      expect(r.schoolId).toBe('school-1');
    }

    expect(getSchool).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toEqual({ hits: 49, misses: 1 });
  });

  it('deduplicates concurrent calls for the same schoolId to one in-flight fetch', async () => {
    let resolveGet: ((s: SchoolResponse) => void) | undefined;
    const getSchool = jest.fn(
      () =>
        new Promise<SchoolResponse>((resolve) => {
          resolveGet = resolve;
        }),
    );
    const cache = new RequestScopedSchoolCache({ getSchool } as any);

    const promises = Array.from({ length: 20 }, () => cache.getSchool('school-1', ctx));
    resolveGet!(makeSchool('school-1'));
    const results = await Promise.all(promises);

    expect(getSchool).toHaveBeenCalledTimes(1);
    results.forEach((r) => expect(r.schoolId).toBe('school-1'));
  });

  it('separates cache entries per schoolId', async () => {
    const getSchool = jest.fn(async (id: string) => makeSchool(id));
    const cache = new RequestScopedSchoolCache({ getSchool } as any);

    const a = await cache.getSchool('school-a', ctx);
    const b = await cache.getSchool('school-b', ctx);
    const a2 = await cache.getSchool('school-a', ctx);

    expect(a.schoolId).toBe('school-a');
    expect(b.schoolId).toBe('school-b');
    expect(a2).toBe(a);
    expect(getSchool).toHaveBeenCalledTimes(2);
  });

  it('evicts failures so subsequent callers retry', async () => {
    let firstCall = true;
    const getSchool = jest.fn(async () => {
      if (firstCall) {
        firstCall = false;
        throw new Error('transient 503');
      }
      return makeSchool('school-1');
    });
    const cache = new RequestScopedSchoolCache({ getSchool } as any);

    await expect(cache.getSchool('school-1', ctx)).rejects.toThrow('transient 503');

    const r = await cache.getSchool('school-1', ctx);
    expect(r.schoolId).toBe('school-1');
    expect(getSchool).toHaveBeenCalledTimes(2);
  });

  it('returns hit count matching 779-row-like IEMIS access pattern', async () => {
    const getSchool = jest.fn(async (id: string) => makeSchool(id));
    const cache = new RequestScopedSchoolCache({ getSchool } as any);

    await Promise.all(
      Array.from({ length: 779 }, () => cache.getSchool('saraswati-school', ctx)),
    );

    expect(getSchool).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toEqual({ hits: 778, misses: 1 });
  });
});
