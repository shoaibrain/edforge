/**
 * Sprint 2 S2.9 — Saraswati real-data fixture test.
 *
 * These exact values were extracted from the pilot school's actual 2082 B.S.
 * student roster (`Students_2082_All.xlsx`, 779 rows across grades 1–10 +
 * ECD/PPC). The source file is gitignored (real student PII) — only
 * aggregated counts of unique values land here, and no student name / DOB /
 * guardian / address data from the file is referenced.
 *
 * The intent is a regression fence: every UNIQUE value currently stored in
 * a Saraswati demographic column must either (a) resolve to a canonical
 * Ed-Fi URI or (b) appear in the documented unresolved-upstream list. Any
 * future catalog edit that breaks a Saraswati value will trip this test
 * before it ships. A future Sprint 15 dress-rehearsal iteration may add
 * more pilot schools — extend this fixture then.
 *
 * Counts in comments are for operator context; the test does not assert
 * them (Saraswati can re-enter students without breaking Sprint 2 code).
 */

import { resolveDescriptor } from './index';

describe('Saraswati IEMIS xlsx — unique column values (S2.9 fixture)', () => {
  describe('Gender column', () => {
    // Observed in the real file:
    //   "Male" × 443, "Female" × 336
    const values = ['Male', 'Female'];
    it.each(values)('%s resolves to a SexDescriptor URI', (input) => {
      expect(resolveDescriptor('SexDescriptor', input)).toMatch(
        /^uri:\/\/ed-fi\.org\/SexDescriptor#/,
      );
    });
  });

  describe('Mother Tongue column', () => {
    // Observed in the real file:
    //   "Nepali" × 390, "Maithali" × 386, "Bhojpuri" × 1,
    //   "English" × 1, "Angika" × 1
    // "Maithali" is a misspelling of Maithili — MUST resolve via alias.
    // "Angika" is a Madhes-Province heritage language; canonical entry
    // was seeded in the LanguageDescriptor catalog specifically because
    // this row exists in live data.
    const values = ['Nepali', 'Maithali', 'Bhojpuri', 'English', 'Angika'];
    it.each(values)('%s resolves to a LanguageDescriptor URI', (input) => {
      expect(resolveDescriptor('LanguageDescriptor', input)).toMatch(
        /^uri:\/\/ed-fi\.org\/LanguageDescriptor#/,
      );
    });

    it('"Maithali" aliases to the canonical Maithili entry (not creates a new one)', () => {
      expect(resolveDescriptor('LanguageDescriptor', 'Maithali')).toBe(
        'uri://ed-fi.org/LanguageDescriptor#Maithili',
      );
    });
  });

  describe('Disability Type column', () => {
    // Observed in the real file:
    //   "No Disability" × 607, "<null>" × 171, "N/A" × 1
    // Resolver treats `null` / `undefined` input as a real missing signal
    // (caller decides what to do); the "N/A" literal maps to NoDisability
    // via alias — that covers the single Saraswati row carrying it.
    it('"No Disability" resolves to NoDisability', () => {
      expect(resolveDescriptor('DisabilityDescriptor', 'No Disability')).toBe(
        'uri://ed-fi.org/DisabilityDescriptor#NoDisability',
      );
    });
    it('"N/A" resolves to NoDisability', () => {
      expect(resolveDescriptor('DisabilityDescriptor', 'N/A')).toBe(
        'uri://ed-fi.org/DisabilityDescriptor#NoDisability',
      );
    });
    it('null / undefined input returns null (missing, not "no disability")', () => {
      expect(resolveDescriptor('DisabilityDescriptor', null)).toBeNull();
      expect(resolveDescriptor('DisabilityDescriptor', undefined)).toBeNull();
    });
  });

  describe('CurrentClass column', () => {
    // Observed in the real file:
    //   "1" × 38, "2" × 248, "3" × 126, "4" × 88, "5" × 59,
    //   "6" × 47, "7" × 43, "8" × 37, "9" × 26, "10" × 13,
    //   "ECD/PPC" × 54
    const numericGrades = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    it.each(numericGrades)('%s resolves to a GradeLevelDescriptor URI', (input) => {
      expect(resolveDescriptor('GradeLevelDescriptor', input)).toMatch(
        /^uri:\/\/ed-fi\.org\/GradeLevelDescriptor#/,
      );
    });

    // Explicitly documented unresolved-upstream token. Sprint 3's Student
    // importer is responsible for disambiguating before persisting.
    it('"ECD/PPC" does NOT resolve (Sprint 3 importer must split)', () => {
      expect(resolveDescriptor('GradeLevelDescriptor', 'ECD/PPC')).toBeNull();
    });
  });
});
