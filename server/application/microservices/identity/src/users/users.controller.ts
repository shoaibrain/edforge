/**
 * Users Controller - User management endpoints
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
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials } from '@app/auth/auth.decorator';
import {
  CreateUserDto,
  UpdateUserDto,
  UserResponseDto,
  UserListResponseDto,
  UpdatePreferencesDto,
} from '../common/dto/user.dto';
import { RequestContext } from '../common/entities';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Create a new user
   * POST /users
   */
  @Post()
  async createUser(
    @Body() createUserDto: CreateUserDto,
    @TenantCredentials() tenant: any,
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
    @TenantCredentials() tenant: any,
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
   * Get user by ID
   * GET /users/:id
   */
  @Get(':id')
  async getUser(
    @Param('id') userId: string,
    @TenantCredentials() tenant: any,
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
    @TenantCredentials() tenant: any,
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
    @TenantCredentials() tenant: any,
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
    @TenantCredentials() tenant: any,
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
    @TenantCredentials() tenant: any,
    @Req() req: Request
  ) {
    const context = this.buildContext(tenant, req);
    return this.usersService.updatePreferences(userId, updatePreferencesDto, context);
  }

  /**
   * Build request context from tenant credentials
   */
  private buildContext(tenant: any, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole || 'StandardUser',
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
    };
  }
}
