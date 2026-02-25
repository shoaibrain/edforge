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
import { IdentityEventsService } from '../common/services/identity-events.service';
import {
  RoleAssignment,
  createRoleAssignment,
  DEFAULT_ROLE_PERMISSIONS,
  PermissionAction,
} from '../common/entities/role-assignment.entity';
import { matchesPermission } from '../common/utils/permission-matcher';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
  GlobalRole,
  SchoolRole,
} from '../common/entities/base.entity';
import type {
  AssignRoleDto,
  UpdateRoleDto,
  RoleAssignmentResponseDto,
  UserRolesResponseDto,
  CheckPermissionDto,
  CheckPermissionResponseDto,
  DeactivateRoleDto,
  ChangeSchoolRoleDto,
} from '@aibrains/shared-types';

/** Role seniority levels — higher number = more senior */
const ROLE_SENIORITY: Record<string, number> = {
  Principal: 100,
  VicePrincipal: 80,
  Teacher: 60,
  Accountant: 60,
  Counselor: 50,
  Nurse: 50,
  Staff: 40,
  Student: 20,
  Parent: 10,
};

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: IdentityEventsService,
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

      // Escalation prevention: cannot assign a role at or above own seniority
      const assignerSeniority = ROLE_SENIORITY[assignerRole.role] ?? 0;
      const targetSeniority = ROLE_SENIORITY[assignRoleDto.role] ?? 0;
      if (targetSeniority >= assignerSeniority) {
        throw new ForbiddenException(
          `Cannot assign role '${assignRoleDto.role}' (seniority ${targetSeniority}) — ` +
          `at or above your role '${assignerRole.role}' (seniority ${assignerSeniority})`
        );
      }
    }

    // Only TenantAdmin can assign Principal
    if (assignRoleDto.role === 'Principal' && context.globalRole !== 'TenantAdmin') {
      throw new ForbiddenException('Only TenantAdmin can assign Principal role');
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

    // Reactivation path: if inactive role exists, reactivate via updateItem
    if (existingRole && !existingRole.isActive) {
      const now = new Date().toISOString();
      const reactivated = await this.dynamoDBClient.updateItem<RoleAssignment>(
        client,
        context.tenantId,
        EntityKeyBuilder.roleAssignment(userId, assignRoleDto.schoolId),
        'SET #role = :role, isActive = :isActive, assignedAt = :assignedAt, assignedBy = :assignedBy, ' +
        'departmentId = :departmentId, permissionOverrides = :permissionOverrides, expiresAt = :expiresAt, ' +
        'reactivatedAt = :reactivatedAt, reactivatedFrom = :reactivatedFrom, ' +
        'deactivatedAt = :nullVal, deactivatedBy = :nullVal, deactivationReason = :nullVal, ' +
        'gsi3pk = :gsi3pk, gsi3sk = :gsi3sk, ' +
        'updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
        {
          ':role': assignRoleDto.role,
          ':isActive': true,
          ':assignedAt': now,
          ':assignedBy': context.userId,
          ':departmentId': assignRoleDto.departmentId || null,
          ':permissionOverrides': assignRoleDto.permissionOverrides || null,
          ':expiresAt': assignRoleDto.expiresAt || null,
          ':reactivatedAt': now,
          ':reactivatedFrom': existingRole.role,
          ':nullVal': null,
          ':gsi3pk': GSIKeyBuilder.schoolUsers(context.tenantId, assignRoleDto.schoolId),
          ':gsi3sk': GSIKeyBuilder.schoolUserRole(assignRoleDto.role, userId),
          ':updatedAt': now,
          ':updatedBy': context.userId,
          ':inc': 1,
        },
        undefined,
        { '#role': 'role', '#version': 'version' }
      );

      this.logger.log(`Role reactivated: ${userId} -> ${assignRoleDto.role} at school ${assignRoleDto.schoolId} (was ${existingRole.role})`);
      return this.toRoleAssignmentResponse(reactivated);
    }

    // New assignment path: create fresh role assignment
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

    // Read-side filtering: exclude expired roles
    const now = new Date();
    const activeRoles = rolesResult.items.filter(
      r => !r.expiresAt || new Date(r.expiresAt) > now
    );

    return {
      userId,
      globalRole: user.globalRole,
      schoolRoles: activeRoles.map(r => this.toRoleAssignmentResponse(r)),
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

      // Escalation prevention on role change
      if (updateRoleDto.role) {
        const assignerSeniority = ROLE_SENIORITY[assignerRole.role] ?? 0;
        const targetSeniority = ROLE_SENIORITY[updateRoleDto.role] ?? 0;
        if (targetSeniority >= assignerSeniority) {
          throw new ForbiddenException(
            `Cannot change role to '${updateRoleDto.role}' — at or above your seniority`
          );
        }
      }
    }

    // Only TenantAdmin can set Principal role
    if (updateRoleDto.role === 'Principal' && context.globalRole !== 'TenantAdmin') {
      throw new ForbiddenException('Only TenantAdmin can assign Principal role');
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
   * Change a user's school role in-place (same SK, atomic update)
   */
  async changeRole(
    userId: string,
    schoolId: string,
    changeDto: ChangeSchoolRoleDto,
    context: RequestContext
  ): Promise<RoleAssignmentResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Get existing role — must be active
    const existingRole = await this.dynamoDBClient.getItem<RoleAssignment>(
      client,
      context.tenantId,
      EntityKeyBuilder.roleAssignment(userId, schoolId)
    );

    if (!existingRole || !existingRole.isActive) {
      throw new NotFoundException('No active role assignment found for this user at this school');
    }

    // Same role check
    if (existingRole.role === changeDto.newRole) {
      throw new ConflictException(`User already has role '${changeDto.newRole}' at this school`);
    }

    // Authorization: TenantAdmin or Principal with escalation prevention
    if (context.globalRole !== 'TenantAdmin') {
      const assignerRole = await this.dynamoDBClient.getItem<RoleAssignment>(
        client,
        context.tenantId,
        EntityKeyBuilder.roleAssignment(context.userId, schoolId)
      );

      if (!assignerRole || assignerRole.role !== 'Principal') {
        throw new ForbiddenException('Only TenantAdmin or School Principal can change roles');
      }

      const assignerSeniority = ROLE_SENIORITY[assignerRole.role] ?? 0;
      const targetSeniority = ROLE_SENIORITY[changeDto.newRole] ?? 0;
      if (targetSeniority >= assignerSeniority) {
        throw new ForbiddenException(
          `Cannot change role to '${changeDto.newRole}' — at or above your seniority`
        );
      }
    }

    // Only TenantAdmin can assign Principal
    if (changeDto.newRole === 'Principal' && context.globalRole !== 'TenantAdmin') {
      throw new ForbiddenException('Only TenantAdmin can assign Principal role');
    }

    const now = new Date().toISOString();
    const previousRole = existingRole.role;

    // Atomic update: same SK, swap role, preserve history
    const updatedRole = await this.dynamoDBClient.updateItem<RoleAssignment>(
      client,
      context.tenantId,
      EntityKeyBuilder.roleAssignment(userId, schoolId),
      'SET #role = :newRole, previousRole = :previousRole, previousRoleDeactivatedAt = :now, ' +
      'assignedAt = :now, assignedBy = :assignedBy, ' +
      'departmentId = :departmentId, permissionOverrides = :permissionOverrides, expiresAt = :expiresAt, ' +
      'gsi3sk = :gsi3sk, ' +
      'updatedAt = :now, updatedBy = :updatedBy, #version = #version + :inc',
      {
        ':newRole': changeDto.newRole,
        ':previousRole': previousRole,
        ':now': now,
        ':assignedBy': context.userId,
        ':departmentId': changeDto.departmentId || null,
        ':permissionOverrides': changeDto.permissionOverrides || null,
        ':expiresAt': changeDto.expiresAt || null,
        ':gsi3sk': GSIKeyBuilder.schoolUserRole(changeDto.newRole, userId),
        ':updatedBy': context.userId,
        ':inc': 1,
        ':true': true,
      },
      'isActive = :true',
      { '#role': 'role', '#version': 'version' }
    );

    // Publish event (non-blocking)
    this.eventsService.publishSchoolRoleChanged(
      context.tenantId,
      userId,
      schoolId,
      previousRole,
      changeDto.newRole,
      context.userId
    ).catch(err => this.logger.error('Failed to publish SchoolRoleChanged event', err));

    this.logger.log(
      `Role changed: ${userId} at school ${schoolId}: ${previousRole} → ${changeDto.newRole}`
    );

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

    // Check permission overrides first (deny-wins: any deny beats all allows)
    if (role.permissionOverrides) {
      const matching = role.permissionOverrides.filter(
        o => matchesPermission(`${o.resource}:${o.action}`, checkPermissionDto.resource, checkPermissionDto.action)
      );
      if (matching.some(o => o.effect === 'deny')) {
        return { allowed: false, reason: 'Permission explicitly denied' };
      }
      if (matching.some(o => o.effect === 'allow')) {
        return { allowed: true };
      }
    }

    // Check default role permissions (supports multi-action and wildcard patterns)
    const defaultPerms = DEFAULT_ROLE_PERMISSIONS[role.role] || [];
    const allowed = defaultPerms.some(perm =>
      matchesPermission(perm, checkPermissionDto.resource, checkPermissionDto.action)
    );

    return {
      allowed,
      reason: allowed ? undefined : 'Permission not granted for this role',
    };
  }

  /**
   * Get all resolved permissions for a user across all school roles
   */
  async getUserPermissions(
    userId: string,
    context: RequestContext
  ): Promise<{
    userId: string;
    globalRole: string;
    isFullAccess: boolean;
    schoolPermissions: Array<{
      schoolId: string;
      role: string;
      departmentId?: string;
      defaultPermissions: string[];
      overrides: Array<{ resource: string; action: string; effect: string }>;
    }>;
  }> {
    // TenantAdmin has full access — no need to resolve per-school
    if (context.globalRole === 'TenantAdmin') {
      return {
        userId,
        globalRole: context.globalRole,
        isFullAccess: true,
        schoolPermissions: [],
      };
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Query all active roles
    const rolesResult = await this.dynamoDBClient.query<RoleAssignment>(
      client,
      context.tenantId,
      `USER#${userId}#ROLE#`,
      'isActive = :isActive',
      { ':isActive': true }
    );

    // Filter expired roles (read-side)
    const now = new Date();
    const activeRoles = rolesResult.items.filter(
      r => !r.expiresAt || new Date(r.expiresAt) > now
    );

    const schoolPermissions = activeRoles.map(role => ({
      schoolId: role.schoolId,
      role: role.role,
      departmentId: role.departmentId,
      defaultPermissions: DEFAULT_ROLE_PERMISSIONS[role.role] || [],
      overrides: (role.permissionOverrides || []).map(o => ({
        resource: o.resource,
        action: o.action,
        effect: o.effect,
      })),
    }));

    return {
      userId,
      globalRole: context.globalRole,
      isFullAccess: false,
      schoolPermissions,
    };
  }

  /**
   * Cleanup expired role assignments by deactivating them.
   * Scans all active ROLE_ASSIGNMENT entities and deactivates any with past expiresAt.
   */
  async cleanupExpiredRoles(
    context: RequestContext
  ): Promise<{ deactivatedCount: number; scannedCount: number }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Query all active role assignments for the tenant
    const rolesResult = await this.dynamoDBClient.query<RoleAssignment>(
      client,
      context.tenantId,
      'USER#',
      'entityType = :type AND isActive = :isActive',
      { ':type': 'ROLE_ASSIGNMENT', ':isActive': true }
    );

    const now = new Date();
    let deactivatedCount = 0;
    const nowIso = now.toISOString();

    for (const role of rolesResult.items) {
      if (role.expiresAt && new Date(role.expiresAt) < now) {
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          EntityKeyBuilder.roleAssignment(role.userId, role.schoolId),
          'SET isActive = :isActive, deactivatedAt = :deactivatedAt, deactivatedBy = :deactivatedBy, deactivationReason = :reason, updatedAt = :updatedAt',
          {
            ':isActive': false,
            ':deactivatedAt': nowIso,
            ':deactivatedBy': 'SYSTEM_CLEANUP',
            ':reason': 'expired',
            ':updatedAt': nowIso,
          }
        );
        deactivatedCount++;
      }
    }

    this.logger.log(`Expired role cleanup: ${deactivatedCount} deactivated out of ${rolesResult.items.length} scanned`);

    return {
      deactivatedCount,
      scannedCount: rolesResult.items.length,
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

