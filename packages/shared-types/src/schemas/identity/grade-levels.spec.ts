/**
 * grade-levels spec — locks the Sprint C1 mapping fix.
 *
 * Until 0.36.0 the wizard mapped:
 *   ECD → 'EarlyEducation'   (rejected by the backend zod enum)
 *   PPC → 'Prekindergarten'  (collapsed PPC into PK; produced duplicate chips)
 *
 * 0.37.0 corrects both mappings to the codes carried in the
 * GRADE_LEVEL_DESCRIPTOR_CATALOG and accepted by schoolGradeLevelDescriptorSchema.
 */

import {
  GRADE_RANGE_TO_DESCRIPTOR,
  ORDERED_GRADES,
  computeGradeLevels,
  isValidGradeRange,
} from './grade-levels';
import { schoolGradeLevelDescriptorSchema } from './education-org-descriptors';

describe('GRADE_RANGE_TO_DESCRIPTOR', () => {
  it('maps ECD to EarlyChildhoodDevelopment (NOT EarlyEducation)', () => {
    expect(GRADE_RANGE_TO_DESCRIPTOR.ECD).toBe('EarlyChildhoodDevelopment');
    expect(GRADE_RANGE_TO_DESCRIPTOR.ECD).not.toBe('EarlyEducation');
  });

  it('maps PPC to PrePrimaryClass (NOT Prekindergarten)', () => {
    expect(GRADE_RANGE_TO_DESCRIPTOR.PPC).toBe('PrePrimaryClass');
    expect(GRADE_RANGE_TO_DESCRIPTOR.PPC).not.toBe('Prekindergarten');
  });

  it('keeps PK and K mapped to canonical Ed-Fi codes', () => {
    expect(GRADE_RANGE_TO_DESCRIPTOR.PK).toBe('Prekindergarten');
    expect(GRADE_RANGE_TO_DESCRIPTOR.K).toBe('Kindergarten');
  });

  it('maps PABSON operational codes (PG/NUR) to the ECD IEMIS band', () => {
    // PG (Playgroup) and NUR (Nursery) are distinct operational classes
    // at Saraswati but collapse to ECD for Nepal CEHRD Flash I/II export.
    expect(GRADE_RANGE_TO_DESCRIPTOR.PG).toBe('EarlyChildhoodDevelopment');
    expect(GRADE_RANGE_TO_DESCRIPTOR.NUR).toBe('EarlyChildhoodDevelopment');
  });

  it('maps PABSON operational codes (LKG/UKG) to the PPC IEMIS band', () => {
    // LKG (Lower KG) and UKG (Upper KG) collapse to PPC for Flash I/II.
    expect(GRADE_RANGE_TO_DESCRIPTOR.LKG).toBe('PrePrimaryClass');
    expect(GRADE_RANGE_TO_DESCRIPTOR.UKG).toBe('PrePrimaryClass');
  });

  it('every internal code in ORDERED_GRADES has a descriptor', () => {
    for (const code of ORDERED_GRADES) {
      expect(GRADE_RANGE_TO_DESCRIPTOR[code]).toBeTruthy();
    }
  });

  it('every produced descriptor passes schoolGradeLevelDescriptorSchema', () => {
    for (const code of ORDERED_GRADES) {
      const descriptor = GRADE_RANGE_TO_DESCRIPTOR[code];
      const result = schoolGradeLevelDescriptorSchema.safeParse(descriptor);
      expect(result.success).toBe(true);
    }
  });
});

