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
import { IdentityEventsService } from '../common/services/identity-events.service';
import {
  Tenant,
} from '../common/entities/tenant.entity';
import { School } from '../common/entities/school.entity';
import { AcademicYear } from '../common/entities/academic-year.entity';
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
  WorkspaceLockHolder,
  FieldLockViolation,
} from '@aibrains/shared-types';
import { classifyWorkspaceUpdate } from '@aibrains/shared-types';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly identityEvents: IdentityEventsService,
  ) {}

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

    // P0.15 audit — structured JSON line for CloudWatch Logs Insights filter
    // `{ $.audit.action = "TENANT_UPDATED" }`. Captures the fields that
    // changed so a parent-dispute triage can reconstruct the before/after.
    this.logger.log(
      `AUDIT ${JSON.stringify({
        audit: {
          action: 'TENANT_UPDATED',
          actor: context.userId,
          tenantId,
          fieldsChanged: Object.keys(updateDto),
          at: values[':updatedAt'],
        },
      })}`,
    );

    return this.toTenantResponse(updatedTenant);
  }

  /**
   * Get workspace settings (lazy-creates defaults if not found).
   *
   * When the workspace is locked, enriches the response with `lockHolders`
   * — the list of (school, active-year) pairs that are currently holding
   * the lock. Empty when unlocked (no extra DDB calls on the hot path).
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
      const archetype = tenant?.archetype;

      settings = createDefaultWorkspaceSettings(tenantId, orgName, context.userId, country, archetype);
      await this.dynamoDBClient.putItem(client, settings);
      this.logger.log(`Created default workspace settings for tenant: ${tenantId}`);
    }

    // Only resolve lockHolders when the workspace is actually locked — saves
    // two DDB round-trips per read on the majority path (tenants without an
    // active year).
    const lockHolders = settings.isLocked
      ? await this.queryWorkspaceLockHolders(tenantId, context)
      : [];

    return this.toWorkspaceSettingsResponse(settings, lockHolders);
  }

  /**
   * Query every (school, active-academic-year) pair for the tenant. Used to
   * answer "which year on which school is keeping the workspace locked?"
   * so a multi-school tenant admin can act decisively.
   *
   * Two DDB calls regardless of school count:
   *   1. all ACADEMIC_YEAR rows under tenantId filtered by status=active
   *   2. all SCHOOL rows under tenantId (for name enrichment)
   *
   * Best-effort — returns [] on any failure so a transient DDB hiccup does
   * not break the settings page. A stale empty list is a strictly better
   * UX than a 500.
   */
  private async queryWorkspaceLockHolders(
    tenantId: string,
    context: RequestContext,
  ): Promise<WorkspaceLockHolder[]> {
    try {
      const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

      const [yearsResult, schoolsResult] = await Promise.all([
        this.dynamoDBClient.query<AcademicYear>(
          client,
          tenantId,
          'SCHOOL#',
          'entityType = :et AND #s = :active',
          { ':et': 'ACADEMIC_YEAR', ':active': 'active' },
          { '#s': 'status' },
        ),
        this.dynamoDBClient.query<School>(
          client,
          tenantId,
          'SCHOOL#',
          'entityType = :et',
          { ':et': 'SCHOOL' },
        ),
      ]);

      const schoolNameById = new Map<string, string>();
      for (const school of schoolsResult.items) {
        schoolNameById.set(school.schoolId, school.name);
      }

      return yearsResult.items.map((year) => ({
        schoolId: year.schoolId,
        schoolName: schoolNameById.get(year.schoolId) ?? year.schoolId,
        yearId: year.yearId,
        yearName: year.name,
      }));
    } catch (err) {
      this.logger.warn(
        `Failed to resolve workspace lock holders for tenant ${tenantId}: ${(err as Error).message}. Returning empty list.`,
      );
      return [];
    }
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

    // Ensure settings exist (lazy-create). This also populates `lockHolders`
    // so the error payload can tell the admin which school+year is blocking.
    const current = await this.getWorkspaceSettings(tenantId, context);

    // Per-field governance check (Sprint B). Replaces the prior blanket
    // "if isLocked, throw 403" gate with a field-class-aware check so
    // display-only fields (locale, date format, number format) remain
    // editable even when data-integrity-critical fields (currency,
    // calendar system, timezone, week start) are locked.
    const violations: FieldLockViolation[] = classifyWorkspaceUpdate(
      updateDto as Record<string, unknown>,
      current.isLocked,
    );
    if (violations.length > 0) {
      // Enrich with lockHolders when the blocker is academic-year state so
      // the client can render "blocked by <year> on <school>" verbatim.
      const enrichedViolations = violations.map((v) =>
        v.class === 'locked_during_active_year' && current.lockHolders?.length
          ? {
              ...v,
              heldBy: current.lockHolders,
            }
          : v,
      );
      this.logger.warn(
        `AUDIT ${JSON.stringify({
          audit: {
            action: 'WORKSPACE_SETTINGS_PATCH_BLOCKED',
            actor: context.userId,
            tenantId,
            violations: violations.map((v) => ({ field: v.field, class: v.class })),
          },
        })}`,
      );
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Field lock violation',
        violations: enrichedViolations,
      });
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

    // A-WS2.T1: emit WorkspaceSettingsUpdated so subscribers (analytics
    // aggregator, finance, future consumers) can invalidate their caches.
    // publishEvent() is non-blocking + swallows errors — a failed emit
    // never fails the PATCH (cardinal rule).
    const changedSections: Array<'regional' | 'branding' | 'policies'> = [];
    if (updateDto.regional) changedSections.push('regional');
    if (updateDto.branding) changedSections.push('branding');
    if (updateDto.policies) changedSections.push('policies');
    void this.identityEvents.publishWorkspaceSettingsUpdated(tenantId, changedSections);

    // Carry lockHolders forward unchanged — a PATCH that succeeds cannot
    // have altered active-year state (that happens via academic-years).
    return this.toWorkspaceSettingsResponse(updated, current.lockHolders ?? []);
  }

  private toWorkspaceSettingsResponse(
    settings: WorkspaceSettings,
    lockHolders: WorkspaceLockHolder[] = [],
  ): WorkspaceSettingsResponseDto {
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
      lockHolders,
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
      country: tenant.country,
      archetype: tenant.archetype,
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

