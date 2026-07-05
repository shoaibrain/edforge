/**
 * SiblingCountResolver — EPIC-FB FB-5.1.
 *
 * Pins the count DEFINITION (includes the subject student; only
 * status==='active' siblings count; missing status counts as not active),
 * the full degrade matrix (no family / 404-or-transport null / unexpected
 * throw → 0, never a rejection), and the per-request memo.
 */

import { Logger } from '@nestjs/common';
import { SiblingCountResolver, SiblingCountMemo } from './sibling-count.resolver';

const ctx = {
  tenantId: 'tenant-uuid',
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
} as any;

const SCHOOL_ID = 'school-uuid';
const STUDENT_ID = 'student-uuid';

function buildResolver(getStudentFamily: jest.Mock) {
  return {
    resolver: new SiblingCountResolver({ getStudentFamily } as any),
    getStudentFamily,
  };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SiblingCountResolver.getActiveSiblingCount (FB-5.1)', () => {
  it('a 2-child family counts 2 — subject INCLUDED, so minSiblings:2 matches both children', async () => {
    const { resolver } = buildResolver(
      jest.fn().mockResolvedValue({
        family: { id: 'fam-1', name: 'Rai family' },
        siblings: [{ studentId: 'sibling-1', studentName: 'Bikash Rai', status: 'active' }],
      }),
    );

    await expect(
      resolver.getActiveSiblingCount(STUDENT_ID, SCHOOL_ID, ctx),
    ).resolves.toBe(2);
  });

  it('non-active siblings are excluded; the subject still counts unconditionally', async () => {
    const { resolver } = buildResolver(
      jest.fn().mockResolvedValue({
        family: { id: 'fam-1' },
        siblings: [
          { studentId: 's-1', status: 'active' },
          { studentId: 's-2', status: 'withdrawn' },
          { studentId: 's-3', status: 'graduated' },
          { studentId: 's-4', status: 'active' },
        ],
      }),
    );

    // subject (1) + 2 active siblings.
    await expect(
      resolver.getActiveSiblingCount(STUDENT_ID, SCHOOL_ID, ctx),
    ).resolves.toBe(3);
  });

  it('a sibling with MISSING status counts as not active (mixed-version rollout: prefer missing a discount over an unearned one)', async () => {
    const { resolver } = buildResolver(
      jest.fn().mockResolvedValue({
        family: { id: 'fam-1' },
        siblings: [{ studentId: 's-1', studentName: 'No Status' }],
      }),
    );

    await expect(
      resolver.getActiveSiblingCount(STUDENT_ID, SCHOOL_ID, ctx),
    ).resolves.toBe(1);
  });

  it('siblings absent entirely (pre-FB-5.1 academics response shape) → subject-only count of 1', async () => {
    const { resolver } = buildResolver(
      jest.fn().mockResolvedValue({ family: { id: 'fam-1' } }),
    );

    await expect(
      resolver.getActiveSiblingCount(STUDENT_ID, SCHOOL_ID, ctx),
    ).resolves.toBe(1);
  });

  describe('degrade matrix — 0, never a rejection', () => {
    it('unlinked student (family: null) → 0', async () => {
      const { resolver } = buildResolver(
        jest.fn().mockResolvedValue({ family: null, siblings: [] }),
      );
      await expect(
        resolver.getActiveSiblingCount(STUDENT_ID, SCHOOL_ID, ctx),
      ).resolves.toBe(0);
    });

    it('client null (academics 404 — flag off — or transport failure) → 0', async () => {
      const { resolver } = buildResolver(jest.fn().mockResolvedValue(null));
      await expect(
        resolver.getActiveSiblingCount(STUDENT_ID, SCHOOL_ID, ctx),
      ).resolves.toBe(0);
    });

    it('client THROWS unexpectedly → 0 + WARN (a family-service outage must never 5xx generation)', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const { resolver } = buildResolver(jest.fn().mockRejectedValue(new Error('boom')));

      await expect(
        resolver.getActiveSiblingCount(STUDENT_ID, SCHOOL_ID, ctx),
      ).resolves.toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });
  });

  describe('per-request memo', () => {
    it('repeat resolutions for the same (tenant, school, student) are served from the memo — one HTTP hop', async () => {
      const { resolver, getStudentFamily } = buildResolver(
        jest.fn().mockResolvedValue({
          family: { id: 'fam-1' },
          siblings: [{ studentId: 's-1', status: 'active' }],
        }),
      );
      const memo: SiblingCountMemo = new Map();

      await expect(resolver.getActiveSiblingCount(STUDENT_ID, SCHOOL_ID, ctx, memo)).resolves.toBe(2);
      await expect(resolver.getActiveSiblingCount(STUDENT_ID, SCHOOL_ID, ctx, memo)).resolves.toBe(2);

      expect(getStudentFamily).toHaveBeenCalledTimes(1);
      expect(memo.get(`${ctx.tenantId}#${SCHOOL_ID}#${STUDENT_ID}`)).toBe(2);
    });

    it('negative results (0) memoize too — a no-family student is not re-resolved within a run', async () => {
      const { resolver, getStudentFamily } = buildResolver(
        jest.fn().mockResolvedValue({ family: null, siblings: [] }),
      );
      const memo: SiblingCountMemo = new Map();

      await resolver.getActiveSiblingCount(STUDENT_ID, SCHOOL_ID, ctx, memo);
      await resolver.getActiveSiblingCount(STUDENT_ID, SCHOOL_ID, ctx, memo);

      expect(getStudentFamily).toHaveBeenCalledTimes(1);
    });
  });
});
