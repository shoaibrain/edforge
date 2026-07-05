/**
 * Multi-target family payment integration test — EPIC-FB Sprint FB-4.7.
 *
 * Runs the REAL PaymentsService + InvoicesService + StudentAccountsService
 * (real transact-item builders, real DynamoDBClientService code paths)
 * against a REAL local DynamoDB (LocalStack :4566 or `amazon/dynamodb-local`
 * / the DynamoDBLocal jar with LOCALSTACK_ENDPOINT=http://localhost:8000).
 * Exercises the FB-4.4 guarantees mocks can only assert by construction:
 * genuine TransactWriteItems atomicity across 1 payment + N invoices + M
 * accounts, real ConditionExpression evaluation, and the FB-4.1 sparse-GSI2
 * row shape as actually persisted.
 *
 * Scenario (task FB-4.7): one cheque over 3 open invoices across 2 students:
 *   A (student 1, 1000 due) — paid in full
 *   C (student 2, 1500 due) — paid 700 (partial)
 *   B (student 1, 2000 due) — NOT targeted (untouched)
 * Asserts the payment row (null ids + familyId + no GSI2 keys), per-invoice
 * amountPaid/status, BOTH accounts' ledger entries + balances, the receipt
 * payload, and atomicity (a stale-version target cancels EVERYTHING).
 *
 * HTTP boundaries (identity client, EventBridge) are stubbed — not what
 * this test is about; the harness has no service peers.
 *
 * Run:
 *   cd server/application
 *   NODE_OPTIONS=--experimental-vm-modules LOCALSTACK_ENDPOINT=http://localhost:8000 \
 *     npx jest --config test/integration/jest.config.js finance-family-payment
 */

import 'reflect-metadata';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ConflictException } from '@nestjs/common';
import { PaymentsService } from '../../microservices/finance/src/payments/payments.service';
import { InvoicesService } from '../../microservices/finance/src/invoices/invoices.service';
import { StudentAccountsService } from '../../microservices/finance/src/student-accounts/student-accounts.service';
import { DynamoDBClientService } from '../../microservices/finance/src/common/services/dynamodb-client.service';
import { EntityKeyBuilder, GSIKeyBuilder } from '../../microservices/finance/src/common/entities/base.entity';
import type { InvoiceEntity } from '../../microservices/finance/src/common/entities/invoice.entity';
import type { PaymentEntity } from '../../microservices/finance/src/common/entities/payment.entity';

const ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
const TABLE = `edforge-finance-fb47-${Date.now()}`;

const TENANT = 'aaaaaaaa-1111-1111-1111-111111111111';
const SCHOOL = 'bbbbbbbb-2222-2222-2222-222222222222';
const STUDENT_1 = 'cccccccc-3333-3333-3333-333333333333';
const STUDENT_2 = 'dddddddd-4444-4444-4444-444444444444';
const FAMILY_ID = 'eeeeeeee-5555-5555-5555-555555555555';
const INVOICE_A = 'a0000000-0000-4000-8000-00000000000a';
const INVOICE_B = 'b0000000-0000-4000-8000-00000000000b';
const INVOICE_C = 'c0000000-0000-4000-8000-00000000000c';

const ctx = {
  tenantId: TENANT,
  userId: 'operator-1',
  email: 'ops@example.com',
  role: 'TenantAdmin',
  jwtToken: 'test-jwt',
  schoolId: SCHOOL,
} as any;

function seedInvoice(
  invoiceId: string,
  studentId: string,
  amountDue: number,
  dueDate: string,
  invoiceNumber: string,
): InvoiceEntity {
  const now = '2026-07-01T00:00:00.000Z';
  return {
    tenantId: TENANT,
    entityKey: EntityKeyBuilder.invoice(SCHOOL, invoiceId),
    entityType: 'INVOICE',
    invoiceId,
    invoiceNumber,
    studentAccountId: `acct-${studentId}`,
    studentId,
    studentName: studentId === STUDENT_1 ? 'Sunita Rai' : 'Bikash Rai',
    schoolId: SCHOOL,
    schoolName: 'Integration Test School',
    academicYear: '2025-2026',
    lineItems: [
      {
        id: 'li-1',
        feeStructureId: 'fs-1',
        description: 'Tuition',
        amount: amountDue,
        quantity: 1,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        total: amountDue,
      },
    ],
    subtotal: amountDue,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: amountDue,
    amountPaid: 0,
    amountDue,
    currency: 'NPR',
    dueDate,
    issuedDate: '2026-07-01',
    status: 'issued',
    gsi1pk: GSIKeyBuilder.schoolScope(TENANT, SCHOOL),
    gsi1sk: `INVOICE#issued#${dueDate}`,
    gsi2pk: GSIKeyBuilder.studentScope(TENANT, studentId),
    gsi2sk: `INVOICE#${now}`,
    gsi3pk: '',
    gsi3sk: '',
    createdAt: now,
    createdBy: 'seeder',
    updatedAt: now,
    updatedBy: 'seeder',
    version: 1,
  } as InvoiceEntity;
}

