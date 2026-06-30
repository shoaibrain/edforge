/**
 * IdempotentInterceptor — Sprint 0.2 (post-Codex hardening)
 *
 * Two-phase claim-then-finalize idempotency:
 *
 *   1. **CLAIM**  PUT a `status: 'pending'` row with
 *      `attribute_not_exists(entityKey)`. This is the only point
 *      where the row is created — handler invocation is GATED on
 *      this conditional write winning.
 *   2. **EXECUTE**  Handler runs after the claim is acquired.
 *   3. **FINALIZE**  UpdateItem flips the row to
 *      `status: 'completed'` with `responseStatus + responseBody`.
 *
 * Two concurrent requests with the same key race for the CLAIM.
 * The loser sees `ConditionalCheckFailedException`, reads the
 * existing row, and either:
 *   - Replays (if `status === 'completed'`)
 *   - Returns 409 IDEMPOTENCY_REQUEST_IN_FLIGHT (if `status === 'pending'`)
 *   - 409 IDEMPOTENCY_KEY_ROUTE_MISMATCH (if the existing row was
 *     claimed against a different route)
 *
 * The pre-hardening V0.1 was racy: GetItem → handler → fire-and-forget
 * PutItem. Two near-simultaneous requests both saw "no row" and both
 * executed the handler. The Codex P1 finding called this out; the
 * `attribute_not_exists` CLAIM is the gate that closes the race.
 *
 * If the handler throws, the `pending` row stays in DDB until either
 * (a) the 24h TTL sweeps it, or (b) a retry with the same key — the
 * retry will see `pending` and 409. That's the conservative contract:
 * "if your handler crashed mid-execution, wait 24h or mint a new key,
 * rather than risk a double-execute". A future hardening could
 * implement stale-claim recovery, but is out of scope for V1.
 *
 * Cap (1000 keys / operator / 24h, per the plan): enforced inside
 * the CLAIM phase before the PutItem, via a bounded Query against
 * `IDEMPOTENCY#{operatorId}#`. Pilot scale is well under the cap so
 * the cap-check Query is cheap (returns a tiny page).
 */

import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  BadRequestException,
  NestInterceptor,
  ServiceUnavailableException,
  SetMetadata,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap, tap } from 'rxjs/operators';
