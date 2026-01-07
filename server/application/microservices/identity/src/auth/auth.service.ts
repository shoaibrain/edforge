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
  AuthFlowType,
  ChallengeNameType,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { v4 as uuid } from 'uuid';
import * as crypto from 'crypto';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { 
  Session, 
  createSessionEntity, 
  SESSION_CONFIG,
  DeviceInfo,
} from '../common/entities/session.entity';
import { User, UserPreferences, createDefaultPreferences } from '../common/entities/user.entity';
import { RoleAssignment, EntityKeyBuilder, GSIKeyBuilder, RequestContext } from '../common/entities';
import {
  LoginDto,
  LoginResponseDto,
  RefreshTokenDto,
  RefreshTokenResponseDto,
  LogoutDto,
  CurrentUserResponseDto,
  AuthUserDto,
  SchoolRoleDto,
} from '../common/dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly cognitoClient: CognitoIdentityProviderClient;
  private readonly userPoolId: string;
  private readonly clientId: string;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
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
      const client = this.dynamoDBClient.getSystemClient();
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
          globalRole: userAttributes['custom:userRole'] === 'TenantAdmin' ? 'TenantAdmin' : 'StandardUser',
          status: 'active',
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

      const schoolRoles: SchoolRoleDto[] = rolesResult.items.map(role => ({
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

      return {
        accessToken: AccessToken!,
        refreshToken: RefreshToken!,
        expiresIn: ExpiresIn || 3600,
        tokenType: 'Bearer',
        user: authUser,
      };
    } catch (error: any) {
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
    const globalRole = userAttributes['custom:userRole'] || context.globalRole || 'StandardUser';
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
      // Only 'TenantAdmin' is preserved; all others default to 'StandardUser'
      const normalizedRole = globalRole === 'TenantAdmin' ? 'TenantAdmin' : 'StandardUser';
      
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
    let schoolRoles: SchoolRoleDto[] = [];
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
   * Hash a token for storage
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}

