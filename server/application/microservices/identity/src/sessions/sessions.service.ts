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
import { 
  Session,
  SESSION_CONFIG,
} from '../common/entities/session.entity';
import { 
  EntityKeyBuilder, 
  RequestContext,
} from '../common/entities/base.entity';
import type {
  SessionResponseDto,
  SessionListResponseDto,
  RevokeSessionDto,
  RevokeAllSessionsDto,
} from '@aibrains/shared-types';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

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
    const now = new Date().toISOString();

    for (const session of result.items) {
      // Skip current session if requested
      if (revokeAllDto.exceptCurrentSession && session.sessionId === revokeAllDto.exceptCurrentSession) {
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

