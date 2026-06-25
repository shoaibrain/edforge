/**
 * IdempotencyKey Entity — Sprint 0.2
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
 * 24h DDB TTL on the `expiresAt` epoch-second attribute (matching the
 * existing TTL attribute convention on PAYMENT_SESSION). Bounded growth:
 * the {@link IdempotentInterceptor} caps writes at 1000 keys per operator
 * per 24h to defend against pathological misuse (frontend bug minting a
 * new UUID per keystroke).
 *
 * The stored response is the JSON-stringified body returned to the
 * client on the first call — exact replay including status code and
 * any error envelope.
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';

export interface IdempotencyKeyEntity extends BaseEntity {
  entityType: 'IDEMPOTENCY_KEY';
  /** Operator-supplied UUID, format-validated by the interceptor. */
  idempotencyKey: string;
  /** The route + method this key was claimed against, e.g. `POST /finance/schools/:schoolId/invoices/bulk-generate`. Stored for forensic clarity; replay does NOT re-validate the route (same key on a different route is rejected at the interceptor). */
  routeKey: string;
  /** HTTP status code returned on the first call (replayed verbatim). */
  responseStatus: number;
  /** JSON-serialized response body (cap 256 KB per the interceptor). */
  responseBody: string;
  /** Epoch seconds — DDB TTL attribute, must be named `expiresAt`. */
  expiresAt: number;
}

export function createIdempotencyKeyEntity(
  tenantId: string,
  data: {
    operatorId: string;
    idempotencyKey: string;
    routeKey: string;
    responseStatus: number;
    responseBody: string;
  },
): IdempotencyKeyEntity {
  const now = new Date().toISOString();
  // 24h TTL — matches the conservative replay window. DDB TTL has up to
  // a 48h sweep lag in practice, but the interceptor enforces the
  // logical 24h check at read-time as well.
  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  return {
    tenantId,
    entityKey: EntityKeyBuilder.idempotencyKey(data.operatorId, data.idempotencyKey),
    entityType: 'IDEMPOTENCY_KEY',
    idempotencyKey: data.idempotencyKey,
    routeKey: data.routeKey,
    responseStatus: data.responseStatus,
    responseBody: data.responseBody,
    expiresAt,
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
