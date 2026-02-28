import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  GatewayConfigEntity,
  createGatewayConfigEntity,
} from '../common/entities/gateway-config.entity';
import { EntityKeyBuilder, GSIKeyBuilder, RequestContext } from '../common/entities/base.entity';
import type { PaymentGateway, PaymentGatewayPublicConfig, PaymentGatewayConfig, SaveGatewayConfigDto } from '@aibrains/shared-types';

@Injectable()
export class PaymentGatewaysService {
  private readonly logger = new Logger(PaymentGatewaysService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * List enabled gateways for a school (public — no credentials).
   * Used by parents/students to see available payment methods.
   */
  async listEnabled(
    schoolId: string,
    context: RequestContext,
  ): Promise<PaymentGatewayPublicConfig[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const result = await this.dynamoDBClient.queryGSI<GatewayConfigEntity>(
      client,
      'GSI1',
      gsi1pk,
      'GATEWAY_CONFIG',
      'begins_with',
      'isEnabled = :enabled',
      { ':enabled': true },
    );

    return result.items
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(this.toPublicConfig);
  }

  /**
   * List all gateway configs for a school (admin view).
   * Credentials are masked with '****' in the response.
   */
  async listAll(
    schoolId: string,
    context: RequestContext,
  ): Promise<PaymentGatewayConfig[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const result = await this.dynamoDBClient.queryGSI<GatewayConfigEntity>(
      client,
      'GSI1',
      gsi1pk,
      'GATEWAY_CONFIG',
      'begins_with',
    );

    return result.items
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(this.toAdminConfig);
  }

  /**
   * Save (upsert) a gateway configuration.
   * If the config already exists, it's updated; otherwise created.
   */
  async save(
    schoolId: string,
    gateway: PaymentGateway,
    dto: SaveGatewayConfigDto,
    context: RequestContext,
  ): Promise<PaymentGatewayConfig> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.gatewayConfig(schoolId, gateway);

    const existing = await this.dynamoDBClient.getItem<GatewayConfigEntity>(
      client,
      context.tenantId,
      entityKey,
    );

    if (existing) {
      // Update existing config
      const now = new Date().toISOString();
      const updated = await this.dynamoDBClient.updateItem<GatewayConfigEntity>(
        client,
        context.tenantId,
        entityKey,
        'SET isEnabled = :enabled, isTestMode = :testMode, displayName = :name, displayOrder = :order, credentials = :creds, updatedAt = :now, updatedBy = :userId, #v = #v + :one',
        {
          ':enabled': dto.isEnabled,
          ':testMode': dto.isTestMode,
          ':name': dto.displayName || existing.displayName,
          ':order': dto.displayOrder ?? existing.displayOrder,
          ':creds': dto.credentials,
          ':now': now,
          ':userId': context.userId,
          ':one': 1,
          ':currentVersion': existing.version,
        },
        '#v = :currentVersion',
        { '#v': 'version' },
      );

      return this.toAdminConfig(updated);
    }

    // Create new config
    const entity = createGatewayConfigEntity(
      context.tenantId,
      schoolId,
      gateway,
      {
        isEnabled: dto.isEnabled,
        isTestMode: dto.isTestMode,
        displayName: dto.displayName,
        displayOrder: dto.displayOrder,
        credentials: dto.credentials,
      },
      context.userId,
    );

    await this.dynamoDBClient.putItem(client, entity);
    return this.toAdminConfig(entity);
  }

  /**
   * Get a gateway config entity (internal — used by payment initiation).
   */
  async getEntity(
    schoolId: string,
    gateway: PaymentGateway,
    context: RequestContext,
  ): Promise<GatewayConfigEntity> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.gatewayConfig(schoolId, gateway);

    const entity = await this.dynamoDBClient.getItem<GatewayConfigEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!entity) throw new NotFoundException(`Gateway config for ${gateway} not found`);
    return entity;
  }

  private toPublicConfig(entity: GatewayConfigEntity): PaymentGatewayPublicConfig {
    return {
      id: entity.configId,
      schoolId: entity.schoolId,
      gateway: entity.gateway,
      isEnabled: entity.isEnabled,
      isTestMode: entity.isTestMode,
      displayName: entity.displayName,
      displayOrder: entity.displayOrder,
    };
  }

  private toAdminConfig(entity: GatewayConfigEntity): PaymentGatewayConfig {
    // Mask credential values — never expose raw secrets
    const maskedCredentials: Record<string, string> = {};
    for (const key of Object.keys(entity.credentials || {})) {
      maskedCredentials[key] = '****';
    }

    return {
      id: entity.configId,
      schoolId: entity.schoolId,
      gateway: entity.gateway,
      isEnabled: entity.isEnabled,
      isTestMode: entity.isTestMode,
      displayName: entity.displayName,
      displayOrder: entity.displayOrder,
      credentials: maskedCredentials,
    };
  }
}
