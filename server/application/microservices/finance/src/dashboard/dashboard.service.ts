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

export interface DashboardFilters {
  from?: string;   // ISO date YYYY-MM-DD
  to?: string;     // ISO date YYYY-MM-DD
  academicYear?: string;
}

export interface DashboardSummary {
  totalInvoiced: number;
  totalCollected: number;
  outstanding: number;
  overdue: number;
  collectionRate: number;
  invoicesByStatus: Record<string, number>;
  paymentsByGateway: Record<string, number>;
  recentPayments: Array<{
    id: string;
    amount: number;
    gateway: string;
    status: string;
    receiptNumber?: string;
    paidAt?: string;
    createdAt: string;
  }>;
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    studentName: string;
    grandTotal: number;
    amountDue: number;
    status: string;
    issuedDate: string;
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
    filters: DashboardFilters = {},
  ): Promise<DashboardSummary> {
    const cacheKey = `${context.tenantId}:${schoolId}:${filters.from || ''}:${filters.to || ''}:${filters.academicYear || ''}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    // Fetch all invoices and payments in parallel
    const [allInvoices, allPayments] = await Promise.all([
      this.fetchAllEntities<InvoiceEntity>(client, gsi1pk, 'INVOICE'),
      this.fetchAllEntities<PaymentEntity>(client, gsi1pk, 'PAYMENT'),
    ]);

    // Apply filters
    const invoices = allInvoices.filter(inv => {
      if (filters.academicYear && inv.academicYear !== filters.academicYear) return false;
      if (filters.from && inv.issuedDate < filters.from) return false;
      if (filters.to && inv.issuedDate > filters.to + 'T23:59:59.999Z') return false;
      return true;
    });

    const payments = allPayments.filter(pay => {
      const payDate = pay.paidAt || pay.createdAt;
      if (filters.from && payDate < filters.from) return false;
      if (filters.to && payDate > filters.to + 'T23:59:59.999Z') return false;
      return true;
    });

    // Compute invoice aggregates
    const invoicesByStatus: Record<string, number> = {
      draft: 0,
      issued: 0,
      partially_paid: 0,
      paid: 0,
      overdue: 0,
      cancelled: 0,
    };

    let totalInvoiced = 0;
    let totalCollected = 0;
    let outstanding = 0;
    let overdue = 0;

    for (const inv of invoices) {
      if (inv.status in invoicesByStatus) {
        invoicesByStatus[inv.status]++;
      }

      // Only count issued/active invoices for financial totals
      if (['issued', 'partially_paid', 'paid', 'overdue'].includes(inv.status)) {
        totalInvoiced += inv.grandTotal;
        totalCollected += inv.amountPaid;

        if (inv.status === 'overdue') {
          overdue += inv.amountDue;
          outstanding += inv.amountDue;
        } else if (inv.status !== 'paid') {
          outstanding += inv.amountDue;
        }
      }
    }

    const collectionRate = totalInvoiced > 0
      ? Math.round((totalCollected / totalInvoiced) * 10000) / 100
      : 0;

    // Compute payment aggregates by gateway (count per gateway)
    const paymentsByGateway: Record<string, number> = {};
    const completedPayments = payments.filter(p => p.status === 'completed');

    for (const pay of completedPayments) {
      const gateway = pay.gateway || 'unknown';
      paymentsByGateway[gateway] = (paymentsByGateway[gateway] || 0) + 1;
    }

    // Recent payments (last 10 completed)
    const recentPayments = completedPayments
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map(p => ({
        id: p.paymentId,
        amount: p.amount,
        gateway: p.gateway || 'unknown',
        status: p.status,
        receiptNumber: p.receiptNumber || undefined,
        paidAt: p.paidAt || undefined,
        createdAt: p.createdAt,
      }));

    // Recent invoices (last 10 by creation date)
    const recentInvoices = [...invoices]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map(inv => ({
        id: inv.invoiceId,
        invoiceNumber: inv.invoiceNumber,
        studentName: inv.studentName || '',
        grandTotal: inv.grandTotal,
        amountDue: inv.amountDue,
        status: inv.status,
        issuedDate: inv.issuedDate,
        createdAt: inv.createdAt,
      }));

    const summary: DashboardSummary = {
      totalInvoiced: Math.round(totalInvoiced * 100) / 100,
      totalCollected: Math.round(totalCollected * 100) / 100,
      outstanding: Math.round(outstanding * 100) / 100,
      overdue: Math.round(overdue * 100) / 100,
      collectionRate,
      invoicesByStatus,
      paymentsByGateway,
      recentPayments,
      recentInvoices,
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
