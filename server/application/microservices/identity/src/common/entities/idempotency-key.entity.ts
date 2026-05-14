/**
 * IdempotencyKey entity (Sprint S0.10) — foundation only.
 *
 * Key structure:
 *   PK: TENANT#{tenantId}
 *   SK: IDEMPOTENCY#{idempotencyKey}
 *
 * Stores the cached response of a previously-completed mutating operation
 * so retries with the same `Idempotency-Key` header return the same result
 * without re-executing side effects.
 *
 * **Header convention:**
 *   - Header name: `Idempotency-Key`
 *   - Value format: any string up to 64 chars; UUID v4 strongly recommended
 *     (clients can use `crypto.randomUUID()`).
 *   - Scope: per (tenantId, key). A key replayed across tenants is treated
 *     as a brand-new operation.
 *   - TTL: 24 hours after the operation completes. Persisted via DDB TTL
 *     attribute `expiresAt` (Unix epoch seconds).
 *
 * **Endpoint rollout is deferred** — this V1 ticket lands the entity +
 * service helper so future endpoints can adopt the convention atomically.
 * No endpoint in identity service consumes it yet.
 */

import { BaseEntity } from './base.entity';

export type IdempotencyStatus = 'in_progress' | 'completed' | 'failed';

export interface IdempotencyKey extends BaseEntity {
  entityType: 'IDEMPOTENCY_KEY';
  /** The opaque key supplied by the client in the Idempotency-Key header. */
  idempotencyKey: string;
  /** HTTP method + path of the original request, for forensics. */
  requestSignature: string;
  /** Hash of the original request body, used to detect "same key, different body" misuse. */
  requestBodyHash: string;
  /** Lifecycle of the operation this key represents. */
  status: IdempotencyStatus;
  /** Serialized HTTP response (status + body) cached for replay. */
  cachedResponse?: {
    statusCode: number;
    body: unknown;
  };
  /** Unix epoch seconds after which DDB TTL will sweep this row. */
  expiresAt: number;
}

/**
 * SK builder for an IdempotencyKey row.
 */
export function idempotencyKeySK(idempotencyKey: string): string {
  return `IDEMPOTENCY#${idempotencyKey}`;
}

/**
 * Construct an IdempotencyKey entity. `expiresAt` defaults to 24 hours
 * from now — DDB TTL sweeps rows past this watermark.
 */
export function createIdempotencyKeyEntity(
  tenantId: string,
  idempotencyKey: string,
  data: {
    requestSignature: string;
    requestBodyHash: string;
    status: IdempotencyStatus;
    cachedResponse?: IdempotencyKey['cachedResponse'];
    expiresAtSeconds?: number;
    actorUserId: string;
  },
): IdempotencyKey {
  const now = new Date().toISOString();
  const ttlSeconds =
    data.expiresAtSeconds ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  return {
    tenantId,
    entityKey: idempotencyKeySK(idempotencyKey),
    entityType: 'IDEMPOTENCY_KEY',
    idempotencyKey,
    requestSignature: data.requestSignature,
    requestBodyHash: data.requestBodyHash,
    status: data.status,
    cachedResponse: data.cachedResponse,
    expiresAt: ttlSeconds,
    createdAt: now,
    createdBy: data.actorUserId,
    updatedAt: now,
    updatedBy: data.actorUserId,
    version: 1,
  };
}
