import { feeAppliesToGrade, partitionFeesByGrade } from './fee-applicability';

const fee = (id: string, gradeLevels: string[]) => ({ id, gradeLevels });

describe('fee-applicability (#477)', () => {
  describe('feeAppliesToGrade', () => {
    it('applies a grade-scoped fee to a listed grade', () => {
      expect(feeAppliesToGrade(fee('a', ['2']), '2')).toBe(true);
    });

    it('does not apply a grade-scoped fee to an unlisted grade', () => {
      expect(feeAppliesToGrade(fee('a', ['2']), '9')).toBe(false);
    });

    it('applies an unscoped fee to every grade', () => {
      expect(feeAppliesToGrade(fee('a', []), '9')).toBe(true);
    });

    it('applies when the grade is unknown, rather than dropping the fee', () => {
      expect(feeAppliesToGrade(fee('a', ['2']), undefined)).toBe(true);
      expect(feeAppliesToGrade(fee('a', ['2']), '')).toBe(true);
    });

    it('matches grade codes exactly — no prefix or numeric coercion', () => {
      expect(feeAppliesToGrade(fee('a', ['1']), '10')).toBe(false);
      expect(feeAppliesToGrade(fee('a', ['10']), '1')).toBe(false);
    });

    it('honours non-numeric local grade codes', () => {
      expect(feeAppliesToGrade(fee('a', ['ECD', 'PPC']), 'PPC')).toBe(true);
      expect(feeAppliesToGrade(fee('a', ['ECD', 'PPC']), 'NUR')).toBe(false);
    });
  });

  describe('partitionFeesByGrade', () => {
    // The exact shape that produced #477: grade-2 and grade-3 tuition
    // selected for a cohort containing grade 5 and grade 9 students.
    const g2 = fee('g2', ['2']);
    const g3 = fee('g3', ['3']);
    const all = fee('uniform', []);

    it('keeps only the fees the grade allows', () => {
      const { applicable, excluded, gradeResolved } = partitionFeesByGrade([g2, g3], '2');
      expect(applicable).toEqual([g2]);
      expect(excluded).toEqual([g3]);
      expect(gradeResolved).toBe(true);
    });

    it('excludes every fee when the grade matches none', () => {
      const { applicable, excluded } = partitionFeesByGrade([g2, g3], '9');
      expect(applicable).toEqual([]);
      expect(excluded).toEqual([g2, g3]);
    });

    it('keeps unscoped fees alongside grade-scoped ones', () => {
      const { applicable } = partitionFeesByGrade([g2, g3, all], '9');
      expect(applicable).toEqual([all]);
    });

    it('preserves input order in the applicable set', () => {
      const { applicable } = partitionFeesByGrade([all, g2, g3], '2');
      expect(applicable.map(f => f.id)).toEqual(['uniform', 'g2']);
    });

    it('reports gradeResolved:false and keeps everything when grade is unknown', () => {
      const { applicable, excluded, gradeResolved } = partitionFeesByGrade([g2, g3], undefined);
      expect(applicable).toEqual([g2, g3]);
      expect(excluded).toEqual([]);
      expect(gradeResolved).toBe(false);
    });

    it('does not mutate the input array', () => {
      const input = [g2, g3];
      partitionFeesByGrade(input, '2');
      expect(input).toEqual([g2, g3]);
    });

    it('handles an empty fee list', () => {
      const { applicable, excluded } = partitionFeesByGrade([], '2');
      expect(applicable).toEqual([]);
      expect(excluded).toEqual([]);
    });
  });
});
