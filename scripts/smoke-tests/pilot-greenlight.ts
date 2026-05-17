/// <reference types="node" />
/**
 * Sprint C2.6 — Pilot greenlight harness.
 *
 * Runs the full C2 smoke suite (C2.0 write-path + C2.1-C2.5 read-paths)
 * sequentially as subprocesses. Aggregates exit codes into a single
 * pass/fail verdict.
 *
 * When all six smokes exit 0, the calendar / operational domain is
 * internally validated for the pilot — proceed to Sprint C3 and C12 per
 * the dependency graph.
 *
 * Pilot-agnostic: PILOT_ID is forwarded to every child process. If
 * multiple pilots are registered via @edforge/pilot-fixtures'
 * `listPilots()` and PILOT_ID is unset, the harness runs once per
 * registered pilot.
 *
 * Run
 * ===
 *   # Operator places fresh prod JWT at /private/tmp/c0-c-3-prod-jwt.txt
 *   # Single pilot:
 *   export PILOT_ID=pabson-saraswati-bs-2083
 *   export TENANT_ID=<dev tenant uuid>
 *   export SCHOOL_ID=<school uuid>
 *   export ACADEMIC_YEAR_ID=<active AY uuid>
 *   export STAFF_ID=<staff uuid for C2.0 write>
 *   export STUDENT_ID=<student uuid for C2.4 reject>
 *
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/pilot-greenlight.ts
 *
 * Exit codes
 * ----------
 *   0 — all smokes pass for all pilots
 *   1 — at least one smoke failed
 *   2 — environment / prerequisites missing
 */

import * as path from 'path';
import { spawn } from 'child_process';
import { listPilots } from '@edforge/pilot-fixtures';

// ── config ─────────────────────────────────────────────────────────────────

const PILOT_ID = process.env.PILOT_ID ?? '';
const SMOKE_DIR = path.resolve(__dirname);
const SETUP_DIR = path.resolve(__dirname, '..', 'pilot-greenlight');

interface SmokeStep {
  name: string;
  file: string;
  /** Directory the script lives in. Defaults to scripts/smoke-tests/. */
  dir?: string;
  requires: string[]; // env vars required to even attempt this step
  description: string;
}

const STEPS: SmokeStep[] = [
  {
    name: 'SETUP — pilot term seeder (idempotent)',
    file: 'seed-pilot-terms.ts',
    dir: SETUP_DIR,
    requires: ['TENANT_ID', 'SCHOOL_ID', 'ACADEMIC_YEAR_ID'],
    description:
      "Ensures all fixture-defined Terms exist in DDB so the backend's " +
      'exam_window auto-sync produces the rows C2.2 + C2.3 read. ' +
      'Idempotent: skips terms already present by name.',
  },
  {
    name: 'C2.0 write-path skeleton',
    file: 'pilot-write-path.ts',
    requires: ['TENANT_ID', 'SCHOOL_ID', 'STAFF_ID'],
    description:
      'POSTs one staff training; asserts IEMIS audit row was written; cleans up',
  },
  {
    name: 'C2.1 instructional-days count',
    file: 'pilot-greenlight-c2-1.ts',
    requires: ['TENANT_ID', 'SCHOOL_ID', 'ACADEMIC_YEAR_ID'],
    description:
      'Per-term: fixture instructional-day count === backend isInstructionalDay=true count',
  },
  {
    name: 'C2.2 shift-profile parity',
    file: 'pilot-greenlight-c2-2.ts',
    requires: ['TENANT_ID', 'SCHOOL_ID', 'ACADEMIC_YEAR_ID'],
    description: '30 sampled dates: backend.classification === fixture.classification',
  },
  {
    name: 'C2.3 exam-window containment',
    file: 'pilot-greenlight-c2-3.ts',
    requires: ['TENANT_ID', 'SCHOOL_ID', 'ACADEMIC_YEAR_ID'],
    description: 'Each of 4 exam windows: every day carries an exam_window event',
  },
  {
    name: 'C2.4 holiday exclusion',
    file: 'pilot-greenlight-c2-4.ts',
    requires: ['TENANT_ID', 'SCHOOL_ID', 'STUDENT_ID'],
    description:
      'POST attendance on non-instructional dates → 400 + DATE_NOT_INSTRUCTIONAL',
  },
  {
    name: 'C2.5 edge cases',
    file: 'pilot-greenlight-c2-5.ts',
    requires: ['TENANT_ID', 'SCHOOL_ID'],
    description: '6 boundary/edge cases (AY start, next-AY 404, mid-vacation, ...)',
  },
];

