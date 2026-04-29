/// <reference types="node" />
/**
 * Sprint C1.T8 — Interim ledger integrity check
 *
 * Cross-checks Payment items in the finance DDB table against LedgerEntry items
 * to surface any payment that completed but never produced a ledger row. This
 * is the holdover for BUG-F3 (sequential, non-transactional payment + ledger
 * write) until Sprint 2's TransactWriteItems refactor + reconciliation Lambda
 * land. Run daily by hand during the pilot window; replaced by S2-T5.
 *
 * Usage:
 *   AWS_PROFILE=uat  npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/operations/finance-ledger-integrity-check.ts \
 *     --table edforge-finance-basic --region us-east-2 --since-hours 24
 *
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/operations/finance-ledger-integrity-check.ts \
 *     --table edforge-finance-basic --region ap-south-1 --since-hours 168
 *
 * Output: prints a CSV (paymentId,tenantId,schoolId,studentId,studentAccountId,
 * receiptNumber,amount,paidAt) of payments with no matching ledger entry to
 * stdout. Exit 0 if zero mismatches; exit 2 if any mismatches; exit 1 on
 * runtime error. Tee to docs/deploys/<env>-ledger-integrity-<ts>-<sha>.log.
 *
 * Read-only: this script makes NO writes to DDB.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

interface Args {
  table: string;
  region: string;
  sinceHours: number;
}

interface PaymentRow {
  tenantId: string;
  entityKey: string;
  paymentId?: string;
  studentAccountId?: string;
  studentId?: string;
  schoolId?: string;
  status?: string;
  amount?: number;
  receiptNumber?: string;
  paidAt?: string;
  createdAt?: string;
}

interface LedgerRow {
  tenantId: string;
  entityKey: string;
  entryId?: string;
  studentAccountId?: string;
  referenceId?: string;
  entryType?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback?: string): string => {
    const i = argv.indexOf(flag);
    if (i === -1) {
      if (fallback === undefined) {
        throw new Error(`Missing required arg: ${flag}`);
      }
      return fallback;
    }
    const v = argv[i + 1];
    if (!v) throw new Error(`Missing value for ${flag}`);
    return v;
  };
  return {
    table: get('--table'),
    region: get('--region'),
    sinceHours: parseInt(get('--since-hours', '24'), 10),
  };
}

async function scanRecentCompletedPayments(
  doc: DynamoDBDocumentClient,
  table: string,
  sinceIso: string,
): Promise<PaymentRow[]> {
  const items: PaymentRow[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await doc.send(
      new ScanCommand({
        TableName: table,
        FilterExpression:
          'entityType = :type AND #s = :completed AND createdAt >= :since',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':type': 'PAYMENT',
          ':completed': 'completed',
          ':since': sinceIso,
        },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    if (r.Items) items.push(...(r.Items as PaymentRow[]));
    exclusiveStartKey = r.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

async function ledgerEntriesForPayment(
  doc: DynamoDBDocumentClient,
  table: string,
  payment: PaymentRow,
): Promise<LedgerRow[]> {
  if (!payment.studentAccountId) return [];
  const r = await doc.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression:
        'tenantId = :t AND begins_with(entityKey, :sk)',
      FilterExpression:
        '#et = :payment AND referenceId = :rid',
      ExpressionAttributeNames: { '#et': 'entryType' },
      ExpressionAttributeValues: {
        ':t': payment.tenantId,
        ':sk': `LEDGER#${payment.studentAccountId}`,
        ':payment': 'payment',
        ':rid': payment.paymentId,
      },
    }),
  );
  return (r.Items ?? []) as LedgerRow[];
}

function csvRow(values: (string | number | undefined)[]): string {
  return values
    .map((v) => {
      const s = v === undefined || v === null ? '' : String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const since = new Date(Date.now() - args.sinceHours * 3600 * 1000).toISOString();

  const ddb = new DynamoDBClient({ region: args.region });
  const doc = DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true },
  });

  process.stderr.write(
    `[ledger-integrity] table=${args.table} region=${args.region} since=${since}\n`,
  );

  const payments = await scanRecentCompletedPayments(doc, args.table, since);
  process.stderr.write(`[ledger-integrity] scanned ${payments.length} completed payments\n`);

  // Print CSV header to stdout regardless of result.
  console.log(
    csvRow([
      'paymentId',
      'tenantId',
      'schoolId',
      'studentId',
      'studentAccountId',
      'receiptNumber',
      'amount',
      'paidAt',
      'createdAt',
    ]),
  );

  let mismatches = 0;
  for (const p of payments) {
    const ledgerEntries = await ledgerEntriesForPayment(doc, args.table, p);
    if (ledgerEntries.length === 0) {
      mismatches += 1;
      console.log(
        csvRow([
          p.paymentId,
          p.tenantId,
          p.schoolId,
          p.studentId,
          p.studentAccountId,
          p.receiptNumber,
          p.amount,
          p.paidAt,
          p.createdAt,
        ]),
      );
    }
  }

  process.stderr.write(`[ledger-integrity] mismatches=${mismatches}\n`);
  process.exit(mismatches === 0 ? 0 : 2);
}

main().catch((e: unknown) => {
  process.stderr.write(`[ledger-integrity] FATAL: ${(e as Error)?.message ?? e}\n`);
  process.exit(1);
});
