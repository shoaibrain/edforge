import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InternalApiKeyGuard } from './internal-api-key.guard';

/**
 * R1.9 / FIN.6 — the internal (service-to-service) API-key guard on finance
 * webhook/internal routes. Pins the current single-key behavior: unconfigured →
 * 401, missing/wrong/wrong-length key → 401, correct key → pass. (Dual-key
 * rotation `INTERNAL_API_KEY` + `_PREVIOUS` is R6.1 / Tier B.)
 */
const KEY = 'super-secret-key-123'; // 20 chars
const ctxFor = (headers: Record<string, unknown>): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;

describe('InternalApiKeyGuard (finance)', () => {
  const ORIGINAL = process.env.INTERNAL_API_KEY;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = ORIGINAL;
  });

  it('throws when no internal API key is configured (fail-closed)', () => {
    delete process.env.INTERNAL_API_KEY;
    const guard = new InternalApiKeyGuard();
    expect(() => guard.canActivate(ctxFor({ 'x-internal-api-key': 'anything' }))).toThrow(UnauthorizedException);
  });

  it('allows a request carrying the correct key', () => {
    process.env.INTERNAL_API_KEY = KEY;
    const guard = new InternalApiKeyGuard();
    expect(guard.canActivate(ctxFor({ 'x-internal-api-key': KEY }))).toBe(true);
  });

  it('rejects a wrong key of the same length', () => {
    process.env.INTERNAL_API_KEY = KEY;
    const guard = new InternalApiKeyGuard();
    expect(() => guard.canActivate(ctxFor({ 'x-internal-api-key': 'wrong-secret-key-999' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a key of the wrong length before timingSafeEqual', () => {
    process.env.INTERNAL_API_KEY = KEY;
    const guard = new InternalApiKeyGuard();
    expect(() => guard.canActivate(ctxFor({ 'x-internal-api-key': 'short' }))).toThrow(UnauthorizedException);
  });

  it('rejects a request with no key header', () => {
    process.env.INTERNAL_API_KEY = KEY;
    const guard = new InternalApiKeyGuard();
    expect(() => guard.canActivate(ctxFor({}))).toThrow(UnauthorizedException);
  });
});
