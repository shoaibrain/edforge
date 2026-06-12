/**
 * Demo roster configuration — Sprint S1.1 (public-alpha demo data engine).
 *
 * The demo data engine is parametric the same way the calendar engine is:
 * the code knows zero archetypes; each archetype's demo shape is JSON data
 * under `<package>/demo/<archetype>-roster.json`, validated against the
 * schema below on load. A roster config is the *spec* — counts, section
 * layout, staff role distribution, per-grade course catalogue, the exam
 * cycle, and the fee schedule. The generators in S1.2–S1.9 expand it
 * (deterministically, from a seed) into the full entity set the loader
 * (S1.10) POSTs into a tenant.
 *
 * Why a spec + generator rather than static JSON: the demo is two
 * K-12 schools of 200 students each (D4). Hand-authoring ~430 student
 * rows plus staff/courses/sections/exams/marks/invoices is both
 * impractical and unreviewable; a 200-line spec that a seeded generator
 * expands is the maintainable form, and the determinism (S1.2) makes the
 * output testable.
 *
 * This file is the canonical machine-checkable spec referenced by
 * `docs/public-alpha/demo-seed-spec.md`.
 */

import * as fs from 'fs';
import * as path from 'path';

import { z } from 'zod';

import { ARCHETYPES } from '../types';

/**
 * Reserved synthetic EMIS-school-code band for demo schools.
 *
 * PABSON school-create requires `emisSchoolCode` to be 8–10 digits
 * (`iemisSchoolCodeSchema`), so a `DEMO-` prefix would be rejected. We
 * instead reserve the implausible `9999NNNN` 8-digit band: it satisfies
 * the numeric format yet is far outside any plausible CEHRD-assigned code,
 * so a demo school can never be mistaken for — or reported to IEMIS as — a
 * real school. Combined with the `isDemo` tenant flag (S3.1), demo data is
 * never part of an IEMIS submission. Enforced by the schema + asserted in
 * S1.3's generator and the S3.9 safety scan.
 */
export const DEMO_EMIS_CODE_RE = /^9999\d{4}$/;

/** Every school role the generator must represent across the demo fleet. */
export const REQUIRED_SCHOOL_ROLES = [
  'Principal',
  'VicePrincipal',
  'Teacher',
  'Accountant',
  'Counselor',
  'Nurse',
  'Staff',
] as const;

const gradeLevelSchema = z.object({
  /** School-local grade code (school-first: operator's own labels). */
  code: z.string().min(1),
  /** Human label shown in the UI. */
  label: z.string().min(1),
  /** Section labels for this grade — at least one. */
  sections: z.array(z.string().min(1)).min(1),
});

const courseBandSchema = z.object({
  /** Band id, purely descriptive (e.g. 'early', 'primary', 'secondary'). */
  band: z.string().min(1),
  /** Grade codes (must each exist in gradeLevels) this band covers. */
  gradeCodes: z.array(z.string().min(1)).min(1),
  /** Subject names every grade in the band offers. */
  courses: z.array(z.string().min(1)).min(1),
});

const examComponentSchema = z.object({
  name: z.string().min(1),
  /** Weight as a percentage; the components must sum to 100. */
  weightPct: z.number().int().positive().max(100),
});

/** Subset of finance `feeTypeEnum` the demo uses. */
const demoFeeTypeSchema = z.enum(['tuition', 'admission', 'exam', 'transport']);
/** Subset of finance `feeFrequencyEnum`. */
const demoFeeFrequencySchema = z.enum(['one_time', 'monthly', 'quarterly', 'annual']);

/** A non-tuition flat fee charged at every grade. */
const flatFeeSchema = z.object({
  feeType: demoFeeTypeSchema,
  name: z.string().min(1),
  frequency: demoFeeFrequencySchema,
  /** Amount in the tenant's currency (NPR/USD, whole units). */
  amount: z.number().nonnegative(),
});

