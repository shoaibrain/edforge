/**
 * Sprint D0a.1 (ENG-1) — IemisImportJobsService.list unit tests.
 *
 * The list method enumerates a school's IEMIS import jobs sorted by
 * createdAt descending. Pinned behaviors covered here:
 *   - empty result when no jobs match
 *   - sort order is createdAt desc (most recent first)
 *   - schoolId + since query filters propagate to the DDB filter expression
 *   - limit truncates and returns nextCursor when more results exist
 *   - cursor pagination resumes at the correct offset
 *   - hard cap of 200 enforced even when a larger limit is requested
 *   - nextCursor is undefined when the page contains the final results
 */

import { IemisImportJobsService } from './iemis-import-jobs.service';
import { IemisImportJob } from '../common/entities/iemis-import-job.entity';

describe('IemisImportJobsService.list (D0a.1)', () => {
  let dynamoDBClient: any;
  let service: IemisImportJobsService;

  const ctx = { tenantId: 'tenant-1', jwtToken: 'jwt' };

  function makeJob(overrides: Partial<IemisImportJob> = {}): IemisImportJob {
    const jobId = overrides.jobId ?? 'job-default';
    return {
      tenantId: 'tenant-1',
      entityKey: `IEMIS_JOB#${jobId}`,
      entityType: 'IEMIS_IMPORT_JOB',
      jobId,
      schoolId: 'school-1',
      status: 'succeeded',
      totalRows: 100,
      studentsCreated: 95,
      studentsEnrolled: 95,
      failed: 0,
      skipped: 5,
      findings: [],
      findingsTruncated: false,
      duplicates: [],
      duplicatesTruncated: false,
      createdAt: '2026-05-19T10:00:00.000Z',
      createdBy: 'admin',
      updatedAt: '2026-05-19T10:00:00.000Z',
      updatedBy: 'admin',
      version: 1,
      ...overrides,
    };
  }

  beforeEach(() => {
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
      query: jest.fn(),
    };
    service = new IemisImportJobsService(dynamoDBClient);
  });

  it('returns an empty result when no jobs match the school', async () => {
    dynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
    const result = await service.list('school-1', {}, ctx);
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeUndefined();
  });

  it('sorts returned jobs by createdAt descending (most recent first)', async () => {
    const jobs = [
      makeJob({ jobId: 'a', createdAt: '2026-05-19T08:00:00.000Z' }),
      makeJob({ jobId: 'b', createdAt: '2026-05-19T10:00:00.000Z' }),
      makeJob({ jobId: 'c', createdAt: '2026-05-19T09:00:00.000Z' }),
    ];
    dynamoDBClient.query.mockResolvedValue({ items: jobs, hasMore: false });
    const result = await service.list('school-1', {}, ctx);
    expect(result.items.map((j) => j.jobId)).toEqual(['b', 'c', 'a']);
  });

  it('passes the schoolId filter to the DDB query', async () => {
    dynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
    await service.list('school-xyz', {}, ctx);

    // query(client, tenantId, skPrefix, filterExpression, attrValues, attrNames, limit, cursor)
    const args = dynamoDBClient.query.mock.calls[0];
    expect(args[1]).toBe('tenant-1');
    expect(args[2]).toBe('IEMIS_JOB#');
    expect(args[3]).toContain('schoolId = :schoolId');
    expect(args[4]).toMatchObject({ ':schoolId': 'school-xyz' });
  });

  it('passes the since filter to the DDB query when provided', async () => {
    dynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
    await service.list(
      'school-1',
      { since: '2026-05-01T00:00:00.000Z' },
      ctx,
    );

    const args = dynamoDBClient.query.mock.calls[0];
    expect(args[3]).toContain('schoolId = :schoolId');
    expect(args[3]).toContain('createdAt >= :since');
    expect(args[4]).toMatchObject({
      ':schoolId': 'school-1',
      ':since': '2026-05-01T00:00:00.000Z',
    });
  });

  it('omits the since filter when not provided', async () => {
    dynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
    await service.list('school-1', {}, ctx);

    const args = dynamoDBClient.query.mock.calls[0];
    expect(args[3]).not.toContain(':since');
    expect(args[4]).not.toHaveProperty(':since');
  });

  it('truncates to the requested limit and returns a nextCursor', async () => {
    const jobs = Array.from({ length: 30 }, (_, i) =>
      makeJob({
        jobId: `j${i}`,
        createdAt: `2026-05-19T${String(i).padStart(2, '0')}:00:00.000Z`,
      }),
    );
    dynamoDBClient.query.mockResolvedValue({ items: jobs, hasMore: false });
    const result = await service.list('school-1', { limit: 10 }, ctx);
    expect(result.items).toHaveLength(10);
    expect(result.nextCursor).toBeDefined();
    // Most recent first.
    expect(result.items[0].jobId).toBe('j29');
  });

  it('resumes pagination from a returned cursor', async () => {
    const jobs = Array.from({ length: 30 }, (_, i) =>
      makeJob({
        jobId: `j${i}`,
        createdAt: `2026-05-19T${String(i).padStart(2, '0')}:00:00.000Z`,
      }),
    );
    dynamoDBClient.query.mockResolvedValue({ items: jobs, hasMore: false });

    const firstPage = await service.list('school-1', { limit: 10 }, ctx);
    expect(firstPage.items[0].jobId).toBe('j29');
    expect(firstPage.items[9].jobId).toBe('j20');

    const secondPage = await service.list(
      'school-1',
      { limit: 10, cursor: firstPage.nextCursor },
      ctx,
    );
    expect(secondPage.items).toHaveLength(10);
    expect(secondPage.items[0].jobId).toBe('j19');
    expect(secondPage.items[9].jobId).toBe('j10');
    expect(secondPage.nextCursor).toBeDefined();

    const thirdPage = await service.list(
      'school-1',
      { limit: 10, cursor: secondPage.nextCursor },
      ctx,
    );
    expect(thirdPage.items).toHaveLength(10);
    expect(thirdPage.items[0].jobId).toBe('j9');
    expect(thirdPage.items[9].jobId).toBe('j0');
    expect(thirdPage.nextCursor).toBeUndefined();
  });

  it('caps the effective limit at 200 even when a larger value is requested', async () => {
    const jobs = Array.from({ length: 250 }, (_, i) =>
      makeJob({
        jobId: `j${i}`,
        createdAt: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
      }),
    );
    dynamoDBClient.query.mockResolvedValue({ items: jobs, hasMore: false });
    const result = await service.list('school-1', { limit: 500 }, ctx);
    expect(result.items.length).toBeLessThanOrEqual(200);
    expect(result.nextCursor).toBeDefined();
  });

  it('returns no nextCursor when all results fit within the page', async () => {
    const jobs = [makeJob({ jobId: 'only' })];
    dynamoDBClient.query.mockResolvedValue({ items: jobs, hasMore: false });
    const result = await service.list('school-1', { limit: 50 }, ctx);
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeUndefined();
  });

  it('treats an invalid cursor as offset 0 (returns first page rather than 5xx)', async () => {
    const jobs = Array.from({ length: 5 }, (_, i) =>
      makeJob({
        jobId: `j${i}`,
        createdAt: `2026-05-19T${String(i).padStart(2, '0')}:00:00.000Z`,
      }),
    );
    dynamoDBClient.query.mockResolvedValue({ items: jobs, hasMore: false });
    const result = await service.list(
      'school-1',
      { cursor: '!!!not-base64!!!' },
      ctx,
    );
    expect(result.items).toHaveLength(5);
    expect(result.items[0].jobId).toBe('j4');
  });
});
