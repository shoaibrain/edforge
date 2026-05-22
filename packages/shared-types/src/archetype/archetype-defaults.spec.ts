/**
 * Spec for the Sprint 0.4 ArchetypeDefaults data table.
 *
 * Covers:
 *   - PABSON + GENERIC are both registered in the table
 *   - Each profile passes the Zod schema (boardExams sum-to-1 refinement,
 *     letterGrades sorted, complianceForms SCREAMING_SNAKE_CASE, etc.)
 *   - v3.4.1 H2: PABSON.letterGrades includes NG with isTerminalFail=true,
 *     gpaPoints=0, isPassing=false
 *   - v3.4 E.1.0 §7: PABSON.complianceForms does NOT include FORM_19/etc.
 *   - v3.4 D.4.0 §7.2: BLE row carries hasSupplementary=true + maxNgForSupplementary=3
 *   - v3.4 A.2.0: PABSON.primaryCurriculumRef = 'CDC_NCF_2076'
 *   - getArchetypeDefaults throws ARCHETYPE_NOT_FOUND on unknown archetype
 *     (fail-loud, unlike activation-requirements which fails-soft to GENERIC)
 */

import {
  ARCHETYPE_DEFAULTS_TABLE,
  getArchetypeDefaults,
} from './archetype-defaults';
import { archetypeDefaultsSchema } from '../schemas/archetype-defaults.schema';

const ACTIVE_ARCHETYPES = ['PABSON', 'GENERIC'] as const;

describe('ARCHETYPE_DEFAULTS_TABLE — registry completeness', () => {
  it.each(ACTIVE_ARCHETYPES)('has an entry for %s', (arch) => {
    expect(ARCHETYPE_DEFAULTS_TABLE[arch]).toBeDefined();
    expect(ARCHETYPE_DEFAULTS_TABLE[arch].archetype).toBe(arch);
  });

  it.each(ACTIVE_ARCHETYPES)('schema-validates %s', (arch) => {
    const parsed = archetypeDefaultsSchema.safeParse(ARCHETYPE_DEFAULTS_TABLE[arch]);
    if (!parsed.success) {
      console.error('Validation errors:', parsed.error.format());
    }
    expect(parsed.success).toBe(true);
  });
});

describe('PABSON profile (v3.4.1 H2 + v3.4 E.1.0 §7 + v3.4 D.4.0 §7.2)', () => {
  const pabson = ARCHETYPE_DEFAULTS_TABLE.PABSON;

  it('includes NG (Not Graded) as a terminal-fail letter-grade', () => {
    const ng = pabson.letterGrades.find((g) => g.letter === 'NG');
    expect(ng).toBeDefined();
    expect(ng?.isPassing).toBe(false);
    expect(ng?.isTerminalFail).toBe(true);
    expect(ng?.gpaPoints).toBe(0);
    expect(ng?.displayName).toBe('Not Graded');
  });

  it('enumerates 10 letter grades (CEHRD A+ through E + NG)', () => {
    expect(pabson.letterGrades).toHaveLength(10);
    const letters = pabson.letterGrades.map((g) => g.letter);
    expect(letters).toEqual(['A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'E', 'NG']);
  });

  it('does NOT include Form 7/2/19 in complianceForms (v3.4 E.1.0 §7)', () => {
    expect(pabson.complianceForms).not.toContain('FORM_19');
    expect(pabson.complianceForms).not.toContain('FORM_19_SOFT');
    expect(pabson.complianceForms).not.toContain('FORM_7');
    expect(pabson.complianceForms).not.toContain('FORM_2');
    expect(pabson.complianceForms).toEqual(['IEMIS_FLASH_I', 'IEMIS_FLASH_II']);
  });

  it('BLE row has supplementary flag with maxNgForSupplementary=3 (D.4.0 §7.2)', () => {
    const ble = pabson.boardExams.find((e) => e.examType === 'BLE');
    expect(ble).toBeDefined();
    expect(ble?.grade).toBe(8);
    expect(ble?.authority).toBe('municipality');
    expect(ble?.internalWeight).toBe(0.5);
    expect(ble?.externalWeight).toBe(0.5);
    expect(ble?.hasSupplementary).toBe(true);
    expect(ble?.maxNgForSupplementary).toBe(3);
  });

  it('SEE row uses 25/75 weight (D.5 research)', () => {
    const see = pabson.boardExams.find((e) => e.examType === 'SEE');
    expect(see).toBeDefined();
    expect(see?.grade).toBe(10);
    expect(see?.authority).toBe('NEB');
    expect(see?.internalWeight).toBe(0.25);
    expect(see?.externalWeight).toBe(0.75);
  });

  it('primaryCurriculumRef = CDC_NCF_2076 (A.2.0 research)', () => {
    expect(pabson.primaryCurriculumRef).toBe('CDC_NCF_2076');
  });

  it('uses Bikram Sambat calendar + Sunday week-start + NPR currency', () => {
    expect(pabson.calendarSystem).toBe('bikram_sambat');
    expect(pabson.weekStart).toBe('sunday');
    expect(pabson.currency).toBe('NPR');
  });

  it('gradeLadder starts at ECD/PPC/KG (CEHRD bands)', () => {
    expect(pabson.gradeLadder[0]).toBe('ECD');
    expect(pabson.gradeLadder).toContain('PPC');
    expect(pabson.gradeLadder).toContain('KG');
  });

  it('examPattern includes pre_board (PABSON private-school cadence)', () => {
    expect(pabson.examPattern).toContain('pre_board');
  });
});

describe('GENERIC profile (Sprint F.2 archetype-agnostic proof)', () => {
  const generic = ARCHETYPE_DEFAULTS_TABLE.GENERIC;

  it('has no board exams (no Nepal-archetype assumptions leak)', () => {
    expect(generic.boardExams).toHaveLength(0);
  });

  it('uses US-style A/B/C/D/F letter scale', () => {
    const letters = generic.letterGrades.map((g) => g.letter);
    expect(letters).toEqual(['A', 'B', 'C', 'D', 'F']);
  });

  it('uses Gregorian calendar + Monday week-start + USD', () => {
    expect(generic.calendarSystem).toBe('gregorian');
    expect(generic.weekStart).toBe('monday');
    expect(generic.currency).toBe('USD');
  });

  it('has empty complianceForms (no national reporting in V1 generic profile)', () => {
    expect(generic.complianceForms).toEqual([]);
  });

  it('gradeLadder starts at K (US convention)', () => {
    expect(generic.gradeLadder[0]).toBe('K');
  });
});

describe('getArchetypeDefaults — lookup function', () => {
  it('resolves PABSON case-insensitively', () => {
    expect(getArchetypeDefaults('pabson').archetype).toBe('PABSON');
    expect(getArchetypeDefaults('PABSON').archetype).toBe('PABSON');
    expect(getArchetypeDefaults('Pabson').archetype).toBe('PABSON');
  });

  it('resolves GENERIC', () => {
    expect(getArchetypeDefaults('GENERIC').archetype).toBe('GENERIC');
  });

  it('throws ARCHETYPE_NOT_FOUND for unknown archetype (fail-loud — academic policy must not silently default)', () => {
    expect(() => getArchetypeDefaults('CBSE_IN')).toThrow(/ARCHETYPE_NOT_FOUND/);
    expect(() => getArchetypeDefaults('UNKNOWN')).toThrow(/ARCHETYPE_NOT_FOUND/);
    expect(() => getArchetypeDefaults('')).toThrow(/ARCHETYPE_NOT_FOUND/);
  });
});
