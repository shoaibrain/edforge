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
import { IemisAuditLogger } from '../common/services/iemis-audit-logger.service';
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
} from '@aibrains/shared-types';

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: IdentityEventsService,
    private readonly iemisAuditLogger: IemisAuditLogger,
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

    // Sprint 4 S4.7 — IEMIS audit emit (fail-open per logger contract).
    // Metadata uses Ed-Fi-aligned typed fields only — no PII (no name/notes/url).
    // The 4-bucket Flash-II category is derived at export time per ADR
    // sprint4-credentials-vs-qualifications-revised — staying lean here.
    void this.iemisAuditLogger.emit(
      {
        eventType: 'staff.credential.created',
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorName: context.email,
        metadata: {
          staffId,
          credentialId,
          credentialTypeDescriptor: credential.credentialTypeDescriptor,
          credentialFieldDescriptor: credential.credentialFieldDescriptor,
          verificationStatus: credential.verificationStatus,
          issuanceDate: credential.issuanceDate,
          expirationDate: credential.expirationDate,
        },
      },
      context.jwtToken,
    );

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

    // Use expression attribute names for all fields to avoid DynamoDB reserved keyword issues
    // (e.g., 'name' is a reserved keyword)
    for (const field of simpleFields) {
      const value = (updateDto as any)[field];
      if (value !== undefined) {
        updates.push(`#${field} = :${field}`);
        values[`:${field}`] = value;
        names[`#${field}`] = field;
      }
    }

    if (updateDto.gradeLevels) {
      updates.push('#gradeLevels = :gradeLevels');
      values[':gradeLevels'] = updateDto.gradeLevels;
      names['#gradeLevels'] = 'gradeLevels';
    }

    if (updateDto.subjects) {
      updates.push('#subjects = :subjects');
      values[':subjects'] = updateDto.subjects;
      names['#subjects'] = 'subjects';
    }

    if (updateDto.verificationStatus) {
      updates.push('#verificationStatus = :verificationStatus');
      values[':verificationStatus'] = updateDto.verificationStatus;
      names['#verificationStatus'] = 'verificationStatus';
    }

    if (updates.length === 0) {
      return this.toCredentialResponse(credential);
    }

    updates.push('#updatedAt = :updatedAt', '#updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#updatedAt'] = 'updatedAt';
    names['#updatedBy'] = 'updatedBy';
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

    // Sprint 4 S4.7 — IEMIS audit emit (fail-open).
    // `changedFields` lists which whitelisted attributes the request
    // updated; verification* fields are tracked separately under
    // `verifyCredential` and shouldn't double-emit here.
    void this.iemisAuditLogger.emit(
      {
        eventType: 'staff.credential.edited',
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorName: context.email,
        metadata: {
          staffId,
          credentialId,
          credentialTypeDescriptor: updatedCredential.credentialTypeDescriptor,
          changedFields: Object.keys(values)
            .map((k) => k.replace(/^:/, ''))
            .filter((f) => f !== 'updatedAt' && f !== 'updatedBy' && f !== 'inc'),
        },
      },
      context.jwtToken,
    );

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
      'SET #verificationStatus = :verificationStatus, #verificationNotes = :verificationNotes, #verifiedBy = :verifiedBy, #verifiedAt = :verifiedAt, #updatedAt = :updatedAt, #updatedBy = :updatedBy, #version = #version + :inc',
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
      {
        '#version': 'version',
        '#verificationStatus': 'verificationStatus',
        '#verificationNotes': 'verificationNotes',
        '#verifiedBy': 'verifiedBy',
        '#verifiedAt': 'verifiedAt',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
      }
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

    // Sprint 4 S4.7 — IEMIS audit emit. Verification is a state-change on
    // the credential, so we use `staff.credential.edited` with explicit
    // before/after on the verification status. No verification notes go
    // into metadata (privacy — could contain free-form text).
    void this.iemisAuditLogger.emit(
      {
        eventType: 'staff.credential.edited',
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorName: context.email,
        metadata: {
          staffId,
          credentialId,
          credentialTypeDescriptor: credential.credentialTypeDescriptor,
          changedFields: ['verificationStatus'],
          before: { verificationStatus: credential.verificationStatus },
          after: { verificationStatus: verifyDto.verificationStatus },
        },
      },
      context.jwtToken,
    );

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

    // Sprint 4 S4.7 — IEMIS audit emit. Capture the type-at-delete-time so
    // Flash-II reporters who diff over time can still bucket the deletion
    // by category. No PII in metadata.
    void this.iemisAuditLogger.emit(
      {
        eventType: 'staff.credential.deleted',
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorName: context.email,
        metadata: {
          staffId,
          credentialId,
          credentialTypeDescriptor: credential.credentialTypeDescriptor,
          credentialFieldDescriptor: credential.credentialFieldDescriptor,
        },
      },
      context.jwtToken,
    );
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
    credentialIdentifier: string | undefined,
    context: RequestContext
  ): Promise<void> {
    // Skip duplicate check if no identifier provided
    if (!credentialIdentifier) {
      return;
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Query all credentials for this staff member and filter in memory
    // This avoids FilterExpression issues with DynamoDB
    const result = await this.dynamoDBClient.query<Credential>(
      client,
      context.tenantId,
      CredentialKeyBuilder.credentialsPrefix(staffId),
      'entityType = :entityType',
      { ':entityType': 'CREDENTIAL' },
      undefined,
      100
    );

    const duplicate = result.items.find(c => c.credentialIdentifier === credentialIdentifier);
    if (duplicate) {
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
