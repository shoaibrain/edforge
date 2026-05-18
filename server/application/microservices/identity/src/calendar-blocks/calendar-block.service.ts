/**
 * Calendar Block Service — Sprint C4 (Multi-Day Event Blocks)
 *
 * Operator-facing CRUD over the `CalendarBlock` umbrella entity + its
 * N child `CalendarDate` rows.
 *
 * Atomicity (C4.3.a):
 *   POST writes block + N child dates in a single TransactWriteItems
 *   call (DDB hard-cap = 100 items, which bounds the block length at
 *   ~99 days — comfortably above the longest real-world block, which
 *   is ~10 days for Dashain).
 *
 * Per-day override preservation (C4.4):
 *   PATCH only rewrites block-level fields. Existing child rows keep
 *   their per-day overrides (operator-edited `calendarEvents`, custom
 *   `bellScheduleId`, `notes`, etc.). The denormalized
 *   `blockName` / `blockDescriptor` fields on existing children are
 *   intentionally NOT rewritten on PATCH — operators sometimes hand-
 *   override the displayed name on a single day, and we don't want to
 *   silently stomp on that.
 *
 * Cascade-delete (C4.3.c):
 *   DELETE removes the block + every child date row in batches of 25
 *   (BatchWriteItems hard-cap). Audit row + `calendar.block_deleted`
 *   event emit once per block.
 *
 * Audit (C4.6):
 *   Every write emits via `AuditedWriteService.emit`. Action codes
 *   are `'create'` / `'update'` / `'delete'`. The block_descriptor is
 *   carried in the changes[] for downstream filtering.
 */

import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import {
  CalendarBlock,
  CalendarBlockKeyBuilder,
  computeChildDateCount,
  createCalendarBlockEntity,
  enumerateBlockDates,
} from '../common/entities/calendar-block.entity';
import {
  CalendarDate,
  CalendarDateKeyBuilder,
  createCalendarDateEntity,
  getDayOfWeek,
  isWeekend,
} from '../common/entities/calendar-date.entity';
import {
  EntityKeyBuilder,
  RequestContext,
} from '../common/entities/base.entity';
import { AcademicYearsService } from '../academic-years/academic-years.service';
import { partitionRowsBySource } from '../common/utils/calendar-date-partition';
import type {
  CreateCalendarBlockDto,
  UpdateCalendarBlockDto,
  CalendarBlockResponseDto,
  CalendarBlockListItemDto,
  CalendarBlockFilterDto,
} from '@aibrains/shared-types';

const TRANSACT_WRITE_LIMIT = 100;
const BATCH_WRITE_LIMIT = 25;
/**
 * Cap on block length. Merge-mode is split into two phases (C4-followup-2):
 *   Phase 1 — BatchWriteItem deletes (auto-chunks at 25, no IAM ceiling).
 *   Phase 2 — TransactWriteItems put of 1 block + N children = N+1 ops.
 * Setting N ≤ 45 keeps Phase 2 ≤ 46 ops, well under DDB's 100-op cap.
 * Real-world blocks are short (Dashain=9, Tihar=6, Summer=10), so 45 is
 * generous. The 45 ceiling was first set in PR #125 to fit an atomic
 * delete+put plan; we retain it now to leave headroom for swinging back
 * to atomic mode once IAM is widened (B0.1 follow-up).
 */
const MAX_BLOCK_DAYS = 45;

@Injectable()
export class CalendarBlockService {
  private readonly logger = new Logger(CalendarBlockService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly auditedWrite: AuditedWriteService,
    @Inject(forwardRef(() => AcademicYearsService))
    private readonly academicYearsService: AcademicYearsService,
  ) {}

  // ------------------------------------------------------------------
  // CREATE — C4.3.a
  // ------------------------------------------------------------------

