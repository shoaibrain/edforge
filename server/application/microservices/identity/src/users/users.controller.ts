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
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  CreateUserDtoZ,
  UpdateUserDtoZ,
  UpdatePreferencesDtoZ,
} from '../common/dto/zod-dtos';
import type {
  UserResponseDto,
  UserListResponseDto,
  UserAssignmentsResponseDto,
  CurrentUserProfileDto,
} from '@edforge/shared-types';
import { RequestContext } from '../common/entities';
import { RequireGlobalRole } from '../common/decorators/require-global-role.decorator';
import { GlobalRoleGuard } from '../common/guards/global-role.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService
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
   * List all users for tenant
   * GET /users
   */
  @Get()
  @RequireGlobalRole('TenantAdmin')
  @UseGuards(GlobalRoleGuard)
  async listUsers(
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string
  ): Promise<UserListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.usersService.listUsers(
      context,
      limit ? parseInt(limit, 10) : 50,
      cursor
    );
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
      globalRole: currentUser.user.globalRole as 'TenantAdmin' | 'TenantUser',
      status: dynamoUser?.status || 'active' as 'active' | 'inactive' | 'pending' | 'suspended',
      tenantId: context.tenantId,
      tenantName: undefined, // Will be populated by Shell context from /tenants/{id} call
      assignments,
      lastLoginAt: dynamoUser?.lastLoginAt || undefined,
      mfaEnabled: dynamoUser?.mfaEnabled || undefined,
      createdAt: dynamoUser?.createdAt || new Date().toISOString(),
      updatedAt: dynamoUser?.updatedAt || new Date().toISOString(),
    };
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
      const SELF_EDITABLE_FIELDS = ['firstName', 'lastName', 'displayName', 'phone', 'avatarUrl'];
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
