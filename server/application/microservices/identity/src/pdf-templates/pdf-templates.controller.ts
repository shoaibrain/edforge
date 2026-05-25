/**
 * PdfTemplatesController — Sprint C.1.3
 *
 * One read-only endpoint:
 *   GET /schools/:schoolId/pdf-templates/:docType/current
 *
 * Mounted under the existing `/schools` API GW prefix (covered by nginx
 * `^/schools` block — no new top-level prefix, so no nginx.template change).
 *
 * Three-way handoff per CLAUDE.md: controller + `server/lib/tenant-api-prod.json`
 * + nginx. Only the first two require edits for new paths under an
 * existing top-level prefix.
 *
 * Permission gate: `pdf-templates:view` via `PermissionGuard`. TenantAdmin
 * auto-bypasses at guard:50; Principal is granted the permission in
 * `DEFAULT_ROLE_PERMISSIONS` (this PR). The `:configure` action is
 * reserved for the C.2.x editor sprint (no controller method uses it yet,
 * but registering both keys here avoids a permission-registry follow-up).
 */

import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantCredentials, TenantContext } from '@app/auth';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequestContext } from '../common/entities/base.entity';
import { PdfTemplatesService } from './pdf-templates.service';
import type { PdfTemplateCurrentResponse } from './pdf-templates.types';

@Controller('schools')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PdfTemplatesController {
  constructor(private readonly pdfTemplatesService: PdfTemplatesService) {}

  /**
   * Resolve the current template for (school, docType). When no operator
   * customization exists this returns the descriptor's archetype-aware
   * defaults from `@aibrains/pdf-renderer` (no DDB write — lazy-default).
   *
   * Response shape carries a `source: 'persisted' | 'default'` discriminator
   * so render endpoints can log which path served the template.
   */
  @Get(':schoolId/pdf-templates/:docType/current')
  @RequirePermission({ resource: 'pdf-templates', action: 'view', schoolIdParam: 'schoolId' })
  async getCurrentTemplate(
    @Param('schoolId') schoolId: string,
    @Param('docType') docType: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<PdfTemplateCurrentResponse> {
    const context = this.buildContext(tenant, req);
    return this.pdfTemplatesService.getCurrentTemplate(schoolId, docType, context);
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
