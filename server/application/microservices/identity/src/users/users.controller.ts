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
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  CreateUserDto,
  UpdateUserDto,
  UserResponseDto,
  UserListResponseDto,
  UpdatePreferencesDto,
  SchoolAssignmentDto,
  UserAssignmentsResponseDto,
  CurrentUserProfileDto,
} from '../common/dto/user.dto';
import { RequestContext } from '../common/entities';

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
  async createUser(
    @Body() createUserDto: CreateUserDto,
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
      globalRole: currentUser.user.globalRole as 'TenantAdmin' | 'StandardUser',
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
   */
  @Get(':id')
  async getUser(
    @Param('id') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<UserResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.usersService.getUser(userId, context);
  }

  /**
   * Update user
   * PATCH /users/:id
   */
  @Patch(':id')
  async updateUser(
    @Param('id') userId: string,
    @Body() updateUserDto: UpdateUserDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<UserResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.usersService.updateUser(userId, updateUserDto, context);
  }

  /**
   * Delete user (soft delete)
   * DELETE /users/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(
    @Param('id') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.usersService.deleteUser(userId, context);
  }

  /**
   * Get user preferences
   * GET /users/:id/preferences
   */
  @Get(':id/preferences')
  async getPreferences(
    @Param('id') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ) {
    const context = this.buildContext(tenant, req);
    return this.usersService.getPreferences(userId, context);
  }

  /**
   * Update user preferences
   * PATCH /users/:id/preferences
   */
  @Patch(':id/preferences')
  async updatePreferences(
    @Param('id') userId: string,
    @Body() updatePreferencesDto: UpdatePreferencesDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ) {
    const context = this.buildContext(tenant, req);
    return this.usersService.updatePreferences(userId, updatePreferencesDto, context);
  }

  /**
   * Get user's school assignments
   * GET /users/:id/assignments
   * 
   * Returns the user's role assignments with school names for frontend Shell context.
   * This provides a user-centric view of school assignments.
   */
  @Get(':id/assignments')
  async getUserAssignments(
    @Param('id') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<UserAssignmentsResponseDto> {
    const context = this.buildContext(tenant, req);
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
}
