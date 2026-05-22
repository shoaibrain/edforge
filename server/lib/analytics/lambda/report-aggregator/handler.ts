/**
 * Report-aggregator Lambda — Sprint E.1.3
 *
 * Triggered by EventBridge custom event:
 *   source       = edforge.reporting
 *   detail-type  = reporting.snapshot_requested
 *
 * Steps:
 *   1. Parse event.detail → ReportAggregatorEventDetail
 *   2. Read School + AcademicYear (identity table)
 *   3. List Enrollments (academics, by school+year)
 *   4. Read Students (academics, BatchGet by studentId set)
 *   5. (Flash II only) aggregate Attendance per student
 *   6. Build CSV via template-driven generator
 *   7. Write to S3 staging bucket (skipped when dryRun)
 *   8. UpdateItem snapshot → status=generated (or =failed on error)
 *   9. Emit reporting.snapshot_generated or reporting.snapshot_failed event
 *
 * Cardinal rules:
 *   - Never throw — always route to UpdateItem(failed) + lifecycle event so
 *     the snapshot row never gets stuck in `generating`.
 *   - Tenant-scoped reads only — every Query/Get includes tenantId.
 *   - Lambda updates DDB directly (no Nest auditedWrite); operator audit
 *     trail comes from the lifecycle event + the snapshot row updatedBy='system'.
 */

import type { EventBridgeEvent } from 'aws-lambda';
import {
  DynamoDBClient,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import { generateFlashICsv } from './flash-i.generator';
import { generateFlashIICsv } from './flash-ii.generator';
import {
  aggregateAttendance,
  buildSessionShape,
  listEnrollmentsForSchoolYear,
  readSchool,
  readStudents,
  resolveAcademicYearId,
} from './reader';
import type { ReportAggregatorEventDetail, ReportRow } from './types';

const REGION = process.env.AWS_REGION;
const IDENTITY_TABLE = process.env.IDENTITY_TABLE_NAME ?? 'edforge-identity-basic';
const ACADEMICS_TABLE = process.env.ACADEMICS_TABLE_NAME ?? 'edforge-academics-basic';
const STAGING_BUCKET = process.env.REPORTS_STAGING_BUCKET_NAME;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? 'default';
const ENABLED = process.env.REPORT_AGGREGATOR_ENABLED !== 'false';

const ddb = new DynamoDBClient({ region: REGION, maxAttempts: 3 });
const s3 = new S3Client({ region: REGION, maxAttempts: 3 });
const eb = new EventBridgeClient({ region: REGION, maxAttempts: 3 });
const cw = new CloudWatchClient({ region: REGION, maxAttempts: 3 });

function log(level: 'info' | 'warn' | 'error', msg: string, meta: Record<string, unknown> = {}) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify({ level, msg, ...meta }));
}

function buildS3Key(detail: ReportAggregatorEventDetail): string {
  return (
    `tenant=${detail.tenantId}/school=${detail.schoolId}/` +
    `template=${detail.templateId}/year=${detail.academicYearBs}/` +
    `${detail.snapshotId}.csv`
  );
}

async function updateSnapshotGenerated(
  detail: ReportAggregatorEventDetail,
  s3Key: string,
  rowCount: number,
): Promise<void> {
  const now = new Date().toISOString();
  await ddb.send(
    new UpdateItemCommand({
      TableName: IDENTITY_TABLE,
      Key: {
        tenantId: { S: `TENANT#${detail.tenantId}` },
        entityKey: { S: `SCHOOL#${detail.schoolId}#REPORTING_SNAPSHOT#${detail.snapshotId}` },
      },
      UpdateExpression:
        'SET #status = :status, #s3Key = :s3Key, #rowCount = :rowCount, ' +
        '#generatedAt = :now, #updatedAt = :now, #updatedBy = :system, ' +
        '#version = #version + :one',
      ConditionExpression: '#status = :generating',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#s3Key': 's3Key',
        '#rowCount': 'rowCount',
        '#generatedAt': 'generatedAt',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
        '#version': 'version',
      },
      ExpressionAttributeValues: {
        ':status': { S: 'generated' },
        ':generating': { S: 'generating' },
        ':s3Key': { S: s3Key },
        ':rowCount': { N: String(rowCount) },
        ':now': { S: now },
        ':system': { S: 'system' },
        ':one': { N: '1' },
      },
    }),
  );
}

