/**
 * IdempotentInterceptor spec — Sprint 0.2 (post-Codex P1 hardening)
 *
 * Covers the two-phase claim-then-finalize contract:
 *
 *   - Opt-out: routes WITHOUT @Idempotent() pass through untouched
 *   - 400 paths: missing header, malformed UUID, missing req.user
 *   - First call: PutItem(attribute_not_exists) wins → handler runs →
 *     UpdateItem finalizes pending → completed with the response body
 *   - Replay: PutItem CCFE → GetItem returns `status: 'completed'` →
 *     handler does NOT run; stored body + status returned
 *   - In-flight 409: PutItem CCFE → GetItem returns `status: 'pending'` →
 *     IDEMPOTENCY_REQUEST_IN_FLIGHT (the race-defense gate)
 *   - Cross-route 409: PutItem CCFE → existing row's routeKey differs →
 *     IDEMPOTENCY_KEY_ROUTE_MISMATCH
 *   - Expired row: PutItem CCFE → existing row past TTL → pass through
 *   - Vanished row: PutItem CCFE → row absent (TTL race) → pass through
 *   - Claim PutItem non-CCFE error: pass through, no replay protection
 *   - 256 KB cap: UpdateItem NOT called; warning logged; pending row stays
 *   - Cap enforcement: query returns >1000 live → row rolled back; 429
 *   - Cap enforcement: expired rows excluded from the live count
 */

import { ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, firstValueFrom, throwError } from 'rxjs';
import {
  IdempotentInterceptor,
  IDEMPOTENT_METADATA,
} from './idempotent.interceptor';
import type { IdempotencyKeyEntity } from '../entities/idempotency-key.entity';

const TENANT_ID = 'tenant-uuid';
const USER_ID = 'operator-uuid';
const VALID_KEY = '11111111-2222-4333-9444-555555555555';

function makeReq(opts: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  user?: { tenantId?: string; userId?: string };
}): any {
  return {
    method: opts.method ?? 'POST',
    url: opts.path ?? '/test',
    route: { path: opts.path ?? '/test' },
    headers: {
      authorization: 'Bearer jwt-token',
      ...(opts.headers ?? {}),
    },
    user: opts.user ?? { tenantId: TENANT_ID, userId: USER_ID },
  };
}

function makeRes(): any {
  return {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
  };
}

