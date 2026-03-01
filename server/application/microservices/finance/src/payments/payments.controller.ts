import {
  Controller,
  Get, Post,
  Body, Param, Query,
  UseGuards, Req,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { IdentityClientService } from '../common/services/identity-client.service';
import { RecordManualPaymentDtoZ, InitiatePaymentDtoZ, VoidPaymentDtoZ, CreateRefundDtoZ } from '../common/dto/zod-dtos';
import { buildRequestContext } from '../common/entities/base.entity';
import type { Payment, Receipt, InitiatePaymentResponse, VerifyPaymentResponse } from '@aibrains/shared-types';

@Controller('finance')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly identityClient: IdentityClientService,
  ) {}

  // =========================================================================
  // MANUAL PAYMENT (cash, bank_transfer, cheque)
  // =========================================================================

  @Post('schools/:schoolId/payments/manual')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'create', schoolIdParam: 'schoolId' })
  async recordManualPayment(
    @Param('schoolId') schoolId: string,
    @Body() dto: RecordManualPaymentDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Payment> {
    const context = buildRequestContext(tenant, req, schoolId);

    // Block Parent/Student from recording manual payments (prevents fraud)
    if (tenant.globalRole !== 'TenantAdmin') {
      const roleResult = await this.identityClient.getUserRole(tenant.userId, schoolId, context);
      const role = roleResult?.role;
      if (role === 'Parent' || role === 'Student') {
        throw new ForbiddenException('Manual payment recording requires admin access');
      }
    }

    return this.paymentsService.recordManualPayment(schoolId, dto, context);
  }

  // =========================================================================
  // GATEWAY PAYMENT INITIATION & VERIFICATION
  // =========================================================================

  @Post('schools/:schoolId/payments/initiate')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'create', schoolIdParam: 'schoolId' })
  async initiatePayment(
    @Param('schoolId') schoolId: string,
    @Body() dto: InitiatePaymentDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<InitiatePaymentResponse> {
    const context = buildRequestContext(tenant, req, schoolId);

    // Enforce student ownership: parents can only pay their own children's invoices
    if (tenant.globalRole !== 'TenantAdmin') {
      const invoice = await this.paymentsService.getInvoiceForOwnershipCheck(
        schoolId, dto.invoiceId, context,
      );
      await this.identityClient.enforceStudentOwnership(invoice.studentId, schoolId, context);
    }

    return this.paymentsService.initiatePayment(schoolId, dto, context);
  }

  @Get('payments/verify/:sessionId')
  async verifyPayment(
    @Param('sessionId') sessionId: string,
    @Query() callbackData: Record<string, string>,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<VerifyPaymentResponse> {
    const context = buildRequestContext(tenant, req);
    return this.paymentsService.verifyPayment(sessionId, callbackData, context);
  }

  // =========================================================================
  // LIST PAYMENTS
  // =========================================================================

  @Get('schools/:schoolId/payments')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async listSchoolPayments(
    @Param('schoolId') schoolId: string,
    @Query('status') status: string,
    @Query('gateway') gateway: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<{ items: Payment[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.paymentsService.listBySchool(schoolId, context, {
      status, gateway,
      limit: limit ? parseInt(limit, 10) : 50,
      cursor,
    });
  }

  @Get('schools/:schoolId/invoices/:invoiceId/payments')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async listInvoicePayments(
    @Param('schoolId') schoolId: string,
    @Param('invoiceId') invoiceId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Payment[]> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.paymentsService.listByInvoice(schoolId, invoiceId, context);
  }

  // =========================================================================
  // GET PAYMENT & RECEIPT
  // =========================================================================

  @Get('payments/:paymentId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async getPayment(
    @Param('paymentId') paymentId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Payment> {
    const context = buildRequestContext(tenant, req, schoolId);
    const payment = await this.paymentsService.get(schoolId, paymentId, context);

    // Entity-level ownership enforcement
    if (payment.studentAccountId) {
      await this.identityClient.enforceStudentOwnership(payment.studentAccountId, schoolId, context);
    }

    return payment;
  }

  @Get('payments/:paymentId/receipt')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async getReceipt(
    @Param('paymentId') paymentId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Receipt> {
    const context = buildRequestContext(tenant, req, schoolId);
    const receipt = await this.paymentsService.getReceipt(schoolId, paymentId, context);

    // Entity-level ownership enforcement
    if (receipt.studentId) {
      await this.identityClient.enforceStudentOwnership(receipt.studentId, schoolId, context);
    }

    return receipt;
  }

  // =========================================================================
  // VOID & REFUND
  // =========================================================================

  @Post('schools/:schoolId/payments/:paymentId/void')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async voidPayment(
    @Param('schoolId') schoolId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: VoidPaymentDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Payment> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.paymentsService.voidPayment(schoolId, paymentId, dto.reason, context);
  }

  @Post('schools/:schoolId/payments/:paymentId/refund')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' })
  async refundPayment(
    @Param('schoolId') schoolId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: CreateRefundDtoZ,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<Payment> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.paymentsService.refund(schoolId, paymentId, dto, context);
  }
}
