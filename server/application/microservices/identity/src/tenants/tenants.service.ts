/**
 * Tenants Service - Tenant management for Identity Service
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  Tenant,
} from '../common/entities/tenant.entity';
import {
  WorkspaceSettings,
  createDefaultWorkspaceSettings,
} from '../common/entities/workspace-settings.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
} from '../common/entities/base.entity';
import type {
  UpdateTenantDto,
  TenantResponseDto,
  TenantLookupResponseDto,
  UpdateWorkspaceSettingsDto,
  WorkspaceSettingsResponseDto,
} from '@aibrains/shared-types';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * Get tenant by ID
   */
  async getTenant(tenantId: string, context: RequestContext): Promise<TenantResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const tenant = await this.dynamoDBClient.getItem<Tenant>(
      client,
      tenantId,
      EntityKeyBuilder.tenantMetadata()
    );

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return this.toTenantResponse(tenant);
  }

  /**
   * Lookup tenant by subdomain (public endpoint, uses system client)
   */
  async lookupBySubdomain(subdomain: string): Promise<TenantLookupResponseDto> {
    const client = this.dynamoDBClient.getSystemClient();
    const result = await this.dynamoDBClient.queryGSI<Tenant>(
      client,
      'GSI1',
      GSIKeyBuilder.subdomain(subdomain),
      'TENANT',
      'eq',
      undefined,
      undefined,
      undefined,
      1
    );

    if (result.items.length === 0) {
      throw new NotFoundException('Tenant not found');
    }

    const tenant = result.items[0];

    return {
      tenantId: tenant.tenantId,
      name: tenant.name,
      subdomain: tenant.subdomain,
      tier: tenant.tier,
      status: tenant.status,
      branding: tenant.branding,
    };
  }

  /**
   * Update tenant
   */
  async updateTenant(
    tenantId: string,
    updateDto: UpdateTenantDto,
    context: RequestContext
  ): Promise<TenantResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const tenant = await this.dynamoDBClient.getItem<Tenant>(
      client,
      tenantId,
      EntityKeyBuilder.tenantMetadata()
    );

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    if (updateDto.name) {
      updates.push('#name = :name');
      values[':name'] = updateDto.name;
      names['#name'] = 'name';
    }

    if (updateDto.contactEmail) {
      updates.push('contactEmail = :contactEmail');
      values[':contactEmail'] = updateDto.contactEmail;
    }

    if (updateDto.contactPhone !== undefined) {
      updates.push('contactPhone = :contactPhone');
      values[':contactPhone'] = updateDto.contactPhone;
    }

    if (updateDto.address) {
      updates.push('address = :address');
      values[':address'] = updateDto.address;
    }

    if (updateDto.status) {
      updates.push('#status = :status');
      values[':status'] = updateDto.status;
      names['#status'] = 'status';
    }

    if (updateDto.branding) {
      updates.push('branding = :branding');
      values[':branding'] = updateDto.branding;
    }

    if (updates.length === 0) {
      return this.toTenantResponse(tenant);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#version'] = 'version';

    const updatedTenant = await this.dynamoDBClient.updateItem<Tenant>(
      client,
      tenantId,
      EntityKeyBuilder.tenantMetadata(),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names
    );

    this.logger.log(`Tenant updated: ${tenantId}`);

    return this.toTenantResponse(updatedTenant);
  }

  /**
   * Get workspace settings (lazy-creates defaults if not found)
   */
  async getWorkspaceSettings(
    tenantId: string,
    context: RequestContext,
  ): Promise<WorkspaceSettingsResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    let settings = await this.dynamoDBClient.getItem<WorkspaceSettings>(
      client,
      tenantId,
      EntityKeyBuilder.workspaceSettings(),
    );

    if (!settings) {
      // Lazy-create defaults — fetch tenant for org name
      const tenant = await this.dynamoDBClient.getItem<Tenant>(
        client,
        tenantId,
        EntityKeyBuilder.tenantMetadata(),
      );
      const orgName = tenant?.name || 'My Organization';
      const country = tenant?.country || tenant?.address?.country;

      settings = createDefaultWorkspaceSettings(tenantId, orgName, context.userId, country);
      await this.dynamoDBClient.putItem(client, settings);
      this.logger.log(`Created default workspace settings for tenant: ${tenantId}`);
    }

    return this.toWorkspaceSettingsResponse(settings);
  }

  /**
   * Confirm workspace settings — sets workspaceConfirmedAt timestamp.
   * Idempotent: calling again updates the timestamp but doesn't error.
   */
  async confirmWorkspaceSettings(
    tenantId: string,
    context: RequestContext,
  ): Promise<{ confirmed: true; workspaceConfirmedAt: string }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();

    await this.dynamoDBClient.updateItem<WorkspaceSettings>(
      client,
      tenantId,
      EntityKeyBuilder.workspaceSettings(),
      'SET workspaceConfirmedAt = :confirmedAt, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
      {
        ':confirmedAt': now,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
      },
      undefined,
      { '#version': 'version' },
    );

    this.logger.log(`Workspace settings confirmed for tenant: ${tenantId}`);

    return { confirmed: true, workspaceConfirmedAt: now };
  }

  /**
   * Complete onboarding — sets onboardingCompletedAt timestamp.
   * Also sets workspaceConfirmedAt if not already set.
   * Idempotent: calling again updates the timestamp but doesn't error.
   */
  async completeOnboarding(
    tenantId: string,
    context: RequestContext,
  ): Promise<{ completed: true; onboardingCompletedAt: string }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();

    await this.dynamoDBClient.updateItem<WorkspaceSettings>(
      client,
      tenantId,
      EntityKeyBuilder.workspaceSettings(),
      'SET onboardingCompletedAt = :completedAt, workspaceConfirmedAt = if_not_exists(workspaceConfirmedAt, :completedAt), updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
      {
        ':completedAt': now,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
      },
      undefined,
      { '#version': 'version' },
    );

    this.logger.log(`Onboarding completed for tenant: ${tenantId}`);

    return { completed: true, onboardingCompletedAt: now };
  }

  /**
   * Update workspace settings (partial update)
   */
  async updateWorkspaceSettings(
    tenantId: string,
    updateDto: UpdateWorkspaceSettingsDto,
    context: RequestContext,
  ): Promise<WorkspaceSettingsResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Ensure settings exist (lazy-create)
    const current = await this.getWorkspaceSettings(tenantId, context);

    // Check lock
    if (current.isLocked) {
      throw new ForbiddenException(
        current.lockReason || 'Workspace settings are locked while an academic year is active',
      );
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    if (updateDto.regional) {
      // Merge partial regional with existing
      const merged = { ...current.regional, ...updateDto.regional };
      updates.push('regional = :regional');
      values[':regional'] = merged;
    }

    if (updateDto.branding) {
      const merged = { ...current.branding, ...updateDto.branding };
      updates.push('branding = :branding');
      values[':branding'] = merged;
    }

    if (updateDto.policies) {
      const merged = { ...current.policies, ...updateDto.policies };
      updates.push('policies = :policies');
      values[':policies'] = merged;
    }

    if (updates.length === 0) {
      return current;
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#version'] = 'version';

    const updated = await this.dynamoDBClient.updateItem<WorkspaceSettings>(
      client,
      tenantId,
      EntityKeyBuilder.workspaceSettings(),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names,
    );

    this.logger.log(`Workspace settings updated for tenant: ${tenantId}`);

    return this.toWorkspaceSettingsResponse(updated);
  }

  private toWorkspaceSettingsResponse(settings: WorkspaceSettings): WorkspaceSettingsResponseDto {
    return {
      tenantId: settings.tenantId,
      regional: typeof settings.regional === 'string'
        ? JSON.parse(settings.regional)
        : settings.regional,
      branding: typeof settings.branding === 'string'
        ? JSON.parse(settings.branding)
        : settings.branding,
      policies: typeof settings.policies === 'string'
        ? JSON.parse(settings.policies)
        : settings.policies,
      isLocked: settings.isLocked,
      lockReason: settings.lockReason,
      workspaceConfirmedAt: settings.workspaceConfirmedAt,
      onboardingCompletedAt: settings.onboardingCompletedAt,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  private toTenantResponse(tenant: Tenant): TenantResponseDto {
    return {
      tenantId: tenant.tenantId,
      name: tenant.name,
      subdomain: tenant.subdomain,
      contactEmail: tenant.contactEmail,
      contactPhone: tenant.contactPhone,
      address: tenant.address,
      tier: tenant.tier,
      status: tenant.status,
      features: tenant.features as any,
      limits: tenant.limits as any,
      branding: tenant.branding,
      schoolCount: tenant.schoolCount,
      userCount: tenant.userCount,
      studentCount: tenant.studentCount,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    };
  }
}

