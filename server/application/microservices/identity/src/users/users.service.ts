/**
 * Users Service - User management with Cognito + DynamoDB
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminDeleteUserCommand,
  ListUsersInGroupCommand,
  AdminAddUserToGroupCommand,
  CreateGroupCommand,
  GetGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuditLoggerService } from '@app/logger';
import { 
  User, 
  UserPreferences, 
  createDefaultPreferences,
} from '../common/entities/user.entity';
import { 
  EntityKeyBuilder, 
  GSIKeyBuilder,
  RequestContext,
  PaginatedResult,
  SchoolRole,
} from '../common/entities/base.entity';
import { RoleAssignment } from '../common/entities/role-assignment.entity';
import { Tenant } from '../common/entities/tenant.entity';
import { School } from '../common/entities/school.entity';
import type {
  CreateUserDto,
  UpdateUserDto,
  UserResponseDto,
  UpdatePreferencesDto,
  SchoolAssignmentDto,
} from '@edforge/shared-types';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly cognitoClient: CognitoIdentityProviderClient;
  private readonly userPoolId: string;
  private readonly auditLogger: AuditLoggerService;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: IdentityEventsService,
  ) {
    this.auditLogger = new AuditLoggerService('identity-service');
    this.cognitoClient = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.userPoolId = process.env.COGNITO_USER_POOL_ID || '';
  }

  /**
   * Create a new user in Cognito and DynamoDB
   */
  async createUser(
    createUserDto: CreateUserDto,
    context: RequestContext
  ): Promise<UserResponseDto> {
    const { tenantId } = context;
    const email = createUserDto.email.toLowerCase();
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Check if user already exists in DynamoDB
    const existingUser = await this.dynamoDBClient.queryGSI<User>(
      client,
      'GSI1',
      GSIKeyBuilder.emailLookup(email),
      `TENANT#${tenantId}`,
      'eq'
    );

    if (existingUser.items.length > 0) {
      throw new ConflictException('User with this email already exists');
    }

    try {
      // Look up tenant metadata for real tier
      const tenantMeta = await this.dynamoDBClient.getItem<Tenant>(
        client,
        tenantId,
        EntityKeyBuilder.tenantMetadata()
      );
      const tenantTier = tenantMeta?.tier || 'basic';

      // 1. Create user in Cognito
      const cognitoResponse = await this.cognitoClient.send(new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: email,
        DesiredDeliveryMediums: ['EMAIL'],
        TemporaryPassword: createUserDto.temporaryPassword,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'given_name', Value: createUserDto.firstName },
          { Name: 'family_name', Value: createUserDto.lastName },
          { Name: 'custom:tenantId', Value: tenantId },
          { Name: 'custom:userRole', Value: createUserDto.globalRole || 'TenantUser' },
          { Name: 'custom:tenantTier', Value: tenantTier },
        ],
      }));

      const userId = cognitoResponse.User?.Attributes?.find(a => a.Name === 'sub')?.Value || uuid();
      const now = new Date().toISOString();

      // 2. Ensure tenant group exists in Cognito
      try {
        await this.cognitoClient.send(new GetGroupCommand({
          UserPoolId: this.userPoolId,
          GroupName: tenantId,
        }));
      } catch {
        await this.cognitoClient.send(new CreateGroupCommand({
          UserPoolId: this.userPoolId,
          GroupName: tenantId,
          Description: `Tenant group: ${tenantId}`,
        }));
      }

      // 3. Add user to tenant group
      await this.cognitoClient.send(new AdminAddUserToGroupCommand({
        UserPoolId: this.userPoolId,
        Username: email,
        GroupName: tenantId,
      }));

      // 4. Create user in DynamoDB
      const user: User = {
        tenantId,
        entityKey: EntityKeyBuilder.user(userId),
        entityType: 'USER',
        userId,
        email,
        cognitoUsername: email,
        cognitoSub: userId,
        firstName: createUserDto.firstName,
        lastName: createUserDto.lastName,
        phone: createUserDto.phone,
        globalRole: createUserDto.globalRole || 'TenantUser',
        status: 'pending',
        gsi1pk: GSIKeyBuilder.emailLookup(email),
        gsi1sk: `TENANT#${tenantId}`,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      };

      await this.dynamoDBClient.putItem(client, user);

      // 5. Create default preferences
      const preferences = createDefaultPreferences(tenantId, userId, context.userId);
      await this.dynamoDBClient.putItem(client, preferences);

      this.logger.log(`User created: ${email} (${userId})`);

      // 6. Publish user created event (non-blocking)
      this.eventsService.publishUserCreated(
        tenantId,
        userId,
        email,
        user.globalRole
      ).catch(err => this.logger.error('Failed to publish UserCreated event', err));

      // 7. Audit log
      this.auditLogger.logUserCreated(
        { tenantId, userId: context.userId, userEmail: context.email },
        userId,
        email,
        user.globalRole
      );

      return this.toUserResponse(user);
    } catch (error: any) {
      if (error.name === 'UsernameExistsException') {
        throw new ConflictException('User with this email already exists in Cognito');
      }
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(`Failed to create user: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to create user');
    }
  }

  /**
   * Get user by ID
   */
  async getUser(
    userId: string,
    context: RequestContext
  ): Promise<UserResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const user = await this.dynamoDBClient.getItem<User>(
      client,
      context.tenantId,
      EntityKeyBuilder.user(userId)
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toUserResponse(user);
  }

  /**
   * List all users for tenant
   */
  async listUsers(
    context: RequestContext,
    limit: number = 50,
    lastEvaluatedKey?: string
  ): Promise<PaginatedResult<UserResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    let exclusiveStartKey: any;
    if (lastEvaluatedKey) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString());
      } catch {
        // Invalid key, ignore
      }
    }

    const result = await this.dynamoDBClient.query<User>(
      client,
      context.tenantId,
      'USER#',
      'entityType = :type',
      { ':type': 'USER' },
      undefined,
      limit,
      exclusiveStartKey
    );

    return {
      items: result.items.map(u => this.toUserResponse(u)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update user
   */
  async updateUser(
    userId: string,
    updateUserDto: UpdateUserDto,
    context: RequestContext
  ): Promise<UserResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get existing user
    const user = await this.dynamoDBClient.getItem<User>(
      client,
      context.tenantId,
      EntityKeyBuilder.user(userId)
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    if (updateUserDto.firstName) {
      updates.push('firstName = :firstName');
      values[':firstName'] = updateUserDto.firstName;
    }

    if (updateUserDto.lastName) {
      updates.push('lastName = :lastName');
      values[':lastName'] = updateUserDto.lastName;
    }

    if (updateUserDto.displayName !== undefined) {
      updates.push('displayName = :displayName');
      values[':displayName'] = updateUserDto.displayName;
    }

    if (updateUserDto.phone !== undefined) {
      updates.push('phone = :phone');
      values[':phone'] = updateUserDto.phone;
    }

    if (updateUserDto.avatarUrl !== undefined) {
      updates.push('avatarUrl = :avatarUrl');
      values[':avatarUrl'] = updateUserDto.avatarUrl;
    }

    if (updateUserDto.status) {
      updates.push('#status = :status');
      values[':status'] = updateUserDto.status;
      names['#status'] = 'status';

      // Sync with Cognito
      if (updateUserDto.status === 'active') {
        await this.cognitoClient.send(new AdminEnableUserCommand({
          UserPoolId: this.userPoolId,
          Username: user.cognitoUsername,
        }));
      } else if (updateUserDto.status === 'inactive' || updateUserDto.status === 'suspended') {
        await this.cognitoClient.send(new AdminDisableUserCommand({
          UserPoolId: this.userPoolId,
          Username: user.cognitoUsername,
        }));
      }
    }

    if (updates.length === 0) {
      return this.toUserResponse(user);
    }

    // Add audit fields
    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#version'] = 'version';

    // Update Cognito attributes
    const cognitoUpdates = [];
    if (updateUserDto.firstName) {
      cognitoUpdates.push({ Name: 'given_name', Value: updateUserDto.firstName });
    }
    if (updateUserDto.lastName) {
      cognitoUpdates.push({ Name: 'family_name', Value: updateUserDto.lastName });
    }

    if (cognitoUpdates.length > 0) {
      await this.cognitoClient.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: this.userPoolId,
        Username: user.cognitoUsername,
        UserAttributes: cognitoUpdates,
      }));
    }

    // Update DynamoDB
    const updatedUser = await this.dynamoDBClient.updateItem<User>(
      client,
      context.tenantId,
      EntityKeyBuilder.user(userId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      Object.keys(names).length > 0 ? names : undefined
    );

    this.logger.log(`User updated: ${user.email} (${userId})`);

    // Publish user updated event (non-blocking)
    const updatedFields = Object.keys(updateUserDto).filter(k => updateUserDto[k as keyof UpdateUserDto] !== undefined);
    this.eventsService.publishUserUpdated(
      context.tenantId,
      userId,
      user.email,
      updatedFields
    ).catch(err => this.logger.error('Failed to publish UserUpdated event', err));

    // Audit log
    this.auditLogger.logUserUpdated(
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email },
      userId,
      user.email,
      updatedFields
    );

    return this.toUserResponse(updatedUser);
  }

  /**
   * Delete user (soft delete - disable in Cognito)
   */
  async deleteUser(
    userId: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const user = await this.dynamoDBClient.getItem<User>(
      client,
      context.tenantId,
      EntityKeyBuilder.user(userId)
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Disable in Cognito
    await this.cognitoClient.send(new AdminDisableUserCommand({
      UserPoolId: this.userPoolId,
      Username: user.cognitoUsername,
    }));

    // Cascade: deactivate all active role assignments for this user
    try {
      const rolesResult = await this.dynamoDBClient.query<RoleAssignment>(
        client,
        context.tenantId,
        `USER#${userId}#ROLE#`,
        'isActive = :isActive',
        { ':isActive': true }
      );

      const now = new Date().toISOString();
      for (const role of rolesResult.items) {
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          EntityKeyBuilder.roleAssignment(userId, role.schoolId),
          'SET isActive = :isActive, deactivatedAt = :deactivatedAt, deactivatedBy = :deactivatedBy, deactivationReason = :reason, updatedAt = :updatedAt',
          {
            ':isActive': false,
            ':deactivatedAt': now,
            ':deactivatedBy': context.userId,
            ':reason': 'User deactivated',
            ':updatedAt': now,
          }
        );
      }

      if (rolesResult.items.length > 0) {
        this.logger.log(`Cascaded deactivation: ${rolesResult.items.length} role(s) for user ${userId}`);
      }
    } catch (err) {
      this.logger.error(`Failed to cascade role deactivation for user ${userId}`, err);
    }

    // Update status in DynamoDB
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.user(userId),
      'SET #status = :status, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':status': 'inactive',
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      },
      undefined,
      { '#status': 'status' }
    );

    this.logger.log(`User deleted (disabled): ${user.email} (${userId})`);

    // Publish user deleted event (non-blocking)
    this.eventsService.publishUserDeleted(
      context.tenantId,
      userId,
      user.email
    ).catch(err => this.logger.error('Failed to publish UserDeleted event', err));

    // Audit log
    this.auditLogger.logUserDeleted(
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email },
      userId,
      user.email
    );
  }

  /**
   * Get user preferences
   */
  async getPreferences(
    userId: string,
    context: RequestContext
  ): Promise<UserPreferences> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const preferences = await this.dynamoDBClient.getItem<UserPreferences>(
      client,
      context.tenantId,
      EntityKeyBuilder.userPreferences(userId)
    );

    if (!preferences) {
      // Create default preferences if not exists
      const newPrefs = createDefaultPreferences(context.tenantId, userId, context.userId);
      await this.dynamoDBClient.putItem(client, newPrefs);
      return newPrefs;
    }

    return preferences;
  }

  /**
   * Update user preferences
   */
  async updatePreferences(
    userId: string,
    updatePreferencesDto: UpdatePreferencesDto,
    context: RequestContext
  ): Promise<UserPreferences> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const updates: string[] = [];
    const values: Record<string, any> = {};

    if (updatePreferencesDto.theme) {
      updates.push('theme = :theme');
      values[':theme'] = updatePreferencesDto.theme;
    }

    if (updatePreferencesDto.language) {
      updates.push('language = :language');
      values[':language'] = updatePreferencesDto.language;
    }

    if (updatePreferencesDto.timezone) {
      updates.push('#timezone = :timezone');
      values[':timezone'] = updatePreferencesDto.timezone;
    }

    if (updatePreferencesDto.dateFormat) {
      updates.push('dateFormat = :dateFormat');
      values[':dateFormat'] = updatePreferencesDto.dateFormat;
    }

    if (updatePreferencesDto.timeFormat) {
      updates.push('timeFormat = :timeFormat');
      values[':timeFormat'] = updatePreferencesDto.timeFormat;
    }

    if (updatePreferencesDto.weekStartsOn) {
      updates.push('weekStartsOn = :weekStartsOn');
      values[':weekStartsOn'] = updatePreferencesDto.weekStartsOn;
    }

    if (updatePreferencesDto.notifications) {
      // Merge with existing notifications to preserve structure
      // Note: Using flat notification structure (email, push, sms, digest)
      // Security notifications are always enabled at the application level
      const notificationsUpdate = {
        ...updatePreferencesDto.notifications,
      };
      updates.push('notifications = :notifications');
      values[':notifications'] = notificationsUpdate;
    }

    if (updatePreferencesDto.defaultSchoolId !== undefined) {
      updates.push('defaultSchoolId = :defaultSchoolId');
      values[':defaultSchoolId'] = updatePreferencesDto.defaultSchoolId;
    }

    if (updates.length === 0) {
      return this.getPreferences(userId, context);
    }

    // Ensure preferences exist before updating (creates default if missing)
    await this.getPreferences(userId, context);

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = if_not_exists(#version, :zero) + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    values[':zero'] = 0;

    // Build expression attribute names (timezone is a DynamoDB reserved keyword)
    const names: Record<string, string> = { '#version': 'version' };
    if (updatePreferencesDto.timezone) {
      names['#timezone'] = 'timezone';
    }

    const updatedPrefs = await this.dynamoDBClient.updateItem<UserPreferences>(
      client,
      context.tenantId,
      EntityKeyBuilder.userPreferences(userId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names
    );

    return updatedPrefs;
  }

  /**
   * Get user's school assignments with school names
   * Returns role assignments in the format expected by frontend Shell context
   */
  async getUserAssignments(
    userId: string,
    context: RequestContext
  ): Promise<SchoolAssignmentDto[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get all active role assignments for the user
    const rolesResult = await this.dynamoDBClient.query<RoleAssignment>(
      client,
      context.tenantId,
      `USER#${userId}#ROLE#`,
      'isActive = :isActive',
      { ':isActive': true }
    );

    if (rolesResult.items.length === 0) {
      return [];
    }

    // Get school names for each assignment
    const assignments: SchoolAssignmentDto[] = [];
    
    for (const role of rolesResult.items) {
      // Look up school to get the name
      const school = await this.dynamoDBClient.getItem<School>(
        client,
        context.tenantId,
        EntityKeyBuilder.school(role.schoolId)
      );

      assignments.push({
        schoolId: role.schoolId,
        schoolName: school?.name || role.schoolId, // Fallback to ID if school not found
        role: role.role,
      });
    }

    return assignments;
  }

  /**
   * Convert User entity to response DTO
   */
  private toUserResponse(user: User): UserResponseDto {
    return {
      userId: user.userId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      globalRole: user.globalRole,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      mfaEnabled: user.mfaEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