function seedAccount(studentId: string) {
  return {
    tenantId: TENANT,
    entityKey: EntityKeyBuilder.billingAccount(SCHOOL, studentId),
    entityType: 'BILLING_ACCOUNT',
    accountId: `acct-${studentId}`,
    schoolId: SCHOOL,
    studentId,
    studentName: studentId === STUDENT_1 ? 'Sunita Rai' : 'Bikash Rai',
    balance: 0,
    totalPaid: 0,
    lastPaymentDate: null,
    gsi1pk: GSIKeyBuilder.schoolScope(TENANT, SCHOOL),
    gsi1sk: `ACCOUNT#${studentId}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    createdBy: 'seeder',
    updatedAt: '2026-07-01T00:00:00.000Z',
    updatedBy: 'seeder',
    version: 1,
  };
}

describe('FB-4.7 — multi-target family payment against local DynamoDB', () => {
  let rawClient: DynamoDBClient;
  let docClient: DynamoDBDocumentClient;
  let invoicesService: InvoicesService;
  let paymentsService: PaymentsService;

  let recordedPaymentId: string;

  async function getRow(entityKey: string): Promise<Record<string, any> | undefined> {
    const res = await docClient.send(
      new GetCommand({ TableName: TABLE, Key: { tenantId: TENANT, entityKey } }),
    );
    return res.Item;
  }

  async function rowsByPrefix(prefix: string): Promise<Record<string, any>[]> {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'tenantId = :t AND begins_with(entityKey, :p)',
        ExpressionAttributeValues: { ':t': TENANT, ':p': prefix },
      }),
    );
    return res.Items ?? [];
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
          '  java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -inMemory -port 8000\n' +
          '  (then LOCALSTACK_ENDPOINT=http://localhost:8000)\n' +
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

    // Seed 3 open invoices + 2 billing accounts.
    for (const item of [
      seedInvoice(INVOICE_A, STUDENT_1, 1000, '2026-07-01', 'INV-2083-0001'),
      seedInvoice(INVOICE_B, STUDENT_1, 2000, '2026-08-01', 'INV-2083-0002'),
      seedInvoice(INVOICE_C, STUDENT_2, 1500, '2026-07-15', 'INV-2083-0003'),
      seedAccount(STUDENT_1),
      seedAccount(STUDENT_2),
    ]) {
      await docClient.send(new PutCommand({ TableName: TABLE, Item: item }));
    }

    // Real DynamoDBClientService — only the TVM credential hop is stubbed.
    process.env.TABLE_NAME = TABLE;
    const ddbService = new DynamoDBClientService();
    jest.spyOn(ddbService, 'getClient').mockResolvedValue(docClient);

    const identityStub = {
      getStudentInfo: jest.fn().mockResolvedValue(null),
      getUserDisplayName: jest.fn().mockResolvedValue('Operator One'),
      getSchoolName: jest.fn().mockResolvedValue(null),
    } as any;
    const eventsStub = {
      publishPaymentCompleted: jest.fn().mockResolvedValue(undefined),
      publishRefundProcessed: jest.fn().mockResolvedValue(undefined),
    } as any;
    const financeAuditStub = { emit: jest.fn().mockResolvedValue(undefined) } as any;

    // Real transact-item builders all the way down.
    const studentAccountsService = new StudentAccountsService(ddbService, identityStub, financeAuditStub);
    invoicesService = new InvoicesService(
      ddbService,
      eventsStub,
      identityStub,
      { getSettings: jest.fn().mockResolvedValue(null) } as any, // tenantSettings
      { nextInvoiceNumber: jest.fn() } as any, // sequenceService (unused here)
      { getByIds: jest.fn().mockResolvedValue([]) } as any, // feeStructures
      studentAccountsService,
      { optimize: jest.fn(async (u: any) => u) } as any, // pdfLogoOptimizer
    );
    paymentsService = new PaymentsService(
      ddbService,
      eventsStub,
      { nextReceiptNumber: jest.fn().mockResolvedValue('RCP-IT-0001') } as any,
      invoicesService,
      studentAccountsService,
      {} as any, // gatewayRegistry
      {} as any, // gatewayConfigService
      identityStub,
      { optimize: jest.fn(async (u: any) => u) } as any,
    );
  });

  afterAll(async () => {
    try {
      await rawClient?.send(new DeleteTableCommand({ TableName: TABLE }));
    } catch {
      // best-effort cleanup
    }
    rawClient?.destroy();
  });

  it('1. records one payment over 3 invoices / 2 students — payment row has null ids, familyId, NO GSI2 keys', async () => {
    const dto: any = {
      applications: [
        { invoiceId: INVOICE_A, amount: 1000 }, // full
        { invoiceId: INVOICE_C, amount: 700 },  // partial
      ],
      familyId: FAMILY_ID,
      gateway: 'cheque',
      amount: 1700,
      referenceNumber: 'CHQ-2083-42',
    };
    const result = await paymentsService.recordManualPayment(SCHOOL, dto, ctx);
    recordedPaymentId = result.id;

    expect(result.invoiceId).toBeNull();
    expect(result.studentAccountId).toBeNull();
    expect(result.familyId).toBe(FAMILY_ID);
    expect(result.status).toBe('completed');

    const row = (await getRow(EntityKeyBuilder.payment(SCHOOL, result.id))) as PaymentEntity;
    expect(row).toBeDefined();
    expect(row.invoiceId).toBeNull();
    expect(row.studentAccountId).toBeNull();
    expect(row.studentId).toBeNull();
    expect(row.familyId).toBe(FAMILY_ID);
    // FB-4.1 — single-student-or-absent GSI2: no student-scope keys persisted.
    expect(row.gsi2pk).toBeUndefined();
    expect(row.gsi2sk).toBeUndefined();
    expect(row.gsi14pk).toBeUndefined();
    // Canonical application order: A (due 07-01) before C (due 07-15).
    expect(row.applications).toEqual([
      { targetType: 'invoice', invoiceId: INVOICE_A, amount: 1000 },
      { targetType: 'invoice', invoiceId: INVOICE_C, amount: 700 },
    ]);
    expect(row.applicationInvoiceIds).toEqual([INVOICE_A, INVOICE_C]);
    expect(row.receiptNumber).toBe('RCP-IT-0001');
  });

  it('2. per-invoice state: A paid in full, C partially_paid, B untouched', async () => {
    const a = await getRow(EntityKeyBuilder.invoice(SCHOOL, INVOICE_A));
    expect(a?.amountPaid).toBe(1000);
    expect(a?.amountDue).toBe(0);
    expect(a?.status).toBe('paid');
    expect(a?.version).toBe(2);
    expect(a?.statusHistory).toHaveLength(1);
    expect(a?.statusHistory[0]).toMatchObject({ from: 'issued', to: 'paid', changedBy: 'operator-1' });

    const c = await getRow(EntityKeyBuilder.invoice(SCHOOL, INVOICE_C));
    expect(c?.amountPaid).toBe(700);
    expect(c?.amountDue).toBe(800);
    expect(c?.status).toBe('partially_paid');
    expect(c?.version).toBe(2);

    const b = await getRow(EntityKeyBuilder.invoice(SCHOOL, INVOICE_B));
    expect(b?.amountPaid).toBe(0);
    expect(b?.amountDue).toBe(2000);
    expect(b?.status).toBe('issued');
    expect(b?.version).toBe(1);
  });

  it('3. BOTH accounts got a ledger entry + balance/totalPaid update', async () => {
    const s1Ledger = await rowsByPrefix(`LEDGER#acct-${STUDENT_1}#`);
    expect(s1Ledger).toHaveLength(1);
    expect(s1Ledger[0]).toMatchObject({
      entryType: 'payment',
      referenceId: recordedPaymentId,
      credit: 1000,
      debit: 0,
      balance: -1000,
    });
    expect(s1Ledger[0].description).toContain('INV-2083-0001');

    const s2Ledger = await rowsByPrefix(`LEDGER#acct-${STUDENT_2}#`);
    expect(s2Ledger).toHaveLength(1);
    expect(s2Ledger[0]).toMatchObject({
      entryType: 'payment',
      referenceId: recordedPaymentId,
      credit: 700,
      balance: -700,
    });

    const acct1 = await getRow(EntityKeyBuilder.billingAccount(SCHOOL, STUDENT_1));
    expect(acct1?.balance).toBe(-1000);
    expect(acct1?.totalPaid).toBe(1000);
    expect(acct1?.version).toBe(2);

    const acct2 = await getRow(EntityKeyBuilder.billingAccount(SCHOOL, STUDENT_2));
    expect(acct2?.balance).toBe(-700);
    expect(acct2?.totalPaid).toBe(700);
    expect(acct2?.version).toBe(2);
  });

  it('4. receipt payload renders the per-invoice breakdown from the persisted row', async () => {
    const receipt = await paymentsService.getReceipt(SCHOOL, recordedPaymentId, ctx);
    expect(receipt.invoiceNumber).toBe('2 invoices');
    expect(receipt.studentName).toBe('Sunita Rai, Bikash Rai');
    expect(receipt.lineItems).toEqual([
      { description: 'Invoice INV-2083-0001 — Sunita Rai', amount: 1000, taxAmount: 0, total: 1000 },
      { description: 'Invoice INV-2083-0003 — Bikash Rai', amount: 700, taxAmount: 0, total: 700 },
    ]);
    expect(receipt.grandTotal).toBe(1700);
    // resolveRecordedBy passes non-UUID-shaped recorder values through
    // unchanged — ctx.userId 'operator-1' is not a UUID.
    expect(receipt.paidBy).toBe('operator-1');
  });

  it('5. ATOMICITY: one stale target cancels the WHOLE transaction — nothing applied anywhere', async () => {
    // Force a REAL ConditionalCheckFailed inside TransactWriteItems: hand
    // the service a stale version for invoice C only (as if another
    // operator's write landed between read and transact).
    const realGetEntity = invoicesService.getEntity.bind(invoicesService);
    const spy = jest.spyOn(invoicesService, 'getEntity').mockImplementation(
      async (schoolId: string, invoiceId: string, context: any) => {
        const entity = await realGetEntity(schoolId, invoiceId, context);
        return invoiceId === INVOICE_C ? { ...entity, version: entity.version + 7 } : entity;
      },
    );

    const before = {
      b: await getRow(EntityKeyBuilder.invoice(SCHOOL, INVOICE_B)),
      c: await getRow(EntityKeyBuilder.invoice(SCHOOL, INVOICE_C)),
      acct1: await getRow(EntityKeyBuilder.billingAccount(SCHOOL, STUDENT_1)),
      acct2: await getRow(EntityKeyBuilder.billingAccount(SCHOOL, STUDENT_2)),
    };

    try {
      await paymentsService.recordManualPayment(
        SCHOOL,
        {
          applications: [
            { invoiceId: INVOICE_B, amount: 2000 },
            { invoiceId: INVOICE_C, amount: 800 },
          ],
          familyId: FAMILY_ID,
          gateway: 'cash',
          amount: 2800,
        } as any,
        ctx,
      );
      fail('expected ConflictException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe('CONCURRENT_UPDATE');
    } finally {
      spy.mockRestore();
    }

    // NOTHING changed: no second payment row, no new ledger rows, both
    // invoices + both accounts byte-identical to the pre-attempt state.
    const payments = await rowsByPrefix(`PAYMENT#${SCHOOL}#`);
    expect(payments).toHaveLength(1);
    expect(payments[0].paymentId).toBe(recordedPaymentId);

    expect(await getRow(EntityKeyBuilder.invoice(SCHOOL, INVOICE_B))).toEqual(before.b);
    expect(await getRow(EntityKeyBuilder.invoice(SCHOOL, INVOICE_C))).toEqual(before.c);
    expect(await getRow(EntityKeyBuilder.billingAccount(SCHOOL, STUDENT_1))).toEqual(before.acct1);
    expect(await getRow(EntityKeyBuilder.billingAccount(SCHOOL, STUDENT_2))).toEqual(before.acct2);
    expect(await rowsByPrefix(`LEDGER#acct-${STUDENT_1}#`)).toHaveLength(1);
    expect(await rowsByPrefix(`LEDGER#acct-${STUDENT_2}#`)).toHaveLength(1);
  });

  it('6. retry with FRESH state succeeds and settles B fully + C to zero', async () => {
    const result = await paymentsService.recordManualPayment(
      SCHOOL,
      {
        applications: [
          { invoiceId: INVOICE_B, amount: 2000 },
          { invoiceId: INVOICE_C, amount: 800 },
        ],
        familyId: FAMILY_ID,
        gateway: 'cash',
        amount: 2800,
      } as any,
      ctx,
    );
    expect(result.status).toBe('completed');

    const b = await getRow(EntityKeyBuilder.invoice(SCHOOL, INVOICE_B));
    expect(b?.status).toBe('paid');
    expect(b?.amountDue).toBe(0);
    const c = await getRow(EntityKeyBuilder.invoice(SCHOOL, INVOICE_C));
    expect(c?.status).toBe('paid');
    expect(c?.amountDue).toBe(0);

    const acct1 = await getRow(EntityKeyBuilder.billingAccount(SCHOOL, STUDENT_1));
    expect(acct1?.balance).toBe(-3000);
    expect(acct1?.totalPaid).toBe(3000);
    const acct2 = await getRow(EntityKeyBuilder.billingAccount(SCHOOL, STUDENT_2));
    expect(acct2?.balance).toBe(-1500);
    expect(acct2?.totalPaid).toBe(1500);
  });
});
