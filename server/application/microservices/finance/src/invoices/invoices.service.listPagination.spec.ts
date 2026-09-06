import { InvoicesService } from './invoices.service';
import { InvoiceEntity } from '../common/entities/invoice.entity';
import { decodeCursor } from '../common/entities/base.entity';

/**
 * Issue #466 — filtered invoice lists must not starve.
 *
 * The pre-existing billingSource spec mocks `queryGSI` to return an empty
 * page and asserts only the composed filter string, so a correct filter on
 * a starved page passes green. These tests instead model DynamoDB's real
 * semantics: `Limit` caps the rows READ, the FilterExpression is applied
 * afterwards, and `LastEvaluatedKey` reflects the last row read — not the
 * last row matched.
 */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SCHOOL_ID = '22222222-2222-2222-2222-222222222222';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

/** One invoice row. `agreementId` present == agreement-priced. */
function entity(i: number, opts: { agreement?: boolean; studentId?: string } = {}): InvoiceEntity {
  const seq = String(i).padStart(4, '0');
  const studentId = opts.studentId ?? 'student-1';
  return {
    tenantId: TENANT_ID,
    entityKey: `INVOICE#${SCHOOL_ID}#inv-${seq}`,
    invoiceId: `inv-${seq}`,
    invoiceNumber: `INV-420-2609-${seq}`,
    schoolId: SCHOOL_ID,
    studentId,
    status: 'issued',
    academicYear: '2083-academic-year',
    createdAt: `2026-09-06T00:00:${seq.slice(-2)}.000Z`,
    lineItems: [],
    gsi1pk: `TENANT#${TENANT_ID}#SCHOOL#${SCHOOL_ID}`,
    gsi1sk: `INVOICE#issued#2026-10-${seq.slice(-2)}`,
    gsi2pk: `TENANT#${TENANT_ID}#STUDENT#${studentId}`,
    gsi2sk: `INVOICE#2026-09-${seq.slice(-2)}`,
    ...(opts.agreement ? { agreementId: 'agr-1', feeOverrideMode: 'agreement' } : {}),
  } as unknown as InvoiceEntity;
}

/**
 * A `queryGSI` stand-in with DynamoDB's ordering guarantees:
 *   1. seek to the row after `exclusiveStartKey`
 *   2. read exactly `limit` rows
 *   3. THEN drop the ones the filter rejects
 *   4. report `LastEvaluatedKey` from the last row read
 */
function fakeQueryGSI(allRows: InvoiceEntity[]) {
  return jest.fn(async (
    _client: unknown, indexName: string, pkValue: string, _sk: string, _op: string,
    filterExpression: string | undefined,
    _values: unknown, _names: unknown,
    limit: number, _forward: boolean,
    exclusiveStartKey: Record<string, any> | undefined,
  ) => {
    const slotKey = `gsi${indexName.toLowerCase().replace(/^gsi/, '')}pk`;
    // A query only ever sees rows in the partition it addressed.
    const partition = allRows.filter(r => (r as any)[slotKey] === pkValue);

    let start = 0;
    if (exclusiveStartKey?.entityKey) {
      const at = partition.findIndex(e => (e as any).entityKey === exclusiveStartKey.entityKey);
      start = at >= 0 ? at + 1 : 0;
    }
    const read = partition.slice(start, start + limit);
    const matched = read.filter(row => {
      if (!filterExpression) return true;
      if (filterExpression.includes('attribute_exists(agreementId)')) return !!(row as any).agreementId;
      if (filterExpression.includes('attribute_not_exists(agreementId)')) return !(row as any).agreementId;
      return true;
    });
    const lastRead = read[read.length - 1] as any;
    const exhausted = start + read.length >= partition.length;
    const slot = indexName.toLowerCase().replace(/^gsi/, '');
    const lek = exhausted || !lastRead ? undefined : {
      tenantId: lastRead.tenantId,
      entityKey: lastRead.entityKey,
      [`gsi${slot}pk`]: lastRead[`gsi${slot}pk`],
      [`gsi${slot}sk`]: lastRead[`gsi${slot}sk`],
    };
    return {
      items: matched,
      lastEvaluatedKey: lek ? Buffer.from(JSON.stringify(lek)).toString('base64') : undefined,
      hasMore: !!lek,
    };
  });
}

