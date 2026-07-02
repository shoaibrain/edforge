import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * R1.7 / AUD.6 — the JWT front door. `JwtAuthGuard` extends passport's
 * `AuthGuard('jwt')`; its only own logic is the `@Public` (isPublic) bypass.
 * The expired/malformed/absent-token → 401 behavior is enforced by passport-jwt
 * via the strategy options (see jwt.strategy.spec.ts for the validated-payload
 * → context mapping), not by this guard, so it is not re-tested here.
 */
const ctx = () =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({}) }),
  }) as unknown as ExecutionContext;

function guardWith(isPublic: boolean | undefined) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as unknown as Reflector;
  return { guard: new JwtAuthGuard(reflector), reflector };
}

describe('JwtAuthGuard', () => {
  // Base AuthGuard('jwt').canActivate lives on the parent prototype; spy so the
  // delegation path doesn't actually invoke passport.
  const basePrototype = Object.getPrototypeOf(JwtAuthGuard.prototype);
  let baseSpy: jest.SpyInstance;

  beforeEach(() => {
    baseSpy = jest.spyOn(basePrototype, 'canActivate').mockReturnValue(true);
  });
  afterEach(() => {
    baseSpy.mockRestore();
  });

  it('bypasses authentication for a @Public route (isPublic=true) without invoking passport', () => {
    const { guard } = guardWith(true);
    expect(guard.canActivate(ctx())).toBe(true);
    expect(baseSpy).not.toHaveBeenCalled();
  });

  it('delegates to the passport JWT guard when the route is not public (isPublic=false)', () => {
    const { guard } = guardWith(false);
    expect(guard.canActivate(ctx())).toBe(true);
    expect(baseSpy).toHaveBeenCalledTimes(1);
  });

  it('delegates to the passport JWT guard when no @Public decorator is present (isPublic=undefined)', () => {
    const { guard } = guardWith(undefined);
    guard.canActivate(ctx());
    expect(baseSpy).toHaveBeenCalledTimes(1);
  });
});
