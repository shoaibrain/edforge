/**
 * BoardExamsService spec — Sprint GB2.2.
 *
 * Covers: idempotent seed-on-empty, no top-up on non-empty, grade-gating
 * (grade-10 school → BLE+SEE only, NEB_11/12 excluded; grade-5 school → none),
 * GENERIC no-op, and concurrency (ConditionalCheckFailed → skip + re-query).
 *
 * DDB + identity clients are mocked; the lazy TenantMetadataReader getter is
 * patched so no AWS creds are needed. Archetype data is the REAL
 * `getArchetypeDefaults('PABSON').boardExams`, so the test validates the actual
 * BLE/SEE/NEB definitions.
 */

import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { BoardExamsService } from './board-exams.service';
import { RequestContext } from '../common/entities/base.entity';
import type { BoardExamEntity } from '../common/entities/board-exam.entity';

const TENANT = '11111111-1111-1111-1111-111111111111';
const SCHOOL = '22222222-2222-2222-2222-222222222222';

const ctx: RequestContext = {
  userId: 'user-uuid',
  tenantId: TENANT,
  email: 'op@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt',
};

function makeService(opts: {
  archetype?: string;
  archetypeThrows?: boolean;
  gradeEnd?: string;
  getSchoolThrows?: boolean;
  queryReturns?: BoardExamEntity[][]; // sequenced query() results
  putItem?: jest.Mock;
}) {
  const queryQueue = [...(opts.queryReturns ?? [[], []])];
  const query = jest.fn(async () => ({
    items: queryQueue.length > 1 ? queryQueue.shift()! : queryQueue[0] ?? [],
    hasMore: false,
  }));
  const putItem = opts.putItem ?? jest.fn(async () => undefined);
  const getClient = jest.fn(async () => ({}));
  const dynamoDBClient = { getClient, query, putItem } as any;

  const getSchool = jest.fn(async () => {
    if (opts.getSchoolThrows) throw new Error('identity 5xx');
    return { schoolId: SCHOOL, gradeRange: { start: '1', end: opts.gradeEnd ?? '10' } };
  });
  const identityClient = { getSchool } as any;

  const service = new BoardExamsService(dynamoDBClient, identityClient);
  (service as any)._tenantMetadataReader = {
    getArchetype: jest.fn(async () => {
      // throw = infra/permission failure; return value = resolved archetype
      // (undefined = not provisioned).
      if (opts.archetypeThrows) throw new Error('metadata lookup failed');
      return opts.archetype;
    }),
  };
  return { service, query, putItem, getSchool };
}

const seededExamTypes = (putItem: jest.Mock): string[] =>
  putItem.mock.calls.map((c: any[]) => (c[1] as BoardExamEntity).examType);

describe('BoardExamsService.getOrSeedBoardExams', () => {
  it('seeds PABSON board exams in scope for a grade-10 school (BLE+SEE; NEB_11/12 excluded)', async () => {
    const putItem = jest.fn(async () => undefined);
    const { service } = makeService({ archetype: 'PABSON', gradeEnd: '10', putItem });

    await service.getOrSeedBoardExams(SCHOOL, ctx);

    const types = seededExamTypes(putItem);
    expect(types.sort()).toEqual(['BLE', 'SEE']);
    // Every write is guarded against double-seed.
    for (const call of putItem.mock.calls as unknown as any[][]) {
      expect(call[2]).toBe('attribute_not_exists(entityKey)');
    }
  });

  it('does NOT top up a non-empty set (operator-owned)', async () => {
    const existing = [{ examType: 'BLE' } as BoardExamEntity];
    const putItem = jest.fn(async () => undefined);
    const { service } = makeService({
      archetype: 'PABSON',
      gradeEnd: '10',
      queryReturns: [existing],
      putItem,
    });

    const result = await service.getOrSeedBoardExams(SCHOOL, ctx);

    expect(putItem).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it('grade-gates: a grade-5-max school gets no board exams', async () => {
    const putItem = jest.fn(async () => undefined);
    const { service, getSchool } = makeService({ archetype: 'PABSON', gradeEnd: '5', putItem });

    await service.getOrSeedBoardExams(SCHOOL, ctx);

    expect(getSchool).toHaveBeenCalled();
    expect(putItem).not.toHaveBeenCalled();
  });

  it('GENERIC archetype is a no-op (no board exams, no getSchool call)', async () => {
    const putItem = jest.fn(async () => undefined);
    const { service, getSchool } = makeService({ archetype: 'GENERIC', putItem });

    const result = await service.getOrSeedBoardExams(SCHOOL, ctx);

    expect(putItem).not.toHaveBeenCalled();
    expect(getSchool).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('missing/unknown archetype seeds nothing (fail-soft)', async () => {
    const putItem = jest.fn(async () => undefined);
    const { service } = makeService({ archetypeThrows: true, putItem });

    const result = await service.getOrSeedBoardExams(SCHOOL, ctx);

    expect(putItem).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('concurrency: ConditionalCheckFailed on a write is skipped, then re-queries the winner rows', async () => {
    const winner = [
      { examType: 'BLE' } as BoardExamEntity,
      { examType: 'SEE' } as BoardExamEntity,
    ];
    // existing-check empty, then re-query returns the concurrent winner's rows.
    const putItem = jest.fn(async () => {
      const err = new Error('exists') as Error & { name: string };
      err.name = 'ConditionalCheckFailedException';
      throw err;
    });
    const { service } = makeService({
      archetype: 'PABSON',
      gradeEnd: '10',
      queryReturns: [[], winner],
      putItem,
    });

    const result = await service.getOrSeedBoardExams(SCHOOL, ctx);

    expect(putItem).toHaveBeenCalled(); // attempted
    expect(result).toBe(winner); // returned the re-queried winner rows
  });

  it('getSchool failure gates to 0 → seeds nothing rather than guessing high', async () => {
    const putItem = jest.fn(async () => undefined);
    const { service } = makeService({ archetype: 'PABSON', getSchoolThrows: true, putItem });

    await service.getOrSeedBoardExams(SCHOOL, ctx);

    expect(putItem).not.toHaveBeenCalled();
  });
});
