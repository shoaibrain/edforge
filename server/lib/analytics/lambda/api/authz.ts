/**
 * S1.T4 — authz helpers. Pure functions, no framework.
 */

import type { JwtClaims } from './jwt-claims';

export class ForbiddenError extends Error {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export function isSystemAdmin(claims: JwtClaims): boolean {
  const allow = (process.env.SYSTEM_ADMIN_EMAILS || '')
    .toLowerCase()
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  return allow.includes((claims.email || '').toLowerCase());
}

export function requireOwnTenantOrSystemAdmin(
  claims: JwtClaims,
  pathTenantId: string,
): void {
  if (isSystemAdmin(claims)) return;
  if (claims.tenantId !== pathTenantId) {
    throw new ForbiddenError('Cannot read analytics for a different tenant');
  }
}

export function requireSystemAdmin(claims: JwtClaims): void {
  if (!isSystemAdmin(claims)) {
    throw new ForbiddenError('SystemAdmin required');
  }
}
