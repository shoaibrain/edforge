/// <reference types="node" />
/**
 * Sprint C2.A — currency from tenant settings + payment-currency mismatch rejection.
 *
 * Locks two new behaviours that ship with shared-types 0.38.0 + finance ECR:
 *
 *   T1: Newly-created invoices carry the currency derived from
 *       `WorkspaceSettings.regional.defaultCurrency` of the tenant —
 *       NOT a hardcoded 'NPR'. (Pre-fix every invoice was 'NPR' regardless
 *       of tenant; non-NPR tenants silently shipped wrong-currency invoices.)
 *
 *   T2: Recording a manual payment with `currency` that does NOT match the
 *       invoice's currency is rejected with HTTP 400 + error code
 *       `PAYMENT_CURRENCY_MISMATCH`. Omitting `currency` works (server
 *       inherits from invoice).
 *
 * Self-contained: provisions a fresh invoice, exercises the assertion paths,
 * and pays the invoice off (clean state). No leftover unpaid debt.
 *
 * Usage:
 *   export ADMIN_TOKEN="<JWT for the target tenant>"
 *   export SCHOOL_ID="<existing school uuid in that tenant>"
 *   export STUDENT_ID="<existing student in SCHOOL_ID>"
 *   export FEE_STRUCTURE_ID="<an active autoApply=false fee structure in SCHOOL_ID>"
 *   export ACADEMIC_YEAR="<e.g. 2026-2027>"
 *   export API_BASE="https://tw8pfmqsdi.execute-api.us-east-2.amazonaws.com/prod"  # UAT
 *   #  or   https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod          # prod
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/finance-currency-from-tenant-settings.ts
 */

import axios from 'axios';
import { randomUUID } from 'crypto';

const TOKEN = process.env.ADMIN_TOKEN ?? '';
/**
 * Optional. If set, the smoke skips invoice creation (step 2) and exercises
 * the T2 currency-mismatch / inheritance assertions against the existing
 * invoice. Useful for cleaning up an orphan invoice from a prior failed
 * run, or re-running the T2 paths idempotently without piling up invoices.
 */
const EXISTING_INVOICE_ID = process.env.EXISTING_INVOICE_ID ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const STUDENT_ID = process.env.STUDENT_ID ?? '';
const FEE_STRUCTURE_ID = process.env.FEE_STRUCTURE_ID ?? '';
const ACADEMIC_YEAR = process.env.ACADEMIC_YEAR ?? '';
const API_BASE = process.env.API_BASE ?? 'https://tw8pfmqsdi.execute-api.us-east-2.amazonaws.com/prod';

for (const [name, val] of Object.entries({
  ADMIN_TOKEN: TOKEN,
  SCHOOL_ID,
  STUDENT_ID,
  FEE_STRUCTURE_ID,
  ACADEMIC_YEAR,
})) {
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

const fails: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '\u2713' : '\u2717'} ${name}`);
  if (!ok) {
    console.log(`  \u2514\u2500 ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    fails.push(name);
  }
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const r = await axios({
    method,
    url: `${API_BASE}${path}`,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    data: body,
    validateStatus: () => true,
    timeout: 30_000,
  });
  return { status: r.status, body: r.data as Record<string, unknown> };
}

const ok2xx = (s: number) => s >= 200 && s < 300;

