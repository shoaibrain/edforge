/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Finance Controller
 */

import { Controller, Get, Post, Put, Body, Param, UseGuards, Req, Query } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { CreateTuitionConfigurationDto, CreatePaymentDto, CalculateInvoiceDto, CreateInvoiceDto, SelectPaymentPlanDto, UpdateInvoiceDto } from './dto/finance.dto';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { RequestContext } from '../common/entities/base.entity';
import { ValidationService } from '../common/services/validation.service';

@Controller('finance/invoices')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly validationService: ValidationService
  ) {}

  private getRequestContext(@Req() req: any, @TenantCredentials() tenant: any): RequestContext {
    return {
      tenantId: tenant.tenantId,
      userId: tenant.userId || req.user?.sub || 'system',
      userRole: tenant.role || req.user?.role || 'user',
      userName: tenant.userName || req.user?.name,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      sessionId: req.sessionID
    };
  }

  /**
   * Create Tuition Configuration
   * POST /finance/tuition-config
   */
  @Post('tuition-config')
  async createTuitionConfiguration(
    @Body() createDto: CreateTuitionConfigurationDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    // Validate input before processing
    await this.validationService.validateTuitionConfiguration(tenant.tenantId, createDto);
    
    const context = this.getRequestContext(req, tenant);
    return this.financeService.createTuitionConfiguration(tenant.tenantId, createDto, context);
  }

  /**
   * Get Tuition Configuration
   * GET /finance/tuition-config?schoolId=xxx&academicYearId=yyy
   */
  @Get('tuition-config')
  async getTuitionConfiguration(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: any
  ) {
    return this.financeService.getTuitionConfiguration(tenant.tenantId, schoolId, academicYearId);
  }

  /**
   * Record Payment
   * POST /finance/payments
   */
  @Post('payments')
  async recordPayment(
    @Body() createPaymentDto: CreatePaymentDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    // Validate input before processing
    await this.validationService.validatePayment(tenant.tenantId, createPaymentDto.invoiceId, createPaymentDto);
    
    const context = this.getRequestContext(req, tenant);
    return this.financeService.recordPayment(tenant.tenantId, createPaymentDto, context);
  }

  /**
   * Get Invoice
   * GET /finance/invoices/:invoiceId
   */
  @Get('invoices/:invoiceId')
  async getInvoice(
    @Param('invoiceId') invoiceId: string,
    @TenantCredentials() tenant: any
  ) {
    return this.financeService.getInvoice(tenant.tenantId, invoiceId);
  }

  /**
   * Get Invoices by Student
   * GET /finance/invoices/students/:studentId
   */
  @Get('invoices/students/:studentId')
  async getInvoicesByStudent(
    @Param('studentId') studentId: string,
    @TenantCredentials() tenant: any
  ) {
    return this.financeService.getInvoicesByStudent(tenant.tenantId, studentId);
  }

  /**
   * Get Overdue Invoices
   * GET /finance/invoices/overdue?schoolId=xxx&academicYearId=yyy
   */
  @Get('invoices/overdue')
  async getOverdueInvoices(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: any
  ) {
    return this.financeService.getOverdueInvoices(tenant.tenantId, schoolId, academicYearId);
  }

  /**
   * Calculate Invoice
   * POST /finance/invoices/calculate
   * Used by Enrollment Service via HTTP
   */
  @Post('invoices/calculate')
  async calculateInvoice(
    @Body() calculateDto: CalculateInvoiceDto,
    @TenantCredentials() tenant: any
  ) {
    return this.financeService.calculateInvoiceHttp(
      tenant.tenantId,
      calculateDto.enrollment,
      calculateDto.tuitionConfigId
    );
  }

  /**
   * Create Invoice
   * POST /finance/invoices
   * Used by Enrollment Service via HTTP
   */
  @Post('invoices')
  async createInvoice(
    @Body() createDto: CreateInvoiceDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    const context = this.getRequestContext(req, tenant);
    return this.financeService.createInvoiceHttp(
      tenant.tenantId,
      createDto.enrollment,
      createDto.tuitionConfigId,
      createDto.invoiceCalculation,
      createDto.accountId,
      context
    );
  }

  /**
   * Select Payment Plan
   * POST /finance/payment-plans/select
   * Used by Enrollment Service via HTTP
   */
  @Post('payment-plans/select')
  async selectPaymentPlan(
    @Body() selectDto: SelectPaymentPlanDto,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant: any
  ) {
    // Extract schoolId and academicYearId from tuitionConfigId or use query params
    // For now, we'll use query params as they're required
    return this.financeService.selectPaymentPlanHttp(
      tenant.tenantId,
      schoolId,
      academicYearId,
      selectDto.total
    );
  }

  /**
   * Update Invoice
   * PUT /finance/invoices/:invoiceId
   */
  @Put('invoices/:invoiceId')
  async updateInvoice(
    @Param('invoiceId') invoiceId: string,
    @Body() updateDto: UpdateInvoiceDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    const context = this.getRequestContext(req, tenant);
    return this.financeService.updateInvoice(
      tenant.tenantId,
      invoiceId,
      updateDto,
      context
    );
  }
}

