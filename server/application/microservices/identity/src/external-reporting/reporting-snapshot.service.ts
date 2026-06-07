/**
 * ReportingSnapshot Service — Sprint E.1.4 + E.1.5 + E.1.7
 *
 * Operator-facing API for CEHRD IEMIS Flash I/II (and future external
 * authority) report submissions. Concerns:
 *
 *   - createSnapshot()    — POST /reporting/snapshots (E.1.4): persists
 *                            ReportingSnapshot in `generating`; emits
 *                            `reporting.snapshot_initiated`; triggers
 *                            the Lambda async (EventBridge custom event)
 *   - preflightSnapshot() — POST /reporting/snapshots/preflight (E.1.5):
 *                            sync, no-write; surfaces row-level errors
 *                            (blocking) + warnings (e.g. §17.6 historical
 *                            debt) before operator commits
 *   - getSnapshot()       — GET /reporting/snapshots/:id
 *   - transitionSnapshot() — PATCH /reporting/snapshots/:id/transition
 *                            (used by Lambda completion handler + operator
 *                            manual "Mark submitted" / "Mark verified")
 *
 * Audited writes (invariants 5+6) on every state transition. Event
 * emission folded into transitions (E.1.7).
 */

import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  type CreateReportingSnapshotDto,
  type ListReportingSnapshotsQueryDto,
  type ListReportingSnapshotsResponseDto,
  type PreflightReportingSnapshotDto,
  type PreflightReportingSnapshotResponseDto,
  type ReportingSnapshotDownloadResponseDto,
  type ReportingSnapshotErrorDto,
  type ReportingSnapshotResponseDto,
  type ReportingSnapshotWarningDto,
  type TransitionReportingSnapshotDto,
} from '@aibrains/shared-types';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { S3PresignerService } from '../common/services/s3-presigner.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { RequestContext } from '../common/entities/base.entity';
import {
  ReportingSnapshot,
  ReportingTemplateId,
  ReportingSnapshotStatus,
  createReportingSnapshotEntity,
  isLegalTransition,
} from '../common/entities/reporting-snapshot.entity';
import { EntityKeyBuilder } from '../common/entities/base.entity';

// Schema versions per template — locked to v1 for the Sprint E.1 release.
// Future updates bump per-template independently.
const SCHEMA_VERSIONS: Record<ReportingTemplateId, string> = {
  IEMIS_NPL_CEHRD_FLASH_I: 'v1',
  IEMIS_NPL_CEHRD_FLASH_II: 'v1',
  CBSE_IN: 'v1',
  STATE_DOE_TX: 'v1',
};

// EventBridge bus name — sourced from env per CDK wiring convention.
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';
// Custom-source for E.1.3 Lambda invocation events.
const REPORT_AGGREGATOR_EVENT_SOURCE = 'edforge.reporting';
const REPORT_AGGREGATOR_DETAIL_TYPE = 'reporting.snapshot_requested';

// Statuses whose CSV artifact exists in S3 and can be downloaded. Excludes
// `generating` (not written yet) and `failed` (no artifact). Dry-run rows are
// rejected separately — the Lambda computes an s3Key but skips the PutObject.
const DOWNLOADABLE_STATUSES: ReadonlySet<ReportingSnapshotStatus> = new Set([
  'generated',
  'submitted',
  'verified',
]);

// Presigned-URL lifetime for report downloads. Long enough for a click-through
// + retry; short enough that a leaked URL ages out quickly.
const DOWNLOAD_URL_EXPIRY_SECONDS = 600;

