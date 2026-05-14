/**
 * AuditedWriteService — uniform audit-log emission
 *
 * Sprint S0.8 (foundation hygiene). Every write that mutates a domain
 * entity SHOULD route its audit emission through this service, so that:
 *   1. Audit-row shape is consistent (no per-caller drift in field names
 *      or order).
 *   2. Error handling is uniform (best-effort writes, never break the
 *      primary operation).
 *   3. Integration tests can assert audit coverage with the shared
 *      `expectAuditRow()` helper (see common/testing/audit-assertions.ts).
 *
 * **Design choice — fire-and-forget vs awaited:**
 * The audit emit is `await`ed but its failure is caught + logged. We do
 * NOT throw on audit failure: the caller's primary write has already
 * committed, and failing the response over a stale audit row would be
 * strictly worse UX than incomplete audit coverage. The trade-off is
 * accepted explicitly here so call-sites don't re-invent it.
 *
 * **Migration path:**
 * The existing inline pattern is:
 *
 *     const auditEntry = createAuditLogEntity(tenantId, schoolId, uuid(), { ... });
 *     this.dynamoDBClient.putItem(client, auditEntry)
 *       .catch(err => this.logger.error('Failed to write audit log', err));
 *
 * Replace with:
 *
 *     await this.auditedWrite.emit(context, {
 *       schoolId, targetEntity, targetEntityId, action, changes,
 *     });
 *
 * The S0.8 commit refactors three named writes (school status change,
 * config update, AY status change). Remaining writes are migrated as
 * surrounding code is touched, per the "no big-bang refactor" rule.
 */

import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from './dynamodb-client.service';
import {
  AuditLogEntry,
  FieldChange,
  createAuditLogEntity,
} from '../entities/audit.entity';
import { RequestContext } from '../entities/base.entity';

export interface AuditEmitParams {
  /** The school whose audit partition the row lives under. */
  schoolId: string;
  /** Which domain entity the audit row is about. */
  targetEntity: AuditLogEntry['targetEntity'];
  /** ID of the specific record being audited. */
  targetEntityId: string;
  /** What kind of change is being recorded. */
  action: AuditLogEntry['action'];
  /** Per-field old/new values. Empty array is permitted for status-only changes. */
  changes: FieldChange[];
  /** Optional operator-supplied reason (used by force-override config edits, etc.). */
  reason?: string;
  /** Default 'normal'. Use 'high' for force-override or compliance-relevant ops. */
  severity?: 'normal' | 'high';
}

@Injectable()
export class AuditedWriteService {
  private readonly logger = new Logger(AuditedWriteService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * Emit an audit row. Always best-effort — failures are logged at error
   * level but never thrown back to the caller. Call AFTER the primary
   * write has succeeded (semantically: this records the fact that a
   * write happened, not that one is about to happen).
   */
  async emit(context: RequestContext, params: AuditEmitParams): Promise<void> {
    const auditEntry = createAuditLogEntity(
      context.tenantId,
      params.schoolId,
      uuid(),
      {
        targetEntity: params.targetEntity,
        targetEntityId: params.targetEntityId,
        action: params.action,
        changes: params.changes,
        changedBy: context.userId,
        changedByName: context.username,
        reason: params.reason,
        severity: params.severity,
      },
    );

    try {
      const client = await this.dynamoDBClient.getClient(
        context.tenantId,
        context.jwtToken,
      );
      await this.dynamoDBClient.putItem(client, auditEntry);
    } catch (err: any) {
      // Best-effort: log but don't throw. See the design note at the top.
      this.logger.error(
        `Failed to write audit log: ` +
          `tenantId=${context.tenantId} ` +
          `schoolId=${params.schoolId} ` +
          `targetEntity=${params.targetEntity} ` +
          `targetEntityId=${params.targetEntityId} ` +
          `action=${params.action} ` +
          `error=${err?.message ?? String(err)}`,
      );
    }
  }
}
