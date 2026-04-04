/**
 * Education Organizations Service - Identity Service
 *
 * CRUD operations for SEA, LEA, ESC entities and hierarchy assembly.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import {
  StateEducationAgency,
  createSEAEntity,
} from '../common/entities/state-education-agency.entity';
import {
  LocalEducationAgency,
  createLEAEntity,
} from '../common/entities/local-education-agency.entity';
import {
  EducationServiceCenter,
  createESCEntity,
} from '../common/entities/education-service-center.entity';
import {
  EducationOrgNetwork,
  createNetworkEntity,
} from '../common/entities/education-org-network.entity';
import {
  NetworkAssociation,
  createNetworkAssociationEntity,
} from '../common/entities/network-association.entity';
import { School } from '../common/entities/school.entity';
import type {
  CreateStateEducationAgencyDto,
  SeaResponseDto,
  CreateLocalEducationAgencyDto,
  UpdateLocalEducationAgencyDto,
  LeaResponseDto,
  LeaFilterDto,
  CreateEducationServiceCenterDto,
  UpdateEducationServiceCenterDto,
  EscResponseDto,
  EscFilterDto,
  CreateEducationOrgNetworkDto,
  UpdateEducationOrgNetworkDto,
  NetworkResponseDto,
  NetworkFilterDto,
  CreateNetworkAssociationDto,
  UpdateNetworkAssociationDto,
  NetworkAssociationResponseDto,
  OrganizationHierarchyResponseDto,
  HierarchyNode,
} from '@aibrains/shared-types';

@Injectable()
export class EducationOrganizationsService {
  private readonly logger = new Logger(EducationOrganizationsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: IdentityEventsService,
  ) {}

  // ============================================
  // SEA Operations (singleton per tenant)
  // ============================================

  async getSEA(context: RequestContext): Promise<SeaResponseDto | null> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<StateEducationAgency>(
      client,
      context.tenantId,
      'SEA#',
      'entityType = :entityType',
      { ':entityType': 'STATE_EDUCATION_AGENCY' },
    );

    if (result.items.length === 0) {
      return null;
    }

    return this.toSeaResponse(result.items[0]);
  }

  async createOrUpdateSEA(
    dto: CreateStateEducationAgencyDto,
    context: RequestContext,
  ): Promise<SeaResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();

    // Check if SEA already exists
    const existing = await this.dynamoDBClient.query<StateEducationAgency>(
      client,
      context.tenantId,
      'SEA#',
      'entityType = :entityType',
      { ':entityType': 'STATE_EDUCATION_AGENCY' },
    );

    if (existing.items.length > 0) {
      // Update existing SEA
      const sea = existing.items[0];
      const updates: string[] = [];
      const values: Record<string, any> = {};
      const names: Record<string, string> = {};

      const fields = [
        'nameOfInstitution', 'shortNameOfInstitution', 'webSite',
        'operationalStatusDescriptor', 'categories', 'addresses',
        'identificationCodes', 'telephones', 'accountabilityRatings',
      ];

      for (const field of fields) {
        const value = (dto as any)[field];
        if (value !== undefined) {
          updates.push(`#${field} = :${field}`);
          values[`:${field}`] = value;
          names[`#${field}`] = field;
        }
      }

      updates.push('#updatedAt = :updatedAt', '#updatedBy = :updatedBy', '#version = #version + :inc');
      values[':updatedAt'] = now;
      values[':updatedBy'] = context.userId;
      values[':inc'] = 1;
      names['#updatedAt'] = 'updatedAt';
      names['#updatedBy'] = 'updatedBy';
      names['#version'] = 'version';

      const updated = await this.dynamoDBClient.updateItem<StateEducationAgency>(
        client,
        context.tenantId,
        sea.entityKey,
        `SET ${updates.join(', ')}`,
        values,
        undefined,
        names,
      );

      this.logger.log(`SEA updated for tenant ${context.tenantId}`);
      this.eventsService.publishSEAUpdated(context.tenantId, sea.id, Object.keys(dto))
        .catch(err => this.logger.error('Failed to publish SEAUpdated event', err));
      return this.toSeaResponse(updated);
    }

    // Create new SEA
    const seaId = uuid();
    const sea = createSEAEntity(context.tenantId, seaId, {
      stateEducationAgencyId: dto.stateEducationAgencyId,
      nameOfInstitution: dto.nameOfInstitution,
      shortNameOfInstitution: dto.shortNameOfInstitution,
      webSite: dto.webSite,
      operationalStatusDescriptor: dto.operationalStatusDescriptor || 'Active',
      categories: dto.categories,
      addresses: dto.addresses,
      identificationCodes: dto.identificationCodes,
      telephones: dto.telephones,
      accountabilityRatings: dto.accountabilityRatings,
      createdAt: now,
      createdBy: context.userId,
      updatedAt: now,
      updatedBy: context.userId,
      version: 1,
    });

    await this.dynamoDBClient.putItem(client, sea);
    this.logger.log(`SEA created: ${sea.nameOfInstitution} (${seaId})`);
    this.eventsService.publishSEACreated(context.tenantId, seaId, dto.nameOfInstitution)
      .catch(err => this.logger.error('Failed to publish SEACreated event', err));

    return this.toSeaResponse(sea);
  }

  // ============================================
  // LEA Operations
  // ============================================

  async listLEAs(
    filter: LeaFilterDto,
    context: RequestContext,
  ): Promise<PaginatedResult<LeaResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<LocalEducationAgency>(
      client,
      context.tenantId,
      'LEA#',
      'entityType = :entityType',
      { ':entityType': 'LOCAL_EDUCATION_AGENCY' },
      undefined,
      filter.limit || 20,
    );

    let items = result.items;

    // In-memory filters
    if (filter.seaId) {
      items = items.filter(l => l.stateEducationAgencyId === filter.seaId);
    }
    if (filter.escId) {
      items = items.filter(l => l.educationServiceCenterId === filter.escId);
    }
    if (filter.operationalStatus) {
      items = items.filter(l => l.operationalStatusDescriptor === filter.operationalStatus);
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      items = items.filter(l => l.nameOfInstitution.toLowerCase().includes(searchLower));
    }

    return {
      items: items.map(l => this.toLeaResponse(l)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async getLEA(leaId: string, context: RequestContext): Promise<LeaResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const lea = await this.dynamoDBClient.getItem<LocalEducationAgency>(
      client,
      context.tenantId,
      EntityKeyBuilder.lea(leaId),
    );

    if (!lea) {
      throw new NotFoundException('Local Education Agency not found');
    }

    return this.toLeaResponse(lea);
  }

  async createLEA(
    dto: CreateLocalEducationAgencyDto,
    context: RequestContext,
  ): Promise<LeaResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Validate parent references
    if (dto.stateEducationAgencyId) {
      await this.validateEntityExists(client, context.tenantId, EntityKeyBuilder.sea(dto.stateEducationAgencyId), 'SEA');
    }
    if (dto.educationServiceCenterId) {
      await this.validateEntityExists(client, context.tenantId, EntityKeyBuilder.esc(dto.educationServiceCenterId), 'ESC');
    }
    if (dto.parentLocalEducationAgencyId) {
      await this.validateEntityExists(client, context.tenantId, EntityKeyBuilder.lea(dto.parentLocalEducationAgencyId), 'Parent LEA');
    }

    const now = new Date().toISOString();
    const leaId = uuid();

    const lea = createLEAEntity(context.tenantId, leaId, {
      localEducationAgencyId: dto.localEducationAgencyId,
      nameOfInstitution: dto.nameOfInstitution,
      shortNameOfInstitution: dto.shortNameOfInstitution,
      webSite: dto.webSite,
      leaCategoryDescriptor: dto.leaCategoryDescriptor,
      charterStatusDescriptor: dto.charterStatusDescriptor,
      operationalStatusDescriptor: dto.operationalStatusDescriptor || 'Active',
      stateEducationAgencyId: dto.stateEducationAgencyId,
      educationServiceCenterId: dto.educationServiceCenterId,
      parentLocalEducationAgencyId: dto.parentLocalEducationAgencyId,
      categories: dto.categories,
      addresses: dto.addresses,
      identificationCodes: dto.identificationCodes,
      telephones: dto.telephones,
      accountabilityRatings: dto.accountabilityRatings,
      createdAt: now,
      createdBy: context.userId,
      updatedAt: now,
      updatedBy: context.userId,
      version: 1,
    });

    await this.dynamoDBClient.putItem(client, lea);
    this.logger.log(`LEA created: ${lea.nameOfInstitution} (${leaId})`);
    this.eventsService.publishLEACreated(context.tenantId, leaId, dto.nameOfInstitution, dto.leaCategoryDescriptor)
      .catch(err => this.logger.error('Failed to publish LEACreated event', err));

    return this.toLeaResponse(lea);
  }

  async updateLEA(
    leaId: string,
    dto: UpdateLocalEducationAgencyDto,
    context: RequestContext,
  ): Promise<LeaResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const lea = await this.dynamoDBClient.getItem<LocalEducationAgency>(
      client,
      context.tenantId,
      EntityKeyBuilder.lea(leaId),
    );

    if (!lea) {
      throw new NotFoundException('Local Education Agency not found');
    }

    // Validate updated references
    if (dto.stateEducationAgencyId) {
      await this.validateEntityExists(client, context.tenantId, EntityKeyBuilder.sea(dto.stateEducationAgencyId), 'SEA');
    }
    if (dto.educationServiceCenterId) {
      await this.validateEntityExists(client, context.tenantId, EntityKeyBuilder.esc(dto.educationServiceCenterId), 'ESC');
    }
    if (dto.parentLocalEducationAgencyId) {
      if (dto.parentLocalEducationAgencyId === leaId) {
        throw new BadRequestException('LEA cannot be its own parent');
      }
      await this.validateEntityExists(client, context.tenantId, EntityKeyBuilder.lea(dto.parentLocalEducationAgencyId), 'Parent LEA');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    const fields = [
      'nameOfInstitution', 'shortNameOfInstitution', 'webSite',
      'leaCategoryDescriptor', 'charterStatusDescriptor', 'operationalStatusDescriptor',
      'stateEducationAgencyId', 'educationServiceCenterId', 'parentLocalEducationAgencyId',
      'categories', 'addresses', 'identificationCodes', 'telephones', 'accountabilityRatings',
    ];

    for (const field of fields) {
      const value = (dto as any)[field];
      if (value !== undefined) {
        updates.push(`#${field} = :${field}`);
        values[`:${field}`] = value;
        names[`#${field}`] = field;
      }
    }

    if (updates.length === 0) {
      return this.toLeaResponse(lea);
    }

    // Update GSI1 if SEA reference changed
    const newSeaId = dto.stateEducationAgencyId ?? lea.stateEducationAgencyId;
    if (newSeaId) {
      updates.push('#gsi1pk = :gsi1pk', '#gsi1sk = :gsi1sk');
      values[':gsi1pk'] = GSIKeyBuilder.seaChildren(context.tenantId, newSeaId);
      values[':gsi1sk'] = EntityKeyBuilder.lea(leaId);
      names['#gsi1pk'] = 'gsi1pk';
      names['#gsi1sk'] = 'gsi1sk';
    }

    updates.push('#updatedAt = :updatedAt', '#updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#updatedAt'] = 'updatedAt';
    names['#updatedBy'] = 'updatedBy';
    names['#version'] = 'version';

    const updated = await this.dynamoDBClient.updateItem<LocalEducationAgency>(
      client,
      context.tenantId,
      EntityKeyBuilder.lea(leaId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names,
    );

    this.logger.log(`LEA updated: ${leaId}`);
    this.eventsService.publishLEAUpdated(context.tenantId, leaId, Object.keys(dto))
      .catch(err => this.logger.error('Failed to publish LEAUpdated event', err));
    return this.toLeaResponse(updated);
  }

  async deleteLEA(leaId: string, context: RequestContext): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const lea = await this.dynamoDBClient.getItem<LocalEducationAgency>(
      client,
      context.tenantId,
      EntityKeyBuilder.lea(leaId),
    );

    if (!lea) {
      throw new NotFoundException('Local Education Agency not found');
    }

    // Soft delete — set status to Inactive
    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.lea(leaId),
      'SET #status = :status, #updatedAt = :updatedAt, #updatedBy = :updatedBy',
      {
        ':status': 'Inactive',
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      },
      undefined,
      {
        '#status': 'operationalStatusDescriptor',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
      },
    );

    this.logger.log(`LEA soft-deleted: ${leaId}`);
    this.eventsService.publishLEADeleted(context.tenantId, leaId)
      .catch(err => this.logger.error('Failed to publish LEADeleted event', err));
  }

  // ============================================
  // ESC Operations
  // ============================================

  async listESCs(
    filter: EscFilterDto,
    context: RequestContext,
  ): Promise<PaginatedResult<EscResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<EducationServiceCenter>(
      client,
      context.tenantId,
      'ESC#',
      'entityType = :entityType',
      { ':entityType': 'EDUCATION_SERVICE_CENTER' },
      undefined,
      filter.limit || 20,
    );

    let items = result.items;

    if (filter.seaId) {
      items = items.filter(e => e.stateEducationAgencyId === filter.seaId);
    }
    if (filter.operationalStatus) {
      items = items.filter(e => e.operationalStatusDescriptor === filter.operationalStatus);
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      items = items.filter(e => e.nameOfInstitution.toLowerCase().includes(searchLower));
    }

    return {
      items: items.map(e => this.toEscResponse(e)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async getESC(escId: string, context: RequestContext): Promise<EscResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const esc = await this.dynamoDBClient.getItem<EducationServiceCenter>(
      client,
      context.tenantId,
      EntityKeyBuilder.esc(escId),
    );

    if (!esc) {
      throw new NotFoundException('Education Service Center not found');
    }

    return this.toEscResponse(esc);
  }

  async createESC(
    dto: CreateEducationServiceCenterDto,
    context: RequestContext,
  ): Promise<EscResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    if (dto.stateEducationAgencyId) {
      await this.validateEntityExists(client, context.tenantId, EntityKeyBuilder.sea(dto.stateEducationAgencyId), 'SEA');
    }

    const now = new Date().toISOString();
    const escId = uuid();

    const esc = createESCEntity(context.tenantId, escId, {
      educationServiceCenterId: dto.educationServiceCenterId,
      nameOfInstitution: dto.nameOfInstitution,
      shortNameOfInstitution: dto.shortNameOfInstitution,
      webSite: dto.webSite,
      operationalStatusDescriptor: dto.operationalStatusDescriptor || 'Active',
      stateEducationAgencyId: dto.stateEducationAgencyId,
      categories: dto.categories,
      addresses: dto.addresses,
      identificationCodes: dto.identificationCodes,
      telephones: dto.telephones,
      accountabilityRatings: dto.accountabilityRatings,
      createdAt: now,
      createdBy: context.userId,
      updatedAt: now,
      updatedBy: context.userId,
      version: 1,
    });

    await this.dynamoDBClient.putItem(client, esc);
    this.logger.log(`ESC created: ${esc.nameOfInstitution} (${escId})`);
    this.eventsService.publishESCCreated(context.tenantId, escId, dto.nameOfInstitution)
      .catch(err => this.logger.error('Failed to publish ESCCreated event', err));

    return this.toEscResponse(esc);
  }

  async updateESC(
    escId: string,
    dto: UpdateEducationServiceCenterDto,
    context: RequestContext,
  ): Promise<EscResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const esc = await this.dynamoDBClient.getItem<EducationServiceCenter>(
      client,
      context.tenantId,
      EntityKeyBuilder.esc(escId),
    );

    if (!esc) {
      throw new NotFoundException('Education Service Center not found');
    }

    if (dto.stateEducationAgencyId) {
      await this.validateEntityExists(client, context.tenantId, EntityKeyBuilder.sea(dto.stateEducationAgencyId), 'SEA');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    const fields = [
      'nameOfInstitution', 'shortNameOfInstitution', 'webSite',
      'operationalStatusDescriptor', 'stateEducationAgencyId',
      'categories', 'addresses', 'identificationCodes', 'telephones', 'accountabilityRatings',
    ];

    for (const field of fields) {
      const value = (dto as any)[field];
      if (value !== undefined) {
        updates.push(`#${field} = :${field}`);
        values[`:${field}`] = value;
        names[`#${field}`] = field;
      }
    }

    if (updates.length === 0) {
      return this.toEscResponse(esc);
    }

    const newSeaId = dto.stateEducationAgencyId ?? esc.stateEducationAgencyId;
    if (newSeaId) {
      updates.push('#gsi1pk = :gsi1pk', '#gsi1sk = :gsi1sk');
      values[':gsi1pk'] = GSIKeyBuilder.seaChildren(context.tenantId, newSeaId);
      values[':gsi1sk'] = EntityKeyBuilder.esc(escId);
      names['#gsi1pk'] = 'gsi1pk';
      names['#gsi1sk'] = 'gsi1sk';
    }

    updates.push('#updatedAt = :updatedAt', '#updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#updatedAt'] = 'updatedAt';
    names['#updatedBy'] = 'updatedBy';
    names['#version'] = 'version';

    const updated = await this.dynamoDBClient.updateItem<EducationServiceCenter>(
      client,
      context.tenantId,
      EntityKeyBuilder.esc(escId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names,
    );

    this.logger.log(`ESC updated: ${escId}`);
    this.eventsService.publishESCUpdated(context.tenantId, escId, Object.keys(dto))
      .catch(err => this.logger.error('Failed to publish ESCUpdated event', err));
    return this.toEscResponse(updated);
  }

  async deleteESC(escId: string, context: RequestContext): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const esc = await this.dynamoDBClient.getItem<EducationServiceCenter>(
      client,
      context.tenantId,
      EntityKeyBuilder.esc(escId),
    );

    if (!esc) {
      throw new NotFoundException('Education Service Center not found');
    }

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.esc(escId),
      'SET #status = :status, #updatedAt = :updatedAt, #updatedBy = :updatedBy',
      {
        ':status': 'Inactive',
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      },
      undefined,
      {
        '#status': 'operationalStatusDescriptor',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
      },
    );

    this.logger.log(`ESC soft-deleted: ${escId}`);
    this.eventsService.publishESCDeleted(context.tenantId, escId)
      .catch(err => this.logger.error('Failed to publish ESCDeleted event', err));
  }

  // ============================================
  // Network Operations
  // ============================================

  async listNetworks(
    filter: NetworkFilterDto,
    context: RequestContext,
  ): Promise<PaginatedResult<NetworkResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<EducationOrgNetwork>(
      client,
      context.tenantId,
      'NETWORK#',
      'entityType = :entityType',
      { ':entityType': 'EDUCATION_ORG_NETWORK' },
      undefined,
      filter.limit || 20,
    );

    let items = result.items;

    if (filter.networkPurpose) {
      items = items.filter(n => n.networkPurposeDescriptor === filter.networkPurpose);
    }
    if (filter.operationalStatus) {
      items = items.filter(n => n.operationalStatusDescriptor === filter.operationalStatus);
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      items = items.filter(n => n.nameOfInstitution.toLowerCase().includes(searchLower));
    }

    return {
      items: items.map(n => this.toNetworkResponse(n)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async getNetwork(networkId: string, context: RequestContext): Promise<NetworkResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const network = await this.dynamoDBClient.getItem<EducationOrgNetwork>(
      client,
      context.tenantId,
      EntityKeyBuilder.network(networkId),
    );

    if (!network) {
      throw new NotFoundException('Education Organization Network not found');
    }

    return this.toNetworkResponse(network);
  }

  async createNetwork(
    dto: CreateEducationOrgNetworkDto,
    context: RequestContext,
  ): Promise<NetworkResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();
    const networkId = uuid();

    const network = createNetworkEntity(context.tenantId, networkId, {
      educationOrganizationNetworkId: dto.educationOrganizationNetworkId,
      nameOfInstitution: dto.nameOfInstitution,
      shortNameOfInstitution: dto.shortNameOfInstitution,
      webSite: dto.webSite,
      networkPurposeDescriptor: dto.networkPurposeDescriptor,
      operationalStatusDescriptor: dto.operationalStatusDescriptor || 'Active',
      categories: dto.categories,
      addresses: dto.addresses,
      identificationCodes: dto.identificationCodes,
      telephones: dto.telephones,
      createdAt: now,
      createdBy: context.userId,
      updatedAt: now,
      updatedBy: context.userId,
      version: 1,
    });

    await this.dynamoDBClient.putItem(client, network);
    this.logger.log(`Network created: ${network.nameOfInstitution} (${networkId})`);
    this.eventsService.publishNetworkCreated(context.tenantId, networkId, dto.nameOfInstitution, dto.networkPurposeDescriptor)
      .catch(err => this.logger.error('Failed to publish NetworkCreated event', err));

    return this.toNetworkResponse(network);
  }

  async updateNetwork(
    networkId: string,
    dto: UpdateEducationOrgNetworkDto,
    context: RequestContext,
  ): Promise<NetworkResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const network = await this.dynamoDBClient.getItem<EducationOrgNetwork>(
      client,
      context.tenantId,
      EntityKeyBuilder.network(networkId),
    );

    if (!network) {
      throw new NotFoundException('Education Organization Network not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    const fields = [
      'nameOfInstitution', 'shortNameOfInstitution', 'webSite',
      'networkPurposeDescriptor', 'operationalStatusDescriptor',
      'categories', 'addresses', 'identificationCodes', 'telephones',
    ];

    for (const field of fields) {
      const value = (dto as any)[field];
      if (value !== undefined) {
        updates.push(`#${field} = :${field}`);
        values[`:${field}`] = value;
        names[`#${field}`] = field;
      }
    }

    if (updates.length === 0) {
      return this.toNetworkResponse(network);
    }

    updates.push('#updatedAt = :updatedAt', '#updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#updatedAt'] = 'updatedAt';
    names['#updatedBy'] = 'updatedBy';
    names['#version'] = 'version';

    const updated = await this.dynamoDBClient.updateItem<EducationOrgNetwork>(
      client,
      context.tenantId,
      EntityKeyBuilder.network(networkId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names,
    );

    this.logger.log(`Network updated: ${networkId}`);
    this.eventsService.publishNetworkUpdated(context.tenantId, networkId, Object.keys(dto))
      .catch(err => this.logger.error('Failed to publish NetworkUpdated event', err));
    return this.toNetworkResponse(updated);
  }

  async deleteNetwork(networkId: string, context: RequestContext): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const network = await this.dynamoDBClient.getItem<EducationOrgNetwork>(
      client,
      context.tenantId,
      EntityKeyBuilder.network(networkId),
    );

    if (!network) {
      throw new NotFoundException('Education Organization Network not found');
    }

    await this.dynamoDBClient.updateItem(
      client,
      context.tenantId,
      EntityKeyBuilder.network(networkId),
      'SET #status = :status, #updatedAt = :updatedAt, #updatedBy = :updatedBy',
      {
        ':status': 'Inactive',
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      },
      undefined,
      {
        '#status': 'operationalStatusDescriptor',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
      },
    );

    this.logger.log(`Network soft-deleted: ${networkId}`);
    this.eventsService.publishNetworkDeleted(context.tenantId, networkId)
      .catch(err => this.logger.error('Failed to publish NetworkDeleted event', err));
  }

  // ============================================
  // Network Association (Membership) Operations
  // ============================================

  async listNetworkMembers(
    networkId: string,
    context: RequestContext,
  ): Promise<PaginatedResult<NetworkAssociationResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Validate network exists
    await this.validateEntityExists(client, context.tenantId, EntityKeyBuilder.network(networkId), 'Network');

    const result = await this.dynamoDBClient.query<NetworkAssociation>(
      client,
      context.tenantId,
      `NETWORK#${networkId}#MEMBER#`,
      'entityType = :entityType',
      { ':entityType': 'NETWORK_ASSOCIATION' },
    );

    return {
      items: result.items.map(a => this.toNetworkAssociationResponse(a)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async addNetworkMember(
    networkId: string,
    dto: CreateNetworkAssociationDto,
    context: RequestContext,
  ): Promise<NetworkAssociationResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Validate network exists
    await this.validateEntityExists(client, context.tenantId, EntityKeyBuilder.network(networkId), 'Network');

    // Resolve member name by looking up the referenced org
    const memberName = await this.resolveOrgName(client, context.tenantId, dto.memberEducationOrganizationId, dto.memberType);

    const now = new Date().toISOString();
    const associationId = uuid();

    const association = createNetworkAssociationEntity(context.tenantId, associationId, {
      networkId,
      memberEducationOrganizationId: dto.memberEducationOrganizationId,
      memberType: dto.memberType,
      memberName,
      beginDate: dto.beginDate,
      endDate: dto.endDate,
      createdAt: now,
      createdBy: context.userId,
      updatedAt: now,
      updatedBy: context.userId,
      version: 1,
    });

    await this.dynamoDBClient.putItem(client, association);
    this.logger.log(`Network member added: ${dto.memberEducationOrganizationId} → network ${networkId}`);

    return this.toNetworkAssociationResponse(association);
  }

  async updateNetworkMember(
    networkId: string,
    memberId: string,
    dto: UpdateNetworkAssociationDto,
    context: RequestContext,
  ): Promise<NetworkAssociationResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Find the association by querying network members
    const result = await this.dynamoDBClient.query<NetworkAssociation>(
      client,
      context.tenantId,
      `NETWORK#${networkId}#MEMBER#`,
      'entityType = :entityType',
      { ':entityType': 'NETWORK_ASSOCIATION' },
    );

    const association = result.items.find(a => a.id === memberId);
    if (!association) {
      throw new NotFoundException('Network membership not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    if (dto.endDate !== undefined) {
      updates.push('#endDate = :endDate');
      values[':endDate'] = dto.endDate;
      names['#endDate'] = 'endDate';
    }

    if (updates.length === 0) {
      return this.toNetworkAssociationResponse(association);
    }

    updates.push('#updatedAt = :updatedAt', '#updatedBy = :updatedBy');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    names['#updatedAt'] = 'updatedAt';
    names['#updatedBy'] = 'updatedBy';

    const updated = await this.dynamoDBClient.updateItem<NetworkAssociation>(
      client,
      context.tenantId,
      association.entityKey,
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names,
    );

    this.logger.log(`Network member updated: ${memberId} in network ${networkId}`);
    return this.toNetworkAssociationResponse(updated);
  }

  async removeNetworkMember(
    networkId: string,
    memberId: string,
    context: RequestContext,
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Find the association
    const result = await this.dynamoDBClient.query<NetworkAssociation>(
      client,
      context.tenantId,
      `NETWORK#${networkId}#MEMBER#`,
      'entityType = :entityType',
      { ':entityType': 'NETWORK_ASSOCIATION' },
    );

    const association = result.items.find(a => a.id === memberId);
    if (!association) {
      throw new NotFoundException('Network membership not found');
    }

    await this.dynamoDBClient.deleteItem(client, context.tenantId, association.entityKey);
    this.logger.log(`Network member removed: ${memberId} from network ${networkId}`);
  }

  private async resolveOrgName(
    client: any,
    tenantId: string,
    orgId: string,
    orgType: string,
  ): Promise<string> {
    let entityKey: string;
    switch (orgType) {
      case 'stateEducationAgency':
        entityKey = EntityKeyBuilder.sea(orgId);
        break;
      case 'localEducationAgency':
        entityKey = EntityKeyBuilder.lea(orgId);
        break;
      case 'educationServiceCenter':
        entityKey = EntityKeyBuilder.esc(orgId);
        break;
      case 'school':
        entityKey = `SCHOOL#${orgId}`;
        break;
      default:
        return 'Unknown Organization';
    }

    const entity = await this.dynamoDBClient.getItem<any>(client, tenantId, entityKey);
    if (!entity) {
      throw new BadRequestException(`Referenced organization not found: ${orgId}`);
    }
    return entity.nameOfInstitution || entity.name || 'Unknown';
  }

  // ============================================
  // Hierarchy Assembly
  // ============================================

  async getHierarchy(context: RequestContext): Promise<OrganizationHierarchyResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Query all EdOrg entities for tenant in parallel
    const [seaResult, leaResult, escResult, schoolResult] = await Promise.all([
      this.dynamoDBClient.query<StateEducationAgency>(
        client, context.tenantId, 'SEA#',
        'entityType = :entityType', { ':entityType': 'STATE_EDUCATION_AGENCY' },
      ),
      this.dynamoDBClient.query<LocalEducationAgency>(
        client, context.tenantId, 'LEA#',
        'entityType = :entityType', { ':entityType': 'LOCAL_EDUCATION_AGENCY' },
      ),
      this.dynamoDBClient.query<EducationServiceCenter>(
        client, context.tenantId, 'ESC#',
        'entityType = :entityType', { ':entityType': 'EDUCATION_SERVICE_CENTER' },
      ),
      this.dynamoDBClient.query<School>(
        client, context.tenantId, 'SCHOOL#',
        'entityType = :entityType', { ':entityType': 'SCHOOL' },
      ),
    ]);

    const sea = seaResult.items[0] || null;
    const leas = leaResult.items;
    const escs = escResult.items;
    const schools = schoolResult.items;

    // Build school nodes grouped by LEA
    const schoolsByLea = new Map<string, HierarchyNode[]>();
    const unassignedSchools: HierarchyNode[] = [];

    for (const school of schools) {
      const node: HierarchyNode = {
        id: school.schoolId,
        name: school.name,
        type: 'school',
        status: (school.status ? school.status.charAt(0).toUpperCase() + school.status.slice(1) : 'Inactive') as HierarchyNode['status'],
        children: [],
        studentCount: school.studentCount,
        staffCount: school.staffCount,
      };

      const leaId = (school as any).localEducationAgencyId;
      if (leaId) {
        const existing = schoolsByLea.get(leaId) || [];
        existing.push(node);
        schoolsByLea.set(leaId, existing);
      } else {
        unassignedSchools.push(node);
      }
    }

    // Build LEA nodes with children (schools)
    const leaNodes: HierarchyNode[] = leas.map(lea => ({
      id: lea.id,
      name: lea.nameOfInstitution,
      type: 'localEducationAgency' as const,
      edfiId: lea.localEducationAgencyId,
      status: lea.operationalStatusDescriptor as any,
      children: schoolsByLea.get(lea.id) || [],
      schoolCount: (schoolsByLea.get(lea.id) || []).length,
    }));

    // Build ESC nodes
    const escNodes: HierarchyNode[] = escs.map(esc => ({
      id: esc.id,
      name: esc.nameOfInstitution,
      type: 'educationServiceCenter' as const,
      edfiId: esc.educationServiceCenterId,
      status: esc.operationalStatusDescriptor as any,
      children: [],
    }));

    // Build SEA node with LEA children
    const seaNode: HierarchyNode | null = sea
      ? {
          id: sea.id,
          name: sea.nameOfInstitution,
          type: 'stateEducationAgency',
          edfiId: sea.stateEducationAgencyId,
          status: sea.operationalStatusDescriptor as any,
          children: leaNodes,
          schoolCount: schools.length,
        }
      : null;

    return {
      sea: seaNode,
      educationServiceCenters: escNodes,
      unassigned: unassignedSchools,
    };
  }

  // ============================================
  // Helpers
  // ============================================

  private async validateEntityExists(
    client: any,
    tenantId: string,
    entityKey: string,
    entityLabel: string,
  ): Promise<void> {
    const entity = await this.dynamoDBClient.getItem(client, tenantId, entityKey);
    if (!entity) {
      throw new BadRequestException(`Referenced ${entityLabel} not found`);
    }
  }

  private toSeaResponse(sea: StateEducationAgency): SeaResponseDto {
    return {
      id: sea.id,
      stateEducationAgencyId: sea.stateEducationAgencyId,
      tenantId: sea.tenantId,
      nameOfInstitution: sea.nameOfInstitution,
      shortNameOfInstitution: sea.shortNameOfInstitution,
      webSite: sea.webSite,
      operationalStatusDescriptor: sea.operationalStatusDescriptor as any,
      categories: sea.categories,
      addresses: sea.addresses as any,
      identificationCodes: sea.identificationCodes as any,
      telephones: sea.telephones as any,
      accountabilityRatings: sea.accountabilityRatings,
      createdAt: sea.createdAt,
      updatedAt: sea.updatedAt,
      createdBy: sea.createdBy,
      updatedBy: sea.updatedBy,
      version: sea.version,
    };
  }

  private toLeaResponse(lea: LocalEducationAgency): LeaResponseDto {
    return {
      id: lea.id,
      localEducationAgencyId: lea.localEducationAgencyId,
      tenantId: lea.tenantId,
      nameOfInstitution: lea.nameOfInstitution,
      shortNameOfInstitution: lea.shortNameOfInstitution,
      webSite: lea.webSite,
      leaCategoryDescriptor: lea.leaCategoryDescriptor as any,
      charterStatusDescriptor: lea.charterStatusDescriptor as any,
      operationalStatusDescriptor: lea.operationalStatusDescriptor as any,
      stateEducationAgencyId: lea.stateEducationAgencyId,
      educationServiceCenterId: lea.educationServiceCenterId,
      parentLocalEducationAgencyId: lea.parentLocalEducationAgencyId,
      categories: lea.categories,
      addresses: lea.addresses as any,
      identificationCodes: lea.identificationCodes as any,
      telephones: lea.telephones as any,
      accountabilityRatings: lea.accountabilityRatings,
      createdAt: lea.createdAt,
      updatedAt: lea.updatedAt,
      createdBy: lea.createdBy,
      updatedBy: lea.updatedBy,
      version: lea.version,
    };
  }

  private toEscResponse(esc: EducationServiceCenter): EscResponseDto {
    return {
      id: esc.id,
      educationServiceCenterId: esc.educationServiceCenterId,
      tenantId: esc.tenantId,
      nameOfInstitution: esc.nameOfInstitution,
      shortNameOfInstitution: esc.shortNameOfInstitution,
      webSite: esc.webSite,
      operationalStatusDescriptor: esc.operationalStatusDescriptor as any,
      stateEducationAgencyId: esc.stateEducationAgencyId,
      categories: esc.categories,
      addresses: esc.addresses as any,
      identificationCodes: esc.identificationCodes as any,
      telephones: esc.telephones as any,
      accountabilityRatings: esc.accountabilityRatings,
      createdAt: esc.createdAt,
      updatedAt: esc.updatedAt,
      createdBy: esc.createdBy,
      updatedBy: esc.updatedBy,
      version: esc.version,
    };
  }

  private toNetworkResponse(network: EducationOrgNetwork): NetworkResponseDto {
    return {
      id: network.id,
      educationOrganizationNetworkId: network.educationOrganizationNetworkId,
      tenantId: network.tenantId,
      nameOfInstitution: network.nameOfInstitution,
      shortNameOfInstitution: network.shortNameOfInstitution,
      webSite: network.webSite,
      networkPurposeDescriptor: network.networkPurposeDescriptor as any,
      operationalStatusDescriptor: network.operationalStatusDescriptor as any,
      categories: network.categories,
      addresses: network.addresses as any,
      identificationCodes: network.identificationCodes as any,
      telephones: network.telephones as any,
      createdAt: network.createdAt,
      updatedAt: network.updatedAt,
      createdBy: network.createdBy,
      updatedBy: network.updatedBy,
      version: network.version,
    };
  }

  private toNetworkAssociationResponse(assoc: NetworkAssociation): NetworkAssociationResponseDto {
    return {
      id: assoc.id,
      networkId: assoc.networkId,
      memberEducationOrganizationId: assoc.memberEducationOrganizationId,
      memberType: assoc.memberType as any,
      memberName: assoc.memberName,
      beginDate: assoc.beginDate,
      endDate: assoc.endDate,
      tenantId: assoc.tenantId,
      createdAt: assoc.createdAt,
      updatedAt: assoc.updatedAt,
    };
  }
}
