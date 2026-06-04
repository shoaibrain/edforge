/**
 * Users Service - User management with Cognito + DynamoDB
 */

import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
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
import { IdentityAnalyticsEventsService } from '../common/services/identity-analytics-events.service';
import { AnalyticsEventsService } from '@app/analytics-events';
import { AuditLoggerService } from '@app/logger';
import { AuthService } from '../auth/auth.service';
import { StaffService } from '../staff/staff.service';
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
  GlobalRole,
  SchoolRole,
} from '../common/entities/base.entity';
import { RoleAssignment } from '../common/entities/role-assignment.entity';
import { Tenant } from '../common/entities/tenant.entity';
import { School } from '../common/entities/school.entity';
import { RoleSyncService } from '../roles/role-sync.service';
import { StaffRole } from '../common/entities/staff.entity';
import type {
  CreateUserDto,
  CreateParentAccountDto,
  ParentAccountResponseDto,
  CreateStudentAccountDto,
  StudentAccountResponseDto,
  UpdateUserDto,
  UserResponseDto,
  UpdatePreferencesDto,
  SchoolAssignmentDto,
} from '@aibrains/shared-types';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly cognitoClient: CognitoIdentityProviderClient;
  private readonly userPoolId: string;
  private readonly auditLogger: AuditLoggerService;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: IdentityEventsService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    @Inject(forwardRef(() => StaffService))
    private readonly staffService: StaffService,
    private readonly roleSyncService: RoleSyncService,
    private readonly analytics: IdentityAnalyticsEventsService,
    private readonly analyticsRaw: AnalyticsEventsService,
  ) {
    this.auditLogger = new AuditLoggerService('identity-service');
    // Layer 4.6 bridge: wire the analytics emitter into the (locally-built)
    // AuditLogger so `AuditLogged` events land on the bus alongside the
    // existing CloudWatch audit log.
    this.auditLogger.setAnalyticsEventsService(this.analyticsRaw);
    this.cognitoClient = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION,
    });
    this.userPoolId = process.env.COGNITO_USER_POOL_ID;
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
      // Look up tenant metadata for tier
      const tenantMeta = await this.dynamoDBClient.getItem<Tenant>(
        client,
        tenantId,
        EntityKeyBuilder.tenantMetadata()
      );
      const tenantTier = tenantMeta?.tier || 'basic'; // TODO: using || with basic as default; is it the correct and safe? potential bug

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

      // 6. Auto-create linked Staff record if staff context is provided
      if (createUserDto.schoolId && createUserDto.staffRole) {
        try {
          const staffResponse = await this.staffService.createStaff(
            {
              userId,
              staffUniqueId: userId,  // Use userId as staffUniqueId for auto-created staff
              firstName: createUserDto.firstName,
              lastSurname: createUserDto.lastName,
              primarySchoolId: createUserDto.schoolId,
              role: createUserDto.staffRole,
              employmentType: 'full_time',
              hireDate: now.split('T')[0],  // YYYY-MM-DD
              email,
              departmentId: createUserDto.departmentId,
            },
            context
          );

          // Persist staffId back on User entity
          user.staffId = staffResponse.staffId;
          await this.dynamoDBClient.updateItem(
            client,
            tenantId,
            EntityKeyBuilder.user(userId),
            'SET staffId = :staffId',
            { ':staffId': staffResponse.staffId }
          );

          this.logger.log(`Staff auto-created for user ${email}: staffId=${staffResponse.staffId}`);

          // Sync ABAC role assignment so the user can see the school in Shell
          await this.roleSyncService.syncRoleAssignment(
            userId,
            createUserDto.schoolId,
            createUserDto.staffRole as StaffRole,
            context,
          );
        } catch (staffError: any) {
          // Graceful degradation: User is created even if Staff creation fails
          this.logger.error(
            `Failed to auto-create staff for user ${email}: ${staffError.message}`,
            staffError.stack
          );
        }
      }

      // 7. Publish user created event (non-blocking)
      this.eventsService.publishUserCreated(
        tenantId,
        userId,
        email,
        user.globalRole
      ).catch(err => this.logger.error('Failed to publish UserCreated event', err));

      // 8. Audit log
      this.auditLogger.logUserCreated(
        { tenantId, userId: context.userId, userEmail: context.email },
        userId,
        email,
        user.globalRole
      );

      // Layer 4.5 — analytics UserCreated (non-blocking).
      this.analytics.emitUserCreated({
        tenantId,
        userId,
        rawRole: user.globalRole,
        metadata: {
          email,
          createdBy: context.userId,
          globalRole: user.globalRole,
        },
      });

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

    if (updateUserDto.address !== undefined) {
      updates.push('address = :address');
      values[':address'] = updateUserDto.address;
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

    // Layer 4.5 — UserUpdated + (if status went inactive/suspended) UserDisabled.
    this.analytics.emitUserUpdated({
      tenantId: context.tenantId,
      userId,
      rawRole: user.globalRole,
      metadata: {
        updatedFields,
        updatedBy: context.userId,
      },
    });
    if (
      updateUserDto.status === 'inactive' ||
      updateUserDto.status === 'suspended'
    ) {
      this.analytics.emitUserDisabled({
        tenantId: context.tenantId,
        userId,
        rawRole: user.globalRole,
        metadata: { reason: updateUserDto.status, disabledBy: context.userId },
      });
    }

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

    // Layer 4.5 — UserDisabled (soft delete = Cognito disable + status flip).
    this.analytics.emitUserDisabled({
      tenantId: context.tenantId,
      userId,
      rawRole: user.globalRole,
      metadata: { reason: 'delete', disabledBy: context.userId },
    });
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

    // Normalize legacy flat notification format to nested
    const rawNotifications = preferences.notifications as any;
    if (rawNotifications && !rawNotifications.channels) {
      // Flat format detected — normalize to nested
      preferences.notifications = {
        channels: {
          email: {
            enabled: rawNotifications.email ?? true,
            digest: rawNotifications.digest ?? 'daily',
          },
          push: {
            enabled: rawNotifications.push ?? true,
          },
          sms: {
            enabled: rawNotifications.sms ?? false,
          },
        },
        categories: rawNotifications.categories ?? {
          announcements: true,
          attendance: true,
          grades: true,
          messages: true,
          calendar: true,
          billing: true,
          security: true,
        },
      };
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
      // Fetch existing preferences to merge with
      const existingPrefs = await this.getPreferences(userId, context);
      const existing = existingPrefs.notifications || {
        channels: { email: { enabled: true, digest: 'daily' }, push: { enabled: true }, sms: { enabled: false } },
        categories: { announcements: true, attendance: true, grades: true, messages: true, calendar: true, billing: true, security: true },
      };

      const raw = updatePreferencesDto.notifications as any;

      let normalizedNotifications: any;
      if (raw.channels) {
        // Already nested format — deep merge with existing
        normalizedNotifications = {
          channels: {
            email: { ...existing.channels?.email, ...raw.channels?.email },
            push: { ...existing.channels?.push, ...raw.channels?.push },
            sms: { ...existing.channels?.sms, ...raw.channels?.sms },
          },
          categories: { ...existing.categories, ...raw.categories },
        };
      } else {
        // Flat format — convert to nested, preserving existing categories
        normalizedNotifications = {
          channels: {
            email: {
              enabled: raw.email !== undefined ? raw.email : existing.channels?.email?.enabled ?? true,
              digest: raw.digest !== undefined ? raw.digest : existing.channels?.email?.digest ?? 'daily',
            },
            push: {
              enabled: raw.push !== undefined ? raw.push : existing.channels?.push?.enabled ?? true,
            },
            sms: {
              enabled: raw.sms !== undefined ? raw.sms : existing.channels?.sms?.enabled ?? false,
            },
          },
          categories: raw.categories ?? existing.categories ?? {
            announcements: true, attendance: true, grades: true,
            messages: true, calendar: true, billing: true, security: true,
          },
        };
      }

      // Ensure security category is always enabled
      if (normalizedNotifications.categories) {
        normalizedNotifications.categories.security = true;
      }

      updates.push('notifications = :notifications');
      values[':notifications'] = normalizedNotifications;
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
   * Question: Instead of returning role assignments in the client app expected format,
   * it should rather focus on the return type that is correct, aligns with rest of the 
   * api response structure for maintainabilty and scalabilit?
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
   * Search and filter users
   * Two query paths:
   * 1. Table query (no schoolId) — PK scan with FilterExpression
   * 2. GSI3 query (with schoolId) — school-user index → batchGet user details
   */
  async searchUsers(
    context: RequestContext,
    filters: {
      search?: string;
      status?: string;
      globalRole?: string;
      schoolId?: string;
      role?: string;
    },
    limit: number = 50,
    lastEvaluatedKey?: string
  ): Promise<PaginatedResult<UserResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Path 2: GSI3 query when schoolId is provided
    if (filters.schoolId) {
      const gsi3pk = GSIKeyBuilder.schoolUsers(context.tenantId, filters.schoolId);
      const skPrefix = filters.role ? `ROLE#${filters.role}#` : 'ROLE#';

      const rolesResult = await this.dynamoDBClient.queryGSI<RoleAssignment>(
        client,
        'GSI3',
        gsi3pk,
        skPrefix,
        'begins_with',
        'isActive = :isActive',
        { ':isActive': true }
      );

      // Get unique user IDs from role assignments
      const userIds = [...new Set(rolesResult.items.map(r => r.userId))];

      // Batch fetch user details
      const users: User[] = [];
      for (const uid of userIds) {
        const user = await this.dynamoDBClient.getItem<User>(
          client,
          context.tenantId,
          EntityKeyBuilder.user(uid)
        );
        if (user) users.push(user);
      }

      // Apply remaining filters (search, status, globalRole)
      let filtered = users;
      if (filters.status) {
        filtered = filtered.filter(u => u.status === filters.status);
      }
      if (filters.globalRole) {
        filtered = filtered.filter(u => u.globalRole === filters.globalRole);
      }
      if (filters.search) {
        const search = filters.search.toLowerCase();
        filtered = filtered.filter(u =>
          u.email.toLowerCase().includes(search) ||
          u.firstName?.toLowerCase().includes(search) ||
          u.lastName?.toLowerCase().includes(search) ||
          u.displayName?.toLowerCase().includes(search)
        );
      }

      return {
        items: filtered.slice(0, limit).map(u => this.toUserResponse(u)),
        hasMore: filtered.length > limit,
      };
    }

    // Path 1: Table query with FilterExpression
    const filterParts: string[] = ['entityType = :type'];
    const values: Record<string, any> = { ':type': 'USER' };
    const names: Record<string, string> = {};

    if (filters.status) {
      filterParts.push('#status = :status');
      values[':status'] = filters.status;
      names['#status'] = 'status';
    }

    if (filters.globalRole) {
      filterParts.push('globalRole = :globalRole');
      values[':globalRole'] = filters.globalRole;
    }

    if (filters.search) {
      filterParts.push(
        '(contains(email, :search) OR contains(firstName, :search) OR contains(lastName, :search))'
      );
      values[':search'] = filters.search.toLowerCase();
    }

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
      filterParts.join(' AND '),
      values,
      Object.keys(names).length > 0 ? names : undefined,
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
   * Change a user's global role (promote/demote)
   * Cognito-first: update Cognito before DynamoDB to prevent inconsistent state.
   */
  async changeGlobalRole(
    targetUserId: string,
    newRole: GlobalRole,
    context: RequestContext
  ): Promise<{ userId: string; previousRole: GlobalRole; newRole: GlobalRole; sessionsRevoked: number }> {
    // 1. Self-demote prevention
    if (context.userId === targetUserId) {
      throw new ConflictException('Cannot change your own global role');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // 2. Get target user
    const user = await this.dynamoDBClient.getItem<User>(
      client,
      context.tenantId,
      EntityKeyBuilder.user(targetUserId)
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 3. Validate: not inactive
    if (user.status === 'inactive' || user.status === 'suspended') {
      throw new BadRequestException(`Cannot change role of ${user.status} user`);
    }

    const previousRole = user.globalRole as GlobalRole;

    // 4. Validate: not already same role
    if (previousRole === newRole) {
      throw new ConflictException(`User already has role ${newRole}`);
    }

    // 5. If demoting from TenantAdmin, ensure not the last admin
    // TODO: I think TenantAdmin should never be able to demote themself. 
    // This will probably lock the user out of their own tenancy and application access
    if (previousRole === 'TenantAdmin' && newRole === 'TenantUser') {
      const adminsResult = await this.dynamoDBClient.query<User>(
        client,
        context.tenantId,
        'USER#',
        'entityType = :type AND globalRole = :role AND #status = :status',
        { ':type': 'USER', ':role': 'TenantAdmin', ':status': 'active' },
        { '#status': 'status' }
      );

      const activeAdmins = adminsResult.items.filter(u => u.status === 'active' || u.status === 'pending');
      if (activeAdmins.length <= 1) {
        throw new ConflictException('Cannot demote the last TenantAdmin');
      }
    }

    // 6. Update Cognito first (if fails, abort before DynamoDB)
    try {
      await this.cognitoClient.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: this.userPoolId,
        Username: user.cognitoUsername,
        UserAttributes: [
          { Name: 'custom:userRole', Value: newRole },
        ],
      }));
    } catch (error: any) {
      this.logger.error(`Failed to update Cognito role for ${targetUserId}: ${error.message}`);
      throw new InternalServerErrorException('Failed to update role in identity provider');
    }

    // 7. Update DynamoDB globalRole
    const now = new Date().toISOString();
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.user(targetUserId),
      'SET globalRole = :newRole, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
      {
        ':newRole': newRole,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
      },
      undefined,
      { '#version': 'version' }
    );

    // 8. Invalidate all sessions (forces re-authentication with new role in JWT)
    const { revokedCount } = await this.authService.invalidateAllUserSessions(
      context.tenantId,
      targetUserId,
      user.cognitoUsername,
      `Global role changed from ${previousRole} to ${newRole} by ${context.userId}`
    );

    // 9. Publish GlobalRoleChanged event (non-blocking)
    this.eventsService.publishGlobalRoleChanged(
      context.tenantId,
      targetUserId,
      user.email,
      previousRole,
      newRole,
      context.userId
    ).catch(err => this.logger.error('Failed to publish GlobalRoleChanged event', err));

    // 10. Audit log
    this.auditLogger.logUserUpdated(
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email },
      targetUserId,
      user.email,
      ['globalRole']
    );

    this.logger.log(
      `Global role changed: ${user.email} ${previousRole} → ${newRole} by ${context.userId} (${revokedCount} sessions revoked)`
    );

    return {
      userId: targetUserId,
      previousRole,
      newRole,
      sessionsRevoked: revokedCount,
    };
  }

  /**
   * Create a parent account with 'Parent' school role.
   *
   * Flow:
   * 1. Create user via standard createUser (globalRole=TenantUser)
   * 2. Assign 'Parent' SchoolRole at the specified school
   * 3. Publish ParentAccountCreated event (Academics service links guardian.userId)
   */
  async createParentAccount(
    dto: CreateParentAccountDto,
    context: RequestContext,
  ): Promise<ParentAccountResponseDto> {
    // 1. Create the user account (or look up existing)
    let userResponse: UserResponseDto;

    try {
      userResponse = await this.createUser(
        {
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          temporaryPassword: dto.temporaryPassword,
          globalRole: 'TenantUser',
        },
        context,
      );
    } catch (error: any) {
      if (error instanceof ConflictException) {
        // User already exists — look up and assign Parent role
        this.logger.log(
          `Parent account already exists for ${dto.email} — assigning Parent role`,
        );
        const existingUser = await this.findUserByEmail(dto.email, context);
        if (!existingUser) {
          throw new ConflictException(
            `User ${dto.email} exists but could not be looked up`,
          );
        }
        userResponse = this.toUserResponse(existingUser);
      } else {
        throw error;
      }
    }

    // 2. Assign 'Parent' role at the school (idempotent)
    try {
      await this.roleSyncService.assignSchoolRole(
        userResponse.userId,
        dto.schoolId,
        'Parent',
        context,
      );
      this.logger.log(`Parent role assigned: ${userResponse.email} at school ${dto.schoolId}`);
    } catch (error: any) {
      this.logger.error(
        `Failed to assign Parent role for ${userResponse.email}: ${error.message}`,
        error.stack,
      );
    }

    // 3. Publish event so Academics service can link guardian.userId
    this.eventsService.publishUserCreated(
      context.tenantId,
      userResponse.userId,
      userResponse.email,
      'TenantUser',
    ).catch(err => this.logger.error('Failed to publish ParentAccountCreated event', err));

    return {
      ...userResponse,
      schoolId: dto.schoolId,
      studentId: dto.studentId,
      schoolRole: 'Parent' as const,
    };
  }

  /**
   * Create a student portal account with 'Student' school role.
   *
   * If the user already exists (409), looks up the existing user and
   * assigns the Student role anyway — this handles the case where a
   * Cognito account was previously created (e.g., as a teacher or
   * from a different enrollment) but never got the Student role.
   */
  async createStudentAccount(
    dto: CreateStudentAccountDto,
    context: RequestContext,
  ): Promise<StudentAccountResponseDto> {
    let userResponse: UserResponseDto;

    try {
      userResponse = await this.createUser(
        {
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          globalRole: 'TenantUser',
          temporaryPassword: dto.temporaryPassword,
        },
        context,
      );
    } catch (error: any) {
      if (error instanceof ConflictException) {
        // User already exists — look up and assign Student role
        this.logger.log(
          `Student account already exists for ${dto.email} — assigning Student role`,
        );
        const existingUser = await this.findUserByEmail(dto.email, context);
        if (!existingUser) {
          throw new ConflictException(
            `User ${dto.email} exists but could not be looked up`,
          );
        }
        userResponse = this.toUserResponse(existingUser);
      } else {
        throw error;
      }
    }

    // Assign Student role (idempotent — assignSchoolRole handles duplicates)
    try {
      await this.roleSyncService.assignSchoolRole(
        userResponse.userId,
        dto.schoolId,
        'Student',
        context,
      );
      this.logger.log(`Student role assigned: ${userResponse.email} at school ${dto.schoolId}`);
    } catch (error: any) {
      this.logger.error(
        `Failed to assign Student role for ${userResponse.email}: ${error.message}`,
        error.stack,
      );
    }

    this.eventsService.publishUserCreated(
      context.tenantId,
      userResponse.userId,
      userResponse.email,
      'TenantUser',
    ).catch(err => this.logger.error('Failed to publish StudentAccountCreated event', err));

    return {
      ...userResponse,
      schoolId: dto.schoolId,
      studentId: dto.studentId,
      schoolRole: 'Student' as const,
    };
  }

  /**
   * Look up an existing user by email within the current tenant.
   */
  private async findUserByEmail(
    email: string,
    context: RequestContext,
  ): Promise<User | null> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.queryGSI<User>(
      client,
      'GSI1',
      GSIKeyBuilder.emailLookup(email.toLowerCase()),
      `TENANT#${context.tenantId}`,
      'eq',
    );
    return result.items[0] ?? null;
  }

  /**
   * Resolve a userId to its display name. Used by cross-service receipt
   * rendering (finance) to replace recorder UUIDs with human-readable
   * names on customer-facing documents. Returns null when the user no
   * longer exists (e.g. deactivated staff) so the caller can degrade
   * gracefully instead of 5xx-ing the receipt.
   *
   * Precedence: explicit `displayName` → "firstName lastName" → null.
   *
   * Email is intentionally NOT a fallback here — the underlying endpoint
   * `GET /users/:id/display-name` is permissive intra-tenant (parents
   * resolving the recorder's name on a receipt), and email is more
   * sensitive PII than a first/last name. Email is only exposed on the
   * self-or-admin `GET /users/:id` route. Callers should treat a null
   * return as "no human-readable identifier available" and degrade
   * (finance falls back to the student name on the receipt).
   */
  async getUserDisplayName(
    userId: string,
    context: RequestContext,
  ): Promise<string | null> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const user = await this.dynamoDBClient.getItem<User>(
      client,
      context.tenantId,
      EntityKeyBuilder.user(userId),
    );

    if (!user) return null;

    if (user.displayName && user.displayName.trim().length > 0) {
      return user.displayName.trim();
    }
    const composed = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    if (composed.length > 0) return composed;
    return null;
  }

  /**
   * Convert User entity to response DTO
   */
  private toUserResponse(user: User): UserResponseDto {
    return {
      userId: user.userId,
      staffId: user.staffId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      address: user.address,
      globalRole: user.globalRole,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      mfaEnabled: user.mfaEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