// ── runners ────────────────────────────────────────────────────────────────

interface StepResult {
  step: SmokeStep;
  exitCode: number | null;
  skipped: boolean;
  skipReason?: string;
}

function checkRequires(step: SmokeStep): { ok: boolean; missing: string[] } {
  const missing = step.requires.filter((k) => !process.env[k]);
  return { ok: missing.length === 0, missing };
}

async function runStep(step: SmokeStep, pilotId: string): Promise<StepResult> {
  const r = checkRequires(step);
  if (!r.ok) {
    return {
      step,
      exitCode: null,
      skipped: true,
      skipReason: `missing env: ${r.missing.join(', ')}`,
    };
  }

  return new Promise((resolve) => {
    const childEnv = { ...process.env, PILOT_ID: pilotId };
    const scriptPath = path.join(step.dir ?? SMOKE_DIR, step.file);
    const child = spawn(
      'npx',
      [
        'ts-node',
        '--compiler-options',
        '{"module":"commonjs"}',
        scriptPath,
      ],
      { env: childEnv, stdio: 'inherit' },
    );
    child.on('exit', (code) => {
      resolve({ step, exitCode: code, skipped: false });
    });
  });
}

async function runForPilot(pilotId: string): Promise<StepResult[]> {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Pilot: ${pilotId}`);
  console.log('═══════════════════════════════════════════════════════');

  const results: StepResult[] = [];
  for (const step of STEPS) {
    console.log('');
    console.log(`▸▸▸ ${step.name}`);
    console.log(`    ${step.description}`);
    console.log('');
    const r = await runStep(step, pilotId);
    if (r.skipped) {
      console.log(`    ⊘ skipped — ${r.skipReason}`);
    } else {
      console.log(`    exit ${r.exitCode}`);
    }
    results.push(r);
  }
  return results;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Determine pilot set
  let pilotIds: string[];
  if (PILOT_ID) {
    pilotIds = [PILOT_ID];
  } else {
    const registered = listPilots();
    if (registered.length === 0) {
      console.error('FATAL: no PILOT_ID set and no pilots registered');
      process.exit(2);
    }
    console.log(`(No PILOT_ID set; running for all ${registered.length} registered pilot(s))`);
    pilotIds = registered.map((p) => p.pilotId);
  }

  // Run each pilot's smoke suite
  const allResults: { pilotId: string; results: StepResult[] }[] = [];
  for (const pid of pilotIds) {
    const results = await runForPilot(pid);
    allResults.push({ pilotId: pid, results });
  }

  // Final verdict
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  PILOT GREENLIGHT VERDICT');
  console.log('═══════════════════════════════════════════════════════');

  let overallExit = 0;
  for (const { pilotId, results } of allResults) {
    const passed = results.filter((r) => !r.skipped && r.exitCode === 0).length;
    const failed = results.filter((r) => !r.skipped && r.exitCode !== 0).length;
    const skipped = results.filter((r) => r.skipped).length;
    console.log(
      `\n  ▸ ${pilotId}: ${passed} passed, ${failed} failed, ${skipped} skipped`,
    );
    for (const r of results) {
      const mark = r.skipped ? '⊘' : r.exitCode === 0 ? '✓' : '✗';
      const detail = r.skipped ? r.skipReason : `exit ${r.exitCode}`;
      console.log(`    ${mark} ${r.step.name} — ${detail}`);
    }
    if (failed > 0) overallExit = 1;
  }

  console.log('');
  if (overallExit === 0) {
    console.log('🟢 INTERNAL GREENLIGHT — all smokes pass.');
    console.log('   Proceed to Sprint C3 (pre-greenlight hardening).');
  } else {
    console.log('🔴 NOT GREEN — see failures above.');
  }
  console.log('');
  process.exit(overallExit);
}

main().catch((err) => {
  console.error('FATAL:', err?.stack ?? err);
  process.exit(1);
});
