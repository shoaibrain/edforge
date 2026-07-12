/**
 * Auth Service - Handles authentication flows
 * 
 * Integrates Cognito for authentication with DynamoDB for session management.
 */

import { 
  Injectable, 
  Logger, 
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminUserGlobalSignOutCommand,
  AuthFlowType,
  ChallengeNameType,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { v4 as uuid } from 'uuid';
import * as crypto from 'crypto';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityAnalyticsEventsService } from '../common/services/identity-analytics-events.service';
import { SecurityService } from '../security/security.service';
import { 
  Session, 
  createSessionEntity, 
  SESSION_CONFIG,
  DeviceInfo,
} from '../common/entities/session.entity';
import { User, UserPreferences, createDefaultPreferences } from '../common/entities/user.entity';
import { RoleAssignment, EntityKeyBuilder, GSIKeyBuilder, RequestContext } from '../common/entities';
import type {
  LoginDto,
  LoginResponseDto,
  RefreshTokenDto,
  RefreshTokenResponseDto,
  LogoutDto,
  CurrentUserResponseDto,
  AuthUserDto,
  AuthSchoolRoleDto,
} from '@aibrains/shared-types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly cognitoClient: CognitoIdentityProviderClient;
  private readonly userPoolId: string;
  private readonly clientId: string;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly analytics: IdentityAnalyticsEventsService,
    private readonly securityService: SecurityService,
  ) {
    this.cognitoClient = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.userPoolId = process.env.COGNITO_USER_POOL_ID || '';
    this.clientId = process.env.COGNITO_CLIENT_ID || '';
  }

  /**
   * Login with email and password
   */
  async login(
    loginDto: LoginDto,
    deviceInfo?: DeviceInfo,
    ipAddress?: string,
    userAgent?: string
  ): Promise<LoginResponseDto> {
    try {
      // 1. Authenticate with Cognito
      const authResult = await this.cognitoClient.send(new AdminInitiateAuthCommand({
        UserPoolId: this.userPoolId,
        ClientId: this.clientId,
        AuthFlow: AuthFlowType.ADMIN_USER_PASSWORD_AUTH,
        AuthParameters: {
          USERNAME: loginDto.email.toLowerCase(),
          PASSWORD: loginDto.password,
        },
      }));

      if (authResult.ChallengeName) {
        // Handle NEW_PASSWORD_REQUIRED or other challenges
        throw new BadRequestException({
          code: 'CHALLENGE_REQUIRED',
          challenge: authResult.ChallengeName,
          session: authResult.Session,
        });
      }

      if (!authResult.AuthenticationResult) {
        throw new UnauthorizedException('Authentication failed');
      }

      const { AccessToken, RefreshToken, ExpiresIn, IdToken } = authResult.AuthenticationResult;

      // 2. Get user from Cognito to extract tenant info
      const cognitoUser = await this.cognitoClient.send(new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: loginDto.email.toLowerCase(),
      }));

      const userAttributes = cognitoUser.UserAttributes?.reduce((acc, attr) => {
        acc[attr.Name || ''] = attr.Value || '';
        return acc;
      }, {} as Record<string, string>) || {};

      const tenantId = userAttributes['custom:tenantId'];
      const userId = userAttributes['sub'] || cognitoUser.Username || '';

      if (!tenantId) {
        throw new UnauthorizedException('User not associated with a tenant');
      }

      // 3. Get or create user in DynamoDB
      const client = this.dynamoDBClient.getSystemClient(); // TODO: Why are we using getSystemClient instead of tenant scoped client?
      let user = await this.dynamoDBClient.getItem<User>(
        client,
        tenantId,
        EntityKeyBuilder.user(userId)
      );

      if (!user) {
        // Create user record in DynamoDB (first login)
        user = {
          tenantId,
          entityKey: EntityKeyBuilder.user(userId),
          entityType: 'USER',
          userId,
          email: loginDto.email.toLowerCase(),
          cognitoUsername: cognitoUser.Username || '',
          cognitoSub: userId,
          firstName: userAttributes['given_name'] || '',
          lastName: userAttributes['family_name'] || '',
          globalRole: userAttributes['custom:userRole'] === 'TenantAdmin' ? 'TenantAdmin' : 'TenantUser',
          status: 'active', // TODO: this is not safe. Status should be in sync with cognito
          lastLoginAt: new Date().toISOString(),
          lastLoginIp: ipAddress,
          gsi1pk: GSIKeyBuilder.emailLookup(loginDto.email),
          gsi1sk: `TENANT#${tenantId}`,
          createdAt: new Date().toISOString(),
          createdBy: userId,
          updatedAt: new Date().toISOString(),
          updatedBy: userId,
          version: 1,
        };
        await this.dynamoDBClient.putItem(client, user);

        // Create default preferences
        const preferences = createDefaultPreferences(tenantId, userId, userId);
        await this.dynamoDBClient.putItem(client, preferences);
      } else {
        // Update last login
        await this.dynamoDBClient.updateItem(
          client,
          tenantId,
          EntityKeyBuilder.user(userId),
          'SET lastLoginAt = :lastLoginAt, lastLoginIp = :lastLoginIp, updatedAt = :updatedAt',
          {
            ':lastLoginAt': new Date().toISOString(),
            ':lastLoginIp': ipAddress || null,
            ':updatedAt': new Date().toISOString(),
          }
        );
      }

      // 4. Create session in DynamoDB
      const sessionId = uuid();
      const accessTokenHash = this.hashToken(AccessToken!);
      const refreshTokenHash = this.hashToken(RefreshToken!);
      const accessTokenExpiry = new Date(Date.now() + (ExpiresIn || 3600) * 1000);
      const refreshTokenExpiry = new Date(Date.now() + SESSION_CONFIG.REFRESH_TOKEN_EXPIRY_SECONDS * 1000);

      const session = createSessionEntity(
        tenantId,
        sessionId,
        userId,
        accessTokenHash,
        refreshTokenHash,
        accessTokenExpiry,
        refreshTokenExpiry,
        userId,
        { deviceInfo, ipAddress, userAgent }
      );

      await this.dynamoDBClient.putItem(client, session);

      // 5. Get user roles
      const rolesResult = await this.dynamoDBClient.query<RoleAssignment>(
        client,
        tenantId,
        `USER#${userId}#ROLE#`,
        'isActive = :isActive',
        { ':isActive': true }
      );

      const schoolRoles: AuthSchoolRoleDto[] = rolesResult.items.map(role => ({
        schoolId: role.schoolId,
        role: role.role,
        departmentId: role.departmentId,
      }));

      // 6. Build response
      const authUser: AuthUserDto = {
        userId: user.userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        globalRole: user.globalRole,
        tenantId,
        roles: schoolRoles,
      };

      this.logger.log(`User logged in: ${user.email} (${tenantId})`);

      // Layer 4.2 — emit LoginSuccess + SessionCreated (non-blocking).
      this.analytics.emitLoginSuccess({
        tenantId,
        userId,
        rawRole: user.globalRole,
        metadata: { email: user.email },
      });
      this.analytics.emitSessionCreated({
        tenantId,
        userId,
        rawRole: user.globalRole,
        metadata: {
          sessionId,
          ipAddress: ipAddress ?? null,
          deviceType: deviceInfo?.deviceType ?? null,
        },
      });

      // Capture the successful login into the user-facing security
      // login-history. Distinct from the fire-and-forget analytics emit
      // above (which feeds ops dashboards): this is the per-user history the
      // Settings → Security surface reads, and it also records failures below.
      const claims = this.accessTokenClaims(AccessToken);
      await this.recordLoginHistory(
        tenantId,
        userId,
        'success',
        { ipAddress, userAgent },
        {
          originJti: typeof claims?.origin_jti === 'string' ? claims.origin_jti : undefined,
          anchorMs: typeof claims?.auth_time === 'number' ? claims.auth_time * 1000 : undefined,
        },
      );

      return {
        accessToken: AccessToken!,
        refreshToken: RefreshToken!,
        expiresIn: ExpiresIn || 3600,
        tokenType: 'Bearer',
        user: authUser,
      };
    } catch (error: any) {
      // Layer 4.3 — emit LoginFailure for every auth attempt that didn't
      // produce tokens. tenantId may be unresolvable (user doesn't exist or
      // the Cognito lookup was skipped on first-factor failure); falling
      // back to 'unknown' is acceptable per the Layer 4 plan.
      this.analytics.emitLoginFailure({
        tenantId: 'unknown',
        userId: 'unknown',
        metadata: {
          email: loginDto?.email ?? null,
          errorName: error?.name ?? null,
          errorMessage: error?.message ?? null,
        },
      });

      // Attribute a failed attempt to the real user's login-history when the
      // account exists (wrong password → NotAuthorizedException). Skipped for
      // unknown emails: nothing to attribute, and we avoid polluting history
      // with credential-stuffing probes.
      if (error?.name === 'NotAuthorizedException') {
        await this.attributeFailedLogin(
          loginDto?.email,
          ipAddress,
          userAgent,
          error.name,
        );
      }

      if (error.name === 'NotAuthorizedException') {
        throw new UnauthorizedException('Invalid email or password');
      }
      if (error.name === 'UserNotFoundException') {
        throw new UnauthorizedException('Invalid email or password');
      }
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(`Login failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Authentication failed');
    }
  }

  /**
   * Best-effort write of a login attempt into the user-facing security
   * login-history. Never throws — a history-write failure must not turn a
   * successful login into an error, nor mask the real auth failure.
   */
  /** Base64url-decode a Cognito access token's payload; undefined if malformed. */
  private accessTokenClaims(token?: string): Record<string, unknown> | undefined {
    if (!token) return undefined;
    try {
      return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf-8'));
    } catch {
      return undefined;
    }
  }

  private async recordLoginHistory(
    tenantId: string,
    userId: string,
    status: 'success' | 'failed',
    details: { ipAddress?: string; userAgent?: string; failureReason?: string },
    auth?: { originJti?: string; anchorMs?: number },
  ): Promise<void> {
    try {
      if (status === 'success') {
        // Enrich the Cognito PostAuth trigger row for this login instead of
        // writing a second row — otherwise every /auth/login shows twice in
        // history (trigger row + this one). Passing the access token's origin_jti
        // + auth_time keys the idempotency marker (so a repeat is a no-op) and
        // anchors the trigger match to the actual authentication time; with the
        // origin_jti, recordLoginEvent can also write a keyed fallback if the
        // trigger row is absent.
        await this.securityService.recordLoginEvent(tenantId, userId, {
          ipAddress: details.ipAddress,
          userAgent: details.userAgent,
          originJti: auth?.originJti,
          anchorMs: auth?.anchorMs,
          source: 'auth-login',
        });
      } else {
        await this.securityService.recordLoginAttempt(
          tenantId,
          userId,
          status,
          details,
          'auth-login',
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to record ${status} login history for ${userId}: ${message}`,
      );
    }
  }

  /**
   * Resolve an existing account by email via Cognito and record the failed
   * attempt against it. Best-effort: if the account can't be resolved (email
   * doesn't exist), nothing is recorded — we only surface failures on real
   * accounts' history, never for probe emails.
   */
  private async attributeFailedLogin(
    email: string | undefined,
    ipAddress: string | undefined,
    userAgent: string | undefined,
    failureReason: string,
  ): Promise<void> {
    if (!email) return;
    try {
      const cognitoUser = await this.cognitoClient.send(
        new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: email.toLowerCase(),
        }),
      );
      const attrs =
        cognitoUser.UserAttributes?.reduce((acc, attr) => {
          acc[attr.Name || ''] = attr.Value || '';
          return acc;
        }, {} as Record<string, string>) || {};
      const tenantId = attrs['custom:tenantId'];
      const userId = attrs['sub'] || cognitoUser.Username || '';
      if (tenantId && userId) {
        await this.recordLoginHistory(tenantId, userId, 'failed', {
          ipAddress,
          userAgent,
          failureReason,
        });
      }
    } catch {
      // Account not resolvable — skip attribution (no per-user history to write).
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(
    refreshTokenDto: RefreshTokenDto,
    tenantId: string,
    userId: string
  ): Promise<RefreshTokenResponseDto> {
    try {
      // Verify refresh token exists in our session store
      const client = this.dynamoDBClient.getSystemClient();
      const refreshTokenHash = this.hashToken(refreshTokenDto.refreshToken);

      // Get session by user
      const sessionsResult = await this.dynamoDBClient.query<Session>(
        client,
        tenantId,
        `SESSION#`,
        'userId = :userId AND refreshTokenHash = :refreshTokenHash AND #status = :status',
        {
          ':userId': userId,
          ':refreshTokenHash': refreshTokenHash,
          ':status': 'active',
        },
        { '#status': 'status' }
      );

      if (sessionsResult.items.length === 0) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Refresh with Cognito
      const authResult = await this.cognitoClient.send(new AdminInitiateAuthCommand({
        UserPoolId: this.userPoolId,
        ClientId: this.clientId,
        AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
        AuthParameters: {
          REFRESH_TOKEN: refreshTokenDto.refreshToken,
        },
      }));

      if (!authResult.AuthenticationResult?.AccessToken) {
        throw new UnauthorizedException('Token refresh failed');
      }

      const { AccessToken, ExpiresIn } = authResult.AuthenticationResult;

      // Update session with new access token hash
      const session = sessionsResult.items[0];
      const newAccessTokenHash = this.hashToken(AccessToken);
      const newAccessTokenExpiry = new Date(Date.now() + (ExpiresIn || 3600) * 1000);

      await this.dynamoDBClient.updateItem(
        client,
        tenantId,
        session.entityKey,
        'SET accessTokenHash = :accessTokenHash, accessTokenExpiresAt = :expiresAt, gsi2pk = :gsi2pk, updatedAt = :updatedAt',
        {
          ':accessTokenHash': newAccessTokenHash,
          ':expiresAt': newAccessTokenExpiry.toISOString(),
          ':gsi2pk': `TOKEN#${newAccessTokenHash}`,
          ':updatedAt': new Date().toISOString(),
        }
      );

      // Layer 4.4 — SessionRefreshed (non-blocking).
      this.analytics.emitSessionRefreshed({
        tenantId,
        userId,
        metadata: { sessionId: session.sessionId },
      });

      return {
        accessToken: AccessToken,
        expiresIn: ExpiresIn || 3600,
        tokenType: 'Bearer',
      };
    } catch (error: any) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(`Token refresh failed: ${error.message}`, error.stack);
      throw new UnauthorizedException('Token refresh failed');
    }
  }

  /**
   * Logout - invalidate session(s)
   */
  async logout(
    logoutDto: LogoutDto,
    context: RequestContext
  ): Promise<void> {
    const client = this.dynamoDBClient.getSystemClient();

    if (logoutDto.allSessions) {
      // Revoke all sessions for user
      const sessionsResult = await this.dynamoDBClient.query<Session>(
        client,
        context.tenantId,
        `SESSION#`,
        'userId = :userId AND #status = :status',
        { ':userId': context.userId, ':status': 'active' },
        { '#status': 'status' }
      );

      for (const session of sessionsResult.items) {
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          session.entityKey,
          'SET #status = :status, updatedAt = :updatedAt',
          { ':status': 'revoked', ':updatedAt': new Date().toISOString() },
          undefined,
          { '#status': 'status' }
        );
      }

      this.logger.log(`All sessions revoked for user: ${context.userId}`);

      // Layer 4.4 — SessionRevoked (revokedAll=true) then Logout.
      this.analytics.emitSessionRevoked({
        tenantId: context.tenantId,
        userId: context.userId,
        rawRole: context.globalRole,
        metadata: {
          revokedAll: true,
          revokedCount: sessionsResult.items.length,
        },
      });
      this.analytics.emitLogout({
        tenantId: context.tenantId,
        userId: context.userId,
        rawRole: context.globalRole,
        metadata: { allSessions: true },
      });
    } else if (logoutDto.sessionId) {
      // Revoke specific session
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        EntityKeyBuilder.session(logoutDto.sessionId),
        'SET #status = :status, updatedAt = :updatedAt',
        { ':status': 'revoked', ':updatedAt': new Date().toISOString() },
        'userId = :userId',
        { '#status': 'status' }
      );

      this.logger.log(`Session revoked: ${logoutDto.sessionId}`);

      // Layer 4.4 — SessionRevoked (single) + Logout.
      this.analytics.emitSessionRevoked({
        tenantId: context.tenantId,
        userId: context.userId,
        rawRole: context.globalRole,
        metadata: { sessionId: logoutDto.sessionId, revokedAll: false },
      });
      this.analytics.emitLogout({
        tenantId: context.tenantId,
        userId: context.userId,
        rawRole: context.globalRole,
        metadata: { sessionId: logoutDto.sessionId, allSessions: false },
      });
    }
  }

  /**
   * Get current user info
   * 
   * Cognito-First Pattern (sbt-aws aligned):
   * 1. Get user from Cognito (source of truth - always exists after provisioning)
   * 2. Optionally enrich with DynamoDB extensions (school roles, preferences)
   * 3. Never fail if DynamoDB record doesn't exist
   */
  async getCurrentUser(context: RequestContext): Promise<CurrentUserResponseDto> {
    // 1. ALWAYS get user from Cognito (source of truth)
    // This works for any user created via provisioning or Cognito Hosted UI
    // Try multiple username formats in order of preference:
    // 1. cognito:username (most reliable - matches Cognito's internal username)
    // 2. sub (user ID - Cognito's unique identifier)
    // 3. email (if email is used as username)
    let cognitoUser;
    let lastError: any;
    
    // First try: Use cognito:username (most reliable)
    if (context.username) {
      try {
        cognitoUser = await this.cognitoClient.send(new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: context.username,
        }));
      } catch (error: any) {
        lastError = error;
        this.logger.debug(`Failed to get user with username=${context.username}, trying alternatives...`);
      }
    }
    
    // Second try: Use sub (user ID) if username didn't work
    if (!cognitoUser) {
      try {
        cognitoUser = await this.cognitoClient.send(new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: context.userId,
        }));
      } catch (error: any) {
        lastError = error;
        this.logger.debug(`Failed to get user with userId=${context.userId}, trying email...`);
      }
    }
    
    // Third try: Use email (if email is used as username)
    if (!cognitoUser) {
      try {
        cognitoUser = await this.cognitoClient.send(new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: context.email,
        }));
      } catch (error: any) {
        lastError = error;
        this.logger.error(`Failed to get user from Cognito with username=${context.username}, userId=${context.userId}, or email=${context.email}: ${error.message}`);
        throw new UnauthorizedException('User not found in identity provider');
      }
    }

    const userAttributes = cognitoUser.UserAttributes?.reduce((acc, attr) => {
      acc[attr.Name || ''] = attr.Value || '';
      return acc;
    }, {} as Record<string, string>) || {};

    // Extract user info from Cognito (always available)
    const userId = userAttributes['sub'] || context.userId;
    const email = userAttributes['email'] || context.email;
    const firstName = userAttributes['given_name'] || '';
    const lastName = userAttributes['family_name'] || '';
    const globalRole = userAttributes['custom:userRole'] || context.globalRole || 'TenantUser';
    const userStatus = cognitoUser.UserStatus || 'CONFIRMED';
    const enabled = cognitoUser.Enabled !== false;

    // 2. Self-healing: Create user in DynamoDB if not exists
    const client = this.dynamoDBClient.getSystemClient();
    let user = await this.dynamoDBClient.getItem<User>(
      client,
      context.tenantId,
      EntityKeyBuilder.user(userId)
    );

    if (!user) {
      // Self-healing: Create user from JWT claims (same pattern as login())
      this.logger.log(`Auto-creating user from JWT: ${email} (${userId})`);
      
      const now = new Date().toISOString();
      // Use cognitoUsername from context if available, otherwise fall back to email
      // This matches the pattern in login() which uses cognitoUser.Username
      const cognitoUsername = context.username || cognitoUser.Username || email;
      
      // Normalize globalRole to match login() behavior (line 135)
      // Only 'TenantAdmin' is preserved; all others default to 'TenantUser'
      const normalizedRole = globalRole === 'TenantAdmin' ? 'TenantAdmin' : 'TenantUser';
      
      user = {
        tenantId: context.tenantId,
        entityKey: EntityKeyBuilder.user(userId),
        entityType: 'USER',
        userId,
        email,
        cognitoUsername,
        cognitoSub: userId,
        firstName,
        lastName,
        globalRole: normalizedRole,
        status: 'active',
        gsi1pk: GSIKeyBuilder.emailLookup(email),
        gsi1sk: `TENANT#${context.tenantId}`,
        createdAt: now,
        createdBy: userId,
        updatedAt: now,
        updatedBy: userId,
        version: 1,
      };
      await this.dynamoDBClient.putItem(client, user);

      // Create default preferences
      const defaultPreferences = createDefaultPreferences(context.tenantId, userId, userId);
      await this.dynamoDBClient.putItem(client, defaultPreferences);
      
      this.logger.log(`User auto-created in DynamoDB: ${email} (tenant: ${context.tenantId})`);
    }

    // 3. Get DynamoDB extensions
    let schoolRoles: AuthSchoolRoleDto[] = [];
    let preferences: UserPreferences | null = null;
    let currentSession: Session | null = null;

    try {
      // Get school role assignments (EdForge EMIS extension)
      const rolesResult = await this.dynamoDBClient.query<RoleAssignment>(
        client,
        context.tenantId,
        `USER#${userId}#ROLE#`,
        'isActive = :isActive',
        { ':isActive': true }
      );
      schoolRoles = rolesResult.items.map(role => ({
        schoolId: role.schoolId,
        role: role.role,
        departmentId: role.departmentId,
      }));
    } catch (error: any) {
      // No school roles - that's OK for fresh users
      this.logger.debug(`No school roles found for user ${userId}: ${error.message}`);
    }

    try {
      // Get user preferences (EdForge extension)
      preferences = await this.dynamoDBClient.getItem<UserPreferences>(
        client,
        context.tenantId,
        EntityKeyBuilder.userPreferences(userId)
      );
    } catch (error: any) {
      // No preferences - that's OK, will use defaults
      this.logger.debug(`No preferences found for user ${userId}: ${error.message}`);
    }

    try {
      // Get current session (optional tracking)
      const accessTokenHash = this.hashToken(context.jwtToken);
      const sessionResult = await this.dynamoDBClient.queryGSI<Session>(
        client,
        'GSI2',
        `TOKEN#${accessTokenHash}`,
        undefined,
        'eq',
        '#status = :status',
        { ':status': 'active' },
        { '#status': 'status' },
        1
      );
      currentSession = sessionResult.items[0] || null;
    } catch (error: any) {
      // No session tracking - that's OK for Hosted UI logins
      this.logger.debug(`No session found for user ${userId}: ${error.message}`);
    }

    // 3. Return combined response - NEVER fails if DynamoDB record missing
    this.logger.log(`User profile retrieved: ${email} (Cognito: ${userStatus}, Roles: ${schoolRoles.length})`);

    return {
      user: {
        userId,
        email,
        firstName,
        lastName,
        globalRole: globalRole as any,
        tenantId: context.tenantId,
        roles: schoolRoles,
        preferences: preferences ? {
          theme: preferences.theme,
          language: preferences.language,
          timezone: preferences.timezone,
          defaultSchoolId: preferences.defaultSchoolId,
        } : undefined,
      },
      session: {
        sessionId: currentSession?.sessionId || '',
        createdAt: currentSession?.createdAt || new Date().toISOString(),
        expiresAt: currentSession?.accessTokenExpiresAt || '',
        deviceInfo: currentSession?.deviceInfo,
        ipAddress: currentSession?.ipAddress,
      },
    };
  }

  /**
   * Invalidate all sessions for a user.
   * 1. Revoke all active DynamoDB sessions
   * 2. Call Cognito AdminUserGlobalSignOut to invalidate refresh tokens
   *
   * Used when globalRole changes (promote/demote) or user is deactivated.
   * The JWT access token remains valid until expiry (1hr) — acceptable for MVP.
   */
  async invalidateAllUserSessions(
    tenantId: string,
    userId: string,
    cognitoUsername: string,
    reason: string
  ): Promise<{ revokedCount: number }> {
    const client = this.dynamoDBClient.getSystemClient();

    // 1. Find and revoke all active DynamoDB sessions
    const sessionsResult = await this.dynamoDBClient.query<Session>(
      client,
      tenantId,
      'SESSION#',
      'userId = :userId AND #status = :status',
      { ':userId': userId, ':status': 'active' },
      { '#status': 'status' }
    );

    const now = new Date().toISOString();
    let revokedCount = 0;

    for (const session of sessionsResult.items) {
      await this.dynamoDBClient.updateItem(
        client,
        tenantId,
        session.entityKey,
        'SET #status = :newStatus, updatedAt = :updatedAt, revokedReason = :reason',
        {
          ':newStatus': 'revoked',
          ':updatedAt': now,
          ':reason': reason,
        },
        undefined,
        { '#status': 'status' }
      );
      revokedCount++;
    }

    // 2. Cognito global sign-out (invalidates all refresh tokens)
    try {
      await this.cognitoClient.send(new AdminUserGlobalSignOutCommand({
        UserPoolId: this.userPoolId,
        Username: cognitoUsername,
      }));
      this.logger.log(`Cognito global sign-out for user ${userId} (${reason})`);
    } catch (error: any) {
      // Log but don't fail — DynamoDB sessions are already revoked
      this.logger.error(`Cognito global sign-out failed for ${userId}: ${error.message}`);
    }

    this.logger.log(`Revoked ${revokedCount} session(s) for user ${userId}: ${reason}`);
    return { revokedCount };
  }

  /**
   * Hash a token for storage
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}

