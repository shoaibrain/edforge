/**
 * Sessions Service - Session management with TTL
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityAnalyticsEventsService } from '../common/services/identity-analytics-events.service';
import { 
  Session,
  SESSION_CONFIG,
} from '../common/entities/session.entity';
import {
  EntityKeyBuilder,
  RequestContext,
} from '../common/entities/base.entity';
import { User } from '../common/entities/user.entity';
import {
  CognitoIdentityProviderClient,
  AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type {
  SessionResponseDto,
  SessionListResponseDto,
  RevokeSessionDto,
  RevokeAllSessionsDto,
} from '@aibrains/shared-types';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly cognitoClient: CognitoIdentityProviderClient;
  private readonly userPoolId: string;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly analytics: IdentityAnalyticsEventsService,
  ) {
    this.cognitoClient = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.userPoolId = process.env.COGNITO_USER_POOL_ID || '';
  }

  /**
   * Kill a user's Cognito refresh tokens (SR.4 / S4.2 revocation teeth).
   * Resolves the target's Cognito username from their user record so it works
   * for BOTH self and admin-on-another-user revokes. Best-effort: the DDB
   * session rows are already revoked (and enforced on identity by
   * SessionRevokedGuard), so a Cognito hiccup must not fail the operation.
   * Returns true if the global sign-out fired.
   */
  private async globalSignOut(
    client: Parameters<DynamoDBClientService['updateItem']>[0],
    tenantId: string,
    userId: string
  ): Promise<boolean> {
    try {
      const user = await this.dynamoDBClient.getItem<User>(
        client,
        tenantId,
        EntityKeyBuilder.user(userId)
      );
      if (!user?.cognitoUsername) {
        this.logger.warn(`No cognitoUsername for user ${userId}; skipping global sign-out`);
        return false;
      }
      await this.cognitoClient.send(
        new AdminUserGlobalSignOutCommand({
          UserPoolId: this.userPoolId,
          Username: user.cognitoUsername,
        })
      );
      this.logger.log(`Cognito global sign-out for user: ${userId}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Cognito global sign-out failed for ${userId}: ${msg}`);
      return false;
    }
  }

  /**
   * List all sessions for current user
   */
  async listSessions(
    context: RequestContext
  ): Promise<SessionListResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.query<Session>(
      client,
      context.tenantId,
      'SESSION#',
      'userId = :userId AND #status = :status',
      { ':userId': context.userId, ':status': 'active' },
      { '#status': 'status' }
    );

    // Filter out expired sessions
    const now = new Date();
    const activeSessions = result.items.filter(s => 
      new Date(s.refreshTokenExpiresAt) > now
    );

    return {
      sessions: activeSessions.map(s => this.toSessionResponse(s)),
      total: activeSessions.length,
    };
  }

  /**
   * Get session by ID
   */
  async getSession(
    sessionId: string,
    context: RequestContext
  ): Promise<SessionResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const session = await this.dynamoDBClient.getItem<Session>(
      client,
      context.tenantId,
      EntityKeyBuilder.session(sessionId)
    );

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Verify ownership
    if (session.userId !== context.userId && context.globalRole !== 'TenantAdmin') {
      throw new ForbiddenException('Cannot access this session');
    }

    return this.toSessionResponse(session);
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(
    revokeDto: RevokeSessionDto,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get session to verify ownership
    const session = await this.dynamoDBClient.getItem<Session>(
      client,
      context.tenantId,
      EntityKeyBuilder.session(revokeDto.sessionId)
    );

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Verify ownership (users can revoke their own sessions, admins can revoke any)
    if (session.userId !== context.userId && context.globalRole !== 'TenantAdmin') {
      throw new ForbiddenException('Cannot revoke this session');
    }

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.session(revokeDto.sessionId),
      'SET #status = :status, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':status': 'revoked',
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      },
      undefined,
      { '#status': 'status' }
    );

    this.logger.log(`Session revoked: ${revokeDto.sessionId}`);

    // Layer 4.4 — SessionRevoked for single revocation.
    this.analytics.emitSessionRevoked({
      tenantId: context.tenantId,
      userId: session.userId,
      rawRole: context.globalRole,
      metadata: {
        sessionId: revokeDto.sessionId,
        revokedAll: false,
        revokedBy: context.userId,
      },
    });
  }

  /**
   * Revoke all sessions for current user
   */
  async revokeAllSessions(
    revokeAllDto: RevokeAllSessionsDto,
    context: RequestContext
  ): Promise<{ revokedCount: number }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get all active sessions for user
    const result = await this.dynamoDBClient.query<Session>(
      client,
      context.tenantId,
      'SESSION#',
      'userId = :userId AND #status = :status',
      { ':userId': context.userId, ':status': 'active' },
      { '#status': 'status' }
    );

    let revokedCount = 0;
    let preservedCurrent = false;
    const now = new Date().toISOString();

    for (const session of result.items) {
      // Skip current session if requested
      if (revokeAllDto.exceptCurrentSession && session.sessionId === revokeAllDto.exceptCurrentSession) {
        preservedCurrent = true;
        continue;
      }

      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        session.entityKey,
        'SET #status = :status, updatedAt = :updatedAt, updatedBy = :updatedBy',
        {
          ':status': 'revoked',
          ':updatedAt': now,
          ':updatedBy': context.userId,
        },
        undefined,
        { '#status': 'status' }
      );

      revokedCount++;
    }

    this.logger.log(`Revoked ${revokedCount} sessions for user: ${context.userId}`);

    // S4.2 — a full self "sign out everywhere" also kills Cognito refresh
    // tokens. Only suppress when a session was ACTUALLY preserved: a stale or
    // bogus exceptCurrentSession (caller-controlled) matches nothing, so every
    // active session is revoked and the refresh tokens must die too (review P2).
    const globalSignOut = preservedCurrent
      ? false
      : await this.globalSignOut(client, context.tenantId, context.userId);

    // Layer 4.4 — SessionRevoked with revokedAll flag.
    this.analytics.emitSessionRevoked({
      tenantId: context.tenantId,
      userId: context.userId,
      rawRole: context.globalRole,
      metadata: {
        revokedAll: true,
        revokedCount,
        exceptSessionId: revokeAllDto.exceptCurrentSession ?? null,
        globalSignOut,
      },
    });

    return { revokedCount };
  }

  /**
   * Admin: List all sessions for a specific user
   */
  async listUserSessions(
    userId: string,
    context: RequestContext
  ): Promise<SessionListResponseDto> {
    // Only admins can view other users' sessions
    if (userId !== context.userId && context.globalRole !== 'TenantAdmin') {
      throw new ForbiddenException('Cannot view sessions for other users');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.query<Session>(
      client,
      context.tenantId,
      'SESSION#',
      'userId = :userId',
      { ':userId': userId }
    );

    return {
      sessions: result.items.map(s => this.toSessionResponse(s)),
      total: result.items.length,
    };
  }

  /**
   * Admin: Revoke all sessions for a user
   */
  async revokeUserSessions(
    userId: string,
    context: RequestContext
  ): Promise<{ revokedCount: number }> {
    // Only admins can revoke other users' sessions
    if (context.globalRole !== 'TenantAdmin') {
      throw new ForbiddenException('Only TenantAdmin can revoke other users sessions');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // S4.1a — cross-tenant defense-in-depth: the target must live in the
    // caller's tenant partition. A TenantAdmin of tenant A requesting a
    // tenant-B user (or any unknown user) resolves to nothing here → 404,
    // rather than a silent no-op revoke against an empty session set.
    const target = await this.dynamoDBClient.getItem<User>(
      client,
      context.tenantId,
      EntityKeyBuilder.user(userId)
    );
    if (!target) {
      throw new NotFoundException('User not found');
    }

    const result = await this.dynamoDBClient.query<Session>(
      client,
      context.tenantId,
      'SESSION#',
      'userId = :userId AND #status = :status',
      { ':userId': userId, ':status': 'active' },
      { '#status': 'status' }
    );

    let revokedCount = 0;
    const now = new Date().toISOString();

    for (const session of result.items) {
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        session.entityKey,
        'SET #status = :status, updatedAt = :updatedAt, updatedBy = :updatedBy',
        {
          ':status': 'revoked',
          ':updatedAt': now,
          ':updatedBy': context.userId,
        },
        undefined,
        { '#status': 'status' }
      );

      revokedCount++;
    }

    this.logger.log(`Admin revoked ${revokedCount} sessions for user: ${userId}`);

    // S4.2 — real teeth: kill the TARGET's Cognito refresh tokens so the
    // terminated user is forced to re-authenticate (not just blocked on the
    // identity DDB rows). Best-effort.
    const globalSignOut = await this.globalSignOut(client, context.tenantId, userId);

    // S4.4 — admin session-revoke signal (scope=admin, target + actor + count).
    this.analytics.emitSessionRevoked({
      tenantId: context.tenantId,
      userId,
      rawRole: target.globalRole,
      metadata: {
        revokedAll: true,
        revokedCount,
        admin: true,
        revokedBy: context.userId,
        globalSignOut,
      },
    });

    return { revokedCount };
  }

  /**
   * Cleanup expired sessions (called by scheduled job)
   */
  async cleanupExpiredSessions(tenantId: string): Promise<number> {
    const client = this.dynamoDBClient.getSystemClient();

    // Get all sessions for tenant
    const result = await this.dynamoDBClient.query<Session>(
      client,
      tenantId,
      'SESSION#'
    );

    const now = new Date();
    let cleanedCount = 0;

    for (const session of result.items) {
      // Check if refresh token is expired
      if (new Date(session.refreshTokenExpiresAt) < now && session.status === 'active') {
        await this.dynamoDBClient.updateItem(
          client,
          tenantId,
          session.entityKey,
          'SET #status = :status',
          { ':status': 'expired' },
          undefined,
          { '#status': 'status' }
        );
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.log(`Cleaned up ${cleanedCount} expired sessions for tenant: ${tenantId}`);
    }

    return cleanedCount;
  }

  /**
   * Convert session entity to response DTO
   */
  private toSessionResponse(session: Session): SessionResponseDto {
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      status: session.status,
      createdAt: session.createdAt,
      expiresAt: session.refreshTokenExpiresAt,
      deviceInfo: session.deviceInfo,
      ipAddress: session.ipAddress,
    };
  }
}

