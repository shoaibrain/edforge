import { FeatureUsageInterceptor } from './feature-usage.interceptor';
import { of, throwError, lastValueFrom } from 'rxjs';
import type { AnalyticsEventsService } from '../analytics-events.service';
import type { CallHandler, ExecutionContext } from '@nestjs/common';

interface FakeRequest {
  method: string;
  url: string;
  user?: Record<string, unknown>;
  headers?: Record<string, string>;
}

function ctx(req: FakeRequest): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function handler(returnValue: unknown = { ok: true }, throwErr = false): CallHandler {
  return {
    handle: () => (throwErr ? throwError(() => new Error('boom')) : of(returnValue)),
  };
}

function makeAnalytics(enabled = true) {
  const emitFeatureUsage = jest.fn().mockResolvedValue(undefined);
  const svc = {
    isEnabled: () => enabled,
    emitFeatureUsage,
  } as unknown as AnalyticsEventsService;
  return { svc, emitFeatureUsage };
}

const authedReq = (method: string, url: string): FakeRequest => ({
  method,
  url,
  user: { tenantId: 't1', userId: 'u1', globalRole: 'Teacher' },
  headers: { 'x-correlation-id': 'corr-1' },
});

describe('FeatureUsageInterceptor', () => {
  it('emits FeatureUsage for POST/PUT/PATCH/DELETE (5 writes → 5 events)', async () => {
    const { svc, emitFeatureUsage } = makeAnalytics(true);
    const interceptor = new FeatureUsageInterceptor(svc);

    const writes: FakeRequest[] = [
      authedReq('POST', '/attendance/mark'),
      authedReq('PUT', '/attendance/123'),
      authedReq('PATCH', '/grades/456'),
      authedReq('DELETE', '/sessions/abc'),
      authedReq('POST', '/enrollments'),
    ];

    for (const r of writes) {
      await lastValueFrom(interceptor.intercept(ctx(r), handler()));
    }
    expect(emitFeatureUsage).toHaveBeenCalledTimes(5);
    const calls = emitFeatureUsage.mock.calls;
    expect(calls[0][0].metadata).toMatchObject({ feature: 'attendance', action: 'create', httpMethod: 'POST' });
    expect(calls[1][0].metadata).toMatchObject({ feature: 'attendance', action: 'update', httpMethod: 'PUT' });
    expect(calls[2][0].metadata).toMatchObject({ feature: 'grades',     action: 'update', httpMethod: 'PATCH' });
    expect(calls[3][0].metadata).toMatchObject({ feature: 'sessions',   action: 'delete', httpMethod: 'DELETE' });
    expect(calls[4][0].metadata).toMatchObject({ feature: 'enrollments', action: 'create', httpMethod: 'POST' });
    // tenant/user/role correctly forwarded + correlationId from header
    for (const [payload] of calls) {
      expect(payload).toMatchObject({
        tenantId: 't1',
        userId: 'u1',
        role: 'Teacher',
        correlationId: 'corr-1',
      });
    }
  });

  it('emits 0 events for 5 GET requests', async () => {
    const { svc, emitFeatureUsage } = makeAnalytics(true);
    const interceptor = new FeatureUsageInterceptor(svc);
    const gets = ['/users', '/schools', '/sessions', '/schools/1', '/users/me'];
    for (const u of gets) {
      await lastValueFrom(interceptor.intercept(ctx(authedReq('GET', u)), handler()));
    }
    expect(emitFeatureUsage).not.toHaveBeenCalled();
  });

  it('no-ops when ANALYTICS_ENABLED=false (write method)', async () => {
    const { svc, emitFeatureUsage } = makeAnalytics(false);
    const interceptor = new FeatureUsageInterceptor(svc);
    await lastValueFrom(
      interceptor.intercept(ctx(authedReq('POST', '/attendance')), handler()),
    );
    expect(emitFeatureUsage).not.toHaveBeenCalled();
  });

  it('skips anonymous / pre-auth requests', async () => {
    const { svc, emitFeatureUsage } = makeAnalytics(true);
    const interceptor = new FeatureUsageInterceptor(svc);
    const anon: FakeRequest = { method: 'POST', url: '/login' }; // no user
    await lastValueFrom(interceptor.intercept(ctx(anon), handler()));
    expect(emitFeatureUsage).not.toHaveBeenCalled();
  });

  it('still emits on downstream error (marks failed=true)', async () => {
    const { svc, emitFeatureUsage } = makeAnalytics(true);
    const interceptor = new FeatureUsageInterceptor(svc);
    await expect(
      lastValueFrom(
        interceptor.intercept(ctx(authedReq('POST', '/attendance')), handler(null, true)),
      ),
    ).rejects.toThrow('boom');
    expect(emitFeatureUsage).toHaveBeenCalledTimes(1);
    expect(emitFeatureUsage.mock.calls[0][0].metadata).toMatchObject({
      feature: 'attendance',
      action: 'create',
      failed: true,
    });
  });

  it('extracts feature from nested paths (first segment only)', async () => {
    const { svc, emitFeatureUsage } = makeAnalytics(true);
    const interceptor = new FeatureUsageInterceptor(svc);
    await lastValueFrom(
      interceptor.intercept(
        ctx(authedReq('POST', '/academics/grades/record?foo=bar')),
        handler(),
      ),
    );
    expect(emitFeatureUsage).toHaveBeenCalledTimes(1);
    expect(emitFeatureUsage.mock.calls[0][0].metadata.feature).toBe('academics');
  });

  it('non-http contexts pass through without emitting', async () => {
    const { svc, emitFeatureUsage } = makeAnalytics(true);
    const interceptor = new FeatureUsageInterceptor(svc);
    const rpcCtx = {
      getType: () => 'rpc',
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST', url: '/x' }) }),
    } as unknown as ExecutionContext;
    await lastValueFrom(interceptor.intercept(rpcCtx, handler()));
    expect(emitFeatureUsage).not.toHaveBeenCalled();
  });
});
