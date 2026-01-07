/**
 * Roles Controller - ABAC Role Assignment Endpoints
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  AssignRoleDto,
  UpdateRoleDto,
  RoleAssignmentResponseDto,
  UserRolesResponseDto,
  CheckPermissionDto,
  CheckPermissionResponseDto,
  DeactivateRoleDto,
} from '../common/dto/role.dto';
import { RequestContext } from '../common/entities';

@Controller('users/:userId/roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  /**
   * Assign role to user
   * POST /users/:userId/roles
   */
  @Post()
  async assignRole(
    @Param('userId') userId: string,
    @Body() assignRoleDto: AssignRoleDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<RoleAssignmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.rolesService.assignRole(userId, assignRoleDto, context);
  }

  /**
   * Get all roles for user
   * GET /users/:userId/roles
   */
  @Get()
  async getUserRoles(
    @Param('userId') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<UserRolesResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.rolesService.getUserRoles(userId, context);
  }

  /**
   * Get specific role for user at school
   * GET /users/:userId/roles/:schoolId
   */
  @Get(':schoolId')
  async getRole(
    @Param('userId') userId: string,
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<RoleAssignmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.rolesService.getRole(userId, schoolId, context);
  }

  /**
   * Update role
   * PATCH /users/:userId/roles/:schoolId
   */
  @Patch(':schoolId')
  async updateRole(
    @Param('userId') userId: string,
    @Param('schoolId') schoolId: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<RoleAssignmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.rolesService.updateRole(userId, schoolId, updateRoleDto, context);
  }

  /**
   * Deactivate role
   * DELETE /users/:userId/roles/:schoolId
   */
  @Delete(':schoolId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivateRole(
    @Param('userId') userId: string,
    @Param('schoolId') schoolId: string,
    @Body() deactivateDto: DeactivateRoleDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.rolesService.deactivateRole(userId, schoolId, deactivateDto, context);
  }

  /**
   * Check permission
   * POST /permissions/check
   */
  @Post('/permissions/check')
  async checkPermission(
    @Body() checkPermissionDto: CheckPermissionDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CheckPermissionResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.rolesService.checkPermission(checkPermissionDto, context);
  }

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

