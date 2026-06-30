/**
 * IdempotencyKey Entity — Sprint 0.2 (PR #361 TTL fix-up)
 *
 * Generic header-driven idempotency for opt-in POST routes. Operator
 * mints a UUID on the frontend (once per form submission) and passes
 * it in the `Idempotency-Key` header. Same key within 24h on the same
 * tenant + operator replays the cached response without re-running
 * the handler.
 *
 * PK: tenantId
 * SK: IDEMPOTENCY#{operatorId}#{key}
 *
 * CRITICAL — TTL attribute name: the DDB table TTL attribute is `ttl`
 * (server/lib/tenant-template/ecs-dynamodb.ts:40). DDB only auto-expires
 * items via the EXACT attribute name configured on the table; any other
 * field is just data and items live forever.
 *
 * PR #361 fix-up (2026-06-30): the Sprint 0.2 draft wrote `expiresAt`
 * with a docstring claiming "matching the existing TTL attribute
 * convention on PAYMENT_SESSION" — but PAYMENT_SESSION actually uses
 * `ttl` (see payments.service.ts:996). The 24h backstop never fired:
 * rows accumulated forever on disk; the interceptor's read-time
 * `expiresAt` filter masked the operator-visible impact but not the
 * RCU + storage cost. Renamed to `ttl` and pinned by spec assertion.
 *
 * Bounded growth: the {@link IdempotentInterceptor} caps writes at
 * 1000 keys per operator per 24h to defend against pathological misuse
 * (frontend bug minting a new UUID per keystroke). The cap still
 * enforces logically via the read-time `r.ttl` filter even if the
 * DDB-side sweep lags.
 *
 * The stored response is the JSON-stringified body returned to the
 * client on the first call — exact replay including status code and
 * any error envelope.
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';

/**
 * Lifecycle states for an idempotency claim:
 *   - `pending`   — the first request CLAIMED the key but the handler has
 *                   not yet completed. Concurrent requests with the same
 *                   key get a 409 in-flight response — this is the gate
 *                   that prevents the double-execute race.
 *   - `completed` — the handler completed; the row carries the original
 *                   response status + body for verbatim replay.
 */
export type IdempotencyKeyStatus = 'pending' | 'completed';

export interface IdempotencyKeyEntity extends BaseEntity {
  entityType: 'IDEMPOTENCY_KEY';
  /** Operator-supplied UUID, format-validated by the interceptor. */
  idempotencyKey: string;
  /** The route + method this key was claimed against, e.g. `POST /finance/schools/:schoolId/invoices/bulk-generate`. Stored for forensic clarity; same key on a different route → 409 at the interceptor. */
  routeKey: string;
  /** Claim lifecycle — gates replay vs in-flight handling at read time. */
  status: IdempotencyKeyStatus;
  /** HTTP status code returned on first call (replayed verbatim once `status === 'completed'`). 0 while `status === 'pending'`. */
  responseStatus: number;
  /** JSON-serialized response body (cap 256 KB per the interceptor). Empty while `status === 'pending'`. */
  responseBody: string;
  /** ISO-8601 timestamp recorded when the row was first PUT (claim acquired). */
  claimedAt: string;
  /** Epoch seconds — DDB TTL attribute. MUST be named `ttl` to match `timeToLiveAttribute: 'ttl'` in ecs-dynamodb.ts:40. PR #361 fix-up. */
  ttl: number;
}

/**
 * Build a freshly-claimed `pending` row. The interceptor PUTs this with
 * `attribute_not_exists(entityKey)` so two concurrent requests race for
 * the claim — the loser sees `ConditionalCheckFailedException`, reads the
 * existing row, and either replays (if `completed`) or 409s (if `pending`).
 *
 * The handler runs ONLY after the claim succeeds — the `tap`-after-handler
 * write was the V0.1 race the Codex P1 finding called out.
 */
export function createPendingIdempotencyKeyEntity(
  tenantId: string,
  data: {
    operatorId: string;
    idempotencyKey: string;
    routeKey: string;
  },
): IdempotencyKeyEntity {
  const now = new Date().toISOString();
  // 24h TTL — matches the conservative replay window. DDB TTL has up to
  // a 48h sweep lag in practice, but the interceptor enforces the
  // logical 24h check at read-time as well.
  // PR #361 fix-up: field MUST be named `ttl` (was `expiresAt`); see file header.
  const ttl = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  return {
    tenantId,
    entityKey: EntityKeyBuilder.idempotencyKey(data.operatorId, data.idempotencyKey),
    entityType: 'IDEMPOTENCY_KEY',
    idempotencyKey: data.idempotencyKey,
    routeKey: data.routeKey,
    status: 'pending',
    responseStatus: 0,
    responseBody: '',
    claimedAt: now,
    ttl,
    createdAt: now,
    createdBy: data.operatorId,
    updatedAt: now,
    updatedBy: data.operatorId,
    version: 1,
  };
}

/** Strict UUID v1-v5 regex — rejects malformed operator-supplied keys. */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === 'string' && UUID_REGEX.test(key);
}
