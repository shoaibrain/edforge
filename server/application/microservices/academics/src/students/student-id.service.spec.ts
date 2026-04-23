import { StudentIdService } from './student-id.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';

function stubDdbClient() {
  const counters = new Map<string, number>();
  return {
    atomicIncrement: jest.fn(async (_c: any, tenantId: string, key: string) => {
      const full = `${tenantId}|${key}`;
      const next = (counters.get(full) ?? 0) + 1;
      counters.set(full, next);
      return next;
    }),
    getClient: jest.fn(async () => ({} as any)),
    queryGSI: jest.fn(async () => ({ items: [], hasMore: false })),
  } as unknown as DynamoDBClientService;
}

describe('StudentIdService.generateStudentUniqueId', () => {
  it('formats USI as SCHOOLPREFIX-YEAR-00001 on first call', async () => {
    const ddb = stubDdbClient();
    const svc = new StudentIdService(ddb);

    const usi = await svc.generateStudentUniqueId('t1', 'school-1', 'WHS', 'jwt');
    const year = new Date().getFullYear();

    expect(usi).toBe(`WHS-${year}-00001`);
    expect(svc.validateStudentUniqueId(usi)).toBe(true);
  });

  it('produces 100 distinct USIs under 100 parallel calls for the same school+year', async () => {
    const ddb = stubDdbClient();
    const svc = new StudentIdService(ddb);

    const ids = await Promise.all(
      Array.from({ length: 100 }, () => svc.generateStudentUniqueId('t1', 'school-1', 'WHS', 'jwt')),
    );
    expect(new Set(ids).size).toBe(100);
  });

  it('falls back to first 3 chars of schoolId if schoolCode missing', async () => {
    const ddb = stubDdbClient();
    const svc = new StudentIdService(ddb);

    const usi = await svc.generateStudentUniqueId('t1', 'school-abc-123', undefined, 'jwt');
    expect(usi.startsWith('SCH-')).toBe(true);
  });

  it('sanitizes non-alphanumeric chars from schoolCode', async () => {
    const ddb = stubDdbClient();
    const svc = new StudentIdService(ddb);

    const usi = await svc.generateStudentUniqueId('t1', 'school-1', 'W-H-S!', 'jwt');
    const year = new Date().getFullYear();
    expect(usi).toBe(`WHS-${year}-00001`);
  });

  it('calls atomicIncrement once per generate call with entityType=COUNTER', async () => {
    const ddb = stubDdbClient();
    const svc = new StudentIdService(ddb);

    await svc.generateStudentUniqueId('t1', 'school-1', 'WHS', 'jwt');

    const ai = ddb.atomicIncrement as unknown as jest.Mock;
    expect(ai.mock.calls.length).toBe(1);
    expect(ai.mock.calls[0][3]).toBe(1); // delta
    expect(ai.mock.calls[0][4]).toEqual({ entityType: 'COUNTER' });
  });
});
