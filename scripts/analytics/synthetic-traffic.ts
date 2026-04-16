/**
 * 0.2 — synthetic-traffic.ts
 *
 * Orchestrates HTTPS calls against identity, academics, and finance to generate
 * events for the analytics sniffer (0.3). Reuses the request plumbing shape from
 * scripts/smoke-tests/identity-service-flow.ts.
 *
 * Target sequence (each step is best-effort; a failing step does NOT halt the run):
 *   create user → login (via new user) → record attendance → record grade →
 *   create enrollment → generate invoice → record manual payment →
 *   revoke single session → revoke-all-other sessions → logout
 *
 * Usage:
 *   AWS_PROFILE=uat \
 *   SYNTH_JWT=eyJ... \
 *   SYNTH_SCHOOL_ID=... SYNTH_SECTION_ID=... SYNTH_STUDENT_ID=... \
 *   SYNTH_COURSE_ID=... SYNTH_YEAR_ID=... \
 *   npx ts-node scripts/analytics/synthetic-traffic.ts \
 *     --base-url https://.../prod --tenant dev-synthetic --runs 1
 *
 * Flags:
 *   --base-url <url>  Required. API gateway base URL.
 *   --tenant <id>     Tenant tag applied to all synthetic entities (default: dev-synthetic).
 *   --runs <n>        Number of times to run the sequence (default: 1).
 *
 * Env (optional, fill in for full coverage — missing ones skip the corresponding step):
 *   SYNTH_JWT          Bearer token for a TenantAdmin in the dev-synthetic tenant.
 *   SYNTH_SCHOOL_ID    Existing school under dev-synthetic.
 *   SYNTH_SECTION_ID   Existing section for attendance/grade writes.
 *   SYNTH_STUDENT_ID   Existing student for enrollment/attendance/grade writes.
 *   SYNTH_COURSE_ID    Existing course.
 *   SYNTH_YEAR_ID      Existing academic year.
 *   SYNTH_PASSWORD     Password for the newly created user (default: Synth!23Password).
 *
 * Every entity this script creates is tagged { synthetic: true, runId: <uuid> }
 * in its request body (where the endpoint accepts arbitrary metadata) so the
 * weekly wipe of the dev-synthetic tenant can reconcile by runId.
 */

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

interface Args {
  baseUrl: string;
  tenant: string;
  runs: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const out: Args = { baseUrl: '', tenant: 'dev-synthetic', runs: 1 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--base-url' && a[i + 1]) out.baseUrl = a[++i];
    else if (a[i] === '--tenant' && a[i + 1]) out.tenant = a[++i];
    else if (a[i] === '--runs' && a[i + 1]) out.runs = parseInt(a[++i], 10);
  }
  if (!out.baseUrl) {
    console.error('ERROR: --base-url is required');
    process.exit(1);
  }
  if (!process.env.SYNTH_JWT) {
    console.error('ERROR: SYNTH_JWT env var is required');
    process.exit(1);
  }
  return out;
}

type StepResult = { step: string; status: number | 'skipped' | 'error'; ms: number; note?: string };

class Runner {
  private results: StepResult[] = [];
  private token: string;
  private baseUrl: string;
  private runId: string;
  private tenant: string;
  private created: { userId?: string; userEmail?: string; invoiceId?: string } = {};

  constructor(baseUrl: string, tenant: string, runId: string) {
    this.token = process.env.SYNTH_JWT!;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.runId = runId;
    this.tenant = tenant;
  }

  private async call<T = unknown>(
    step: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    body?: unknown,
    token?: string,
  ): Promise<AxiosResponse<T> | null> {
    const started = Date.now();
    try {
      const cfg: AxiosRequestConfig = {
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers: {
          Authorization: `Bearer ${token || this.token}`,
          'Content-Type': 'application/json',
          'X-Synthetic-Run-Id': this.runId,
        },
        data: body,
        validateStatus: () => true,
        timeout: 30000,
      };
      const res = await axios(cfg);
      this.results.push({ step, status: res.status, ms: Date.now() - started });
      console.log(`[${step}] ${method} ${endpoint} → ${res.status} (${Date.now() - started}ms)`);
      return res;
    } catch (e) {
      this.results.push({ step, status: 'error', ms: Date.now() - started, note: (e as Error).message });
      console.error(`[${step}] ${method} ${endpoint} → ERROR ${(e as Error).message}`);
      return null;
    }
  }

  private skip(step: string, reason: string) {
    this.results.push({ step, status: 'skipped', ms: 0, note: reason });
    console.log(`[${step}] skipped — ${reason}`);
  }

