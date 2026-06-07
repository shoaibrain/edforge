import { deriveReportingEndStatus } from './academic-status-source';
import { computeAcademicStatus } from './transforms';

/** End-to-end: the derived token must map to the right IEMIS enum value. */
function statusFor(
  decision: string | undefined,
  exitType: string | undefined,
  status?: string,
): string {
  return computeAcademicStatus(deriveReportingEndStatus(decision, exitType, status));
}

describe('deriveReportingEndStatus → computeAcademicStatus (IEMIS academic_status)', () => {
  describe('promotion decision is the canonical source (close-year writes uniform exitWithdrawType)', () => {
    it.each([
      // [promotionDecision, exitWithdrawType, expected IEMIS status]
      ['promoted', 'End of school year', 'Passed'],
      ['conditional', 'End of school year', 'Passed'], // V1 treats conditional as promoted
      ['graduated', 'End of school year', 'Passed'],
      ['retained', 'End of school year', 'Repeated'],
      ['withdrawn', 'End of school year', 'Dropout'],
      ['transferred_out', 'End of school year', 'Passed & Transfer'],
    ])('decision %s + "End of school year" → %s', (decision, exit, expected) => {
      expect(statusFor(decision, exit)).toBe(expected);
    });
  });

  describe('transfer combines with the outcome', () => {
    it.each([
      ['promoted', 'Transferred', 'Passed & Transfer'],
      ['retained', 'Transferred', 'Repeated & Transfer'],
    ])('decision %s + Transferred → %s', (decision, exit, expected) => {
      expect(statusFor(decision, exit)).toBe(expected);
    });
  });

  describe('mid/end-year dropout', () => {
    it.each([
      ['promoted', 'Dropped out', 'Dropout'],
      [undefined, 'Dropped out', 'Dropout'],
    ])('decision %s + Dropped out → Dropout', (decision, exit, expected) => {
      expect(statusFor(decision, exit)).toBe(expected);
    });
  });

  describe('explicit-withdraw fallback (no promotion decision) — the path MAC smoke-tested', () => {
    it('exitWithdrawType "Promoted" with no decision → Passed', () => {
      expect(statusFor(undefined, 'Promoted')).toBe('Passed');
    });
    it('bare "End of school year" with no decision → blank (graceful)', () => {
      expect(deriveReportingEndStatus(undefined, 'End of school year', 'graduated')).toBe('');
      expect(statusFor(undefined, 'End of school year', 'graduated')).toBe('');
    });
  });
});
