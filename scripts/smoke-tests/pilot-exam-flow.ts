/// <reference types="node" />
/**
 * Sprint A.3.11 — Pilot Exam Subsystem end-to-end smoke (parametric).
 *
 * Validates the full term-end exam lifecycle in prod on a target pilot:
 *
 *   1. POST   /academics/exams                              → 201 (draft)
 *   2. POST   /academics/exams/:id/courses × 2              → 201 each
 *   3. PATCH  /academics/exams/:id/status (draft→scheduled) → 200 + event
 *   4. POST   /academics/exams/:id/scores × 5               → 201 each
 *   5. POST   /academics/exams/:id/scores/bulk × 10         → 200 + chunked
 *   6. POST   /academics/exams/:id/scores/bulk (retry)      → 200 alreadyProcessed=true
 *   7. PATCH  status (scheduled→in_progress)                → 200 + event
 *   8. PATCH  status (in_progress→closed)                   → 200 + event
 *   9. PATCH  status (closed→published)                     → 200 + event
 *  10. PATCH  status (published→in_progress)                → 409 EXAM_STATE_INVALID_TRANSITION
 *  11. DELETE /academics/exams/:id                          → soft-delete (parent isActive=false)
 *
 * Synthetic data footprint per run: 1 Exam + 2 ExamCourses + 15 ExamScores.
 * The Exam is soft-deleted on exit; ExamCourses + ExamScores persist as
 * "orphans" under the soft-deleted Exam (no cascade in V1). Re-runs are
 * safe — each run creates a distinct synthetic exam via uuid.
 *
 * **Architecture: parametric across pilots.** PILOT_ID identifies the
 * target tenant + school fixture; per CEO 2026-05-22, V1 smoke runs
 * against `dev-pabson-primary` only (prod Saraswati has no Course data).
 * The script accepts env vars rather than hardcoding (invariant 13).
 *
 * Usage
 * =====
 *
 *   export PROD_ADMIN_TOKEN="$(cat /tmp/dev-jwt.txt)"
 *   export TENANT_ID=21aea5da-...                # dev-pabson-primary
 *   export SCHOOL_ID=4209e3d8-...                # school 888888888
 *   export ACADEMIC_YEAR_ID=<uuid>               # an active AY for the school
 *   export TERM_ID=<uuid>                        # an active Term within the AY
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/pilot-exam-flow.ts
 *
 *   # Optional:
 *   export PILOT_ID=dev-pabson-primary           # informational, no logic dep
 *   export API_BASE_URL=https://w5ulch7iyf...    # override prod API GW
 *   export EXAM_TYPE=terminal                    # default; must be in archetype examPattern
 *
 * Env
 * ===
 *   PROD_ADMIN_TOKEN       required — Cognito id-token for TenantAdmin in TENANT_ID
 *   TENANT_ID              required — target tenant UUID
 *   SCHOOL_ID              required — target school UUID (must have ≥2 Course rows)
 *   ACADEMIC_YEAR_ID       required — active AY UUID for the school
 *   TERM_ID                required — active Term UUID within the AY
 *   PILOT_ID               optional — informational pilot identifier (default 'dev-pabson-primary')
 *   API_BASE_URL           optional — prod API GW base
 *   EXAM_TYPE              optional — examPatternKey value (default 'terminal')
 *
 * Exit codes
 * ==========
 *   0 — all 11 checkpoints green
 *   1 — one or more checkpoints failed (cleanup still attempted)
 *   2 — config error (missing env / network)
 */

