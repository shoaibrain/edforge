/**
 * DynamoDBClientService.query — pagination semantics
 *
 * Pinning the contract the Codex round-3 finding revealed:
 *
 *   `hasMore` is computed ONLY from the underlying `LastEvaluatedKey`,
 *   NOT from `items.length > limit` (the old `Limit: limit + 1` peek
 *   pattern). DynamoDB applies Limit BEFORE FilterExpression, so the
 *   `items.length > limit` heuristic returns FALSE in two distinct
 *   broken cases:
 *     a) DDB stopped at exactly `limit` rows with more data downstream
 *        (LEK set, items.length === limit, old code said hasMore=false)
 *     b) FilterExpression dropped most/all of the `limit + 1` rows
 *        DDB returned (LEK set, items.length << limit, hasMore=false)
 *
 * The new helper drops the peek, asks for exactly `Limit: limit`, and
 * uses `!!LastEvaluatedKey` as the single source of truth. The slice
 * goes away too, closing a separate cursor-position bug where the
 * `limit + 1`-th row's key was returned as the next-page cursor —
 * causing that row to be SKIPPED on the next page.
 */

import { DynamoDBClientService } from './dynamodb-client.service';

/**
 * The AWS SDK v3 `QueryCommand` exposes its parameters on `.input`
 * but the TypeScript type narrowing here doesn't reach inside the
 * command wrapper consistently. Mirror the defensive pattern used
 * in academics' helper spec.
 */
function sentInputOf(cmd: unknown): any {
  return (cmd as any)?.input ?? (cmd as any)?.params ?? cmd;
}

describe('DynamoDBClientService.query — pagination semantics (Codex round-3 hardening)', () => {
  let service: DynamoDBClientService;
  let mockClient: { send: jest.Mock };

  beforeEach(() => {
    // Skip the constructor's STS client setup by instantiating then
    // overriding the table name — the query method only needs `this.tableName`.
    service = Object.create(DynamoDBClientService.prototype) as DynamoDBClientService;
    (service as any).tableName = 'edforge-finance-test';
    mockClient = { send: jest.fn() };
  });

  it('asks DDB for exactly `limit` rows — not `limit + 1` (no peek pattern)', async () => {
    mockClient.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await service.query(mockClient as any, 'tenant-1', undefined, undefined, undefined, undefined, 50);

    const sentInput = sentInputOf(mockClient.send.mock.calls[0][0]);
    expect(sentInput.Limit).toBe(50);
  });

  it('hasMore=true when LastEvaluatedKey is set, even if items.length < limit (FilterExpression starvation case)', async () => {
    // Simulates: DDB scanned `limit` rows, FilterExpression dropped
    // most of them, LEK is set because DDB stopped due to the Limit
    // (not exhaustion). Pre-fix: hasMore=false (items.length < limit).
    // Post-fix: hasMore=true (LEK present).
    mockClient.send.mockResolvedValueOnce({
      Items: [{ id: 'one-survivor' }],
      LastEvaluatedKey: { tenantId: 't', entityKey: 'k' },
    });

    const result = await service.query(mockClient as any, 'tenant-1', undefined, 'foo = :bar', { ':bar': 'x' }, undefined, 50);

    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(result.lastEvaluatedKey).toBeDefined();
  });

  it('hasMore=true when items.length === limit and LastEvaluatedKey is set (boundary case the old peek pattern missed)', async () => {
    // Pre-fix asked for 51 rows; if DDB returned exactly 50 with LEK,
    // hasMore was computed as `50 > 50 = false`. Post-fix uses LEK,
    // so hasMore=true correctly.
    mockClient.send.mockResolvedValueOnce({
      Items: Array.from({ length: 50 }, (_, i) => ({ id: i })),
      LastEvaluatedKey: { tenantId: 't', entityKey: 'k' },
    });

    const result = await service.query(mockClient as any, 'tenant-1', undefined, undefined, undefined, undefined, 50);

    expect(result.items).toHaveLength(50);
    expect(result.hasMore).toBe(true);
  });

  it('hasMore=false when LastEvaluatedKey is absent (range exhausted)', async () => {
    mockClient.send.mockResolvedValueOnce({
      Items: Array.from({ length: 30 }, (_, i) => ({ id: i })),
      LastEvaluatedKey: undefined,
    });

    const result = await service.query(mockClient as any, 'tenant-1', undefined, undefined, undefined, undefined, 50);

    expect(result.items).toHaveLength(30);
    expect(result.hasMore).toBe(false);
    expect(result.lastEvaluatedKey).toBeUndefined();
  });

  it('no items are sliced — every row DDB returned reaches the caller (closes the cursor-skip bug)', async () => {
    // Pre-fix: asked for 51 rows, sliced to 50, returned LEK pointing
    // at the 51st row. Next page would skip the 51st row entirely.
    // Post-fix: never asks for >limit, never slices, no skip.
    mockClient.send.mockResolvedValueOnce({
      Items: Array.from({ length: 50 }, (_, i) => ({ id: i })),
      LastEvaluatedKey: { tenantId: 't', entityKey: 'k50' },
    });

    const result = await service.query(mockClient as any, 'tenant-1', undefined, undefined, undefined, undefined, 50);

    expect(result.items).toHaveLength(50);
    expect(result.items[49]).toEqual({ id: 49 });
  });

  it('emits BETWEEN KeyCondition when skBetween is supplied (range push-down)', async () => {
    mockClient.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await service.query(
      mockClient as any,
      'tenant-1',
      undefined, undefined, undefined, undefined, 50, undefined,
      { lower: 'AUDIT#A', upper: 'AUDIT#Z' },
    );

    const sentInput = sentInputOf(mockClient.send.mock.calls[0][0]);
    expect(sentInput.KeyConditionExpression).toBe(
      'tenantId = :tenantId AND entityKey BETWEEN :_skLower AND :_skUpper',
    );
    expect(sentInput.ExpressionAttributeValues).toMatchObject({
      ':_skLower': 'AUDIT#A',
      ':_skUpper': 'AUDIT#Z',
    });
  });

  it('emits begins_with KeyCondition when skPrefix is supplied (backwards-compatible default)', async () => {
    mockClient.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await service.query(mockClient as any, 'tenant-1', 'INVOICE#');

    const sentInput = sentInputOf(mockClient.send.mock.calls[0][0]);
    expect(sentInput.KeyConditionExpression).toBe(
      'tenantId = :tenantId AND begins_with(entityKey, :skPrefix)',
    );
    expect(sentInput.ExpressionAttributeValues).toMatchObject({
      ':skPrefix': 'INVOICE#',
    });
  });

  it('logs a warning + prefers skBetween when both skPrefix and skBetween are supplied', async () => {
    mockClient.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
    // The constructor sets this; populate it manually since we bypassed construction.
    (service as any).logger = { warn: jest.fn(), log: jest.fn() };

    await service.query(
      mockClient as any,
      'tenant-1',
      'INVOICE#',
      undefined, undefined, undefined, 50, undefined,
      { lower: 'A', upper: 'Z' },
    );

    const sentInput = sentInputOf(mockClient.send.mock.calls[0][0]);
    // skBetween wins
    expect(sentInput.KeyConditionExpression).toContain('BETWEEN');
    expect((service as any).logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/both skPrefix and skBetween/),
    );
  });
});
