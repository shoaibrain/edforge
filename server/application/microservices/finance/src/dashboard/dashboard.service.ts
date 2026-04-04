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

export interface GradeLevelBreakdown {
  gradeLevel: string;
  invoiceCount: number;
  totalInvoiced: number;
  totalCollected: number;
  outstanding: number;
}

export interface FeeTypeBreakdown {
  feeType: string;
  invoiceCount: number;
  totalAmount: number;
  collectedAmount: number;
}

export interface AgingBucket {
  label: string;
  minDays: number;
  maxDays: number | null;
  count: number;
  amount: number;
}

export interface MonthlyCollection {
  month: string; // YYYY-MM
  collected: number;
  invoiced: number;
  paymentCount: number;
}

export interface DashboardSummary {
  totalInvoiced: number;
  totalCollected: number;
  outstanding: number;
  overdue: number;
  collectionRate: number;
  invoicesByStatus: Record<string, number>;
  paymentsByGateway: Record<string, number>;
  byGradeLevel: GradeLevelBreakdown[];
  byFeeType: FeeTypeBreakdown[];
  agingReport: AgingBucket[];
  monthlyCollections: MonthlyCollection[];
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

    // Grade-level and fee-type breakdowns
    const gradeMap = new Map<string, GradeLevelBreakdown>();
    const feeTypeMap = new Map<string, FeeTypeBreakdown>();

    // Aging buckets: current, 1-30, 31-60, 61-90, 90+
    const now = Date.now();
    const agingBuckets: AgingBucket[] = [
      { label: 'Current', minDays: 0, maxDays: 0, count: 0, amount: 0 },
      { label: '1-30 days', minDays: 1, maxDays: 30, count: 0, amount: 0 },
      { label: '31-60 days', minDays: 31, maxDays: 60, count: 0, amount: 0 },
      { label: '61-90 days', minDays: 61, maxDays: 90, count: 0, amount: 0 },
      { label: '90+ days', minDays: 91, maxDays: null, count: 0, amount: 0 },
    ];

    for (const inv of invoices) {
      if (inv.status in invoicesByStatus) {
        invoicesByStatus[inv.status]++;
      }

      const isActive = ['issued', 'partially_paid', 'paid', 'overdue'].includes(inv.status);

      // Only count issued/active invoices for financial totals
      if (isActive) {
        totalInvoiced += inv.grandTotal;
        totalCollected += inv.amountPaid;

        if (inv.status === 'overdue') {
          overdue += inv.amountDue;
          outstanding += inv.amountDue;
        } else if (inv.status !== 'paid') {
          outstanding += inv.amountDue;
        }
      }

      // S3-T3: Grade-level breakdown
      if (isActive) {
        const grade = (inv as any).gradeLevel || 'Unknown';
        const existing = gradeMap.get(grade) || {
          gradeLevel: grade, invoiceCount: 0, totalInvoiced: 0, totalCollected: 0, outstanding: 0,
        };
        existing.invoiceCount++;
        existing.totalInvoiced += inv.grandTotal;
        existing.totalCollected += inv.amountPaid;
        if (inv.status !== 'paid') existing.outstanding += inv.amountDue;
        gradeMap.set(grade, existing);
      }

      // S3-T4: Fee-type breakdown (from line items)
      if (isActive && inv.lineItems) {
        for (const li of inv.lineItems) {
          const feeType = li.feeType || 'other';
          const existing = feeTypeMap.get(feeType) || {
            feeType, invoiceCount: 0, totalAmount: 0, collectedAmount: 0,
          };
          existing.totalAmount += li.total;
          feeTypeMap.set(feeType, existing);
        }
        // Count invoice once per fee type it contains
        const types = new Set(inv.lineItems.map(li => li.feeType || 'other'));
        for (const ft of types) {
          const entry = feeTypeMap.get(ft)!;
          entry.invoiceCount++;
          // Proportional collection: distribute amountPaid across fee types by ratio
          if (inv.grandTotal > 0) {
            const typeTotal = inv.lineItems
              .filter(li => (li.feeType || 'other') === ft)
              .reduce((s, li) => s + li.total, 0);
            entry.collectedAmount += inv.amountPaid * (typeTotal / inv.grandTotal);
          }
        }
      }

      // S3-T5: Aging report — only for overdue/unpaid invoices
      if (['issued', 'partially_paid', 'overdue'].includes(inv.status) && inv.dueDate) {
        const dueDateMs = new Date(inv.dueDate).getTime();
        const daysOverdue = Math.max(0, Math.floor((now - dueDateMs) / (1000 * 60 * 60 * 24)));

        for (const bucket of agingBuckets) {
          const inRange = bucket.maxDays === null
            ? daysOverdue >= bucket.minDays
            : daysOverdue >= bucket.minDays && daysOverdue <= bucket.maxDays;
          if (inRange) {
            bucket.count++;
            bucket.amount += inv.amountDue;
            break;
          }
        }
      }
    }

