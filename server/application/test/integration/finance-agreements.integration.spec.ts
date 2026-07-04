/**
 * Billing Agreement lifecycle integration test — EPIC-FB Sprint FB-2.7
 *
 * Runs the REAL AgreementsService against a REAL local DynamoDB
 * (LocalStack `docker-compose.local.yml` at :4566, or `amazon/dynamodb-local`
 * with LOCALSTACK_ENDPOINT=http://localhost:8000). Unlike the mocked-DDB
 * unit suite, this exercises genuine TransactWriteItems semantics:
 * multi-item atomicity, ConditionExpression evaluation on the activation
 * locks, and positional CancellationReasons — the load-bearing FB-3.5
 * behaviors that mocks can only assert by construction.
 *
 * Scenario (task FB-2.7):
 *   1. create A            → agreement + pointer rows land atomically;
 *                            NO lock rows exist for drafts
 *   2. create C (overlap)  → 409 advisory overlap against the real GSI2
 *   3. activate A          → per-student locks exist with the TTL backstop
 *   4. create B (disjoint window — the lock is per-STUDENT, not per-window)
 *   5. activate B          → REAL TransactionCanceledException from DDB →
 *                            409 AGREEMENT_OVERLAP naming the student
 *   6. cancel A            → locks freed + pointers re-keyed, atomically
 *   7. activate B          → now succeeds; locks re-point to B
 *
 * HTTP boundaries (identity/academics clients, EventBridge, fee-structure
 * hydration) are stubbed — they are not what this test is about, and the
 * integration harness provides no service peers.
 */

import 'reflect-metadata';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ConflictException } from '@nestjs/common';
import { AgreementsService } from '../../microservices/finance/src/agreements/agreements.service';
import { DynamoDBClientService } from '../../microservices/finance/src/common/services/dynamodb-client.service';
import { EntityKeyBuilder } from '../../microservices/finance/src/common/entities/base.entity';
import { agreementLockTtl } from '../../microservices/finance/src/common/entities/billing-agreement.entity';
import type { BillingAgreement, CreateBillingAgreementDto } from '@aibrains/shared-types';

const ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
const TABLE = `edforge-finance-fb27-${Date.now()}`;

const TENANT    = 'aaaaaaaa-1111-1111-1111-111111111111';
const SCHOOL    = 'bbbbbbbb-2222-2222-2222-222222222222';
const STUDENT_1 = 'cccccccc-3333-3333-3333-333333333333';
const STUDENT_2 = 'dddddddd-4444-4444-4444-444444444444';

const ctx = {
  tenantId: TENANT,
  userId: 'operator-1',
  email: 'ops@example.com',
  role: 'TenantAdmin',
  jwtToken: 'test-jwt',
} as any;

function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86400_000);
  return d.toISOString().slice(0, 10);
}

// Window A and window B are DISJOINT on purpose: the FB-3.5 lock is keyed
// per (schoolId, studentId) — at most one ACTIVE agreement per student at a
// time regardless of window — so B still hits lock contention while A is
// active, and creating B never trips the FB-2.5 window-overlap advisory.
const A_FROM = isoDaysFromNow(10);
const A_TO = isoDaysFromNow(60);
const B_FROM = isoDaysFromNow(70);
const B_TO = isoDaysFromNow(120);

function makeDto(
  from: string,
  to: string,
  studentIds: string[] = [STUDENT_1, STUDENT_2],
): CreateBillingAgreementDto {
  const per = 20000;
  return {
    title: 'FB-2.7 lifecycle agreement',
    payer: { name: 'Ram Adhikari' },
    studentIds,
    agreementType: 'fixed_total',
    terms: {
      agreementType: 'fixed_total',
      totalAmount: per * studentIds.length,
      allocation: studentIds.map((studentId) => ({ studentId, amount: per })),
    },
    coveredFeeTypes: ['tuition'],
    billingFrequency: 'annual',
    currency: 'NPR',
    effectiveFrom: from,
    effectiveTo: to,
  } as CreateBillingAgreementDto;
}

