/**
 * AgreementResolverService — EPIC-FB Sprint FB-3.1
 *
 * The single read path invoice generation uses to answer "which ACTIVE
 * agreement covers this student on this date?" (epic §3.3). Package E
 * wires it into all three generation paths (manual, bulk worker,
 * enrollment webhook).
 *
 * Date-bounded by design: the GSI2 key condition
 * `gsi2sk >= 'AGREEMENT#active#{onDate}'` excludes stale-active pointers
 * whose effectiveTo already passed, and the hydrated agreement row is
 * re-verified (`status === 'active'` AND `effectiveFrom <= onDate <=
 * effectiveTo`) — **pointer status is NEVER trusted alone** (epic §3.2
 * lazy-expiry contract; also why cancelled/superseded rows behind a stale
 * pointer can never price an invoice).
 *
 * NB the epic sketch writes the bound as a strict `>`; `>=` is required so
 * an agreement whose effectiveTo IS onDate (inclusive last day of term)
 * still resolves — the on-To boundary test pins this.
 */

import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  AgreementMemberEntity,
  BillingAgreementEntity,
} from '../common/entities/billing-agreement.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
} from '../common/entities/base.entity';

export interface ResolvedAgreement {
  agreement: BillingAgreementEntity;
  /**
   * The negotiated amount for THIS student: the `fixed_total` allocation
   * entry, or the sum of the student's `per_student` lines. `null` when a
   * per_student agreement carries no line for the student (member covered
   * for suppression purposes but with no replacement amount).
   */
  allocationForStudent: number | null;
}

/** Memo map for bulk reuse — see getActiveAgreementForStudent JSDoc. */
export type AgreementResolutionMemo = Map<string, ResolvedAgreement | null>;

@Injectable()
export class AgreementResolverService {
  private readonly logger = new Logger(AgreementResolverService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * Resolve the active agreement covering (studentId, schoolId) on
   * `onDateISO` (AD `YYYY-MM-DD`). Returns `null` when the student has no
   * active agreement covering that date.
   *
   * **Memoization (for Package E's bulk worker):** pass ONE `memo` Map per
   * bulk run (`new Map()` at job start) and every repeat (student, date)
   * resolution inside the run is served from memory — including negative
   * results. The memo is caller-owned and per-call-graph, so there is no
   * cross-request staleness and nothing to `.clear()`; drop the Map when
   * the run ends. Single-invoice callers simply omit it.
   */
  async getActiveAgreementForStudent(
    studentId: string,
    schoolId: string,
    onDateISO: string,
    context: RequestContext,
    memo?: AgreementResolutionMemo,
  ): Promise<ResolvedAgreement | null> {
    const memoKey = `${context.tenantId}#${schoolId}#${studentId}#${onDateISO}`;
    if (memo?.has(memoKey)) {
      return memo.get(memoKey) ?? null;
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Finance GSI convention (risk R1): pk carries the TENANT# prefix —
    // the only tenant scoping on GSI reads. Pinned by the resolver spec.
    const gsi2pk = GSIKeyBuilder.studentScope(context.tenantId, studentId);

    const pointers = await this.dynamoDBClient.queryGSI<AgreementMemberEntity>(
      client,
      'GSI2',
      gsi2pk,
      `AGREEMENT#active#${onDateISO}`,
      'gte',
      undefined,
      undefined,
      undefined,
      25,
      true,
    );

    // The >= range also admits pointers of statuses sorting after 'active'
    // (cancelled/draft/expired/superseded) AND unrelated GSI2 rows that sort
    // after 'AGREEMENT#' on the same pk (CREDIT_NOTE#/INVOICE#/PAYMENT#…) —
    // an agreement-priced invoice even carries a top-level agreementId, so
    // without the entityType pre-filter it would re-hydrate the same
    // agreement and trip the multi-match WARN on every resolution
    // (review P2-3). Hydration remains the correctness authority.
    const candidates = pointers.items.filter(
      (p) => p.entityType === 'AGREEMENT_MEMBER' && p.schoolId === schoolId,
    );

    let resolved: ResolvedAgreement | null = null;
    const matches: BillingAgreementEntity[] = [];
    const seenAgreementIds = new Set<string>();

    for (const pointer of candidates) {
      if (seenAgreementIds.has(pointer.agreementId)) continue;
      seenAgreementIds.add(pointer.agreementId);
      const agreement = await this.dynamoDBClient.getItem<BillingAgreementEntity>(
        client,
        context.tenantId,
        EntityKeyBuilder.agreement(schoolId, pointer.agreementId),
      );
      if (!agreement) continue;
      if (agreement.isActive === false) continue;
      if (agreement.schoolId !== schoolId) continue;
      if (agreement.status !== 'active') continue;
      if (agreement.effectiveFrom > onDateISO || agreement.effectiveTo < onDateISO) continue;
      if (!agreement.studentIds.includes(studentId)) continue;
      matches.push(agreement);
    }

    if (matches.length > 0) {
      if (matches.length > 1) {
        // Post-FB-3.5 locks this cannot happen; tolerate legacy/raced data
        // deterministically rather than 500ing generation.
        this.logger.warn(
          `Multiple active agreements resolved for student ${studentId} at school ${schoolId} on ${onDateISO}: ` +
            matches.map((m) => m.agreementId).join(', ') +
            ' — picking earliest effectiveFrom.',
        );
        matches.sort(
          (a, b) =>
            a.effectiveFrom.localeCompare(b.effectiveFrom) ||
            a.agreementId.localeCompare(b.agreementId),
        );
      }
      const agreement = matches[0];
      resolved = {
        agreement,
        allocationForStudent: this.allocationFor(agreement, studentId),
      };
    }

    memo?.set(memoKey, resolved);
    return resolved;
  }

  private allocationFor(agreement: BillingAgreementEntity, studentId: string): number | null {
    if (agreement.terms.agreementType === 'fixed_total') {
      const entry = agreement.terms.allocation.find((a) => a.studentId === studentId);
      return entry ? entry.amount : null;
    }
    const lines = agreement.terms.lines.filter((line) => line.studentId === studentId);
    if (lines.length === 0) return null;
    return lines.reduce((sum, line) => sum + line.amount, 0);
  }
}
