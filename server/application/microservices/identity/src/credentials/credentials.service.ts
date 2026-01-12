/**
 * Credentials Service - Identity Service
 * 
 * Manages staff credentials/certifications with Ed-Fi alignment.
 * Includes CRUD, verification workflow, and expiration tracking.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import {
  Credential,
  CredentialType,
  VerificationStatus,
  createCredentialEntity,
  CredentialKeyBuilder,
  isCredentialExpired,
  isCredentialExpiringSoon,
  daysUntilExpiration,
} from '../common/entities/credential.entity';
import {
  Staff,
  StaffKeyBuilder,
} from '../common/entities/staff.entity';
import {
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import type {
  CreateCredentialDto,
  UpdateCredentialDto,
  CredentialResponseDto,
  CredentialFilterDto,
  VerifyCredentialDto,
} from '@edforge/shared-types';

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: IdentityEventsService,
  ) {}

  // ============================================
  // Create Credential
  // ============================================

  async createCredential(
    staffId: string,
    createDto: CreateCredentialDto,
    context: RequestContext
  ): Promise<CredentialResponseDto> {
    const now = new Date().toISOString();
    const credentialId = uuid();

    // Verify staff exists
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const staff = await this.dynamoDBClient.getItem<Staff>(
      client,
      context.tenantId,
      StaffKeyBuilder.staff(staffId)
    );

    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }

    // Check for duplicate credential identifier
    await this.checkCredentialIdentifierNotExists(staffId, createDto.credentialIdentifier, context);

    const credential = createCredentialEntity(
      context.tenantId,
      staffId,
      credentialId,
      {
        credentialIdentifier: createDto.credentialIdentifier,
        credentialTypeDescriptor: createDto.credentialTypeDescriptor as CredentialType,
        credentialFieldDescriptor: createDto.credentialFieldDescriptor as any,
        issuanceDate: createDto.issuanceDate,
        expirationDate: createDto.expirationDate,
        issuingState: createDto.issuingState,
        issuingOrganization: createDto.issuingOrganization,
        gradeLevels: createDto.gradeLevels as any,
        subjects: createDto.subjects,
        name: createDto.name,
        description: createDto.description,
        documentUrl: createDto.documentUrl,
        documentFileName: createDto.documentFileName,
        verificationStatus: (createDto.verificationStatus || 'pending') as VerificationStatus,
        verificationNotes: createDto.verificationNotes,
        isRenewable: createDto.isRenewable ?? true,
        renewalReminderDays: createDto.renewalReminderDays ?? 90,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, credential);

    this.logger.log(`Credential created: ${createDto.name} for staff ${staffId}`);

    // Publish event (non-blocking)
    this.eventsService.publishEvent({
      eventType: 'CredentialCreated',
      timestamp: now,
      tenantId: context.tenantId,
      credentialId,
      staffId,
      credentialType: createDto.credentialTypeDescriptor,
      name: createDto.name,
    }).catch(err => this.logger.error('Failed to publish CredentialCreated event', err));

    return this.toCredentialResponse(credential);
  }

  // ============================================
  // Get Credential by ID
  // ============================================

  async getCredential(
    staffId: string,
    credentialId: string,
    context: RequestContext
  ): Promise<CredentialResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const credential = await this.dynamoDBClient.getItem<Credential>(
      client,
      context.tenantId,
      CredentialKeyBuilder.credential(staffId, credentialId)
    );

    if (!credential) {
      throw new NotFoundException('Credential not found');
    }

    return this.toCredentialResponse(credential);
  }

  // ============================================
  // List Credentials for Staff
  // ============================================

  async listCredentials(
    staffId: string,
    context: RequestContext,
    filter?: CredentialFilterDto
  ): Promise<PaginatedResult<CredentialResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const limit = filter?.limit || 20;

    const result = await this.dynamoDBClient.query<Credential>(
      client,
      context.tenantId,
      CredentialKeyBuilder.credentialsPrefix(staffId),
      'entityType = :entityType',
      { ':entityType': 'CREDENTIAL' },
      undefined,
      limit
    );

    // Apply filters in memory (for MVP)
    let filtered = result.items;

    if (filter?.credentialType) {
      filtered = filtered.filter(c => c.credentialTypeDescriptor === filter.credentialType);
    }

    if (filter?.verificationStatus) {
      filtered = filtered.filter(c => c.verificationStatus === filter.verificationStatus);
    }

    if (filter?.isExpired !== undefined) {
      filtered = filtered.filter(c => isCredentialExpired(c) === filter.isExpired);
    }

    if (filter?.isExpiringSoon !== undefined) {
      filtered = filtered.filter(c => isCredentialExpiringSoon(c) === filter.isExpiringSoon);
    }

    return {
      items: filtered.map(c => this.toCredentialResponse(c)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  // ============================================
  // Update Credential
  // ============================================

  async updateCredential(
    staffId: string,
    credentialId: string,
    updateDto: UpdateCredentialDto,
    context: RequestContext
  ): Promise<CredentialResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const credential = await this.dynamoDBClient.getItem<Credential>(
      client,
      context.tenantId,
      CredentialKeyBuilder.credential(staffId, credentialId)
    );

    if (!credential) {
      throw new NotFoundException('Credential not found');
    }

    // Build update expression
    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    const simpleFields = [
      'credentialTypeDescriptor', 'credentialFieldDescriptor', 'issuanceDate',
      'expirationDate', 'issuingState', 'issuingOrganization', 'name', 'description',
      'documentUrl', 'documentFileName', 'isRenewable', 'renewalReminderDays',
      'verificationNotes',
    ];

    for (const field of simpleFields) {
      const value = (updateDto as any)[field];
      if (value !== undefined) {
        updates.push(`${field} = :${field}`);
        values[`:${field}`] = value;
      }
    }

    if (updateDto.gradeLevels) {
      updates.push('gradeLevels = :gradeLevels');
      values[':gradeLevels'] = updateDto.gradeLevels;
    }

    if (updateDto.subjects) {
      updates.push('subjects = :subjects');
      values[':subjects'] = updateDto.subjects;
    }

    if (updateDto.verificationStatus) {
      updates.push('verificationStatus = :verificationStatus');
      values[':verificationStatus'] = updateDto.verificationStatus;
    }

    if (updates.length === 0) {
      return this.toCredentialResponse(credential);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#version'] = 'version';

    const updatedCredential = await this.dynamoDBClient.updateItem<Credential>(
      client,
      context.tenantId,
      CredentialKeyBuilder.credential(staffId, credentialId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names
    );

    this.logger.log(`Credential updated: ${credentialId}`);

    return this.toCredentialResponse(updatedCredential);
  }

  // ============================================
  // Verify Credential
  // ============================================

  async verifyCredential(
    staffId: string,
    credentialId: string,
    verifyDto: VerifyCredentialDto,
    context: RequestContext
  ): Promise<CredentialResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const credential = await this.dynamoDBClient.getItem<Credential>(
      client,
      context.tenantId,
      CredentialKeyBuilder.credential(staffId, credentialId)
    );

    if (!credential) {
      throw new NotFoundException('Credential not found');
    }

    const now = new Date().toISOString();

    const updatedCredential = await this.dynamoDBClient.updateItem<Credential>(
      client,
      context.tenantId,
      CredentialKeyBuilder.credential(staffId, credentialId),
      'SET verificationStatus = :verificationStatus, verificationNotes = :verificationNotes, verifiedBy = :verifiedBy, verifiedAt = :verifiedAt, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc',
      {
        ':verificationStatus': verifyDto.verificationStatus,
        ':verificationNotes': verifyDto.verificationNotes || null,
        ':verifiedBy': context.userId,
        ':verifiedAt': now,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
      },
      undefined,
      { '#version': 'version' }
    );

    this.logger.log(`Credential ${verifyDto.verificationStatus}: ${credentialId}`);

    // Publish event
    this.eventsService.publishEvent({
      eventType: 'CredentialVerified',
      timestamp: now,
      tenantId: context.tenantId,
      credentialId,
      staffId,
      verificationStatus: verifyDto.verificationStatus,
      verifiedBy: context.userId,
    }).catch(err => this.logger.error('Failed to publish CredentialVerified event', err));

    return this.toCredentialResponse(updatedCredential);
  }

  // ============================================
  // Delete Credential
  // ============================================

  async deleteCredential(
    staffId: string,
    credentialId: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const credential = await this.dynamoDBClient.getItem<Credential>(
      client,
      context.tenantId,
      CredentialKeyBuilder.credential(staffId, credentialId)
    );

    if (!credential) {
      throw new NotFoundException('Credential not found');
    }

    await this.dynamoDBClient.deleteItem(
      client,
      context.tenantId,
      CredentialKeyBuilder.credential(staffId, credentialId)
    );

    this.logger.log(`Credential deleted: ${credentialId}`);
  }

  // ============================================
  // Get Expiring Credentials
  // ============================================

  async getExpiringCredentials(
    daysAhead: number,
    context: RequestContext
  ): Promise<CredentialResponseDto[]> {
    // For MVP, query by type and filter by date
    // In production, consider a GSI on expiration date
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + daysAhead);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    // Query all credentials and filter
    const result = await this.dynamoDBClient.query<Credential>(
      client,
      context.tenantId,
      'STAFF#',
      'entityType = :entityType',
      { ':entityType': 'CREDENTIAL' },
      undefined,
      1000  // Get all for filtering
    );

    const expiring = result.items.filter(c => 
      c.expirationDate && 
      c.expirationDate <= cutoffStr &&
      c.verificationStatus !== 'expired' &&
      c.verificationStatus !== 'revoked'
    );

    return expiring.map(c => this.toCredentialResponse(c));
  }

  // ============================================
  // Helper Methods
  // ============================================

  private async checkCredentialIdentifierNotExists(
    staffId: string,
    credentialIdentifier: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    
    const result = await this.dynamoDBClient.query<Credential>(
      client,
      context.tenantId,
      CredentialKeyBuilder.credentialsPrefix(staffId),
      'entityType = :entityType AND credentialIdentifier = :credentialIdentifier',
      { 
        ':entityType': 'CREDENTIAL',
        ':credentialIdentifier': credentialIdentifier,
      },
      undefined,
      1
    );

    if (result.items.length > 0) {
      throw new ConflictException('A credential with this identifier already exists for this staff member');
    }
  }

  private toCredentialResponse(credential: Credential): CredentialResponseDto {
    return {
      credentialId: credential.credentialId,
      staffId: credential.staffId,
      tenantId: credential.tenantId,
      credentialIdentifier: credential.credentialIdentifier,
      credentialTypeDescriptor: credential.credentialTypeDescriptor,
      credentialFieldDescriptor: credential.credentialFieldDescriptor,
      issuanceDate: credential.issuanceDate,
      expirationDate: credential.expirationDate,
      issuingState: credential.issuingState,
      issuingOrganization: credential.issuingOrganization,
      gradeLevels: credential.gradeLevels,
      subjects: credential.subjects,
      name: credential.name,
      description: credential.description,
      documentUrl: credential.documentUrl,
      documentFileName: credential.documentFileName,
      verificationStatus: credential.verificationStatus,
      verificationNotes: credential.verificationNotes,
      verifiedBy: credential.verifiedBy,
      verifiedAt: credential.verifiedAt,
      isRenewable: credential.isRenewable,
      renewalReminderDays: credential.renewalReminderDays,
      isExpired: isCredentialExpired(credential),
      daysUntilExpiration: daysUntilExpiration(credential),
      isExpiringSoon: isCredentialExpiringSoon(credential),
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }
}
