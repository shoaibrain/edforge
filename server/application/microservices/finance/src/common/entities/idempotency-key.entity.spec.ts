/**
 * IdempotencyKey entity — Sprint 0.2 + PR #361 TTL fix-up.
 *
 * Single-purpose regression guard for the TTL field name. The Sprint 0.2
 * draft wrote `expiresAt`, but the DDB table TTL attribute is `ttl`
 * (server/lib/tenant-template/ecs-dynamodb.ts:40) — so DDB never
 * auto-expired any rows, and idempotency keys piled up on disk forever.
 * PR #361 renamed to `ttl`. This spec pins the absence of the old name
 * so a future refactor can't silently regress the contract.
 *
 * The same pattern was used to pin MVP.5's active-export sentinel TTL
 * field after the PR #358 review caught the same bug class. Keep these
 * regression-guard assertions across every TTL-bearing entity in finance
 * so the next operator-visible "TTL doesn't fire" surprise gets caught
 * in CI instead of production.
 */

import {
  createPendingIdempotencyKeyEntity,
  isValidIdempotencyKey,
} from './idempotency-key.entity';

describe('IdempotencyKey entity (PR #361 TTL fix-up regression guard)', () => {
  it('uses `ttl` (NOT `expiresAt`) — must match table TTL attribute in ecs-dynamodb.ts:40', () => {
    const row = createPendingIdempotencyKeyEntity('tenant-x', {
      operatorId: 'op-1',
      idempotencyKey: '00000000-0000-4000-8000-000000000000',
      routeKey: 'POST /finance/test',
    });

    // CRITICAL: DDB only auto-expires items via the EXACT attribute name
    // configured on the table (`'ttl'`). Any other name (expiresAt,
    // expiresAtSec, etc.) is just data — the row lives forever.
    expect(row).toHaveProperty('ttl');
    expect(typeof row.ttl).toBe('number');
    expect(row).not.toHaveProperty('expiresAt');
    expect(row).not.toHaveProperty('expiresAtSec');
  });

  it('ttl is epoch SECONDS (not millis) — DDB TTL only honors seconds', () => {
    const before = Math.floor(Date.now() / 1000);
    const row = createPendingIdempotencyKeyEntity('tenant-x', {
      operatorId: 'op-1',
      idempotencyKey: '00000000-0000-4000-8000-000000000000',
      routeKey: 'POST /finance/test',
    });
    const after = Math.floor(Date.now() / 1000);

    // 24h ahead, in seconds. Sanity check: 2026 epoch seconds is ~1.7e9,
    // not 1.7e12 (which would be millis).
    expect(row.ttl).toBeGreaterThanOrEqual(before + 24 * 60 * 60);
    expect(row.ttl).toBeLessThanOrEqual(after + 24 * 60 * 60);
    expect(row.ttl).toBeLessThan(2e10); // not millis
    expect(row.ttl).toBeGreaterThan(1e9); // not seconds-since-day-start or similar
  });

  it('isValidIdempotencyKey accepts well-formed UUIDs only', () => {
    expect(isValidIdempotencyKey('00000000-0000-4000-8000-000000000000')).toBe(true);
    expect(isValidIdempotencyKey('not-a-uuid')).toBe(false);
    expect(isValidIdempotencyKey('')).toBe(false);
    expect(isValidIdempotencyKey(null)).toBe(false);
    expect(isValidIdempotencyKey(undefined)).toBe(false);
  });
});
