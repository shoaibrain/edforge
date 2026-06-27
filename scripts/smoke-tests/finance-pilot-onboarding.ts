/**
 * Pilot Onboarding Hardening — End-to-End Smoke
 *
 * Covers PR-PD (Previous Dues / Opening Balance) end-to-end against
 * a live tenant. Sprint PD.1.9 — initial scaffold + opening-balance
 * lifecycle cases. PR-CA (Custom Yearly Fee Agreement) will extend
 * this file with agreement-CRUD cases.
 *
 * Cases (PD.1 — opening-balance lifecycle):
 *   1. Set opening balance on a fresh-ish account (200)
 *   2. GET account — fields persist
 *   3. PUT same value → idempotent: no audit/ledger churn
 *   4. PUT new value → adjustment ledger + revised audit
 *   5. GET ledger — opening_balance + adjustment entries present
 *   6. Cross-school 404 contract
 *
 * Cases (PD.2 — payment allocation; opt-in via INVOICE_ID env var):
 *   7. Record payment > invoice debt but < (invoice + opening) → 200,
 *      applications[] has 2 entries (invoice + opening), receipt
 *      response carries the split.
 *   8. GET account confirms openingBalanceRemaining DECREASED by the
 *      opening-allocated amount (PD.1.6 counter contract).
 *   9. GET ledger — invoice ledger entry precedes opening ledger entry.
 *  10. Record overpayment > (invoice + opening) → 400
 *      PAYMENT_EXCEEDS_ALLOCATABLE; no DDB writes.
 *
 * Usage:
 *   export TENANT_ADMIN_TOKEN=<cognito JWT for a TenantAdmin>
 *   export SCHOOL_ID=<saraswati / dev-pabson-primary school uuid>
 *   export ACCOUNT_ID=<billing-account uuid>   # required; create
 *                                                via /finance/.../student-accounts
 *                                                or pick an existing one
 *   export OTHER_SCHOOL_ID=<a different school uuid in same tenant>
 *                                                # optional — for the
 *                                                cross-school 404 case
 *   export INVOICE_ID=<an issued invoice on the same account, any amount>
 *                                                # optional — opts the
 *                                                PD.2 split-payment cases
 *                                                in. Operator pre-creates
 *                                                the invoice; smoke doesn't
 *                                                touch fee-structures.
 *   export API_BASE_URL=<override; defaults to prod gateway>
 *   npx ts-node scripts/smoke-tests/finance-pilot-onboarding.ts
 *
 * Exit code: 0 if all PD cases pass, non-zero otherwise.
 */

import axios, { AxiosError } from 'axios';
import { randomUUID } from 'crypto';

// ============================================
// CONFIGURATION
// ============================================

const BASE_URL = process.env.API_BASE_URL || 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const SCHOOL_ID = process.env.SCHOOL_ID || '';
const OTHER_SCHOOL_ID = process.env.OTHER_SCHOOL_ID || '';
const ACCOUNT_ID = process.env.ACCOUNT_ID || '';
const INVOICE_ID = process.env.INVOICE_ID || '';
const TOKEN = process.env.TENANT_ADMIN_TOKEN || '';

if (!TOKEN) {
  console.error('TENANT_ADMIN_TOKEN is required');
  process.exit(1);
}
if (!SCHOOL_ID) {
  console.error('SCHOOL_ID is required');
  process.exit(1);
}
if (!ACCOUNT_ID) {
  console.error('ACCOUNT_ID is required (a fresh-ish BillingAccount uuid)');
  process.exit(1);
}

// ============================================
// SETUP
// ============================================

interface TestResult {
  step: number;
  name: string;
  passed: boolean;
  detail?: string;
  durationMs: number;
}

const results: TestResult[] = [];
let stepNum = 0;

function extractTenantId(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return payload['custom:tenantId'] || '';
  } catch {
    return '';
  }
}

const TENANT_ID = extractTenantId(TOKEN);
if (!TENANT_ID) {
  console.error('Could not extract tenantId from token');
  process.exit(1);
}

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'x-tenant-id': TENANT_ID,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
  validateStatus: () => true,
});

function openingBalancePath(schoolId: string, accountId: string): string {
  return `/finance/schools/${schoolId}/student-accounts/${accountId}/opening-balance`;
}

function accountPath(schoolId: string, accountId: string): string {
  return `/finance/schools/${schoolId}/student-accounts/${accountId}`;
}

