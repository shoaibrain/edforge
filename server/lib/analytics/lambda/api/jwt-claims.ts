/**
 * S1.T3 — JWT re-parser for the analytics API Lambda.
 *
 * The shared API Gateway Lambda authorizer does NOT forward `sub` or
 * `custom:tenantId` in its context — only `userName`, `tenantPath`,
 * `userRole`. We re-parse the JWT payload from the Authorization header
 * to extract the claims the analytics endpoints need.
 *
 * NOTE: this does NOT verify the JWT signature. Signature verification
 * is the authorizer's responsibility; by the time our Lambda runs, the
 * authorizer has already approved the request. We just decode the payload
 * segment (base64url → JSON).
 */

export interface JwtClaims {
  userId: string;       // JWT `sub`
  tenantId: string;     // JWT `custom:tenantId`
  email: string;        // JWT `email`
  globalRole: string;   // JWT `custom:userRole`
  tenantTier: string;   // JWT `custom:tenantTier`
}

export class AuthorizationError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export function extractClaims(authorizationHeader: string | undefined): JwtClaims {
  if (!authorizationHeader) {
    throw new AuthorizationError('Missing Authorization header');
  }
  const parts = authorizationHeader.split(' ');
  if (parts[0] !== 'Bearer' || !parts[1]) {
    throw new AuthorizationError('Authorization header must be Bearer <token>');
  }
  const token = parts[1];
  const segments = token.split('.');
  if (segments.length < 3) {
    throw new AuthorizationError('Malformed JWT — expected 3 segments');
  }
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], 'base64url').toString('utf-8'),
    );
    const userId = payload.sub;
    const tenantId = payload['custom:tenantId'];
    const email = payload.email ?? '';
    const globalRole = payload['custom:userRole'] ?? 'TenantUser';
    const tenantTier = payload['custom:tenantTier'] ?? 'BASIC';

    if (!userId) throw new AuthorizationError('JWT missing sub claim');
    if (!tenantId) throw new AuthorizationError('JWT missing custom:tenantId claim');

    return { userId, tenantId, email, globalRole, tenantTier };
  } catch (err) {
    if (err instanceof AuthorizationError) throw err;
    throw new AuthorizationError(`Failed to decode JWT payload: ${(err as Error).message}`);
  }
}
