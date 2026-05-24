/**
 * PromotionBatchService — Sprint D.2.5
 *
 * Backing service for the operator-review-before-commit batch evaluation
 * endpoint: `POST /academics/schools/:id/academic-years/:fromAyId/promote-from`.
 *
 * **Read-only by design.** This service NEVER writes to DDB. It gathers
 * inputs (Enrollments + PromotionRule + ResultCards + Attendance%) and
 * hands them to the pure-function evaluator (D.2.4). The operator
 * reviews suggestions, optionally edits, then POSTs to D.2.6 commit.
 *
 * **Inputs gathered per enrollment in scope:**
 *   1. Enrollment row (via GSI1 query on the cohort)
 *   2. PromotionRule for (schoolId, gradeLevel) — lazy-seeded if absent
 *      via existing PromotionRulesService.listPromotionRules path
 *   3. Terminal ResultCards keyed by enrollmentId via GSI2 with
 *      `isTerminalExam = true` filter
 *   4. Attendance% from AttendanceService.getStudentAttendanceSummary,
 *      scoped to the source AY's date range (looked up via
 *      IdentityClientService.getAcademicYears)
 *
 * **Cohort cap (defensive):** ≤500 enrollments per request. PABSON
 * sections are ~30-40 students; even all grades in a school stay well
 * under 500. Operators with bigger cohorts split by gradeLevel.
 *
 * **No side effects on archetype:** the evaluator + PromotionRule path
 * stay archetype-blind. Validated by `evaluatePromotion`'s static
 * guardrails in `promotion-evaluator.service.ts`.
 *
 * @see docs/pilot-greenlight/d2-sprint-plan.md §4 D.2.5
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import {
  GSIKeyBuilder,
  RequestContext,
} from '../common/entities/base.entity';
import { Enrollment } from '../common/entities/enrollment.entity';
import { ResultCard } from '../common/entities/result-card.entity';
import { PromotionRulesService } from '../promotion-rules/promotion-rules.service';
import {
  PromotionEvaluatorService,
  type EvaluatorResultCard,
  type EvaluatorRule,
  type PromotionEvaluationOutput,
} from './promotion-evaluator.service';
import { AttendanceService } from '../attendance/attendance.service';
import type {
  PromotionEvaluationRequestDto,
  PromotionEvaluationResponseDto,
  PromotionRuleResponseDto,
} from '@aibrains/shared-types';

const COHORT_CAP = 500;

@Injectable()
export class PromotionBatchService {
  private readonly logger = new Logger(PromotionBatchService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
    private readonly identityClient: IdentityClientService,
    private readonly promotionRulesService: PromotionRulesService,
    private readonly promotionEvaluator: PromotionEvaluatorService,
    private readonly attendanceService: AttendanceService,
  ) {}

  /**
   * Evaluate every enrollment in (schoolId, fromAyId, gradeLevel) — or
   * the subset specified by `enrollmentIds` — and return per-enrollment
   * suggestion-with-reasoning. Read-only.
   */
  async evaluate(
    schoolId: string,
    fromAyId: string,
    targetAyId: string,
    gradeLevel: string,
    body: PromotionEvaluationRequestDto,
    context: RequestContext,
  ): Promise<PromotionEvaluationResponseDto> {
    this.logger.debug(
      `evaluate: entry schoolId=${schoolId} fromAyId=${fromAyId} targetAyId=${targetAyId} gradeLevel=${gradeLevel} enrollmentIdsCount=${body.enrollmentIds?.length ?? 'all'}`,
    );

    if (fromAyId === targetAyId) {
      throw new BadRequestException(
        'fromAyId and targetAyId must differ for a cross-year promotion evaluation',
      );
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // 1. Resolve PromotionRule once (lazy-seed if absent — same path as
    //    operator listing the rule for the same gradeLevel).
    const rules = await this.promotionRulesService.listPromotionRules(
      { schoolId, gradeLevel },
      context,
    );
    if (rules.length === 0) {
      // Should never happen: listPromotionRules with gradeLevel + empty
      // result triggers the D.2.3 lazy-seed. Defensive 404.
      throw new NotFoundException(
        `No active PromotionRule found for schoolId=${schoolId} gradeLevel=${gradeLevel}`,
      );
    }
    const rule = rules[0]!;
    const evaluatorRule: EvaluatorRule = {
      ruleId: rule.ruleId,
      passingThresholdPct: rule.passingThresholdPct,
      minAttendancePct: rule.minAttendancePct,
      subjectsRequired: rule.subjectsRequired ?? [],
    };

    // 2. Look up the source AY date-range for attendance scoping.
    //    IdentityClientService.getAcademicYears returns all years for the
    //    school; we filter by yearId rather than make a per-call request.
    const allYears = await this.identityClient.getAcademicYears(schoolId, context).catch(() => []);
    const fromAy = allYears.find((y) => y.yearId === fromAyId);
    if (!fromAy) {
      throw new NotFoundException(
        `AcademicYear ${fromAyId} not found in school ${schoolId}`,
      );
    }

    // 3. List enrollments in cohort scope.
    const cohort = await this.fetchCohort(
      client,
      context.tenantId,
      schoolId,
      fromAyId,
      gradeLevel,
      body.enrollmentIds,
    );

    if (cohort.length > COHORT_CAP) {
      throw new BadRequestException(
        `Cohort size ${cohort.length} exceeds defensive cap of ${COHORT_CAP}. Split by gradeLevel or enrollmentIds[] in the request body.`,
      );
    }

    // 4. Per-enrollment: gather ResultCards + attendance% + evaluate.
    const results: PromotionEvaluationOutput[] = [];
    for (const enrollment of cohort) {
      const resultCards = await this.fetchTerminalResultCards(
        client,
        context.tenantId,
        enrollment.enrollmentId,
      );

      const evaluatorCards: EvaluatorResultCard[] = resultCards.map((card) => ({
        cardId: card.cardId,
        enrollmentId: card.enrollmentId,
        examId: card.examId,
        isTerminalExam: card.isTerminalExam,
        totalScore: card.totalScore,
        totalMaxMarks: card.totalMaxMarks,
        courseScores: card.courseScores.map((cs) => ({
          courseId: cs.courseId,
          academicSubject: cs.academicSubject,
          isPassing: cs.isPassing,
        })),
      }));

      const attendanceSummary = await this.attendanceService
        .getStudentAttendanceSummary(
          enrollment.studentId,
          schoolId,
          fromAyId,
          fromAy.startDate,
          fromAy.endDate,
          context,
          enrollment.studentName ?? '',
        )
        .catch((err) => {
          // Attendance lookup failures are non-fatal: surface 0% which
          // pushes the evaluator into 'attendance_failure'. Operator
          // sees the row + can override.
          this.logger.warn(
            `evaluate: attendance lookup failed for enrollmentId=${enrollment.enrollmentId} — defaulting to 0%. err=${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        });

      const attendancePct = attendanceSummary?.attendanceRate ?? 0;

      const output = this.promotionEvaluator.evaluate({
        enrollmentId: enrollment.enrollmentId,
        studentId: enrollment.studentId,
        studentName: enrollment.studentName,
        resultCards: evaluatorCards,
        attendancePct,
        rule: evaluatorRule,
        // V1: isFinalGrade computation deferred (would read archetype
        // boardExams to find max grade). Operator can manually edit to
        // 'graduated' on the commit body if needed.
        isFinalGrade: false,
      });

      results.push(output);
    }

    // 5. Audit event with the suggestion-mix.
    const suggestionsByDecision: Record<string, number> = {};
    for (const r of results) {
      suggestionsByDecision[r.suggestedDecision] =
        (suggestionsByDecision[r.suggestedDecision] ?? 0) + 1;
    }
    this.eventsService.publishPromotionBatchEvaluated(
      context.tenantId, schoolId, fromAyId, targetAyId, gradeLevel,
      results.length, suggestionsByDecision,
    ).catch((err) =>
      this.logger.error('Failed to publish PromotionBatchEvaluated event', err as Error),
    );

    return {
      fromAyId,
      targetAyId,
      gradeLevel,
      schoolId,
      evaluatedCount: results.length,
      results,
    };
  }

  /**
   * GSI1 query for enrollments in (schoolId, fromAyId, gradeLevel). If
   * `enrollmentIds` is supplied, filters the returned cohort to that
   * subset post-fetch (acceptable for V1 sizes).
   */
  private async fetchCohort(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    tenantId: string,
    schoolId: string,
    fromAyId: string,
    gradeLevel: string,
    enrollmentIds: string[] | undefined,
  ): Promise<Enrollment[]> {
    const result = await this.dynamoDBClient.queryGSI<Enrollment>(
      client,
      'GSI1',
      GSIKeyBuilder.schoolScope(tenantId, schoolId),
      `ENROLLMENT#${fromAyId}#${gradeLevel}`,
      'begins_with',
      undefined,
      undefined,
      undefined,
      COHORT_CAP + 1, // +1 so we can detect over-cap
    );

    let items = result.items;
    if (enrollmentIds && enrollmentIds.length > 0) {
      const idSet = new Set(enrollmentIds);
      items = items.filter((e) => idSet.has(e.enrollmentId));
    }
    return items;
  }

  /**
   * GSI2 enrollment-centric query for ResultCards, filtered to terminal
   * exams (isTerminalExam = true). The filter runs on the DDB side via
   * FilterExpression — efficient for typical V1 sizes (1-2 terminal
   * exams per enrollment per AY).
   */
  private async fetchTerminalResultCards(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    tenantId: string,
    enrollmentId: string,
  ): Promise<ResultCard[]> {
    // ResultCard GSI2: gsi2pk = enrollment#{enrollmentId}, gsi2sk = result-card#…
    const result = await this.dynamoDBClient.queryGSI<ResultCard>(
      client,
      'GSI2',
      `enrollment#${enrollmentId}`,
      'result-card#',
      'begins_with',
      'isTerminalExam = :isTerminal',
      { ':isTerminal': true },
      undefined,
      50,
    );
    return result.items.filter((card) => card.isActive !== false);
  }
}
