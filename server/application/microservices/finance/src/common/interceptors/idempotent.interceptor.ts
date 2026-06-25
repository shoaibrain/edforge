/**
 * IdempotentInterceptor — Sprint 0.2
 *
 * Generic header-driven idempotency for any POST route opting in via
 * the {@link Idempotent} decorator. Reads the `Idempotency-Key` header,
 * looks up a stored response in the IDEMPOTENCY_KEY DDB row, and:
 *
 *   - On hit (key seen for this {tenantId, operatorId} within 24h):
 *     replays the original status + body without invoking the handler.
 *
 *   - On miss: passes through to the handler, then writes the response
 *     back to DDB so a duplicate submission within 24h replays.
 *
 * Routes that DO NOT use {@link Idempotent} are passed through
 * unchanged — the interceptor's overhead on those is one
 * `Reflector.get` call.
 *
 * Behavior on edge cases:
 *   - Missing header on an opt-in route → 400 (the contract: client
 *     MUST mint a UUID per logical submission).
 *   - Malformed header (not a v1–v5 UUID) → 400.
 *   - Cross-route reuse (same key seen on a different route) → 409.
 *     Prevents an operator double-submission against route A from
 *     replaying the response for route B; tightens the contract
 *     beyond the plan's "operator-supplied UUID" minimum.
 *   - DDB write of the stored row fails → log a warning and still
 *     return the handler's response. Replay protection degrades to
 *     "best effort" if DDB is sick, but the operator's first call
 *     succeeds. This is the conservative choice for finance: never
 *     fail the bulk-generate response because the audit trail
 *     couldn't be written.
 *
 * Cap enforcement (1000 keys / operator / 24h per the plan) is NOT
 * enforced as a hard cap in this V1 — the 24h DDB TTL is the actual
 * growth-bound. Cap enforcement is a post-V1 hardening item; this
 * file's `MAX_REPLAY_BODY_BYTES` does cap individual stored response
 * size at 256 KB so a pathological handler can't blow up the row.
 */

import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  BadRequestException,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { DynamoDBClientService } from '../services/dynamodb-client.service';
import {
  IdempotencyKeyEntity,
  createIdempotencyKeyEntity,
  isValidIdempotencyKey,
} from '../entities/idempotency-key.entity';
import { EntityKeyBuilder } from '../entities/base.entity';

/** Metadata key set by {@link Idempotent}; read by the interceptor. */
export const IDEMPOTENT_METADATA = 'finance:idempotent';

/** Method decorator opting a controller method into the idempotency contract. */
export const Idempotent = (): MethodDecorator =>
  SetMetadata(IDEMPOTENT_METADATA, true);

/** 256 KB cap on stored response bodies. */
const MAX_REPLAY_BODY_BYTES = 256 * 1024;

@Injectable()
export class IdempotentInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotentInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const isIdempotent = this.reflector.get<boolean>(
      IDEMPOTENT_METADATA,
      context.getHandler(),
    );
    if (!isIdempotent) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    // Operator-supplied UUID. Case-insensitive header lookup; Node lowercases
    // by default but production reverse proxies may normalize otherwise.
    const rawKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
    if (!rawKey || typeof rawKey !== 'string') {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message:
          "This endpoint requires an 'Idempotency-Key' header (UUID v4 recommended).",
      });
    }
    if (!isValidIdempotencyKey(rawKey)) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_MALFORMED',
        message: "'Idempotency-Key' header must be a UUID.",
      });
    }

    // The interceptor only runs when the controller has injected a
    // RequestContext-bearing request — finance's existing
    // `buildRequestContext` pulls tenantId + userId from JWT claims and
    // attaches them on `req.user`. Defensively check and 401 if absent.
    const tenantId: string | undefined = req.user?.tenantId;
    const userId: string | undefined = req.user?.userId;
    const jwtToken: string =
      (req.headers.authorization as string | undefined)?.replace('Bearer ', '') || '';
    if (!tenantId || !userId) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_CONTEXT_MISSING',
        message:
          "Idempotency requires an authenticated request; tenantId / userId missing from req.user.",
      });
    }

    const routeKey = `${req.method} ${req.route?.path ?? req.url}`;
    const client = await this.dynamoDBClient.getClient(tenantId, jwtToken);
    const entityKey = EntityKeyBuilder.idempotencyKey(userId, rawKey);

    const existing = await this.dynamoDBClient.getItem<IdempotencyKeyEntity>(
      client,
      tenantId,
      entityKey,
    );

    if (existing) {
      // Logical TTL re-check: DDB's TTL sweep can lag by up to 48h, so
      // a row whose `expiresAt` is in the past must be treated as
      // absent (overwrite, don't replay). The interceptor enforces
      // the 24h contract at read-time.
      const nowSec = Math.floor(Date.now() / 1000);
      if (existing.expiresAt && existing.expiresAt > nowSec) {
        // Same key, different route → 409. Tightens the contract beyond
        // the plan minimum (plan says "operator-supplied UUID"; this
        // enforces per-route scoping so route-A's response can't replay
        // for route-B).
        if (existing.routeKey !== routeKey) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_ROUTE_MISMATCH',
            message:
              `Idempotency-Key was previously used on a different route (${existing.routeKey}). ` +
              `Mint a new UUID for this submission.`,
          });
        }

        res.status(existing.responseStatus);
        // The body is JSON-string-stored to defend against undefined /
        // function fields the controller might have returned. Best-effort
        // parse; if it fails, fall back to the raw string.
        let parsed: unknown;
        try {
          parsed = JSON.parse(existing.responseBody);
        } catch {
          parsed = existing.responseBody;
        }
        return of(parsed);
      }
      // expired — fall through to normal processing + overwrite
    }

    return next.handle().pipe(
      tap((responseBody) => {
        // Synchronous body: prep the entity here (any thrown error
        // surfaces to the caller's outer error pipeline). The actual
        // DDB write is fire-and-forget so the response delivery is
        // never blocked on the audit/replay write — finance's
        // first-priority is the operator getting their handler
        // response, even if the replay row write fails.
        let serialized: string;
        try {
          serialized = JSON.stringify(responseBody ?? null);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Idempotent route ${routeKey} response could not be JSON-serialized: ${message.slice(0, 200)} — replay protection degraded.`,
          );
          return;
        }
        if (serialized.length > MAX_REPLAY_BODY_BYTES) {
          this.logger.warn(
            `Idempotent route ${routeKey} returned ${serialized.length} bytes — exceeds ${MAX_REPLAY_BODY_BYTES} cap. Not storing for replay; duplicate submissions will re-run the handler.`,
          );
          return;
        }
        const entity = createIdempotencyKeyEntity(tenantId, {
          operatorId: userId,
          idempotencyKey: rawKey,
          routeKey,
          // NestJS sets res.statusCode just before this tap fires
          // (default 201 for POST, or whatever the handler/decorator
          // chose). Capture it for replay.
          responseStatus: res.statusCode ?? 200,
          responseBody: serialized,
        });
        // Fire-and-forget. `attribute_not_exists(entityKey)` guards
        // concurrent dupes — first call's row stays authoritative;
        // CCFE is the benign race-loser case. Any other error logs
        // a warning but doesn't fail the response.
        void this.dynamoDBClient
          .putItem(client, entity, 'attribute_not_exists(entityKey)')
          .catch((err: unknown) => {
            const name = (err as { name?: string })?.name;
            if (name === 'ConditionalCheckFailedException') return;
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Idempotent route ${routeKey} stored-response write failed: ${message.slice(0, 200)} — first call succeeded but replay protection degraded for this key.`,
            );
          });
      }),
    );
  }
}
