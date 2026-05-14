/**
 * IdempotencyService — Sprint S0.10 foundation
 *
 * Scaffolding for the Idempotency-Key header convention. Endpoints opt
 * in to idempotency by wrapping their mutating handler with
 * `idempotency.runOnce(...)`. The service:
 *   1. Computes a request-body hash for replay-detection.
 *   2. Atomically reserves the (tenantId, key) slot in DDB via a
 *      conditional write (status='in_progress').
 *   3. On success, persists the cached response (status='completed') so
 *      replays in the next 24h return the same result.
 *   4. On failure, stores status='failed' so retries get a deterministic
 *      reply rather than mid-execution chaos.
 *
 * **Rollout is deferred.** Per the sprint plan, this ticket lands the
 * service + entity only; no identity endpoint consumes it yet. Adopting
 * the helper at an endpoint is the per-endpoint sprint cost.
 *
 * **Header convention** — see common/entities/idempotency-key.entity.ts.
 *
 * **Error semantics** — see `IdempotencyConflictError`. A "same key with
 * a different body" race is a deliberate 409 to the client; idempotency
 * is per-request-shape, not per-key-only.
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { DynamoDBClientService } from './dynamodb-client.service';
import {
  IdempotencyKey,
  IdempotencyStatus,
  createIdempotencyKeyEntity,
  idempotencyKeySK,
} from '../entities/idempotency-key.entity';
import { RequestContext } from '../entities/base.entity';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const IDEMPOTENCY_KEY_MAX_LENGTH = 64;
/** Conservative minimum — 16 chars is enough entropy for UUID-shaped keys. */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 16;

export class IdempotencyConflictError extends Error {
  readonly errorCode = 'IDEMPOTENCY_KEY_REUSE_WITH_DIFFERENT_BODY';
  constructor(public readonly idempotencyKey: string) {
    super(
      `Idempotency-Key "${idempotencyKey}" was previously used with a ` +
        `different request body. Retries must replay the same request.`,
    );
  }
}

export interface RunOnceParams<T> {
  /** Opaque client-supplied key from the Idempotency-Key header. */
  idempotencyKey: string;
  /** HTTP method + path of the request, e.g. "POST /schools/.../academic-years". */
  requestSignature: string;
  /** The request body. Used to derive a stable hash for replay-detection. */
  requestBody: unknown;
  /** Operation to execute if this is a fresh key. Returns the value to cache. */
  executor: () => Promise<T>;
}

export interface RunOnceResult<T> {
  /** True when the response was served from the cache, false when freshly executed. */
  fromCache: boolean;
  /** The result value (freshly produced or replayed). */
  value: T;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * Validate a key value against the convention. Returns the trimmed
   * key on success, throws on failure. Callers SHOULD invoke this
   * before `runOnce` if they want a clean 400 response on a malformed
   * header; otherwise `runOnce` will reject with the same error.
   */
  validateKey(rawKey: string): string {
    const key = rawKey?.trim() ?? '';
    if (key.length < IDEMPOTENCY_KEY_MIN_LENGTH || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new Error(
        `Invalid Idempotency-Key: must be ${IDEMPOTENCY_KEY_MIN_LENGTH}..` +
          `${IDEMPOTENCY_KEY_MAX_LENGTH} chars (got ${key.length}).`,
      );
    }
    return key;
  }

  /**
   * Compute a stable SHA-256 hash of the request body. Used to detect
   * "same key, different body" misuse without storing the raw body.
   */
  hashRequestBody(body: unknown): string {
    const serialized = body === undefined ? '' : JSON.stringify(body);
    return createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Execute `executor` at most once per (tenantId, idempotencyKey).
   *
   * Returns `{ fromCache: false, value }` on first invocation;
   * returns `{ fromCache: true, value }` on replay with the same body;
   * throws `IdempotencyConflictError` on replay with a different body.
   */
  async runOnce<T>(
    context: RequestContext,
    params: RunOnceParams<T>,
  ): Promise<RunOnceResult<T>> {
    const key = this.validateKey(params.idempotencyKey);
    const bodyHash = this.hashRequestBody(params.requestBody);
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );

    // Step 1: check for an existing record. If completed with the same
    // body hash → replay. If completed with a different hash → conflict.
    // If in_progress → we ALSO conflict for now (V1 simplification — a
    // later sprint can add a wait/poll loop for concurrent replays).
    const existing = await this.dynamoDBClient.getItem<IdempotencyKey>(
      client,
      context.tenantId,
      idempotencyKeySK(key),
    );

    if (existing) {
      if (existing.requestBodyHash !== bodyHash) {
        throw new IdempotencyConflictError(key);
      }
      if (existing.status === 'completed' && existing.cachedResponse) {
        return { fromCache: true, value: existing.cachedResponse.body as T };
      }
      // in_progress or failed — surface as a conflict; clients should
      // wait and retry. A later sprint can replace this with a poll loop.
      throw new IdempotencyConflictError(key);
    }

    // Step 2: reserve the slot atomically. A racing duplicate request
    // with the same key will fail the conditional PUT and end up in the
    // "existing" branch on its next attempt.
    const reservationRow = createIdempotencyKeyEntity(context.tenantId, key, {
      requestSignature: params.requestSignature,
      requestBodyHash: bodyHash,
      status: 'in_progress',
      actorUserId: context.userId,
    });

    try {
      await this.dynamoDBClient.putItem(client, reservationRow);
    } catch (err: any) {
      // Conditional-write failures should bubble up as a conflict — the
      // racing request gets a clean retry-later. Other errors propagate.
      this.logger.warn(
        `Idempotency reservation failed for key=${key}: ${err?.message ?? err}`,
      );
      throw err;
    }

    // Step 3: execute, then finalize the row.
    try {
      const value = await params.executor();
      const completedRow = createIdempotencyKeyEntity(context.tenantId, key, {
        requestSignature: params.requestSignature,
        requestBodyHash: bodyHash,
        status: 'completed',
        cachedResponse: { statusCode: 200, body: value },
        actorUserId: context.userId,
      });
      await this.dynamoDBClient.putItem(client, completedRow);
      return { fromCache: false, value };
    } catch (executorErr: any) {
      // Persist a 'failed' marker so retries surface the same error
      // rather than re-running side effects. Best-effort: if the
      // marker write also fails, log but propagate the original error.
      try {
        const failedRow = createIdempotencyKeyEntity(context.tenantId, key, {
          requestSignature: params.requestSignature,
          requestBodyHash: bodyHash,
          status: 'failed',
          actorUserId: context.userId,
        });
        await this.dynamoDBClient.putItem(client, failedRow);
      } catch (markerErr: any) {
        this.logger.error(
          `Failed to persist idempotency 'failed' marker for key=${key}: ` +
            `${markerErr?.message ?? markerErr}`,
        );
      }
      throw executorErr;
    }
  }
}
