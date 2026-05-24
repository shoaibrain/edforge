/**
 * EnrollmentTransitionHandlerService — Sprint D.2.9
 *
 * Subscribes (synchronously, via DI) to ResultCardsService.publish for
 * the cross-year handoff. When a terminal ResultCard is published, this
 * handler:
 *   1. Looks up the provisional AY2 enrollments that point to the
 *      AY1 enrollment via GSI10 (priorEnrollmentId-centric, sparse).
 *   2. Hands them to EnrollmentFlipService for atomic provisional→enrolled.
 *
 * **Why synchronous DI instead of @OnEvent / EventEmitter:**
 * `@nestjs/event-emitter` is not a dependency of this monorepo. The
 * sprint plan's recommended Option (a) "in-process @OnEvent" mapped
 * exactly to a synchronous service-method call in NestJS DI terms.
 * Same semantics, no new dependency, the call is invoked from
 * ResultCardsService.publish() after the publish + audit succeed.
 *
 * **Idempotency:** the flip itself is idempotent via the
 * `status = 'provisional'` condition expression on the Update. Re-firing
 * this handler on the same cardId is safe — already-flipped rows return
 * `skipped`, not `failed`.
 *
 * **Non-terminal events are early-returns:** only terminal exams trigger
 * cross-year promotion. Mid-year publishes (Term-1, Term-2, send-up,
 * pre-board) call this handler but bail before any DDB work.
 *
 * @see docs/pilot-greenlight/d2-sprint-plan.md §4 D.2.9
 */

import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { Enrollment, enrollmentPriorGsi10pk } from '../common/entities/enrollment.entity';
import { EnrollmentFlipService, FlipResult } from './enrollment-flip.service';

export interface ResultPublishedNotification {
  tenantId: string;
  cardId: string;
  /** AY1 (prior-AY) enrollmentId — provenance for the flip lookup. */
  enrollmentId: string;
  schoolId: string;
  termId: string;
  examId: string;
  isTerminal: boolean;
}

@Injectable()
export class EnrollmentTransitionHandlerService {
  private readonly logger = new Logger(EnrollmentTransitionHandlerService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly flipService: EnrollmentFlipService,
  ) {}

  /**
   * Handle a `result.published` notification. Called synchronously from
   * `ResultCardsService.publish` (post-publish, post-event-emit). Errors
   * are caught + logged — they must NEVER bubble up to fail the publish.
   *
   * Returns the FlipResult on terminal events, or `null` on
   * non-terminal events or no provisional rows.
   */
  async handleResultPublished(
    notification: ResultPublishedNotification,
  ): Promise<FlipResult | null> {
    const { tenantId, cardId, enrollmentId, isTerminal } = notification;

    if (!isTerminal) {
      this.logger.debug(
        `handleResultPublished: non-terminal exam (cardId=${cardId}); no flip`,
      );
      return null;
    }

    try {
      const provisionals = await this.findProvisionalsByPrior(tenantId, enrollmentId);
      if (provisionals.length === 0) {
        this.logger.debug(
          `handleResultPublished: no provisional AY2 rows for priorEnrollmentId=${enrollmentId}; cardId=${cardId}; no-op`,
        );
        return null;
      }

      this.logger.log(
        `handleResultPublished: flipping ${provisionals.length} provisional row(s) for priorEnrollmentId=${enrollmentId}; cardId=${cardId}`,
      );

      return await this.flipService.promoteProvisionalToEnrolled(provisionals, {
        tenantId,
        userId: 'system:enrollment-transition-handler',
        triggeringCardId: cardId,
      });
    } catch (err: unknown) {
      // Catch-all: this handler MUST NOT throw, so a downstream DDB
      // outage doesn't poison the upstream ResultCardsService.publish.
      // Operator can manually re-trigger the flip via a follow-up
      // smoke + script if a transient failure swallows the flip.
      this.logger.error(
        `handleResultPublished: flip failed for cardId=${cardId} priorEnrollmentId=${enrollmentId}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return null;
    }
  }

  /**
   * GSI10 query for provisional AY2 enrollments whose `priorEnrollmentId`
   * matches the just-published AY1 enrollment. Sparse index → only
   * provisional/post-commit rows surface here.
   */
  private async findProvisionalsByPrior(
    tenantId: string,
    priorEnrollmentId: string,
  ): Promise<Enrollment[]> {
    const client = this.dynamoDBClient.getSystemClient();
    const result = await this.dynamoDBClient.queryGSI<Enrollment>(
      client,
      'GSI10',
      enrollmentPriorGsi10pk(priorEnrollmentId),
      'ENROLLMENT#',
      'begins_with',
      // Belt-and-suspenders: GSI10 is already sparse (only rows with
      // priorEnrollmentId carry the keys), but filter on status too so
      // a future non-provisional use of GSI10 doesn't double-flip.
      '#status = :provisional',
      { ':provisional': 'provisional' },
      { '#status': 'status' },
      100,
    );
    return result.items;
  }
}