async function main(): Promise<void> {
  // 1. What does the tenant declare as its default currency?
  const settingsRes = await call('GET', '/tenants/my/settings');
  check('GET /tenants/my/settings returns 2xx', ok2xx(settingsRes.status), settingsRes.status);
  const regional = settingsRes.body?.regional as { defaultCurrency?: string } | undefined;
  const expectedCurrency = regional?.defaultCurrency;
  check('Tenant settings expose regional.defaultCurrency', typeof expectedCurrency === 'string' && expectedCurrency.length > 0, regional);
  if (!expectedCurrency) process.exit(1);
  console.log(`  Tenant defaultCurrency = ${expectedCurrency}`);

  // 2. Generate a fresh draft invoice OR re-use an existing one (re-run path).
  let invoiceId: string | undefined;
  let invoiceCurrency: string | undefined;
  let amountDue: number | undefined;
  if (EXISTING_INVOICE_ID) {
    const fetched = await call('GET', `/finance/schools/${SCHOOL_ID}/invoices/${EXISTING_INVOICE_ID}`);
    check('GET existing invoice returns 2xx', ok2xx(fetched.status), fetched.status);
    if (!ok2xx(fetched.status)) process.exit(1);
    invoiceId = fetched.body.id as string;
    invoiceCurrency = fetched.body.currency as string;
    amountDue = fetched.body.amountDue as number;
    console.log(`  Re-using EXISTING_INVOICE_ID=${invoiceId} amountDue=${amountDue} currency=${invoiceCurrency}`);
  } else {
    const dueDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const invoiceRes = await call('POST', `/finance/schools/${SCHOOL_ID}/invoices`, {
      studentId: STUDENT_ID,
      feeStructureIds: [FEE_STRUCTURE_ID],
      academicYear: ACADEMIC_YEAR,
      dueDate,
      notes: `S2.A currency smoke ${Date.now().toString().slice(-6)}`,
      autoIssue: true,
    });
    check('POST /finance/.../invoices returns 2xx', ok2xx(invoiceRes.status), {
      status: invoiceRes.status,
      body: invoiceRes.body,
    });
    if (!ok2xx(invoiceRes.status)) process.exit(1);
    invoiceId = invoiceRes.body.id as string;
    invoiceCurrency = invoiceRes.body.currency as string;
    amountDue = invoiceRes.body.amountDue as number;
  }
  check('Invoice carries an id', typeof invoiceId === 'string', invoiceId);
  check(
    `Invoice currency === tenant settings (${expectedCurrency})`,
    invoiceCurrency === expectedCurrency,
    { invoiceCurrency, expectedCurrency },
  );
  check('Invoice currency is NOT the buggy hardcoded NPR for non-NPR tenants',
    expectedCurrency !== 'NPR' ? invoiceCurrency !== 'NPR' : true,
    { expectedCurrency, invoiceCurrency });
  if (!invoiceId || !amountDue) process.exit(1);

  // 3. Try to pay with the WRONG currency — must be rejected with PAYMENT_CURRENCY_MISMATCH.
  const wrongCurrency = expectedCurrency === 'USD' ? 'NPR' : 'USD';
  const wrongCurrencyRes = await call('POST', `/finance/schools/${SCHOOL_ID}/payments/manual`, {
    invoiceId,
    amount: amountDue,
    gateway: 'cash',
    currency: wrongCurrency,
    notes: 'S2.A wrong-currency probe',
    idempotencyKey: randomUUID(),
  });
  check(
    `POST /payments/manual with currency=${wrongCurrency} is rejected (4xx)`,
    wrongCurrencyRes.status >= 400 && wrongCurrencyRes.status < 500,
    wrongCurrencyRes.status,
  );
  const errBody: any = wrongCurrencyRes.body;
  const errCode = errBody?.errors?.[0]?.code ?? errBody?.code ?? errBody?.errorCode;
  check(
    'Rejection carries the PAYMENT_CURRENCY_MISMATCH error code',
    errCode === 'PAYMENT_CURRENCY_MISMATCH' ||
      (typeof errBody?.message === 'string' && errBody.message.includes('does not match invoice currency')),
    errBody,
  );

  // 4. Pay with NO currency in the payload — server should inherit from invoice.
  const correctRes = await call('POST', `/finance/schools/${SCHOOL_ID}/payments/manual`, {
    invoiceId,
    amount: amountDue,
    gateway: 'cash',
    notes: 'S2.A inherited-currency probe',
    idempotencyKey: randomUUID(),
  });
  check(
    'POST /payments/manual without `currency` returns 2xx (server inherits)',
    ok2xx(correctRes.status),
    { status: correctRes.status, body: correctRes.body },
  );
  const paymentCurrency = (correctRes.body as any)?.currency;
  check(
    `Created payment carries the invoice currency (${invoiceCurrency})`,
    paymentCurrency === invoiceCurrency,
    { paymentCurrency, invoiceCurrency },
  );

  console.log(`\nResult: ${fails.length === 0 ? 'PASS' : `FAIL (${fails.length} checks)`}`);
  console.log(`invoiceId=${invoiceId}  paid via inherit-from-invoice currency=${invoiceCurrency}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('FATAL:', (e as Error)?.message ?? e);
  process.exit(1);
});
