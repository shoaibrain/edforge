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
  AssignRoleDtoZ,
  UpdateRoleDtoZ,
  CheckPermissionDtoZ,
  DeactivateRoleDtoZ,
} from '../common/dto/zod-dtos';
import type {
  RoleAssignmentResponseDto,
  UserRolesResponseDto,
  CheckPermissionResponseDto,
} from '@edforge/shared-types';
import { RequestContext } from '../common/entities';

@Controller('users/:id/roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  /**
   * Assign role to user
   * POST /users/:id/roles
   */
  @Post()
  async assignRole(
    @Param('id') userId: string,
    @Body() assignRoleDto: AssignRoleDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<RoleAssignmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.rolesService.assignRole(userId, assignRoleDto, context);
  }

  /**
   * Get all roles for user
   * GET /users/:id/roles
   */
  @Get()
  async getUserRoles(
    @Param('id') userId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<UserRolesResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.rolesService.getUserRoles(userId, context);
  }

  /**
   * Get specific role for user at school
   * GET /users/:id/roles/:schoolId
   */
  @Get(':schoolId')
  async getRole(
    @Param('id') userId: string,
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<RoleAssignmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.rolesService.getRole(userId, schoolId, context);
  }

  /**
   * Update role
   * PATCH /users/:id/roles/:schoolId
   */
  @Patch(':schoolId')
  async updateRole(
    @Param('id') userId: string,
    @Param('schoolId') schoolId: string,
    @Body() updateRoleDto: UpdateRoleDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<RoleAssignmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.rolesService.updateRole(userId, schoolId, updateRoleDto, context);
  }

  /**
   * Deactivate role
   * DELETE /users/:id/roles/:schoolId
   */
  @Delete(':schoolId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivateRole(
    @Param('id') userId: string,
    @Param('schoolId') schoolId: string,
    @Body() deactivateDto: DeactivateRoleDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.rolesService.deactivateRole(userId, schoolId, deactivateDto, context);
  }

  /**
   * Check permission
   * POST /users/:id/roles/permissions/check
   */
  @Post('/permissions/check')
  @HttpCode(HttpStatus.OK)
  async checkPermission(
    @Body() checkPermissionDto: CheckPermissionDtoZ,
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
