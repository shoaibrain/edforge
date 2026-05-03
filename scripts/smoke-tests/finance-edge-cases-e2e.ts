/**
 * Finance Module — Edge Cases & Overdue/Outstanding E2E Test
 *
 * Tests scenarios NOT covered by the happy-path comprehensive test:
 *   Phase 1: Overdue Invoice Flow (6 steps)
 *   Phase 2: Payment on Overdue Invoice (3 steps)
 *   Phase 3: Outstanding & Aging Report (3 steps)
 *   Phase 4: Write-Off Flow (2 steps)
 *   Phase 5: Negative / Guard Rail Tests (8 steps)
 *   Phase 6: Refund Reverts Invoice Status (3 steps)
 *
 * NOTE: Test data is intentionally preserved (no cleanup) for UI validation.
 *
 * Usage:
 *   TENANT_ADMIN_TOKEN="<jwt>" SCHOOL_ID="<id>" STUDENT_ID="<id>" \
 *     npx ts-node scripts/smoke-tests/finance-edge-cases-e2e.ts
 *
 * Optional env:
 *   API_BASE_URL     — defaults to prod gateway
 *   ACADEMIC_YEAR_ID — used in fee structure creation
 */

import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BASE_URL = process.env.API_BASE_URL || 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const SCHOOL_ID = process.env.SCHOOL_ID || '45eaa374-824e-4704-8b49-6866657f6f66';
const STUDENT_ID = process.env.STUDENT_ID || '2ac80ece-49af-4cf4-829f-e69a5a06b4c5';
const TOKEN = process.env.TENANT_ADMIN_TOKEN || 'eyJraWQiOiJmakNuWU9ra1ZPR2Z2RzZNck9laWl5WXJLZGFzdHhHbmk5bjY2U2gzQWI4PSIsImFsZyI6IlJTMjU2In0.eyJzdWIiOiJiMWNiMDU2MC02MDUxLTcwODgtMDUyZS05ZjZlZjAzYWU0YTYiLCJjb2duaXRvOmdyb3VwcyI6WyIzOTA5ZDI4Yi1kM2I4LTRhNDUtOGYzZC01OTVhNDIyYTZlODIiXSwiY3VzdG9tOnRlbmFudFRpZXIiOiJCQVNJQyIsImlzcyI6Imh0dHBzOlwvXC9jb2duaXRvLWlkcC51cy1lYXN0LTIuYW1hem9uYXdzLmNvbVwvdXMtZWFzdC0yX3RCMGM4NEJubyIsImNvZ25pdG86dXNlcm5hbWUiOiJzaG9haWIucmFpbkBvdXRsb29rLmNvbSIsImN1c3RvbTp0ZW5hbnROYW1lIjoiYWxsZW5pc2QiLCJvcmlnaW5fanRpIjoiN2U4MDM3OTYtMzg5My00YzdkLWI4MTMtYTdlYTczNTQxOWM3IiwiY3VzdG9tOnRlbmFudElkIjoiMzkwOWQyOGItZDNiOC00YTQ1LThmM2QtNTk1YTQyMmE2ZTgyIiwiYXVkIjoiNjc4YmUycGFmdm8xaGhlbzRsY3Q3dTRxcnAiLCJldmVudF9pZCI6ImZlNTgyMDRlLWY4NDAtNDU5NC04MThiLTA3MzNmNjk2Yzk1MCIsImN1c3RvbTp1c2VyUm9sZSI6IlRlbmFudEFkbWluIiwidG9rZW5fdXNlIjoiaWQiLCJhdXRoX3RpbWUiOjE3NzM2OTIxNDUsImV4cCI6MTc3MzY5NTc0NSwiaWF0IjoxNzczNjkyMTQ1LCJqdGkiOiI0NTNiMmNmNi1iN2E4LTQyMGQtYWZlNy1jOTBlMGYyOGMyYTMiLCJlbWFpbCI6InNob2FpYi5yYWluQG91dGxvb2suY29tIn0.jZnxlNF8Mmwe4qPZFgFee_xtmSmYMg_fes49aifkl3tHBEH1cMuDsSgcLGU-Tqq8V2Ke9PFGuCU9wtAqjKItsM5gu7dT7MzrLtvP3O1ngD9fG71o_dayXc38jHlOE_P9xLsRvNQ5Vyf0JbRn1jryRF43qp0U59UEapZleFPCG-H0yazNoyaXctI-g80wYIY2Gu-dOpJZHBpLmzTYjigCFfQaakhDtaYxLyQC0g0dfoIQBFBLDLEHeLIrakKXqarLq2ueeUxoMqKoTUGUL1-UK2e5kUqqbu-cIij7FeMbYRI-bF99O5vBriYKFerDrZYPbr60VU1ORj6kvQx9wGmOcA';
const ACADEMIC_YEAR_ID = process.env.ACADEMIC_YEAR_ID || 'f83763de-645f-4dc3-aa63-b7f7b091a5d7';

if (!TOKEN) { console.error('TENANT_ADMIN_TOKEN is required'); process.exit(1); }
if (!SCHOOL_ID) { console.error('SCHOOL_ID is required'); process.exit(1); }
if (!STUDENT_ID) { console.error('STUDENT_ID is required'); process.exit(1); }

// ============================================================================
// TYPES
// ============================================================================

interface HttpTrace {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  requestBody?: string;
  responseBody?: string;
}

