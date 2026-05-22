/**
 * report-aggregator handler unit tests — Sprint E.1.3
 *
 * Covers:
 *   - Flash I happy path: reads pop, writes CSV to S3, updates DDB, emits event
 *   - Flash II: empty-result-card warning emitted; CSV still generated
 *   - Unknown templateId → updateSnapshotFailed with TEMPLATE_NOT_SUPPORTED
 *   - SCHOOL_NOT_FOUND propagates to errorCode = SCHOOL_NOT_FOUND
 *   - ACADEMIC_YEAR_NOT_FOUND propagates
 *   - dryRun=true → skips PutObject but still updates DDB + emits event
 *   - REPORT_AGGREGATOR_ENABLED=false → silent no-op
 *   - missing REPORTS_STAGING_BUCKET_NAME → logs error + returns
 */

const ddbSend = jest.fn();
const s3Send = jest.fn();
const ebSend = jest.fn();
const cwSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return {
    ...actual,
    DynamoDBClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => ddbSend(...args),
    })),
  };
});

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => s3Send(...args),
    })),
  };
});

jest.mock('@aws-sdk/client-eventbridge', () => {
  const actual = jest.requireActual('@aws-sdk/client-eventbridge');
  return {
    ...actual,
    EventBridgeClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => ebSend(...args),
    })),
  };
});

jest.mock('@aws-sdk/client-cloudwatch', () => {
  const actual = jest.requireActual('@aws-sdk/client-cloudwatch');
  return {
    ...actual,
    CloudWatchClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => cwSend(...args),
    })),
  };
});