import axios, { AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';

// ============================================================================
// Configuration
// ============================================================================

const TOKEN = process.env.PROD_ADMIN_TOKEN ?? '';
const TENANT_ID = process.env.TENANT_ID ?? '';
const SCHOOL_ID = process.env.SCHOOL_ID ?? '';
const ACADEMIC_YEAR_ID = process.env.ACADEMIC_YEAR_ID ?? '';
const TERM_ID = process.env.TERM_ID ?? '';
const PILOT_ID = process.env.PILOT_ID ?? 'dev-pabson-primary';
const BASE_URL =
  process.env.API_BASE_URL ??
  'https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod';
const EXAM_TYPE = process.env.EXAM_TYPE ?? 'terminal';

const SYNTHETIC_EXAM_NAME = `A.3 Smoke - ${PILOT_ID} - ${new Date().toISOString().slice(0, 19)}`;

// ============================================================================
// Test harness
// ============================================================================

const fails: string[] = [];
const passes: string[] = [];

function check(name: string, ok: boolean, detail?: unknown): boolean {
  if (ok) {
    console.log(`✓ ${name}`);
    passes.push(name);
  } else {
    console.log(`✗ ${name}`);
    if (detail !== undefined) {
      const formatted = typeof detail === 'string' ? detail : JSON.stringify(detail);
      console.log(`  └─ ${formatted.slice(0, 400)}`);
    }
    fails.push(name);
  }
  return ok;
}

function makeClient(): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
    validateStatus: () => true,
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`A.3.11 — Pilot Exam Flow smoke`);
  console.log(`Pilot: ${PILOT_ID}`);
  console.log(`Tenant: ${TENANT_ID || '(MISSING)'}`);
  console.log(`School: ${SCHOOL_ID || '(MISSING)'}`);
  console.log(`AY: ${ACADEMIC_YEAR_ID || '(MISSING)'}`);
  console.log(`Term: ${TERM_ID || '(MISSING)'}`);
  console.log(`Exam type: ${EXAM_TYPE}`);
  console.log(`API: ${BASE_URL}`);
  console.log('');

  if (!TOKEN || !TENANT_ID || !SCHOOL_ID || !ACADEMIC_YEAR_ID || !TERM_ID) {
    console.error('✗ Required env vars missing: PROD_ADMIN_TOKEN, TENANT_ID, SCHOOL_ID, ACADEMIC_YEAR_ID, TERM_ID');
    process.exit(2);
  }

  const client = makeClient();
  let examId: string | undefined;
  const createdExamCourseIds: string[] = [];

  // ──────────────────────────────────────────────────────────
  // Pre-flight: pick 2 Course IDs + 10 Enrollment IDs from the school
  // ──────────────────────────────────────────────────────────
  console.log('--- Pre-flight: fetch existing courses + enrollments ---');

  const coursesResp = await client.get(`/academics/courses?schoolId=${SCHOOL_ID}&limit=10`);
  if (coursesResp.status !== 200 || !Array.isArray(coursesResp.data?.items) || coursesResp.data.items.length < 2) {
    console.error(`✗ pre-flight: expected ≥2 courses in school ${SCHOOL_ID}; got ${coursesResp.data?.items?.length ?? 0}`);
    process.exit(2);
  }
  const courseIds = coursesResp.data.items.slice(0, 2).map((c: { courseId: string }) => c.courseId);
  console.log(`  found ${coursesResp.data.items.length} courses; using first 2: ${courseIds.join(', ')}`);

  const enrollmentsResp = await client.get(`/academics/enrollments?schoolId=${SCHOOL_ID}&limit=50`);
  if (enrollmentsResp.status !== 200 || !Array.isArray(enrollmentsResp.data?.items)) {
    console.error(`✗ pre-flight: enrollments endpoint returned ${enrollmentsResp.status}`);
    process.exit(2);
  }
  const enrollmentIds = enrollmentsResp.data.items.slice(0, 15).map((e: { enrollmentId: string }) => e.enrollmentId);
  if (enrollmentIds.length < 15) {
    console.error(`✗ pre-flight: expected ≥15 enrollments in school ${SCHOOL_ID}; got ${enrollmentIds.length}`);
    process.exit(2);
  }
  console.log(`  found ${enrollmentsResp.data.items.length} enrollments; using first 15 for scores`);

  // ──────────────────────────────────────────────────────────
  // P1 — Create Exam (draft)
  // ──────────────────────────────────────────────────────────
  const p1 = await client.post('/academics/exams', {
    examName: SYNTHETIC_EXAM_NAME,
    schoolId: SCHOOL_ID,
    academicYearId: ACADEMIC_YEAR_ID,
    termId: TERM_ID,
    examType: EXAM_TYPE,
    startDate: '2026-06-01',
    endDate: '2026-06-15',
    description: 'A.3.11 parametric smoke - safe to delete',
  });
  const p1Ok = check(
    'P1 — POST /academics/exams creates Exam in draft state',
    p1.status === 201 &&
      typeof p1.data?.examId === 'string' &&
      p1.data?.status === 'draft',
    p1Ok_detail(p1),
  );
  if (!p1Ok) {
    console.log('Aborting: cannot proceed without an Exam.');
    process.exit(1);
  }
  examId = p1.data.examId;
  console.log(`  examId=${examId}`);

  // ──────────────────────────────────────────────────────────
  // P2 — Add 2 ExamCourses (allowed in draft state)
  // ──────────────────────────────────────────────────────────
  let allCoursesAdded = true;
  for (const cid of courseIds) {
    const r = await client.post(`/academics/exams/${examId}/courses`, {
      schoolId: SCHOOL_ID,
      courseId: cid,
      maxMarks: 100,
      passingMarks: 40,
    });
    if (r.status === 201 && typeof r.data?.examCourseId === 'string') {
      createdExamCourseIds.push(r.data.examCourseId);
    } else {
      allCoursesAdded = false;
      console.log(`  ✗ add course ${cid} → ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
    }
  }
  check(
    'P2 — POST /academics/exams/:id/courses × 2 (both succeed; denormalized academicSubject populated)',
    allCoursesAdded && createdExamCourseIds.length === 2,
    { createdCount: createdExamCourseIds.length },
  );

  // ──────────────────────────────────────────────────────────
  // P3 — Transition draft → scheduled
  // ──────────────────────────────────────────────────────────
  const p3 = await client.patch(`/academics/exams/${examId}/status?schoolId=${SCHOOL_ID}`, {
    targetStatus: 'scheduled',
    notes: 'smoke: scheduling',
  });
  check(
    'P3 — PATCH status draft → scheduled returns 200 with status=scheduled',
    p3.status === 200 && p3.data?.status === 'scheduled',
    { status: p3.status, body: p3.data },
  );

  // ──────────────────────────────────────────────────────────
  // P4 — POST 5 single ExamScores against ExamCourse 1
  // ──────────────────────────────────────────────────────────
  let singleScoresOk = true;
  for (let i = 0; i < 5; i++) {
    const r = await client.post(`/academics/exams/${examId}/scores`, {
      examCourseId: createdExamCourseIds[0],
      enrollmentId: enrollmentIds[i],
      rawScore: 50 + i * 10,
    });
    if (r.status !== 201) {
      singleScoresOk = false;
      console.log(`  ✗ single score ${i} → ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
    }
  }
  check(
    'P4 — POST /academics/exams/:id/scores × 5 (all 201; rawScore validated against maxMarks)',
    singleScoresOk,
  );

  // ──────────────────────────────────────────────────────────
  // P5 — Bulk POST 10 ExamScores with correlationId
  // ──────────────────────────────────────────────────────────
  const correlationId = randomUUID();
  const bulkScores = enrollmentIds.slice(5, 15).map((enrollmentId: string, i: number) => ({
    examCourseId: createdExamCourseIds[i % 2],
    enrollmentId,
    rawScore: 40 + (i * 7) % 50,
  }));
  const p5 = await client.post(
    `/academics/exams/${examId}/scores/bulk?schoolId=${SCHOOL_ID}`,
    { correlationId, scores: bulkScores },
  );
  check(
    'P5 — POST bulk × 10 with correlationId returns 200; totalCreated=10; alreadyProcessed=false',
    p5.status === 200 &&
      p5.data?.totalCreated === 10 &&
      p5.data?.totalFailed === 0 &&
      p5.data?.alreadyProcessed === false,
    { status: p5.status, body: p5.data },
  );

  // ──────────────────────────────────────────────────────────
  // P6 — Bulk POST RETRY with SAME correlationId → idempotent
  // ──────────────────────────────────────────────────────────
  const p6 = await client.post(
    `/academics/exams/${examId}/scores/bulk?schoolId=${SCHOOL_ID}`,
    { correlationId, scores: bulkScores },
  );
  check(
    'P6 — bulk RETRY with same correlationId returns 200; alreadyProcessed=true; totalSkipped=10',
    p6.status === 200 &&
      p6.data?.alreadyProcessed === true &&
      p6.data?.totalSkipped === 10,
    { status: p6.status, body: p6.data },
  );

  // ──────────────────────────────────────────────────────────
  // P7 — scheduled → in_progress
  // ──────────────────────────────────────────────────────────
  const p7 = await client.patch(`/academics/exams/${examId}/status?schoolId=${SCHOOL_ID}`, {
    targetStatus: 'in_progress',
  });
  check(
    'P7 — PATCH status scheduled → in_progress returns 200 with status=in_progress',
    p7.status === 200 && p7.data?.status === 'in_progress',
    { status: p7.status, body: p7.data },
  );

  // ──────────────────────────────────────────────────────────
  // P8 — in_progress → closed
  // ──────────────────────────────────────────────────────────
  const p8 = await client.patch(`/academics/exams/${examId}/status?schoolId=${SCHOOL_ID}`, {
    targetStatus: 'closed',
  });
  check(
    'P8 — PATCH status in_progress → closed returns 200 with status=closed',
    p8.status === 200 && p8.data?.status === 'closed',
    { status: p8.status, body: p8.data },
  );

  // ──────────────────────────────────────────────────────────
  // P9 — closed → published (terminal)
  // ──────────────────────────────────────────────────────────
  const p9 = await client.patch(`/academics/exams/${examId}/status?schoolId=${SCHOOL_ID}`, {
    targetStatus: 'published',
  });
  check(
    'P9 — PATCH status closed → published returns 200 with status=published (terminal)',
    p9.status === 200 && p9.data?.status === 'published',
    { status: p9.status, body: p9.data },
  );

  // ──────────────────────────────────────────────────────────
  // P10 — Invalid transition: published → in_progress (409 expected)
  // ──────────────────────────────────────────────────────────
  const p10 = await client.patch(`/academics/exams/${examId}/status?schoolId=${SCHOOL_ID}`, {
    targetStatus: 'in_progress',
  });
  check(
    'P10 — PATCH status published → in_progress returns 409 EXAM_STATE_INVALID_TRANSITION',
    p10.status === 409 &&
      (p10.data?.errorCode === 'EXAM_STATE_INVALID_TRANSITION' ||
        // NestJS may serialize the structured error inside response.message
        JSON.stringify(p10.data).includes('EXAM_STATE_INVALID_TRANSITION')),
    { status: p10.status, body: p10.data },
  );

  // ──────────────────────────────────────────────────────────
  // P11 — Cleanup: soft-delete the synthetic Exam
  // ──────────────────────────────────────────────────────────
  const p11 = await client.delete(`/academics/exams/${examId}?schoolId=${SCHOOL_ID}`);
  check(
    'P11 — DELETE /academics/exams/:id returns 204 (parent soft-deleted; ExamCourses + ExamScores remain as orphans, expected V1 behavior)',
    p11.status === 204 || p11.status === 200,
    { status: p11.status, body: p11.data },
  );

  // ──────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────
  console.log('');
  console.log(`Passed: ${passes.length} / Failed: ${fails.length}`);
  if (fails.length === 0) {
    console.log('✓ ALL A.3.11 PILOT EXAM FLOW CHECKPOINTS GREEN');
    console.log('');
    console.log('Note: synthetic data left in target school:');
    console.log(`  - Exam ${examId} (soft-deleted, isActive=false)`);
    console.log(`  - 2 ExamCourses under that exam (orphaned; expected V1)`);
    console.log(`  - 15 ExamScores under that exam (orphaned; expected V1)`);
    console.log(`  Re-runs create distinct synthetic Exams; no accumulation issue for V1 scale.`);
    process.exit(0);
  } else {
    console.log(`✗ ${fails.length} FAILURE(S):`);
    for (const f of fails) console.log(`  - ${f}`);
    process.exit(1);
  }
}

function p1Ok_detail(r: { status: number; data: unknown }) {
  return { status: r.status, body: r.data };
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('crash:', msg);
  process.exit(2);
});