@Injectable()
export class ReportingSnapshotService {
  private readonly logger = new Logger(ReportingSnapshotService.name);
  private readonly eventBridge = new EventBridgeClient({});

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly auditedWrite: AuditedWriteService,
    private readonly events: IdentityEventsService,
    private readonly s3Presigner: S3PresignerService,
  ) {}

  // ------------------------------------------------------------------
  // E.1.4 — POST /reporting/snapshots
  // ------------------------------------------------------------------

  async createSnapshot(
    dto: CreateReportingSnapshotDto,
    context: RequestContext,
  ): Promise<ReportingSnapshotResponseDto> {
    const snapshotId = randomUUID();
    const schemaVersion = SCHEMA_VERSIONS[dto.templateId];

    const entity = createReportingSnapshotEntity({
      tenantId: context.tenantId,
      schoolId: dto.schoolId,
      snapshotId,
      templateId: dto.templateId,
      academicYearBs: dto.academicYearBs,
      schemaVersion,
      createdBy: context.userId,
      dryRun: dto.dryRun,
    });

    // Persist as `generating`. Idempotent by snapshotId (random UUID per
    // call so collisions are vanishingly unlikely; if the put fails on
    // condition-collision we surface a 500 — unrecoverable.)
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    await this.dynamoDBClient.putItem(client, entity);

    // E.1.7 — audit on create.
    await this.auditedWrite.emit(context, {
      schoolId: dto.schoolId,
      targetEntity: 'REPORTING_SNAPSHOT',
      targetEntityId: snapshotId,
      action: 'create',
      severity: 'normal',
      changes: [
        { field: 'templateId', oldValue: null, newValue: dto.templateId },
        { field: 'academicYearBs', oldValue: null, newValue: dto.academicYearBs },
        { field: 'status', oldValue: null, newValue: 'generating' },
        { field: 'dryRun', oldValue: null, newValue: dto.dryRun ?? false },
      ],
    });

    // E.1.7 — domain event on create.
    await this.events.publishValidatedEvent({
      eventType: 'reporting.snapshot_initiated',
      tenantId: context.tenantId,
      sourceUserId: context.userId,
      timestamp: new Date().toISOString(),
      snapshotId,
      schoolId: dto.schoolId,
      templateId: dto.templateId,
      academicYearBs: dto.academicYearBs,
      initiatedBy: context.userId,
      initiatedAt: entity.createdAt,
      dryRun: dto.dryRun,
    });

    // Fire EventBridge event to trigger the report-aggregator Lambda (E.1.3).
    // Lambda picks up the snapshotId, performs the DDB read + CSV write,
    // then calls back via PATCH transition to flip to `generated`/`failed`.
    await this.eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: EVENT_BUS_NAME,
            Source: REPORT_AGGREGATOR_EVENT_SOURCE,
            DetailType: REPORT_AGGREGATOR_DETAIL_TYPE,
            Detail: JSON.stringify({
              snapshotId,
              tenantId: context.tenantId,
              schoolId: dto.schoolId,
              templateId: dto.templateId,
              academicYearBs: dto.academicYearBs,
              schemaVersion,
              dryRun: dto.dryRun ?? false,
            }),
          },
        ],
      }),
    );

    this.logger.log(
      `ReportingSnapshot created: ${snapshotId} template=${dto.templateId} ` +
      `school=${dto.schoolId} year=${dto.academicYearBs} actor=${context.userId}`,
    );

    return this.toResponseDto(entity);
  }

  // ------------------------------------------------------------------
  // E.1.5 — POST /reporting/snapshots/preflight
  // ------------------------------------------------------------------

  async preflightSnapshot(
    dto: PreflightReportingSnapshotDto,
    context: RequestContext,
  ): Promise<PreflightReportingSnapshotResponseDto> {
    // V1 scope — light-touch validation:
    //
    //   - Verifies the school exists in identity DDB (catches typos before
    //     the Lambda burns a CSV-gen cycle).
    //   - Verifies an AcademicYear matches `dto.academicYearBs` for the
    //     school (catches "wrong year label" mistakes — common UX miss in
    //     pilots).
    //   - rowCount is NOT computed here (would require cross-service read
    //     into the academics table; the identity ECS role doesn't have that
    //     IAM grant). The Lambda materializes the row count during gen and
    //     surfaces it via the `generated` lifecycle event.
    //
    // V1.5 expansion — when the IAM grant for academics cross-read lands,
    // pre-flight will also count enrollments, validate per-row required
    // fields, and surface Sprint-0.1 historical-debt warnings (§17.6).
    const errors: ReportingSnapshotErrorDto[] = [];
    const warnings: ReportingSnapshotWarningDto[] = [];

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // 1. School existence check. rowIndex=0 represents a "global" (non-row)
    //    error since the row-population hasn't been read yet.
    const school = await this.dynamoDBClient.getItem<Record<string, unknown>>(
      client,
      context.tenantId,
      EntityKeyBuilder.school(dto.schoolId),
    );
    if (!school) {
      errors.push({
        rowIndex: 0,
        field: 'schoolId',
        error: `School ${dto.schoolId} does not exist for tenant ${context.tenantId}`,
      });
      return {
        rowCount: 0,
        errors,
        warnings,
        canProceed: false,
      };
    }

    // 1b. IEMIS school code — `school_iemis_code` is the first, required column
    //     of every CEHRD Flash CSV; without a valid one the upload is rejected.
    //     The FE eligibility-gate checks presence; here we additionally validate
    //     the format. Nepal IEMIS school codes are 9-digit numeric (e.g.
    //     230500001, encoding province/district/local-level/school) — a
    //     mismatch is a WARNING not a hard block, since the exact format is not
    //     fully pinned (see the IEMIS-template follow-up).
    const emisSchoolCode =
      typeof school.emisSchoolCode === 'string'
        ? school.emisSchoolCode
        : typeof school.emisCode === 'string'
          ? (school.emisCode as string)
          : undefined;
    if (!emisSchoolCode) {
      errors.push({
        rowIndex: 0,
        field: 'emisSchoolCode',
        error:
          `School ${dto.schoolId} has no IEMIS code; school_iemis_code would be ` +
          'blank and CEHRD will reject the upload. Set the IEMIS code in school settings.',
      });
    } else if (!/^\d{9}$/.test(emisSchoolCode)) {
      warnings.push({
        rowIndex: 0,
        field: 'emisSchoolCode',
        message:
          `IEMIS school code "${emisSchoolCode}" is not the expected 9-digit ` +
          'numeric format.',
        suggestedRemedy: 'Verify the code against your CEHRD/IEMIS records.',
      });
    }

    // 2. AcademicYear lookup — `name` field carries the BS year (PABSON);
    //    fall back to startDateBS for tenants whose `name` is Gregorian.
    const years = await this.dynamoDBClient.query<Record<string, unknown>>(
      client,
      context.tenantId,
      `SCHOOL#${dto.schoolId}#YEAR#`,
    );
    const ayMatch = years.items.find(
      (y) =>
        (typeof y.name === 'string' && y.name.includes(dto.academicYearBs)) ||
        (typeof y.startDateBS === 'string' && y.startDateBS.startsWith(dto.academicYearBs)),
    );
    if (!ayMatch) {
      errors.push({
        rowIndex: 0,
        field: 'academicYearBs',
        error: `No AcademicYear matching BS=${dto.academicYearBs} for school ${dto.schoolId}`,
      });
    }

    // 3. V1 scope note (always emitted for operator awareness).
    warnings.push({
      rowIndex: 0,
      field: 'preflightScope',
      message:
        'Pre-flight verifies the school, its IEMIS code, and the academic year. Per-student field validation runs during generation; failures surface on the snapshot row as status=failed.',
      suggestedRemedy: 'Inspect snapshot status after submit',
    });

    this.logger.log(
      `Pre-flight executed: template=${dto.templateId} school=${dto.schoolId} ` +
      `year=${dto.academicYearBs} errors=${errors.length} warnings=${warnings.length} ` +
      `actor=${context.userId}`,
    );

    return {
      rowCount: 0,
      errors,
      warnings,
      canProceed: errors.length === 0,
    };
  }

  // ------------------------------------------------------------------
  // GET /reporting/snapshots/:id
  // ------------------------------------------------------------------

  async getSnapshot(
    snapshotId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<ReportingSnapshotResponseDto> {
    const entity = await this.fetchEntity(snapshotId, schoolId, context);
    return this.toResponseDto(entity);
  }

  // ------------------------------------------------------------------
  // GET /reporting/snapshots?schoolId=  — list a school's snapshots
  // ------------------------------------------------------------------

  async listSnapshots(
    query: ListReportingSnapshotsQueryDto,
    context: RequestContext,
  ): Promise<ListReportingSnapshotsResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Paginate through every DynamoDB page before filtering — a single Query
    // caps at ~1 MB, and snapshots accumulate without auto-delete ("every
    // historical CSV may be needed for CEHRD reconciliation"), so a one-page
    // read would silently drop the oldest rows and miscount. Mirrors the
    // schools.service paginate-then-filter idiom.
    const items: ReportingSnapshot[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await this.dynamoDBClient.query<ReportingSnapshot>(
        client,
        context.tenantId,
        `SCHOOL#${query.schoolId}#REPORTING_SNAPSHOT#`,
        undefined,
        undefined,
        undefined,
        undefined,
        exclusiveStartKey,
      );
      items.push(...page.items);
      exclusiveStartKey = page.lastEvaluatedKey
        ? JSON.parse(Buffer.from(page.lastEvaluatedKey, 'base64').toString())
        : undefined;
    } while (exclusiveStartKey);

    const filtered = items.filter(
      (s) =>
        (!query.templateId || s.templateId === query.templateId) &&
        (!query.academicYearBs || s.academicYearBs === query.academicYearBs) &&
        (!query.status || s.status === query.status),
    );
    // Newest first — createdAt is ISO-8601 so lexical sort is chronological.
    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      snapshots: filtered.map((e) => this.toResponseDto(e)),
      count: filtered.length,
    };
  }

  // ------------------------------------------------------------------
  // GET /reporting/snapshots/:id/download — presigned CSV URL
  // ------------------------------------------------------------------

  async getSnapshotDownloadUrl(
    snapshotId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<ReportingSnapshotDownloadResponseDto> {
    const entity = await this.fetchEntity(snapshotId, schoolId, context);

    if (entity.dryRun) {
      throw new ConflictException({
        errorCode: 'SNAPSHOT_DRY_RUN',
        message: 'Dry-run snapshots produce no downloadable CSV',
      });
    }
    if (!DOWNLOADABLE_STATUSES.has(entity.status) || !entity.s3Key) {
      throw new ConflictException({
        errorCode: 'SNAPSHOT_NOT_DOWNLOADABLE',
        message:
          `Snapshot ${snapshotId} has no downloadable CSV (status=${entity.status}). ` +
          'The CSV is available once generation completes.',
        details: { status: entity.status },
      });
    }

    const url = await this.s3Presigner.presignReportDownload(
      context.jwtToken,
      entity.s3Key,
      DOWNLOAD_URL_EXPIRY_SECONDS,
    );

    this.logger.log(
      `ReportingSnapshot download URL minted: ${snapshotId} school=${schoolId} ` +
      `actor=${context.userId}`,
    );

    return {
      url,
      fileName: this.buildDownloadFileName(entity),
      s3Key: entity.s3Key,
      expiresInSeconds: DOWNLOAD_URL_EXPIRY_SECONDS,
      expiresAt: new Date(Date.now() + DOWNLOAD_URL_EXPIRY_SECONDS * 1000).toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // PATCH /reporting/snapshots/:id/transition (E.1.7 audit + event emit)
  // ------------------------------------------------------------------

  async transitionSnapshot(
    snapshotId: string,
    schoolId: string,
    dto: TransitionReportingSnapshotDto,
    context: RequestContext,
  ): Promise<ReportingSnapshotResponseDto> {
    const entity = await this.fetchEntity(snapshotId, schoolId, context);

    if (!isLegalTransition(entity.status, dto.nextStatus)) {
      throw new ConflictException({
        errorCode: 'SNAPSHOT_INVALID_TRANSITION',
        message: `Cannot transition from ${entity.status} to ${dto.nextStatus}`,
        details: { from: entity.status, to: dto.nextStatus },
      });
    }

    const now = new Date().toISOString();
    const fromStatus: ReportingSnapshotStatus = entity.status;

    // Field updates derived from target status.
    const updates: Record<string, unknown> = {
      status: dto.nextStatus,
      updatedAt: now,
      updatedBy: context.userId,
      version: entity.version + 1,
    };

    if (dto.nextStatus === 'submitted') {
      updates.submittedAt = now;
      updates.submittedBy = context.userId;
    }
    if (dto.nextStatus === 'verified') {
      updates.verifiedAt = now;
      updates.verifiedBy = context.userId;
    }
    if (dto.nextStatus === 'failed') {
      if (!dto.errorCode || !dto.errorSummary) {
        throw new BadRequestException({
          errorCode: 'TRANSITION_REQUIRES_ERROR_DETAIL',
          message: 'errorCode + errorSummary are required when transitioning to failed',
        });
      }
      updates.errorCode = dto.errorCode;
      updates.errorSummary = dto.errorSummary;
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const setExpressions: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      setExpressions.push(`#${k} = :${k}`);
      names[`#${k}`] = k;
      values[`:${k}`] = v;
    }
    values[':expectedVersion'] = entity.version;

    const updated = await this.dynamoDBClient.updateItem<ReportingSnapshot>(
      client,
      context.tenantId,
      EntityKeyBuilder.reportingSnapshot(schoolId, snapshotId),
      `SET ${setExpressions.join(', ')}`,
      values,
      '#version = :expectedVersion',
      names,
    );

    // E.1.7 — audit per transition.
    await this.auditedWrite.emit(context, {
      schoolId,
      targetEntity: 'REPORTING_SNAPSHOT',
      targetEntityId: snapshotId,
      action: 'update',
      severity: dto.nextStatus === 'failed' ? 'high' : 'normal',
      changes: [
        { field: 'status', oldValue: fromStatus, newValue: dto.nextStatus },
        ...(dto.errorCode
          ? [{ field: 'errorCode', oldValue: null, newValue: dto.errorCode }]
          : []),
      ],
    });

    // E.1.7 — domain event per terminal transition.
    if (dto.nextStatus === 'generated') {
      await this.events.publishValidatedEvent({
        eventType: 'reporting.snapshot_generated',
        tenantId: context.tenantId,
        sourceUserId: context.userId,
        timestamp: now,
        snapshotId,
        schoolId,
        templateId: entity.templateId,
        rowCount: entity.rowCount ?? 0,
        s3Key: entity.s3Key ?? '',
        generatedAt: now,
        schemaVersion: entity.schemaVersion,
      });
    } else if (dto.nextStatus === 'failed') {
      await this.events.publishValidatedEvent({
        eventType: 'reporting.snapshot_failed',
        tenantId: context.tenantId,
        sourceUserId: context.userId,
        timestamp: now,
        snapshotId,
        schoolId,
        templateId: entity.templateId,
        failedAt: now,
        errorCode: dto.errorCode!,
        errorMessage: dto.errorSummary!,
      });
    } else if (dto.nextStatus === 'submitted') {
      // Reuses the existing C0.c.2 `reporting.submitted` event for
      // operator-driven "manual upload to IEMIS portal" confirmation.
      await this.events.publishValidatedEvent({
        eventType: 'reporting.submitted',
        tenantId: context.tenantId,
        sourceUserId: context.userId,
        timestamp: now,
        reportId: snapshotId,
        schoolId,
        yearId: entity.academicYearBs,
        reportType: entity.templateId,
        submittedAt: now,
        csvS3Key: entity.s3Key,
      });
    }

    this.logger.log(
      `ReportingSnapshot transitioned: ${snapshotId} ${fromStatus} → ${dto.nextStatus}`,
    );

    return this.toResponseDto(updated);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async fetchEntity(
    snapshotId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<ReportingSnapshot> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const row = await this.dynamoDBClient.getItem<ReportingSnapshot>(
      client,
      context.tenantId,
      EntityKeyBuilder.reportingSnapshot(schoolId, snapshotId),
    );
    if (!row) {
      throw new NotFoundException({
        errorCode: 'SNAPSHOT_NOT_FOUND',
        message: `ReportingSnapshot ${snapshotId} not found`,
      });
    }
    return row;
  }

  /**
   * Operator-friendly CSV filename for the browser's Save dialog, e.g.
   * `IEMIS_NPL_CEHRD_FLASH_I_2083.csv`. The presigned URL points at an
   * opaque `{snapshotId}.csv` S3 key, so we name the download here.
   */
  private buildDownloadFileName(e: ReportingSnapshot): string {
    return `${e.templateId}_${e.academicYearBs}.csv`;
  }

  private toResponseDto(e: ReportingSnapshot): ReportingSnapshotResponseDto {
    return {
      snapshotId: e.snapshotId,
      schoolId: e.schoolId,
      templateId: e.templateId,
      academicYearBs: e.academicYearBs,
      status: e.status,
      s3Key: e.s3Key,
      rowCount: e.rowCount,
      generatedAt: e.generatedAt,
      submittedAt: e.submittedAt,
      submittedBy: e.submittedBy,
      verifiedAt: e.verifiedAt,
      verifiedBy: e.verifiedBy,
      errorCode: e.errorCode,
      errorSummary: e.errorSummary,
      schemaVersion: e.schemaVersion,
      dryRun: e.dryRun,
      createdAt: e.createdAt,
      createdBy: e.createdBy,
      updatedAt: e.updatedAt,
    };
  }
}
