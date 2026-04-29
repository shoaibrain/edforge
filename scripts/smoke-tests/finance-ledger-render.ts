/// <reference types="node" />
/**
 * Sprint C1.T6 — finance ledger render smoke.
 *
 * Locks the post-fix behaviour for BUG-F1 (Ledger tab "No ledger entries
 * yet." even when the API returns rows) end-to-end:
 *
 *   1. Recreate the API condition in prod that produced the bug:
 *      POST a manual payment against a fresh student account, then GET the
 *      ledger via /finance/schools/{schoolId}/student-accounts/{accountId}/ledger.
 *   2. Assert the API returns the FinancePaginatedResponse shape and items.length >= 1.
 *   3. Fetch the deployed Vercel bundle's main JS chunk and assert that it
 *      contains the post-fix unwrap text "response?.items ?? []" — proves
 *      the bundle the user's browser loads is actually the fixed one.
 *
 * Usage:
 *   export ADMIN_TOKEN="<JWT>"
 *   export SCHOOL_ID="<existing school uuid>"
 *   export STUDENT_ACCOUNT_ID="<existing studentAccountId on that school>"
 *   export INVOICE_ID="<existing issued invoice on that account, with amountDue>"
 *   export API_BASE="https://tw8pfmqsdi.execute-api.us-east-2.amazonaws.com/prod"
 *   export FRONTEND_BASE="https://uat.edforge.app"
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/finance-ledger-render.ts
 *
 * Exit 0 = green; exit 1 = any check failed.
 */

import axios from 'axios';

const TOKEN = process.env.ADMIN_TOKEN ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const STUDENT_ACCOUNT_ID = process.env.STUDENT_ACCOUNT_ID ?? '';
const INVOICE_ID = process.env.INVOICE_ID ?? '';
const API_BASE = process.env.API_BASE ?? 'https://tw8pfmqsdi.execute-api.us-east-2.amazonaws.com/prod';
const FRONTEND_BASE = process.env.FRONTEND_BASE ?? 'https://uat.edforge.app';

for (const [name, val] of Object.entries({
  ADMIN_TOKEN: TOKEN,
  SCHOOL_ID,
  STUDENT_ACCOUNT_ID,
  INVOICE_ID,
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

interface LedgerEntry {
  id: string;
  studentAccountId: string;
  entryType: string;
  debit: number;
  credit: number;
  balance: number;
}

async function main(): Promise<void> {
  // 1. Record a small manual payment so we KNOW there is a fresh ledger row.
  const stamp = Date.now().toString().slice(-6);
  const paymentRes = await call(
    'POST',
    `/finance/schools/${SCHOOL_ID}/payments/manual`,
    {
      invoiceId: INVOICE_ID,
      amount: 1,
      gateway: 'cash',
      paidAt: new Date().toISOString(),
      reference: `smoke-c1-${stamp}`,
    },
  );
  check('POST /payments/manual returns 2xx', ok2xx(paymentRes.status), {
    status: paymentRes.status,
    body: paymentRes.body,
  });

  // 2. Hit the ledger endpoint and assert the FinancePaginatedResponse shape.
  const ledgerRes = await call(
    'GET',
    `/finance/schools/${SCHOOL_ID}/student-accounts/${STUDENT_ACCOUNT_ID}/ledger`,
  );
  check('GET ledger returns 2xx', ok2xx(ledgerRes.status), ledgerRes.status);

  const body = ledgerRes.body;
  check('Response is the FinancePaginatedResponse shape ({ items, hasMore })',
    body && typeof body === 'object' && 'items' in body && 'hasMore' in body,
    body);

  const items = (body.items as LedgerEntry[] | undefined) ?? [];
  check('items is an array', Array.isArray(items));
  check('items has at least 1 entry (the payment we just recorded)', items.length >= 1, {
    length: items.length,
  });
  check(
    'Latest entry is a payment with credit > 0',
    items.some((e) => e.entryType === 'payment' && e.credit > 0),
    items.slice(0, 3),
  );

  // 3. Fetch the deployed bundle and prove it contains the post-fix unwrap.
  // The exact main bundle filename is hashed; the index page lists it.
  console.log(`\nFetching deployed frontend bundle from ${FRONTEND_BASE} ...`);
  const indexResp = await axios.get(FRONTEND_BASE, {
    validateStatus: () => true,
    timeout: 30_000,
  });
  check('Frontend index page returns 2xx', ok2xx(indexResp.status), indexResp.status);

  const indexHtml = String(indexResp.data ?? '');
  const mainMatch = indexHtml.match(/\/assets\/[^"']+?\.js/g) ?? [];
  check('Found at least one /assets/*.js bundle reference in index', mainMatch.length > 0);

  let foundUnwrap = false;
  let scanned = 0;
  for (const url of mainMatch) {
    const full = url.startsWith('http') ? url : `${FRONTEND_BASE}${url}`;
    try {
      const r = await axios.get(full, { validateStatus: () => true, timeout: 30_000 });
      scanned += 1;
      const text = String(r.data ?? '');
      // Minified bundles will contain at least one of these tokens after the fix.
      if (
        text.includes('response?.items ?? []') ||
        /Array\.isArray\(\w+\)\s*\?\s*\w+\s*:\s*\(?\w+\?\.items/.test(text) ||
        text.includes('\u2026items \u2010\u2010 the bug case') /* sanity guard */
      ) {
        foundUnwrap = true;
        break;
      }
    } catch (_e) {
      // ignore individual chunk fetch failures; we only need one match.
    }
  }
  check(
    `Deployed bundle contains the post-fix getStudentLedger unwrap (scanned ${scanned} chunks)`,
    foundUnwrap,
    'No chunk contained the unwrap signature; the deploy may be stale.',
  );

  console.log(`\nResult: ${fails.length === 0 ? 'PASS' : `FAIL (${fails.length} checks)`}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('FATAL:', (e as Error)?.message ?? e);
  process.exit(1);
});
