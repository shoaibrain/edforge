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
import { BillingAgreementEntity } from '../common/entities/billing-agreement.entity';
import { GSIKeyBuilder, RequestContext } from '../common/entities/base.entity';
import { todayIsoDate } from '../common/mappers/invoice.mapper';

export interface DashboardFilters {
  from?: string;   // ISO date YYYY-MM-DD
  to?: string;     // ISO date YYYY-MM-DD
  academicYear?: string;
  /**
   * EPIC-FB FB-0.3(b) — when true (the default), draft invoices are
   * excluded from the headline money figures (totalInvoiced /
   * totalCollected / outstanding / collectionRate). `invoicesByStatus`
   * keeps reporting drafts as a count either way, and `draftTotals`
   * carries the explicit draft exposure. `excludeDrafts=false` folds
   * drafts back into totalInvoiced + outstanding (the draft-inclusive
   * legacy view).
   */
  excludeDrafts?: boolean;
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
  /**
   * EPIC-FB FB-0.1(d) — overdue EXPOSURE: stored-`overdue` amountDue PLUS
   * past-due `partially_paid` amountDue. The sweep no longer erases the
   * partial-payment signal, so the exposure figure derives it read-side.
   */
  overdue: number;
  collectionRate: number;
  /**
   * Counts by STORED status, with one deliberate FB-0.1(d) overlap: the
   * `overdue` key also counts past-due `partially_paid` rows (overdue
   * exposure) while `partially_paid` keeps counting ALL partials. A
   * past-due partial therefore appears under both keys; the overlap size
   * is exposed as `pastDuePartiallyPaid.count`.
   */
  invoicesByStatus: Record<string, number>;
  /** FB-0.1(d) — the overlap block: past-due partially_paid count + amountDue. */
  pastDuePartiallyPaid: { count: number; amount: number };
  /** FB-0.3(b) — draft exposure (count + grandTotal sum), always reported. */
  draftTotals: { count: number; amount: number };
  /**
   * EPIC-FB FB-5.5 — agreement coverage tile (additive).
   *
   * `studentsCovered` / `activeAgreements` are a NOW-state (today's date),
   * independent of the from/to range filters; `invoicedViaAgreement`
   * derives from the SAME filtered invoice rows the other tiles aggregate
   * (invoices carrying an `agreementId` header) and respects the same
   * draft exclusion as the headline money figures.
   */
  agreementCoverage: {
    studentsCovered: number;
    activeAgreements: number;
    invoicedViaAgreement: { count: number; amount: number };
  };
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
    // FB-0.3(b) — drafts excluded from headline figures unless explicitly
    // opted back in.
    const includeDrafts = filters.excludeDrafts === false;
    const cacheKey = `${context.tenantId}:${schoolId}:${filters.from || ''}:${filters.to || ''}:${filters.academicYear || ''}:${includeDrafts}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    // Fetch all invoices, payments, and (FB-5.5) stored-active agreement
    // rows in parallel
    const [allInvoices, allPayments, activeAgreementRows] = await Promise.all([
      this.fetchAllEntities<InvoiceEntity>(client, gsi1pk, 'INVOICE'),
      this.fetchAllEntities<PaymentEntity>(client, gsi1pk, 'PAYMENT'),
      this.fetchActiveAgreements(client, gsi1pk),
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
    let pastDuePartialCount = 0;
    let pastDuePartialAmount = 0;
    let draftCount = 0;
    let draftAmount = 0;
    let agreementInvoiceCount = 0;
    let agreementInvoiceAmount = 0;
    const today = todayIsoDate();

    // FB-5.5 — lazy-expiry re-check on the stored-active rows: stored
    // status is never trusted alone (epic §3.2); a stale `active` row past
    // effectiveTo must not count as coverage.
    const liveAgreements = activeAgreementRows.filter(
      (a) => a.isActive !== false && a.effectiveFrom <= today && today <= a.effectiveTo,
    );
    const coveredStudentIds = new Set<string>();
    for (const a of liveAgreements) {
      for (const sid of a.studentIds ?? []) coveredStudentIds.add(sid);
    }

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

      // FB-0.1(d) — past-due partials count as overdue exposure (the sweep
      // no longer flips them to stored-overdue). Deliberate overlap with
      // the partially_paid count; surfaced via pastDuePartiallyPaid.
      const isPastDuePartial = inv.status === 'partially_paid' && inv.dueDate < today;
      if (isPastDuePartial) {
        invoicesByStatus.overdue++;
        pastDuePartialCount++;
        pastDuePartialAmount += inv.amountDue;
      }

      if (inv.status === 'draft') {
        draftCount++;
        draftAmount += inv.grandTotal;
        // FB-0.3(b) — legacy draft-inclusive view: drafts fold into the
        // headline invoiced/outstanding figures only (never overdue, never
        // the breakdowns/aging/monthly, which stay issued-and-later).
        if (includeDrafts) {
          totalInvoiced += inv.grandTotal;
          outstanding += inv.amountDue;
        }
      }

      const isActive = ['issued', 'partially_paid', 'paid', 'overdue'].includes(inv.status);

      // FB-5.5 — agreement-priced exposure. Respects the SAME draft
      // exclusion as the headline figures: drafts count only under the
      // legacy draft-inclusive view; cancelled/written_off never count.
      if (inv.agreementId && (isActive || (inv.status === 'draft' && includeDrafts))) {
        agreementInvoiceCount++;
        agreementInvoiceAmount += inv.grandTotal;
      }

      // Only count issued/active invoices for financial totals
      if (isActive) {
        totalInvoiced += inv.grandTotal;
        totalCollected += inv.amountPaid;

        if (inv.status === 'overdue' || isPastDuePartial) {
          overdue += inv.amountDue;
        }
        if (inv.status !== 'paid') {
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
      pastDuePartiallyPaid: {
        count: pastDuePartialCount,
        amount: roundMoney(pastDuePartialAmount),
      },
      draftTotals: { count: draftCount, amount: roundMoney(draftAmount) },
      agreementCoverage: {
        studentsCovered: coveredStudentIds.size,
        activeAgreements: liveAgreements.length,
        invoicedViaAgreement: {
          count: agreementInvoiceCount,
          amount: roundMoney(agreementInvoiceAmount),
        },
      },
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

  /**
   * EPIC-FB FB-5.5 — stored-active agreement rows for the coverage tile.
   *
   * Query choice (cheapest correct): ONE school-scoped GSI1 query on the
   * `AGREEMENT#active#` sk prefix. Agreement rows are the only match —
   * member-pointer rows carry no GSI1 keys — and each row already carries
   * the `studentIds[]` snapshot, so distinct-students-covered derives with
   * zero further queries (the pointer-based alternative costs one GSI2
   * query per student for the same answer). Caller re-verifies dates
   * (lazy expiry) before counting.
   *
   * Best-effort: any failure returns [] (WARN) — a coverage tile must
   * never take the dashboard down.
   */
  private async fetchActiveAgreements(
    client: any,
    gsi1pk: string,
  ): Promise<BillingAgreementEntity[]> {
    try {
      return await this.fetchAllEntities<BillingAgreementEntity>(
        client,
        gsi1pk,
        'AGREEMENT#active#',
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `fetchActiveAgreements failed: ${message.slice(0, 200)} — agreementCoverage reports zeros`,
      );
      return [];
    }
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

      // Hotfix 2026-05-24 — DDB client wrapper base64-encodes
      // LastEvaluatedKey (see finance/.../dynamodb-client.service.ts:144
      // + pagination.dto.ts:23 contract). Direct JSON.parse on the
      // encoded string throws SyntaxError when pagination actually
      // fires. Match the decode pattern every other service uses
      // (academics/students.service.ts, identity/users.service.ts, etc.).
      lastKey = result.lastEvaluatedKey
        ? JSON.parse(Buffer.from(result.lastEvaluatedKey, 'base64').toString())
        : undefined;
    } while (lastKey);

    return allItems;
  }
}