describe('FB-2.7 — agreement lifecycle against local DynamoDB', () => {
  let rawClient: DynamoDBClient;
  let docClient: DynamoDBDocumentClient;
  let service: AgreementsService;

  let agreementA: BillingAgreement;
  let agreementB: BillingAgreement;

  async function getRow(entityKey: string): Promise<Record<string, any> | undefined> {
    const res = await docClient.send(
      new GetCommand({ TableName: TABLE, Key: { tenantId: TENANT, entityKey } }),
    );
    return res.Item;
  }

  beforeAll(async () => {
    rawClient = new DynamoDBClient({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

    try {
      await rawClient.send(new ListTablesCommand({ Limit: 1 }));
    } catch (error) {
      throw new Error(
        `Local DynamoDB is not reachable at ${ENDPOINT}. Start it with\n` +
          '  docker compose -f server/docker-compose.local.yml up -d localstack\n' +
          'or\n' +
          '  docker run -d -p 8000:8000 amazon/dynamodb-local  (then LOCALSTACK_ENDPOINT=http://localhost:8000)\n' +
          `Underlying error: ${(error as Error).message}`,
      );
    }

    await rawClient.send(
      new CreateTableCommand({
        TableName: TABLE,
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [
          { AttributeName: 'tenantId', KeyType: 'HASH' },
          { AttributeName: 'entityKey', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'tenantId', AttributeType: 'S' },
          { AttributeName: 'entityKey', AttributeType: 'S' },
          { AttributeName: 'gsi1pk', AttributeType: 'S' },
          { AttributeName: 'gsi1sk', AttributeType: 'S' },
          { AttributeName: 'gsi2pk', AttributeType: 'S' },
          { AttributeName: 'gsi2sk', AttributeType: 'S' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'gsi1pk', KeyType: 'HASH' },
              { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'gsi2pk', KeyType: 'HASH' },
              { AttributeName: 'gsi2sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      }),
    );

    docClient = DynamoDBDocumentClient.from(rawClient, {
      marshallOptions: { removeUndefinedValues: true },
    });

    // Real DynamoDBClientService (real putItem/queryGSI/transactWrite code
    // paths) — only the TVM credential hop is stubbed to the local client.
    process.env.TABLE_NAME = TABLE;
    const ddbService = new DynamoDBClientService();
    jest.spyOn(ddbService, 'getClient').mockResolvedValue(docClient);

    const identityStub = {
      validateSchoolExists: jest.fn().mockResolvedValue(true),
      getWorkspaceSettings: jest.fn().mockResolvedValue({ regional: { defaultCurrency: 'NPR' } }),
      getStudentInfo: jest.fn().mockImplementation(async (studentId: string) => ({
        studentId,
        firstName: 'Test',
        lastName: 'Student',
        gradeLevel: '5',
      })),
      getStudentFamily: jest.fn().mockResolvedValue({ family: null }),
    } as any;

    const eventsStub = {
      publishAgreementCreated: jest.fn().mockResolvedValue(undefined),
      publishAgreementActivated: jest.fn().mockResolvedValue(undefined),
      publishAgreementCancelled: jest.fn().mockResolvedValue(undefined),
      publishAgreementVersioned: jest.fn().mockResolvedValue(undefined),
    } as any;

    const feeStructuresStub = { getByIds: jest.fn().mockResolvedValue([]) } as any;

    service = new AgreementsService(ddbService, eventsStub, identityStub, feeStructuresStub);
  });

  afterAll(async () => {
    try {
      await rawClient?.send(new DeleteTableCommand({ TableName: TABLE }));
    } catch {
      // best-effort cleanup
    }
    rawClient?.destroy();
  });

  it('1. create A — agreement + one pointer per student land atomically; NO lock rows for drafts', async () => {
    agreementA = await service.create(SCHOOL, makeDto(A_FROM, A_TO), ctx);
    expect(agreementA.status).toBe('draft');
    expect(agreementA.version).toBe(1);

    const agreementRow = await getRow(EntityKeyBuilder.agreement(SCHOOL, agreementA.id));
    expect(agreementRow?.status).toBe('draft');
    expect(agreementRow?.gsi1sk).toBe(`AGREEMENT#draft#${A_FROM}`);

    for (const studentId of [STUDENT_1, STUDENT_2]) {
      const pointer = await getRow(
        EntityKeyBuilder.agreementMember(SCHOOL, studentId, agreementA.id),
      );
      expect(pointer?.status).toBe('draft');
      expect(pointer?.gsi2pk).toBe(`TENANT#${TENANT}#STUDENT#${studentId}`);
      expect(pointer?.gsi2sk).toBe(`AGREEMENT#draft#${A_TO}`);

      const lock = await getRow(EntityKeyBuilder.agreementActiveLock(SCHOOL, studentId));
      expect(lock).toBeUndefined();
    }
  });

  it('2. creating an overlapping agreement 409s via the REAL GSI2 advisory check (FB-2.5)', async () => {
    // Same window as A → overlap for both students.
    try {
      await service.create(SCHOOL, makeDto(A_FROM, A_TO, [STUDENT_1]), ctx);
      fail('expected ConflictException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      const body = e.getResponse();
      expect(body.code).toBe('AGREEMENT_OVERLAP');
      expect(body.conflictingAgreementId).toBe(agreementA.id);
      expect(body.studentId).toBe(STUDENT_1);
    }
  });

  it('3. activate A — one transactWrite flips agreement + pointers and puts per-student locks with TTL', async () => {
    agreementA = await service.activate(SCHOOL, agreementA.id, { version: 1 } as any, ctx);
    expect(agreementA.status).toBe('active');
    expect(agreementA.version).toBe(2);

    const agreementRow = await getRow(EntityKeyBuilder.agreement(SCHOOL, agreementA.id));
    expect(agreementRow?.status).toBe('active');
    expect(agreementRow?.gsi1sk).toBe(`AGREEMENT#active#${A_FROM}`);
    expect(agreementRow?.statusHistory).toHaveLength(1);

    for (const studentId of [STUDENT_1, STUDENT_2]) {
      const pointer = await getRow(
        EntityKeyBuilder.agreementMember(SCHOOL, studentId, agreementA.id),
      );
      expect(pointer?.status).toBe('active');
      expect(pointer?.gsi2sk).toBe(`AGREEMENT#active#${A_TO}`);

      const lock = await getRow(EntityKeyBuilder.agreementActiveLock(SCHOOL, studentId));
      expect(lock?.agreementId).toBe(agreementA.id);
      expect(lock?.ttl).toBe(agreementLockTtl(A_TO));
    }
  });

  it('4. create B for the same students with a DISJOINT window — advisory check passes, draft lands', async () => {
    agreementB = await service.create(SCHOOL, makeDto(B_FROM, B_TO), ctx);
    expect(agreementB.status).toBe('draft');
  });

  it('5. activating B while A holds the locks fails with a REAL transact cancellation → 409 AGREEMENT_OVERLAP naming the students', async () => {
    try {
      await service.activate(SCHOOL, agreementB.id, { version: 1 } as any, ctx);
      fail('expected ConflictException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      const body = e.getResponse();
      expect(body.code).toBe('AGREEMENT_OVERLAP');
      expect([...body.studentIds].sort()).toEqual([STUDENT_1, STUDENT_2].sort());
      expect(body.conflictingAgreementId).toBe(agreementA.id);
    }

    // Atomicity: the failed activation left NOTHING behind — B's agreement
    // row is still draft and its pointers still read draft.
    const bRow = await getRow(EntityKeyBuilder.agreement(SCHOOL, agreementB.id));
    expect(bRow?.status).toBe('draft');
    const bPointer = await getRow(
      EntityKeyBuilder.agreementMember(SCHOOL, STUDENT_1, agreementB.id),
    );
    expect(bPointer?.status).toBe('draft');
    const lock = await getRow(EntityKeyBuilder.agreementActiveLock(SCHOOL, STUDENT_1));
    expect(lock?.agreementId).toBe(agreementA.id); // untouched
  });

  it('6. cancel A — locks freed + pointers re-keyed cancelled, atomically', async () => {
    const cancelled = await service.cancel(
      SCHOOL,
      agreementA.id,
      { version: agreementA.version, reason: 'family withdrew' } as any,
      ctx,
    );
    expect(cancelled.status).toBe('cancelled');

    for (const studentId of [STUDENT_1, STUDENT_2]) {
      const lock = await getRow(EntityKeyBuilder.agreementActiveLock(SCHOOL, studentId));
      expect(lock).toBeUndefined();

      const pointer = await getRow(
        EntityKeyBuilder.agreementMember(SCHOOL, studentId, agreementA.id),
      );
      expect(pointer?.status).toBe('cancelled');
      expect(pointer?.gsi2sk).toBe(`AGREEMENT#cancelled#${A_TO}`);
    }
  });

  it('7. activate B — now succeeds; locks re-point to B', async () => {
    agreementB = await service.activate(SCHOOL, agreementB.id, { version: 1 } as any, ctx);
    expect(agreementB.status).toBe('active');

    for (const studentId of [STUDENT_1, STUDENT_2]) {
      const lock = await getRow(EntityKeyBuilder.agreementActiveLock(SCHOOL, studentId));
      expect(lock?.agreementId).toBe(agreementB.id);
      expect(lock?.ttl).toBe(agreementLockTtl(B_TO));
    }
  });

  it('8. the FB-3.1 resolver key range finds B only inside its term (real GSI2 range query)', async () => {
    // Direct GSI2 range probe with the resolver's key condition shape —
    // proves the >= 'AGREEMENT#active#{onDate}' bound behaves on real DDB.
    async function pointersOnDate(onDate: string) {
      const res = await docClient.send(
        new QueryCommand({
          TableName: TABLE,
          IndexName: 'GSI2',
          KeyConditionExpression: 'gsi2pk = :pk AND gsi2sk >= :sk',
          ExpressionAttributeValues: {
            ':pk': `TENANT#${TENANT}#STUDENT#${STUDENT_1}`,
            ':sk': `AGREEMENT#active#${onDate}`,
          },
        }),
      );
      return (res.Items ?? []).filter((i: any) => i.status === 'active');
    }

    const inTerm = await pointersOnDate(B_FROM);
    expect(inTerm.map((i: any) => i.agreementId)).toEqual([agreementB.id]);

    const onLastDay = await pointersOnDate(B_TO);
    expect(onLastDay.map((i: any) => i.agreementId)).toEqual([agreementB.id]);

    const afterTerm = await pointersOnDate(isoDaysFromNow(121));
    expect(afterTerm).toEqual([]);
  });
});