    const collectionRate = totalInvoiced > 0
      ? Math.round((totalCollected / totalInvoiced) * 10000) / 100
      : 0;

    // Compute payment aggregates by gateway (count per gateway)
    const paymentsByGateway: Record<string, number> = {};
    const completedPayments = payments.filter(p => p.status === 'completed');

    // S3-T6: Monthly collection summary
    const monthlyMap = new Map<string, MonthlyCollection>();

    for (const pay of completedPayments) {
      const gateway = pay.gateway || 'unknown';
      paymentsByGateway[gateway] = (paymentsByGateway[gateway] || 0) + 1;

      // Aggregate by month
      const payDate = pay.paidAt || pay.createdAt;
      const month = payDate.substring(0, 7); // YYYY-MM
      const existing = monthlyMap.get(month) || { month, collected: 0, invoiced: 0, paymentCount: 0 };
      existing.collected += pay.amount;
      existing.paymentCount++;
      monthlyMap.set(month, existing);
    }

    // Fill in monthly invoiced amounts
    for (const inv of invoices) {
      if (['issued', 'partially_paid', 'paid', 'overdue'].includes(inv.status) && inv.issuedDate) {
        const month = inv.issuedDate.substring(0, 7);
        const existing = monthlyMap.get(month) || { month, collected: 0, invoiced: 0, paymentCount: 0 };
        existing.invoiced += inv.grandTotal;
        monthlyMap.set(month, existing);
      }
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

    // Round monetary values in breakdowns
    const roundMoney = (n: number) => Math.round(n * 100) / 100;

    const summary: DashboardSummary = {
      totalInvoiced: roundMoney(totalInvoiced),
      totalCollected: roundMoney(totalCollected),
      outstanding: roundMoney(outstanding),
      overdue: roundMoney(overdue),
      collectionRate,
      invoicesByStatus,
      paymentsByGateway,
      byGradeLevel: [...gradeMap.values()]
        .map(g => ({
          ...g,
          totalInvoiced: roundMoney(g.totalInvoiced),
          totalCollected: roundMoney(g.totalCollected),
          outstanding: roundMoney(g.outstanding),
        }))
        .sort((a, b) => a.gradeLevel.localeCompare(b.gradeLevel)),
      byFeeType: [...feeTypeMap.values()]
        .map(f => ({
          ...f,
          totalAmount: roundMoney(f.totalAmount),
          collectedAmount: roundMoney(f.collectedAmount),
        }))
        .sort((a, b) => b.totalAmount - a.totalAmount),
      agingReport: agingBuckets.map(b => ({ ...b, amount: roundMoney(b.amount) })),
      monthlyCollections: [...monthlyMap.values()]
        .map(m => ({
          ...m,
          collected: roundMoney(m.collected),
          invoiced: roundMoney(m.invoiced),
        }))
        .sort((a, b) => a.month.localeCompare(b.month)),
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
