/**
 * BrandingController — Sprint C.0.7
 *
 * Three endpoints mounted under the existing `/schools` API GW prefix
 * (covered by nginx `^/schools` block — no new top-level prefix, so no
 * nginx.template change).
 *
 *   GET    /schools/:schoolId/branding                    → read
 *   POST   /schools/:schoolId/branding/assets/upload-url  → presigned PUT
 *   PATCH  /schools/:schoolId/branding                    → upsert
 *
 * All three routes must also be declared in `server/lib/tenant-api-prod.json`
 * (three-way handoff per CLAUDE.md). NestJS validates the path and the
 * Authorizer Lambda validates the token, but API GW will return 403 SigV4
 * on any path missing from the OpenAPI spec.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RequireGlobalRole } from '../common/decorators/require-global-role.decorator';
import { RequestContext } from '../common/entities/base.entity';
import { BrandingService } from './branding.service';
import {
  BrandingResponse,
  PresignedUploadRequestDtoZ,
  PresignedUploadResponse,
  UpdateBrandingRequestDtoZ,
} from './branding.types';

@Controller('schools')
export class BrandingController {
  constructor(private readonly brandingService: BrandingService) {}

  @Get(':schoolId/branding')
  async getBranding(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<BrandingResponse> {
    const context = this.buildContext(tenant, req);
    return this.brandingService.getBranding(schoolId, context);
  }

  /**
   * Mint a short-lived presigned PUT URL the browser can upload to
   * directly. The signed URL embeds tenant-scoped IAM credentials —
   * a forged path outside the caller's tenant prefix will be rejected
   * by S3 (defense-in-depth on top of server-side key construction).
   */
  @Post(':schoolId/branding/assets/upload-url')
  @HttpCode(200)
  @RequireGlobalRole('TenantAdmin')
  async presignUploadUrl(
    @Param('schoolId') schoolId: string,
    @Body() body: PresignedUploadRequestDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<PresignedUploadResponse> {
    const context = this.buildContext(tenant, req);
    return this.brandingService.presignUploadUrl(schoolId, body, context);
  }

  @Patch(':schoolId/branding')
  @RequireGlobalRole('TenantAdmin')
  async updateBranding(
    @Param('schoolId') schoolId: string,
    @Body() body: UpdateBrandingRequestDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<BrandingResponse> {
    const context = this.buildContext(tenant, req);
    return this.brandingService.updateBranding(schoolId, body, context);
  }

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
  }
}
