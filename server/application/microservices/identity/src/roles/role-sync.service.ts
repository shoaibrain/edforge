/**
 * Role Sync Service
 *
 * Bridges Staff Assignments (Ed-Fi) → ABAC Role Assignments.
 * Writes RoleAssignment entities directly via DynamoDBClientService,
 * bypassing RolesService authorization checks for internal system calls.
 *
 * All methods are idempotent and use graceful degradation (log errors
 * but don't throw) so that staff operations never fail due to role sync issues.
 */

import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  RoleAssignment,
  createRoleAssignment,
} from '../common/entities/role-assignment.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
  SchoolRole,
} from '../common/entities/base.entity';
import { Staff, StaffRole } from '../common/entities/staff.entity';
import { staffRoleToSchoolRole } from '../common/utils/role-mapper';

@Injectable()
export class RoleSyncService {
  private readonly logger = new Logger(RoleSyncService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

  /**
   * Create or reactivate a RoleAssignment for a user at a school.
   *
   * Idempotent behavior:
   * - Active assignment with same role → no-op
   * - Active assignment with different role → updates role in-place
   * - Inactive assignment → reactivates with the new role
   * - No assignment → creates a new one
   */
  async syncRoleAssignment(
    userId: string,
    schoolId: string,
    staffRole: StaffRole,
    context: RequestContext,
  ): Promise<void> {
    try {
      const schoolRole = staffRoleToSchoolRole(staffRole);
      const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

      const existing = await this.dynamoDBClient.getItem<RoleAssignment>(
        client,
        context.tenantId,
        EntityKeyBuilder.roleAssignment(userId, schoolId),
      );

      if (existing && existing.isActive) {
        if (existing.role === schoolRole) {
          this.logger.debug(`Role assignment already active: ${userId} → ${schoolRole} at ${schoolId}`);
          return;
        }

        // Active with different role → update in-place
        const now = new Date().toISOString();
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          EntityKeyBuilder.roleAssignment(userId, schoolId),
          'SET #role = :role, previousRole = :previousRole, ' +
          'gsi3sk = :gsi3sk, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
          {
            ':role': schoolRole,
            ':previousRole': existing.role,
            ':gsi3sk': GSIKeyBuilder.schoolUserRole(schoolRole, userId),
            ':updatedAt': now,
            ':updatedBy': context.userId,
            ':inc': 1,
          },
          undefined,
          { '#role': 'role', '#version': 'version' },
        );
        this.logger.log(`Role assignment updated: ${userId} → ${schoolRole} (was ${existing.role}) at ${schoolId}`);
        return;
      }

      if (existing && !existing.isActive) {
        // Inactive → reactivate
        const now = new Date().toISOString();
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          EntityKeyBuilder.roleAssignment(userId, schoolId),
          'SET #role = :role, isActive = :isActive, assignedAt = :assignedAt, assignedBy = :assignedBy, ' +
          'reactivatedAt = :reactivatedAt, reactivatedFrom = :reactivatedFrom, ' +
          'deactivatedAt = :nullVal, deactivatedBy = :nullVal, deactivationReason = :nullVal, ' +
          'gsi3pk = :gsi3pk, gsi3sk = :gsi3sk, ' +
          'updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
          {
            ':role': schoolRole,
            ':isActive': true,
            ':assignedAt': now,
            ':assignedBy': context.userId,
            ':reactivatedAt': now,
            ':reactivatedFrom': existing.role,
            ':nullVal': null,
            ':gsi3pk': GSIKeyBuilder.schoolUsers(context.tenantId, schoolId),
            ':gsi3sk': GSIKeyBuilder.schoolUserRole(schoolRole, userId),
            ':updatedAt': now,
            ':updatedBy': context.userId,
            ':inc': 1,
          },
          undefined,
          { '#role': 'role', '#version': 'version' },
        );
        this.logger.log(`Role assignment reactivated: ${userId} → ${schoolRole} at ${schoolId}`);
        return;
      }

      // New assignment
      const roleAssignment = createRoleAssignment(
        context.tenantId,
        userId,
        schoolId,
        schoolRole,
        context.userId,
      );
      await this.dynamoDBClient.putItem(client, roleAssignment);
      this.logger.log(`Role assignment created: ${userId} → ${schoolRole} at ${schoolId}`);
    } catch (error: any) {
      this.logger.error(
        `Failed to sync role assignment for user ${userId} at school ${schoolId}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Assign a SchoolRole directly (no StaffRole mapping).
   * Used for non-staff roles like Parent and Student.
   */
  async assignSchoolRole(
    userId: string,
    schoolId: string,
    schoolRole: SchoolRole,
    context: RequestContext,
  ): Promise<void> {
    try {
      const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

      const existing = await this.dynamoDBClient.getItem<RoleAssignment>(
        client,
        context.tenantId,
        EntityKeyBuilder.roleAssignment(userId, schoolId),
      );

      if (existing && existing.isActive) {
        if (existing.role === schoolRole) {
          this.logger.debug(`Role assignment already active: ${userId} → ${schoolRole} at ${schoolId}`);
          return;
        }

        const now = new Date().toISOString();
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          EntityKeyBuilder.roleAssignment(userId, schoolId),
          'SET #role = :role, previousRole = :previousRole, ' +
          'gsi3sk = :gsi3sk, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
          {
            ':role': schoolRole,
            ':previousRole': existing.role,
            ':gsi3sk': GSIKeyBuilder.schoolUserRole(schoolRole, userId),
            ':updatedAt': now,
            ':updatedBy': context.userId,
            ':inc': 1,
          },
          undefined,
          { '#role': 'role', '#version': 'version' },
        );
        this.logger.log(`Role assignment updated: ${userId} → ${schoolRole} (was ${existing.role}) at ${schoolId}`);
        return;
      }

      if (existing && !existing.isActive) {
        const now = new Date().toISOString();
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          EntityKeyBuilder.roleAssignment(userId, schoolId),
          'SET #role = :role, isActive = :isActive, assignedAt = :assignedAt, assignedBy = :assignedBy, ' +
          'reactivatedAt = :reactivatedAt, reactivatedFrom = :reactivatedFrom, ' +
          'deactivatedAt = :nullVal, deactivatedBy = :nullVal, deactivationReason = :nullVal, ' +
          'gsi3pk = :gsi3pk, gsi3sk = :gsi3sk, ' +
          'updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
          {
            ':role': schoolRole,
            ':isActive': true,
            ':assignedAt': now,
            ':assignedBy': context.userId,
            ':reactivatedAt': now,
            ':reactivatedFrom': existing.role,
            ':nullVal': null,
            ':gsi3pk': GSIKeyBuilder.schoolUsers(context.tenantId, schoolId),
            ':gsi3sk': GSIKeyBuilder.schoolUserRole(schoolRole, userId),
            ':updatedAt': now,
            ':updatedBy': context.userId,
            ':inc': 1,
          },
          undefined,
          { '#role': 'role', '#version': 'version' },
        );
        this.logger.log(`Role assignment reactivated: ${userId} → ${schoolRole} at ${schoolId}`);
        return;
      }

      const roleAssignment = createRoleAssignment(
        context.tenantId,
        userId,
        schoolId,
        schoolRole,
        context.userId,
      );
      await this.dynamoDBClient.putItem(client, roleAssignment);
      this.logger.log(`Role assignment created: ${userId} → ${schoolRole} at ${schoolId}`);
    } catch (error: any) {
      this.logger.error(
        `Failed to assign school role for user ${userId} at school ${schoolId}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Deactivate a RoleAssignment for a user at a specific school.
   * No-op if no active assignment exists.
   */
  async deactivateRoleAssignment(
    userId: string,
    schoolId: string,
    reason: string,
    context: RequestContext,
  ): Promise<void> {
    try {
      const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

      const existing = await this.dynamoDBClient.getItem<RoleAssignment>(
        client,
        context.tenantId,
        EntityKeyBuilder.roleAssignment(userId, schoolId),
      );

      if (!existing || !existing.isActive) {
        this.logger.debug(`No active role assignment to deactivate: ${userId} at ${schoolId}`);
        return;
      }

      const now = new Date().toISOString();
      await this.dynamoDBClient.updateItem(
        client,
        context.tenantId,
        EntityKeyBuilder.roleAssignment(userId, schoolId),
        'SET isActive = :isActive, deactivatedAt = :deactivatedAt, deactivatedBy = :deactivatedBy, ' +
        'deactivationReason = :reason, updatedAt = :updatedAt, updatedBy = :updatedBy',
        {
          ':isActive': false,
          ':deactivatedAt': now,
          ':deactivatedBy': context.userId,
          ':reason': reason,
          ':updatedAt': now,
          ':updatedBy': context.userId,
        },
      );
      this.logger.log(`Role assignment deactivated: ${userId} at ${schoolId} (reason: ${reason})`);
    } catch (error: any) {
      this.logger.error(
        `Failed to deactivate role assignment for user ${userId} at school ${schoolId}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Deactivate ALL active RoleAssignments for a user.
   * Used when staff employment is terminated/retired/resigned.
   */
  async deactivateAllRoleAssignments(
    userId: string,
    reason: string,
    context: RequestContext,
  ): Promise<void> {
    try {
      const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

      const rolesResult = await this.dynamoDBClient.query<RoleAssignment>(
        client,
        context.tenantId,
        `USER#${userId}#ROLE#`,
        'isActive = :isActive',
        { ':isActive': true },
      );

      if (rolesResult.items.length === 0) {
        this.logger.debug(`No active role assignments to deactivate for user ${userId}`);
        return;
      }

      const now = new Date().toISOString();
      for (const role of rolesResult.items) {
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          EntityKeyBuilder.roleAssignment(userId, role.schoolId),
          'SET isActive = :isActive, deactivatedAt = :deactivatedAt, deactivatedBy = :deactivatedBy, ' +
          'deactivationReason = :reason, updatedAt = :updatedAt, updatedBy = :updatedBy',
          {
            ':isActive': false,
            ':deactivatedAt': now,
            ':deactivatedBy': context.userId,
            ':reason': reason,
            ':updatedAt': now,
            ':updatedBy': context.userId,
          },
        );
      }

      this.logger.log(`Deactivated ${rolesResult.items.length} role assignment(s) for user ${userId} (reason: ${reason})`);
    } catch (error: any) {
      this.logger.error(
        `Failed to deactivate all role assignments for user ${userId}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Backfill RoleAssignments for all existing staff-user pairs.
   * Scans all Staff entities with a linked userId and creates
   * RoleAssignments for each active school assignment.
   * Idempotent — safe to run multiple times.
   */
  async backfillFromStaff(
    context: RequestContext,
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    let synced = 0;
    let skipped = 0;
    let errors = 0;

    // Query all Staff entities for this tenant
    const staffResult = await this.dynamoDBClient.query<Staff>(
      client,
      context.tenantId,
      'STAFF#',
      'entityType = :entityType',
      { ':entityType': 'STAFF' },
      undefined,
      1000,
    );

    for (const staff of staffResult.items) {
      if (!staff.userId) {
        skipped++;
        continue;
      }

      const assignments = staff.schoolAssignments || [];
      for (const assignment of assignments) {
        if (assignment.endDate) {
          skipped++;
          continue;
        }

        try {
          await this.syncRoleAssignment(
            staff.userId,
            assignment.schoolId,
            assignment.role as StaffRole,
            context,
          );
          synced++;
        } catch (err: any) {
          this.logger.error(`Backfill error for staff ${staff.staffId}: ${err.message}`);
          errors++;
        }
      }
    }

    this.logger.log(`Backfill complete: synced=${synced}, skipped=${skipped}, errors=${errors}`);
    return { synced, skipped, errors };
  }
}
