/**
 * S1.9 — finance generator (fee structures + invoices + payments).
 */

import { loadRosterConfig } from './roster-config';
import { generateAcademicFoundation } from './generate-academic-foundation';
import { generateSections } from './generate-sections';
import { generateStudents } from './generate-students';
import { generateFinance } from './generate-finance';
import { createRng } from './synthetic-identity';

function build(archetype: 'PABSON' | 'GENERIC') {
  const config = loadRosterConfig(archetype);
  const { academicYear } = generateAcademicFoundation(config);
  const sections = generateSections(config);
  const students = generateStudents(config, createRng(`${archetype}:students`), sections);
  const finance = generateFinance(config, createRng(`${archetype}:finance`), academicYear, students);
  return { config, academicYear, students, ...finance };
}

describe.each(['PABSON', 'GENERIC'] as const)('finance — %s', (archetype) => {
  const { config, students, feeStructures, invoices, payments } = build(archetype);

  it('is deterministic for a fixed seed', () => {
    const rebuilt = build(archetype);
    expect(rebuilt.feeStructures).toEqual(feeStructures);
    expect(rebuilt.invoices).toEqual(invoices);
    expect(rebuilt.payments).toEqual(payments);
  });

  describe('fee structures', () => {
    it('has one grade-scaled tuition per grade + the flat fees', () => {
      const tuition = feeStructures.filter((f) => f.feeType === 'tuition');
      expect(tuition).toHaveLength(config.gradeLevels.length);
      const flat = feeStructures.filter((f) => f.appliesToAllGrades);
      expect(flat).toHaveLength(config.fees.flatFees.length);
    });

    it('tuition scales with grade (base + increment*index)', () => {
      config.gradeLevels.forEach((g, idx) => {
        const fee = feeStructures.find((f) => f.feeType === 'tuition' && f.gradeCode === g.code);
        expect(fee?.amount).toBe(
          config.fees.tuition.baseAmount + config.fees.tuition.perGradeIncrement * idx,
        );
      });
    });
  });

  describe('invoices', () => {
    it('one per student, total = grade tuition + flat fees', () => {
      expect(invoices).toHaveLength(students.length);
      const flatSum = config.fees.flatFees.reduce((s, f) => s + f.amount, 0);
      const tuitionByGrade = new Map(
        feeStructures.filter((f) => f.feeType === 'tuition').map((f) => [f.gradeCode, f.amount]),
      );
      for (const inv of invoices) {
        expect(inv.totalAmount).toBe((tuitionByGrade.get(inv.gradeCode) ?? 0) + flatSum);
        expect(inv.feeStructureRefs.length).toBe(1 + config.fees.flatFees.length);
      }
    });

    it('due dates are after the AY start', () => {
      for (const inv of invoices) {
        expect(inv.dueDate > config.academicYear.startDate).toBe(true);
      }
    });
  });

  describe('payments', () => {
    it('paid settles fully, partial is a strict fraction, none exceed the invoice', () => {
      const totalByInvoice = new Map(invoices.map((i) => [i.ref, i.totalAmount]));
      for (const p of payments) {
        const total = totalByInvoice.get(p.invoiceRef)!;
        expect(p.amount).toBeGreaterThan(0);
        expect(p.amount).toBeLessThanOrEqual(total);
        if (p.settlement === 'paid') expect(p.amount).toBe(total);
        if (p.settlement === 'partial') expect(p.amount).toBeLessThan(total);
        expect(['cash', 'bank_transfer', 'cheque']).toContain(p.gateway);
      }
    });

    it('payment outcome mix is close to the configured distribution', () => {
      const paid = payments.filter((p) => p.settlement === 'paid').length;
      const partial = payments.filter((p) => p.settlement === 'partial').length;
      const unpaid = invoices.length - payments.length;
      const n = invoices.length;
      const tol = 0.15;
      expect(Math.abs(paid / n - config.fees.paymentMix.paidPct / 100)).toBeLessThan(tol);
      expect(Math.abs(partial / n - config.fees.paymentMix.partialPct / 100)).toBeLessThan(tol);
      expect(Math.abs(unpaid / n - config.fees.paymentMix.unpaidPct / 100)).toBeLessThan(tol);
    });

    it('ledger reconciles: payment ⊆ invoices, no invoice over-paid', () => {
      const invoiceRefs = new Set(invoices.map((i) => i.ref));
      const perInvoice = new Map<string, number>();
      for (const p of payments) {
        expect(invoiceRefs.has(p.invoiceRef)).toBe(true);
        perInvoice.set(p.invoiceRef, (perInvoice.get(p.invoiceRef) ?? 0) + p.amount);
      }
      for (const [ref, sum] of perInvoice) {
        expect(sum).toBeLessThanOrEqual(totalOf(invoices, ref));
      }
    });
  });
});

function totalOf(invoices: { ref: string; totalAmount: number }[], ref: string): number {
  return invoices.find((i) => i.ref === ref)!.totalAmount;
}
