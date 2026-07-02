import { JwtStrategy } from './jwt.strategy';
import { AuthConfig } from './auth-config';

/**
 * R1.7 / AUD.6 — the validated-payload → TenantContext mapping. passport-jwt
 * rejects expired/malformed/wrong-audience tokens BEFORE `validate()` runs (via
 * the strategy options: RS256, issuer, audience, JWKS, default ignoreExpiration
 * = false), so those 401 paths are passport's contract. `validate()` is our
 * code: it must populate the request context and normalize tier/role — an
 * unknown role must fall back to least privilege, not fail open.
 */
const authConfig = {
  authority: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TESTPOOL',
  clientId: 'test-client-id',
  userPoolId: 'us-east-1_TESTPOOL',
  region: 'us-east-1',
} as unknown as AuthConfig;

const basePayload = {
  sub: 'user-uuid',
  'cognito:username': 'johndoe-tenant',
  'cognito:groups': ['tenant-uuid'],
  'custom:tenantId': 'tenant-uuid',
  'custom:tenantTier': 'BASIC',
  'custom:tenantName': 'Acme School',
  'custom:userRole': 'TenantAdmin',
  email: 'john@acme.edu',
  iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TESTPOOL',
  aud: 'test-client-id',
  iat: 1,
  exp: 2,
  jti: 'jti-1',
} as any;

describe('JwtStrategy.validate', () => {
  const strategy = new JwtStrategy(authConfig);

  it('populates TenantContext from Cognito claims', async () => {
    const ctx = await strategy.validate(basePayload);
    expect(ctx).toMatchObject({
      userId: 'user-uuid',
      username: 'johndoe-tenant',
      tenantId: 'tenant-uuid',
      tenantName: 'Acme School',
      email: 'john@acme.edu',
      globalRole: 'TenantAdmin',
      tenantTier: 'BASIC',
      appClientId: 'test-client-id',
    });
  });

  it.each([
    ['BASIC', 'BASIC'],
    ['basic', 'BASIC'],
    ['ADVANCED', 'ADVANCED'],
    ['premium', 'PREMIUM'],
    ['garbage', 'BASIC'],
    [undefined, 'BASIC'],
  ])('normalizes tenantTier %s → %s', async (input, expected) => {
    const ctx = await strategy.validate({ ...basePayload, 'custom:tenantTier': input });
    expect(ctx.tenantTier).toBe(expected);
  });

  it.each([
    ['TenantAdmin', 'TenantAdmin'],
    ['TenantUser', 'TenantUser'],
    ['StandardUser', 'TenantUser'],
    ['SuperAdmin', 'TenantUser'],
    [undefined, 'TenantUser'],
  ])('normalizes globalRole %s → %s (unknown falls back to least privilege)', async (input, expected) => {
    const ctx = await strategy.validate({ ...basePayload, 'custom:userRole': input });
    expect(ctx.globalRole).toBe(expected);
  });
});
