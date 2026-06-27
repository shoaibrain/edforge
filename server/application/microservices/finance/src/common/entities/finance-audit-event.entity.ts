/**
 * FinanceAuditEvent Entity — Sprint 0.3
 *
 * Append-only PII access trail for finance bulk-export operations.
 * Schools (regulated markets like Nepal under PABSON) will ask who
 * downloaded the bills, when, how often. Without this trail, that
 * question is unanswerable.
 *
 * PK: tenantId
 * SK: AUDIT#FINANCE_BULK#{timestamp}#{eventId}
 *
 * The timestamp-prefixed SK lets `begins_with(entityKey,
 * AUDIT#FINANCE_BULK#)` + a time-range FilterExpression return events
 * in chronological order without a GSI. V1 access pattern is "show me
 * the last 100 audit events for this tenant"; pilot scale (a few
 * events per day) keeps the scan O(small). If volume becomes hot,
 * add a GSI on schoolId or operatorId in a later sprint.
 *
 * `presignedKeyHash` stores the SHA256 of the S3 key, never the
 * presigned URL itself — the URL leaks the bearer signature; the key
 * hash gives forensic traceability without re-leaking the secret in
 * audit storage. Same defense the plan calls out at §17.
 *
 * `requestIp` source — V1 vs V1.5:
 *   - V1 (current): best-effort, sourced from the upstream proxy
 *     chain in `buildRequestContext` (leftmost `X-Forwarded-For`,
 *     RFC 7239 §5.2, with `req.ip` fallback). This IS the spoofable
 *     header path; recording it for the pilot audit trail is a
 *     deliberate trade against recording nothing. The trust caveat
 *     is documented at [docs/finance-bulk-ops/sprint-plan.md §0.3]
 *     and on `RequestContext.requestIp`.
 *   - V1.5 (planned): signed `$context.identity.sourceIp` from
 *     API Gateway, propagated via an integration-set header that
 *     the client cannot inject (or a Cognito pre-token-generation
 *     Lambda trigger that adds the IP to the ID token). Reaching
 *     this requires CDK changes that are out of Sprint 0 scope.
 *
 * `userAgent` is sourced from the `User-Agent` request header —
 * same best-effort caveat, but UA is less safety-sensitive than IP.
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, EntityKeyBuilder } from './base.entity';

/**
 * Closed set of event types emitted by the finance audit pipe.
 *
 * Pre-pilot: `finance.bulk_export.*` only (Sprint 0.3, first consumers
 * Sprints F/G of the Bulk Ops EPIC).
 *
 * Pilot Onboarding Hardening Sprint PD.0.2 — adds the
 * `finance.opening_balance.*` family. `set` fires on the first-time
 * write of a BillingAccount's opening balance; `revised` fires when
 * the operator subsequently changes the amount (each emit carries
 * `{ oldAmount, newAmount, delta }` in the `metadata` payload so the
 * audit trail is sufficient to reconstruct the full revision history
 * without storing prior values on the entity itself).
 *
 * Storage namespace note: all events share the historical SK prefix
 * `AUDIT#FINANCE_BULK#` (carried from the bulk-export rollout). The
 * `eventType` column is the actual discriminator; the prefix is a
 * legacy name. A future hygiene sprint may rename the prefix to
 * `AUDIT#FINANCE#`; pilot work does NOT touch it because (a) no
 * production rows exist for the pre-pilot prefix yet (Sprint F+
 * unshipped), (b) rename would force a transition window on the
 * `list` endpoint's `BETWEEN` query that the pilot ask doesn't
 * justify.
 */
export type FinanceAuditEventType =
  | 'finance.bulk_export.requested'
  | 'finance.bulk_export.started'
  | 'finance.bulk_export.succeeded'
  | 'finance.bulk_export.failed'
  | 'finance.bulk_export.url_minted'
  | 'finance.opening_balance.set'
  | 'finance.opening_balance.revised';

export interface FinanceAuditEventEntity extends BaseEntity {
  entityType: 'FINANCE_AUDIT_EVENT';
  eventId: string;
  eventType: FinanceAuditEventType;
  /** ISO-8601 UTC timestamp; redundant with `createdAt` but explicit for grep/CW Insights. */
  occurredAt: string;
  operatorId: string;
  schoolId: string;
  /** The FinanceJob this event is about — present for all `bulk_export.*` events. */
  jobId?: string;
  /** Count of documents in this export (invoices or receipts). */
  documentCount?: number;
  /** 'zip' | 'merged_pdf' — operator-chosen output format. */
  format?: string;
  /**
   * SHA256(S3 key) — NEVER the presigned URL. Set on `url_minted`
   * + `succeeded` events. Lets forensics correlate "this audit row"
   * with "this S3 access-log entry" without storing the bearer.
   */
  presignedKeyHash?: string;
  /** From the JWT `sourceIp` claim — see file-level note. */
  requestIp?: string;
  userAgent?: string;
  /** Free-form payload for event-specific extensions. */
  metadata?: Record<string, unknown>;
}

export function createFinanceAuditEventEntity(
  tenantId: string,
  data: {
    eventType: FinanceAuditEventType;
    operatorId: string;
    schoolId: string;
    jobId?: string;
    documentCount?: number;
    format?: string;
    presignedKeyHash?: string;
    requestIp?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  },
): FinanceAuditEventEntity {
  const eventId = uuid();
  // ISO-8601 lexicographic sort = chronological sort. Critical for
  // the `begins_with` + time-range FilterExpression query pattern.
  const occurredAt = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.financeAuditEvent(occurredAt, eventId),
    entityType: 'FINANCE_AUDIT_EVENT',
    eventId,
    eventType: data.eventType,
    occurredAt,
    operatorId: data.operatorId,
    schoolId: data.schoolId,
    jobId: data.jobId,
    documentCount: data.documentCount,
    format: data.format,
    presignedKeyHash: data.presignedKeyHash,
    requestIp: data.requestIp,
    userAgent: data.userAgent,
    metadata: data.metadata,
    createdAt: occurredAt,
    createdBy: data.operatorId,
    updatedAt: occurredAt,
    updatedBy: data.operatorId,
    version: 1,
  };
}
