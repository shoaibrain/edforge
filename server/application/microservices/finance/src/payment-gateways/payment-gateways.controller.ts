import {
  Controller,
  Get, Put,
  Body, Param,
  UseGuards, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentGatewaysService } from './payment-gateways.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { SaveGatewayConfigDtoZ } from '../common/dto/zod-dtos';
import { RequestContext } from '../common/entities/base.entity';
import type { PaymentGateway, PaymentGatewayPublicConfig, PaymentGatewayConfig } from '@aibrains/shared-types';

@Controller('finance/schools/:schoolId/payment-gateways')
@UseGuards(JwtAuthGuard)
export class PaymentGatewaysController {
  constructor(private readonly paymentGatewaysService: PaymentGatewaysService) {}

  /**
   * GET /finance/schools/:schoolId/payment-gateways
   * Public: list enabled gateways (no credentials).
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async listEnabled(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<PaymentGatewayPublicConfig[]> {
    const context = this.buildContext(tenant, req, schoolId);
    return this.paymentGatewaysService.listEnabled(schoolId, context);
  }

  /**
   * GET /finance/schools/:schoolId/payment-gateways/admin
   * Admin: list all gateways with masked credentials.
   */
  @Get('admin')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async listAll(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<PaymentGatewayConfig[]> {
    const context = this.buildContext(tenant, req, schoolId);
    return this.paymentGatewaysService.listAll(schoolId, context);
  }

  /**
   * PUT /finance/schools/:schoolId/payment-gateways/:gateway
   * Admin: save/update gateway configuration.
   */
  @Put(':gateway')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async save(
    @Param('schoolId') schoolId: string,
    @Param('gateway') gateway: PaymentGateway,
    @Body() dto: SaveGatewayConfigDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<PaymentGatewayConfig> {
    const context = this.buildContext(tenant, req, schoolId);
    return this.paymentGatewaysService.save(schoolId, gateway, dto, context);
  }

  private buildContext(tenant: any, req: Request, schoolId?: string): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      role: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
      schoolId,
    };
  }
}