function buildService(partition: InvoiceEntity[]) {
  const dynamoDBClient: any = {
    getClient: jest.fn().mockResolvedValue({}),
    getItem: jest.fn().mockResolvedValue(null),
    queryGSI: fakeQueryGSI(partition),
  };
  const service = new InvoicesService(
    dynamoDBClient,
    {} as any,
    { getSchoolName: jest.fn().mockResolvedValue('Test School') } as any,
    {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  return { service, dynamoDBClient };
}

describe('InvoicesService — filtered list pagination (#466)', () => {
  describe('list() / GSI1', () => {
    // 4 agreement rows buried at the very end of a 300-row partition: with a
    // single Limit-50 page the filter sees only rows 0-49 and returns none.
    const partition = [
      ...Array.from({ length: 296 }, (_, i) => entity(i)),
      entity(296, { agreement: true }),
      entity(297, { agreement: true }),
      entity(298, { agreement: true }),
      entity(299, { agreement: true }),
    ];

    it('returns agreement rows that sit far beyond the first page', async () => {
      const { service } = buildService(partition);
      const result = await service.list(SCHOOL_ID, ctx, { billingSource: 'agreement' });

      expect(result.items).toHaveLength(4);
      expect(result.items.map(i => i.invoiceNumber)).toEqual([
        'INV-420-2609-0296', 'INV-420-2609-0297',
        'INV-420-2609-0298', 'INV-420-2609-0299',
      ]);
      expect(result.hasMore).toBe(false);
    });

    it('reads more than one page to fill the request', async () => {
      const { service, dynamoDBClient } = buildService(partition);
      await service.list(SCHOOL_ID, ctx, { billingSource: 'agreement' });
      expect(dynamoDBClient.queryGSI.mock.calls.length).toBeGreaterThan(1);
    });

    it('leaves the unfiltered path as a single query with the caller limit', async () => {
      const { service, dynamoDBClient } = buildService(partition);
      const result = await service.list(SCHOOL_ID, ctx, { limit: 50 });

      expect(dynamoDBClient.queryGSI).toHaveBeenCalledTimes(1);
      const args = dynamoDBClient.queryGSI.mock.calls[0];
      expect(args[5]).toBeUndefined();  // no FilterExpression
      expect(args[8]).toBe(50);         // caller's limit, unmodified
      expect(result.items).toHaveLength(50);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('cursor correctness', () => {
    // Only every third row matches, so filling a 10-row page requires
    // reading ~30 rows and truncating mid-read-page. The cursor must then
    // resume at the next MATCHING row, not at the read boundary.
    const partition = Array.from({ length: 90 }, (_, i) => entity(i, { agreement: i % 3 === 0 }));
    const matching = partition.filter(e => (e as any).agreementId);

    it('resumes after the last row returned, losing and repeating nothing', async () => {
      const { service } = buildService(partition);

      const page1 = await service.list(SCHOOL_ID, ctx, { billingSource: 'agreement', limit: 10 });
      expect(page1.items).toHaveLength(10);
      expect(page1.hasMore).toBe(true);
      expect(page1.lastEvaluatedKey).toBeDefined();

      const page2 = await service.list(SCHOOL_ID, ctx, {
        billingSource: 'agreement', limit: 10, cursor: page1.lastEvaluatedKey,
      });
      const page3 = await service.list(SCHOOL_ID, ctx, {
        billingSource: 'agreement', limit: 10, cursor: page2.lastEvaluatedKey,
      });

      const seen = [...page1.items, ...page2.items, ...page3.items].map(i => i.invoiceNumber);
      expect(seen).toHaveLength(30);
      expect(new Set(seen).size).toBe(30);
      expect(seen).toEqual(matching.map(e => (e as any).invoiceNumber));
      expect(page3.hasMore).toBe(false);
    });

    it('points the cursor at the last returned row, not the read-page boundary', async () => {
      const { service } = buildService(partition);
      const page1 = await service.list(SCHOOL_ID, ctx, { billingSource: 'agreement', limit: 10 });
      const decoded = decodeCursor(page1.lastEvaluatedKey);
      // 10th match is row 27 — the read page reached row 29, so a cursor at
      // the read boundary would have skipped matches 28 and 29's neighbours.
      expect(decoded?.entityKey).toBe(`INVOICE#${SCHOOL_ID}#inv-0027`);
    });
  });

  describe('listForStudents() / GSI2 — parent portal', () => {
    const partition = [
      ...Array.from({ length: 60 }, (_, i) => entity(i, { studentId: 'child-a' })),
      entity(60, { studentId: 'child-a', agreement: true }),
      ...Array.from({ length: 60 }, (_, i) => entity(200 + i, { studentId: 'child-b' })),
      entity(299, { studentId: 'child-b', agreement: true }),
    ];

    it('finds each child\'s agreement invoice past the first page', async () => {
      const { service } = buildService(partition);
      const result = await service.listForStudents(
        SCHOOL_ID, ['child-a', 'child-b'], ctx, { billingSource: 'agreement' },
      );
      expect(result.items).toHaveLength(2);
      expect(result.items.map(i => i.invoiceNumber).sort()).toEqual([
        'INV-420-2609-0060', 'INV-420-2609-0299',
      ]);
    });

    it('returns a usable cursor so a parent can page past the first page', async () => {
      const { service } = buildService(partition);
      const page1 = await service.listForStudents(SCHOOL_ID, ['child-a', 'child-b'], ctx, { limit: 20 });

      expect(page1.items).toHaveLength(20);
      expect(page1.hasMore).toBe(true);
      // Previously `hasMore` was returned with no cursor at all.
      expect(page1.lastEvaluatedKey).toBeDefined();

      const page2 = await service.listForStudents(SCHOOL_ID, ['child-a', 'child-b'], ctx, {
        limit: 20, cursor: page1.lastEvaluatedKey,
      });
      expect(page2.items.length).toBeGreaterThan(0);

      const ids1 = page1.items.map(i => i.id);
      const ids2 = page2.items.map(i => i.id);
      expect(ids1.some(id => ids2.includes(id))).toBe(false);
    });

    it('keeps each child on their own cursor', async () => {
      const { service } = buildService(partition);
      const page1 = await service.listForStudents(SCHOOL_ID, ['child-a', 'child-b'], ctx, { limit: 20 });
      const decoded = decodeCursor(page1.lastEvaluatedKey);
      expect(decoded?.v).toBe(2);
      expect(Object.keys(decoded?.s ?? {}).length).toBeGreaterThan(0);
    });
  });
});
