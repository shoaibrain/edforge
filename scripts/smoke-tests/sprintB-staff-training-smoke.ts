/// <reference types="node" />
/**
 * Sprint B — StaffTraining CRUD + IEMIS audit smoke
 *
 * Verifies the four routes mounted in Sprint B.5 end-to-end and confirms
 * the three pre-registered audit event types (`staff.training.{c,e,d}` —
 * registered in S4.7) emit correctly with PII-clean metadata.
 *
 * Coverage:
 *   POST   /staff/:id/trainings              → staff.training.created
 *   GET    /staff/:id/trainings/:tid         (DDB persistence)
 *   PATCH  /staff/:id/trainings/:tid         → staff.training.edited (changedFields)
 *   PATCH  /staff/:id/trainings/:tid (status) → staff.training.edited (with before/after)
 *   GET    /staff/:id/trainings              (list — verify created training appears)
 *   DELETE /staff/:id/trainings/:tid         → staff.training.deleted
 *
 * Privacy guard: each captured audit event is asserted to have NO free-text
 * PII fields (trainingTitle / notes / certificateNumber / certificateUrl).
 *
 * Self-contained: provisions a temp staff + cleans up at the end.
 *
 * Usage:
 *   export ADMIN_TOKEN="<JWT>"
 *   export SCHOOL_ID="<existing school uuid on the JWT tenant>"
 *   export API_BASE="https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod"  # UAT
 *   #  or   https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod          # prod
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/sprintB-staff-training-smoke.ts
 *
 * Exit 0 = green; exit 1 = any check failed.
 */

import axios from 'axios';

const TOKEN = process.env.ADMIN_TOKEN ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const BASE = process.env.API_BASE ?? 'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';