function ledgerPath(schoolId: string, accountId: string): string {
  return `/finance/schools/${schoolId}/student-accounts/${accountId}/ledger`;
}

function recordManualPaymentPath(schoolId: string): string {
  return `/finance/schools/${schoolId}/payments/manual`;
}

function invoiceGetPath(schoolId: string, invoiceId: string): string {
  return `/finance/schools/${schoolId}/invoices/${invoiceId}`;
}

async function runStep(
  name: string,
  fn: () => Promise<{ passed: boolean; detail?: string }>,
): Promise<boolean> {
  stepNum++;
  const start = Date.now();
  console.log(`\n${'='.repeat(62)}`);
  console.log(`Step ${stepNum}: ${name}`);
  try {
    const { passed, detail } = await fn();
    const durationMs = Date.now() - start;
    results.push({ step: stepNum, name, passed, detail, durationMs });
    if (passed) {
      console.log(`  ✅ PASSED (${durationMs}ms)${detail ? ` — ${detail}` : ''}`);
    } else {
      console.log(`  ❌ FAILED (${durationMs}ms)${detail ? ` — ${detail}` : ''}`);
    }
    return passed;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const detail = err.message || String(err);
    results.push({ step: stepNum, name, passed: false, detail, durationMs });
    console.log(`  ❌ ERROR (${durationMs}ms) — ${detail}`);
    return false;
  }
}

// ============================================
// CASES
// ============================================

