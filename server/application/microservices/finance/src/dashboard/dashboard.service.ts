/**
 * Dashboard Service
 *
 * Provides aggregated financial metrics for the admin dashboard.
 * Queries invoices and payments in the school partition and computes
 * totals, counts, and collection rates server-side.
 *
 * Includes a 5-minute in-memory cache per school to avoid repeated
 * heavy aggregation queries. Acceptable cache divergence for MVP
 * with single-instance deployment.
 */

import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { InvoiceEntity } from '../common/entities/invoice.entity';
import { PaymentEntity } from '../common/entities/payment.entity';
import { GSIKeyBuilder, RequestContext } from '../common/entities/base.entity';

export interface DashboardSummary {
  totalInvoiced: number;
  totalCollected: number;
  totalOutstanding: number;
  totalOverdue: number;
  collectionRate: number;
  invoiceCounts: {
    draft: number;
    issued: number;
    partially_paid: number;
    paid: number;
    overdue: number;
    cancelled: number;
  };
  paymentsByGateway: Record<string, { count: number; total: number }>;
  recentPayments: Array<{
    paymentId: string;
    studentName: string;
    amount: number;
    gateway: string;
    status: string;
    createdAt: string;
  }>;
}

interface CacheEntry {
  data: DashboardSummary;
  expiresAt: number;
}

/** Cache TTL: 5 minutes */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Max items per entity type to prevent runaway queries */
const MAX_ITEMS = 10_000;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  async getSummary(
    schoolId: string,
    context: RequestContext,
  ): Promise<DashboardSummary> {
    const cacheKey = `${context.tenantId}:${schoolId}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    // Fetch all invoices and payments in parallel
    const [invoices, payments] = await Promise.all([
      this.fetchAllEntities<InvoiceEntity>(client, gsi1pk, 'INVOICE'),
      this.fetchAllEntities<PaymentEntity>(client, gsi1pk, 'PAYMENT'),
    ]);

    // Compute invoice aggregates
    const invoiceCounts = {
      draft: 0,
      issued: 0,
      partially_paid: 0,
      paid: 0,
      overdue: 0,
      cancelled: 0,
    };

    let totalInvoiced = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;
    let totalOverdue = 0;

    for (const inv of invoices) {
      const status = inv.status as keyof typeof invoiceCounts;
      if (status in invoiceCounts) {
        invoiceCounts[status]++;
      }

      // Only count issued/active invoices for financial totals
      if (['issued', 'partially_paid', 'paid', 'overdue'].includes(inv.status)) {
        totalInvoiced += inv.grandTotal;
        totalCollected += inv.amountPaid;

        if (inv.status === 'overdue') {
          totalOverdue += inv.amountDue;
          totalOutstanding += inv.amountDue;
        } else if (inv.status !== 'paid') {
          totalOutstanding += inv.amountDue;
        }
      }
    }

    const collectionRate = totalInvoiced > 0
      ? Math.round((totalCollected / totalInvoiced) * 10000) / 100
      : 0;

    // Compute payment aggregates by gateway
    const paymentsByGateway: Record<string, { count: number; total: number }> = {};
    const completedPayments = payments.filter(p => p.status === 'completed');

    for (const pay of completedPayments) {
      const gateway = pay.gateway || 'unknown';
      if (!paymentsByGateway[gateway]) {
        paymentsByGateway[gateway] = { count: 0, total: 0 };
      }
      paymentsByGateway[gateway].count++;
      paymentsByGateway[gateway].total += pay.amount;
    }

    // Recent payments (last 10 completed)
    const recentPayments = completedPayments
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map(p => ({
        paymentId: p.paymentId,
        studentName: p.paidBy || p.studentId || '',
        amount: p.amount,
        gateway: p.gateway || 'unknown',
        status: p.status,
        createdAt: p.createdAt,
      }));

    const summary: DashboardSummary = {
      totalInvoiced: Math.round(totalInvoiced * 100) / 100,
      totalCollected: Math.round(totalCollected * 100) / 100,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      totalOverdue: Math.round(totalOverdue * 100) / 100,
      collectionRate,
      invoiceCounts,
      paymentsByGateway,
      recentPayments,
    };

    // Cache the result
    this.cache.set(cacheKey, {
      data: summary,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return summary;
  }

  private async fetchAllEntities<T>(
    client: any,
    gsi1pk: string,
    entityPrefix: string,
  ): Promise<T[]> {
    const allItems: T[] = [];
    let lastKey: Record<string, any> | undefined;

    do {
      const result = await this.dynamoDBClient.queryGSI<T>(
        client,
        'GSI1',
        gsi1pk,
        entityPrefix,
        'begins_with',
        undefined,
        undefined,
        undefined,
        500, // Page size
        false,
        lastKey,
      );

      allItems.push(...result.items);

      if (allItems.length >= MAX_ITEMS) {
        this.logger.warn(`Hit ${MAX_ITEMS} item limit for ${entityPrefix} aggregation`);
        break;
      }

      lastKey = result.lastEvaluatedKey ? JSON.parse(result.lastEvaluatedKey) : undefined;
    } while (lastKey);

    return allItems;
  }
}