export const demoRosterConfigSchema = z
  .object({
    archetype: z.enum(ARCHETYPES),
    /** ISO-3166-1 alpha-3. */
    country: z.string().length(3),
    /** BCP-47 locale tag, drives which name pool the generator draws from. */
    locale: z.string().min(2),
    /** ISO-4217 currency code. */
    currency: z.string().length(3),
    calendarSystem: z.enum(['bikram_sambat', 'gregorian']),
    /** Which synthetic-identity name pool to draw from (S1.2). */
    namePool: z.enum(['nepali', 'us']),

    school: z.object({
      name: z.string().min(1),
      /** Must be in the reserved synthetic range. */
      emisSchoolCode: z.string().regex(DEMO_EMIS_CODE_RE),
      address: z.string().min(1),
    }),

    academicYear: z.object({
      /** Slug identifier (e.g. 'bs-2083', 'ay-2026-27'). */
      id: z.string().min(1),
      name: z.string().min(1),
      /** PABSON: BS 'YYYY/MM/DD'. GENERIC: AD 'YYYY-MM-DD'. */
      startDate: z.string().min(1),
      endDate: z.string().min(1),
    }),

    /** Ordered K-12 grade ladder (lowest → highest), each with sections. */
    gradeLevels: z.array(gradeLevelSchema).min(1),

    /** Total students to generate across all sections (D4 = 200). */
    targetStudents: z.number().int().positive(),

    /** Staff counts by role; sum is the generated staff headcount. */
    staff: z.object({
      Principal: z.number().int().nonnegative(),
      VicePrincipal: z.number().int().nonnegative(),
      Teacher: z.number().int().nonnegative(),
      Accountant: z.number().int().nonnegative(),
      Counselor: z.number().int().nonnegative(),
      Nurse: z.number().int().nonnegative(),
      Staff: z.number().int().nonnegative(),
    }),

    /** Per-band subject catalogue; the generator expands per grade. */
    courseCatalog: z.array(courseBandSchema).min(1),

    /** One full exam cycle (weighted components recorded for every student). */
    examCycle: z.object({
      name: z.string().min(1),
      /**
       * examPatternKey — validated against `archetypeDefaults[archetype].examPattern`
       * at the live API boundary. `terminal` is the universal key; the loader
       * (S1.8/S1.10) confirms it against the tenant's archetype pattern.
       */
      examType: z.enum(['unit_test', 'terminal', 'send_up', 'pre_board', 'final', 'monthly_test']),
      components: z.array(examComponentSchema).min(1),
    }),

    /** Fee schedule + the paid/partial/unpaid distribution to simulate. */
    fees: z.object({
      /** Grade-scaled annual tuition (feeType 'tuition', frequency 'annual'). */
      tuition: z.object({
        /** Annual tuition for the lowest grade. */
        baseAmount: z.number().positive(),
        /** Added per step up the grade ladder. */
        perGradeIncrement: z.number().nonnegative(),
      }),
      /** Non-tuition flat fees every grade is charged (admission, exam, etc.). */
      flatFees: z.array(flatFeeSchema).min(1),
      /** Distribution of invoices into paid / partially-paid / unpaid. */
      paymentMix: z.object({
        paidPct: z.number().int().nonnegative().max(100),
        partialPct: z.number().int().nonnegative().max(100),
        unpaidPct: z.number().int().nonnegative().max(100),
      }),
    }),
  })
  .strict();

export type DemoRosterConfig = z.infer<typeof demoRosterConfigSchema>;

export class DemoRosterConfigInvalidError extends Error {
  readonly code = 'DEMO_ROSTER_CONFIG_INVALID' as const;
  readonly archetype: string;
  readonly issues: z.ZodIssue[];

  constructor(archetype: string, issues: z.ZodIssue[]) {
    super(
      `DEMO_ROSTER_CONFIG_INVALID: '${archetype}' has ${issues.length} violation(s). First: ${
        issues[0]?.path.join('.') || '<root>'
      } - ${issues[0]?.message || 'unknown'}.`,
    );
    this.name = 'DemoRosterConfigInvalidError';
    this.archetype = archetype;
    this.issues = issues;
  }
}

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const DEMO_DATA_DIR = path.resolve(PACKAGE_ROOT, 'demo');

