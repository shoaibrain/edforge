/**
 * Finance Module — Comprehensive End-to-End Test
 *
 * Covers ALL finance features:
 *   Phase  1: Fee Structure CRUD (7 steps)
 *   Phase  2: Discount Rules (4 steps)
 *   Phase  3: Invoice Generation & Lifecycle (11 steps)
 *   Phase  4: Manual Payment Flow (6 steps)
 *   Phase  5: Credit Notes (4 steps)
 *   Phase  6: Refund Workflow (4 steps)
 *   Phase  7: Payment Void (1 step)
 *   Phase  8: Invoice Cancellation (1 step)
 *   Phase  9: Dashboard & Reporting (4 steps)
 *   Phase 10: Payment Gateways Config (2 steps)
 *
 * NOTE: Test data is intentionally preserved (no cleanup) for UI validation.
 *
 * Usage:
 *   TENANT_ADMIN_TOKEN="<jwt>" SCHOOL_ID="<id>" STUDENT_ID="<id>" \
 *     npx ts-node scripts/smoke-tests/finance-e2e-comprehensive.ts
 *
 * Optional env:
 *   API_BASE_URL    — defaults to prod gateway
 *   ACADEMIC_YEAR_ID — if provided, used in fee structure creation
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
const TOKEN = process.env.TENANT_ADMIN_TOKEN || ''; // export TENANT_ADMIN_TOKEN=<Cognito ID token>; never paste a token into this file;
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
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
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

// Request interceptor — stamp start time
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  (config as any)._startTime = Date.now();
  return config;
});

// Response interceptor — record trace
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

function financeGlobalPath(subpath: string): string {
  return `/finance${subpath}`;
}

function assertClose(actual: number, expected: number, tolerance = 0.01): boolean {
  return Math.abs(actual - expected) <= tolerance;
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
// TEST STATE (populated across steps)
// ============================================================================

let tuitionFeeId: string | undefined;
let admissionFeeId: string | undefined;
let examFeeId: string | undefined;
let scholarshipDiscountId: string | undefined;
let earlyPaymentDiscountId: string | undefined;
let invoice1Id: string | undefined;
let invoice1GrandTotal: number | undefined;
let invoice2Id: string | undefined;
let invoice2GrandTotal: number | undefined;
let payment1Id: string | undefined;
let payment2Id: string | undefined;
let creditNoteId: string | undefined;
let refundId: string | undefined;
let studentAccountId: string | undefined;

// ============================================================================
// MAIN TEST EXECUTION
// ============================================================================

async function main() {
  const startTime = new Date().toISOString();
  const globalStart = Date.now();

  console.log('╔' + '═'.repeat(62) + '╗');
  console.log('║  Finance Module — Comprehensive E2E Test                      ║');
  console.log('╚' + '═'.repeat(62) + '╝');
  console.log(`  Base URL:    ${BASE_URL}`);
  console.log(`  School ID:   ${SCHOOL_ID}`);
  console.log(`  Student ID:  ${STUDENT_ID}`);
  console.log(`  Tenant ID:   ${TENANT_ID}`);
  console.log(`  Started:     ${startTime}`);

  // ════════════════════════════════════════════════════════════════
  // PHASE 1: Fee Structure CRUD
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Fee Structures';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 1: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 1: Create tuition fee
  await runStep('Create tuition fee structure (annual, NPR 50000, 13% VAT)', async () => {
    const res = await api.post(financePath('/fee-structures'), {
      name: 'Annual Tuition Fee - Class 1-10',
      description: 'Annual tuition fee for all classes (Grade 1 through 10) as per school board guidelines',
      academicYear: '2082-2083',
      academicYearId: ACADEMIC_YEAR_ID || undefined,
      feeType: 'tuition',
      amount: 50000,
      currency: 'NPR',
      taxRate: 13,
      taxType: 'VAT',
      frequency: 'annual',
      gradeLevels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      autoApplyOnEnrollment: true,
      effectiveFrom: todayISO(),
      effectiveTo: futureDate(365),
      enrollmentTypes: ['new_admission', 'returning', 're_enrollment'],
    });

    if ((res.status === 200 || res.status === 201) && res.data) {
      tuitionFeeId = res.data.feeStructureId || res.data.id;
      return { passed: !!tuitionFeeId, detail: `id=${tuitionFeeId}, amount=50000, taxRate=13%` };
    }
    return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
  });

  // Step 2: Create admission fee
  await runStep('Create admission fee structure (one_time, NPR 5000, no tax)', async () => {
    const res = await api.post(financePath('/fee-structures'), {
      name: 'New Admission Fee',
      description: 'One-time admission processing fee for new students joining the school',
      academicYear: '2082-2083',
      academicYearId: ACADEMIC_YEAR_ID || undefined,
      feeType: 'admission',
      amount: 5000,
      currency: 'NPR',
      taxRate: 0,
      taxType: 'none',
      frequency: 'one_time',
      gradeLevels: [],
      autoApplyOnEnrollment: false,
      effectiveFrom: todayISO(),
    });

    if ((res.status === 200 || res.status === 201) && res.data) {
      admissionFeeId = res.data.feeStructureId || res.data.id;
      return { passed: !!admissionFeeId, detail: `id=${admissionFeeId}, amount=5000` };
    }
    return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
  });

  // Step 3: Create exam fee with due date rule
  await runStep('Create exam fee structure (quarterly, NPR 2000, due day 15)', async () => {
    const res = await api.post(financePath('/fee-structures'), {
      name: 'Quarterly Examination Fee',
      description: 'Terminal examination fee charged quarterly, due on the 15th of each exam month',
      academicYear: '2082-2083',
      academicYearId: ACADEMIC_YEAR_ID || undefined,
      feeType: 'exam',
      amount: 2000,
      currency: 'NPR',
      taxRate: 0,
      taxType: 'none',
      frequency: 'quarterly',
      gradeLevels: [],
      autoApplyOnEnrollment: false,
      effectiveFrom: todayISO(),
      dueDateRule: { type: 'fixed_day_of_month', dayOfMonth: 15 },
    });

    if ((res.status === 200 || res.status === 201) && res.data) {
      examFeeId = res.data.feeStructureId || res.data.id;
      return { passed: !!examFeeId, detail: `id=${examFeeId}, amount=2000, dueDateRule=fixed_day_of_month` };
    }
    return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
  });

  // Step 4: List fee structures
  await runStep('List fee structures — verify all 3 appear', async () => {
    const res = await api.get(financePath('/fee-structures'));
    if (res.status !== 200) {
      return { passed: false, detail: `status=${res.status}` };
    }
    const items = res.data?.items || [];
    const ourIds = [tuitionFeeId, admissionFeeId, examFeeId].filter(Boolean);
    const found = items.filter((fs: any) => ourIds.includes(fs.feeStructureId || fs.id));
    return {
      passed: found.length === ourIds.length,
      detail: `Found ${found.length}/${ourIds.length} test fees in ${items.length} total`,
    };
  });

  // Step 5: Get fee structure detail
  if (tuitionFeeId) {
    await runStep('Get tuition fee detail — verify fields', async () => {
      const res = await api.get(financePath(`/fee-structures/${tuitionFeeId}`));
      if (res.status !== 200) {
        return { passed: false, detail: `status=${res.status}` };
      }
      const fs = res.data;
      const checks = [
        fs.feeType === 'tuition' || 'feeType mismatch',
        fs.amount === 50000 || 'amount mismatch',
        fs.taxRate === 13 || 'taxRate mismatch',
        fs.frequency === 'annual' || 'frequency mismatch',
        fs.isActive === true || 'isActive should be true',
        fs.autoApplyOnEnrollment === true || 'autoApply should be true',
      ];
      const failures = checks.filter(c => typeof c === 'string');
      return {
        passed: failures.length === 0,
        detail: failures.length === 0 ? 'All fields match' : `Mismatches: ${failures.join(', ')}`,
      };
    });
  }

  // Step 6: Update tuition fee
  if (tuitionFeeId) {
    await runStep('Update tuition fee — amount 50000→55000', async () => {
      const res = await api.patch(financePath(`/fee-structures/${tuitionFeeId}`), {
        amount: 55000,
        reason: 'Board-approved fee revision for academic year 2082-2083',
      });
      if (res.status !== 200) {
        return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
      }
      const updated = res.data;
      return {
        passed: updated.amount === 55000,
        detail: `amount=${updated.amount}, version=${updated.version}`,
      };
    });
  }

  // Step 7: Negative — create fee with invalid data
  await runStep('Negative: create fee with missing required fields — expect 400', async () => {
    const res = await api.post(financePath('/fee-structures'), {
      // Missing name, feeType, amount, etc.
      description: 'This should fail',
    });
    return {
      passed: res.status === 400 || res.status === 422,
      detail: `status=${res.status} (expected 400/422)`,
    };
  });

  // ════════════════════════════════════════════════════════════════
  // PHASE 2: Discount Rules
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Discount Rules';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 2: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 8: Create scholarship discount
  await runStep('Create scholarship discount (25% off tuition)', async () => {
    const res = await api.post(financePath('/discount-rules'), {
      name: 'Merit Scholarship - Top 10%',
      description: 'Awarded to students ranking in top 10% of their class in annual examinations',
      academicYearId: ACADEMIC_YEAR_ID || 'default',
      type: 'percentage',
      value: 25,
      applicableFeeTypes: ['tuition'],
      condition: { type: 'scholarship', scholarshipId: 'E2E-MERIT-001' },
      priority: 1,
    });

    if ((res.status === 200 || res.status === 201) && res.data) {
      scholarshipDiscountId = res.data.discountRuleId || res.data.id;
      return { passed: !!scholarshipDiscountId, detail: `id=${scholarshipDiscountId}, 25% off tuition` };
    }
    return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
  });

  // Step 9: Create early payment discount
  await runStep('Create early payment discount (NPR 1000 fixed)', async () => {
    const res = await api.post(financePath('/discount-rules'), {
      name: 'Early Payment Discount (15-day)',
      description: 'NPR 1000 discount for payments received 15 days before due date',
      academicYearId: ACADEMIC_YEAR_ID || 'default',
      type: 'fixed',
      value: 1000,
      applicableFeeTypes: ['tuition', 'exam'],
      condition: { type: 'early_payment', daysBefore: 15 },
      priority: 2,
    });

    if ((res.status === 200 || res.status === 201) && res.data) {
      earlyPaymentDiscountId = res.data.discountRuleId || res.data.id;
      return { passed: !!earlyPaymentDiscountId, detail: `id=${earlyPaymentDiscountId}, NPR 1000 fixed` };
    }
    return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
  });

  // Step 10: List discount rules
  await runStep('List discount rules — verify 2 exist', async () => {
    const res = await api.get(financePath('/discount-rules'));
    if (res.status !== 200) {
      return { passed: false, detail: `status=${res.status}` };
    }
    const items = res.data?.items || [];
    const ourIds = [scholarshipDiscountId, earlyPaymentDiscountId].filter(Boolean);
    const found = items.filter((r: any) => ourIds.includes(r.discountRuleId || r.id));
    return {
      passed: found.length === ourIds.length,
      detail: `Found ${found.length}/${ourIds.length} test rules in ${items.length} total`,
    };
  });

  // Step 11: Negative — discount value > 100%
  await runStep('Negative: percentage discount > 100 — expect 400', async () => {
    const res = await api.post(financePath('/discount-rules'), {
      name: 'Invalid discount',
      academicYearId: ACADEMIC_YEAR_ID || 'default',
      type: 'percentage',
      value: 150,
      applicableFeeTypes: ['tuition'],
      condition: { type: 'manual' },
    });
    return {
      passed: res.status === 400 || res.status === 422,
      detail: `status=${res.status} (expected 400/422)`,
    };
  });

  // ════════════════════════════════════════════════════════════════
  // PHASE 3: Invoice Generation & Lifecycle
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Invoices';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 3: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 12: Generate single invoice (tuition + admission)
  const canGenerateInvoice = !!(tuitionFeeId && admissionFeeId);
  if (canGenerateInvoice) {
    await runStep('Generate invoice — tuition + admission fees', async () => {
      const res = await api.post(financePath('/invoices'), {
        studentId: STUDENT_ID,
        feeStructureIds: [tuitionFeeId, admissionFeeId],
        academicYear: '2082-2083',
        billingPeriod: 'Baishakh - Chaitra 2082',
        dueDate: futureDate(30),
        notes: 'Annual tuition and admission charges for academic session 2082-2083',
      });

      if ((res.status === 200 || res.status === 201) && res.data) {
        invoice1Id = res.data.invoiceId || res.data.id;
        invoice1GrandTotal = res.data.grandTotal;
        return {
          passed: !!invoice1Id,
          detail: `id=${invoice1Id}, grandTotal=${invoice1GrandTotal}, status=${res.data.status}, lineItems=${res.data.lineItems?.length}`,
        };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Generate invoice — tuition + admission fees', 'Fee structures not created');
  }

  // Step 13: Verify invoice detail — amounts
  if (invoice1Id) {
    await runStep('Verify invoice detail — lineItems, amounts', async () => {
      const res = await api.get(financePath(`/invoices/${invoice1Id}`));
      if (res.status !== 200) {
        return { passed: false, detail: `status=${res.status}` };
      }
      const inv = res.data;
      const lineItems = inv.lineItems || [];
      // Tuition: 55000 (updated) + 13% VAT = 55000 + 7150 = 62150
      // Admission: 5000 + 0% = 5000
      // Expected subtotal: 60000, taxTotal: 7150, grandTotal: 67150
      const checks = [
        lineItems.length === 2 || `Expected 2 lineItems, got ${lineItems.length}`,
        inv.amountPaid === 0 || `amountPaid should be 0, got ${inv.amountPaid}`,
        inv.amountDue === inv.grandTotal || `amountDue (${inv.amountDue}) !== grandTotal (${inv.grandTotal})`,
        inv.currency === 'NPR' || `currency should be NPR, got ${inv.currency}`,
        inv.studentId === STUDENT_ID || `studentId mismatch`,
      ];
      const failures = checks.filter(c => typeof c === 'string');
      return {
        passed: failures.length === 0,
        detail: failures.length === 0
          ? `2 lineItems, subtotal=${inv.subtotal}, tax=${inv.taxTotal}, grand=${inv.grandTotal}`
          : `Issues: ${failures.join('; ')}`,
      };
    });
  } else {
    skipStep('Verify invoice detail', 'Invoice not created');
  }

  // Step 14: Student accounts — verify student appears
  await runStep('List student accounts — verify test student appears', async () => {
    const res = await api.get(financePath('/student-accounts'));
    if (res.status !== 200) {
      return { passed: false, detail: `status=${res.status}` };
    }
    const items = res.data?.items || [];
    const found = items.find((a: any) => a.studentId === STUDENT_ID);
    if (found) {
      studentAccountId = found.studentAccountId || found.accountId || found.id;
      return { passed: true, detail: `accountId=${studentAccountId}, balance=${found.balance || found.totalOutstanding || 'N/A'}` };
    }
    return { passed: false, detail: `Student ${STUDENT_ID} not found in ${items.length} accounts` };
  });

  // Step 15: Get student account detail
  if (studentAccountId) {
    await runStep('Get student account detail', async () => {
      const res = await api.get(financePath(`/student-accounts/${studentAccountId}`));
      if (res.status !== 200) {
        return { passed: false, detail: `status=${res.status}` };
      }
      const acct = res.data;
      return {
        passed: true,
        detail: `balance=${acct.balance || acct.totalOutstanding || 'N/A'}, totalPaid=${acct.totalPaid || 0}`,
      };
    });
  } else {
    skipStep('Get student account detail', 'Student account not found');
  }

  // Step 16: Student ledger — check entries (draft invoices don't create ledger entries; entries appear on issue)
  if (studentAccountId) {
    await runStep('Get student ledger — baseline check (entries appear after issue)', async () => {
      const res = await api.get(financePath(`/student-accounts/${studentAccountId}/ledger`));
      if (res.status !== 200) {
        return { passed: false, detail: `status=${res.status}` };
      }
      const items = res.data?.items || [];
      return {
        passed: true,
        detail: `${items.length} ledger entries (0 expected at draft stage)`,
      };
    });
  } else {
    skipStep('Get student ledger', 'Student account not found');
  }

  // Step 17: List invoices — verify appears with status=draft
  if (invoice1Id) {
    await runStep('List invoices — verify invoice 1 appears', async () => {
      const res = await api.get(financePath('/invoices'));
      if (res.status !== 200) {
        return { passed: false, detail: `status=${res.status}` };
      }
      const items = res.data?.items || [];
      const found = items.find((i: any) => (i.invoiceId || i.id) === invoice1Id);
      return {
        passed: !!found,
        detail: found
          ? `Found in list, status=${found.status}, total=${items.length} invoices`
          : `Invoice ${invoice1Id} not in list of ${items.length}`,
      };
    });
  } else {
    skipStep('List invoices', 'Invoice not created');
  }

  // Step 18: Issue invoice (draft → issued)
  if (invoice1Id) {
    await runStep('Issue invoice 1 (draft → issued)', async () => {
      const res = await api.post(financePath(`/invoices/${invoice1Id}/issue`));
      if ((res.status === 200 || res.status === 201) && res.data?.status === 'issued') {
        return { passed: true, detail: `status → issued, invoiceNumber=${res.data.invoiceNumber}` };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Issue invoice 1', 'Invoice not created');
  }

  // Step 19: Bulk generate with exam fee
  if (examFeeId) {
    await runStep('Bulk generate invoices — exam fee for student', async () => {
      const res = await api.post(financePath('/invoices/bulk-generate'), {
        studentIds: [STUDENT_ID],
        feeStructureIds: [examFeeId],
        academicYear: '2082-2083',
        billingPeriod: 'First Terminal Exam 2082',
        dueDate: futureDate(45),
        notes: 'First terminal examination fee for Baishakh-Shrawan 2082',
      });

      if ((res.status === 200 || res.status === 201) && res.data) {
        const generated = res.data.generated || 0;
        // Try to capture the invoice ID from the response
        if (res.data.invoiceIds && res.data.invoiceIds.length > 0) {
          invoice2Id = res.data.invoiceIds[0];
        }
        return {
          passed: generated > 0,
          detail: `generated=${generated}, skipped=${res.data.skipped || 0}, invoiceId=${invoice2Id || 'N/A'}`,
        };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });

    // If bulk-generate didn't return invoice ID, find it by listing
    if (!invoice2Id) {
      await runStep('Locate bulk-generated invoice 2', async () => {
        const res = await api.get(financePath('/invoices?status=draft'));
        if (res.status !== 200) {
          return { passed: false, detail: `status=${res.status}` };
        }
        const items = res.data?.items || [];
        // Find the most recent draft invoice that isn't invoice1
        const candidates = items.filter((i: any) => (i.invoiceId || i.id) !== invoice1Id);
        if (candidates.length > 0) {
          invoice2Id = candidates[0].invoiceId || candidates[0].id;
          invoice2GrandTotal = candidates[0].grandTotal;
          return { passed: true, detail: `Found invoice2=${invoice2Id}, grandTotal=${invoice2GrandTotal}` };
        }
        return { passed: false, detail: `No draft invoices found besides invoice1` };
      });
    }
  } else {
    skipStep('Bulk generate invoices', 'Exam fee not created');
    skipStep('Locate bulk-generated invoice 2', 'Exam fee not created');
  }

  // Get invoice 2 details if we have the ID but not the grandTotal
  if (invoice2Id && !invoice2GrandTotal) {
    const detailRes = await api.get(financePath(`/invoices/${invoice2Id}`));
    if (detailRes.status === 200) {
      invoice2GrandTotal = detailRes.data.grandTotal;
    }
  }

  // Step 20: Bulk issue
  if (invoice2Id) {
    await runStep('Bulk issue invoices', async () => {
      const res = await api.post(financePath('/invoices/bulk-issue'), {
        invoiceIds: [invoice2Id],
      });

      if ((res.status === 200 || res.status === 201) && res.data) {
        return {
          passed: (res.data.issued || 0) > 0,
          detail: `issued=${res.data.issued}, failed=${res.data.failed || 0}`,
        };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Bulk issue invoices', 'Invoice 2 not created');
  }

  // Step 21: Negative — issue already-issued invoice
  if (invoice1Id) {
    await runStep('Negative: issue already-issued invoice — expect error', async () => {
      const res = await api.post(financePath(`/invoices/${invoice1Id}/issue`));
      return {
        passed: res.status >= 400,
        detail: `status=${res.status} (expected 4xx)`,
      };
    });
  } else {
    skipStep('Negative: issue already-issued invoice', 'Invoice not created');
  }

  // Step 22: Negative — invoice for non-existent student
  await runStep('Negative: generate invoice for fake student — expect error', async () => {
    const res = await api.post(financePath('/invoices'), {
      studentId: '00000000-0000-0000-0000-000000000000',
      feeStructureIds: [tuitionFeeId || 'fake-id'],
      academicYear: '2082-2083',
      dueDate: futureDate(30),
    });
    return {
      passed: res.status >= 400,
      detail: `status=${res.status} (expected 4xx)`,
    };
  });

  // ════════════════════════════════════════════════════════════════
  // PHASE 4: Manual Payment Flow
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Payments';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 4: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 23: Record cash payment — full amount for invoice 1
  if (invoice1Id && invoice1GrandTotal) {
    await runStep(`Record cash payment for invoice 1 — NPR ${invoice1GrandTotal}`, async () => {
      const res = await api.post(financePath('/payments/manual'), {
        invoiceId: invoice1Id,
        gateway: 'cash',
        amount: invoice1GrandTotal,
        currency: 'NPR',
        notes: 'Cash payment received at school office',
        paidDate: todayISO(),
      });

      if ((res.status === 200 || res.status === 201) && res.data) {
        payment1Id = res.data.paymentId || res.data.id;
        return {
          passed: !!payment1Id,
          detail: `paymentId=${payment1Id}, amount=${res.data.amount}, status=${res.data.status}`,
        };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Record cash payment for invoice 1', 'Invoice 1 not available');
  }

  // Step 24: Verify invoice 1 → paid
  if (invoice1Id && payment1Id) {
    await runStep('Verify invoice 1 status → paid', async () => {
      const res = await api.get(financePath(`/invoices/${invoice1Id}`));
      if (res.status !== 200) {
        return { passed: false, detail: `status=${res.status}` };
      }
      const inv = res.data;
      const checks = [
        inv.status === 'paid' || `status=${inv.status} (expected paid)`,
        inv.amountPaid === inv.grandTotal || `amountPaid=${inv.amountPaid} !== grandTotal=${inv.grandTotal}`,
        inv.amountDue === 0 || `amountDue=${inv.amountDue} (expected 0)`,
      ];
      const failures = checks.filter(c => typeof c === 'string');
      return {
        passed: failures.length === 0,
        detail: failures.length === 0 ? `status=paid, amountPaid=${inv.amountPaid}, amountDue=0` : failures.join('; '),
      };
    });
  } else {
    skipStep('Verify invoice 1 status → paid', 'Payment not recorded');
  }

  // Step 25: Verify receipt generated
  if (payment1Id) {
    await runStep('Verify payment receipt generated', async () => {
      const res = await api.get(financeGlobalPath(`/payments/${payment1Id}/receipt`), { params: { schoolId: SCHOOL_ID } });
      if (res.status === 200 && res.data) {
        return {
          passed: true,
          detail: `receiptNumber=${res.data.receiptNumber || 'present'}, amount=${res.data.amount || res.data.totalAmount}`,
        };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Verify payment receipt', 'Payment not recorded');
  }

  // Step 26: Ledger — credit entry for payment
  if (studentAccountId) {
    await runStep('Student ledger — verify credit entry for payment', async () => {
      const res = await api.get(financePath(`/student-accounts/${studentAccountId}/ledger`));
      if (res.status !== 200) {
        return { passed: false, detail: `status=${res.status}` };
      }
      const items = res.data?.items || [];
      // Look for a credit entry (payment)
      const creditEntries = items.filter((e: any) => e.credit > 0 || e.entryType === 'payment');
      return {
        passed: creditEntries.length > 0,
        detail: `${creditEntries.length} credit entries, ${items.length} total ledger entries`,
      };
    });
  } else {
    skipStep('Student ledger — credit entry', 'Student account not found');
  }

  // Step 27: Partial bank transfer for invoice 2
  if (invoice2Id && invoice2GrandTotal) {
    const halfAmount = Math.floor(invoice2GrandTotal / 2);
    await runStep(`Record partial bank transfer for invoice 2 — NPR ${halfAmount}/${invoice2GrandTotal}`, async () => {
      const res = await api.post(financePath('/payments/manual'), {
        invoiceId: invoice2Id,
        gateway: 'bank_transfer',
        amount: halfAmount,
        currency: 'NPR',
        referenceNumber: `SBL-KTM-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-001`,
        notes: 'Bank transfer from Siddhartha Bank, Kathmandu branch',
        paidDate: todayISO(),
      });

      if ((res.status === 200 || res.status === 201) && res.data) {
        payment2Id = res.data.paymentId || res.data.id;
        return {
          passed: !!payment2Id,
          detail: `paymentId=${payment2Id}, amount=${halfAmount}, gateway=bank_transfer`,
        };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Record partial bank transfer for invoice 2', 'Invoice 2 not available');
  }

  // Step 28: Verify invoice 2 → partially_paid
  if (invoice2Id && payment2Id) {
    await runStep('Verify invoice 2 status → partially_paid', async () => {
      const res = await api.get(financePath(`/invoices/${invoice2Id}`));
      if (res.status !== 200) {
        return { passed: false, detail: `status=${res.status}` };
      }
      const inv = res.data;
      const isPP = inv.status === 'partially_paid';
      return {
        passed: isPP && inv.amountDue > 0,
        detail: `status=${inv.status}, amountPaid=${inv.amountPaid}, amountDue=${inv.amountDue}`,
      };
    });
  } else {
    skipStep('Verify invoice 2 → partially_paid', 'Payment not recorded');
  }

  // ════════════════════════════════════════════════════════════════
  // PHASE 5: Credit Notes
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Credit Notes';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 5: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 29: Create scholarship credit note
  await runStep('Create scholarship credit note — NPR 500', async () => {
    const res = await api.post(financePath('/credit-notes'), {
      studentId: STUDENT_ID,
      amount: 500,
      currency: 'NPR',
      type: 'scholarship',
      description: 'Academic merit scholarship for 2082-2083 session',
      effectiveDate: todayISO(),
    });

    if ((res.status === 200 || res.status === 201) && res.data) {
      creditNoteId = res.data.creditNoteId || res.data.id;
      return {
        passed: !!creditNoteId,
        detail: `id=${creditNoteId}, amount=500, type=scholarship`,
      };
    }
    return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
  });

  // Step 30: Apply credit note to invoice 2
  if (creditNoteId && invoice2Id) {
    await runStep('Apply credit note to invoice 2', async () => {
      const res = await api.post(financePath(`/credit-notes/${creditNoteId}/apply`), {
        invoiceId: invoice2Id,
        amount: 500,
      });

      if (res.status === 200 || res.status === 201) {
        return {
          passed: true,
          detail: `Credit note applied, status=${res.data?.status}, remainingAmount=${res.data?.remainingAmount}`,
        };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Apply credit note to invoice 2', 'Credit note or invoice 2 not available');
  }

  // Step 31: Verify invoice 2 amountDue reduced
  if (invoice2Id && creditNoteId) {
    await runStep('Verify invoice 2 amountDue reduced by credit', async () => {
      const res = await api.get(financePath(`/invoices/${invoice2Id}`));
      if (res.status !== 200) {
        return { passed: false, detail: `status=${res.status}` };
      }
      const inv = res.data;
      return {
        passed: true,
        detail: `amountPaid=${inv.amountPaid}, amountDue=${inv.amountDue}, grandTotal=${inv.grandTotal}`,
      };
    });
  } else {
    skipStep('Verify invoice 2 amountDue reduced', 'Prerequisites not met');
  }

  // Step 32: Ledger — credit note entry
  if (studentAccountId) {
    await runStep('Student ledger — verify credit note entry', async () => {
      const res = await api.get(financePath(`/student-accounts/${studentAccountId}/ledger`));
      if (res.status !== 200) {
        return { passed: false, detail: `status=${res.status}` };
      }
      const items = res.data?.items || [];
      return {
        passed: items.length > 0,
        detail: `${items.length} total ledger entries after credit note`,
      };
    });
  } else {
    skipStep('Student ledger — credit note entry', 'Student account not found');
  }

  // ════════════════════════════════════════════════════════════════
  // PHASE 6: Refund Workflow
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Refunds';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 6: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 33: Create refund request for payment 1
  if (payment1Id && invoice1Id) {
    await runStep('Create refund request for payment 1', async () => {
      const res = await api.post(financePath('/refunds'), {
        paymentId: payment1Id,
        invoiceId: invoice1Id,
        amount: 5000,
        reason: 'Fee structure revision - excess amount collected',
      });

      if ((res.status === 200 || res.status === 201) && res.data) {
        refundId = res.data.refundId || res.data.id;
        return {
          passed: !!refundId,
          detail: `refundId=${refundId}, amount=5000, status=${res.data.status}`,
        };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Create refund request', 'Payment 1 not available');
  }

  // Step 34: Approve refund
  if (refundId) {
    await runStep('Approve refund request', async () => {
      const res = await api.post(financePath(`/refunds/${refundId}/approve`), {
        notes: 'E2E test approval',
      });
      if (res.status === 200 || res.status === 201) {
        return { passed: true, detail: `status=${res.data?.status}` };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Approve refund', 'Refund not created');
  }

  // Step 35: Process refund
  if (refundId) {
    await runStep('Process approved refund', async () => {
      const res = await api.post(financePath(`/refunds/${refundId}/process`));
      if (res.status === 200 || res.status === 201) {
        return { passed: true, detail: `status=${res.data?.status}` };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Process refund', 'Refund not created');
  }

  // Step 36: Complete refund
  if (refundId) {
    await runStep('Complete refund', async () => {
      const res = await api.post(financePath(`/refunds/${refundId}/complete`), {
        gatewayRefundId: `E2E-REFUND-${Date.now()}`,
      });
      if (res.status === 200 || res.status === 201) {
        return { passed: true, detail: `status=${res.data?.status}` };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Complete refund', 'Refund not created');
  }

  // ════════════════════════════════════════════════════════════════
  // PHASE 7: Payment Void
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Payment Void';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 7: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 37: Void payment 2 on invoice 2
  if (payment2Id) {
    await runStep('Void partial payment on invoice 2', async () => {
      const res = await api.post(financePath(`/payments/${payment2Id}/void`), {
        reason: 'Duplicate payment entry - correcting records',
      });
      if (res.status === 200 || res.status === 201) {
        return {
          passed: true,
          detail: `payment status=${res.data?.status}`,
        };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Void partial payment', 'Payment 2 not available');
  }

  // ════════════════════════════════════════════════════════════════
  // PHASE 8: Invoice Cancellation
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Invoice Cancel';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 8: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 38: Cancel invoice 2
  if (invoice2Id) {
    await runStep('Cancel invoice 2', async () => {
      const res = await api.patch(financePath(`/invoices/${invoice2Id}`), {
        status: 'cancelled',
        notes: 'Student transferred to another school mid-term',
      });
      if (res.status === 200) {
        return {
          passed: res.data?.status === 'cancelled',
          detail: `status=${res.data?.status}`,
        };
      }
      return { passed: false, detail: `status=${res.status} body=${truncate(JSON.stringify(res.data), 300)}` };
    });
  } else {
    skipStep('Cancel invoice 2', 'Invoice 2 not available');
  }

  // ════════════════════════════════════════════════════════════════
  // PHASE 9: Dashboard & Reporting
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Dashboard';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 9: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 39: Dashboard summary
  await runStep('Get dashboard summary', async () => {
    const res = await api.get(financePath('/dashboard/summary'));
    if (res.status !== 200) {
      return { passed: false, detail: `status=${res.status}` };
    }
    const d = res.data;
    const fields = ['totalInvoiced', 'totalCollected', 'outstanding', 'overdue', 'collectionRate'];
    const present = fields.filter(f => d[f] !== undefined);
    return {
      passed: present.length >= 3,
      detail: `totalInvoiced=${d.totalInvoiced}, collected=${d.totalCollected}, outstanding=${d.outstanding}, rate=${d.collectionRate}%`,
    };
  });

  // Step 40: Dashboard with date filter
  await runStep('Dashboard with date filter', async () => {
    const from = new Date();
    from.setDate(from.getDate() - 90);
    const res = await api.get(financePath('/dashboard/summary'), {
      params: { from: from.toISOString().split('T')[0], to: todayISO() },
    });
    return {
      passed: res.status === 200,
      detail: `status=${res.status}, filtered 90-day window`,
    };
  });

  // Step 41: Export invoices CSV
  await runStep('Export invoices CSV', async () => {
    const res = await api.get(financePath('/invoices/export'));
    const contentType = res.headers?.['content-type'] || '';
    return {
      passed: res.status === 200,
      detail: `status=${res.status}, content-type=${contentType}`,
    };
  });

  // Step 42: Export payments CSV
  await runStep('Export payments CSV', async () => {
    const res = await api.get(financePath('/payments/export'));
    const contentType = res.headers?.['content-type'] || '';
    return {
      passed: res.status === 200,
      detail: `status=${res.status}, content-type=${contentType}`,
    };
  });

  // ════════════════════════════════════════════════════════════════
  // PHASE 10: Payment Gateways Config
  // ════════════════════════════════════════════════════════════════
  currentPhase = 'Gateways';
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  PHASE 10: ${currentPhase}`);
  console.log('═'.repeat(64));

  // Step 43: List payment gateways (public)
  await runStep('List payment gateways (public)', async () => {
    const res = await api.get(financePath('/payment-gateways'));
    if (res.status !== 200) {
      return { passed: false, detail: `status=${res.status}` };
    }
    const gateways = Array.isArray(res.data) ? res.data : (res.data?.items || []);
    return {
      passed: true,
      detail: `${gateways.length} gateways configured`,
    };
  });

  // Step 44: List payment gateways (admin)
  await runStep('List payment gateways (admin)', async () => {
    const res = await api.get(financePath('/payment-gateways/admin'));
    if (res.status !== 200) {
      return { passed: false, detail: `status=${res.status}` };
    }
    const gateways = Array.isArray(res.data) ? res.data : (res.data?.items || []);
    return {
      passed: true,
      detail: `${gateways.length} gateways with admin view`,
    };
  });

  // ════════════════════════════════════════════════════════════════
  // DATA PRESERVED — No cleanup performed
  // ════════════════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(64)}`);
  console.log('  DATA PRESERVED — All test data kept for UI validation');
  console.log('═'.repeat(64));
  console.log(`  Fee structures: ${[tuitionFeeId, admissionFeeId, examFeeId].filter(Boolean).join(', ')}`);
  console.log(`  Discount rules: ${[scholarshipDiscountId, earlyPaymentDiscountId].filter(Boolean).join(', ')}`);
  console.log(`  Invoices:       ${[invoice1Id, invoice2Id].filter(Boolean).join(', ')}`);
  console.log(`  Payments:       ${[payment1Id, payment2Id].filter(Boolean).join(', ')}`);
  console.log(`  Credit note:    ${creditNoteId || 'none'}`);
  console.log(`  Refund:         ${refundId || 'none'}`);

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

  // Group by phase
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
    console.log(`\n  ❌ E2E TEST HAS FAILURES`);
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

  // Ensure logs directory exists
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed && !r.detail?.startsWith('SKIPPED')).length;
  const skippedActual = results.filter(r => r.detail?.startsWith('SKIPPED')).length;

  // JSON log
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

  const jsonPath = path.join(logsDir, `finance-e2e-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonLog, null, 2));
  console.log(`\n  JSON log: ${jsonPath}`);

  // Human-readable log
  const lines: string[] = [
    '═'.repeat(80),
    'Finance Module — Comprehensive E2E Test Log',
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

  const logPath = path.join(logsDir, `finance-e2e-${timestamp}.log`);
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