function makeContext(req: any, res: any, handler: () => void = () => {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

/** Helper to fabricate a CCFE error matching the AWS SDK shape. */
function ccfe(): Error {
  return Object.assign(new Error('The conditional request failed'), {
    name: 'ConditionalCheckFailedException',
  });
}

describe('IdempotentInterceptor (Sprint 0.2 — two-phase claim)', () => {
  let interceptor: IdempotentInterceptor;
  let reflector: Reflector;
  let dynamoDBClient: any;

  beforeEach(() => {
    reflector = new Reflector();
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockResolvedValue(null),
      putItem: jest.fn().mockResolvedValue(undefined),
      updateItem: jest.fn().mockResolvedValue(undefined),
      deleteItem: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    interceptor = new IdempotentInterceptor(reflector, dynamoDBClient);
  });

  it('routes without @Idempotent() pass through untouched — no DDB calls', async () => {
    const handler: CallHandler = { handle: () => of('handler-body') };
    const ctx = makeContext(makeReq({}), makeRes());

    const result$ = interceptor.intercept(ctx, handler);
    await firstValueFrom(result$);

    expect(dynamoDBClient.getClient).not.toHaveBeenCalled();
    expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
    expect(dynamoDBClient.getItem).not.toHaveBeenCalled();
  });

  describe('opt-in routes (Reflector.get returns true)', () => {
    let optInHandler: () => void;

    beforeEach(() => {
      optInHandler = () => {};
      Reflect.defineMetadata(IDEMPOTENT_METADATA, true, optInHandler);
    });

    function ctxFor(req: any, res: any): ExecutionContext {
      return makeContext(req, res, optInHandler);
    }

    it('400 IDEMPOTENCY_KEY_REQUIRED when header is missing', async () => {
      const handler: CallHandler = { handle: () => of('never-runs') };
      const ctx = ctxFor(makeReq({}), makeRes());

      await expect(
        firstValueFrom(interceptor.intercept(ctx, handler)),
      ).rejects.toThrow(/IDEMPOTENCY_KEY_REQUIRED|requires an 'Idempotency-Key' header/);
    });

    it('400 IDEMPOTENCY_KEY_MALFORMED when header is not a UUID', async () => {
      const handler: CallHandler = { handle: () => of('never-runs') };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': 'not-a-uuid' } }),
        makeRes(),
      );

      await expect(
        firstValueFrom(interceptor.intercept(ctx, handler)),
      ).rejects.toThrow(/IDEMPOTENCY_KEY_MALFORMED|must be a UUID/);
    });

    it('400 IDEMPOTENCY_CONTEXT_MISSING when req.user is absent', async () => {
      const handler: CallHandler = { handle: () => of('never-runs') };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY }, user: {} }),
        makeRes(),
      );

      await expect(
        firstValueFrom(interceptor.intercept(ctx, handler)),
      ).rejects.toThrow(/IDEMPOTENCY_CONTEXT_MISSING|tenantId \/ userId missing/);
    });

    it('first call: CLAIM PutItem(attr_not_exists) wins → handler runs → finalize UpdateItem stores response', async () => {
      const handlerResult = { id: 'job-123', status: 'queued' };
      const handler: CallHandler = { handle: () => of(handlerResult) };
      const res = makeRes();
      res.statusCode = 202;
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY }, method: 'POST', path: '/finance/schools/x/invoices/bulk-generate' }),
        res,
      );

      const result$ = interceptor.intercept(ctx, handler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual(handlerResult);

      // CLAIM phase
      expect(dynamoDBClient.putItem).toHaveBeenCalledTimes(1);
      const [, claimRow, claimCondition] = dynamoDBClient.putItem.mock.calls[0];
      expect(claimRow.entityType).toBe('IDEMPOTENCY_KEY');
      expect(claimRow.status).toBe('pending');
      expect(claimRow.responseStatus).toBe(0);
      expect(claimRow.responseBody).toBe('');
      expect(claimRow.claimedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(claimCondition).toBe('attribute_not_exists(entityKey)');

      // No GetItem in the success path (we don't read what we just wrote)
      expect(dynamoDBClient.getItem).not.toHaveBeenCalled();

      // FINALIZE phase: microtask flush so the fire-and-forget UpdateItem
      // completes before assertions.
      await new Promise(setImmediate);
      expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
      const [, updateTenantId, updateEntityKey, updateExpr, updateValues, updateCondition, updateNames] =
        dynamoDBClient.updateItem.mock.calls[0];
      expect(updateTenantId).toBe(TENANT_ID);
      expect(updateEntityKey).toBe(`IDEMPOTENCY#${USER_ID}#${VALID_KEY}`);
      expect(updateExpr).toMatch(/#status = :completed/);
      expect(updateValues[':completed']).toBe('completed');
      expect(updateValues[':status']).toBe(202);
      expect(JSON.parse(updateValues[':body'])).toEqual(handlerResult);
      expect(updateCondition).toBe('#status = :pending');
      expect(updateNames).toEqual({ '#status': 'status' });
    });

    it('replay: CLAIM CCFE → GetItem returns completed row → handler does NOT run; stored body + status returned', async () => {
      dynamoDBClient.putItem.mockRejectedValueOnce(ccfe());
      const storedBody = { id: 'job-123', status: 'succeeded' };
      const storedRow: IdempotencyKeyEntity = {
        tenantId: TENANT_ID,
        entityKey: `IDEMPOTENCY#${USER_ID}#${VALID_KEY}`,
        entityType: 'IDEMPOTENCY_KEY',
        idempotencyKey: VALID_KEY,
        routeKey: 'POST /finance/schools/x/invoices/bulk-generate',
        status: 'completed',
        responseStatus: 202,
        responseBody: JSON.stringify(storedBody),
        claimedAt: '2026-06-22T00:00:00Z',
        expiresAt: Math.floor(Date.now() / 1000) + 1000,
        createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 1,
      };
      dynamoDBClient.getItem.mockResolvedValueOnce(storedRow);

      const handlerSpy = jest.fn(() => of('handler-should-not-run'));
      const handler: CallHandler = { handle: handlerSpy };
      const res = makeRes();
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY }, method: 'POST', path: '/finance/schools/x/invoices/bulk-generate' }),
        res,
      );

      const result$ = interceptor.intercept(ctx, handler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual(storedBody);
      expect(res.statusCode).toBe(202);
      expect(handlerSpy).not.toHaveBeenCalled();
      expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('IN-FLIGHT 409: CLAIM CCFE → existing row status=pending → IDEMPOTENCY_REQUEST_IN_FLIGHT (race-defense gate)', async () => {
      dynamoDBClient.putItem.mockRejectedValueOnce(ccfe());
      const pendingRow: IdempotencyKeyEntity = {
        tenantId: TENANT_ID,
        entityKey: `IDEMPOTENCY#${USER_ID}#${VALID_KEY}`,
        entityType: 'IDEMPOTENCY_KEY',
        idempotencyKey: VALID_KEY,
        routeKey: 'POST /finance/schools/x/invoices/bulk-generate',
        status: 'pending',
        responseStatus: 0,
        responseBody: '',
        claimedAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 1000,
        createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 1,
      };
      dynamoDBClient.getItem.mockResolvedValueOnce(pendingRow);

      const handlerSpy = jest.fn(() => of('never'));
      const handler: CallHandler = { handle: handlerSpy };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY }, method: 'POST', path: '/finance/schools/x/invoices/bulk-generate' }),
        makeRes(),
      );

      await expect(
        firstValueFrom(interceptor.intercept(ctx, handler)),
      ).rejects.toThrow(/IDEMPOTENCY_REQUEST_IN_FLIGHT|already in flight/);
      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('cross-route 409: CLAIM CCFE → existing routeKey differs → IDEMPOTENCY_KEY_ROUTE_MISMATCH', async () => {
      dynamoDBClient.putItem.mockRejectedValueOnce(ccfe());
      const storedRow: IdempotencyKeyEntity = {
        tenantId: TENANT_ID,
        entityKey: `IDEMPOTENCY#${USER_ID}#${VALID_KEY}`,
        entityType: 'IDEMPOTENCY_KEY',
        idempotencyKey: VALID_KEY,
        routeKey: 'POST /finance/schools/x/invoices/bulk-generate',
        status: 'completed',
        responseStatus: 202,
        responseBody: '{}',
        claimedAt: '',
        expiresAt: Math.floor(Date.now() / 1000) + 1000,
        createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 1,
      };
      dynamoDBClient.getItem.mockResolvedValueOnce(storedRow);

      const handler: CallHandler = { handle: () => of('') };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY }, method: 'POST', path: '/finance/schools/x/payments/manual' }),
        makeRes(),
      );

      await expect(
        firstValueFrom(interceptor.intercept(ctx, handler)),
      ).rejects.toThrow(/IDEMPOTENCY_KEY_ROUTE_MISMATCH|previously used on a different route/);
    });

    it('expired row: CLAIM CCFE → row past TTL → pass-through (handler runs without replay protection)', async () => {
      dynamoDBClient.putItem.mockRejectedValueOnce(ccfe());
      const expiredRow: IdempotencyKeyEntity = {
        tenantId: TENANT_ID,
        entityKey: `IDEMPOTENCY#${USER_ID}#${VALID_KEY}`,
        entityType: 'IDEMPOTENCY_KEY',
        idempotencyKey: VALID_KEY,
        routeKey: 'POST /test',
        status: 'completed',
        responseStatus: 200,
        responseBody: '{"old": true}',
        claimedAt: '',
        expiresAt: Math.floor(Date.now() / 1000) - 60,
        createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 1,
      };
      dynamoDBClient.getItem.mockResolvedValueOnce(expiredRow);

      const handler: CallHandler = { handle: () => of({ fresh: true }) };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY } }),
        makeRes(),
      );

      const result$ = interceptor.intercept(ctx, handler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual({ fresh: true });
      // Pass-through: no UpdateItem call (no claim acquired)
      expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('vanished row: CLAIM CCFE → GetItem null (TTL sweep race) → pass-through', async () => {
      dynamoDBClient.putItem.mockRejectedValueOnce(ccfe());
      dynamoDBClient.getItem.mockResolvedValueOnce(null);

      const handler: CallHandler = { handle: () => of({ ok: true }) };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY } }),
        makeRes(),
      );

      const result$ = interceptor.intercept(ctx, handler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual({ ok: true });
      expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('non-CCFE claim PutItem error: pass-through; no replay protection; warning logged', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      dynamoDBClient.putItem.mockRejectedValueOnce(new Error('DDB unavailable'));

      const handler: CallHandler = { handle: () => of({ ok: true }) };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY } }),
        makeRes(),
      );

      const result = await lastValueFrom(interceptor.intercept(ctx, handler));

      expect(result).toEqual({ ok: true });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/claim PutItem failed.*proceeding WITHOUT replay protection/),
      );
      expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('256 KB cap: oversized handler response → UpdateItem NOT called; warning logged; pending row stays', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const big = 'x'.repeat(257 * 1024);
      const handler: CallHandler = { handle: () => of({ payload: big }) };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY } }),
        makeRes(),
      );

      await lastValueFrom(interceptor.intercept(ctx, handler));
      await new Promise(setImmediate);

      // Claim was written
      expect(dynamoDBClient.putItem).toHaveBeenCalledTimes(1);
      // But finalize was skipped — pending row stays in place
      expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/exceeds .* cap.*Pending row left in place/),
      );
      warnSpy.mockRestore();
    });

    it('handler throws: pending row stays (24h TTL handles cleanup); original error propagates', async () => {
      const handlerErr = new Error('downstream service exploded');
      const handler: CallHandler = {
        handle: () => throwError(() => handlerErr),
      };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY } }),
        makeRes(),
      );

      await expect(
        lastValueFrom(interceptor.intercept(ctx, handler)),
      ).rejects.toThrow(/downstream service exploded/);

      // Claim was written
      expect(dynamoDBClient.putItem).toHaveBeenCalledTimes(1);
      // Finalize NOT called (handler errored)
      expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
      // No rollback — pending row stays for 24h TTL recovery
      expect(dynamoDBClient.deleteItem).not.toHaveBeenCalled();
    });

    it('finalize UpdateItem fails: handler response still returned; warning logged', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      dynamoDBClient.updateItem.mockRejectedValueOnce(new Error('DDB unavailable'));
      const handler: CallHandler = { handle: () => of({ ok: true }) };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY } }),
        makeRes(),
      );

      const result = await lastValueFrom(interceptor.intercept(ctx, handler));
      await new Promise(setImmediate);

      expect(result).toEqual({ ok: true });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/finalize UpdateItem failed/),
      );
      warnSpy.mockRestore();
    });
  });

  describe('cap enforcement (plan §0.2: 1000 keys / operator / 24h)', () => {
    let optInHandler: () => void;

    beforeEach(() => {
      optInHandler = () => {};
      Reflect.defineMetadata(IDEMPOTENT_METADATA, true, optInHandler);
    });

    function ctxFor(req: any, res: any): ExecutionContext {
      return makeContext(req, res, optInHandler);
    }

    it('cap exceeded: live count > 1000 → claim rolled back + 429', async () => {
      // Simulate >1000 live (non-expired) rows from the cap-query
      const fakeRows: Partial<IdempotencyKeyEntity>[] = Array.from(
        { length: 1001 },
        (_, i) => ({
          entityKey: `IDEMPOTENCY#${USER_ID}#${i}`,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        }),
      );
      dynamoDBClient.query.mockResolvedValueOnce({ items: fakeRows, hasMore: false });

      const handler: CallHandler = { handle: () => of('never') };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY } }),
        makeRes(),
      );

      await expect(
        lastValueFrom(interceptor.intercept(ctx, handler)),
      ).rejects.toThrow(/IDEMPOTENCY_CAP_EXCEEDED|exceeded the 1000 idempotency-keys/);

      // Claim was attempted (PutItem) and then rolled back (deleteItem)
      expect(dynamoDBClient.putItem).toHaveBeenCalledTimes(1);
      expect(dynamoDBClient.deleteItem).toHaveBeenCalledTimes(1);
      const [, , deleteKey] = dynamoDBClient.deleteItem.mock.calls[0];
      expect(deleteKey).toBe(`IDEMPOTENCY#${USER_ID}#${VALID_KEY}`);
    });

    it('cap excludes expired rows from the live count', async () => {
      // 999 live + 50 expired = 1049 total, but live = 999 → under cap
      const nowSec = Math.floor(Date.now() / 1000);
      const liveRows: Partial<IdempotencyKeyEntity>[] = Array.from(
        { length: 999 },
        (_, i) => ({
          entityKey: `IDEMPOTENCY#${USER_ID}#${i}`,
          expiresAt: nowSec + 3600,
        }),
      );
      const expiredRows: Partial<IdempotencyKeyEntity>[] = Array.from(
        { length: 50 },
        (_, i) => ({
          entityKey: `IDEMPOTENCY#${USER_ID}#exp-${i}`,
          expiresAt: nowSec - 60,
        }),
      );
      dynamoDBClient.query.mockResolvedValueOnce({
        items: [...liveRows, ...expiredRows],
        hasMore: false,
      });

      const handler: CallHandler = { handle: () => of({ ok: true }) };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY } }),
        makeRes(),
      );

      const result = await lastValueFrom(interceptor.intercept(ctx, handler));

      expect(result).toEqual({ ok: true });
      // Cap NOT triggered — no rollback
      expect(dynamoDBClient.deleteItem).not.toHaveBeenCalled();
    });
  });
});