import type { EventBridgeEvent } from 'aws-lambda';
import { GetItemCommand, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { ReportAggregatorEventDetail } from './types';

const ENV = {
  AWS_REGION: 'ap-south-1',
  IDENTITY_TABLE_NAME: 'edforge-identity-basic',
  ACADEMICS_TABLE_NAME: 'edforge-academics-basic',
  REPORTS_STAGING_BUCKET_NAME: 'edforge-reports-staging-test',
  EVENT_BUS_NAME: 'edforge-sbt-test',
};

function setEnv(): void {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  delete process.env.REPORT_AGGREGATOR_ENABLED;        // defaults to enabled
}

function clearEnv(): void {
  for (const k of Object.keys(ENV)) delete process.env[k];
}

function event(
  detail: ReportAggregatorEventDetail,
): EventBridgeEvent<'reporting.snapshot_requested', ReportAggregatorEventDetail> {
  return {
    version: '0',
    id: 'test-id',
    'detail-type': 'reporting.snapshot_requested',
    source: 'edforge.reporting',
    account: '123',
    time: '2026-05-22T00:00:00Z',
    region: 'ap-south-1',
    resources: [],
    detail,
  };
}

const baseDetail: ReportAggregatorEventDetail = {
  snapshotId: 'snap-1',
  tenantId: 'tenant-A',
  schoolId: 'school-1',
  templateId: 'IEMIS_NPL_CEHRD_FLASH_I',
  academicYearBs: '2083',
  schemaVersion: 'v1',
  dryRun: false,
};

// Helper: stub the read pipeline (school, AY resolve, enrollments, students).
function stubFlashIReads(): void {
  // 1. readSchool (GetItem on identity)
  ddbSend.mockResolvedValueOnce({
    Item: { tenantId: { S: 'TENANT#tenant-A' }, emisSchoolCode: { S: '12345' } },
  });
  // 2. resolveAcademicYearId (Query on identity GSI2)
  ddbSend.mockResolvedValueOnce({
    Items: [
      { yearId: { S: 'year-2083' }, name: { S: '2083' } },
    ],
  });
  // 3. listEnrollments (Query on academics, single page)
  ddbSend.mockResolvedValueOnce({
    Items: [
      {
        enrollmentId: { S: 'e1' },
        gradeLevel: { S: '5' },
        enrollmentType: { S: 'new' },
        studentId: { S: 'stu-1' },
      },
    ],
  });
  // 4. readStudents (GetItem per studentId)
  ddbSend.mockResolvedValueOnce({
    Item: {
      tenantId: { S: 'TENANT#tenant-A' },
      firstName: { S: 'Anil' },
      lastName: { S: 'Sharma' },
      dateOfBirth: { S: '2014-04-15' },
      sexDescriptor: { S: 'uri://ed-fi.org/SexDescriptor#Male' },
      ethnicityDescriptor: { S: 'edforge:Hill_Brahmin' },
      motherTongueDescriptor: { S: 'edforge:Nepali' },
      emisStudentId: { S: 'IEMIS-001' },
    },
  });
  // 5. updateSnapshotGenerated
  ddbSend.mockResolvedValueOnce({});
}

describe('report-aggregator handler', () => {
  beforeEach(() => {
    // clearAllMocks (NOT resetAllMocks) — resetAllMocks wipes the inner
    // mockImplementation set by jest.mock() at module load, which would
    // leave `new DynamoDBClient()` returning `{}` (no `send` method).
    jest.clearAllMocks();
    setEnv();
  });

  afterEach(() => {
    jest.resetModules();
    clearEnv();
  });

  // -------------------------------------------------------------------------

  it('Flash I happy path → writes CSV to S3 + updates DDB + emits generated event', async () => {
    stubFlashIReads();
    s3Send.mockResolvedValueOnce({});
    ebSend.mockResolvedValueOnce({});
    cwSend.mockResolvedValueOnce({});

    const { handler } = await import('./handler');
    await handler(event(baseDetail));

    // S3 PutObject called
    expect(s3Send).toHaveBeenCalledTimes(1);
    const putCall = s3Send.mock.calls[0]?.[0];
    expect(putCall).toBeInstanceOf(PutObjectCommand);
    const putInput = (putCall as PutObjectCommand).input;
    expect(putInput.Bucket).toBe('edforge-reports-staging-test');
    expect(putInput.Key).toBe(
      'tenant=tenant-A/school=school-1/template=IEMIS_NPL_CEHRD_FLASH_I/year=2083/snap-1.csv',
    );
    expect(putInput.ContentType).toBe('text/csv; charset=utf-8');
    const body = String(putInput.Body);
    expect(body).toContain('school_iemis_code');
    expect(body).toContain('"12345"');
    expect(body).toContain('"Anil"');
    expect(body).toContain('"M"');                     // sex transform
    expect(body).toContain('"Brahmin/Chhetri"');       // ethnicity band
    expect(body).toContain('"Nepali"');                // language

    // DDB UpdateItem to status=generated
    const updateCall = ddbSend.mock.calls.find(
      (c) => c[0]?.constructor?.name === 'UpdateItemCommand',
    )?.[0] as UpdateItemCommand | undefined;
    expect(updateCall).toBeDefined();
    expect((updateCall!).input.ConditionExpression).toBe('#status = :generating');
    expect((updateCall!).input.ExpressionAttributeValues!![':status']).toEqual({ S: 'generated' });

    // EventBridge: lifecycle event emit
    expect(ebSend).toHaveBeenCalledTimes(1);
    const ebCall = ebSend.mock.calls[0]?.[0] as PutEventsCommand;
    const evt = ebCall.input.Entries![0];
    expect(evt.Source).toBe('edforge.reporting');
    expect(evt.DetailType).toBe('reporting.snapshot_generated');
    const evtDetail = JSON.parse(evt.Detail!);
    expect(evtDetail.snapshotId).toBe('snap-1');
    expect(evtDetail.rowCount).toBe(1);
  });

  // -------------------------------------------------------------------------

  it('dryRun=true skips S3 PutObject but updates DDB + emits event', async () => {
    stubFlashIReads();
    ebSend.mockResolvedValueOnce({});
    cwSend.mockResolvedValueOnce({});

    const { handler } = await import('./handler');
    await handler(event({ ...baseDetail, dryRun: true }));

    expect(s3Send).not.toHaveBeenCalled();
    const updateCall = ddbSend.mock.calls.find(
      (c) => c[0]?.constructor?.name === 'UpdateItemCommand',
    );
    expect(updateCall).toBeDefined();
  });

  // -------------------------------------------------------------------------

  it('unknown templateId → updates snapshot to failed with TEMPLATE_NOT_SUPPORTED', async () => {
    // updateSnapshotFailed → 1 DDB call
    ddbSend.mockResolvedValueOnce({});
    ebSend.mockResolvedValueOnce({});
    cwSend.mockResolvedValueOnce({});

    const { handler } = await import('./handler');
    await handler(
      event({ ...baseDetail, templateId: 'CBSE_IN' as 'IEMIS_NPL_CEHRD_FLASH_I' }),
    );

    expect(s3Send).not.toHaveBeenCalled();
    const updateCall = ddbSend.mock.calls.find(
      (c) => c[0]?.constructor?.name === 'UpdateItemCommand',
    )?.[0] as UpdateItemCommand | undefined;
    expect(updateCall).toBeDefined();
    expect(updateCall!.input.ExpressionAttributeValues!![':status']).toEqual({ S: 'failed' });
    expect(updateCall!.input.ExpressionAttributeValues!![':errorCode']).toEqual({
      S: 'TEMPLATE_NOT_SUPPORTED',
    });

    const ebCall = ebSend.mock.calls[0]?.[0] as PutEventsCommand;
    expect(ebCall.input.Entries![0].DetailType).toBe('reporting.snapshot_failed');
  });

  // -------------------------------------------------------------------------

  it('SCHOOL_NOT_FOUND surfaces in errorCode', async () => {
    // readSchool returns no Item → error in reader
    ddbSend.mockResolvedValueOnce({ Item: undefined });
    // updateSnapshotFailed (one more DDB call)
    ddbSend.mockResolvedValueOnce({});
    ebSend.mockResolvedValueOnce({});
    cwSend.mockResolvedValueOnce({});

    const { handler } = await import('./handler');
    await handler(event(baseDetail));

    const updateCall = ddbSend.mock.calls.find(
      (c) => c[0]?.constructor?.name === 'UpdateItemCommand',
    )?.[0] as UpdateItemCommand | undefined;
    expect(updateCall).toBeDefined();
    expect(updateCall!.input.ExpressionAttributeValues!![':errorCode']).toEqual({
      S: 'SCHOOL_NOT_FOUND',
    });
  });

  // -------------------------------------------------------------------------

  it('ACADEMIC_YEAR_NOT_FOUND surfaces in errorCode', async () => {
    // School OK
    ddbSend.mockResolvedValueOnce({
      Item: { tenantId: { S: 'TENANT#tenant-A' }, emisSchoolCode: { S: '12345' } },
    });
    // AY query returns empty
    ddbSend.mockResolvedValueOnce({ Items: [] });
    // updateSnapshotFailed
    ddbSend.mockResolvedValueOnce({});
    ebSend.mockResolvedValueOnce({});
    cwSend.mockResolvedValueOnce({});

    const { handler } = await import('./handler');
    await handler(event(baseDetail));

    const updateCall = ddbSend.mock.calls.find(
      (c) => c[0]?.constructor?.name === 'UpdateItemCommand',
    )?.[0] as UpdateItemCommand | undefined;
    expect(updateCall).toBeDefined();
    expect(updateCall!.input.ExpressionAttributeValues!![':errorCode']).toEqual({
      S: 'ACADEMIC_YEAR_NOT_FOUND',
    });
  });

  // -------------------------------------------------------------------------

  it('REPORT_AGGREGATOR_ENABLED=false → silent no-op (no DDB, no S3)', async () => {
    process.env.REPORT_AGGREGATOR_ENABLED = 'false';

    const { handler } = await import('./handler');
    await handler(event(baseDetail));

    expect(ddbSend).not.toHaveBeenCalled();
    expect(s3Send).not.toHaveBeenCalled();
    expect(ebSend).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------

  it('missing REPORTS_STAGING_BUCKET_NAME → logs error and returns without DDB writes', async () => {
    delete process.env.REPORTS_STAGING_BUCKET_NAME;

    const { handler } = await import('./handler');
    await handler(event(baseDetail));

    expect(ddbSend).not.toHaveBeenCalled();
    expect(s3Send).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------

  it('Flash II → writes CSV with empty exam columns + warns missing-pipeline count', async () => {
    // Same read sequence as Flash I, but the handler also calls
    // aggregateAttendance (which is a no-op zero-return — no DDB call).
    stubFlashIReads();
    s3Send.mockResolvedValueOnce({});
    ebSend.mockResolvedValueOnce({});
    cwSend.mockResolvedValueOnce({});

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { handler } = await import('./handler');
    await handler(
      event({
        ...baseDetail,
        templateId: 'IEMIS_NPL_CEHRD_FLASH_II',
      }),
    );

    expect(s3Send).toHaveBeenCalledTimes(1);
    const putInput = (s3Send.mock.calls[0][0] as PutObjectCommand).input;
    const body = String(putInput.Body);
    expect(body).toContain('total_attendance_days');
    expect(body).toContain('exam_total_marks');
    expect(body).toContain('academic_status');

    const warns = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warns.some((w) => w.includes('flash-ii: exam pipeline columns blank'))).toBe(true);
    warnSpy.mockRestore();
  });
});
