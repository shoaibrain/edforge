/**
 * FinanceAuditService — Sprint 0.3
 *
 * Emits `finance.bulk_export.*` audit events. Fans out to (a) a DDB
 * row for queryability via `GET /finance/audit/bulk-export` and
 * (b) a structured CloudWatch log line for SIEM ingestion.
 *
 * Both writes are best-effort: a finance worker that fails to write
 * an audit row MUST NOT fail the operator's bulk-export job. Audit
 * is forensic, not blocking. Errors are warning-logged and swallowed.
 *
 * First consumers (Sprints F/G):
 *   - bulk-invoice-pdf-export workflow: `requested`, `started`,
 *     `succeeded` / `failed`, `url_minted`
 *   - bulk-receipt-pdf-export workflow: same shape
 *
 * The query side (Sprint 0.3 read endpoint, this PR) supports
 * filtering by time-range, schoolId, operatorId, and eventType.
 */

import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClientService } from './dynamodb-client.service';
import {
  FinanceAuditEventEntity,
  FinanceAuditEventType,
  createFinanceAuditEventEntity,
} from '../entities/finance-audit-event.entity';
import {
  RequestContext,
  decodeCursor,
  PaginatedResult,
} from '../entities/base.entity';

export interface EmitAuditEventPayload {
  schoolId: string;
  jobId?: string;
  documentCount?: number;
  /** 'zip' | 'merged_pdf' */
  format?: string;
  /** Raw S3 key — hashed by this service before storage. */
  presignedKey?: string;
  metadata?: Record<string, unknown>;
}

export interface ListAuditEventsQuery {
  /** ISO-8601 lower bound (inclusive). */
  from?: string;
  /** ISO-8601 upper bound (inclusive). */
  to?: string;
  schoolId?: string;
  operatorId?: string;
  eventType?: FinanceAuditEventType;
  limit?: number;
  cursor?: string;
}

@Injectable()
export class FinanceAuditService {
  private readonly logger = new Logger(FinanceAuditService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * Emit a finance audit event. Writes a DDB row + structured
   * CloudWatch log line. Best-effort on both: errors are warning-
   * logged and swallowed — the caller (e.g. a worker) must not be
   * blocked by audit failures.
   *
   * `payload.presignedKey` is hashed to SHA256 here; the raw key
   * never crosses the storage boundary.
   */
  async emit(
    eventType: FinanceAuditEventType,
    payload: EmitAuditEventPayload,
    context: RequestContext,
  ): Promise<void> {
    const presignedKeyHash = payload.presignedKey
      ? createHash('sha256').update(payload.presignedKey).digest('hex')
      : undefined;

    const entity = createFinanceAuditEventEntity(context.tenantId, {
      eventType,
      operatorId: context.userId,
      schoolId: payload.schoolId,
      jobId: payload.jobId,
      documentCount: payload.documentCount,
      format: payload.format,
      presignedKeyHash,
      // Per the file-level note in the entity: source from JWT claim,
      // not request headers. RequestContext doesn't carry this in V1;
      // attach via a future `context.sourceIp` once the JWT
      // transformer plumbs it. Stays undefined until then — better
      // than wrong.
      requestIp: undefined,
      userAgent: undefined,
      metadata: payload.metadata,
    });

    // Structured CW line first (always cheap, always available).
    this.logger.log(
      JSON.stringify({
        event: eventType,
        eventId: entity.eventId,
        tenantId: context.tenantId,
        operatorId: context.userId,
        schoolId: payload.schoolId,
        jobId: payload.jobId,
        documentCount: payload.documentCount,
        format: payload.format,
        presignedKeyHash,
        occurredAt: entity.occurredAt,
      }),
    );

    // DDB row best-effort.
    try {
      const client = await this.dynamoDBClient.getClient(
        context.tenantId,
        context.jwtToken,
      );
      await this.dynamoDBClient.putItem(client, entity);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `FinanceAuditService.emit DDB write failed for eventType=${eventType} tenantId=${context.tenantId}: ${message.slice(0, 200)} — CloudWatch line was emitted.`,
      );
    }
  }

  /**
   * List finance audit events. Tenant-scoped (PK = tenantId).
   * Uses `begins_with(entityKey, AUDIT#FINANCE_BULK#{from})` to
   * narrow the page when a `from` lower-bound is supplied, then
   * applies FilterExpression for `to`, schoolId, operatorId,
   * eventType. V1 read pattern is "last 100 events for this
   * tenant" — pilot scale keeps this cheap.
   *
   * Sort order: lexicographic on SK = chronological asc by
   * `occurredAt`. Pass `cursor` to continue.
   */
  async list(
    query: ListAuditEventsQuery,
    context: RequestContext,
  ): Promise<PaginatedResult<FinanceAuditEventEntity>> {
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    const limit = Math.min(query.limit ?? 50, 200);
    const exclusiveStartKey = decodeCursor(query.cursor);

    // `begins_with(entityKey, AUDIT#FINANCE_BULK#{from})` narrows the
    // scan when `from` is supplied. Without `from`, the prefix is
    // just `AUDIT#FINANCE_BULK#` so we get all events for the tenant.
    const skPrefix = query.from
      ? `AUDIT#FINANCE_BULK#${query.from}`
      : 'AUDIT#FINANCE_BULK#';

    const filters: string[] = [];
    const attrValues: Record<string, unknown> = {};
    const attrNames: Record<string, string> = {};

    if (query.to) {
      // Upper-bound filter on entityKey since timestamp is the SK prefix.
      filters.push('entityKey <= :upperBound');
      attrValues[':upperBound'] = `AUDIT#FINANCE_BULK#${query.to}~`;
      // The `~` is the highest printable ASCII char; ensures we include
      // any eventId after the equal timestamp boundary.
    }
    if (query.schoolId) {
      filters.push('schoolId = :schoolId');
      attrValues[':schoolId'] = query.schoolId;
    }
    if (query.operatorId) {
      filters.push('operatorId = :operatorId');
      attrValues[':operatorId'] = query.operatorId;
    }
    if (query.eventType) {
      // `eventType` is also the BaseEntity discriminator — alias to
      // sidestep the reserved-word collision with our column of the
      // same name.
      filters.push('#evt = :eventType');
      attrNames['#evt'] = 'eventType';
      attrValues[':eventType'] = query.eventType;
    }

    return this.dynamoDBClient.query<FinanceAuditEventEntity>(
      client,
      context.tenantId,
      skPrefix,
      filters.length > 0 ? filters.join(' AND ') : undefined,
      Object.keys(attrValues).length > 0 ? attrValues : undefined,
      Object.keys(attrNames).length > 0 ? attrNames : undefined,
      limit,
      exclusiveStartKey,
    );
  }
}
