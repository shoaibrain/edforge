/**
 * Layer 5.1 — event-metric-map.ts
 *
 * Pure constant mapping from `(source, detailType)` → `{ metric, dimensions }`
 * consumed by the aggregator Lambda. Unknown combinations return `null` so
 * the aggregator can route those events to the DLQ without guessing.
 *
 * Dimensions are the ONLY aggregate-key dimensions permitted in the DynamoDB
 * SK (cardinal rule #3: never put userId in aggregate keys). Valid entries:
 *   'role'       → splits counts by user role
 *   'schoolId'   → splits counts by school
 *
 * When adding a new event:
 *   1. Add a row here.
 *   2. Add an exhaustive test case in event-metric-map.spec.ts.
 *   3. If it's a new analytics event (source=edforge.analytics), also add
 *      the helper + DETAIL_TYPE_TO_FEATURE_ACTION entry in
 *      libs/analytics-events/src/analytics-events.service.ts.
 */

export type MetricDimension = 'role' | 'schoolId';

export interface MetricMapping {
  metric: string;
  dimensions: MetricDimension[];
}

type MetricKey = `${string}::${string}`;

function k(source: string, detailType: string): MetricKey {
  return `${source}::${detailType}`;
}

// Single source of truth. Exported so tests can enumerate it.
export const EVENT_METRIC_MAP: Readonly<Record<MetricKey, MetricMapping>> = Object.freeze({
  // ======================================================================
  // edforge.analytics — native analytics events (Layer 4 emitters)
  // ======================================================================
  [k('edforge.analytics', 'LoginSuccess')]:     { metric: 'auth.login.success',     dimensions: ['role'] },
  [k('edforge.analytics', 'LoginFailure')]:     { metric: 'auth.login.failure',     dimensions: ['role'] },
  [k('edforge.analytics', 'Logout')]:           { metric: 'auth.logout',            dimensions: ['role'] },
  [k('edforge.analytics', 'PasswordReset')]:    { metric: 'auth.password.reset',    dimensions: ['role'] },
  [k('edforge.analytics', 'SessionCreated')]:   { metric: 'session.create',         dimensions: ['role'] },
  [k('edforge.analytics', 'SessionRevoked')]:   { metric: 'session.revoke',         dimensions: ['role'] },
  [k('edforge.analytics', 'SessionRefreshed')]: { metric: 'session.refresh',        dimensions: ['role'] },
  [k('edforge.analytics', 'UserCreated')]:      { metric: 'user.create',            dimensions: ['role', 'schoolId'] },
  [k('edforge.analytics', 'UserUpdated')]:      { metric: 'user.update',            dimensions: ['role', 'schoolId'] },
  [k('edforge.analytics', 'UserDisabled')]:     { metric: 'user.disable',           dimensions: ['role', 'schoolId'] },
  [k('edforge.analytics', 'FeatureUsage')]:     { metric: 'feature.usage',          dimensions: ['role'] },
  [k('edforge.analytics', 'AuditLogged')]:      { metric: 'audit.logged',           dimensions: ['role'] },

  // ======================================================================
  // edforge.academics-service — observed publisher surface (Layer 0 sniff)
  // ======================================================================
  [k('edforge.academics-service', 'AttendanceRecorded')]:             { metric: 'academics.attendance.recorded',         dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'BulkAttendanceRecorded')]:         { metric: 'academics.attendance.bulk_recorded',    dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'SectionAttendanceRecorded')]:      { metric: 'academics.attendance.section',          dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'BulkSectionAttendanceRecorded')]:  { metric: 'academics.attendance.bulk_section',     dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'GradeRecorded')]:                  { metric: 'academics.grade.recorded',              dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'GradeBulkRecorded')]:              { metric: 'academics.grade.bulk_recorded',         dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'GradeFinalized')]:                 { metric: 'academics.grade.finalized',             dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'GradeBulkFinalized')]:             { metric: 'academics.grade.bulk_finalized',        dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'GradePublished')]:                 { metric: 'academics.grade.published',             dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'GradingPolicyCreated')]:           { metric: 'academics.policy.created',              dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'GradingPolicyUpdated')]:           { metric: 'academics.policy.updated',              dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'EnrollmentCompleted')]:            { metric: 'academics.enrollment.completed',        dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'StudentCreated')]:                 { metric: 'academics.student.created',             dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'StudentUpdated')]:                 { metric: 'academics.student.updated',             dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'StudentDeleted')]:                 { metric: 'academics.student.deleted',             dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'StudentWithdrawn')]:               { metric: 'academics.student.withdrawn',           dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'StudentTransferred')]:             { metric: 'academics.student.transferred',         dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'CourseCreated')]:                  { metric: 'academics.course.created',              dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'CourseUpdated')]:                  { metric: 'academics.course.updated',              dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'CourseDeleted')]:                  { metric: 'academics.course.deleted',              dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'SectionCreated')]:                 { metric: 'academics.section.created',             dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'SectionUpdated')]:                 { metric: 'academics.section.updated',             dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'SectionDeleted')]:                 { metric: 'academics.section.deleted',             dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'ClassworkItemCreated')]:           { metric: 'academics.classwork.item.created',      dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'ClassworkItemUpdated')]:           { metric: 'academics.classwork.item.updated',      dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'ClassworkItemDeleted')]:           { metric: 'academics.classwork.item.deleted',      dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'ClassworkTopicCreated')]:          { metric: 'academics.classwork.topic.created',     dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'ClassworkTopicUpdated')]:          { metric: 'academics.classwork.topic.updated',     dimensions: ['role', 'schoolId'] },
  [k('edforge.academics-service', 'ClassworkTopicDeleted')]:          { metric: 'academics.classwork.topic.deleted',     dimensions: ['role', 'schoolId'] },

  // ======================================================================
  // edforge.finance-service
  // ======================================================================
  [k('edforge.finance-service', 'FeeStructureCreated')]:   { metric: 'finance.fee.created',     dimensions: ['role', 'schoolId'] },
  [k('edforge.finance-service', 'FeeStructureUpdated')]:   { metric: 'finance.fee.updated',     dimensions: ['role', 'schoolId'] },
  [k('edforge.finance-service', 'FeeStructureVersioned')]: { metric: 'finance.fee.versioned',   dimensions: ['role', 'schoolId'] },
  [k('edforge.finance-service', 'InvoiceGenerated')]:      { metric: 'finance.invoice.created', dimensions: ['role', 'schoolId'] },
  [k('edforge.finance-service', 'InvoiceStatusChanged')]:  { metric: 'finance.invoice.status',  dimensions: ['role', 'schoolId'] },
  [k('edforge.finance-service', 'PaymentCompleted')]:      { metric: 'finance.payment.success', dimensions: ['role', 'schoolId'] },
  [k('edforge.finance-service', 'PaymentFailed')]:         { metric: 'finance.payment.failure', dimensions: ['role', 'schoolId'] },
  [k('edforge.finance-service', 'RefundProcessed')]:       { metric: 'finance.refund.processed', dimensions: ['role', 'schoolId'] },
  [k('edforge.finance-service', 'BillingAccountCreated')]: { metric: 'finance.account.created', dimensions: ['role', 'schoolId'] },

  // ======================================================================
  // edforge.identity-service — entity-lifecycle domain events
  // ======================================================================
  [k('edforge.identity-service', 'UserCreated')]:          { metric: 'identity.user.created',          dimensions: ['role'] },
  [k('edforge.identity-service', 'UserUpdated')]:          { metric: 'identity.user.updated',          dimensions: ['role'] },
  [k('edforge.identity-service', 'UserDeleted')]:          { metric: 'identity.user.deleted',          dimensions: ['role'] },
  [k('edforge.identity-service', 'SchoolCreated')]:        { metric: 'identity.school.created',        dimensions: ['role'] },
  [k('edforge.identity-service', 'SchoolUpdated')]:        { metric: 'identity.school.updated',        dimensions: ['role'] },
  [k('edforge.identity-service', 'SchoolDeleted')]:        { metric: 'identity.school.deleted',        dimensions: ['role'] },
  [k('edforge.identity-service', 'RoleAssigned')]:         { metric: 'identity.role.assigned',         dimensions: ['role'] },
  [k('edforge.identity-service', 'RoleRevoked')]:          { metric: 'identity.role.revoked',          dimensions: ['role'] },
  [k('edforge.identity-service', 'GlobalRoleChanged')]:    { metric: 'identity.role.global_changed',   dimensions: ['role'] },
  [k('edforge.identity-service', 'SchoolRoleChanged')]:    { metric: 'identity.role.school_changed',   dimensions: ['role'] },
  [k('edforge.identity-service', 'StaffCreated')]:         { metric: 'identity.staff.created',         dimensions: ['role'] },
  [k('edforge.identity-service', 'SEACreated')]:           { metric: 'identity.sea.created',           dimensions: ['role'] },
  [k('edforge.identity-service', 'SEAUpdated')]:           { metric: 'identity.sea.updated',           dimensions: ['role'] },
  [k('edforge.identity-service', 'LEACreated')]:           { metric: 'identity.lea.created',           dimensions: ['role'] },
  [k('edforge.identity-service', 'LEAUpdated')]:           { metric: 'identity.lea.updated',           dimensions: ['role'] },
  [k('edforge.identity-service', 'LEADeleted')]:           { metric: 'identity.lea.deleted',           dimensions: ['role'] },
  [k('edforge.identity-service', 'ESCCreated')]:           { metric: 'identity.esc.created',           dimensions: ['role'] },
  [k('edforge.identity-service', 'ESCUpdated')]:           { metric: 'identity.esc.updated',           dimensions: ['role'] },
  [k('edforge.identity-service', 'ESCDeleted')]:           { metric: 'identity.esc.deleted',           dimensions: ['role'] },
  [k('edforge.identity-service', 'NetworkCreated')]:       { metric: 'identity.network.created',       dimensions: ['role'] },
});

export function lookupMetric(
  source: string | undefined,
  detailType: string | undefined,
): MetricMapping | null {
  if (!source || !detailType) return null;
  return EVENT_METRIC_MAP[k(source, detailType)] ?? null;
}

/**
 * Event types that require a dual-write to the `UserSessionEventsTable`.
 * The aggregator writes a per-user session row alongside the regular
 * aggregate writes so the `/me/session-history` API (Layer 7.4) has a
 * dedicated partition to read from.
 */
export const SESSION_EVENT_TYPES: ReadonlySet<string> = new Set([
  'SessionCreated',
  'SessionRevoked',
  'SessionRefreshed',
]);