  async createBlock(
    dto: CreateCalendarBlockDto,
    context: RequestContext,
  ): Promise<CalendarBlockResponseDto> {
    // 1. Validate range + cardinality
    const childDates = enumerateBlockDates(dto.startDate, dto.endDate);
    if (childDates.length === 0) {
      throw new BadRequestException({
        errorCode: 'INVALID_DATE_RANGE',
        message: 'startDate must be on or before endDate',
      });
    }
    if (childDates.length > MAX_BLOCK_DAYS) {
      throw new BadRequestException({
        errorCode: 'BLOCK_TOO_LONG',
        message: `Block spans ${childDates.length} days; max is ${MAX_BLOCK_DAYS}.`,
      });
    }
    // Write-path op caps after C4-followup-2:
    //   Phase 1 (delete system rows): BatchWriteItems auto-chunks at 25,
    //     so any block length is safe — no IAM ceiling.
    //   Phase 2 (put block + child rows): TransactWriteItems carries
    //     1 block + N child puts = N + 1 ops. For MAX_BLOCK_DAYS=45 that's
    //     46, well under the DDB 100-op transact cap. The cap was halved
    //     from 90 → 45 in PR #125 to accommodate the (now-abandoned)
    //     atomic delete+put plan; we leave it at 45 since real operator
    //     blocks (Dashain=9, Tihar=6, Summer=10) are well below that, and
    //     it leaves headroom to swing back to atomic mode later (B0.1
    //     follow-up — would require widening identity IAM to grant
    //     `dynamodb:DeleteItem` + `dynamodb:TransactWriteItems` on a
    //     single principal).
    if (childDates.length + 1 > TRANSACT_WRITE_LIMIT) {
      throw new BadRequestException({
        errorCode: 'BLOCK_TOO_LONG',
        message:
          `Block spans ${childDates.length} days; child-row TransactWriteItems would emit ` +
          `${childDates.length + 1} ops (DDB hard cap = ${TRANSACT_WRITE_LIMIT}).`,
      });
    }

    // 2. AY range validation — block must fit inside the AY
    const ay = await this.academicYearsService.getAcademicYear(dto.schoolId, dto.academicYearId, context);
    if (dto.startDate < ay.startDate || dto.endDate > ay.endDate) {
      throw new BadRequestException({
        errorCode: 'BLOCK_OUTSIDE_AY_RANGE',
        message: `Block [${dto.startDate}..${dto.endDate}] is outside AY [${ay.startDate}..${ay.endDate}].`,
        details: { ayStartDate: ay.startDate, ayEndDate: ay.endDate },
      });
    }

    // 3. Sub-event date validation — each must fall within the block
    if (dto.subEvents?.length) {
      for (const se of dto.subEvents) {
        if (se.date < dto.startDate || se.date > dto.endDate) {
          throw new BadRequestException({
            errorCode: 'SUB_EVENT_OUTSIDE_BLOCK',
            message: `Sub-event '${se.name}' date ${se.date} is outside block range.`,
          });
        }
      }
    }

    // 4. Merge-mode preflight: query existing CalendarDate rows for the
    //    AY + school, then in-memory filter to the block's date range.
    //    Same operator-vs-system rule as C3.8's `generate-calendar`
    //    merge mode (memory: `pilot-greenlight-c3-closed-2026-05-17`).
    //
    //    Why scan the whole AY rather than just the block range:
    //    `queryGSI` only supports `eq`/`begins_with` on the GSI1 sort
    //    key (`CALDATE#{date}`), not a BETWEEN range. The AY-wide query
    //    returns ≤ 366 rows for the longest AY — well under the GSI
    //    1MB-per-page response cap. In-memory filter by `schoolId` +
    //    `childDateSet.has(date)` is O(N) and negligible. If/when we
    //    extend `queryGSI` to accept BETWEEN on the SK, this falls back
    //    to a narrower query naturally.
    const childDateSet = new Set(childDates);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const existingRows = await this.dynamoDBClient.queryGSI<CalendarDate>(
      client,
      'GSI1',
      CalendarDateKeyBuilder.academicYearLookup(dto.academicYearId),
      'CALDATE#',
      'begins_with',
      'entityType = :entityType AND schoolId = :schoolId',
      { ':entityType': 'CALENDARDATE', ':schoolId': dto.schoolId },
      undefined,
      400,
    );
    const overlapping = existingRows.items.filter((r) => childDateSet.has(r.date));

    const { systemRowKeys, preservedDates } = partitionRowsBySource(overlapping);

    if (preservedDates.size > 0) {
      throw new ConflictException({
        errorCode: 'BLOCK_CONFLICTS_OPERATOR_DATES',
        message:
          `Block range overlaps ${preservedDates.size} operator-edited CalendarDate row(s). ` +
          'Operator overrides are preserved — either pick a different range, or first revert ' +
          'the conflicting dates via PATCH /calendar-dates/:date.',
        details: {
          conflictingDates: [...preservedDates].sort(),
          operatorTouchedCount: preservedDates.size,
        },
      });
    }

    const blockId = uuid();
    const now = new Date().toISOString();
    const childEventType = dto.childEventType;

    // 5. Build the block row
    const blockEntity = createCalendarBlockEntity(context.tenantId, dto.schoolId, {
      blockId,
      academicYearId: dto.academicYearId,
      blockName: dto.blockName,
      blockDescriptor: dto.blockDescriptor,
      startDate: dto.startDate,
      endDate: dto.endDate,
      childEventType,
      childDateCount: childDates.length,
      subEvents: dto.subEvents,
      description: dto.description,
      createdAt: now,
      createdBy: context.userId,
      updatedAt: now,
      updatedBy: context.userId,
      version: 1,
    });

    // 6. Build the N child CalendarDate rows
    const subEventByDate = new Map<string, string>();
    for (const se of dto.subEvents ?? []) {
      subEventByDate.set(se.date, se.name);
    }

    const childRows: CalendarDate[] = childDates.map((dateStr) => {
      const dayOfWeek = getDayOfWeek(dateStr);
      const weekend = isWeekend(dateStr);
      return createCalendarDateEntity(context.tenantId, dto.schoolId, {
        date: dateStr,
        academicYearId: dto.academicYearId,
        calendarEvents: [
          {
            eventType: childEventType,
            description: dto.blockName,
            isAllDay: true,
          },
        ],
        // Block days are non-instructional by default (the operator
        // can override per-day via PATCH /calendar-dates/:id later).
        isInstructionalDay: childEventType === 'exam_window',
        isHoliday: childEventType === 'holiday',
        isWeekend: weekend,
        dayOfWeek,
        blockId,
        blockName: dto.blockName,
        blockDescriptor: dto.blockDescriptor,
        subEventName: subEventByDate.get(dateStr),
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      });
    });

    // 7. Two-phase write (IAM-aware split — matches C3.8 generate-calendar
    //    merge-mode pattern):
    //
    //      Phase 1 — Delete SYSTEM rows via BatchWriteItem on the
    //        per-tenant ABAC client. ABAC role grants `dynamodb:DeleteItem`
    //        under `LeadingKeys = ${tenantId-tag}` (see
    //        `ecs-dynamodb.ts:220-242`).
    //
    //      Phase 2 — Atomic Put of the block row + N child rows via
    //        TransactWriteItems on the task-role-scoped raw client. Task
    //        role grants `dynamodb:PutItem` (`tenant-template-stack.ts:421-435`).
    //
    //    Atomicity tradeoff: the two phases are not bracketed by a single
    //    transaction (neither principal can do both DeleteItem AND
    //    TransactWriteItems). If Phase 1 succeeds and Phase 2 fails (e.g.
    //    a uuid collision on the block row), the operator is left with
    //    some SYSTEM rows deleted but no block. The merge-mode preflight
    //    on retry simply finds fewer SYSTEM rows to delete and proceeds
    //    cleanly — no data corruption. C3.8 has run this pattern in prod
    //    since 2026-05-17 without incident.
    //
    //    Closing the atomicity gap is a B0.1 follow-up that needs an IAM
    //    widening to put DeleteItem + TransactWriteItems on the same
    //    principal. Tracked in `docs/pilot-greenlight/c4-known-issues.md`.
    const tableName = this.dynamoDBClient.getTableName();

    // Phase 1: delete colliding SYSTEM rows
    if (systemRowKeys.length > 0) {
      const deleteRequests = systemRowKeys.map((entityKey) => ({
        DeleteRequest: { Key: { tenantId: context.tenantId, entityKey } },
      }));
      await this.dynamoDBClient.batchWriteItems(client, deleteRequests);
    }

    // Phase 2: atomic block + children put
    const transactItems = [
      {
        Put: {
          TableName: tableName,
          Item: blockEntity,
          // Defensive: block IDs are uuid()s so a real-world collision
          // is impossible, but the ConditionExpression turns a malicious
          // collision into a 409 rather than a silent overwrite.
          ConditionExpression: 'attribute_not_exists(entityKey)',
        },
      },
      ...childRows.map((row) => ({
        Put: {
          TableName: tableName,
          Item: row,
          // No ConditionExpression on child Puts: Phase 1 already deleted
          // any system rows at these entityKeys, and the preflight 409'd
          // on operator-touched dates.
        },
      })),
    ];

    try {
      await this.dynamoDBClient.transactWrite(client, transactItems);
    } catch (err: any) {
      if (err?.name === 'TransactionCanceledException') {
        // Rare race: an operator wrote a new CalendarDate at one of
        // these entityKeys between Phase 1 and Phase 2. Surface the same
        // 409 the preflight would have, so the caller's retry path is
        // identical.
        throw new ConflictException({
          errorCode: 'BLOCK_CONFLICTS_OPERATOR_DATES',
          message:
            'A concurrent operator edit landed on a date in the block range ' +
            'between preflight and write. Retry the request.',
        });
      }
      throw err;
    }

    // 8. Audit emit — block.created (mode mirrors C3.8 audit shape so
    //    downstream consumers can filter on "what path created this")
    await this.auditedWrite.emit(context, {
      schoolId: dto.schoolId,
      targetEntity: 'CALENDAR_BLOCK',
      targetEntityId: blockId,
      action: 'create',
      severity: 'normal',
      changes: [
        { field: 'blockName', oldValue: null, newValue: dto.blockName },
        { field: 'blockDescriptor', oldValue: null, newValue: dto.blockDescriptor },
        { field: 'startDate', oldValue: null, newValue: dto.startDate },
        { field: 'endDate', oldValue: null, newValue: dto.endDate },
        { field: 'childDateCount', oldValue: null, newValue: childDates.length },
        { field: 'childEventType', oldValue: null, newValue: childEventType },
        { field: 'mode', oldValue: null, newValue: 'merge' },
        { field: 'systemRowsReplaced', oldValue: null, newValue: systemRowKeys.length },
        ...(dto.subEvents?.length
          ? [{ field: 'subEventCount', oldValue: null, newValue: dto.subEvents.length }]
          : []),
      ],
    });

    this.logger.log(
      `CalendarBlock created (merge): ${dto.blockName} (${blockId}) ` +
      `school=${dto.schoolId} range=[${dto.startDate}..${dto.endDate}] ` +
      `children=${childDates.length} systemRowsReplaced=${systemRowKeys.length}`,
    );

    return this.toResponse(blockEntity);
  }

