import { agreementReplacementLines, findAgreementInvoiceConflict } from './invoices.service';

/**
 * Issue #465 — the bulk-generate preview priced agreement-covered students
 * at catalog rates, so a family on a NPR 20,000 agreement previewed at
 * NPR 33,000, and it reported 0 duplicates for students the once-per-term
 * guard would reject outright.
 *
 * The money math is now shared with the generate path
 * (`agreementReplacementLines`) so the preview and the bill cannot drift,
 * and the once-per-term question is asked without throwing
 * (`findAgreementInvoiceConflict`).
 */

describe('agreementReplacementLines — one source for preview and bill (#465)', () => {
  const fixedTotal = {
    title: 'Chaudhary siblings',
    terms: { agreementType: 'fixed_total' as const, totalAmount: 20000 },
  };

  it('replaces the catalog fee with the student allocation, not the catalog price', () => {
    const lines = agreementReplacementLines(fixedTotal, 12000, 'student-a', ['tuition']);
    expect(lines).toEqual([
      { description: 'Chaudhary siblings (family agreement)', amount: 12000 },
    ]);
  });

  it('reproduces the reported case: 12,000 + 8,000 rather than 18,000 + 15,000', () => {
    const a = agreementReplacementLines(fixedTotal, 12000, 'student-a', ['tuition']);
    const b = agreementReplacementLines(fixedTotal, 8000, 'student-b', ['tuition']);
    const total = [...a, ...b].reduce((s, l) => s + l.amount, 0);
    expect(total).toBe(20000);
  });

  it('suppresses without replacing when the member has no allocation', () => {
    expect(agreementReplacementLines(fixedTotal, null, 'student-a', ['tuition'])).toEqual([]);
  });

  it('rounds to two decimals', () => {
    const lines = agreementReplacementLines(fixedTotal, 1234.567, 'student-a', ['tuition']);
    expect(lines[0].amount) .toBe(1234.57);
  });

  describe('per_student terms', () => {
    const perStudent = {
      title: 'Sharma siblings',
      terms: {
        agreementType: 'per_student' as const,
        lines: [
          { studentId: 'student-a', feeType: 'tuition', amount: 9000 },
          { studentId: 'student-a', feeType: 'transport', amount: 500 },
          { studentId: 'student-b', feeType: 'tuition', amount: 7000 },
          { studentId: 'student-a', amount: 100 }, // lump sum: no feeType
        ],
      },
    };

    it('takes only this student\'s lines for the covered fee types', () => {
      const lines = agreementReplacementLines(perStudent, null, 'student-a', ['tuition']);
      expect(lines).toEqual([
        { feeType: 'tuition', description: 'Sharma siblings — tuition (family agreement)', amount: 9000 },
      ]);
    });

    it('sums several covered types for the same student', () => {
      const lines = agreementReplacementLines(perStudent, null, 'student-a', ['tuition', 'transport']);
      expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(9500);
    });

    it('never matches a lump-sum line that carries no fee type', () => {
      const lines = agreementReplacementLines(perStudent, null, 'student-a', ['tuition', 'transport']);
      expect(lines.every(l => l.feeType !== undefined)).toBe(true);
    });

    it('ignores a covered type the student has no line for', () => {
      expect(agreementReplacementLines(perStudent, null, 'student-b', ['transport'])).toEqual([]);
    });
  });
});

describe('findAgreementInvoiceConflict — asked without throwing (#465)', () => {
  const live = (over: Record<string, unknown> = {}) => ({
    invoiceId: 'inv-1', invoiceNumber: 'INV-1', status: 'issued',
    agreementChainId: 'chain-1', agreementId: 'agr-2', ...over,
  });

  it('matches on the version chain, so a new version still blocks', () => {
    const found = findAgreementInvoiceConflict([live()], 'agr-9', 'chain-1');
    expect(found?.invoiceId).toBe('inv-1');
  });

  it('falls back to the per-version id for rows with no chain', () => {
    const found = findAgreementInvoiceConflict(
      [live({ agreementChainId: undefined })], 'agr-2', 'chain-9',
    );
    expect(found?.invoiceId).toBe('inv-1');
  });

  it('ignores cancelled and written-off invoices', () => {
    for (const status of ['cancelled', 'written_off']) {
      expect(findAgreementInvoiceConflict([live({ status })], 'agr-2', 'chain-1')).toBeUndefined();
    }
  });

  it('returns undefined when nothing matches, rather than throwing', () => {
    expect(findAgreementInvoiceConflict([], 'agr-2', 'chain-1')).toBeUndefined();
    expect(
      findAgreementInvoiceConflict([live({ agreementChainId: 'other', agreementId: 'other' })], 'agr-2', 'chain-1'),
    ).toBeUndefined();
  });
});
