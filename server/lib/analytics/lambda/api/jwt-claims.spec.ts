import { extractClaims, AuthorizationError } from './jwt-claims';

function makeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = 'sig';
  return `${header}.${body}.${sig}`;
}

describe('extractClaims', () => {
  it('parses a valid Bearer JWT into typed claims', () => {
    const token = makeToken({
      sub: 'user-a',
      'custom:tenantId': 'tenant-1',
      email: 'user@x.com',
      'custom:userRole': 'TenantAdmin',
      'custom:tenantTier': 'BASIC',
    });
    const claims = extractClaims(`Bearer ${token}`);
    expect(claims).toEqual({
      userId: 'user-a',
      tenantId: 'tenant-1',
      email: 'user@x.com',
      globalRole: 'TenantAdmin',
      tenantTier: 'BASIC',
    });
  });

  it('throws on missing header', () => {
    expect(() => extractClaims(undefined)).toThrow(AuthorizationError);
  });

  it('throws on malformed header (no Bearer)', () => {
    expect(() => extractClaims('Basic abc')).toThrow(AuthorizationError);
  });

  it('throws on malformed JWT (not 3 segments)', () => {
    expect(() => extractClaims('Bearer abc.def')).toThrow(AuthorizationError);
  });

  it('throws when sub claim is missing', () => {
    const token = makeToken({ 'custom:tenantId': 't1' });
    expect(() => extractClaims(`Bearer ${token}`)).toThrow(/sub/);
  });

  it('throws when custom:tenantId is missing', () => {
    const token = makeToken({ sub: 'u1' });
    expect(() => extractClaims(`Bearer ${token}`)).toThrow(/tenantId/);
  });

  it('defaults globalRole and tenantTier when unset', () => {
    const token = makeToken({ sub: 'u1', 'custom:tenantId': 't1' });
    const claims = extractClaims(`Bearer ${token}`);
    expect(claims.globalRole).toBe('TenantUser');
    expect(claims.tenantTier).toBe('BASIC');
    expect(claims.email).toBe('');
  });
});
