/**
 * Finance generator — Sprint S1.9.
 *
 * Grade-scaled tuition + fleet-wide flat fees become fee structures; every
 * student gets an invoice rolling up their grade's tuition + the flat fees;
 * and the configured paid / partial / unpaid mix becomes payments. Amounts
 * are whole units of `config.currency`; the loader sends that currency
 * explicitly on fee-structure create (the create schema otherwise defaults
 * it to NPR at the validation boundary).
 */

import type { DemoRosterConfig } from './roster-config';
import type {
  DemoAcademicYear,
  DemoFeeStructure,
  DemoInvoice,
  DemoPayment,
  DemoStudent,
} from './generated-types';
import type { Rng } from './synthetic-identity';

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface FinanceData {
  feeStructures: DemoFeeStructure[];
  invoices: DemoInvoice[];
  payments: DemoPayment[];
}

export function generateFinance(
  config: DemoRosterConfig,
  rng: Rng,
  academicYear: DemoAcademicYear,
  students: DemoStudent[],
): FinanceData {
  // 1. Fee structures: grade-scaled tuition + fleet-wide flat fees.
  const feeStructures: DemoFeeStructure[] = [];
  const tuitionByGrade = new Map<string, DemoFeeStructure>();
  config.gradeLevels.forEach((grade, idx) => {
    const fee: DemoFeeStructure = {
      ref: `fee:tuition:${grade.code}`,
      name: `${grade.label} Tuition`,
      feeType: 'tuition',
      frequency: 'annual',
      amount: config.fees.tuition.baseAmount + config.fees.tuition.perGradeIncrement * idx,
      gradeCode: grade.code,
      appliesToAllGrades: false,
    };
    feeStructures.push(fee);
    tuitionByGrade.set(grade.code, fee);
  });
  const flatFees: DemoFeeStructure[] = config.fees.flatFees.map((f, i) => ({
    ref: `fee:flat:${i}-${f.feeType}`,
    name: f.name,
    feeType: f.feeType,
    frequency: f.frequency,
    amount: f.amount,
    appliesToAllGrades: true,
  }));
  feeStructures.push(...flatFees);

  // 2. Invoices: one per student rolling up grade tuition + flat fees.
  const dueDate = addDays(academicYear.startDate, 30);
  const invoices: DemoInvoice[] = students.map((student) => {
    const tuition = tuitionByGrade.get(student.gradeCode);
    const applicable = [...(tuition ? [tuition] : []), ...flatFees];
    return {
      ref: `invoice:${student.ref}`,
      studentRef: student.ref,
      gradeCode: student.gradeCode,
      feeStructureRefs: applicable.map((f) => f.ref),
      dueDate,
      totalAmount: applicable.reduce((s, f) => s + f.amount, 0),
    };
  });

  // 3. Payments: paid / partial / unpaid per the configured mix.
  const { paidPct, partialPct, unpaidPct } = config.fees.paymentMix;
  const gateways = ['cash', 'bank_transfer', 'cheque'] as const;
  const paidDate = addDays(academicYear.startDate, 20);
  const payments: DemoPayment[] = [];
  for (const invoice of invoices) {
    const outcome = rng.weighted([
      ['paid', paidPct],
      ['partial', partialPct],
      ['unpaid', unpaidPct],
    ] as const);
    if (outcome === 'unpaid') continue;
    const amount =
      outcome === 'paid'
        ? invoice.totalAmount
        : Math.max(1, Math.round((invoice.totalAmount * rng.int(30, 70)) / 100));
    payments.push({
      ref: `payment:${invoice.ref}`,
      invoiceRef: invoice.ref,
      amount,
      gateway: rng.pick(gateways),
      paidDate,
      settlement: outcome,
    });
  }

  return { feeStructures, invoices, payments };
}
