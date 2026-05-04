/**
 * Finance Billing Smoke Test — End-to-End Invoice Lifecycle
 *
 * Tests the core finance billing flow:
 *   1. Create fee structure
 *   2. Generate invoice (with studentId field — bug fix validation)
 *   3. List invoices
 *   4. Get invoice detail
 *   5. Issue invoice
 *   6. Dashboard summary
 *   7. Cancel invoice
 *
 * Usage:
 *   1. Set TENANT_ADMIN_TOKEN (Cognito JWT for a TenantAdmin)
 *   2. Set SCHOOL_ID
 *   3. Set STUDENT_ID (a valid student with a billing account, or one will be created)
 *   4. Optionally set API_BASE_URL (defaults to prod gateway)
 *   5. Run: npx ts-node scripts/smoke-tests/finance-billing-flow.ts
 */

import axios, { AxiosError } from 'axios';

// ============================================
// CONFIGURATION
// ============================================

const BASE_URL = process.env.API_BASE_URL || 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const SCHOOL_ID = process.env.SCHOOL_ID || '';
const STUDENT_ID = process.env.STUDENT_ID || '';
const TOKEN = process.env.TENANT_ADMIN_TOKEN || '';

if (!TOKEN) {
  console.error('TENANT_ADMIN_TOKEN is required');
  process.exit(1);
}
if (!SCHOOL_ID) {
  console.error('SCHOOL_ID is required');
  process.exit(1);
}
if (!STUDENT_ID) {
  console.error('STUDENT_ID is required');
  process.exit(1);
}

// ============================================
// HELPERS
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
  validateStatus: () => true, // Don't throw on non-2xx
});

function financePath(path: string): string {
  return `/finance/schools/${SCHOOL_ID}${path}`;
}

