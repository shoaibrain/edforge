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
} from '@aws-sdk/client-cognito-identity-provider';
import * as crypto from 'crypto';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { Session } from '../common/entities/session.entity';
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
      .map(s => ({
        sessionId: s.sessionId,
        createdAt: s.createdAt,
        lastActivityAt: s.updatedAt,
        expiresAt: s.refreshTokenExpiresAt,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        deviceType: s.deviceInfo?.deviceType,
        browser: s.deviceInfo?.browser,
        os: s.deviceInfo?.os,
        location: undefined, // Would require IP geolocation
        isCurrent: s.accessTokenHash === currentTokenHash,
      }));

    // Sort by creation date, most recent first
    sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const currentSession = sessions.find(s => s.isCurrent);

    return {
      sessions,
      total: sessions.length,
      currentSessionId: currentSession?.sessionId,
    };
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

    return {
      success: true,
      revokedCount,
      message: `Successfully revoked ${revokedCount} session(s)`,
    };
  }

  /**
   * Get login history
   * GET /users/{id}/security/login-history
   */
  async getLoginHistory(
    userId: string,
    context: RequestContext,
    limit: number = 20
  ): Promise<LoginHistoryResponseDto> {
    this.verifyAccess(userId, context);

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Query login history entries
    const result = await this.dynamoDBClient.query<LoginHistoryEntry>(
      client,
      context.tenantId,
      `USER#${userId}#LOGIN#`,
      'entityType = :entityType',
      { ':entityType': 'LOGIN_HISTORY' },
      undefined,
      limit
    );

    // Sort by timestamp descending (most recent first)
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

    return {
      entries,
      total: entries.length,
      hasMore: result.hasMore,
    };
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

