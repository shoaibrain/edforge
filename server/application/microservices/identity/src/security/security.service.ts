/**
 * Security Service - User security management
 * 
 * Handles password changes, MFA, session management, and login history.
 * Integrates with AWS Cognito for authentication operations.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CognitoIdentityProviderClient,
  ChangePasswordCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
  AdminSetUserMFAPreferenceCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import * as crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  Session,
  createSessionEntity,
  SESSION_CONFIG,
  DeviceInfo,
} from '../common/entities/session.entity';
import { User } from '../common/entities/user.entity';
import {
  EntityKeyBuilder,
  RequestContext,
} from '../common/entities/base.entity';
import type {
  SecurityOverviewDto,
  ChangePasswordDto,
  ChangePasswordResponseDto,
  MfaSetupResponseDto,
  MfaVerifyDto,
  MfaVerifyResponseDto,
  MfaDisableDto,
  MfaDisableResponseDto,
  SecuritySessionDto,
  SecuritySessionsListDto,
  RevokeSessionResponseDto,
  RevokeAllSessionsResponseDto,
  LoginHistoryEntryDto,
  LoginHistoryResponseDto,
  DeviceType,
} from '@aibrains/shared-types';

/**
 * Login history entity stored in DynamoDB
 */
interface LoginHistoryEntry {
  tenantId: string;
  entityKey: string;  // USER#{userId}#LOGIN#{timestamp}
  entityType: 'LOGIN_HISTORY';
  userId: string;
  timestamp: string;
  status: 'success' | 'failed' | 'blocked';
  ipAddress?: string;
  userAgent?: string;
  deviceType?: DeviceType;
  browser?: string;
  os?: string;
  location?: string;
  failureReason?: string;
}

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);
  private readonly cognitoClient: CognitoIdentityProviderClient;
  private readonly userPoolId: string;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {
    this.cognitoClient = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.userPoolId = process.env.COGNITO_USER_POOL_ID || '';
  }

  /**
   * Get security overview for a user
   * GET /users/{id}/security
   */
  async getSecurityOverview(
    userId: string,
    context: RequestContext
  ): Promise<SecurityOverviewDto> {
    // Verify access rights
    this.verifyAccess(userId, context);

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get user from DynamoDB
    const user = await this.dynamoDBClient.getItem<User>(
      client,
      context.tenantId,
      EntityKeyBuilder.user(userId)
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get active sessions count
    const sessionsResult = await this.dynamoDBClient.query<Session>(
      client,
      context.tenantId,
      'SESSION#',
      'userId = :userId AND #status = :status',
      { ':userId': userId, ':status': 'active' },
      { '#status': 'status' }
    );

    const now = new Date();
    const activeSessions = sessionsResult.items.filter(s =>
      new Date(s.refreshTokenExpiresAt) > now
    );

    // Calculate security score
    const { score, recommendations } = this.calculateSecurityScore(user, activeSessions.length);

    return {
      userId: user.userId,
      email: user.email,
      mfaEnabled: user.mfaEnabled || false,
      mfaMethod: undefined, // Would come from Cognito if enabled
      lastLoginAt: user.lastLoginAt,
      lastLoginIp: user.lastLoginIp,
      lastLoginDevice: undefined,
      passwordLastChangedAt: undefined, // Would come from Cognito
      accountLocked: user.status === 'locked',
      lockExpiresAt: user.lockedUntil,
      failedLoginAttempts: user.failedLoginAttempts || 0,
      activeSessions: activeSessions.length,
      securityScore: score,
      recommendations,
    };
  }

  /**
   * Change user password
   * POST /users/{id}/security/change-password
   */
  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
    context: RequestContext
  ): Promise<ChangePasswordResponseDto> {
    // Users can only change their own password
    if (userId !== context.userId) {
      throw new ForbiddenException('Cannot change password for other users');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get user to get Cognito username
    const user = await this.dynamoDBClient.getItem<User>(
      client,
      context.tenantId,
      EntityKeyBuilder.user(userId)
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    try {
      // Change password in Cognito using access token
      await this.cognitoClient.send(new ChangePasswordCommand({
        AccessToken: context.jwtToken,
        PreviousPassword: changePasswordDto.currentPassword,
        ProposedPassword: changePasswordDto.newPassword,
      }));

      const now = new Date().toISOString();

      // Update user record with password change timestamp
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        EntityKeyBuilder.user(userId),
        'SET passwordLastChangedAt = :timestamp, updatedAt = :timestamp',
        { ':timestamp': now }
      );

      this.logger.log(`Password changed for user: ${userId}`);

      return {
        success: true,
        message: 'Password changed successfully',
        passwordLastChangedAt: now,
      };
    } catch (error: any) {
      if (error.name === 'NotAuthorizedException') {
        throw new UnauthorizedException('Current password is incorrect');
      }
      if (error.name === 'InvalidPasswordException') {
        throw new BadRequestException('New password does not meet requirements');
      }
      this.logger.error(`Password change failed: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to change password');
    }
  }

  /**
   * Initiate MFA setup
   * POST /users/{id}/security/mfa/setup
   */
  async initiateMfaSetup(
    userId: string,
    context: RequestContext
  ): Promise<MfaSetupResponseDto> {
    // Users can only setup MFA for themselves
    if (userId !== context.userId) {
      throw new ForbiddenException('Cannot setup MFA for other users');
    }

    try {
      // Associate software token with user
      const response = await this.cognitoClient.send(new AssociateSoftwareTokenCommand({
        AccessToken: context.jwtToken,
      }));

      const secretCode = response.SecretCode || '';
      const email = context.email;
      
      // Generate QR code URL for authenticator apps
      const qrCodeUrl = `otpauth://totp/EdForge:${email}?secret=${secretCode}&issuer=EdForge`;
      
      this.logger.log(`MFA setup initiated for user: ${userId}`);

      return {
        secretKey: secretCode,
        qrCodeUrl,
        manualEntryKey: secretCode,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
      };
    } catch (error: any) {
      this.logger.error(`MFA setup failed: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to initiate MFA setup');
    }
  }

  /**
   * Verify and enable MFA
   * POST /users/{id}/security/mfa/verify
   */
  async verifyAndEnableMfa(
    userId: string,
    verifyDto: MfaVerifyDto,
    context: RequestContext
  ): Promise<MfaVerifyResponseDto> {
    // Users can only enable MFA for themselves
    if (userId !== context.userId) {
      throw new ForbiddenException('Cannot enable MFA for other users');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    try {
      // Verify the software token
      await this.cognitoClient.send(new VerifySoftwareTokenCommand({
        AccessToken: context.jwtToken,
        UserCode: verifyDto.code,
        FriendlyDeviceName: 'Authenticator App',
      }));

      // Enable TOTP MFA for the user
      await this.cognitoClient.send(new SetUserMFAPreferenceCommand({
        AccessToken: context.jwtToken,
        SoftwareTokenMfaSettings: {
          Enabled: true,
          PreferredMfa: true,
        },
      }));

      // Generate backup codes
      const backupCodes = this.generateBackupCodes();

      // Update user record
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        EntityKeyBuilder.user(userId),
        'SET mfaEnabled = :mfaEnabled, updatedAt = :updatedAt',
        {
          ':mfaEnabled': true,
          ':updatedAt': new Date().toISOString(),
        }
      );

      this.logger.log(`MFA enabled for user: ${userId}`);

      return {
        success: true,
        backupCodes,
        message: 'MFA enabled successfully. Save your backup codes securely.',
      };
    } catch (error: any) {
      if (error.name === 'CodeMismatchException') {
        throw new BadRequestException('Invalid verification code');
      }
      this.logger.error(`MFA verification failed: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to enable MFA');
    }
  }

  /**
   * Disable MFA
   * POST /users/{id}/security/mfa/disable
   */
  async disableMfa(
    userId: string,
    disableDto: MfaDisableDto,
    context: RequestContext
  ): Promise<MfaDisableResponseDto> {
    // Users can only disable MFA for themselves
    if (userId !== context.userId) {
      throw new ForbiddenException('Cannot disable MFA for other users');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    try {
      // Disable TOTP MFA for the user
      await this.cognitoClient.send(new SetUserMFAPreferenceCommand({
        AccessToken: context.jwtToken,
        SoftwareTokenMfaSettings: {
          Enabled: false,
          PreferredMfa: false,
        },
      }));

      // Update user record
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        EntityKeyBuilder.user(userId),
        'SET mfaEnabled = :mfaEnabled, updatedAt = :updatedAt',
        {
          ':mfaEnabled': false,
          ':updatedAt': new Date().toISOString(),
        }
      );

      this.logger.log(`MFA disabled for user: ${userId}`);

      return {
        success: true,
        message: 'MFA disabled successfully',
      };
    } catch (error: any) {
      this.logger.error(`MFA disable failed: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to disable MFA');
    }
  }

  /**
   * Get active sessions
   * GET /users/{id}/security/sessions
   */
  /**
   * Register (or refresh) the caller's session — the seam that lets
   * Amplify-direct logins populate the SESSION store. The frontend calls this
   * right after Cognito `signIn`; we hash the caller's ACCESS token (the only
   * value that can honestly power `isCurrent` on later reads) and record the
   * device/IP. Amplify holds the refresh token client-side, so there is no
   * refresh-token hash — the row's lifetime (and DDB TTL) is driven off an
   * idle window instead.
   *
   * Upsert semantics: keyed on the access-token hash via GSI2, so a repeated
   * register for the same token bumps `updatedAt` rather than duplicating.
   */
  async registerSession(
    userId: string,
    context: RequestContext,
    meta: { ipAddress?: string; userAgent?: string }
  ): Promise<SecuritySessionDto> {
    this.verifyAccess(userId, context);

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const accessTokenHash = this.hashToken(context.jwtToken);
    const nowIso = new Date().toISOString();

    // Already registered for this exact access token → just refresh last-active.
    const existing = await this.dynamoDBClient.queryGSI<Session>(
      client,
      'GSI2',
      `TOKEN#${accessTokenHash}`,
      undefined,
      'eq',
      'userId = :userId',
      { ':userId': userId }
    );
    if (existing.items.length > 0) {
      const s = existing.items[0];
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        EntityKeyBuilder.session(s.sessionId),
        'SET updatedAt = :now',
        { ':now': nowIso }
      );
      return this.toSessionDto({ ...s, updatedAt: nowIso }, accessTokenHash);
    }

    // New session row for this access token.
    const parsed = this.parseUserAgent(meta.userAgent);
    const deviceInfo: DeviceInfo = {
      deviceType: parsed.deviceType ?? 'unknown',
      browser: parsed.browser,
      os: parsed.os,
    };
    const idleExpiry = new Date(
      Date.now() + SESSION_CONFIG.REFRESH_TOKEN_EXPIRY_SECONDS * 1000
    );
    const session = createSessionEntity(
      context.tenantId,
      uuid(),
      userId,
      accessTokenHash,
      '', // no refresh-token hash — Amplify holds the refresh token client-side
      this.accessTokenExpiry(context.jwtToken),
      idleExpiry,
      userId,
      { deviceInfo, ipAddress: meta.ipAddress, userAgent: meta.userAgent }
    );
    await this.dynamoDBClient.putItem(client, session);
    return this.toSessionDto(session, accessTokenHash);
  }

  /**
   * Heartbeat — rebind an existing session row to the caller's CURRENT access
   * token and extend its idle window. The frontend calls this after Amplify
   * silently rotates the access token: the new token hashes differently, so
   * without an in-place update each rotation would spawn a duplicate row and
   * break `isCurrent`. Refuses a revoked session (a heartbeat must not
   * resurrect one). PATCH /users/:id/security/sessions/:sessionId
   */
  async touchSession(
    userId: string,
    sessionId: string,
    context: RequestContext
  ): Promise<SecuritySessionDto> {
    this.verifyAccess(userId, context);

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const session = await this.dynamoDBClient.getItem<Session>(
      client,
      context.tenantId,
      EntityKeyBuilder.session(sessionId)
    );
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('Session does not belong to this user');
    }
    if (session.status === 'revoked') {
      throw new ForbiddenException('Session has been revoked');
    }

    const accessTokenHash = this.hashToken(context.jwtToken);
    const accessExpiry = this.accessTokenExpiry(context.jwtToken).toISOString();
    const idleExpiry = new Date(
      Date.now() + SESSION_CONFIG.REFRESH_TOKEN_EXPIRY_SECONDS * 1000
    );
    const nowIso = new Date().toISOString();

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.session(sessionId),
      'SET accessTokenHash = :hash, gsi2pk = :gsi2pk, gsi2sk = :accessExp, accessTokenExpiresAt = :accessExp, refreshTokenExpiresAt = :idleExp, #ttl = :ttl, updatedAt = :now',
      {
        ':hash': accessTokenHash,
        ':gsi2pk': `TOKEN#${accessTokenHash}`,
        ':accessExp': accessExpiry,
        ':idleExp': idleExpiry.toISOString(),
        ':ttl': Math.floor(idleExpiry.getTime() / 1000),
        ':now': nowIso,
      },
      undefined,
      { '#ttl': 'ttl' }
    );

    return this.toSessionDto(
      {
        ...session,
        accessTokenHash,
        gsi2pk: `TOKEN#${accessTokenHash}`,
        accessTokenExpiresAt: accessExpiry,
        refreshTokenExpiresAt: idleExpiry.toISOString(),
        updatedAt: nowIso,
      },
      accessTokenHash
    );
  }

  async getActiveSessions(
    userId: string,
    context: RequestContext
  ): Promise<SecuritySessionsListDto> {
    this.verifyAccess(userId, context);

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.query<Session>(
      client,
      context.tenantId,
      'SESSION#',
      'userId = :userId AND #status = :status',
      { ':userId': userId, ':status': 'active' },
      { '#status': 'status' }
    );

    const now = new Date();
    const currentTokenHash = this.hashToken(context.jwtToken);

    const sessions: SecuritySessionDto[] = result.items
      .filter(s => new Date(s.refreshTokenExpiresAt) > now)
      .map(s => this.toSessionDto(s, currentTokenHash));

    // Sort by creation date, most recent first
    sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const currentSession = sessions.find(s => s.isCurrent);

    return {
      sessions,
      total: sessions.length,
      currentSessionId: currentSession?.sessionId,
    };
  }

  /** Map a stored Session row to the API DTO. `isCurrent` is the caller's token. */
  private toSessionDto(s: Session, currentTokenHash: string): SecuritySessionDto {
    return {
      sessionId: s.sessionId,
      createdAt: s.createdAt,
      lastActivityAt: s.updatedAt,
      expiresAt: s.refreshTokenExpiresAt,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      deviceType: s.deviceInfo?.deviceType,
      browser: s.deviceInfo?.browser,
      os: s.deviceInfo?.os,
      location: undefined, // v2 — requires IP geolocation
      isCurrent: s.accessTokenHash === currentTokenHash,
    };
  }

  /**
   * Access-token expiry from the JWT `exp` claim (already signature-verified by
   * JwtAuthGuard, so a plain payload decode is safe). Falls back to the default
   * access-token lifetime if the claim is unreadable.
   */
  private accessTokenExpiry(jwtToken: string): Date {
    try {
      const payload = JSON.parse(
        Buffer.from(jwtToken.split('.')[1], 'base64').toString('utf-8')
      );
      if (typeof payload.exp === 'number') return new Date(payload.exp * 1000);
    } catch {
      // fall through to default
    }
    return new Date(Date.now() + SESSION_CONFIG.ACCESS_TOKEN_EXPIRY_SECONDS * 1000);
  }

  /**
   * Revoke a specific session
   * DELETE /users/{id}/security/sessions/{sessionId}
   */
  async revokeSession(
    userId: string,
    sessionId: string,
    context: RequestContext
  ): Promise<RevokeSessionResponseDto> {
    this.verifyAccess(userId, context);

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get session to verify ownership
    const session = await this.dynamoDBClient.getItem<Session>(
      client,
      context.tenantId,
      EntityKeyBuilder.session(sessionId)
    );

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.userId !== userId) {
      throw new ForbiddenException('Session does not belong to this user');
    }

    // Revoke the session
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.session(sessionId),
      'SET #status = :status, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':status': 'revoked',
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      },
      undefined,
      { '#status': 'status' }
    );

    this.logger.log(`Session revoked: ${sessionId} for user: ${userId}`);

    return {
      success: true,
      sessionId,
      message: 'Session revoked successfully',
    };
  }

  /**
   * Revoke all sessions
   * POST /users/{id}/security/sessions/revoke-all
   */
  async revokeAllSessions(
    userId: string,
    exceptCurrentSession: boolean,
    context: RequestContext
  ): Promise<RevokeAllSessionsResponseDto> {
    this.verifyAccess(userId, context);

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get all active sessions for user
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
    const currentTokenHash = this.hashToken(context.jwtToken);

    for (const session of result.items) {
      // Skip current session if requested
      if (exceptCurrentSession && session.accessTokenHash === currentTokenHash) {
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

    this.logger.log(`Revoked ${revokedCount} sessions for user: ${userId}`);

    // SR.4 — "sign out everywhere": when revoking ALL sessions (not
    // except-current), invalidate every Cognito refresh token. This is the
    // only cross-service revoke under stateless JWTs — per-session soft-revoke
    // (the DDB flag) is identity-scoped. Best-effort: the DDB sessions are
    // already revoked, so a Cognito hiccup must not fail the operation.
    // Skipped for except-current, which must keep the caller's own refresh token.
    //
    // SELF-ONLY: the Cognito username comes from the CALLER's JWT
    // (context.username), so it only identifies the target when the caller IS
    // the target. verifyAccess() also permits a TenantAdmin to revoke another
    // user's sessions — in that case we still soft-revoke the target's DDB rows
    // (enforced on identity by SessionRevokedGuard), but we must NOT call
    // AdminUserGlobalSignOut, or we'd sign out the admin and leave the target's
    // refresh tokens alive. Admin-driven cross-user hard revoke is R3.
    let globalSignOut = false;
    if (!exceptCurrentSession && userId === context.userId) {
      try {
        await this.cognitoClient.send(
          new AdminUserGlobalSignOutCommand({
            UserPoolId: this.userPoolId,
            Username: context.username ?? userId,
          })
        );
        globalSignOut = true;
        this.logger.log(`Cognito global sign-out for user: ${userId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Cognito global sign-out failed for ${userId}: ${msg}`);
      }
    }

    return {
      success: true,
      revokedCount,
      message: globalSignOut
        ? `Signed out everywhere — revoked ${revokedCount} tracked session(s) and all refresh tokens`
        : `Successfully revoked ${revokedCount} session(s)`,
    };
  }

  /**
   * Get login history
   * GET /users/{id}/security/login-history
   */
  async getLoginHistory(
    userId: string,
    context: RequestContext,
    limit: number = 20,
    cursor?: string,
  ): Promise<LoginHistoryResponseDto> {
    this.verifyAccess(userId, context);

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Query login history entries newest-first. The sort key is the ISO
    // timestamp (USER#{id}#LOGIN#{ts}), which sorts ascending by default — so
    // without scanIndexForward=false the `limit` would select the OLDEST rows
    // and newer logins would never surface once a user exceeds one page.
    const result = await this.dynamoDBClient.query<LoginHistoryEntry>(
      client,
      context.tenantId,
      `USER#${userId}#LOGIN#`,
      'entityType = :entityType',
      { ':entityType': 'LOGIN_HISTORY' },
      undefined,
      limit,
      this.decodeCursor(cursor, userId, context.tenantId),
      false,
    );

    // Defensive: DynamoDB already returns this page newest-first; re-assert the
    // ordering so the response is deterministic regardless of query direction.
    const sorted = result.items.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const entries: LoginHistoryEntryDto[] = sorted.map(entry => ({
      timestamp: entry.timestamp,
      status: entry.status,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      deviceType: entry.deviceType,
      browser: entry.browser,
      os: entry.os,
      location: entry.location,
      failureReason: entry.failureReason,
    }));

    // Cursor for the next (older) page = the primary key of the last returned
    // row, NOT query()'s own lastEvaluatedKey: query fetches limit+1 to detect
    // hasMore and slices the extra row off, so its lastEvaluatedKey points past
    // that dropped row and would skip one entry per page.
    const oldest = sorted[sorted.length - 1];
    const nextCursor =
      result.hasMore && oldest
        ? Buffer.from(
            JSON.stringify({ tenantId: oldest.tenantId, entityKey: oldest.entityKey }),
          ).toString('base64')
        : undefined;

    return {
      entries,
      total: entries.length,
      hasMore: result.hasMore,
      nextCursor,
    };
  }

  /**
   * Decode an opaque base64 pagination cursor back into a DynamoDB
   * ExclusiveStartKey. The cursor encodes the last-returned row's primary key
   * ({ tenantId, entityKey }). Beyond JSON-decodability we require the key to
   * belong to THIS caller's own login-history partition — a cross-tenant /
   * cross-user or malformed key must be a 400, not something we hand to
   * DynamoDB as an ExclusiveStartKey (which 500s or silently skips a page).
   */
  private decodeCursor(
    cursor: string | undefined,
    userId: string,
    tenantId: string,
  ): Record<string, unknown> | undefined {
    if (!cursor) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
    } catch {
      throw new BadRequestException('Invalid pagination cursor');
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new BadRequestException('Invalid pagination cursor');
    }
    const obj = parsed as Record<string, unknown>;
    const tid = obj.tenantId;
    const ek = obj.entityKey;

    if (
      typeof tid !== 'string' ||
      typeof ek !== 'string' ||
      tid !== tenantId ||
      !ek.startsWith(`USER#${userId}#LOGIN#`)
    ) {
      throw new BadRequestException('Invalid pagination cursor');
    }

    return { tenantId: tid, entityKey: ek };
  }

  /**
   * Record a login attempt (called by auth service)
   */
  async recordLoginAttempt(
    tenantId: string,
    userId: string,
    status: 'success' | 'failed' | 'blocked',
    details: {
      ipAddress?: string;
      userAgent?: string;
      failureReason?: string;
    }
  ): Promise<void> {
    const client = this.dynamoDBClient.getSystemClient();
    const timestamp = new Date().toISOString();

    // Parse user agent for device info
    const deviceInfo = this.parseUserAgent(details.userAgent);

    const entry: LoginHistoryEntry = {
      tenantId,
      entityKey: `USER#${userId}#LOGIN#${timestamp}`,
      entityType: 'LOGIN_HISTORY',
      userId,
      timestamp,
      status,
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      deviceType: deviceInfo.deviceType,
      browser: deviceInfo.browser,
      os: deviceInfo.os,
      failureReason: details.failureReason,
    };

    await this.dynamoDBClient.putItem(client, entry);
  }

  /**
   * Verify user has access to the target user's security settings
   */
  private verifyAccess(targetUserId: string, context: RequestContext): void {
    // Users can access their own security settings
    if (targetUserId === context.userId) {
      return;
    }

    // TenantAdmins can access any user's security settings
    if (context.globalRole === 'TenantAdmin') {
      return;
    }

    throw new ForbiddenException('Cannot access security settings for other users');
  }

  /**
   * Calculate security score based on user settings
   */
  private calculateSecurityScore(
    user: User,
    activeSessionCount: number
  ): { score: number; recommendations: string[] } {
    let score = 50; // Base score
    const recommendations: string[] = [];

    // MFA enabled: +30 points
    if (user.mfaEnabled) {
      score += 30;
    } else {
      recommendations.push('Enable two-factor authentication for enhanced security');
    }

    // No failed login attempts: +10 points
    if (!user.failedLoginAttempts || user.failedLoginAttempts === 0) {
      score += 10;
    } else if (user.failedLoginAttempts >= 3) {
      recommendations.push('Review recent login attempts - multiple failures detected');
    }

    // Not too many active sessions: +10 points (fewer than 5)
    if (activeSessionCount <= 5) {
      score += 10;
    } else {
      recommendations.push('Review and revoke unnecessary active sessions');
    }

    // Account not locked
    if (user.status === 'locked') {
      score -= 20;
      recommendations.push('Your account is currently locked');
    }

    // Ensure score is within 0-100
    score = Math.max(0, Math.min(100, score));

    return { score, recommendations };
  }

  /**
   * Generate backup codes for MFA
   */
  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
    }
    return codes;
  }

  /**
   * Hash a token for comparison
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Parse user agent string for device info
   */
  private parseUserAgent(userAgent?: string): {
    deviceType?: DeviceType;
    browser?: string;
    os?: string;
  } {
    if (!userAgent) {
      return {};
    }

    let deviceType: DeviceType | undefined;
    if (/mobile/i.test(userAgent)) {
      deviceType = 'mobile';
    } else if (/tablet|ipad/i.test(userAgent)) {
      deviceType = 'tablet';
    } else if (/windows|macintosh|linux/i.test(userAgent)) {
      deviceType = 'desktop';
    } else {
      deviceType = 'unknown';
    }

    let os: string | undefined;
    if (/windows/i.test(userAgent)) os = 'Windows';
    else if (/macintosh|mac os x/i.test(userAgent)) os = 'macOS';
    else if (/linux/i.test(userAgent)) os = 'Linux';
    else if (/android/i.test(userAgent)) os = 'Android';
    else if (/iphone|ipad/i.test(userAgent)) os = 'iOS';

    let browser: string | undefined;
    if (/chrome/i.test(userAgent) && !/edge/i.test(userAgent)) browser = 'Chrome';
    else if (/firefox/i.test(userAgent)) browser = 'Firefox';
    else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) browser = 'Safari';
    else if (/edge/i.test(userAgent)) browser = 'Edge';

    return { deviceType, browser, os };
  }
}