/** Lower-cased archetype → roster JSON filename. */
function rosterFileFor(archetype: string): string {
  return path.resolve(DEMO_DATA_DIR, `${archetype.toLowerCase()}-roster.json`);
}

/**
 * Cross-field invariants the Zod schema can't express. Returns a list of
 * human-readable violations (empty = valid). Kept separate from the schema
 * so the S1.1 conformance test can assert each one explicitly.
 */
export function rosterInvariantViolations(config: DemoRosterConfig): string[] {
  const out: string[] = [];

  // Exam components must sum to exactly 100%.
  const weightSum = config.examCycle.components.reduce((s, c) => s + c.weightPct, 0);
  if (weightSum !== 100) {
    out.push(`examCycle component weights sum to ${weightSum}, expected 100`);
  }

  // Payment mix must sum to exactly 100%.
  const mix = config.fees.paymentMix;
  const mixSum = mix.paidPct + mix.partialPct + mix.unpaidPct;
  if (mixSum !== 100) {
    out.push(`fees.paymentMix sums to ${mixSum}, expected 100`);
  }

  // Every course-band grade code must exist in the grade ladder, and every
  // grade must be covered by exactly one band (so every section gets courses).
  const gradeCodes = new Set(config.gradeLevels.map((g) => g.code));
  const covered = new Map<string, number>();
  for (const band of config.courseCatalog) {
    for (const gc of band.gradeCodes) {
      if (!gradeCodes.has(gc)) {
        out.push(`courseCatalog band '${band.band}' references unknown grade '${gc}'`);
      }
      covered.set(gc, (covered.get(gc) ?? 0) + 1);
    }
  }
  for (const g of config.gradeLevels) {
    const n = covered.get(g.code) ?? 0;
    if (n === 0) out.push(`grade '${g.code}' is not covered by any course band`);
    if (n > 1) out.push(`grade '${g.code}' is covered by ${n} course bands (expected 1)`);
  }

  // Staff must cover every required school role at least once.
  for (const role of REQUIRED_SCHOOL_ROLES) {
    if ((config.staff[role] ?? 0) < 1) {
      out.push(`staff role '${role}' has count < 1`);
    }
  }

  // There must be enough section capacity to seat the target students.
  const sectionCount = config.gradeLevels.reduce((s, g) => s + g.sections.length, 0);
  if (sectionCount < 1) out.push('no sections defined');
  if (config.targetStudents < sectionCount) {
    out.push(
      `targetStudents (${config.targetStudents}) < section count (${sectionCount}); some sections would be empty`,
    );
  }

  return out;
}

/**
 * Load + validate an archetype's demo roster config. Throws
 * `DemoRosterConfigInvalidError` on schema failure and on any cross-field
 * invariant violation, so a malformed spec fails loudly at load time.
 */
export function loadRosterConfig(archetype: string): DemoRosterConfig {
  const file = rosterFileFor(archetype);
  if (!fs.existsSync(file)) {
    throw new Error(`demo roster config not found for archetype '${archetype}' at ${file}`);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const parsed = demoRosterConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DemoRosterConfigInvalidError(archetype, parsed.error.issues);
  }
  const violations = rosterInvariantViolations(parsed.data);
  if (violations.length > 0) {
    throw new DemoRosterConfigInvalidError(
      archetype,
      violations.map((v) => ({ code: 'custom', message: v, path: [] }) as z.ZodIssue),
    );
  }
  return parsed.data;
}

/** Archetypes that ship a demo roster config today. */
export const DEMO_ARCHETYPES = ['PABSON', 'GENERIC'] as const;
export type DemoArchetype = (typeof DEMO_ARCHETYPES)[number];