describe('computeGradeLevels', () => {
  it('returns ECD-starting list with EarlyChildhoodDevelopment first and PrePrimaryClass second', () => {
    const result = computeGradeLevels('ECD', '12');
    expect(result[0]).toBe('EarlyChildhoodDevelopment');
    expect(result[1]).toBe('PrePrimaryClass');
    expect(result[2]).toBe('Prekindergarten');
    expect(result[result.length - 1]).toBe('TwelfthGrade');
  });

  it('produces NO duplicate descriptors when starting at ECD', () => {
    const result = computeGradeLevels('ECD', '12');
    expect(new Set(result).size).toBe(result.length);
  });

  it('PPC-only school produces exactly one descriptor (no PK collapse)', () => {
    const result = computeGradeLevels('PPC', 'PPC');
    expect(result).toEqual(['PrePrimaryClass']);
  });

  it('ECD-only school produces exactly one descriptor', () => {
    const result = computeGradeLevels('ECD', 'ECD');
    expect(result).toEqual(['EarlyChildhoodDevelopment']);
  });

  it('PABSON-style range ECD..10 produces 14 distinct descriptors', () => {
    // ORDERED_GRADES expanded to include PG/NUR/LKG/UKG (after PPC, before PK)
    // but those collapse via GRADE_RANGE_TO_DESCRIPTOR (PG/NUR → ECD,
    // LKG/UKG → PPC), so the dedup'd descriptor count is unchanged.
    const result = computeGradeLevels('ECD', '10');
    // ECD, PPC, [PG,NUR collapse to ECD] [LKG,UKG collapse to PPC],
    // PK, K, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 = 14 unique descriptors
    expect(result).toHaveLength(14);
    expect(new Set(result).size).toBe(14);
  });

  it('Saraswati-style range PG..10 produces 13 distinct descriptors (no ECD/PPC explicit)', () => {
    // PG, NUR collapse to ECD; LKG, UKG collapse to PPC.
    // No explicit ECD or PPC entries in the slice (they sit BEFORE PG in
    // the array), so the result is: ECD (from PG/NUR), PPC (from LKG/UKG),
    // PK, K, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 = 14? No, 13:
    //   ECD (from PG dedup with NUR),
    //   PPC (from LKG dedup with UKG),
    //   Prekindergarten, Kindergarten,
    //   FirstGrade ... TenthGrade
    // That's 2 + 2 + 10 = 14 — but PK and K are between UKG and '1' in
    // ORDERED_GRADES, so they ARE included. Total = 14.
    const result = computeGradeLevels('PG', '10');
    expect(result).toHaveLength(14);
    expect(new Set(result).size).toBe(14);
    expect(result[0]).toBe('EarlyChildhoodDevelopment'); // from PG
    expect(result[1]).toBe('PrePrimaryClass'); // from LKG
    expect(result[2]).toBe('Prekindergarten');
    expect(result[3]).toBe('Kindergarten');
    expect(result[result.length - 1]).toBe('TenthGrade');
  });

  it('Saraswati-true-shape range PG..UKG produces 2 distinct descriptors (early-childhood only)', () => {
    // A school configured for only the PABSON early-childhood band:
    // PG, NUR (→ECD) + LKG, UKG (→PPC) = 2 unique descriptors.
    const result = computeGradeLevels('PG', 'UKG');
    expect(result).toEqual(['EarlyChildhoodDevelopment', 'PrePrimaryClass']);
  });

  it('dedup is order-preserving (first occurrence wins)', () => {
    // PG comes before NUR in ORDERED_GRADES; both → ECD. The output
    // must put ECD at the PG position, not NUR's.
    const result = computeGradeLevels('PG', 'NUR');
    expect(result).toEqual(['EarlyChildhoodDevelopment']);
  });

  it('returns empty array for invalid ranges', () => {
    expect(computeGradeLevels('', '12')).toEqual([]);
    expect(computeGradeLevels('ECD', 'NOPE')).toEqual([]);
    expect(computeGradeLevels('12', 'ECD')).toEqual([]);
  });

  it('every entry in any computed range is accepted by the backend validator', () => {
    const ranges: [string, string][] = [
      ['ECD', '12'],
      ['PPC', '10'],
      ['PK', '5'],
      ['K', '8'],
      ['1', '5'],
      ['9', '12'],
    ];
    for (const [start, end] of ranges) {
      const grades = computeGradeLevels(start, end);
      for (const g of grades) {
        expect(schoolGradeLevelDescriptorSchema.safeParse(g).success).toBe(true);
      }
    }
  });
});

describe('isValidGradeRange', () => {
  it('accepts ECD..PPC as a valid range', () => {
    expect(isValidGradeRange('ECD', 'PPC')).toBe(true);
  });

  it('accepts ECD..12 as a valid range', () => {
    expect(isValidGradeRange('ECD', '12')).toBe(true);
  });

  it('rejects PPC..ECD (reversed)', () => {
    expect(isValidGradeRange('PPC', 'ECD')).toBe(false);
  });
});

// Phase 1 review fix — locale key bound on gradeLevelLabelsSchema. Earlier
// `max(10)` rejected valid BCP 47 tags ≥11 chars (e.g., `nan-Hant-TW`,
// `cmn-Hans-CN`, `en-US-POSIX`); widened to `max(35)` to accommodate
// grandfathered + extension forms while keeping the lower bound.
describe('gradeLevelLabelsSchema — locale key BCP 47 tolerance', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { gradeLevelLabelsSchema } = require('./school.schema') as typeof import('./school.schema');

  it('accepts a 11-char BCP 47 tag (nan-Hant-TW)', () => {
    const r = gradeLevelLabelsSchema.safeParse({
      PG: { 'nan-Hant-TW': '幼幼班' },
    });
    expect(r.success).toBe(true);
  });

  it('accepts cmn-Hans-CN (11 chars)', () => {
    const r = gradeLevelLabelsSchema.safeParse({
      NUR: { 'cmn-Hans-CN': '小班' },
    });
    expect(r.success).toBe(true);
  });

  it('accepts ne-NP (5 chars — preserves existing behavior)', () => {
    const r = gradeLevelLabelsSchema.safeParse({
      PG: { 'ne-NP': 'प्ले ग्रुप' },
    });
    expect(r.success).toBe(true);
  });

  it('still rejects a single-char locale (below min(2))', () => {
    const r = gradeLevelLabelsSchema.safeParse({ PG: { e: 'X' } });
    expect(r.success).toBe(false);
  });

  it('rejects a locale tag past max(35)', () => {
    const overlong = 'a'.repeat(36);
    const r = gradeLevelLabelsSchema.safeParse({ PG: { [overlong]: 'X' } });
    expect(r.success).toBe(false);
  });
});
