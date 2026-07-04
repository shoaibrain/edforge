/**
 * SiblingCountResolver — EPIC-FB FB-5.1
 *
 * The single read path the sibling discount-rule evaluator (FB-5.2) uses to
 * answer "how many active family members does this student have?". Resolves
 * over the academics HTTP API via `IdentityClientService.getStudentFamily`
 * — finance never reads the academics table directly (epic §3.0), so no
 * cross-service IAM grant is needed.
 *
 * **Count definition (pinned by spec):** the count INCLUDES the subject
 * student — a 2-child family counts 2, so a rule with `minSiblings: 2`
 * matches both children of a 2-child family.
 *   - The subject student always contributes 1: they are the student being
 *     invoiced right now; their own lifecycle status is not re-checked
 *     (generation does not status-gate the subject anywhere else either).
 *   - Each sibling contributes 1 only when its `status === 'active'`.
 *     A missing status (academics build predating the FB-5.1 field, or a
 *     sibling row that failed the batch get) counts as NOT active — during
 *     a mixed-version rollout we prefer missing a discount over granting
 *     an unearned one.
 *
 * **Degrade matrix — returns 0, NEVER throws** (a family-service outage
 * must never 5xx invoice generation):
 *   - student not linked to any family (`family: null`)          → 0
 *   - academics 404 (FAMILY_GROUPS flag off / route absent)      → 0
 *   - academics 5xx / network / timeout (client returns null)    → 0
 *   - any unexpected throw from the client itself (WARN logged)  → 0
 */

import { Injectable, Logger } from '@nestjs/common';
import { IdentityClientService } from '../common/services/identity-client.service';
import { RequestContext } from '../common/entities/base.entity';

/**
 * Per-request/per-job memo (same caller-owned pattern as
 * `AgreementResolutionMemo`): key `{tenantId}#{schoolId}#{studentId}`,
 * value = resolved count (including negative results as 0). Create one
 * Map per bulk run; drop it when the run ends.
 */
export type SiblingCountMemo = Map<string, number>;

@Injectable()
export class SiblingCountResolver {
  private readonly logger = new Logger(SiblingCountResolver.name);

  constructor(private readonly identityClient: IdentityClientService) {}

  async getActiveSiblingCount(
    studentId: string,
    schoolId: string,
    context: RequestContext,
    memo?: SiblingCountMemo,
  ): Promise<number> {
    const memoKey = `${context.tenantId}#${schoolId}#${studentId}`;
    if (memo?.has(memoKey)) {
      return memo.get(memoKey) ?? 0;
    }

    let count = 0;
    try {
      const view = await this.identityClient.getStudentFamily(studentId, schoolId, context);
      if (view?.family) {
        const activeSiblings = (view.siblings ?? []).filter(
          (s) => s.status === 'active',
        ).length;
        count = 1 + activeSiblings;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `getActiveSiblingCount: family resolution failed studentId=${studentId} ` +
          `schoolId=${schoolId}: ${message.slice(0, 200)} — counting 0 (no discount)`,
      );
      count = 0;
    }

    memo?.set(memoKey, count);
    return count;
  }
}
