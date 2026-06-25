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
 * `requestIp` is sourced from the JWT `sourceIp` claim (Cognito
 * propagates `aws:SourceIp` if API GW is configured to forward it).
 * Request headers (`x-forwarded-for`, etc.) are spoofable behind any
 * proxy — never use them for an audit trail.
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, EntityKeyBuilder } from './base.entity';

/** Closed set of event types emitted under the `finance.bulk_export.*` namespace. */
export type FinanceAuditEventType =
  | 'finance.bulk_export.requested'
  | 'finance.bulk_export.started'
  | 'finance.bulk_export.succeeded'
  | 'finance.bulk_export.failed'
  | 'finance.bulk_export.url_minted';

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
