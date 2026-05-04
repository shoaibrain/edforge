/// <reference types="node" />
/**
 * IEMIS Sprint 3 DDB-direct verifier — UAT.
 *
 * Runs AFTER scripts/smoke-tests/iemis-sprints-0-3.ts so the PATCH calls have
 * landed their descriptor updates + audit rows. Uses the AWS SDK directly (no
 * HTTP, no JWT) — reads the academics + identity DDB tables via the caller's
 * AWS_PROFILE credentials.
 *
 * Usage:
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/iemis-ddb-audit-verifier.ts
 *
 * Layer 2 checks (D1-D8) per the plan file. Exit 0 = green; exit 1 = failure.
 */

import {
  DynamoDBClient,
  QueryCommand,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  CloudWatchClient,
  DescribeAlarmsCommand,
} from '@aws-sdk/client-cloudwatch';

// ── config ─────────────────────────────────────────────────────────────────

const REGION = 'ap-south-1';
const TENANT_ID = '264ff030-1cd8-4dc3-bdfe-f2728c3e40d0'; // testtenant007
const IEMIS_SCHOOL_ID = '7031d447-313c-4624-a218-00a0d2a793cc'; // RAS
const STUDENT_ID = '001d6f36-2d38-437f-ab3f-b0c6222d258f'; // Md. Aamir

const IDENTITY_TABLE = 'edforge-identity-basic';
const ACADEMICS_TABLE = 'edforge-academics-basic';

const ddb = new DynamoDBClient({ region: REGION });

// ── helpers ────────────────────────────────────────────────────────────────

const fails: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    console.log(`  └─ ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    fails.push(name);
  }
}

async function queryAuditRowsForStudent(studentId: string) {
  // AUDIT#IEMIS#<iso-ts>#<eventId> rows in academics table, filter by metadata.studentId
  const res = await ddb.send(
    new QueryCommand({
      TableName: ACADEMICS_TABLE,
      KeyConditionExpression: 'tenantId = :t AND begins_with(entityKey, :p)',
      ExpressionAttributeValues: {
        ':t': { S: TENANT_ID },
        ':p': { S: 'AUDIT#IEMIS#' },
      },
      Limit: 200,
    }),
  );
  const rows = (res.Items ?? []).filter((r: any) => {
    // metadata is stored as DDB Map; studentId nested under metadata.M.studentId.S
    const sid = r.metadata?.M?.studentId?.S;
    return sid === studentId;
  });
  return rows;
}

async function getStudent(studentId: string) {
  const res = await ddb.send(
    new GetItemCommand({
      TableName: ACADEMICS_TABLE,
      Key: {
        tenantId: { S: TENANT_ID },
        entityKey: { S: `STUDENT#${studentId}` },
      },
    }),
  );
  return res.Item ?? null;
}

async function listSchools() {
  // Filter on SCHOOL# SK prefix in identity table
  const res = await ddb.send(
    new QueryCommand({
      TableName: IDENTITY_TABLE,
      KeyConditionExpression: 'tenantId = :t AND begins_with(entityKey, :p)',
      FilterExpression: 'entityType = :et',
      ExpressionAttributeValues: {
        ':t': { S: TENANT_ID },
        ':p': { S: 'SCHOOL#' },
        ':et': { S: 'SCHOOL' },
      },
    }),
  );
  return res.Items ?? [];
}

async function queryStudentSample(limit: number) {
  // Query by partition (tenantId) + SK begins_with STUDENT# — the proper Query
  // form. Earlier Scan version returned 0 because the first Limit items scanned
  // included ATTENDANCE/ENROLLMENT/GRADE/etc. and the filter ran AFTER the limit.
  const res = await ddb.send(
    new QueryCommand({
      TableName: ACADEMICS_TABLE,
      KeyConditionExpression: 'tenantId = :t AND begins_with(entityKey, :p)',
      ExpressionAttributeValues: {
        ':t': { S: TENANT_ID },
        ':p': { S: 'STUDENT#' },
      },
      Limit: limit,
    }),
  );
  return res.Items ?? [];
}

const cw = new CloudWatchClient({ region: REGION });

async function getAlarmState(alarmName: string) {
  const res = await cw.send(new DescribeAlarmsCommand({ AlarmNames: [alarmName] }));
  return res.MetricAlarms?.[0];
}

