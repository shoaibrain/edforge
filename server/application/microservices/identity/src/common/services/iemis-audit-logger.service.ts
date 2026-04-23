/**
 * IemisAuditLogger — append-only audit emit helper (Sprint 1, S1.9)
 *
 * Callers emit structured events via `emit({...})`; the logger assigns
 * an eventId (uuid v4) + timestamp, composes the DDB sort key, and
 * writes to the identity table. Writes are **fail-open**: a failed
 * emit increments the `iemis.audit.emit_failures` CloudWatch metric
 * (S1.12) and logs at ERROR, but never throws upstream — the triggering
 * business operation must not be blocked by audit infra.
 *
 * This is the canonical emit path for every IEMIS-scoped action in
 * Sprints 1 through 15. Controllers, workers, admin tools, and cron
 * jobs all go through this helper so the `/iemis/audit` endpoint (S1.10)
 * has a single source of truth.
 *
 * NOT for general-purpose app audit — this table row uses the IEMIS-
 * specific entityKey prefix and is query-shaped for IEMIS consumers.
 */

import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  type IemisAuditEvent,
  type IemisAuditEventPayload,
  iemisAuditEventPayloadSchema,
  buildIemisAuditEntityKey,
} from '@aibrains/shared-types';
import { DynamoDBClientService } from './dynamodb-client.service';
import { BaseEntity } from '../entities/base.entity';

/**
 * DDB entity shape for a persisted audit event. Extends `BaseEntity`
 * so tenant + timestamps live alongside the event-specific fields.
 */
export interface IemisAuditEventEntity extends BaseEntity, IemisAuditEvent {
  entityType: 'IEMIS_AUDIT_EVENT';
}

@Injectable()
export class IemisAuditLogger {
  private readonly logger = new Logger(IemisAuditLogger.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * Persist one audit event. Never throws: validation failures, DDB
   * errors, and network faults are logged and swallowed so the caller
   * can continue without unwinding the business operation.
   *
   * The `jwtToken` is needed to acquire a tenant-scoped DDB client via
   * the Token Vending Machine. When the event is system-originated
   * (background job, no user JWT), pass the identity-service's own
   * system JWT.
   *
   * Returns the full persisted event on success, `null` on failure.
   * Callers that need the event ID (for linking into a larger workflow)
   * should handle the null case — failing soft.
   */
  async emit(
    payload: IemisAuditEventPayload,
    jwtToken: string,
  ): Promise<IemisAuditEvent | null> {
    // Validate at the seam so malformed payloads fail loud to the
    // caller's log (not into DDB).
    const parsed = iemisAuditEventPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.error(
        `IemisAuditLogger.emit: payload validation failed — ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
      return null;
    }

    const eventId = uuidv4();
    const timestamp = new Date().toISOString();
    const now = timestamp;

    const event: IemisAuditEvent = {
      ...parsed.data,
      eventId,
      timestamp,
    };

    const entity: IemisAuditEventEntity = {
      ...event,
      tenantId: event.tenantId,
      entityKey: buildIemisAuditEntityKey(timestamp, eventId),
      entityType: 'IEMIS_AUDIT_EVENT',
      createdAt: now,
      createdBy: event.actorUserId,
      updatedAt: now,
      updatedBy: event.actorUserId,
      version: 1,
    };

    try {
      const client = await this.dynamoDBClient.getClient(event.tenantId, jwtToken);
      await this.dynamoDBClient.putItem(client, entity);
      this.logger.debug(
        `iemis.audit.emit: type=${event.eventType} tenant=${event.tenantId} eventId=${eventId}`,
      );
      return event;
    } catch (error: any) {
      // Fail-open: log + increment failure counter (S1.12 consumes via
      // the log filter pattern on the shared log group). A structured
      // single-line message keeps CloudWatch metric-filter semantics
      // reliable.
      this.logger.error(
        `iemis.audit.emit_failure type=${event.eventType} tenant=${event.tenantId} error=${error.message}`,
      );
      return null;
    }
  }
}