async function runStep(
  name: string,
  fn: () => Promise<{ passed: boolean; detail?: string }>,
): Promise<boolean> {
  stepNum++;
  const start = Date.now();
  console.log(`\n[${'='.repeat(60)}]`);
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
// TEST STATE (populated across steps)
// ============================================

let feeStructureId: string | undefined;
let invoiceId: string | undefined;

// ============================================
// TEST STEPS
// ============================================

async function main() {
  console.log('='.repeat(62));
  console.log(' Finance Billing Flow — Smoke Test');
  console.log('='.repeat(62));
  console.log(`Base URL:   ${BASE_URL}`);
  console.log(`School ID:  ${SCHOOL_ID}`);
  console.log(`Student ID: ${STUDENT_ID}`);
  console.log(`Tenant ID:  ${TENANT_ID}`);

  // ──────────────────────────────────────────
  // Step 1: Create a fee structure
  // ──────────────────────────────────────────
  await runStep('Create fee structure', async () => {
    const res = await api.post(financePath('/fee-structures'), {
      name: `Smoke Test Fee ${Date.now()}`,
      category: 'tuition',
      amount: 500.00,
      currency: 'USD',
      frequency: 'one_time',
      gradeLevels: ['9'],
      autoApplyOnEnrollment: false,
      description: 'Smoke test fee structure',
    });

    if (res.status === 201 && res.data?.id) {
      feeStructureId = res.data.id;
      return { passed: true, detail: `feeStructureId=${feeStructureId}` };
    }
    return { passed: false, detail: `status=${res.status} body=${JSON.stringify(res.data)}` };
  });

  if (!feeStructureId) {
    console.log('\n⚠️  Cannot continue without fee structure. Aborting.');
    printSummary();
    return;
  }

  // ──────────────────────────────────────────
  // Step 2: Generate invoice with studentId (bug fix validation)
  // ──────────────────────────────────────────
  await runStep('Generate invoice with studentId field', async () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const res = await api.post(financePath('/invoices'), {
      studentId: STUDENT_ID,
      feeStructureIds: [feeStructureId],
      academicYear: '2025-2026',
      billingPeriod: 'Smoke Test',
      dueDate: dueDate.toISOString(),
      notes: 'Smoke test invoice',
    });

    if (res.status === 201 && res.data?.id) {
      invoiceId = res.data.id;
      return {
        passed: true,
        detail: `invoiceId=${invoiceId}, grandTotal=${res.data.grandTotal}, status=${res.data.status}`,
      };
    }
    return { passed: false, detail: `status=${res.status} body=${JSON.stringify(res.data)}` };
  });

  if (!invoiceId) {
    console.log('\n⚠️  Cannot continue without invoice. Aborting.');
    printSummary();
    return;
  }

  // ──────────────────────────────────────────
  // Step 3: List invoices — verify our invoice appears
  // ──────────────────────────────────────────
  await runStep('List invoices', async () => {
    const res = await api.get(financePath('/invoices'));

    if (res.status !== 200) {
      return { passed: false, detail: `status=${res.status}` };
    }

    const items = res.data?.items || res.data?.data || [];
    const found = items.find((inv: any) => inv.id === invoiceId);
    return {
      passed: !!found,
      detail: found
        ? `Found invoice in list (${items.length} total)`
        : `Invoice ${invoiceId} not in list of ${items.length}`,
    };
  });

  // ──────────────────────────────────────────
  // Step 4: Get invoice detail
  // ──────────────────────────────────────────
  await runStep('Get invoice detail', async () => {
    const res = await api.get(financePath(`/invoices/${invoiceId}`));

    if (res.status === 200 && res.data?.id === invoiceId) {
      const inv = res.data;
      return {
        passed: true,
        detail: `status=${inv.status}, grandTotal=${inv.grandTotal}, lineItems=${inv.lineItems?.length || 0}`,
      };
    }
    return { passed: false, detail: `status=${res.status} body=${JSON.stringify(res.data)}` };
  });

  // ──────────────────────────────────────────
  // Step 5: Issue invoice (draft → issued)
  // ──────────────────────────────────────────
  await runStep('Issue invoice', async () => {
    const res = await api.post(financePath(`/invoices/${invoiceId}/issue`));

    if ((res.status === 200 || res.status === 201) && res.data?.status === 'issued') {
      return { passed: true, detail: `Invoice status → issued` };
    }
    return { passed: false, detail: `status=${res.status} body=${JSON.stringify(res.data)}` };
  });

  // ──────────────────────────────────────────
  // Step 6: Dashboard summary
  // ──────────────────────────────────────────
  await runStep('Get dashboard summary', async () => {
    const res = await api.get(financePath('/dashboard/summary'));

    if (res.status === 200 && res.data) {
      const d = res.data;
      return {
        passed: true,
        detail: `totalInvoiced=${d.totalInvoiced}, totalCollected=${d.totalCollected}, totalOutstanding=${d.totalOutstanding}`,
      };
    }
    return { passed: false, detail: `status=${res.status} body=${JSON.stringify(res.data)}` };
  });

  // ──────────────────────────────────────────
  // Step 7: Cancel invoice (issued → cancelled via update)
  // ──────────────────────────────────────────
  await runStep('Cancel invoice', async () => {
    const res = await api.patch(financePath(`/invoices/${invoiceId}`), {
      status: 'cancelled',
      notes: 'Cancelled by smoke test',
    });

    if (res.status === 200 && res.data?.status === 'cancelled') {
      return { passed: true, detail: 'Invoice status → cancelled' };
    }
    return { passed: false, detail: `status=${res.status} body=${JSON.stringify(res.data)}` };
  });

  // ──────────────────────────────────────────
  // Cleanup: Delete the fee structure
  // ──────────────────────────────────────────
  await runStep('Cleanup — delete fee structure', async () => {
    const res = await api.delete(financePath(`/fee-structures/${feeStructureId}`));
    if (res.status === 200 || res.status === 204) {
      return { passed: true, detail: 'Fee structure deleted' };
    }
    return { passed: false, detail: `status=${res.status} body=${JSON.stringify(res.data)}` };
  });

  printSummary();
}

// ============================================
// SUMMARY
// ============================================

function printSummary() {
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log(`\n${'='.repeat(62)}`);
  console.log(' RESULTS');
  console.log('='.repeat(62));

  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`  ${icon} Step ${r.step}: ${r.name}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }

  console.log(`\n  Total: ${results.length} steps | ${passedCount} passed | ${failedCount} failed | ${totalMs}ms`);

  if (failedCount > 0) {
    console.log('\n  ❌ SMOKE TEST FAILED');
    process.exit(1);
  } else {
    console.log('\n  ✅ ALL STEPS PASSED');
  }
}

// ============================================
// RUN
// ============================================

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
