/**
 * Location Service - Location/Room CRUD
 *
 * Manages Ed-Fi Location entities (physical spaces within a school).
 * Includes duplicate room number validation within a school.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  Location,
  LocationKeyBuilder,
  createLocationEntity,
} from '../common/entities/location.entity';
import { RequestContext, PaginatedResult } from '../common/entities/base.entity';
import type { CreateLocationDto, UpdateLocationDto, LocationResponseDto } from '@aibrains/shared-types';

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * Create a new location
   */
  async createLocation(
    schoolId: string,
    createDto: CreateLocationDto,
    context: RequestContext
  ): Promise<LocationResponseDto> {
    const now = new Date().toISOString();
    const locationId = uuid();
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Check for duplicate room number within school
    await this.validateUniqueRoomNumber(schoolId, createDto.roomNumber, context);

    const entity = createLocationEntity(
      context.tenantId,
      schoolId,
      locationId,
      {
        roomNumber: createDto.roomNumber,
        buildingName: createDto.buildingName,
        floorNumber: createDto.floorNumber,
        capacity: createDto.capacity,
        locationType: createDto.locationType ?? 'classroom',
        isActive: createDto.isActive ?? true,
        description: createDto.description,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, entity);

    this.logger.log(`Location created: ${entity.roomNumber} (${locationId}) for school ${schoolId}`);

    return this.toResponse(entity);
  }

  /**
   * Get location by ID
   */
  async getLocation(
    schoolId: string,
    locationId: string,
    context: RequestContext
  ): Promise<LocationResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.dynamoDBClient.getItem<Location>(
      client,
      context.tenantId,
      LocationKeyBuilder.location(schoolId, locationId)
    );

    if (!entity) {
      throw new NotFoundException('Location not found');
    }

    return this.toResponse(entity);
  }

  /**
   * List locations for a school
   */
  async listLocations(
    schoolId: string,
    context: RequestContext
  ): Promise<PaginatedResult<LocationResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<Location>(
      client,
      context.tenantId,
      LocationKeyBuilder.locationsPrefix(schoolId),
      'entityType = :entityType',
      { ':entityType': 'LOCATION' },
      undefined,
      100
    );

    // Sort by room number for consistent ordering
    const sorted = result.items.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));

    return {
      items: sorted.map(l => this.toResponse(l)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update location
   */
  async updateLocation(
    schoolId: string,
    locationId: string,
    updateDto: UpdateLocationDto,
    context: RequestContext
  ): Promise<LocationResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.dynamoDBClient.getItem<Location>(
      client,
      context.tenantId,
      LocationKeyBuilder.location(schoolId, locationId)
    );

    if (!entity) {
      throw new NotFoundException('Location not found');
    }

    // If room number is changing, validate uniqueness
    if (updateDto.roomNumber && updateDto.roomNumber !== entity.roomNumber) {
      await this.validateUniqueRoomNumber(schoolId, updateDto.roomNumber, context, locationId);
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};

    if (updateDto.roomNumber) {
      updates.push('roomNumber = :roomNumber');
      values[':roomNumber'] = updateDto.roomNumber;
    }
    if (updateDto.buildingName !== undefined) {
      updates.push('buildingName = :buildingName');
      values[':buildingName'] = updateDto.buildingName;
    }
    if (updateDto.floorNumber !== undefined) {
      updates.push('floorNumber = :floorNumber');
      values[':floorNumber'] = updateDto.floorNumber;
    }
    if (updateDto.capacity !== undefined) {
      updates.push('capacity = :capacity');
      values[':capacity'] = updateDto.capacity;
    }
    if (updateDto.locationType) {
      updates.push('locationType = :locationType');
      values[':locationType'] = updateDto.locationType;
    }
    if (updateDto.isActive !== undefined) {
      updates.push('isActive = :isActive');
      values[':isActive'] = updateDto.isActive;
    }
    const names: Record<string, string> = {};

    if (updateDto.description !== undefined) {
      updates.push('#desc = :description');
      values[':description'] = updateDto.description;
      names['#desc'] = 'description';
    }

    if (updates.length === 0) {
      return this.toResponse(entity);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;

    const updated = await this.dynamoDBClient.updateItem<Location>(
      client,
      context.tenantId,
      LocationKeyBuilder.location(schoolId, locationId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      Object.keys(names).length > 0 ? names : undefined
    );

    this.logger.log(`Location updated: ${locationId}`);

    return this.toResponse(updated);
  }

  /**
   * Delete location
   */
  async deleteLocation(
    schoolId: string,
    locationId: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.dynamoDBClient.getItem<Location>(
      client,
      context.tenantId,
      LocationKeyBuilder.location(schoolId, locationId)
    );

    if (!entity) {
      throw new NotFoundException('Location not found');
    }

    await this.dynamoDBClient.deleteItem(
      client,
      context.tenantId,
      LocationKeyBuilder.location(schoolId, locationId)
    );

    this.logger.log(`Location deleted: ${locationId} from school ${schoolId}`);
  }

  // ============================================
  // Validation
  // ============================================

  private async validateUniqueRoomNumber(
    schoolId: string,
    roomNumber: string,
    context: RequestContext,
    excludeLocationId?: string
  ): Promise<void> {
    const existing = await this.listLocations(schoolId, context);

    for (const loc of existing.items) {
      if (excludeLocationId && loc.locationId === excludeLocationId) continue;
      if (loc.roomNumber === roomNumber) {
        throw new ConflictException(`Room number "${roomNumber}" already exists in this school`);
      }
    }
  }

  // ============================================
  // Response Mapper
  // ============================================

  private toResponse(entity: Location): LocationResponseDto {
    return {
      locationId: entity.locationId,
      schoolId: entity.schoolId,
      tenantId: entity.tenantId,
      roomNumber: entity.roomNumber,
      buildingName: entity.buildingName,
      floorNumber: entity.floorNumber,
      capacity: entity.capacity,
      locationType: entity.locationType as LocationResponseDto['locationType'],
      isActive: entity.isActive,
      description: entity.description,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
