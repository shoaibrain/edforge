/**
 * Roles Service - ABAC Role Assignment Management
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { 
  RoleAssignment, 
  createRoleAssignment,
  DEFAULT_ROLE_PERMISSIONS,
  PermissionAction,
} from '../common/entities/role-assignment.entity';
import { 
  EntityKeyBuilder, 
  RequestContext,
  GlobalRole,
  SchoolRole,
} from '../common/entities/base.entity';
import {
  AssignRoleDto,
  UpdateRoleDto,
  RoleAssignmentResponseDto,
  UserRolesResponseDto,
  CheckPermissionDto,
  CheckPermissionResponseDto,
  DeactivateRoleDto,
} from '../common/dto/role.dto';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

  /**
   * Assign a role to a user for a specific school
   */
  async assignRole(
    userId: string,
    assignRoleDto: AssignRoleDto,
    context: RequestContext
  ): Promise<RoleAssignmentResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Check if user has permission to assign roles
    if (context.globalRole !== 'TenantAdmin') {
      // Check if user is Principal of the target school
      const assignerRole = await this.dynamoDBClient.getItem<RoleAssignment>(
        client,
        context.tenantId,
        EntityKeyBuilder.roleAssignment(context.userId, assignRoleDto.schoolId)
      );

      if (!assignerRole || assignerRole.role !== 'Principal') {
        throw new ForbiddenException('Only TenantAdmin or School Principal can assign roles');
      }
    }

    // Check if role already exists
    const existingRole = await this.dynamoDBClient.getItem<RoleAssignment>(
      client,
      context.tenantId,
      EntityKeyBuilder.roleAssignment(userId, assignRoleDto.schoolId)
    );

    if (existingRole && existingRole.isActive) {
      throw new ConflictException('User already has an active role at this school');
    }

    // Create new role assignment
    const roleAssignment = createRoleAssignment(
      context.tenantId,
      userId,
      assignRoleDto.schoolId,
      assignRoleDto.role,
      context.userId,
      {
        departmentId: assignRoleDto.departmentId,
        permissionOverrides: assignRoleDto.permissionOverrides,
        expiresAt: assignRoleDto.expiresAt,
      }
    );

    await this.dynamoDBClient.putItem(client, roleAssignment);

    this.logger.log(`Role assigned: ${userId} -> ${assignRoleDto.role} at school ${assignRoleDto.schoolId}`);

    return this.toRoleAssignmentResponse(roleAssignment);
  }

  /**
   * Get all roles for a user
   */
  async getUserRoles(
    userId: string,
    context: RequestContext
  ): Promise<UserRolesResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get user's global role
    const user = await this.dynamoDBClient.getItem<any>(
      client,
      context.tenantId,
      EntityKeyBuilder.user(userId)
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get school roles
    const rolesResult = await this.dynamoDBClient.query<RoleAssignment>(
      client,
      context.tenantId,
      `USER#${userId}#ROLE#`,
      'isActive = :isActive',
      { ':isActive': true }
    );

    return {
      userId,
      globalRole: user.globalRole,
      schoolRoles: rolesResult.items.map(r => this.toRoleAssignmentResponse(r)),
    };
  }

  /**
   * Get role for a specific school
   */
  async getRole(
    userId: string,
    schoolId: string,
    context: RequestContext
  ): Promise<RoleAssignmentResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const role = await this.dynamoDBClient.getItem<RoleAssignment>(
      client,
      context.tenantId,
      EntityKeyBuilder.roleAssignment(userId, schoolId)
    );

    if (!role) {
      throw new NotFoundException('Role assignment not found');
    }

    return this.toRoleAssignmentResponse(role);
  }

  /**
   * Update a role assignment
   */
  async updateRole(
    userId: string,
    schoolId: string,
    updateRoleDto: UpdateRoleDto,
    context: RequestContext
  ): Promise<RoleAssignmentResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const existingRole = await this.dynamoDBClient.getItem<RoleAssignment>(
      client,
      context.tenantId,
      EntityKeyBuilder.roleAssignment(userId, schoolId)
    );

    if (!existingRole) {
      throw new NotFoundException('Role assignment not found');
    }

    // Check permission
    if (context.globalRole !== 'TenantAdmin') {
      const assignerRole = await this.dynamoDBClient.getItem<RoleAssignment>(
        client,
        context.tenantId,
        EntityKeyBuilder.roleAssignment(context.userId, schoolId)
      );

      if (!assignerRole || assignerRole.role !== 'Principal') {
        throw new ForbiddenException('Only TenantAdmin or School Principal can update roles');
      }
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    if (updateRoleDto.role) {
      updates.push('#role = :role');
      values[':role'] = updateRoleDto.role;
      names['#role'] = 'role';
    }

    if (updateRoleDto.departmentId !== undefined) {
      updates.push('departmentId = :departmentId');
      values[':departmentId'] = updateRoleDto.departmentId;
    }

    if (updateRoleDto.permissionOverrides !== undefined) {
      updates.push('permissionOverrides = :permissionOverrides');
      values[':permissionOverrides'] = updateRoleDto.permissionOverrides;
    }

    if (updateRoleDto.isActive !== undefined) {
      updates.push('isActive = :isActive');
      values[':isActive'] = updateRoleDto.isActive;
      if (!updateRoleDto.isActive) {
        updates.push('deactivatedAt = :deactivatedAt', 'deactivatedBy = :deactivatedBy');
        values[':deactivatedAt'] = new Date().toISOString();
        values[':deactivatedBy'] = context.userId;
      }
    }

    if (updateRoleDto.expiresAt !== undefined) {
      updates.push('expiresAt = :expiresAt');
      values[':expiresAt'] = updateRoleDto.expiresAt;
    }

    if (updates.length === 0) {
      return this.toRoleAssignmentResponse(existingRole);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#version'] = 'version';

    const updatedRole = await this.dynamoDBClient.updateItem<RoleAssignment>(
      client,
      context.tenantId,
      EntityKeyBuilder.roleAssignment(userId, schoolId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names
    );

    this.logger.log(`Role updated: ${userId} at school ${schoolId}`);

    return this.toRoleAssignmentResponse(updatedRole);
  }

  /**
   * Deactivate a role
   */
  async deactivateRole(
    userId: string,
    schoolId: string,
    deactivateDto: DeactivateRoleDto,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Check permission
    if (context.globalRole !== 'TenantAdmin') {
      const assignerRole = await this.dynamoDBClient.getItem<RoleAssignment>(
        client,
        context.tenantId,
        EntityKeyBuilder.roleAssignment(context.userId, schoolId)
      );

      if (!assignerRole || assignerRole.role !== 'Principal') {
        throw new ForbiddenException('Only TenantAdmin or School Principal can deactivate roles');
      }
    }

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.roleAssignment(userId, schoolId),
      'SET isActive = :isActive, deactivatedAt = :deactivatedAt, deactivatedBy = :deactivatedBy, deactivationReason = :reason, updatedAt = :updatedAt',
      {
        ':isActive': false,
        ':deactivatedAt': new Date().toISOString(),
        ':deactivatedBy': context.userId,
        ':reason': deactivateDto.reason,
        ':updatedAt': new Date().toISOString(),
      }
    );

    this.logger.log(`Role deactivated: ${userId} at school ${schoolId}`);
  }

  /**
   * Check if user has permission for an action
   */
  async checkPermission(
    checkPermissionDto: CheckPermissionDto,
    context: RequestContext
  ): Promise<CheckPermissionResponseDto> {
    // TenantAdmin has full access
    if (context.globalRole === 'TenantAdmin') {
      return { allowed: true };
    }

    // If no school specified, deny
    if (!checkPermissionDto.schoolId) {
      return { 
        allowed: false, 
        reason: 'School context required for permission check' 
      };
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get user's role at the school
    const role = await this.dynamoDBClient.getItem<RoleAssignment>(
      client,
      context.tenantId,
      EntityKeyBuilder.roleAssignment(context.userId, checkPermissionDto.schoolId)
    );

    if (!role || !role.isActive) {
      return { 
        allowed: false, 
        reason: 'No active role at this school' 
      };
    }

    // Check role expiration
    if (role.expiresAt && new Date(role.expiresAt) < new Date()) {
      return { 
        allowed: false, 
        reason: 'Role has expired' 
      };
    }

    // Check permission overrides first
    if (role.permissionOverrides) {
      const override = role.permissionOverrides.find(
        o => o.resource === checkPermissionDto.resource && o.action === checkPermissionDto.action
      );
      if (override) {
        return { 
          allowed: override.effect === 'allow',
          reason: override.effect === 'deny' ? 'Permission explicitly denied' : undefined,
        };
      }
    }

    // Check default role permissions
    const defaultPerms = DEFAULT_ROLE_PERMISSIONS[role.role] || [];
    const permissionPattern = `${checkPermissionDto.resource}:${checkPermissionDto.action}`;
    const wildcardPattern = `${checkPermissionDto.resource}:*`;

    const allowed = defaultPerms.some(perm => 
      perm === permissionPattern || 
      perm === wildcardPattern ||
      perm === '*:*'
    );

    return { 
      allowed,
      reason: allowed ? undefined : 'Permission not granted for this role',
    };
  }

  /**
   * Convert role assignment to response DTO
   */
  private toRoleAssignmentResponse(role: RoleAssignment): RoleAssignmentResponseDto {
    return {
      userId: role.userId,
      schoolId: role.schoolId,
      role: role.role,
      departmentId: role.departmentId,
      permissionOverrides: role.permissionOverrides?.map(o => ({
        resource: o.resource,
        action: o.action,
        effect: o.effect,
      })),
      isActive: role.isActive,
      assignedAt: role.assignedAt,
      assignedBy: role.assignedBy,
      expiresAt: role.expiresAt,
    };
  }
}

