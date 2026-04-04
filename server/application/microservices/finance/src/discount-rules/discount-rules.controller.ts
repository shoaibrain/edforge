import {
  Controller,
  Get, Post, Patch, Delete,
  Body, Param, Query,
  UseGuards, Req,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { DiscountRulesService } from './discount-rules.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateDiscountRuleDtoZ, UpdateDiscountRuleDtoZ } from '../common/dto/zod-dtos';
import { buildRequestContext } from '../common/entities/base.entity';
import type { DiscountRule } from '@aibrains/shared-types';

@Controller('finance/schools/:schoolId/discount-rules')
@UseGuards(JwtAuthGuard)
export class DiscountRulesController {
  constructor(private readonly discountRulesService: DiscountRulesService) {}

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'create', schoolIdParam: 'schoolId' })
  async create(
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateDiscountRuleDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<DiscountRule> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.discountRulesService.create(schoolId, dto, context);
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async list(
    @Param('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('isActive') isActive: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: DiscountRule[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.discountRulesService.list(schoolId, context, {
      academicYearId,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      cursor,
    });
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async get(
    @Param('schoolId') schoolId: string,
    @Param('id') discountRuleId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<DiscountRule> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.discountRulesService.get(schoolId, discountRuleId, context);
  }

  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'edit', schoolIdParam: 'schoolId' })
  async update(
    @Param('schoolId') schoolId: string,
    @Param('id') discountRuleId: string,
    @Body() dto: UpdateDiscountRuleDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<DiscountRule> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.discountRulesService.update(schoolId, discountRuleId, dto, context);
  }

  @Delete(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'delete', schoolIdParam: 'schoolId' })
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('schoolId') schoolId: string,
    @Param('id') discountRuleId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<DiscountRule> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.discountRulesService.delete(schoolId, discountRuleId, context);
  }
}
