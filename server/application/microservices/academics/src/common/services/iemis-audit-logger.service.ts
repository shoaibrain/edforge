/**
 * IemisAuditLogger (academics) — append-only audit emit helper (Sprint 3, S3.7)
 *
 * Mirror of the identity microservice's `IemisAuditLogger` (Sprint 1, S1.9)
 * sized for audit events that originate inside the academics service — e.g.
 * `student.descriptor.edited`. Writes are **fail-open**: a failed emit logs
 * `iemis.audit.emit_failure` (which a CloudWatch MetricFilter alarm can key
 * on, matching the identity-side convention) and returns `null` so the
 * triggering business operation is never blocked.
 *
 * **Known limitation (Sprint 3):** audit rows written by this logger live in
 * the `edforge-academics-basic` DDB table. The `GET /iemis/audit` endpoint in
 * identity (S1.10) queries `edforge-identity-basic` only, so descriptor-edit
 * events will NOT appear in that list today. Documented follow-up: a future
 * sprint federates the audit read path across service tables (Sprint 13 PII
 * access logging naturally picks this up). Until then, the `student.descriptor.edited`
 * events are retrievable via CloudWatch Logs Insights on the academics
 * log group or a direct DDB query against the AUDIT#IEMIS# SK prefix.
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

export interface IemisAuditEventEntity extends BaseEntity, IemisAuditEvent {
  entityType: 'IEMIS_AUDIT_EVENT';
}

@Injectable()
export class IemisAuditLogger {
  private readonly logger = new Logger(IemisAuditLogger.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  async emit(
    payload: IemisAuditEventPayload,
    jwtToken: string,
  ): Promise<IemisAuditEvent | null> {
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
      this.logger.error(
        `iemis.audit.emit_failure type=${event.eventType} tenant=${event.tenantId} error=${error.message}`,
      );
      return null;
    }
  }
}