import { DynamoDBClientService } from '../services/dynamodb-client.service';
import {
  IdempotencyKeyEntity,
  createPendingIdempotencyKeyEntity,
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

/** Plan acceptance §0.2: cap rows per operator per 24h (defends against frontend bugs minting a new UUID per keystroke). */
const MAX_KEYS_PER_OPERATOR = 1000;

/** 429 thrown when an operator exceeds the per-day claim cap. */
class IdempotencyCapExceededException extends HttpException {
  constructor() {
    super(
      {
        code: 'IDEMPOTENCY_CAP_EXCEEDED',
        message:
          `Operator has exceeded the ${MAX_KEYS_PER_OPERATOR} idempotency-keys / 24h limit. ` +
          `Wait for older keys to expire or contact support.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class IdempotentInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotentInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const isIdempotent = this.reflector.get<boolean>(
      IDEMPOTENT_METADATA,
      context.getHandler(),
    );
    if (!isIdempotent) {
      return next.handle();
    }

    return from(this.handleIdempotent(context, next)).pipe(
      mergeMap((result) => result),
    );
  }

  /**
   * Bridges the async claim phase into the Observable pipeline so the
   * handler invocation can happen inside `next.handle()`. Returns an
   * Observable<unknown> — replayed responses use `of(parsedBody)`;
   * fresh claims return `next.handle()` piped through a `tap` that
   * finalizes the row, plus a `catchError` so handler exceptions
   * don't leak past the interceptor.
   */
  private async handleIdempotent(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
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

    // ─── Phase 1: CLAIM ───────────────────────────────────────────
    // Attempt to write a pending row with attribute_not_exists. This
    // is the atomic gate that prevents two concurrent requests from
    // both executing the handler.
    const pending = createPendingIdempotencyKeyEntity(tenantId, {
      operatorId: userId,
      idempotencyKey: rawKey,
      routeKey,
    });

    let claimAcquired = false;
    try {
      await this.dynamoDBClient.putItem(
        client,
        pending,
        'attribute_not_exists(entityKey)',
      );
      claimAcquired = true;
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      if (name !== 'ConditionalCheckFailedException') {
        // Codex P1 — fail closed. The pre-hardening V0.2 passed through
        // on non-CCFE DDB errors and let the handler run without
        // replay protection. For finance MUTATIONS that's a correctness
        // hole: the same operator clicking twice during a DDB blip
        // would both submit, and the second wouldn't be caught by the
        // (failed) claim. 503 forces an operator retry with the SAME
        // Idempotency-Key — the retry either succeeds (DDB recovered;
        // claim acquired; handler runs once) or 503s again (DDB still
        // sick; operator informed) but never double-executes.
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Idempotency claim PutItem failed for route=${routeKey}: ` +
            `${message.slice(0, 200)} — returning 503 IDEMPOTENCY_GUARD_UNAVAILABLE; ` +
            `operator should retry with the same Idempotency-Key.`,
        );
        throw new ServiceUnavailableException({
          code: 'IDEMPOTENCY_GUARD_UNAVAILABLE',
          message:
            'Could not claim the Idempotency-Key (storage error). ' +
            'Retry with the same key — your request was NOT executed.',
        });
      }
      // CCFE — claim race lost. Inspect the existing row.
    }

    if (!claimAcquired) {
      const existing = await this.dynamoDBClient.getItem<IdempotencyKeyEntity>(
        client,
        tenantId,
        entityKey,
      );
      if (!existing) {
        // Vanishingly rare race: claim CCFE'd but the row was already
        // swept between our PutItem and our GetItem. Treat as a miss
        // and pass through — the consequence is one missing replay
        // window, not a double-execute (the lost claimant has already
        // committed or will commit imminently).
        this.logger.warn(
          `Idempotency claim CCFE but row absent on GetItem (entityKey=${entityKey.slice(0, 60)}...). ` +
            `Race with TTL sweep; proceeding without replay protection.`,
        );
        return next.handle();
      }

      // Logical TTL re-check
      const nowSec = Math.floor(Date.now() / 1000);
      if (existing.ttl && existing.ttl <= nowSec) {
        // Row is past TTL but still on disk (sweep lag). We DON'T
        // attempt to overwrite here — the simpler V1 contract is
        // "expired row that hasn't swept yet → treat as a soft miss
        // and pass through". The next request after sweep gets a
        // clean CLAIM.
        this.logger.warn(
          `Idempotency row past TTL but not yet swept (entityKey=${entityKey.slice(0, 60)}...). ` +
            `Proceeding without replay protection.`,
        );
        return next.handle();
      }

      if (existing.routeKey !== routeKey) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_ROUTE_MISMATCH',
          message:
            `Idempotency-Key was previously used on a different route (${existing.routeKey}). ` +
            `Mint a new UUID for this submission.`,
        });
      }

      if (existing.status === 'completed') {
        res.status(existing.responseStatus);
        let parsed: unknown;
        try {
          parsed = JSON.parse(existing.responseBody);
        } catch {
          parsed = existing.responseBody;
        }
        return of(parsed);
      }

      // status === 'pending' — concurrent request already in flight.
      // This is the gate that prevents the double-execute race.
      throw new ConflictException({
        code: 'IDEMPOTENCY_REQUEST_IN_FLIGHT',
        message:
          'A request with this Idempotency-Key is already in flight. ' +
          'Wait for it to complete (then this key will replay), or mint a new key for a fresh submission.',
      });
    }

    // We acquired the claim. Before executing the handler, enforce the
    // per-operator cap. If the claim we just wrote pushed us over the
    // cap, roll it back and 429.
    //
    // TOCTOU note: a single operator firing >1000 concurrent claims
    // could still race past the cap. Pilot scale is far below this so
    // we accept the race; tighten with a counter row if it becomes
    // operational.
    try {
      await this.enforceCap(client, tenantId, userId, entityKey);
    } catch (capErr) {
      // Roll back the claim we just wrote so the cap is honored.
      await this.dynamoDBClient
        .deleteItem(client, tenantId, entityKey)
        .catch((delErr: unknown) => {
          const msg = delErr instanceof Error ? delErr.message : String(delErr);
          this.logger.warn(
            `Idempotency cap-exceeded rollback delete failed for operator=${userId}: ${msg.slice(0, 200)}`,
          );
        });
      throw capErr;
    }

    // ─── Phase 2: EXECUTE + Phase 3: FINALIZE ───────────────────
    return next.handle().pipe(
      tap((responseBody) => {
        let serialized: string;
        try {
          serialized = JSON.stringify(responseBody ?? null);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Idempotent route ${routeKey} response could not be JSON-serialized: ${message.slice(0, 200)} — replay protection degraded for this key.`,
          );
          return;
        }
        if (serialized.length > MAX_REPLAY_BODY_BYTES) {
          this.logger.warn(
            `Idempotent route ${routeKey} returned ${serialized.length} bytes — exceeds ${MAX_REPLAY_BODY_BYTES} cap. ` +
              `Pending row left in place; the next replay attempt for this key will return 409 IN_FLIGHT until the 24h TTL sweeps it.`,
          );
          return;
        }
        // Finalize: pending → completed, store status + body.
        // Conditional ensures we only finalize OUR row (defensive against
        // another path having overwritten it).
        const responseStatus = res.statusCode ?? 200;
        void this.dynamoDBClient
          .updateItem(
            client,
            tenantId,
            entityKey,
            'SET #status = :completed, responseStatus = :status, responseBody = :body, updatedAt = :now',
            {
              ':completed': 'completed',
              ':pending': 'pending',
              ':status': responseStatus,
              ':body': serialized,
              ':now': new Date().toISOString(),
            },
            '#status = :pending',
            { '#status': 'status' },
          )
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Idempotent route ${routeKey} finalize UpdateItem failed: ${message.slice(0, 200)} — handler response delivered to client but replay protection degraded for this key.`,
            );
          });
      }),
      catchError((handlerErr) => {
        // Handler threw. The pending row remains; the 24h TTL is
        // the recovery mechanism. A retry with the same key sees
        // 'pending' and 409s — the conservative contract (operator
        // waits 24h or mints a new key) prevents double-execute.
        // Propagate the original error.
        return throwError(() => handlerErr);
      }),
    );
  }

  /**
   * Plan acceptance §0.2 cap-enforcer. Counts the operator's live
   * IDEMPOTENCY rows with a bounded `Limit: MAX + 1` query and throws
   * `IdempotencyCapExceededException` if the count would exceed the
   * cap. Called AFTER the claim PutItem so the cap reflects all
   * currently-claimed rows including the one we just wrote.
   */
  private async enforceCap(
    client: any,
    tenantId: string,
    operatorId: string,
    selfEntityKey: string,
  ): Promise<void> {
    // `begins_with(entityKey, IDEMPOTENCY#{operatorId}#)` scopes to
    // this operator's keys only.
    const skPrefix = `IDEMPOTENCY#${operatorId}#`;
    const result = await this.dynamoDBClient.query<IdempotencyKeyEntity>(
      client,
      tenantId,
      skPrefix,
      undefined,
      undefined,
      undefined,
      MAX_KEYS_PER_OPERATOR + 1,
    );
    // Filter out rows past their TTL — DDB sweep can lag, so live count
    // should only consider non-expired rows.
    const nowSec = Math.floor(Date.now() / 1000);
    const liveCount = result.items.filter(
      (r) => !r.ttl || r.ttl > nowSec,
    ).length;
    if (liveCount > MAX_KEYS_PER_OPERATOR) {
      this.logger.warn(
        `Idempotency cap exceeded for operator=${operatorId}: live=${liveCount} > cap=${MAX_KEYS_PER_OPERATOR}. ` +
          `Rolling back claim ${selfEntityKey.slice(0, 60)}... and returning 429.`,
      );
      throw new IdempotencyCapExceededException();
    }
  }
}