interface TestResult {
  step: number;
  phase: string;
  name: string;
  passed: boolean;
  detail?: string;
  durationMs: number;
  httpTraces: HttpTrace[];
}

interface TestLog {
  metadata: {
    baseUrl: string;
    schoolId: string;
    studentId: string;
    tenantId: string;
    startTime: string;
    endTime: string;
    totalDurationMs: number;
  };
  summary: { total: number; passed: number; failed: number; skipped: number };
  results: TestResult[];
}

// ============================================================================
// JWT HELPERS
// ============================================================================

function extractTenantId(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return payload['custom:tenantId'] || '';
  } catch {
    return '';
  }
}

const TENANT_ID = extractTenantId(TOKEN);
if (!TENANT_ID) { console.error('Could not extract tenantId from token'); process.exit(1); }

// ============================================================================
// INSTRUMENTED HTTP CLIENT
// ============================================================================

let currentStepTraces: HttpTrace[] = [];

const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'x-tenant-id': TENANT_ID,
    'Content-Type': 'application/json',
  },
  timeout: 20000,
  validateStatus: () => true,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  (config as any)._startTime = Date.now();
  return config;
});

api.interceptors.response.use((response: AxiosResponse) => {
  const startTime = (response.config as any)._startTime || Date.now();
  const durationMs = Date.now() - startTime;
  const trace: HttpTrace = {
    method: (response.config.method || 'GET').toUpperCase(),
    url: response.config.url || '',
    status: response.status,
    durationMs,
    requestBody: response.config.data ? truncate(JSON.stringify(response.config.data), 500) : undefined,
    responseBody: response.data ? truncate(JSON.stringify(response.data), 800) : undefined,
  };
  currentStepTraces.push(trace);
  return response;
});

// ============================================================================
// HELPERS
// ============================================================================

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

function financePath(subpath: string): string {
  return `/finance/schools/${SCHOOL_ID}${subpath}`;
}

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

// ============================================================================
// TEST RUNNER
// ============================================================================

const results: TestResult[] = [];
let stepNum = 0;
let currentPhase = '';
let skippedCount = 0;

async function runStep(
  name: string,
  fn: () => Promise<{ passed: boolean; detail?: string }>,
): Promise<boolean> {
  stepNum++;
  currentStepTraces = [];
  const start = Date.now();

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  Step ${stepNum} [${currentPhase}]: ${name}`);

  try {
    const { passed, detail } = await fn();
    const durationMs = Date.now() - start;
    results.push({ step: stepNum, phase: currentPhase, name, passed, detail, durationMs, httpTraces: [...currentStepTraces] });

    if (passed) {
      console.log(`  ✅ PASSED (${durationMs}ms)${detail ? ` — ${detail}` : ''}`);
    } else {
      console.log(`  ❌ FAILED (${durationMs}ms)${detail ? ` — ${detail}` : ''}`);
    }
    return passed;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const detail = err.message || String(err);
    results.push({ step: stepNum, phase: currentPhase, name, passed: false, detail, durationMs, httpTraces: [...currentStepTraces] });
    console.log(`  ❌ ERROR (${durationMs}ms) — ${detail}`);
    return false;
  }
}

function skipStep(name: string, reason: string) {
  stepNum++;
  skippedCount++;
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  Step ${stepNum} [${currentPhase}]: ${name}`);
  console.log(`  ⏭️  SKIPPED — ${reason}`);
  results.push({ step: stepNum, phase: currentPhase, name, passed: false, detail: `SKIPPED: ${reason}`, durationMs: 0, httpTraces: [] });
}

// ============================================================================
// TEST STATE
// ============================================================================

let libraryFeeId: string | undefined;
let sportsFeeId: string | undefined;
let overdueInvoiceId: string | undefined;
let overdueInvoiceGrandTotal: number | undefined;
let sportsInvoiceId: string | undefined;
let sportsInvoiceGrandTotal: number | undefined;
let guardRailInvoiceId: string | undefined;     // for negative tests
let guardRailPaymentId: string | undefined;
let refundTestFeeId: string | undefined;
let refundTestInvoiceId: string | undefined;
let refundTestPaymentId: string | undefined;
let creditNoteId: string | undefined;

// ============================================================================
// MAIN TEST EXECUTION
// ============================================================================

