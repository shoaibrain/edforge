/**
 * TenantMetadataReaderService.getArchetype spec.
 *
 * Locks the honest-degradation contract (the 2026-06-04 GB2 silent-degradation
 * fix) + the immutable cache:
 *   - success → archetype, cached for the task lifetime (no second DDB read);
 *   - missing METADATA row → `undefined` (expected absence, NOT cached);
 *   - any other DDB failure (AccessDenied/throttle/timeout) → THROWS (infra
 *     error, not "no archetype"); the failure is not cached.
 *
 * The DDB client is mocked by patching the instance's `ddb.send` (the
 * constructor builds a real client, but no network call is made).
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// The global jest.setup.js mock of @aws-sdk/client-dynamodb only exports
// `DynamoDBClient` — this service is the one place that builds a raw
// `GetItemCommand`, so provide a constructable stub for it here. The instance's
// `ddb.send` is patched per-test, so the command body is never executed.
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  GetItemCommand: jest.fn((params) => ({ type: 'GetItemCommand', params })),
}));

import { TenantMetadataReaderService } from './tenant-metadata-reader.service';

function makeReader() {
  const send = jest.fn<any>();
  const reader = new TenantMetadataReaderService();
  (reader as any).ddb = { send };
  return { reader, send };
}

const itemWith = (archetype?: string) => ({
  Item: { tenantId: { S: 't' }, ...(archetype ? { archetype: { S: archetype } } : {}) },
});

describe('TenantMetadataReaderService.getArchetype', () => {
  it('returns the archetype on success and caches it (no second DDB read)', async () => {
    const { reader, send } = makeReader();
    send.mockResolvedValue(itemWith('PABSON'));

    expect(await reader.getArchetype('tenant-1')).toBe('PABSON');
    expect(await reader.getArchetype('tenant-1')).toBe('PABSON');
    expect(send).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it('returns undefined for a missing METADATA row (expected absence, not cached)', async () => {
    const { reader, send } = makeReader();
    send.mockResolvedValue({}); // no Item

    expect(await reader.getArchetype('tenant-2')).toBeUndefined();
    expect(await reader.getArchetype('tenant-2')).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2); // absence is NOT cached → re-read
  });

  it('throws on an infrastructure/permission failure (does not absorb as no-archetype)', async () => {
    const { reader, send } = makeReader();
    const denied = Object.assign(new Error('User is not authorized to perform: dynamodb:GetItem'), {
      name: 'AccessDeniedException',
    });
    send.mockRejectedValue(denied);

    await expect(reader.getArchetype('tenant-3')).rejects.toThrow(/not authorized/);
  });

  it('does not cache a failure — a later success resolves correctly', async () => {
    const { reader, send } = makeReader();
    send.mockRejectedValueOnce(new Error('throttled'));
    send.mockResolvedValueOnce(itemWith('GENERIC'));

    await expect(reader.getArchetype('tenant-4')).rejects.toThrow(/throttled/);
    expect(await reader.getArchetype('tenant-4')).toBe('GENERIC');
  });

  it('returns undefined when the METADATA row exists but has no archetype field (not cached)', async () => {
    const { reader, send } = makeReader();
    send.mockResolvedValue(itemWith()); // Item present, archetype absent

    expect(await reader.getArchetype('tenant-5')).toBeUndefined();
    expect(await reader.getArchetype('tenant-5')).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2); // an undefined archetype is NOT cached → re-read
  });
});
