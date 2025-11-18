/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Finance HTTP Client - Stub for calling finance-service via HTTP
 * 
 * TODO: Phase 4 - Implement HTTP client to call finance-service
 * This is a temporary stub to allow code to compile after removing FinanceModule
 */

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class FinanceHttpClientService {
  private readonly logger = new Logger(FinanceHttpClientService.name);

  /**
   * Get Tuition Configuration from finance-service
   * TODO: Implement HTTP call to finance-service
   */
  async getTuitionConfiguration(
    tenantId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<any> {
    this.logger.warn('FinanceHttpClientService.getTuitionConfiguration() not yet implemented. Please implement HTTP call to finance-service in Phase 4.');
    throw new Error('FinanceHttpClientService.getTuitionConfiguration() not yet implemented. This will be implemented in Phase 4.');
  }

  /**
   * Calculate Invoice - Pure function
   * TODO: Move this to a shared utility or call finance-service
   */
  calculateInvoice(enrollment: any, tuitionConfig: any): any {
    this.logger.warn('FinanceHttpClientService.calculateInvoice() not yet implemented. Please implement HTTP call to finance-service in Phase 4.');
    throw new Error('FinanceHttpClientService.calculateInvoice() not yet implemented. This will be implemented in Phase 4.');
  }

  /**
   * Prepare Invoice Entity
   * TODO: Move this to a shared utility or call finance-service
   */
  prepareInvoiceEntity(
    tenantId: string,
    enrollment: any,
    tuitionConfig: any,
    invoiceCalculation: any,
    accountId: string,
    context: any
  ): any {
    this.logger.warn('FinanceHttpClientService.prepareInvoiceEntity() not yet implemented. Please implement HTTP call to finance-service in Phase 4.');
    throw new Error('FinanceHttpClientService.prepareInvoiceEntity() not yet implemented. This will be implemented in Phase 4.');
  }

  /**
   * Select Payment Plan
   * TODO: Move this to a shared utility or call finance-service
   */
  selectPaymentPlan(tuitionConfig: any, total: number): any {
    this.logger.warn('FinanceHttpClientService.selectPaymentPlan() not yet implemented. Please implement HTTP call to finance-service in Phase 4.');
    throw new Error('FinanceHttpClientService.selectPaymentPlan() not yet implemented. This will be implemented in Phase 4.');
  }
}

