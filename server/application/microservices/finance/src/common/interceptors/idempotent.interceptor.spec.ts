/**
 * IdempotentInterceptor spec — Sprint 0.2
 *
 * Covers:
 *   - Opt-out: routes WITHOUT @Idempotent() pass through untouched
 *     (single Reflector lookup, no DDB calls)
 *   - Missing header on opt-in route → 400 IDEMPOTENCY_KEY_REQUIRED
 *   - Malformed UUID on opt-in route → 400 IDEMPOTENCY_KEY_MALFORMED
 *   - Missing req.user context → 400 IDEMPOTENCY_CONTEXT_MISSING
 *   - First call: handler runs, response is stored in DDB
 *   - Second call same key + same route: handler does NOT run; stored
 *     response is replayed including status code
 *   - Second call same key + different route → 409
 *   - Stored row whose expiresAt has lapsed → treated as miss
 *   - 256 KB body cap: oversized response is NOT stored; warning logged
 *   - ConditionalCheckFailed on store: swallowed (concurrent dupe race)
 *   - DDB putItem failure mid-tap: handler response still returned to
 *     client; warning logged; replay protection degrades for this key
 */

import { ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, firstValueFrom, from } from 'rxjs';
import {
  IdempotentInterceptor,
  Idempotent,
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

describe('IdempotentInterceptor (Sprint 0.2)', () => {
  let interceptor: IdempotentInterceptor;
  let reflector: Reflector;
  let dynamoDBClient: any;

  beforeEach(() => {
    reflector = new Reflector();
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockResolvedValue(null),
      putItem: jest.fn().mockResolvedValue(undefined),
    };
    interceptor = new IdempotentInterceptor(reflector, dynamoDBClient);
  });

  it('routes without @Idempotent() pass through untouched — no DDB calls', async () => {
    const handler: CallHandler = { handle: () => of('handler-body') };
    const ctx = makeContext(makeReq({}), makeRes());

    const result$ = await interceptor.intercept(ctx, handler);
    await firstValueFrom(result$);

    expect(dynamoDBClient.getClient).not.toHaveBeenCalled();
    expect(dynamoDBClient.getItem).not.toHaveBeenCalled();
    expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
  });

  describe('opt-in routes (Reflector.get returns true)', () => {
    let optInHandler: () => void;

    beforeEach(() => {
      optInHandler = () => {};
      Reflect.defineMetadata(IDEMPOTENT_METADATA, true, optInHandler);
    });

    function ctxFor(req: any, res: any, downstream: CallHandler): ExecutionContext {
      return makeContext(req, res, optInHandler);
    }

    it('400 IDEMPOTENCY_KEY_REQUIRED when header is missing', async () => {
      const handler: CallHandler = { handle: () => of('never-runs') };
      const ctx = ctxFor(makeReq({}), makeRes(), handler);

      await expect(interceptor.intercept(ctx, handler)).rejects.toThrow(
        /IDEMPOTENCY_KEY_REQUIRED|requires an 'Idempotency-Key' header/,
      );
    });

    it('400 IDEMPOTENCY_KEY_MALFORMED when header is not a UUID', async () => {
      const handler: CallHandler = { handle: () => of('never-runs') };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': 'not-a-uuid' } }),
        makeRes(),
        handler,
      );

      await expect(interceptor.intercept(ctx, handler)).rejects.toThrow(
        /IDEMPOTENCY_KEY_MALFORMED|must be a UUID/,
      );
    });

    it('400 IDEMPOTENCY_CONTEXT_MISSING when req.user is absent', async () => {
      const handler: CallHandler = { handle: () => of('never-runs') };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY }, user: {} }),
        makeRes(),
        handler,
      );

      await expect(interceptor.intercept(ctx, handler)).rejects.toThrow(
        /IDEMPOTENCY_CONTEXT_MISSING|tenantId \/ userId missing/,
      );
    });

    it('first call: handler runs, response is stored in DDB', async () => {
      const handlerResult = { id: 'job-123', status: 'queued' };
      const handler: CallHandler = { handle: () => of(handlerResult) };
      const res = makeRes();
      res.statusCode = 202;
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY }, method: 'POST', path: '/finance/schools/x/invoices/bulk-generate' }),
        res,
        handler,
      );

      const result$ = await interceptor.intercept(ctx, handler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual(handlerResult);
      expect(dynamoDBClient.getItem).toHaveBeenCalledTimes(1);
      expect(dynamoDBClient.putItem).toHaveBeenCalledTimes(1);
      const stored = dynamoDBClient.putItem.mock.calls[0][1] as IdempotencyKeyEntity;
      expect(stored.entityType).toBe('IDEMPOTENCY_KEY');
      expect(stored.idempotencyKey).toBe(VALID_KEY);
      expect(stored.responseStatus).toBe(202);
      expect(JSON.parse(stored.responseBody)).toEqual(handlerResult);
      // 24h TTL ≈ epoch + 86400. Allow a 5s tolerance for test execution.
      const nowSec = Math.floor(Date.now() / 1000);
      expect(stored.expiresAt).toBeGreaterThanOrEqual(nowSec + 86400 - 5);
      expect(stored.expiresAt).toBeLessThanOrEqual(nowSec + 86400 + 5);
      // putItem called with attribute_not_exists guard
      expect(dynamoDBClient.putItem.mock.calls[0][2]).toBe('attribute_not_exists(entityKey)');
    });

    it('replay: same key + same route → handler does NOT run; stored body + status returned', async () => {
      const storedBody = { id: 'job-123', status: 'succeeded' };
      const storedRow: IdempotencyKeyEntity = {
        tenantId: TENANT_ID,
        entityKey: `IDEMPOTENCY#${USER_ID}#${VALID_KEY}`,
        entityType: 'IDEMPOTENCY_KEY',
        idempotencyKey: VALID_KEY,
        routeKey: 'POST /finance/schools/x/invoices/bulk-generate',
        responseStatus: 202,
        responseBody: JSON.stringify(storedBody),
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
        handler,
      );

      const result$ = await interceptor.intercept(ctx, handler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual(storedBody);
      expect(res.statusCode).toBe(202);
      expect(handlerSpy).not.toHaveBeenCalled();
      expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('cross-route reuse: same key on a different route → 409', async () => {
      const storedRow: IdempotencyKeyEntity = {
        tenantId: TENANT_ID,
        entityKey: `IDEMPOTENCY#${USER_ID}#${VALID_KEY}`,
        entityType: 'IDEMPOTENCY_KEY',
        idempotencyKey: VALID_KEY,
        routeKey: 'POST /finance/schools/x/invoices/bulk-generate',
        responseStatus: 202,
        responseBody: '{}',
        expiresAt: Math.floor(Date.now() / 1000) + 1000,
        createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 1,
      };
      dynamoDBClient.getItem.mockResolvedValueOnce(storedRow);

      const handler: CallHandler = { handle: () => of('') };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY }, method: 'POST', path: '/finance/schools/x/payments/manual' }),
        makeRes(),
        handler,
      );

      await expect(interceptor.intercept(ctx, handler)).rejects.toThrow(
        /IDEMPOTENCY_KEY_ROUTE_MISMATCH|previously used on a different route/,
      );
    });

    it('expired row: treated as miss; handler runs and overwrites', async () => {
      const expiredRow: IdempotencyKeyEntity = {
        tenantId: TENANT_ID,
        entityKey: `IDEMPOTENCY#${USER_ID}#${VALID_KEY}`,
        entityType: 'IDEMPOTENCY_KEY',
        idempotencyKey: VALID_KEY,
        routeKey: 'POST /test',
        responseStatus: 200,
        responseBody: '{"old": true}',
        expiresAt: Math.floor(Date.now() / 1000) - 60,
        createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 1,
      };
      dynamoDBClient.getItem.mockResolvedValueOnce(expiredRow);

      const handler: CallHandler = { handle: () => of({ fresh: true }) };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY } }),
        makeRes(),
        handler,
      );

      const result$ = await interceptor.intercept(ctx, handler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual({ fresh: true });
      expect(dynamoDBClient.putItem).toHaveBeenCalledTimes(1);
    });

    it('256 KB cap: oversized handler response is NOT stored; warning logged', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const big = 'x'.repeat(257 * 1024);
      const handler: CallHandler = { handle: () => of({ payload: big }) };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY } }),
        makeRes(),
        handler,
      );

      const result$ = await interceptor.intercept(ctx, handler);
      await lastValueFrom(result$);

      expect(dynamoDBClient.putItem).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/exceeds .* cap/),
      );
      warnSpy.mockRestore();
    });

    it('ConditionalCheckFailed on store: swallowed (concurrent dupe race)', async () => {
      dynamoDBClient.putItem.mockRejectedValueOnce(
        Object.assign(new Error('row exists'), { name: 'ConditionalCheckFailedException' }),
      );
      const handler: CallHandler = { handle: () => of({ ok: true }) };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY } }),
        makeRes(),
        handler,
      );

      const result$ = await interceptor.intercept(ctx, handler);
      const result = await lastValueFrom(result$);

      expect(result).toEqual({ ok: true });
    });

    it('DDB putItem fails mid-tap: handler response still returned; warning logged', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      dynamoDBClient.putItem.mockRejectedValueOnce(new Error('DDB unavailable'));
      const handler: CallHandler = { handle: () => of({ ok: true }) };
      const ctx = ctxFor(
        makeReq({ headers: { 'idempotency-key': VALID_KEY } }),
        makeRes(),
        handler,
      );

      const result$ = await interceptor.intercept(ctx, handler);
      const result = await lastValueFrom(result$);
      // Response is delivered before the fire-and-forget putItem's
      // .catch handler runs. Flush the microtask queue so the warn
      // log is observable to the assertion.
      await new Promise(setImmediate);

      expect(result).toEqual({ ok: true });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/stored-response write failed/),
      );
      warnSpy.mockRestore();
    });
  });
});
