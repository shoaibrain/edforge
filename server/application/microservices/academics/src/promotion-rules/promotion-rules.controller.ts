/**
 * PromotionRulesController — Sprint D.2.2
 *
 * 5 REST endpoints under `/academics/promotion-rules`:
 *   - POST    /academics/promotion-rules              create
 *   - GET     /academics/promotion-rules              list (schoolId required; gradeLevel optional; lazy-seed triggers on (schoolId, gradeLevel) empty)
 *   - GET     /academics/promotion-rules/:ruleId      single
 *   - PATCH   /academics/promotion-rules/:ruleId      partial update; clears archetypeDefaulted
 *   - DELETE  /academics/promotion-rules/:ruleId      soft-delete via isActive=false
 *
 * Three-way handoff (per CLAUDE.md): controller (here) + API GW spec
 * (tenant-api-prod.json) + nginx `^/academics` (existing prefix — no
 * nginx.template change).
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import {
  PromotionRulesService,
  CreatePromotionRuleDto,
  UpdatePromotionRuleDto,
} from './promotion-rules.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequestContext } from '../common/entities';
import type { PromotionRuleResponseDto } from '@aibrains/shared-types';

@Controller('academics/promotion-rules')
@UseGuards(JwtAuthGuard)
export class PromotionRulesController {
  private readonly logger = new Logger(PromotionRulesController.name);

  constructor(private readonly promotionRulesService: PromotionRulesService) {}

  /**
   * POST /academics/promotion-rules
   */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'create' })
  async createPromotionRule(
    @Body() dto: CreatePromotionRuleDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<PromotionRuleResponseDto> {
    this.logger.log(
      `POST /academics/promotion-rules — schoolId=${dto.schoolId} gradeLevel=${dto.gradeLevel} archetype=${dto.archetypeId}`,
    );
    const context = this.buildContext(tenant, req);
    return this.promotionRulesService.createPromotionRule(dto, context);
  }

  /**
   * GET /academics/promotion-rules?schoolId=…&gradeLevel=…
   *
   * When `gradeLevel` is supplied AND no active rule exists for that
   * (schoolId, gradeLevel), the D.2.3 lazy-seed writes a default and
   * returns it. Without gradeLevel, returns all active rules verbatim.
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'view' })
  async listPromotionRules(
    @Query('schoolId') schoolId: string,
    @Query('gradeLevel') gradeLevel: string | undefined,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<PromotionRuleResponseDto[]> {
    this.logger.log(
      `GET /academics/promotion-rules — schoolId=${schoolId} gradeLevel=${gradeLevel ?? '*'}`,
    );
    const context = this.buildContext(tenant, req);
    return this.promotionRulesService.listPromotionRules(
      { schoolId, gradeLevel },
      context,
    );
  }

  /**
   * GET /academics/promotion-rules/:ruleId?schoolId=…
   */
  @Get(':ruleId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'view' })
  async getPromotionRule(
    @Param('ruleId') ruleId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<PromotionRuleResponseDto> {
    this.logger.log(`GET /academics/promotion-rules/${ruleId} — schoolId=${schoolId}`);
    const context = this.buildContext(tenant, req);
    return this.promotionRulesService.getPromotionRule(ruleId, schoolId, context);
  }

  /**
   * PATCH /academics/promotion-rules/:ruleId?schoolId=…
   *
   * First PATCH on a lazy-seeded row flips `archetypeDefaulted` to false
   * (operator override). Identity fields (schoolId/gradeLevel/archetypeId)
   * are not patchable — clients must soft-delete + create fresh.
   */
  @Patch(':ruleId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'edit' })
  async updatePromotionRule(
    @Param('ruleId') ruleId: string,
    @Query('schoolId') schoolId: string,
    @Body() dto: UpdatePromotionRuleDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<PromotionRuleResponseDto> {
    this.logger.log(
      `PATCH /academics/promotion-rules/${ruleId} — schoolId=${schoolId} fields=${Object.keys(dto).join(',')}`,
    );
    const context = this.buildContext(tenant, req);
    return this.promotionRulesService.updatePromotionRule(ruleId, schoolId, dto, context);
  }

  /**
   * DELETE /academics/promotion-rules/:ruleId?schoolId=…
   * Soft-delete: flips isActive=false. Row retained for audit traceability.
   */
  @Delete(':ruleId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'grades', action: 'delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async softDeletePromotionRule(
    @Param('ruleId') ruleId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    this.logger.log(
      `DELETE /academics/promotion-rules/${ruleId} — schoolId=${schoolId}`,
    );
    const context = this.buildContext(tenant, req);
    await this.promotionRulesService.softDeletePromotionRule(ruleId, schoolId, context);
  }

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      role: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
  }
}
