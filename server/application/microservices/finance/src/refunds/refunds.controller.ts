import {
  Controller,
  Get, Post,
  Body, Param, Query,
  UseGuards, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { RefundsService } from './refunds.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateRefundRequestDtoZ, ApproveRefundDtoZ, RejectRefundDtoZ } from '../common/dto/zod-dtos';
import { buildRequestContext } from '../common/entities/base.entity';
import type { RefundRequest } from '@aibrains/shared-types';

@Controller('finance/schools/:schoolId/refunds')
@UseGuards(JwtAuthGuard)
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'create', schoolIdParam: 'schoolId' })
  async create(
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateRefundRequestDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<RefundRequest> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.refundsService.create(schoolId, dto, context);
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async list(
    @Param('schoolId') schoolId: string,
    @Query('status') status: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: RefundRequest[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.refundsService.list(schoolId, context, {
      status,
      limit: limit ? parseInt(limit, 10) : 50,
      cursor,
    });
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async get(
    @Param('schoolId') schoolId: string,
    @Param('id') refundId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<RefundRequest> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.refundsService.get(schoolId, refundId, context);
  }

  @Post(':id/approve')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'approve', schoolIdParam: 'schoolId' })
  async approve(
    @Param('schoolId') schoolId: string,
    @Param('id') refundId: string,
    @Body() dto: ApproveRefundDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<RefundRequest> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.refundsService.approve(schoolId, refundId, context, dto.notes);
  }

  @Post(':id/reject')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'approve', schoolIdParam: 'schoolId' })
  async reject(
    @Param('schoolId') schoolId: string,
    @Param('id') refundId: string,
    @Body() dto: RejectRefundDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<RefundRequest> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.refundsService.reject(schoolId, refundId, dto.reason, context);
  }

  @Post(':id/process')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'edit', schoolIdParam: 'schoolId' })
  async process(
    @Param('schoolId') schoolId: string,
    @Param('id') refundId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<RefundRequest> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.refundsService.process(schoolId, refundId, context);
  }

  @Post(':id/complete')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'edit', schoolIdParam: 'schoolId' })
  async complete(
    @Param('schoolId') schoolId: string,
    @Param('id') refundId: string,
    @Body() body: { gatewayRefundId?: string },
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<RefundRequest> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.refundsService.complete(schoolId, refundId, body.gatewayRefundId, context);
  }
}
