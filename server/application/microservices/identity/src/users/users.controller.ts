/**
 * Users Controller - User management endpoints
 * 
 * @module UsersController
 * @description Provides RESTful endpoints for user management operations
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { RolesService } from '../roles/roles.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  CreateUserDtoZ,
  CreateParentAccountDtoZ,
  CreateStudentAccountDtoZ,
  UpdateUserDtoZ,
  UpdatePreferencesDtoZ,
  ChangeGlobalRoleDtoZ,
} from '../common/dto/zod-dtos';
import type {
  UserResponseDto,
  UserListResponseDto,
  UserAssignmentsResponseDto,
  CurrentUserProfileDto,
  ParentAccountResponseDto,
  StudentAccountResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';
import { RequireGlobalRole } from '../common/decorators/require-global-role.decorator';
import { GlobalRoleGuard } from '../common/guards/global-role.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly rolesService: RolesService,
  ) {}

  /**
   * Create a new user
   * POST /users
   */
  @Post()
  @RequireGlobalRole('TenantAdmin')
  @UseGuards(GlobalRoleGuard)
  async createUser(
    @Body() createUserDto: CreateUserDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<UserResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.usersService.createUser(createUserDto, context);
  }

  /**
   * Create a parent portal account
   * POST /users/parent-accounts
   *
   * Creates a TenantUser with 'Parent' SchoolRole at the specified school.
   * Must be defined BEFORE GET /users/:id to avoid route conflicts.
   */
  @Post('parent-accounts')
  @RequireGlobalRole('TenantAdmin')
  @UseGuards(GlobalRoleGuard)
  async createParentAccount(
    @Body() dto: CreateParentAccountDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<ParentAccountResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.usersService.createParentAccount(dto, context);
  }

  /**
   * Create a student portal account
   * POST /users/student-accounts
   *
   * Creates a TenantUser with 'Student' SchoolRole at the specified school.
   */
  @Post('student-accounts')
  @RequireGlobalRole('TenantAdmin')
  @UseGuards(GlobalRoleGuard)
  async createStudentAccount(
    @Body() dto: CreateStudentAccountDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StudentAccountResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.usersService.createStudentAccount(dto, context);
  }

  /**
   * List/search users for tenant
   * GET /users?search=john&status=active&globalRole=TenantUser&schoolId=xxx&role=Teacher&limit=50&cursor=...
   */
  @Get()
  @RequireGlobalRole('TenantAdmin')
  @UseGuards(GlobalRoleGuard)
  async listUsers(
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('globalRole') globalRole?: string,
    @Query('schoolId') schoolId?: string,
    @Query('role') role?: string,
  ): Promise<UserListResponseDto> {
    const context = this.buildContext(tenant, req);
    const parsedLimit = limit ? parseInt(limit, 10) : 50;

    // If any filter provided, use searchUsers
    if (search || status || globalRole || schoolId || role) {
      const result = await this.usersService.searchUsers(
        context,
        { search, status, globalRole, schoolId, role },
        parsedLimit,
        cursor
      );
      return {
        items: result.items,
        lastEvaluatedKey: result.lastEvaluatedKey,
        hasMore: result.hasMore,
      };
    }

    // Default: list all users
    const result = await this.usersService.listUsers(context, parsedLimit, cursor);
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get current authenticated user (Cognito-first)
   * GET /users/me
   * 
   * This route must be defined BEFORE /users/:id to avoid route conflicts.
   * Uses Cognito-first pattern: always gets user from Cognito, optionally enriches with DynamoDB.
   * Returns full user profile including school assignments for Shell context initialization.
   */
  @Get('me')
  async getCurrentUser(
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CurrentUserProfileDto> {
    const context = this.buildContext(tenant, req);
    // Use AuthService.getCurrentUser() which implements Cognito-first pattern
    const currentUser = await this.authService.getCurrentUser(context);
    
    // Try to get full user record from DynamoDB if it exists (for additional fields)
    let dynamoUser: UserResponseDto | null = null;
    try {
      dynamoUser = await this.usersService.getUser(context.userId, context);
    } catch {
      // DynamoDB record doesn't exist yet - that's OK, use Cognito data only
      // This is expected for users created via Cognito Hosted UI or provisioning
    }
    
    // Get school assignments with school names for Shell context
    const assignments = await this.usersService.getUserAssignments(context.userId, context);
    
    // Merge Cognito data (source of truth) with DynamoDB data (extensions)
    // Cognito fields take precedence for core identity, DynamoDB provides extensions
    return {
      userId: currentUser.user.userId,
      email: currentUser.user.email,
      firstName: currentUser.user.firstName,
      lastName: currentUser.user.lastName,
      displayName: dynamoUser?.displayName || `${currentUser.user.firstName} ${currentUser.user.lastName}`.trim(),
      phone: dynamoUser?.phone || undefined,
      avatarUrl: dynamoUser?.avatarUrl || undefined,
      address: dynamoUser?.address || undefined,
      globalRole: currentUser.user.globalRole as 'TenantAdmin' | 'TenantUser',
      status: dynamoUser?.status || 'active' as 'active' | 'inactive' | 'pending' | 'suspended',
      tenantId: context.tenantId,
      tenantName: undefined, // Will be populated by Shell context from /tenants/{id} call
      assignments,
      defaultSchoolId: currentUser.user.preferences?.defaultSchoolId,
      lastLoginAt: dynamoUser?.lastLoginAt || undefined,
      mfaEnabled: dynamoUser?.mfaEnabled || undefined,
      createdAt: dynamoUser?.createdAt || new Date().toISOString(),
      updatedAt: dynamoUser?.updatedAt || new Date().toISOString(),
    };
  }

  /**
   * Get current user's resolved permissions across all school roles
   * GET /users/me/permissions
   *
   * Must be defined BEFORE /users/:id to avoid route conflicts.
   */
  @Get('me/permissions')
  async getMyPermissions(
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ) {
    const context = this.buildContext(tenant, req);
    return this.rolesService.getUserPermissions(context.userId, context);
  }

  /**
   * Get a user's display name only.
   * GET /users/:id/display-name
   *
   * Permissive intra-tenant lookup: any authenticated user in the same
   * tenant can resolve another user's display name. Returns ONLY the
   * display name (no email, phone, role, status) so the surface is as
   * narrow as possible. Used by cross-service rendering (finance receipts
   * resolving the recorder UUID → human name) where the caller is
   * typically a parent and `assertSelfOrAdmin` on `GET /users/:id`
   * would 403.
   *
   * Must be defined BEFORE `@Get(':id')` to avoid NestJS routing the
   * `display-name` path-segment as an `:id` value.
   */
  @Get(':id/display-name')
  async getUserDisplayName(
    @Param('id') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<{ userId: string; displayName: string | null }> {
    const context = this.buildContext(tenant, req);
    const displayName = await this.usersService.getUserDisplayName(userId, context);
    return { userId, displayName };
  }

  /**
   * Get user by ID
   * GET /users/:id
   * Self-access or TenantAdmin
   */
  @Get(':id')
  async getUser(
    @Param('id') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<UserResponseDto> {
    const context = this.buildContext(tenant, req);
    this.assertSelfOrAdmin(userId, context);
    return this.usersService.getUser(userId, context);
  }

  /**
   * Change user's global role (promote/demote)
   * PATCH /users/:id/global-role
   * TenantAdmin only. Cannot change own role.
   *
   * This route MUST be defined BEFORE PATCH /users/:id to avoid NestJS routing conflicts.
   */
  @Patch(':id/global-role')
  @RequireGlobalRole('TenantAdmin')
  @UseGuards(GlobalRoleGuard)
  async changeGlobalRole(
    @Param('id') userId: string,
    @Body() changeGlobalRoleDto: ChangeGlobalRoleDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ userId: string; previousRole: string; newRole: string; sessionsRevoked: number }> {
    const context = this.buildContext(tenant, req);
    return this.usersService.changeGlobalRole(userId, changeGlobalRoleDto.globalRole, context);
  }

  /**
   * Update user
   * PATCH /users/:id
   * Self-edit (limited fields) or TenantAdmin (all fields)
   */
  @Patch(':id')
  async updateUser(
    @Param('id') userId: string,
    @Body() updateUserDto: UpdateUserDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<UserResponseDto> {
    const context = this.buildContext(tenant, req);
    const isSelf = context.userId === userId;
    const isAdmin = context.globalRole === 'TenantAdmin';

    if (!isSelf && !isAdmin) {
      throw new ForbiddenException('Can only update your own profile or require TenantAdmin');
    }

    // Non-admin self-edit: restrict to safe fields only
    if (isSelf && !isAdmin) {
      const SELF_EDITABLE_FIELDS = ['firstName', 'lastName', 'displayName', 'phone', 'avatarUrl', 'address'];
      const dto = updateUserDto as Record<string, unknown>;
      for (const key of Object.keys(dto)) {
        if (!SELF_EDITABLE_FIELDS.includes(key)) {
          throw new ForbiddenException(`Cannot modify field '${key}' — requires TenantAdmin`);
        }
      }
    }

    return this.usersService.updateUser(userId, updateUserDto, context);
  }

  /**
   * Delete user (soft delete)
   * DELETE /users/:id
   * TenantAdmin only, cannot delete self
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireGlobalRole('TenantAdmin')
  @UseGuards(GlobalRoleGuard)
  async deleteUser(
    @Param('id') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    if (context.userId === userId) {
      throw new ForbiddenException('Cannot delete your own account');
    }
    return this.usersService.deleteUser(userId, context);
  }

  /**
   * Get user preferences
   * GET /users/:id/preferences
   * Self-access or TenantAdmin
   */
  @Get(':id/preferences')
  async getPreferences(
    @Param('id') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ) {
    const context = this.buildContext(tenant, req);
    this.assertSelfOrAdmin(userId, context);
    return this.usersService.getPreferences(userId, context);
  }

  /**
   * Update user preferences
   * PATCH /users/:id/preferences
   * Self-access or TenantAdmin
   */
  @Patch(':id/preferences')
  async updatePreferences(
    @Param('id') userId: string,
    @Body() updatePreferencesDto: UpdatePreferencesDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ) {
    const context = this.buildContext(tenant, req);
    this.assertSelfOrAdmin(userId, context);
    return this.usersService.updatePreferences(userId, updatePreferencesDto, context);
  }

  /**
   * Get user's school assignments
   * GET /users/:id/assignments
   * Self-access or TenantAdmin
   */
  @Get(':id/assignments')
  async getUserAssignments(
    @Param('id') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<UserAssignmentsResponseDto> {
    const context = this.buildContext(tenant, req);
    this.assertSelfOrAdmin(userId, context);
    const assignments = await this.usersService.getUserAssignments(userId, context);
    return {
      userId,
      assignments,
    };
  }

  /**
   * Build request context from tenant credentials
   */
  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
  }

  /**
   * Assert the caller is either the target user or a TenantAdmin
   */
  private assertSelfOrAdmin(targetUserId: string, context: RequestContext): void {
    if (context.userId !== targetUserId && context.globalRole !== 'TenantAdmin') {
      throw new ForbiddenException('Access denied: requires self-access or TenantAdmin');
    }
  }
}