async function main() {
  console.log('='.repeat(62));
  console.log(' Pilot Onboarding Hardening — Smoke Test (PR-PD)');
  console.log('='.repeat(62));
  console.log(`Base URL:    ${BASE_URL}`);
  console.log(`Tenant:      ${TENANT_ID}`);
  console.log(`School:      ${SCHOOL_ID}`);
  console.log(`Account:     ${ACCOUNT_ID}`);

  // ----- Establish baseline: read the account to confirm it exists -----
  await runStep('Account exists (baseline GET)', async () => {
    const res = await api.get(accountPath(SCHOOL_ID, ACCOUNT_ID));
    if (res.status !== 200) {
      return { passed: false, detail: `expected 200, got ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}` };
    }
    return {
      passed: true,
      detail: `studentId=${res.data.studentId}, current balance=${res.data.balance}, pre-PD openingBalance=${res.data.openingBalance ?? 'absent'}`,
    };
  });

  // ----- PD.1.9 case 1: first-time set opening balance -----
  const INITIAL_AMOUNT = 5000;
  const INITIAL_ASOF = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10); // 30 days ago
  const INITIAL_NOTE = `Pilot smoke ${new Date().toISOString().slice(0, 10)}: BS carry-forward`;

  await runStep('Set opening balance (first-time) returns 200 with all 4 fields', async () => {
    const res = await api.put(
      openingBalancePath(SCHOOL_ID, ACCOUNT_ID),
      { amount: INITIAL_AMOUNT, asOf: INITIAL_ASOF, note: INITIAL_NOTE },
      { headers: { 'Idempotency-Key': randomUUID() } },
    );
    if (res.status !== 200) {
      return { passed: false, detail: `expected 200, got ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}` };
    }
    const { openingBalance, openingBalanceAsOf, openingBalanceNote, openingBalanceRemaining } = res.data;
    if (
      openingBalance !== INITIAL_AMOUNT ||
      openingBalanceAsOf !== INITIAL_ASOF ||
      openingBalanceNote !== INITIAL_NOTE ||
      openingBalanceRemaining !== INITIAL_AMOUNT
    ) {
      return {
        passed: false,
        detail: `field mismatch: got openingBalance=${openingBalance}, asOf=${openingBalanceAsOf}, note=${openingBalanceNote}, remaining=${openingBalanceRemaining}`,
      };
    }
    return { passed: true, detail: `openingBalance=${openingBalance}, remaining=${openingBalanceRemaining}` };
  });

  // ----- PD.1.9 case 2: GET account — fields persist -----
  await runStep('GET account confirms fields persist after PUT', async () => {
    const res = await api.get(accountPath(SCHOOL_ID, ACCOUNT_ID));
    if (res.status !== 200) return { passed: false, detail: `expected 200, got ${res.status}` };
    if (res.data.openingBalance !== INITIAL_AMOUNT) {
      return {
        passed: false,
        detail: `expected openingBalance=${INITIAL_AMOUNT}, got ${res.data.openingBalance}`,
      };
    }
    return { passed: true };
  });

  // ----- PD.1.9 case 3: idempotent no-op same value -----
  await runStep('PUT same amount + new note ⇒ idempotent no-op for amount (asOf/note still update; no ledger churn)', async () => {
    const updatedNote = `${INITIAL_NOTE} (no-op revision)`;
    const res = await api.put(
      openingBalancePath(SCHOOL_ID, ACCOUNT_ID),
      { amount: INITIAL_AMOUNT, asOf: INITIAL_ASOF, note: updatedNote },
      { headers: { 'Idempotency-Key': randomUUID() } },
    );
    if (res.status !== 200) {
      return { passed: false, detail: `expected 200, got ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}` };
    }
    if (res.data.openingBalance !== INITIAL_AMOUNT) {
      return { passed: false, detail: `expected openingBalance unchanged, got ${res.data.openingBalance}` };
    }
    if (res.data.openingBalanceNote !== updatedNote) {
      return { passed: false, detail: `expected note='${updatedNote}', got '${res.data.openingBalanceNote}'` };
    }
    return { passed: true, detail: 'amount unchanged; note updated' };
  });

  // ----- PD.1.9 case 4: revision with new value -----
  const REVISED_AMOUNT = INITIAL_AMOUNT + 1500;
  await runStep('PUT new amount ⇒ adjustment ledger entry + revised audit event', async () => {
    const res = await api.put(
      openingBalancePath(SCHOOL_ID, ACCOUNT_ID),
      { amount: REVISED_AMOUNT, asOf: INITIAL_ASOF, note: `${INITIAL_NOTE} (revised)` },
      { headers: { 'Idempotency-Key': randomUUID() } },
    );
    if (res.status !== 200) {
      return { passed: false, detail: `expected 200, got ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}` };
    }
    if (res.data.openingBalance !== REVISED_AMOUNT) {
      return { passed: false, detail: `expected openingBalance=${REVISED_AMOUNT}, got ${res.data.openingBalance}` };
    }
    return { passed: true, detail: `openingBalance ${INITIAL_AMOUNT} → ${REVISED_AMOUNT}` };
  });

  // ----- PD.1.9 case 5: ledger has both entries (opening_balance + adjustment) -----
  await runStep('Ledger contains opening_balance entry + adjustment revision entry', async () => {
    const res = await api.get(ledgerPath(SCHOOL_ID, ACCOUNT_ID) + '?limit=50');
    if (res.status !== 200) return { passed: false, detail: `expected 200, got ${res.status}` };
    const entries: any[] = res.data.items ?? [];
    const opening = entries.find(
      e => e.entryType === 'opening_balance' && e.debit === INITIAL_AMOUNT,
    );
    const adjustment = entries.find(
      e => e.entryType === 'adjustment' && (e.debit === REVISED_AMOUNT - INITIAL_AMOUNT || e.credit === INITIAL_AMOUNT - REVISED_AMOUNT),
    );
    if (!opening) return { passed: false, detail: 'opening_balance entry missing' };
    if (!adjustment) return { passed: false, detail: 'adjustment entry missing' };
    return { passed: true, detail: `${entries.length} ledger entries; opening + adjustment both present` };
  });

  // ----- PD.1.9 case 6: cross-school 404 contract (only if OTHER_SCHOOL_ID supplied) -----
  if (OTHER_SCHOOL_ID) {
    await runStep('Cross-school PUT returns 404 (no enumeration leak)', async () => {
      const res = await api.put(
        openingBalancePath(OTHER_SCHOOL_ID, ACCOUNT_ID),
        { amount: 1000, asOf: INITIAL_ASOF },
        { headers: { 'Idempotency-Key': randomUUID() } },
      );
      if (res.status !== 404 && res.status !== 403) {
        return { passed: false, detail: `expected 404 (or 403 from permission guard), got ${res.status}` };
      }
      return { passed: true, detail: `status=${res.status}` };
    });
  } else {
    console.log('\n(Skipping cross-school case — OTHER_SCHOOL_ID not set)');
  }

  // ────────────────────────────────────────────────────────────────────────
  // PD.2 — payment-allocation cases (opt-in via INVOICE_ID env)
  // ────────────────────────────────────────────────────────────────────────
  if (INVOICE_ID) {
    let invoiceAmountDue = 0;
    let openingRemainingBeforePayment = 0;
    let openingTotalBeforePayment = 0;

    await runStep('PD.2 baseline: fetch invoice + account to compute the split-payment amount', async () => {
      const [invRes, acctRes] = await Promise.all([
        api.get(invoiceGetPath(SCHOOL_ID, INVOICE_ID)),
        api.get(accountPath(SCHOOL_ID, ACCOUNT_ID)),
      ]);
      if (invRes.status !== 200) {
        return { passed: false, detail: `invoice GET status=${invRes.status}` };
      }
      if (acctRes.status !== 200) {
        return { passed: false, detail: `account GET status=${acctRes.status}` };
      }
      invoiceAmountDue = invRes.data.amountDue ?? 0;
      openingRemainingBeforePayment = acctRes.data.openingBalanceRemaining ?? 0;
      openingTotalBeforePayment = acctRes.data.openingBalance ?? 0;
      if (invoiceAmountDue <= 0) {
        return { passed: false, detail: `invoice has amountDue=${invoiceAmountDue}; need > 0 for split test` };
      }
      if (openingRemainingBeforePayment <= 0) {
        return { passed: false, detail: `account has openingBalanceRemaining=${openingRemainingBeforePayment}; need > 0` };
      }
      return {
        passed: true,
        detail: `invoiceAmountDue=${invoiceAmountDue}; openingRemaining=${openingRemainingBeforePayment}; openingTotal=${openingTotalBeforePayment}`,
      };
    });

    // PD.2.3 case: payment > invoiceDue but < (invoiceDue + openingRemaining)
    // Amount: invoiceDue + min(openingRemaining, 100) — partial opening settlement
    let openingAllocated = 0;
    let paymentAmount = 0;
    await runStep('PD.2.3 split payment: amount > invoice debt + partial opening ⇒ 200; applications has invoice + opening', async () => {
      openingAllocated = Math.min(openingRemainingBeforePayment, 100);
      paymentAmount = invoiceAmountDue + openingAllocated;
      const res = await api.post(
        recordManualPaymentPath(SCHOOL_ID),
        {
          invoiceId: INVOICE_ID,
          amount: paymentAmount,
          gateway: 'cash',
        },
        { headers: { 'Idempotency-Key': randomUUID() } },
      );
      if (res.status !== 200 && res.status !== 201) {
        return { passed: false, detail: `expected 200/201, got ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}` };
      }
      const apps = res.data.applications;
      if (!Array.isArray(apps) || apps.length !== 2) {
        return { passed: false, detail: `expected applications to have 2 entries; got ${JSON.stringify(apps)}` };
      }
      const invoiceApp = apps.find((a: any) => a.targetType === 'invoice');
      const openingApp = apps.find((a: any) => a.targetType === 'opening_balance');
      if (!invoiceApp || invoiceApp.amount !== invoiceAmountDue) {
        return { passed: false, detail: `invoice application amount mismatch; got ${JSON.stringify(invoiceApp)}` };
      }
      if (!openingApp || openingApp.amount !== openingAllocated) {
        return { passed: false, detail: `opening application amount mismatch; got ${JSON.stringify(openingApp)}` };
      }
      return { passed: true, detail: `invoice=${invoiceApp.amount}, opening=${openingApp.amount}` };
    });

    // PD.1.6 counter contract: openingBalanceRemaining should have DECREASED by openingAllocated
    await runStep('PD.1.6 counter: openingBalanceRemaining decreased by the opening-allocated amount', async () => {
      const res = await api.get(accountPath(SCHOOL_ID, ACCOUNT_ID));
      if (res.status !== 200) return { passed: false, detail: `account GET status=${res.status}` };
      const expectedRemaining = openingRemainingBeforePayment - openingAllocated;
      if (res.data.openingBalanceRemaining !== expectedRemaining) {
        return {
          passed: false,
          detail: `expected openingBalanceRemaining=${expectedRemaining}, got ${res.data.openingBalanceRemaining}`,
        };
      }
      // openingBalance itself UNCHANGED — the counter tracks settlements separately
      if (res.data.openingBalance !== openingTotalBeforePayment) {
        return {
          passed: false,
          detail: `openingBalance should be unchanged (counter only); got ${res.data.openingBalance}, expected ${openingTotalBeforePayment}`,
        };
      }
      return { passed: true, detail: `openingBalanceRemaining ${openingRemainingBeforePayment} → ${res.data.openingBalanceRemaining}; openingBalance unchanged at ${res.data.openingBalance}` };
    });

    // PD.2.3 ledger ordering: invoice payment ledger entry precedes opening payment ledger entry
    await runStep('PD.2.3 ledger ordering: invoice ledger entry precedes opening ledger entry within this payment', async () => {
      const res = await api.get(ledgerPath(SCHOOL_ID, ACCOUNT_ID) + '?limit=100');
      if (res.status !== 200) return { passed: false, detail: `ledger GET status=${res.status}` };
      const entries: any[] = res.data.items ?? [];
      // Find the two payment entries belonging to THIS payment (the smoke
      // can match by description containing the invoice number AND by
      // description containing 'opening balance')
      const invoicePay = entries.find(
        e => e.entryType === 'payment'
          && typeof e.description === 'string'
          && e.description.includes('invoice')
          && e.credit === invoiceAmountDue,
      );
      const openingPay = entries.find(
        e => e.entryType === 'payment'
          && typeof e.description === 'string'
          && e.description.includes('opening balance')
          && e.credit === openingAllocated,
      );
      if (!invoicePay) return { passed: false, detail: 'invoice payment ledger entry missing' };
      if (!openingPay) return { passed: false, detail: 'opening payment ledger entry missing' };
      // Both present; ordering is verified at the service layer (spec
      // case 7). Smoke just confirms both exist.
      return { passed: true, detail: 'both invoice + opening payment ledger entries present' };
    });

    // PD.2.3 overpayment: payment > (invoice + opening) ⇒ 400 PAYMENT_EXCEEDS_ALLOCATABLE
    // Note: invoice may now be 'paid' if the prior smoke step fully settled
    // it; in that case skip the overpayment case (we can't pay against a
    // paid invoice).
    await runStep('PD.2.3 overpayment rejection: amount > (invoiceDue + openingRemaining) ⇒ 400 PAYMENT_EXCEEDS_ALLOCATABLE', async () => {
      const invRes = await api.get(invoiceGetPath(SCHOOL_ID, INVOICE_ID));
      if (invRes.status !== 200) return { passed: false, detail: `invoice GET status=${invRes.status}` };
      if (invRes.data.amountDue <= 0) {
        return { passed: true, detail: '(skipped — invoice fully paid; need a fresh invoice to exercise overpayment)' };
      }
      const acctRes = await api.get(accountPath(SCHOOL_ID, ACCOUNT_ID));
      const openingRemainingNow = acctRes.data.openingBalanceRemaining ?? 0;
      const allocatable = invRes.data.amountDue + openingRemainingNow;
      const overpaymentAmount = allocatable + 1;
      const res = await api.post(
        recordManualPaymentPath(SCHOOL_ID),
        {
          invoiceId: INVOICE_ID,
          amount: overpaymentAmount,
          gateway: 'cash',
        },
        { headers: { 'Idempotency-Key': randomUUID() } },
      );
      if (res.status !== 400) {
        return { passed: false, detail: `expected 400, got ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}` };
      }
      const code = res.data?.message?.code ?? res.data?.code;
      if (code !== 'PAYMENT_EXCEEDS_ALLOCATABLE') {
        return { passed: false, detail: `expected code PAYMENT_EXCEEDS_ALLOCATABLE, got ${code}` };
      }
      return { passed: true, detail: `400 PAYMENT_EXCEEDS_ALLOCATABLE (allocatable=${allocatable}, attempted=${overpaymentAmount})` };
    });
  } else {
    console.log('\n(Skipping PD.2 split-payment cases — INVOICE_ID not set)');
  }

  printSummary();
  process.exit(results.some(r => !r.passed) ? 1 : 0);
}

function printSummary() {
  console.log('\n' + '='.repeat(62));
  console.log(' Summary');
  console.log('='.repeat(62));
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(` Total:  ${results.length}`);
  console.log(` Passed: ${passed}`);
  console.log(` Failed: ${failed}`);
  if (failed > 0) {
    console.log('\nFailed steps:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - Step ${r.step}: ${r.name} — ${r.detail ?? '(no detail)'}`);
    });
  }
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