  async run(): Promise<StepResult[]> {
    const email = `synth-${this.runId.slice(0, 8)}@edforge-synthetic.test`;
    const password = process.env.SYNTH_PASSWORD || 'Synth!23Password';
    const metadata = { synthetic: true, runId: this.runId, tenant: this.tenant };

    // 1. create user
    const userRes = await this.call<{ userId: string }>('create-user', 'POST', '/users', {
      email,
      firstName: 'Synth',
      lastName: this.runId.slice(0, 6),
      globalRole: 'Teacher',
      password,
      metadata,
    });
    if (userRes && userRes.status >= 200 && userRes.status < 300) {
      this.created.userId = (userRes.data as any)?.userId;
      this.created.userEmail = email;
    }

    // 2. login (stubbed — actual login goes through Cognito InitiateAuth. If you
    //    have an auth endpoint that wraps Cognito, wire it here. Otherwise this
    //    step is skipped and the original SYNTH_JWT is reused for subsequent calls.)
    if (process.env.SYNTH_AUTH_ENDPOINT) {
      await this.call('login', 'POST', process.env.SYNTH_AUTH_ENDPOINT, { email, password });
    } else {
      this.skip('login', 'SYNTH_AUTH_ENDPOINT not set; skipping programmatic login');
    }

    // 3. record attendance
    const schoolId = process.env.SYNTH_SCHOOL_ID;
    const sectionId = process.env.SYNTH_SECTION_ID;
    const studentId = process.env.SYNTH_STUDENT_ID;
    const today = new Date().toISOString().slice(0, 10);
    if (schoolId && sectionId && studentId) {
      await this.call('attendance', 'POST', '/academics/attendance', {
        schoolId,
        sectionId,
        studentId,
        date: today,
        status: 'present',
        metadata,
      });
    } else {
      this.skip('attendance', 'SYNTH_SCHOOL_ID/SECTION_ID/STUDENT_ID not set');
    }

    // 4. record grade
    if (studentId && sectionId) {
      await this.call('grade', 'POST', '/academics/grades/record', {
        studentId,
        sectionId,
        assignmentName: `synth-${this.runId.slice(0, 6)}`,
        pointsEarned: 90,
        pointsPossible: 100,
        metadata,
      });
    } else {
      this.skip('grade', 'SYNTH_STUDENT_ID/SECTION_ID not set');
    }

    // 5. create enrollment
    const yearId = process.env.SYNTH_YEAR_ID;
    if (schoolId && studentId && yearId) {
      await this.call('enrollment', 'POST', '/academics/enrollments', {
        schoolId,
        studentId,
        academicYearId: yearId,
        gradeLevel: '10',
        enrollmentDate: today,
        metadata,
      });
    } else {
      this.skip('enrollment', 'SYNTH_SCHOOL_ID/STUDENT_ID/YEAR_ID not set');
    }

    // 6. generate invoice
    if (schoolId) {
      const invRes = await this.call<{ invoiceId: string }>(
        'invoice',
        'POST',
        `/finance/schools/${schoolId}/invoices`,
        {
          studentId: studentId || 'synth-placeholder',
          lineItems: [{ description: `synth-${this.runId.slice(0, 6)}`, amount: 100 }],
          dueDate: today,
          metadata,
        },
      );
      if (invRes && invRes.status >= 200 && invRes.status < 300) {
        this.created.invoiceId = (invRes.data as any)?.invoiceId;
      }
    } else {
      this.skip('invoice', 'SYNTH_SCHOOL_ID not set');
    }

    // 7. record manual payment
    if (schoolId && this.created.invoiceId) {
      await this.call(
        'payment',
        'POST',
        `/finance/schools/${schoolId}/invoices/${this.created.invoiceId}/payments`,
        {
          amount: 100,
          method: 'manual',
          referenceNumber: `synth-${this.runId.slice(0, 8)}`,
          metadata,
        },
      );
    } else {
      this.skip('payment', 'no invoiceId from step 6');
    }

    // 8. revoke a single session (pick first session that is NOT current)
    const sessionsRes = await this.call<{ items?: Array<{ sessionId: string; isCurrent?: boolean }> }>(
      'list-sessions',
      'GET',
      '/sessions',
    );
    const sessions = (sessionsRes?.data as any)?.items || (sessionsRes?.data as any) || [];
    const target = Array.isArray(sessions) ? sessions.find((s: any) => !s.isCurrent) : undefined;
    if (target?.sessionId) {
      await this.call('revoke-session', 'DELETE', `/sessions/${target.sessionId}`);
    } else {
      this.skip('revoke-session', 'no non-current session to revoke');
    }

    // 9. revoke all other sessions
    await this.call('revoke-all', 'POST', '/sessions/revoke-all?preserveCurrent=true');

    // 10. logout — for Cognito JWTs, logout typically means client-side token discard
    //     plus optional Cognito GlobalSignOut. If the backend exposes a logout endpoint,
    //     hit it; otherwise skip.
    if (process.env.SYNTH_LOGOUT_ENDPOINT) {
      await this.call('logout', 'POST', process.env.SYNTH_LOGOUT_ENDPOINT);
    } else {
      this.skip('logout', 'SYNTH_LOGOUT_ENDPOINT not set');
    }

    return this.results;
  }
}

async function main() {
  const args = parseArgs();
  const allRuns: Array<{ runId: string; steps: StepResult[] }> = [];
  for (let i = 0; i < args.runs; i++) {
    const runId = randomUUID();
    console.log(`\n=== Run ${i + 1}/${args.runs} — runId=${runId} ===`);
    const runner = new Runner(args.baseUrl, args.tenant, runId);
    const steps = await runner.run();
    allRuns.push({ runId, steps });
  }
  const logDir = path.resolve(__dirname, '../../docs/analytics');
  fs.mkdirSync(logDir, { recursive: true });
  const outFile = path.join(logDir, `synthetic-traffic-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ tenant: args.tenant, baseUrl: args.baseUrl, runs: allRuns }, null, 2));
  console.log(`\nWrote run log: ${outFile}`);
  const failed = allRuns.flatMap((r) => r.steps).filter((s) => s.status === 'error').length;
  if (failed > 0) {
    console.warn(`\n⚠️  ${failed} step(s) errored (not HTTP 4xx/5xx, actual request errors). See log above.`);
  }
}

main().catch((e) => {
  console.error('synthetic-traffic failed:', e);
  process.exit(1);
});