async function updateSnapshotFailed(
  detail: ReportAggregatorEventDetail,
  errorCode: string,
  errorSummary: string,
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: IDENTITY_TABLE,
        Key: {
          tenantId: { S: `TENANT#${detail.tenantId}` },
          entityKey: { S: `SCHOOL#${detail.schoolId}#REPORTING_SNAPSHOT#${detail.snapshotId}` },
        },
        UpdateExpression:
          'SET #status = :status, #errorCode = :errorCode, #errorSummary = :errorSummary, ' +
          '#updatedAt = :now, #updatedBy = :system, #version = #version + :one',
        ConditionExpression: '#status = :generating',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#errorCode': 'errorCode',
          '#errorSummary': 'errorSummary',
          '#updatedAt': 'updatedAt',
          '#updatedBy': 'updatedBy',
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':status': { S: 'failed' },
          ':generating': { S: 'generating' },
          ':errorCode': { S: errorCode },
          ':errorSummary': { S: errorSummary },
          ':now': { S: now },
          ':system': { S: 'system' },
          ':one': { N: '1' },
        },
      }),
    );
  } catch (e) {
    log('error', 'updateSnapshotFailed failed — snapshot may be stuck', {
      snapshotId: detail.snapshotId,
      e: String(e),
    });
  }
}

async function emitLifecycleEvent(
  source: string,
  detailType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await eb.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: EVENT_BUS_NAME,
            Source: source,
            DetailType: detailType,
            Detail: JSON.stringify(payload),
          },
        ],
      }),
    );
  } catch (e) {
    log('error', 'emitLifecycleEvent failed (non-fatal)', { detailType, e: String(e) });
  }
}

async function publishMetric(name: string, value = 1): Promise<void> {
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: 'Edforge/Reporting',
        MetricData: [{ MetricName: name, Value: value, Unit: 'Count' }],
      }),
    );
  } catch (e) {
    log('warn', 'publishMetric failed (non-fatal)', { name, e: String(e) });
  }
}

async function buildReportRows(
  detail: ReportAggregatorEventDetail,
  needsAttendance: boolean,
): Promise<ReportRow[]> {
  const school = await readSchool(ddb, IDENTITY_TABLE, detail.tenantId, detail.schoolId);
  const { yearId } = await resolveAcademicYearId(
    ddb,
    IDENTITY_TABLE,
    detail.tenantId,
    detail.schoolId,
    detail.academicYearBs,
  );
  const enrollments = await listEnrollmentsForSchoolYear(
    ddb,
    ACADEMICS_TABLE,
    detail.tenantId,
    detail.schoolId,
    yearId,
  );
  const studentIds = Array.from(new Set(enrollments.map((e) => e.studentId)));
  const students = await readStudents(ddb, ACADEMICS_TABLE, detail.tenantId, studentIds);

  const session = buildSessionShape(detail.academicYearBs);

  const rows: ReportRow[] = [];
  for (const enrollment of enrollments) {
    const student = students.get(enrollment.studentId);
    if (!student) continue;     // student deleted but enrollment lingers — skip
    const row: ReportRow = {
      student,
      enrollment,
      session,
      school,
    };
    if (needsAttendance) {
      // V1 — returns zeros; see reader.aggregateAttendance comments.
      row.attendance = await aggregateAttendance(
        ddb,
        ACADEMICS_TABLE,
        detail.tenantId,
        enrollment.studentId,
        '',
        '',
      );
    }
    rows.push(row);
  }
  return rows;
}

// --------------------------------------------------------------------------
// Handler
// --------------------------------------------------------------------------

