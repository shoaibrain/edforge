/**
 * Lambda-local types for the result-batch Lambda. Decoupled from
 * NestJS / academics service entity types so esbuild bundles cleanly.
 */

/**
 * EventBridge envelope for the ExamStatusTransitioned event emitted
 * by academics-service. The Lambda filters on detail.toStatus === 'closed'
 * via the EventBridge rule pattern; once delivered here, toStatus is
 * always 'closed'.
 *
 * Per `academics-events.service.ts` `publishExamStatusTransitioned`,
 * the detail payload shape is:
 *   { eventType, timestamp, tenantId, examId, schoolId, fromStatus, toStatus, notes }
 *
 * Lambda needs ADDITIONAL fields (academicYearId, termId, examType) which
 * it reads from the Exam DDB row directly.
 */
export interface ExamStatusTransitionedEventDetail {
  eventType: 'ExamStatusTransitioned';
  timestamp: string;
  tenantId: string;
  examId: string;
  schoolId: string;
  fromStatus: string;
  toStatus: string;
  notes?: string;
}

export interface EventBridgeExamStatusTransitioned {
  source: 'edforge.academics-service';
  'detail-type': 'ExamStatusTransitioned';
  detail: ExamStatusTransitionedEventDetail;
  time?: string;
  id?: string;
  region?: string;
  resources?: string[];
  account?: string;
  version?: string;
}

/**
 * Result-batch Lambda's return shape — logged for observability and
 * exposed as the function return for invocation traces. Operator can
 * dig into CW Lambda Insights to see counts.
 */
export interface ResultBatchLambdaResult {
  examId: string;
  tenantId: string;
  schoolId: string;
  cardsCreated: number;
  cardsSkippedIdempotent: number;
  chunksWritten: number;
  enrollmentsAggregated: number;
  durationMs: number;
}