  // ------------------------------------------------------------------
  // GET — C4.3.b
  // ------------------------------------------------------------------

  async getBlock(
    schoolId: string,
    blockId: string,
    context: RequestContext,
  ): Promise<CalendarBlockResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const block = await this.dynamoDBClient.getItem<CalendarBlock>(
      client,
      context.tenantId,
      CalendarBlockKeyBuilder.calendarBlock(schoolId, blockId),
    );
    if (!block) {
      throw new NotFoundException({
        errorCode: 'BLOCK_NOT_FOUND',
        message: `CalendarBlock ${blockId} not found in school ${schoolId}.`,
      });
    }
    return this.toResponse(block);
  }

  // ------------------------------------------------------------------
  // LIST — C4.3.b
  // ------------------------------------------------------------------

  async listBlocks(
    filter: CalendarBlockFilterDto,
    context: RequestContext,
  ): Promise<{
    items: CalendarBlockListItemDto[];
    hasMore: boolean;
    cursor?: string;
  }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<CalendarBlock>(
      client,
      'GSI1',
      CalendarBlockKeyBuilder.schoolScope(context.tenantId, filter.schoolId),
      'CALBLOCK#',
      'begins_with',
      'entityType = :entityType',
      { ':entityType': 'CALENDARBLOCK' },
      filter.cursor ? JSON.parse(filter.cursor) : undefined,
      filter.limit,
    );

    let items = result.items;

    // In-memory secondary filters — small N (typically <50 blocks/AY)
    if (filter.academicYearId) {
      items = items.filter((b) => b.academicYearId === filter.academicYearId);
    }
    if (filter.blockDescriptor) {
      items = items.filter((b) => b.blockDescriptor === filter.blockDescriptor);
    }
    if (filter.from || filter.to) {
      const from = filter.from ?? '0000-01-01';
      const to = filter.to ?? '9999-12-31';
      items = items.filter((b) => b.endDate >= from && b.startDate <= to);
    }

    return {
      items: items.map((b) => ({
        blockId: b.blockId,
        blockName: b.blockName,
        blockDescriptor: b.blockDescriptor,
        startDate: b.startDate,
        endDate: b.endDate,
        childEventType: b.childEventType as any,
        childDateCount: b.childDateCount,
      })),
      hasMore: result.hasMore,
      cursor: result.lastEvaluatedKey ? JSON.stringify(result.lastEvaluatedKey) : undefined,
    };
  }

  // ------------------------------------------------------------------
  // PATCH — C4.4 (preserves per-day overrides)
  // ------------------------------------------------------------------

  async updateBlock(
    schoolId: string,
    blockId: string,
    dto: UpdateCalendarBlockDto,
    context: RequestContext,
  ): Promise<CalendarBlockResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const existing = await this.dynamoDBClient.getItem<CalendarBlock>(
      client,
      context.tenantId,
      CalendarBlockKeyBuilder.calendarBlock(schoolId, blockId),
    );
    if (!existing) {
      throw new NotFoundException({
        errorCode: 'BLOCK_NOT_FOUND',
        message: `CalendarBlock ${blockId} not found in school ${schoolId}.`,
      });
    }

    // sub-event date validation if provided
    if (dto.subEvents?.length) {
      for (const se of dto.subEvents) {
        if (se.date < existing.startDate || se.date > existing.endDate) {
          throw new BadRequestException({
            errorCode: 'SUB_EVENT_OUTSIDE_BLOCK',
            message: `Sub-event '${se.name}' date ${se.date} is outside block range.`,
          });
        }
      }
    }

    const now = new Date().toISOString();
    const updates: string[] = [];
    const values: Record<string, any> = {
      ':updatedAt': now,
      ':updatedBy': context.userId,
      ':inc': 1,
    };
    const names: Record<string, string> = { '#version': 'version' };
    const changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

    if (dto.blockName !== undefined && dto.blockName !== existing.blockName) {
      updates.push('blockName = :blockName');
      values[':blockName'] = dto.blockName;
      changes.push({ field: 'blockName', oldValue: existing.blockName, newValue: dto.blockName });
    }
    if (dto.blockDescriptor !== undefined && dto.blockDescriptor !== existing.blockDescriptor) {
      updates.push('blockDescriptor = :blockDescriptor');
      values[':blockDescriptor'] = dto.blockDescriptor;
      changes.push({
        field: 'blockDescriptor',
        oldValue: existing.blockDescriptor,
        newValue: dto.blockDescriptor,
      });
    }
    if (dto.description !== undefined && dto.description !== existing.description) {
      updates.push('description = :description');
      values[':description'] = dto.description;
      changes.push({
        field: 'description',
        oldValue: existing.description ?? null,
        newValue: dto.description,
      });
    }
    if (dto.subEvents !== undefined) {
      updates.push('subEvents = :subEvents');
      values[':subEvents'] = dto.subEvents;
      changes.push({
        field: 'subEventCount',
        oldValue: existing.subEvents?.length ?? 0,
        newValue: dto.subEvents.length,
      });
    }

    if (updates.length === 0) {
      // Nothing changed materially — return existing as-is.
      return this.toResponse(existing);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');

    // C4.4 — by design we DON'T touch child CalendarDate rows here.
    // Operators may have hand-edited their `calendarEvents`,
    // `bellScheduleId`, `notes`, or even the denormalized
    // `blockName` / `subEventName` on individual children. Block-
    // level PATCH stays scoped to the parent row; downstream UI
    // refreshes from the parent for display purposes.
    const updated = await this.dynamoDBClient.updateItem<CalendarBlock>(
      client,
      context.tenantId,
      CalendarBlockKeyBuilder.calendarBlock(schoolId, blockId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names,
    );

    await this.auditedWrite.emit(context, {
      schoolId,
      targetEntity: 'CALENDAR_BLOCK',
      targetEntityId: blockId,
      action: 'update',
      severity: 'normal',
      changes,
    });

    this.logger.log(`CalendarBlock updated: ${blockId} (${changes.length} field changes)`);
    return this.toResponse(updated);
  }

  // ------------------------------------------------------------------
  // DELETE — C4.3.c (cascade child dates via GSI9)
  // ------------------------------------------------------------------

  async deleteBlock(
    schoolId: string,
    blockId: string,
    context: RequestContext,
  ): Promise<{ deletedChildren: number }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const block = await this.dynamoDBClient.getItem<CalendarBlock>(
      client,
      context.tenantId,
      CalendarBlockKeyBuilder.calendarBlock(schoolId, blockId),
    );
    if (!block) {
      throw new NotFoundException({
        errorCode: 'BLOCK_NOT_FOUND',
        message: `CalendarBlock ${blockId} not found in school ${schoolId}.`,
      });
    }

    // Pull child CalendarDate rows via GSI9 (BLOCK#{blockId} → DATE#{date}).
    const children = await this.dynamoDBClient.queryGSI<CalendarDate>(
      client,
      'GSI9',
      `BLOCK#${blockId}`,
      'DATE#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      400, // upper bound; MAX_BLOCK_DAYS is 90, this is defensive
    );

    // Batch-delete children + the block row. BatchWriteItems hard-cap = 25.
    const deleteRequests = [
      ...children.items.map((cd) => ({
        DeleteRequest: { Key: { tenantId: context.tenantId, entityKey: cd.entityKey } },
      })),
      {
        DeleteRequest: {
          Key: {
            tenantId: context.tenantId,
            entityKey: CalendarBlockKeyBuilder.calendarBlock(schoolId, blockId),
          },
        },
      },
    ];

    for (let i = 0; i < deleteRequests.length; i += BATCH_WRITE_LIMIT) {
      await this.dynamoDBClient.batchWriteItems(
        client,
        deleteRequests.slice(i, i + BATCH_WRITE_LIMIT),
      );
    }

    await this.auditedWrite.emit(context, {
      schoolId,
      targetEntity: 'CALENDAR_BLOCK',
      targetEntityId: blockId,
      action: 'delete',
      severity: 'high',
      changes: [
        { field: 'blockName', oldValue: block.blockName, newValue: null },
        { field: 'blockDescriptor', oldValue: block.blockDescriptor, newValue: null },
        { field: 'startDate', oldValue: block.startDate, newValue: null },
        { field: 'endDate', oldValue: block.endDate, newValue: null },
        { field: 'cascadedChildren', oldValue: null, newValue: children.items.length },
      ],
    });

    this.logger.log(
      `CalendarBlock deleted: ${blockId}; cascaded ${children.items.length} child dates.`,
    );

    return { deletedChildren: children.items.length };
  }

  // ------------------------------------------------------------------
  // Response shaping
  // ------------------------------------------------------------------

  private toResponse(b: CalendarBlock): CalendarBlockResponseDto {
    return {
      blockId: b.blockId,
      schoolId: b.schoolId,
      tenantId: b.tenantId,
      academicYearId: b.academicYearId,
      blockName: b.blockName,
      blockDescriptor: b.blockDescriptor,
      startDate: b.startDate,
      endDate: b.endDate,
      childEventType: b.childEventType as any,
      childDateCount:
        b.childDateCount ?? computeChildDateCount(b.startDate, b.endDate),
      subEvents: b.subEvents,
      description: b.description,
      createdAt: b.createdAt,
      createdBy: b.createdBy,
      updatedAt: b.updatedAt,
      updatedBy: b.updatedBy,
    };
  }
}
