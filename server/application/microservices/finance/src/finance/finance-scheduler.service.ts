/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Finance Scheduler Service - Scheduled jobs for finance operations
 * 
 * ARCHITECTURE:
 * - Daily job to detect and update overdue invoices
 * - Uses GSI10 for efficient overdue invoice queries
 * - Updates invoice status atomically with optimistic locking
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FinanceService } from './finance.service';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { EntityKeyBuilder } from '../common/entities/base.entity';

@Injectable()
export class FinanceSchedulerService {
  private readonly logger = new Logger(FinanceSchedulerService.name);

  constructor(
    private readonly financeService: FinanceService,
    private readonly dynamoDBClient: DynamoDBClientService
  ) {}

  /**
   * Daily job to detect and update overdue invoices
   * Runs at 2 AM UTC daily
   * 
   * PROCESS:
   * 1. Query GSI10 for all invoices with status='sent' and dueDate < today
   * 2. Update each invoice status to 'overdue' atomically
   * 3. Log results
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async updateOverdueInvoices(): Promise<void> {
    this.logger.log('Starting overdue invoice detection job...');

    try {
      // Get all schools and academic years (would need to query from School service)
      // For MVP, we'll process invoices per tenant
      // In production, this would iterate through all active schools/years

      // For now, this is a placeholder that would be called per tenant
      // The actual implementation would need to:
      // 1. Get all active schools for all tenants
      // 2. For each school, get active academic years
      // 3. Call processOverdueInvoicesForSchoolYear for each

      this.logger.log('Overdue invoice detection job completed');
    } catch (error) {
      this.logger.error(`Overdue invoice detection job failed: ${error.message}`, error.stack);
    }
  }

  /**
   * Process overdue invoices for a specific school and academic year
   * Called by the scheduled job or manually
   */
  async processOverdueInvoicesForSchoolYear(
    tenantId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<{ updated: number; failed: number }> {
    let updated = 0;
    let failed = 0;

    try {
      // Get overdue invoices using GSI10
      const overdueInvoices = await this.financeService.getOverdueInvoices(
        tenantId,
        schoolId,
        academicYearId
      );

      this.logger.log(`Found ${overdueInvoices.length} overdue invoices for school ${schoolId}, year ${academicYearId}`);

      // Update each invoice status to 'overdue'
      for (const invoice of overdueInvoices) {
        try {
          const timestamp = new Date().toISOString();

          // Update invoice status atomically with optimistic locking
          await this.dynamoDBClient.updateItem(
            tenantId,
            invoice.entityKey,
            'SET #status = :status, updatedAt = :timestamp, #version = #version + :inc, gsi10pk = :gsi10pk, gsi10sk = :gsi10sk',
            {
              ':status': 'overdue',
              ':timestamp': timestamp,
              ':inc': 1,
              ':gsi10pk': `${schoolId}#${academicYearId}#overdue`,
              ':gsi10sk': `${invoice.dueDate}#${invoice.invoiceId}`,
              ':currentVersion': invoice.version
            },
            '#version = :currentVersion',
            {
              '#status': 'status',
              '#version': 'version'
            }
          );

          updated++;
          this.logger.debug(`Updated invoice ${invoice.invoiceId} to overdue status`);
        } catch (error) {
          failed++;
          this.logger.error(`Failed to update invoice ${invoice.invoiceId}: ${error.message}`);
        }
      }

      this.logger.log(
        `Overdue invoice processing completed: ${updated} updated, ${failed} failed for school ${schoolId}, year ${academicYearId}`
      );

      return { updated, failed };
    } catch (error) {
      this.logger.error(
        `Failed to process overdue invoices for school ${schoolId}, year ${academicYearId}: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }
}

