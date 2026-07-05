import { createHash } from 'crypto';
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { DynamoDBClientService } from '../services/dynamodb-client.service';
import { Session } from '../entities/session.entity';

/**
 * Session-revocation gate (SR.2).
 *
 * Gives per-session revoke real teeth: a request whose tracked session row was
 * flipped to `revoked` (by revokeSession or revokeAllSessions) is 401'd on its
 * NEXT identity request — before the access token's own TTL expires.
 *
 * Deliberately narrow and safe:
 * - DENY only when a session row EXISTS for this exact access token AND is
 *   revoked. Untracked tokens (no row — e.g. before the frontend registers a
 *   session) pass untouched, so this can never lock out live traffic.
 * - FAIL-OPEN on any lookup error: a revoke gate must never self-inflict an
 *   outage; the value of catching a rare revoke doesn't justify that risk.
 * - A short per-task cache bounds the added DDB read to ~one per token per
 *   window; a revoke takes effect within that window across all tasks.
 *
 * Identity-scoped: only protects the identity service. Cross-service revoke for
 * v1 is "sign out everywhere" (AdminUserGlobalSignOut in revokeAllSessions);
 * full per-session cross-service teeth are the R3 short-TTL / authzEpoch work.
 *
 * Registered as an APP_GUARD, so it runs before the per-controller JwtAuthGuard
 * and self-extracts the caller from the (API-Gateway-authenticated) bearer.
 */
@Injectable()
export class SessionRevokedGuard implements CanActivate {
  private readonly logger = new Logger(SessionRevokedGuard.name);
  private static readonly CACHE_TTL_MS = 30_000;
  private readonly cache = new Map<string, { revoked: boolean; exp: number }>();
  private lastPrune = 0;

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const bearer = (request.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    if (!bearer) {
      return true; // no token → public/health route → nothing to revoke
    }

    const claims = this.decodeClaims(bearer);
    if (!claims) {
      return true; // undecodable → let JwtAuthGuard reject it
    }

    const tokenHash = createHash('sha256').update(bearer).digest('hex');
    const now = Date.now();
    this.prune(now);

    const cached = this.cache.get(tokenHash);
    if (cached && cached.exp > now) {
      if (cached.revoked) {
        throw new UnauthorizedException('Session has been revoked');
      }
      return true;
    }

    let revoked = false;
    try {
      const client = await this.dynamoDBClient.getClient(claims.tenantId, bearer);
      const result = await this.dynamoDBClient.queryGSI<Session>(
        client,
        'GSI2',
        `TOKEN#${tokenHash}`,
        undefined,
        'eq',
        'userId = :userId',
        { ':userId': claims.userId },
      );
      revoked = result.items.some((s) => s.status === 'revoked');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`session-revoked check failed (allowing): ${msg}`);
      this.cache.set(tokenHash, { revoked: false, exp: now + SessionRevokedGuard.CACHE_TTL_MS });
      return true; // fail-open
    }

    this.cache.set(tokenHash, { revoked, exp: now + SessionRevokedGuard.CACHE_TTL_MS });
    if (revoked) {
      this.logger.warn(`Blocked revoked session for user ${claims.userId}`);
      throw new UnauthorizedException('Session has been revoked');
    }
    return true;
  }

  private decodeClaims(bearer: string): { userId: string; tenantId: string } | null {
    try {
      const seg = bearer.split('.')[1];
      if (!seg) return null;
      const payload = JSON.parse(Buffer.from(seg, 'base64').toString('utf8'));
      if (!payload?.sub || !payload['custom:tenantId']) return null;
      return { userId: payload.sub, tenantId: payload['custom:tenantId'] };
    } catch {
      return null;
    }
  }

  /** Sweep expired entries at most once per cache window; keeps the map bounded to recently-seen tokens. */
  private prune(now: number): void {
    if (now - this.lastPrune < SessionRevokedGuard.CACHE_TTL_MS) {
      return;
    }
    this.lastPrune = now;
    for (const [key, val] of this.cache) {
      if (val.exp <= now) {
        this.cache.delete(key);
      }
    }
  }
}