const fails: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    console.log(`  └─ ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    fails.push(name);
  }
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  const r = await axios({
    method,
    url: `${BASE}${path}`,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    data: body,
    validateStatus: () => true,
    timeout: 30_000,
  });
  return { status: r.status, body: r.data as any };
}

const ok2xx = (s: number) => s >= 200 && s < 300;

const PII_KEYS = ['trainingTitle', 'notes', 'certificateNumber', 'certificateUrl'] as const;
function assertNoPiiInMetadata(eventType: string, metadata: Record<string, unknown> | undefined) {
  if (!metadata) {
    check(`${eventType} — has metadata`, false, 'missing');
    return;
  }
  for (const k of PII_KEYS) {
    check(
      `${eventType} — metadata.${k} absent (PII guard)`,
      metadata[k] === undefined,
      { found: metadata[k] },
    );
  }
}

async function main(): Promise<void> {
  console.log('Sprint B — StaffTraining smoke');
  console.log(`  base:     ${BASE}`);
  console.log(`  region:   ${BASE.includes('ap-south-1') ? 'PROD (ap-south-1)' : BASE.includes('us-east-2') ? 'UAT (us-east-2)' : 'unknown'}`);
  console.log(`  schoolId: ${SCHOOL_ID || '(MISSING — set SCHOOL_ID)'}`);

  if (!TOKEN || !SCHOOL_ID) {
    console.error('✗ ADMIN_TOKEN and SCHOOL_ID env vars are required.');
    process.exit(1);
  }

  const t0 = Date.now() - 1000; // 1s grace for clock skew between client + DDB-server

  // ── Provision temp staff ─────────────────────────────────────────────────
  console.log('\n— Provisioning temp staff —');
  const uniqueSuffix = `${Date.now()}`.slice(-6);
  const staffCreate = await call('POST', '/staff', {
    staffUniqueId: `SMOKE-B-${uniqueSuffix}`,
    firstName: 'SmokeB',
    lastSurname: `Train${uniqueSuffix}`,
    birthDate: '1990-01-01',
    gender: 'male',
    primarySchoolId: SCHOOL_ID,
    role: 'teacher',
    employmentType: 'full_time',
    hireDate: '2026-04-28',
    email: `smoke-b-${uniqueSuffix}@example.test`,
    phone: '9812345678',
  });
  check('POST /staff (temp staff) — 2xx', ok2xx(staffCreate.status), { status: staffCreate.status, body: staffCreate.body });
  const staffId = staffCreate.body?.staffId as string | undefined;
  if (!staffId) {
    console.error('✗ no staffId returned, aborting');
    process.exit(1);
  }
  console.log(`  ✓ provisioned temp staff ${staffId}`);

  let trainingId: string | undefined;
  try {
    // ── POST /staff/:id/trainings ──────────────────────────────────────────
    console.log('\n— POST /staff/:id/trainings —');
    const created = await call('POST', `/staff/${staffId}/trainings`, {
      trainingTitle: 'Inclusive Education Workshop',
      trainingType: 'inclusion',
      trainingProvider: 'CEHRD Bagmati Resource Center',
      startDate: '2026-04-01',
      endDate: '2026-04-03',
      durationHours: 16,
      status: 'completed',
      certificateNumber: 'CEHRD-INC-2026-0042',
      notes: 'Front-row attendance; recommended for induction batch.',
    });
    check('POST /staff/:id/trainings — 2xx', ok2xx(created.status), { status: created.status, body: created.body });
    trainingId = created.body?.trainingId as string | undefined;
    check('POST response — returned trainingId', !!trainingId);
    check(
      'POST response — preserves trainingType',
      created.body?.trainingType === 'inclusion',
      created.body,
    );
    check(
      'POST response — preserves durationHours',
      created.body?.durationHours === 16,
    );
    if (!trainingId) {
      console.error('✗ no trainingId; aborting trainings checks');
      throw new Error('abort');
    }

    // ── GET /staff/:id/trainings/:tid (persistence) ────────────────────────
    console.log('\n— GET /staff/:id/trainings/:tid —');
    const got = await call('GET', `/staff/${staffId}/trainings/${trainingId}`);
    check('GET /staff/:id/trainings/:tid — 200', got.status === 200);
    check(
      'GET response — round-trips title + provider',
      got.body?.trainingTitle === 'Inclusive Education Workshop' &&
        got.body?.trainingProvider === 'CEHRD Bagmati Resource Center',
      got.body,
    );

    // ── PATCH /staff/:id/trainings/:tid (durationHours change) ─────────────
    console.log('\n— PATCH /staff/:id/trainings/:tid (durationHours) —');
    const patchHours = await call('PATCH', `/staff/${staffId}/trainings/${trainingId}`, {
      durationHours: 24,
    });
    check('PATCH (durationHours) — 2xx', ok2xx(patchHours.status), { status: patchHours.status });
    check('PATCH response — durationHours updated', patchHours.body?.durationHours === 24);

    // ── PATCH /staff/:id/trainings/:tid (status change) ────────────────────
    // Single PATCH that actually changes the status (completed → cancelled).
    // The service emits `staff.training.edited` with explicit before/after
    // ONLY when the value differs from the existing entity, so a no-op
    // status PATCH would not produce before/after — keep this PATCH a real
    // state change so the assertion below is meaningful.
    console.log('\n— PATCH /staff/:id/trainings/:tid (status) —');
    const patchStatus = await call('PATCH', `/staff/${staffId}/trainings/${trainingId}`, {
      status: 'cancelled',
    });
    check('PATCH (status cancelled) — 2xx', ok2xx(patchStatus.status));
    check(
      'PATCH response — status=cancelled',
      patchStatus.body?.status === 'cancelled',
    );

    // ── GET /staff/:id/trainings (list) ─────────────────────────────────────
    console.log('\n— GET /staff/:id/trainings (list) —');
    const list = await call('GET', `/staff/${staffId}/trainings`);
    check('GET /staff/:id/trainings — 200', list.status === 200);
    const items = (list.body?.items ?? []) as Array<{ trainingId: string }>;
    check(
      'GET list — created training appears',
      items.some((t) => t.trainingId === trainingId),
      { items: items.map((t) => t.trainingId), expected: trainingId },
    );

    // ── DELETE /staff/:id/trainings/:tid ───────────────────────────────────
    console.log('\n— DELETE /staff/:id/trainings/:tid —');
    const del = await call('DELETE', `/staff/${staffId}/trainings/${trainingId}`);
    check('DELETE — 2xx', ok2xx(del.status), { status: del.status });

    // Wait for audit emits to land (fail-open + async via EventBridge → DDB
    // sink; PATCH/DELETE clusters can take longer than POST under load).
    await new Promise((r) => setTimeout(r, 8000));

    // ── /iemis/audit shape verification ────────────────────────────────────
    // Note on `limit`: every GET /iemis/audit emits its own `audit.viewed`
    // event into the log, so repeated smoke runs in the same 5-min window
    // can push earlier training events past a small limit. 200 is safe
    // headroom for ~5 same-window runs.
    console.log('\n— /iemis/audit shape verification —');
    const audit = await call('GET', '/iemis/audit?limit=200');
    check('GET /iemis/audit — 200', audit.status === 200);
    const auditItems = (audit.body?.items ?? []) as Array<{
      eventType: string;
      timestamp: string;
      metadata?: Record<string, unknown>;
    }>;
    // Filter strictly by THIS run's trainingId — robust against background
    // audit traffic + audit.viewed self-emits.
    const ours = auditItems.filter(
      (e) => e.metadata?.trainingId === trainingId,
    );
    void t0; // kept for backward compat with prior smoke pattern; unused

    const requiredTypes = [
      'staff.training.created',
      'staff.training.edited',
      'staff.training.deleted',
    ];
    for (const t of requiredTypes) {
      const ev = ours.find((e) => e.eventType === t);
      check(`audit event present: ${t}`, !!ev, ev ? { metadata: ev.metadata } : 'missing');
      if (ev) assertNoPiiInMetadata(t, ev.metadata);
    }

    // Status-change should produce edited event with before/after
    const statusEv = ours.find(
      (e) =>
        e.eventType === 'staff.training.edited' &&
        Array.isArray(e.metadata?.changedFields) &&
        (e.metadata!.changedFields as unknown[]).includes('status'),
    );
    check(
      'audit event: status PATCH emits staff.training.edited with before/after',
      !!statusEv &&
        (statusEv.metadata as any)?.before?.status !== undefined &&
        (statusEv.metadata as any)?.after?.status === 'cancelled',
      statusEv ? { metadata: statusEv.metadata } : 'missing',
    );

    // Hard-delete metadata: softDelete:false
    const delEv = ours.find((e) => e.eventType === 'staff.training.deleted');
    check(
      'audit event: deleted has softDelete=false (hard delete)',
      delEv?.metadata?.softDelete === false,
      delEv ? { metadata: delEv.metadata } : 'missing',
    );
  } finally {
    // ── Cleanup temp staff ────────────────────────────────────────────────
    console.log('\n— Cleanup —');
    const del = await call('DELETE', `/staff/${staffId}`);
    if (ok2xx(del.status)) {
      console.log(`  ✓ deleted temp staff ${staffId}`);
    } else {
      console.log(`  ! could not delete temp staff ${staffId} (status ${del.status}) — manual cleanup may be needed`);
    }
  }

  console.log(`\n${fails.length === 0 ? '✓ ALL SPRINT-B SMOKE CHECKS GREEN' : `✗ ${fails.length} FAILURES`}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('crash:', e?.message ?? e); process.exit(2); });