export async function handler(
  event: EventBridgeEvent<'reporting.snapshot_requested', ReportAggregatorEventDetail>,
): Promise<void> {
  if (!ENABLED) {
    log('info', 'report-aggregator disabled (env)');
    return;
  }
  if (!STAGING_BUCKET) {
    log('error', 'REPORTS_STAGING_BUCKET_NAME env var is required');
    return;
  }

  const detail = event.detail;
  log('info', 'snapshot_requested received', {
    snapshotId: detail.snapshotId,
    template: detail.templateId,
    school: detail.schoolId,
    year: detail.academicYearBs,
    dryRun: detail.dryRun,
  });

  try {
    const isFlashI = detail.templateId === 'IEMIS_NPL_CEHRD_FLASH_I';
    const isFlashII = detail.templateId === 'IEMIS_NPL_CEHRD_FLASH_II';
    if (!isFlashI && !isFlashII) {
      await updateSnapshotFailed(
        detail,
        'TEMPLATE_NOT_SUPPORTED',
        `Template ${detail.templateId} not yet supported in V1`,
      );
      await emitLifecycleEvent('edforge.reporting', 'reporting.snapshot_failed', {
        snapshotId: detail.snapshotId,
        templateId: detail.templateId,
        schoolId: detail.schoolId,
        errorCode: 'TEMPLATE_NOT_SUPPORTED',
      });
      await publishMetric('SnapshotsFailed');
      return;
    }

    const rows = await buildReportRows(detail, isFlashII);

    let csv: string;
    let rowCount: number;
    if (isFlashI) {
      const out = generateFlashICsv(rows);
      csv = out.csv;
      rowCount = out.rowCount;
    } else {
      const out = generateFlashIICsv(rows);
      csv = out.csv;
      rowCount = out.rowCount;
      if (out.missingExamPipelineCount > 0) {
        log('warn', 'flash-ii: exam pipeline columns blank for rows', {
          missing: out.missingExamPipelineCount,
          note: 'Sprint C5+C6+C7 gating per V1 master plan §A.2',
        });
      }
    }

    const s3Key = buildS3Key(detail);
    if (!detail.dryRun) {
      await s3.send(
        new PutObjectCommand({
          Bucket: STAGING_BUCKET,
          Key: s3Key,
          Body: csv,
          ContentType: 'text/csv; charset=utf-8',
          ServerSideEncryption: 'AES256',
          Metadata: {
            tenantId: detail.tenantId,
            schoolId: detail.schoolId,
            templateId: detail.templateId,
            snapshotId: detail.snapshotId,
            schemaVersion: detail.schemaVersion,
          },
        }),
      );
    }

    await updateSnapshotGenerated(detail, s3Key, rowCount);
    await emitLifecycleEvent('edforge.reporting', 'reporting.snapshot_generated', {
      snapshotId: detail.snapshotId,
      tenantId: detail.tenantId,
      schoolId: detail.schoolId,
      templateId: detail.templateId,
      schemaVersion: detail.schemaVersion,
      rowCount,
      s3Key,
      generatedAt: new Date().toISOString(),
    });
    await publishMetric('SnapshotsGenerated');
    log('info', 'snapshot_generated', {
      snapshotId: detail.snapshotId,
      rowCount,
      s3Key,
      dryRun: detail.dryRun,
    });
  } catch (e) {
    const errorCode = e instanceof Error && e.message.startsWith('SCHOOL_NOT_FOUND')
      ? 'SCHOOL_NOT_FOUND'
      : e instanceof Error && e.message.startsWith('ACADEMIC_YEAR_NOT_FOUND')
        ? 'ACADEMIC_YEAR_NOT_FOUND'
        : 'AGGREGATOR_INTERNAL_ERROR';
    const errorSummary = e instanceof Error ? e.message : String(e);
    log('error', 'aggregator failed', {
      snapshotId: detail.snapshotId,
      errorCode,
      errorSummary,
    });
    await updateSnapshotFailed(detail, errorCode, errorSummary);
    await emitLifecycleEvent('edforge.reporting', 'reporting.snapshot_failed', {
      snapshotId: detail.snapshotId,
      tenantId: detail.tenantId,
      schoolId: detail.schoolId,
      templateId: detail.templateId,
      errorCode,
      errorSummary,
      failedAt: new Date().toISOString(),
    });
    await publishMetric('SnapshotsFailed');
  }
}