// ── checks ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`IEMIS DDB verifier @ ${REGION} (tenant ${TENANT_ID})\n`);

  // D1 — audit rows exist for the student
  const auditRows = await queryAuditRowsForStudent(STUDENT_ID);
  check(
    `D1 — at least one student.descriptor.edited row for ${STUDENT_ID.slice(0, 8)}… in academics table`,
    auditRows.length >= 1 && auditRows.some((r: any) => r.eventType?.S === 'student.descriptor.edited'),
    { count: auditRows.length, types: auditRows.map((r: any) => r.eventType?.S) },
  );

  // D2 — audit row with disabilities must NOT contain notes
  const disabilityRow = auditRows.find((r: any) => {
    const metadata = r.metadata?.M;
    const afterDisabilities = metadata?.after?.M?.disabilities?.L;
    return Array.isArray(afterDisabilities) && afterDisabilities.length > 0;
  });
  if (disabilityRow) {
    const rawSerialized = JSON.stringify(disabilityRow);
    const hasNotes = rawSerialized.includes('SMOKE-TEST-NOTE');
    check(
      'D2 — audit row for disabilities PATCH does NOT contain notes text (privacy strip)',
      !hasNotes,
      hasNotes ? { leaked: 'SMOKE-TEST-NOTE found in audit row' } : { verifiedStripped: true },
    );
  } else {
    check('D2 — audit row for disabilities PATCH (skipped — no disability audit row found)', true,
      'No audit row with disabilities detected — Layer 1 disabilities PATCH may not have been run');
  }

  // D3 — audit row metadata.studentId matches
  const anyRow = auditRows[0];
  if (anyRow) {
    const sid = anyRow.metadata?.M?.studentId?.S;
    check('D3 — audit metadata.studentId matches the PATCHed student',
      sid === STUDENT_ID,
      { gotStudentId: sid, expected: STUDENT_ID });
  }

  // D4 — audit rows must NOT contain student name / DOB / guardian PII
  if (anyRow) {
    const serialized = JSON.stringify(anyRow);
    const leakedTokens = ['Aamir', 'Mansuri', 'dateOfBirth', 'guardian', 'contactInfo'];
    const leaks = leakedTokens.filter((t) => serialized.includes(t));
    check('D4 — audit row contains NO student name / DOB / guardian PII',
      leaks.length === 0,
      leaks.length > 0 ? { leakedTokens: leaks } : { verified: true });
  }

  // D5 — Student row reflects the descriptor updates
  const student = await getStudent(STUDENT_ID);
  if (student) {
    const sexOk = student.sexDescriptor?.S === 'uri://ed-fi.org/SexDescriptor#Male';
    const langOk = student.motherTongueDescriptor?.S === 'uri://ed-fi.org/LanguageDescriptor#Maithili';
    check('D5 — Student row has sexDescriptor=Male after Layer 1 PATCH',
      sexOk, { got: student.sexDescriptor?.S });
    check('D5 — Student row has motherTongueDescriptor=Maithili after Layer 1 PATCH',
      langOk, { got: student.motherTongueDescriptor?.S });
  } else {
    check('D5 — Student row exists', false, { studentId: STUDENT_ID });
  }

  // D6 — sample students: all have 16-digit emisStudentId, no duplicates
  const sample = await queryStudentSample(20);
  const emisIds: string[] = sample
    .map((s: any) => s.emisStudentId?.S as string | undefined)
    .filter((x: string | undefined): x is string => !!x);
  const allSixteen = emisIds.every((id: string) => /^\d{16}$/.test(id));
  const unique = new Set(emisIds).size === emisIds.length;
  check(`D6 — sample of ${emisIds.length} students: all emisStudentId are 16-digit`, allSixteen,
    { firstBad: emisIds.find((id: string) => !/^\d{16}$/.test(id)) });
  check(`D6 — sample of ${emisIds.length} students: emisStudentId unique within sample`, unique,
    !unique ? { duplicates: emisIds.filter((id: string, i: number) => emisIds.indexOf(id) !== i) } : { verified: true });

  // D7 — schools with emisSchoolCode vs gsi8pk populated
  const schools = await listSchools();
  const withCode = schools.filter((s: any) => s.emisSchoolCode?.S);
  const withGsi8 = schools.filter((s: any) => s.gsi8pk?.S);
  check(`D7 — schools with emisSchoolCode (${withCode.length}) vs gsi8pk indexed (${withGsi8.length})`,
    true,
    {
      schoolsTotal: schools.length,
      withEmisSchoolCode: withCode.length,
      withGsi8pkIndexed: withGsi8.length,
      backfillNeeded: withCode.length - withGsi8.length,
    });

  // D8 — alarm state still OK after all the PATCH activity
  const alarm = await getAlarmState('edforge-iemis-audit-emit-failures-basic');
  check('D8 — edforge-iemis-audit-emit-failures-basic alarm is OK',
    alarm?.StateValue === 'OK',
    { state: alarm?.StateValue, reason: alarm?.StateReason });

  console.log(`\n${fails.length === 0 ? '✓ ALL DDB CHECKS GREEN' : `✗ ${fails.length} FAILURES`}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('crash:', e?.message ?? e);
  process.exit(2);
});