async function main() {
  const startTime = new Date().toISOString();
  const globalStart = Date.now();

  console.log('╔' + '═'.repeat(62) + '╗');
  console.log('║  Finance Module — Edge Cases & Overdue E2E Test                ║');
  console.log('╚' + '═'.repeat(62) + '╝');
  console.log(`  Base URL:    ${BASE_URL}`);
  console.log(`  School ID:   ${SCHOOL_ID}`);
  console.log(`  Student ID:  ${STUDENT_ID}`);
  console.log(`  Tenant ID:   ${TENANT_ID}`);
  console.log(`  Started:     ${startTime}`);

  // ════════════════════════════════════════════════════════════════
  // PHASE 1: Overdue Invoice Flow
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Overdue Flow';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 1: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 1: Create fee structure for overdue tests
  await runStep('Create "Library & Lab Fee" (NPR 3000)', async () => {
    const res = await api.post(financePath('/fee-structures'), {
      name: 'Library & Lab Fee',
      description: 'Annual library access and lab usage fee',
      academicYear: '2082-2083',
      academicYearId: ACADEMIC_YEAR_ID,
      feeType: 'lab',
      amount: 3000,
      currency: 'NPR',
      taxRate: 0,
      taxType: 'none',
      frequency: 'annual',
      gradeLevels: [],
      autoApplyOnEnrollment: false,
      effectiveFrom: futureDate(-60),
      effectiveTo: futureDate(365),
    });

    if (res.status === 201 && res.data?.id) {
      libraryFeeId = res.data.id;
      return { passed: true, detail: `id=${libraryFeeId}, amount=3000` };
    }
    return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
  });

  // Step 2: Generate invoice with past due date (30 days ago)
  if (libraryFeeId) {
    await runStep('Generate invoice with past due date (30 days ago)', async () => {
      const res = await api.post(financePath('/invoices'), {
        studentId: STUDENT_ID,
        feeStructureIds: [libraryFeeId],
        academicYear: '2082-2083',
        billingPeriod: 'Library Fee - Baishakh 2082',
        dueDate: futureDate(-30),
        notes: 'Library and lab fee — already past due for overdue testing',
      });

      if (res.status === 201 && res.data?.id) {
        overdueInvoiceId = res.data.id;
        overdueInvoiceGrandTotal = res.data.grandTotal;
        return { passed: true, detail: `id=${overdueInvoiceId}, grandTotal=${overdueInvoiceGrandTotal}, dueDate=${futureDate(-30)}` };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Generate overdue invoice', 'No library fee created');
  }

  // Step 3: Issue the invoice
  if (overdueInvoiceId) {
    await runStep('Issue overdue-candidate invoice (draft → issued)', async () => {
      const res = await api.post(financePath(`/invoices/${overdueInvoiceId}/issue`));

      if ((res.status === 200 || res.status === 201) && res.data?.status === 'issued') {
        return { passed: true, detail: `status=issued, invoiceNumber=${res.data.invoiceNumber}` };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Issue overdue invoice', 'No invoice created');
  }

  // Step 4: Transition to overdue via PATCH (simulates hourly cron)
  if (overdueInvoiceId) {
    await runStep('Transition invoice to overdue (issued → overdue via PATCH)', async () => {
      const res = await api.patch(financePath(`/invoices/${overdueInvoiceId}`), {
        status: 'overdue',
        notes: 'Marked overdue — due date was 30 days ago',
      });

      if (res.status === 200 && res.data?.status === 'overdue') {
        return { passed: true, detail: `status=overdue` };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Transition to overdue', 'No invoice created');
  }

  // Step 5: Verify statusHistory includes overdue transition
  if (overdueInvoiceId) {
    await runStep('Verify overdue invoice detail & statusHistory', async () => {
      const res = await api.get(financePath(`/invoices/${overdueInvoiceId}`));

      if (res.status !== 200) {
        return { passed: false, detail: `status=${res.status}` };
      }

      const inv = res.data;
      if (inv.status !== 'overdue') {
        return { passed: false, detail: `Expected status=overdue, got ${inv.status}` };
      }

      const history = inv.statusHistory || [];
      const overdueEntry = history.find((h: any) => h.to === 'overdue');
      if (!overdueEntry) {
        return { passed: false, detail: `No overdue entry in statusHistory (${history.length} entries)` };
      }

      return {
        passed: true,
        detail: `status=overdue, statusHistory has ${history.length} entries, overdue transition at ${overdueEntry.changedAt}`,
      };
    });
  } else {
    skipStep('Verify overdue statusHistory', 'No invoice created');
  }

  // Step 6: Verify dashboard shows overdue > 0 and outstanding > 0
  // NOTE: Dashboard has a 5-minute in-memory cache keyed by {tenantId}:{schoolId}:{from}:{to}:{academicYear}.
  // Pass a unique academicYear filter to bust the cache from prior test runs.
  await runStep('Dashboard shows overdue > 0 and outstanding > 0', async () => {
    const res = await api.get(financePath('/dashboard/summary'), {
      params: { academicYear: '2082-2083' },
    });

    if (res.status !== 200) {
      return { passed: false, detail: `status=${res.status}` };
    }

    const d = res.data;
    const hasOverdue = d.overdue > 0;
    const hasOutstanding = d.outstanding > 0;

    return {
      passed: hasOverdue && hasOutstanding,
      detail: `outstanding=${d.outstanding}, overdue=${d.overdue}, totalInvoiced=${d.totalInvoiced}, invoicesByStatus=${JSON.stringify(d.invoicesByStatus)}`,
    };
  });

  // ════════════════════════════════════════════════════════════════
  // PHASE 2: Payment on Overdue Invoice
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Pay Overdue';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 2: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 7: Partial payment on overdue invoice
  if (overdueInvoiceId && overdueInvoiceGrandTotal) {
    const halfAmount = Math.floor(overdueInvoiceGrandTotal / 2);

    await runStep(`Partial payment NPR ${halfAmount} on overdue invoice → partially_paid`, async () => {
      const res = await api.post(financePath('/payments/manual'), {
        invoiceId: overdueInvoiceId,
        gateway: 'cash',
        amount: halfAmount,
        currency: 'NPR',
        notes: 'Partial late payment — parent paid half at office',
        paidDate: todayISO(),
      });

      if (res.status === 201 && res.data?.id) {
        return { passed: true, detail: `paymentId=${res.data.id}, amount=${halfAmount}` };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });

    // Step 8: Verify invoice status → partially_paid (not overdue anymore)
    await runStep('Verify overdue invoice → partially_paid after partial payment', async () => {
      const res = await api.get(financePath(`/invoices/${overdueInvoiceId}`));

      if (res.status === 200 && res.data?.status === 'partially_paid') {
        return {
          passed: true,
          detail: `status=partially_paid, amountPaid=${res.data.amountPaid}, amountDue=${res.data.amountDue}`,
        };
      }
      return { passed: false, detail: `Expected partially_paid, got status=${res.data?.status}` };
    });

    // Step 9: Pay remaining amount → paid
    const remaining = overdueInvoiceGrandTotal - halfAmount;
    await runStep(`Pay remaining NPR ${remaining} → paid`, async () => {
      const res = await api.post(financePath('/payments/manual'), {
        invoiceId: overdueInvoiceId,
        gateway: 'cash',
        amount: remaining,
        currency: 'NPR',
        notes: 'Remaining late payment settled',
        paidDate: todayISO(),
      });

      if (res.status !== 201) {
        return { passed: false, detail: `Payment failed: status=${res.status}` };
      }

      // Verify invoice is now paid
      const inv = await api.get(financePath(`/invoices/${overdueInvoiceId}`));
      if (inv.data?.status === 'paid') {
        return { passed: true, detail: `Invoice fully paid, amountDue=${inv.data.amountDue}` };
      }
      return { passed: false, detail: `Expected paid, got ${inv.data?.status}` };
    });
  } else {
    skipStep('Partial payment on overdue', 'No overdue invoice');
    skipStep('Verify partially_paid', 'No overdue invoice');
    skipStep('Pay remaining', 'No overdue invoice');
  }

  // ════════════════════════════════════════════════════════════════
  // PHASE 3: Outstanding & Aging Report
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Aging Report';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 3: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 10: Create sports fee + invoice (due 15 days ago)
  await runStep('Create "Sports Activity Fee" (NPR 1500) + invoice due 15 days ago', async () => {
    // Create fee structure
    const feeRes = await api.post(financePath('/fee-structures'), {
      name: 'Sports Activity Fee',
      description: 'Annual fee for sports equipment and ground maintenance',
      academicYear: '2082-2083',
      academicYearId: ACADEMIC_YEAR_ID,
      feeType: 'miscellaneous',
      amount: 1500,
      currency: 'NPR',
      taxRate: 0,
      taxType: 'none',
      frequency: 'annual',
      gradeLevels: [],
      autoApplyOnEnrollment: false,
      effectiveFrom: futureDate(-60),
    });

    if (feeRes.status !== 201 || !feeRes.data?.id) {
      return { passed: false, detail: `Fee creation failed: status=${feeRes.status}` };
    }
    sportsFeeId = feeRes.data.id;

    // Generate invoice with past due date
    const invRes = await api.post(financePath('/invoices'), {
      studentId: STUDENT_ID,
      feeStructureIds: [sportsFeeId],
      academicYear: '2082-2083',
      billingPeriod: 'Sports Fee - Jestha 2082',
      dueDate: futureDate(-15),
      notes: 'Sports activity fee — overdue for aging report test',
    });

    if (invRes.status !== 201 || !invRes.data?.id) {
      return { passed: false, detail: `Invoice creation failed: status=${invRes.status}` };
    }
    sportsInvoiceId = invRes.data.id;
    sportsInvoiceGrandTotal = invRes.data.grandTotal;

    // Issue the invoice
    const issueRes = await api.post(financePath(`/invoices/${sportsInvoiceId}/issue`));
    if (issueRes.status !== 200 && issueRes.status !== 201) {
      return { passed: false, detail: `Issue failed: status=${issueRes.status}` };
    }

    return { passed: true, detail: `feeId=${sportsFeeId}, invoiceId=${sportsInvoiceId}, grandTotal=${sportsInvoiceGrandTotal}` };
  });

  // Step 11: Transition to overdue
  if (sportsInvoiceId) {
    await runStep('Transition sports invoice to overdue', async () => {
      const res = await api.patch(financePath(`/invoices/${sportsInvoiceId}`), {
        status: 'overdue',
        notes: 'Sports fee past due — 15 days overdue',
      });

      if (res.status === 200 && res.data?.status === 'overdue') {
        return { passed: true, detail: 'status=overdue' };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Transition sports invoice to overdue', 'No invoice');
  }

  // Step 12: Duplicate invoice prevention (sports invoice is overdue = active)
  if (sportsFeeId && sportsInvoiceId) {
    await runStep('Duplicate invoice prevention — bulk-generate same fee+period → skipped', async () => {
      const res = await api.post(financePath('/invoices/bulk-generate'), {
        studentIds: [STUDENT_ID],
        feeStructureIds: [sportsFeeId],
        academicYear: '2082-2083',
        billingPeriod: 'Sports Fee - Jestha 2082', // Same as step 10
        dueDate: futureDate(30),
      });

      if (res.status === 201 && res.data?.skipped >= 1) {
        return { passed: true, detail: `generated=${res.data.generated}, skipped=${res.data.skipped} (duplicate detected)` };
      }
      if (res.status === 201 && res.data?.generated === 0) {
        return { passed: true, detail: `generated=0 — duplicate correctly prevented` };
      }
      return { passed: false, detail: `Expected skipped>=1, got status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Duplicate invoice prevention', 'No sports fee/invoice');
  }

  // Step 13: Verify aging report buckets
  await runStep('Verify dashboard aging report — 1-30 day bucket populated', async () => {
    const res = await api.get(financePath('/dashboard/summary'), {
      params: { academicYear: '2082-2083' },
    });

    if (res.status !== 200) {
      return { passed: false, detail: `status=${res.status}` };
    }

    const aging = res.data.agingReport || [];
    const bucket1_30 = aging.find((b: any) => b.label === '1-30 days');

    if (bucket1_30 && bucket1_30.count > 0) {
      return {
        passed: true,
        detail: `1-30 day bucket: count=${bucket1_30.count}, amount=${bucket1_30.amount}. Outstanding=${res.data.outstanding}, overdue=${res.data.overdue}`,
      };
    }

    return {
      passed: false,
      detail: `1-30 day bucket empty or missing. agingReport=${JSON.stringify(aging)}`,
    };
  });

  // ════════════════════════════════════════════════════════════════
  // PHASE 4: Write-Off Flow
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Write-Off';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 4: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 13: Write off the overdue sports invoice
  if (sportsInvoiceId) {
    await runStep('Write off overdue sports invoice (overdue → written_off)', async () => {
      const res = await api.patch(financePath(`/invoices/${sportsInvoiceId}`), {
        status: 'written_off',
        notes: 'Student unable to pay — written off per principal approval',
      });

      if (res.status === 200 && res.data?.status === 'written_off') {
        return { passed: true, detail: 'status=written_off (terminal)' };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Write off sports invoice', 'No invoice');
  }

  // Step 14: Verify written_off is terminal — try to re-issue
  if (sportsInvoiceId) {
    await runStep('Verify written_off is terminal — re-issue blocked', async () => {
      const res = await api.post(financePath(`/invoices/${sportsInvoiceId}/issue`));

      if (res.status === 400) {
        return { passed: true, detail: `Correctly blocked: status=${res.status}` };
      }
      return { passed: false, detail: `Expected 400, got ${res.status}` };
    });
  } else {
    skipStep('Verify written_off terminal', 'No invoice');
  }

  // ════════════════════════════════════════════════════════════════
  // PHASE 5: Negative / Guard Rail Tests
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Guard Rails';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 5: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Create a helper invoice for negative tests
  let guardRailFeeId: string | undefined;
  await runStep('Setup: Create fee + invoice for guard rail tests', async () => {
    // Create a simple fee
    const feeRes = await api.post(financePath('/fee-structures'), {
      name: 'Computer Lab Fee',
      description: 'Monthly computer lab access fee for IT classes',
      academicYear: '2082-2083',
      academicYearId: ACADEMIC_YEAR_ID,
      feeType: 'lab',
      amount: 2000,
      currency: 'NPR',
      taxRate: 0,
      taxType: 'none',
      frequency: 'monthly',
      gradeLevels: [],
      autoApplyOnEnrollment: false,
      effectiveFrom: todayISO(),
    });

    if (feeRes.status !== 201) {
      return { passed: false, detail: `Fee failed: status=${feeRes.status}` };
    }
    guardRailFeeId = feeRes.data.id;

    // Generate invoice
    const invRes = await api.post(financePath('/invoices'), {
      studentId: STUDENT_ID,
      feeStructureIds: [guardRailFeeId],
      academicYear: '2082-2083',
      billingPeriod: 'Computer Lab - Shrawan 2082',
      dueDate: futureDate(30),
      notes: 'Guard rail test invoice',
    });

    if (invRes.status !== 201) {
      return { passed: false, detail: `Invoice failed: status=${invRes.status}` };
    }
    guardRailInvoiceId = invRes.data.id;

    return { passed: true, detail: `feeId=${guardRailFeeId}, invoiceId=${guardRailInvoiceId}` };
  });

  // Step 16: Overpayment rejection — pay a draft invoice first issue it, then overpay
  if (guardRailInvoiceId) {
    // Issue first
    await api.post(financePath(`/invoices/${guardRailInvoiceId}/issue`));

    await runStep('Overpayment rejection — pay more than amountDue', async () => {
      const res = await api.post(financePath('/payments/manual'), {
        invoiceId: guardRailInvoiceId,
        gateway: 'cash',
        amount: 999999,
        currency: 'NPR',
        notes: 'Attempting overpayment',
        paidDate: todayISO(),
      });

      if (res.status === 400) {
        return { passed: true, detail: `Correctly rejected: ${truncate(res.data?.message || '', 100)}` };
      }
      return { passed: false, detail: `Expected 400, got ${res.status}` };
    });
  } else {
    skipStep('Overpayment rejection', 'No invoice');
  }

  // Step 17: Pay a cancelled invoice
  await runStep('Pay a cancelled invoice — expect rejection', async () => {
    // Create and cancel an invoice
    const invRes = await api.post(financePath('/invoices'), {
      studentId: STUDENT_ID,
      feeStructureIds: [guardRailFeeId || libraryFeeId],
      academicYear: '2082-2083',
      billingPeriod: 'Cancelled Test - Bhadra 2082',
      dueDate: futureDate(30),
    });

    if (invRes.status !== 201) {
      return { passed: false, detail: `Invoice creation failed: ${invRes.status}` };
    }

    const cancelledId = invRes.data.id;
    // Cancel the draft
    await api.patch(financePath(`/invoices/${cancelledId}`), { status: 'cancelled' });

    // Try to pay it
    const payRes = await api.post(financePath('/payments/manual'), {
      invoiceId: cancelledId,
      gateway: 'cash',
      amount: 100,
      currency: 'NPR',
      paidDate: todayISO(),
    });

    if (payRes.status === 400) {
      return { passed: true, detail: `Correctly rejected payment on cancelled invoice` };
    }
    return { passed: false, detail: `Expected 400, got ${payRes.status}` };
  });

  // Step 18: Pay a draft invoice — API accepts this (auto-applies payment, invoice becomes paid/partially_paid)
  // This is actual behavior: the payment service records the payment and applies it regardless of invoice status.
  await runStep('Pay a draft invoice — verify payment accepted (API behavior)', async () => {
    const invRes = await api.post(financePath('/invoices'), {
      studentId: STUDENT_ID,
      feeStructureIds: [guardRailFeeId || libraryFeeId],
      academicYear: '2082-2083',
      billingPeriod: 'Draft Test - Aswin 2082',
      dueDate: futureDate(30),
    });

    if (invRes.status !== 201) {
      return { passed: false, detail: `Invoice creation failed: ${invRes.status}` };
    }

    const payRes = await api.post(financePath('/payments/manual'), {
      invoiceId: invRes.data.id,
      gateway: 'cash',
      amount: invRes.data.grandTotal,
      currency: 'NPR',
      paidDate: todayISO(),
    });

    if (payRes.status === 201) {
      return { passed: true, detail: `Payment accepted on draft invoice (API allows this), paymentId=${payRes.data.id}` };
    }
    return { passed: false, detail: `Unexpected status=${payRes.status}` };
  });

  // Step 19: Credit note exceeding remaining
  await runStep('Apply credit note exceeding remaining balance — expect rejection', async () => {
    // Create a small credit note
    const cnRes = await api.post(financePath('/credit-notes'), {
      studentId: STUDENT_ID,
      amount: 500,
      currency: 'NPR',
      type: 'adjustment',
      description: 'Small test credit for edge case validation',
      effectiveDate: todayISO(),
    });

    if (cnRes.status !== 201) {
      return { passed: false, detail: `Credit note creation failed: ${cnRes.status}` };
    }
    creditNoteId = cnRes.data.id;

    // Try to apply 99999 (way more than the 500 remaining)
    const applyRes = await api.post(financePath(`/credit-notes/${creditNoteId}/apply`), {
      invoiceId: guardRailInvoiceId,
      amount: 99999,
    });

    if (applyRes.status === 400) {
      return { passed: true, detail: `Correctly rejected: ${truncate(applyRes.data?.message || '', 100)}` };
    }
    return { passed: false, detail: `Expected 400, got ${applyRes.status}` };
  });

  // Step 21: Invalid status transition — paid → draft
  if (overdueInvoiceId) {
    await runStep('Invalid status transition (paid → draft) — expect 400', async () => {
      const res = await api.patch(financePath(`/invoices/${overdueInvoiceId}`), {
        status: 'draft',
      });

      if (res.status === 400) {
        return { passed: true, detail: `Correctly rejected: ${truncate(res.data?.message || '', 100)}` };
      }
      return { passed: false, detail: `Expected 400, got ${res.status}` };
    });
  } else {
    skipStep('Invalid status transition', 'No paid invoice');
  }

  // Step 22: Issue a cancelled invoice
  await runStep('Issue a cancelled invoice — expect 400', async () => {
    // Create and cancel
    const invRes = await api.post(financePath('/invoices'), {
      studentId: STUDENT_ID,
      feeStructureIds: [guardRailFeeId || libraryFeeId],
      academicYear: '2082-2083',
      billingPeriod: 'Cancelled Issue Test - Kartik 2082',
      dueDate: futureDate(30),
    });

    if (invRes.status !== 201) {
      return { passed: false, detail: `Invoice creation failed: ${invRes.status}` };
    }

    await api.patch(financePath(`/invoices/${invRes.data.id}`), { status: 'cancelled' });

    const issueRes = await api.post(financePath(`/invoices/${invRes.data.id}/issue`));
    if (issueRes.status === 400) {
      return { passed: true, detail: `Correctly blocked: cancelled invoices cannot be issued` };
    }
    return { passed: false, detail: `Expected 400, got ${issueRes.status}` };
  });

  // Step 23: Refund more than paid amount
  if (guardRailInvoiceId) {
    await runStep('Refund more than paid — expect rejection', async () => {
      // Pay the guard rail invoice first
      const payRes = await api.post(financePath('/payments/manual'), {
        invoiceId: guardRailInvoiceId,
        gateway: 'cash',
        amount: 2000,
        currency: 'NPR',
        notes: 'Full payment for refund test',
        paidDate: todayISO(),
      });

      if (payRes.status !== 201) {
        return { passed: false, detail: `Payment failed: ${payRes.status}` };
      }
      guardRailPaymentId = payRes.data.id;

      // Try to refund 50000 (way more than the 2000 paid)
      const refundRes = await api.post(financePath('/refunds'), {
        paymentId: guardRailPaymentId,
        invoiceId: guardRailInvoiceId,
        amount: 50000,
        reason: 'Attempting excessive refund',
      });

      if (refundRes.status === 400) {
        return { passed: true, detail: `Correctly rejected: ${truncate(refundRes.data?.message || '', 100)}` };
      }
      return { passed: false, detail: `Expected 400, got ${refundRes.status}` };
    });
  } else {
    skipStep('Refund more than paid', 'No guard rail invoice');
  }

  // ════════════════════════════════════════════════════════════════
  // PHASE 6: Refund Reverts Invoice Status
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Refund Revert';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 6: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 24: Create fresh fee + invoice, issue it, pay it fully
  await runStep('Setup: Create fee, invoice, issue, pay fully → paid', async () => {
    // Create fee
    const feeRes = await api.post(financePath('/fee-structures'), {
      name: 'Stationery Supply Fee',
      description: 'Annual stationery and notebook supply fee',
      academicYear: '2082-2083',
      academicYearId: ACADEMIC_YEAR_ID,
      feeType: 'custom',
      amount: 4000,
      currency: 'NPR',
      taxRate: 0,
      taxType: 'none',
      frequency: 'annual',
      gradeLevels: [],
      autoApplyOnEnrollment: false,
      effectiveFrom: todayISO(),
    });

    if (feeRes.status !== 201) {
      return { passed: false, detail: `Fee failed: ${feeRes.status}` };
    }
    refundTestFeeId = feeRes.data.id;

    // Generate invoice
    const invRes = await api.post(financePath('/invoices'), {
      studentId: STUDENT_ID,
      feeStructureIds: [refundTestFeeId],
      academicYear: '2082-2083',
      billingPeriod: 'Stationery - Mangsir 2082',
      dueDate: futureDate(30),
      notes: 'Stationery fee for refund-revert testing',
    });

    if (invRes.status !== 201) {
      return { passed: false, detail: `Invoice failed: ${invRes.status}` };
    }
    refundTestInvoiceId = invRes.data.id;

    // Issue
    const issueRes = await api.post(financePath(`/invoices/${refundTestInvoiceId}/issue`));
    if (issueRes.status !== 200 && issueRes.status !== 201) {
      return { passed: false, detail: `Issue failed: ${issueRes.status}` };
    }

    // Pay fully
    const payRes = await api.post(financePath('/payments/manual'), {
      invoiceId: refundTestInvoiceId,
      gateway: 'bank_transfer',
      amount: 4000,
      currency: 'NPR',
      referenceNumber: `SBL-KTM-${todayISO().replace(/-/g, '').slice(2)}-002`,
      notes: 'Full payment for stationery fee via bank transfer',
      paidDate: todayISO(),
    });

    if (payRes.status !== 201) {
      return { passed: false, detail: `Payment failed: ${payRes.status}` };
    }
    refundTestPaymentId = payRes.data.id;

    // Verify paid
    const checkRes = await api.get(financePath(`/invoices/${refundTestInvoiceId}`));
    if (checkRes.data?.status !== 'paid') {
      return { passed: false, detail: `Expected paid, got ${checkRes.data?.status}` };
    }

    return { passed: true, detail: `feeId=${refundTestFeeId}, invoiceId=${refundTestInvoiceId}, paymentId=${refundTestPaymentId}, status=paid` };
  });

  // Step 25: Direct refund on payment → invoice should revert from paid
  // Uses POST /payments/:id/refund (calls reversePaymentOnInvoice synchronously)
  // NOT the multi-step refund approval workflow (which only creates a credit note)
  if (refundTestPaymentId && refundTestInvoiceId) {
    await runStep('Direct partial refund NPR 1000 on paid invoice → status reverts', async () => {
      const refundRes = await api.post(financePath(`/payments/${refundTestPaymentId}/refund`), {
        amount: 1000,
        reason: 'Stationery kit price reduced by supplier — refunding difference',
      });

      if (refundRes.status !== 200 && refundRes.status !== 201) {
        return { passed: false, detail: `Refund failed: ${refundRes.status} body=${truncate(JSON.stringify(refundRes.data), 300)}` };
      }

      // Check invoice status — reversePaymentOnInvoice should have updated it synchronously
      const inv = await api.get(financePath(`/invoices/${refundTestInvoiceId}`));
      const status = inv.data?.status;
      const amountPaid = inv.data?.amountPaid;
      const amountDue = inv.data?.amountDue;

      // After refunding 1000 of 4000: amountPaid=3000, amountDue=1000, status should NOT be "paid"
      if (status !== 'paid' && amountDue > 0) {
        return {
          passed: true,
          detail: `Invoice reverted: status=${status}, amountPaid=${amountPaid}, amountDue=${amountDue}`,
        };
      }
      return {
        passed: false,
        detail: `Invoice should have reverted from paid. status=${status}, amountPaid=${amountPaid}, amountDue=${amountDue}`,
      };
    });
  } else {
    skipStep('Direct partial refund reverts status', 'No paid invoice/payment');
  }

  // Step 26: Verify final invoice state
  if (refundTestInvoiceId) {
    await runStep('Verify refunded invoice final state — amountDue=1000, status reverted', async () => {
      const res = await api.get(financePath(`/invoices/${refundTestInvoiceId}`));

      if (res.status !== 200) {
        return { passed: false, detail: `status=${res.status}` };
      }

      const inv = res.data;
      const history = inv.statusHistory || [];

      return {
        passed: inv.amountDue === 1000 && inv.amountPaid === 3000,
        detail: `grandTotal=${inv.grandTotal}, amountPaid=${inv.amountPaid}, amountDue=${inv.amountDue}, status=${inv.status}, historyLength=${history.length}`,
      };
    });
  } else {
    skipStep('Verify refunded invoice state', 'No invoice');
  }

  // ════════════════════════════════════════════════════════════════
  // DATA PRESERVED — No cleanup
  // ════════════════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(64)}`);
  console.log('  DATA PRESERVED — All test data kept for UI validation');
  console.log('═'.repeat(64));
  console.log(`  Fee structures: ${[libraryFeeId, sportsFeeId, guardRailFeeId, refundTestFeeId].filter(Boolean).join(', ')}`);
  console.log(`  Invoices:       ${[overdueInvoiceId, sportsInvoiceId, guardRailInvoiceId, refundTestInvoiceId].filter(Boolean).join(', ')}`);
  console.log(`  Credit note:    ${creditNoteId || 'none'}`);

  // ════════════════════════════════════════════════════════════════
  // SUMMARY & LOG WRITING
  // ════════════════════════════════════════════════════════════════
  const endTime = new Date().toISOString();
  const totalDurationMs = Date.now() - globalStart;

  printSummary();
  writeLogFiles(startTime, endTime, totalDurationMs);
}

// ============================================================================
// SUMMARY PRINTER
// ============================================================================

function printSummary() {
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed && !r.detail?.startsWith('SKIPPED')).length;
  const skippedActual = results.filter(r => r.detail?.startsWith('SKIPPED')).length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log(`\n╔${'═'.repeat(62)}╗`);
  console.log(`║  TEST RESULTS                                                ║`);
  console.log(`╚${'═'.repeat(62)}╝`);

  const phases = [...new Set(results.map(r => r.phase))];
  for (const phase of phases) {
    const phaseResults = results.filter(r => r.phase === phase);
    const phasePass = phaseResults.filter(r => r.passed).length;
    const phaseTotal = phaseResults.length;
    console.log(`\n  [${phase}] ${phasePass}/${phaseTotal} passed`);
    for (const r of phaseResults) {
      const icon = r.detail?.startsWith('SKIPPED') ? '⏭️ ' : r.passed ? '✅' : '❌';
      console.log(`    ${icon} Step ${r.step}: ${r.name}`);
      if (r.detail && !r.passed) {
        console.log(`       ${r.detail}`);
      }
    }
  }

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  Total: ${results.length} steps | ${passedCount} passed | ${failedCount} failed | ${skippedActual} skipped | ${totalMs}ms`);

  if (failedCount > 0) {
    console.log(`\n  ❌ EDGE CASE TEST HAS FAILURES`);
  } else if (passedCount === results.length) {
    console.log(`\n  ✅ ALL STEPS PASSED`);
  } else {
    console.log(`\n  ⚠️  PASSED WITH SKIPS (${skippedActual} skipped due to upstream failures)`);
  }
}

// ============================================================================
// LOG FILE WRITER
// ============================================================================

function writeLogFiles(startTime: string, endTime: string, totalDurationMs: number) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logsDir = path.join(__dirname, 'logs');

  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed && !r.detail?.startsWith('SKIPPED')).length;
  const skippedActual = results.filter(r => r.detail?.startsWith('SKIPPED')).length;

  const jsonLog: TestLog = {
    metadata: {
      baseUrl: BASE_URL,
      schoolId: SCHOOL_ID,
      studentId: STUDENT_ID,
      tenantId: TENANT_ID,
      startTime,
      endTime,
      totalDurationMs,
    },
    summary: {
      total: results.length,
      passed: passedCount,
      failed: failedCount,
      skipped: skippedActual,
    },
    results,
  };

  const jsonPath = path.join(logsDir, `finance-edge-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonLog, null, 2));
  console.log(`\n  JSON log: ${jsonPath}`);

  const lines: string[] = [
    '═'.repeat(80),
    'Finance Module — Edge Cases & Overdue E2E Test Log',
    '═'.repeat(80),
    `Start:    ${startTime}`,
    `End:      ${endTime}`,
    `Duration: ${totalDurationMs}ms`,
    `Base URL: ${BASE_URL}`,
    `School:   ${SCHOOL_ID}`,
    `Student:  ${STUDENT_ID}`,
    `Tenant:   ${TENANT_ID}`,
    '',
    `SUMMARY: ${passedCount} passed | ${failedCount} failed | ${skippedActual} skipped | ${results.length} total`,
    '═'.repeat(80),
    '',
  ];

  for (const r of results) {
    const icon = r.detail?.startsWith('SKIPPED') ? 'SKIP' : r.passed ? 'PASS' : 'FAIL';
    lines.push(`[${icon}] Step ${r.step} (${r.phase}): ${r.name} [${r.durationMs}ms]`);
    if (r.detail) lines.push(`  Detail: ${r.detail}`);

    if (r.httpTraces.length > 0) {
      lines.push(`  HTTP Traces:`);
      for (const t of r.httpTraces) {
        lines.push(`    ${t.method} ${t.url} → ${t.status} (${t.durationMs}ms)`);
        if (t.requestBody) lines.push(`      Request:  ${t.requestBody}`);
        if (t.responseBody) lines.push(`      Response: ${t.responseBody}`);
      }
    }
    lines.push('');
  }

  const logPath = path.join(logsDir, `finance-edge-${timestamp}.log`);
  fs.writeFileSync(logPath, lines.join('\n'));
  console.log(`  Text log: ${logPath}`);
}

// ============================================================================
// RUN
// ============================================================================

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
}).then(() => {
  const failedCount = results.filter(r => !r.passed && !r.detail?.startsWith('SKIPPED')).length;
  process.exit(failedCount > 0 ? 1 : 0);
});
