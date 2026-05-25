/**
 * BrandingService — per-school branding read/update + presigned-upload.
 *
 * Tenant isolation:
 *   - All S3 keys are constructed server-side from `context.tenantId` (from
 *     the JWT — never trusted from request body).
 *   - The S3 presigner uses TVM-issued tenant-scoped credentials whose ABAC
 *     policy only permits writes under `tenants/${aws:PrincipalTag/tenant}/*`.
 *     A bug in this service that constructed the wrong key would be caught
 *     at the IAM layer (defense-in-depth).
 *
 * Backing store:
 *   - Branding is a sub-document on the existing `School` entity (no new
 *     entity type). PATCH issues a single `UpdateItem` with REMOVE for
 *     undefined fields + SET for present fields, then bumps `version` +
 *     `updatedAt` + `updatedBy`.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { S3PresignerService } from '../common/services/s3-presigner.service';
import { EntityKeyBuilder, RequestContext } from '../common/entities/base.entity';
import { School } from '../common/entities/school.entity';
import { computeFieldChanges } from '../common/entities/audit.entity';
import {
  ASSET_MAX_BYTES,
  ASSET_MIME_ALLOWLIST,
  BrandingAssetType,
  BrandingResponse,
  PresignedUploadRequest,
  PresignedUploadResponse,
  UpdateBrandingRequest,
  extensionFor,
} from './branding.types';
import type { SchoolBrandingDto } from '@aibrains/shared-types';

const PRESIGN_PUT_EXPIRY_SECONDS = 300;

@Injectable()
export class BrandingService {
  private readonly logger = new Logger(BrandingService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly s3Presigner: S3PresignerService,
    private readonly auditedWrite: AuditedWriteService,
  ) {}

  // ============================================================
  // GET /schools/:schoolId/branding
  // ============================================================
  async getBranding(
    schoolId: string,
    context: RequestContext,
  ): Promise<BrandingResponse> {
    const school = await this.loadSchool(schoolId, context);
    return { branding: school.branding ?? null };
  }

  // ============================================================
  // POST /schools/:schoolId/branding/assets/upload-url
  // ============================================================
  async presignUploadUrl(
    schoolId: string,
    body: PresignedUploadRequest,
    context: RequestContext,
  ): Promise<PresignedUploadResponse> {
    const { assetType, contentType, contentLength } = body;

    this.validateMime(assetType, contentType);
    this.validateSize(assetType, contentLength);
    // Existence check: 404 here means the schoolId doesn't exist in this
    // tenant. Cheap (1 GetItem on the same partition we'd PATCH later).
    await this.loadSchool(schoolId, context);

    const ext = extensionFor(contentType);
    if (!ext) {
      throw new UnsupportedMediaTypeException(
        `No file extension is registered for contentType=${contentType}`,
      );
    }

    const key =
      `tenants/${context.tenantId}` +
      `/schools/${schoolId}` +
      `/branding/${assetType}` +
      `/${uuid()}.${ext}`;

    const uploadUrl = await this.s3Presigner.presignPut(
      context.jwtToken,
      key,
      contentType,
      contentLength,
      PRESIGN_PUT_EXPIRY_SECONDS,
    );

    return { uploadUrl, key, expiresInSeconds: PRESIGN_PUT_EXPIRY_SECONDS };
  }

  // ============================================================
  // PATCH /schools/:schoolId/branding
  // ============================================================
  async updateBranding(
    schoolId: string,
    patch: UpdateBrandingRequest,
    context: RequestContext,
  ): Promise<BrandingResponse> {
    const school = await this.loadSchool(schoolId, context);
    const before: SchoolBrandingDto = school.branding ?? {};

    // S3 keys submitted in this PATCH must already live under the caller's
    // tenant prefix — even though IAM enforces this for the upload, the
    // client could try to PATCH a forged key it didn't upload. Cheap to
    // re-validate here.
    this.assertS3KeysAreTenantScoped(patch, context.tenantId, schoolId);

    // Merge before-state + patch + bump brandingVersionId so render
    // endpoints can snapshot it on issued PDFs (R48-style template-version
    // freezing extended to branding).
    const merged: SchoolBrandingDto = {
      ...before,
      ...patch,
      brandingVersionId: uuid(),
    };

    const now = new Date().toISOString();
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    await this.dynamoDBClient.updateItem<School>(
      client,
      context.tenantId,
      EntityKeyBuilder.school(schoolId),
      'SET #branding = :branding, #updatedAt = :updatedAt, #updatedBy = :updatedBy, #version = if_not_exists(#version, :zero) + :one',
      {
        ':branding': merged,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':zero': 0,
        ':one': 1,
      },
      'attribute_exists(entityKey)',
      {
        '#branding': 'branding',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
        '#version': 'version',
      },
    );

    await this.auditedWrite.emit(context, {
      schoolId,
      targetEntity: 'SCHOOL',
      targetEntityId: schoolId,
      action: 'update',
      changes: computeFieldChanges(
        before as Record<string, unknown>,
        merged as Record<string, unknown>,
      ),
    });

    return { branding: merged };
  }

  // ============================================================
  // helpers
  // ============================================================

  private async loadSchool(
    schoolId: string,
    context: RequestContext,
  ): Promise<School> {
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    const school = await this.dynamoDBClient.getItem<School>(
      client,
      context.tenantId,
      EntityKeyBuilder.school(schoolId),
    );
    if (!school) {
      throw new NotFoundException(
        `School not found: schoolId=${schoolId} tenantId=${context.tenantId}`,
      );
    }
    return school;
  }

  private validateMime(assetType: BrandingAssetType, contentType: string): void {
    const allowed = ASSET_MIME_ALLOWLIST[assetType];
    if (!allowed.includes(contentType)) {
      throw new UnsupportedMediaTypeException(
        `contentType=${contentType} is not allowed for assetType=${assetType}. ` +
          `Allowed: ${allowed.join(', ')}`,
      );
    }
  }

  private validateSize(assetType: BrandingAssetType, contentLength: number): void {
    const max = ASSET_MAX_BYTES[assetType];
    if (contentLength > max) {
      throw new PayloadTooLargeException(
        `contentLength=${contentLength} exceeds max ${max} bytes for assetType=${assetType}`,
      );
    }
  }

  private assertS3KeysAreTenantScoped(
    patch: UpdateBrandingRequest,
    tenantId: string,
    schoolId: string,
  ): void {
    const expectedPrefix = `tenants/${tenantId}/schools/${schoolId}/branding/`;
    const keyFields: Array<keyof UpdateBrandingRequest> = [
      'logoS3Key',
      'principalSignatureS3Key',
      'letterheadBackgroundS3Key',
    ];
    for (const field of keyFields) {
      const value = patch[field];
      if (typeof value === 'string' && !value.startsWith(expectedPrefix)) {
        throw new BadRequestException(
          `${String(field)} is not scoped to this school's tenant. ` +
            `Expected prefix '${expectedPrefix}', got '${value.slice(0, 60)}…'`,
        );
      }
    }
  }
}
