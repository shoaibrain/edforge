/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Finance HTTP Client - HTTP client for calling finance-service
 * 
 * Uses @app/http-client library with circuit breaker and retry logic
 */

import { Injectable, Logger, NotFoundException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientService, RequestContext as HttpClientRequestContext } from '@app/http-client';
import { RequestContext } from '../entities/base.entity';
import type { Enrollment, TuitionConfiguration, Invoice } from '@edforge/shared-types';

@Injectable()
export class FinanceHttpClientService {
  private readonly logger = new Logger(FinanceHttpClientService.name);
  private readonly financeServiceBaseUrl: string;

  constructor(
    private readonly httpClient: HttpClientService,
    private readonly configService: ConfigService
  ) {
    this.financeServiceBaseUrl = this.configService.get<string>('FINANCE_SERVICE_URL') || 'http://finance-service:3006';
  }

  /**
   * Get Tuition Configuration from finance-service
   * GET /finance/invoices/tuition-config?schoolId={schoolId}&academicYearId={academicYearId}
   */
  async getTuitionConfiguration(
    tenantId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<TuitionConfiguration> {
    try {
      const url = `/finance/invoices/tuition-config?schoolId=${encodeURIComponent(schoolId)}&academicYearId=${encodeURIComponent(academicYearId)}`;
      const context: HttpClientRequestContext = {
        tenantId,
        userId: 'system', // System call, no user context
        jwtToken: undefined
      };

      const response = await this.httpClient.get<TuitionConfiguration>(
        url,
        {
          baseURL: this.financeServiceBaseUrl
        },
        context
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to get tuition configuration: ${error.message}`, error.stack);
      
      if (error.response?.status === 404) {
        throw new NotFoundException(`Tuition configuration not found for school ${schoolId} and academic year ${academicYearId}`);
      }
      
      if (error.response?.status === 503 || error.isCircuitBreakerOpen) {
        throw new ServiceUnavailableException(`Finance service is currently unavailable`);
      }
      
      if (error.response?.status === 400) {
        throw new BadRequestException(`Invalid request: ${error.response?.data?.message || error.message}`);
      }
      
      throw error;
    }
  }

  /**
   * Calculate Invoice - Calls finance-service to calculate invoice
   * POST /finance/invoices/calculate
   * 
   * @param enrollment - Enrollment object
   * @param tuitionConfig - TuitionConfiguration object (extract ID from entityKey)
   */
  async calculateInvoice(
    enrollment: Enrollment,
    tuitionConfig: TuitionConfiguration
  ): Promise<{
    lineItems: Invoice['lineItems'];
    subtotal: number;
    discounts: number;
    tax: number;
    total: number;
    currency: string;
  }> {
    try {
      const url = '/finance/invoices/calculate';
      const context: HttpClientRequestContext = {
        tenantId: enrollment.tenantId || 'system',
        userId: 'system',
        jwtToken: undefined
      };

      // Extract tuitionConfigId from entityKey (format: SCHOOL#schoolId#YEAR#yearId#TUITION_CONFIG)
      const tuitionConfigId = tuitionConfig.entityKey || `SCHOOL#${enrollment.schoolId}#YEAR#${enrollment.academicYearId}#TUITION_CONFIG`;

      const response = await this.httpClient.post<{
        lineItems: Invoice['lineItems'];
        subtotal: number;
        discounts: number;
        tax: number;
        total: number;
        currency: string;
      }>(
        url,
        {
          enrollment,
          tuitionConfigId
        },
        {
          baseURL: this.financeServiceBaseUrl
        },
        context
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to calculate invoice: ${error.message}`, error.stack);
      
      if (error.response?.status === 400) {
        throw new BadRequestException(`Invalid enrollment data: ${error.response?.data?.message || error.message}`);
      }
      
      if (error.response?.status === 503 || error.isCircuitBreakerOpen) {
        throw new ServiceUnavailableException(`Finance service is currently unavailable`);
      }
      
      throw error;
    }
  }

  /**
   * Prepare Invoice Entity - Calls finance-service to create invoice
   * POST /finance/invoices
   * 
   * @param tenantId - Tenant ID
   * @param enrollment - Enrollment object
   * @param tuitionConfig - TuitionConfiguration object (extract ID from entityKey)
   * @param invoiceCalculation - Invoice calculation result
   * @param accountId - Billing account ID
   * @param context - Request context
   */
  async prepareInvoiceEntity(
    tenantId: string,
    enrollment: Enrollment,
    tuitionConfig: TuitionConfiguration,
    invoiceCalculation: {
      lineItems: Invoice['lineItems'];
      subtotal: number;
      discounts: number;
      tax: number;
      total: number;
      currency: string;
    },
    accountId: string,
    context: RequestContext
  ): Promise<Invoice> {
    try {
      const url = '/finance/invoices';
      const httpContext: HttpClientRequestContext = {
        tenantId,
        userId: context.userId,
        userRole: context.userRole,
        jwtToken: context.jwtToken
      };

      // Extract tuitionConfigId from entityKey
      const tuitionConfigId = tuitionConfig.entityKey || `SCHOOL#${enrollment.schoolId}#YEAR#${enrollment.academicYearId}#TUITION_CONFIG`;

      const response = await this.httpClient.post<Invoice>(
        url,
        {
          enrollment,
          tuitionConfigId,
          invoiceCalculation,
          accountId
        },
        {
          baseURL: this.financeServiceBaseUrl
        },
        httpContext
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to create invoice: ${error.message}`, error.stack);
      
      if (error.response?.status === 400) {
        throw new BadRequestException(`Invalid invoice data: ${error.response?.data?.message || error.message}`);
      }
      
      if (error.response?.status === 503 || error.isCircuitBreakerOpen) {
        throw new ServiceUnavailableException(`Finance service is currently unavailable`);
      }
      
      throw error;
    }
  }

  /**
   * Select Payment Plan - Calls finance-service to select payment plan
   * POST /finance/payment-plans/select?schoolId={schoolId}&academicYearId={academicYearId}
   * 
   * @param tuitionConfig - TuitionConfiguration object (extract schoolId and academicYearId)
   * @param total - Total amount
   */
  async selectPaymentPlan(
    tuitionConfig: TuitionConfiguration,
    total: number
  ): Promise<{
    paymentPlan: 'full' | 'installment' | 'custom';
    installmentCount?: number;
    installmentAmount?: number;
    nextDueDate?: string;
  }> {
    try {
      const schoolId = tuitionConfig.schoolId;
      const academicYearId = tuitionConfig.academicYearId;
      const tenantId = tuitionConfig.tenantId;

      const url = `/finance/payment-plans/select?schoolId=${encodeURIComponent(schoolId)}&academicYearId=${encodeURIComponent(academicYearId)}`;
      const context: HttpClientRequestContext = {
        tenantId,
        userId: 'system',
        jwtToken: undefined
      };

      const response = await this.httpClient.post<{
        paymentPlan: 'full' | 'installment' | 'custom';
        installmentCount?: number;
        installmentAmount?: number;
        nextDueDate?: string;
      }>(
        url,
        {
          tuitionConfigId: tuitionConfig.entityKey || `SCHOOL#${schoolId}#YEAR#${academicYearId}#TUITION_CONFIG`,
          total
        },
        {
          baseURL: this.financeServiceBaseUrl
        },
        context
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to select payment plan: ${error.message}`, error.stack);
      
      if (error.response?.status === 400) {
        throw new BadRequestException(`Invalid payment plan selection: ${error.response?.data?.message || error.message}`);
      }
      
      if (error.response?.status === 503 || error.isCircuitBreakerOpen) {
        throw new ServiceUnavailableException(`Finance service is currently unavailable`);
      }
      
      throw error;
    }
  }
}

