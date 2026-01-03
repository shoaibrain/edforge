/**
 * Tenants Service - Tenant management for Identity Service
 */

import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { 
  Tenant,
} from '../common/entities/tenant.entity';
import { 
  EntityKeyBuilder, 
  GSIKeyBuilder,
  RequestContext,
} from '../common/entities/base.entity';
import {
  UpdateTenantDto,
  TenantResponseDto,
  TenantLookupResponseDto,
} from '../common/dto/tenant.dto';

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

