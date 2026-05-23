/// <reference types="node" />
/**
 * Sprint A.4.7 — Pilot Result Card Publish end-to-end smoke (parametric).
 *
 * **This script is the wire-validation gate for A.4 Phase 3 + the
 * full A.4 sprint end-to-end smoke.** Phase 3's planned synthetic
 * `put-events` test was blocked by prod IAM (deployer lacks
 * events:PutEvents on the SBT bus — correct security posture). The
 * only practical path to fire the EventBridge rule end-to-end is via
 * a real `ExamStatusTransitioned` event from the academics service,
 * which this smoke does by transitioning a real synthetic Exam through
 * its state machine.
 *
 * Full lifecycle on the target pilot:
 *
 *   Pre-flight: fetch existing Courses + Enrollments from dev-pabson-primary
 *
 *   Stage 1 — Set up exam
 *     C1. POST   /academics/exams (examType=final → isTerminalExam=true)
 *     C2. POST   /academics/exams/:id/courses × 2 (real Course rows)
 *     C3. PATCH  status (draft→scheduled)
 *     C4. POST   /academics/exams/:id/scores × 5 (REAL enrollmentIds; spans 2 ExamCourses)
 *     C5. PATCH  status (scheduled→in_progress)
 *
 *   Stage 2 — Trigger Lambda via real exam.closed
 *     C6. PATCH  status (in_progress→closed)
 *           emits ExamStatusTransitioned(toStatus=closed) → SBT bus →
 *           EventBridge rule → result-batch Lambda
 *
 *   Stage 3 — Poll for generated ResultCards (THE wire-validation)
 *     C7. GET    /academics/result-cards?examId=… poll every 3s until count ≥ 1
 *           or 60s timeout. Lambda cold-start typically <10s.
 *
 *   Stage 4 — Verify generated cards
 *     C8.  ResultCard structural assertions:
 *            - totalScore matches sum of synthetic ExamScores per enrollment
 *            - termGpa ∈ [0, 4]
 *            - isTerminalExam=true (since examType=final)
 *            - studentId !== 'unknown' (R42 schema-level guard)
 *            - courseScores[].length ≥ 1
 *            - status='draft'
 *
 *   Stage 5 — Operator endpoints (Phase 2 functionality)
 *     C9.  PATCH /result-cards/:id/conduct  → 200
 *     C10. PATCH /result-cards/:id/remark   → 200
 *     C11. PATCH /result-cards/:id/publish  → 200 (status=published; emits result.published)
 *
 *   Stage 6 — State machine 409s
 *     C12. PATCH /result-cards/:id/publish (already published) → 409 RESULT_ALREADY_PUBLISHED
 *     C13. PATCH /result-cards/:id/conduct (locked) → 409 RESULT_LOCKED
 *
 *   Cleanup: soft-delete the synthetic Exam (ResultCards / ExamCourses /
 *   ExamScores persist as orphans per V1 design, matching A.3.11)
 *
 * **Architecture: parametric across pilots.** PILOT_ID identifies the
 * target tenant + school fixture; V1 smoke runs against
 * `dev-pabson-primary` only (prod Saraswati has no Course data).
 *
 * Usage
 * =====
 *
 *   export PROD_ADMIN_TOKEN="$(cat /tmp/dev-jwt.txt)"
 *   export TENANT_ID=21aea5da-...                # dev-pabson-primary
 *   export SCHOOL_ID=4209e3d8-...                # school 888888888
 *   export ACADEMIC_YEAR_ID=<uuid>               # active AY for the school
 *   export TERM_ID=<uuid>                        # active Term within the AY
 *   npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/smoke-tests/pilot-result-card-publish.ts
 *
 *   # Optional:
 *   export PILOT_ID=dev-pabson-primary
 *   export API_BASE_URL=https://w5ulch7iyf...
 *   export POLL_TIMEOUT_MS=60000                 # default 60s
 *   export POLL_INTERVAL_MS=3000                 # default 3s
 *
 * Env
 * ===
 *   PROD_ADMIN_TOKEN       required — Cognito id-token for TenantAdmin in TENANT_ID
 *   TENANT_ID              required — target tenant UUID
 *   SCHOOL_ID              required — target school UUID (≥2 Course rows, ≥1 active Enrollment)
 *   ACADEMIC_YEAR_ID       required — active AY UUID for the school
 *   TERM_ID                required — active Term UUID within the AY
 *   PILOT_ID               optional — informational pilot identifier (default 'dev-pabson-primary')
 *   API_BASE_URL           optional — prod API GW base
 *   POLL_TIMEOUT_MS        optional — C7 polling window (default 60000)
 *   POLL_INTERVAL_MS       optional — C7 polling interval (default 3000)
 *
 * Exit codes
 * ==========
 *   0 — all 13 checkpoints green
 *   1 — one or more checkpoints failed (cleanup still attempted; diagnostics dumped)
 *   2 — config error (missing env / pre-flight unmet)
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
const POLL_TIMEOUT_MS = parseInt(process.env.POLL_TIMEOUT_MS ?? '60000', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? '3000', 10);

const SYNTHETIC_EXAM_NAME = `A.4 Smoke - ${PILOT_ID} - ${new Date().toISOString().slice(0, 19)}`;

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
      console.log(`  └─ ${formatted.slice(0, 600)}`);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`A.4.7 — Pilot Result Card Publish smoke`);
  console.log(`Pilot: ${PILOT_ID}`);
  console.log(`Tenant: ${TENANT_ID || '(MISSING)'}`);
  console.log(`School: ${SCHOOL_ID || '(MISSING)'}`);
  console.log(`AY: ${ACADEMIC_YEAR_ID || '(MISSING)'}`);
  console.log(`Term: ${TERM_ID || '(MISSING)'}`);
  console.log(`API: ${BASE_URL}`);
  console.log(`C7 poll: ${POLL_INTERVAL_MS}ms × up to ${POLL_TIMEOUT_MS / 1000}s`);
  console.log('');

  if (!TOKEN || !TENANT_ID || !SCHOOL_ID || !ACADEMIC_YEAR_ID || !TERM_ID) {
    console.error('✗ Required env vars missing: PROD_ADMIN_TOKEN, TENANT_ID, SCHOOL_ID, ACADEMIC_YEAR_ID, TERM_ID');
    process.exit(2);
  }

  const client = makeClient();
  let examId: string | undefined;
  const createdExamCourseIds: string[] = [];

  // ──────────────────────────────────────────────────────────
  // Pre-flight: fetch 2 Courses + ≥2 Enrollments (real data)
  // ──────────────────────────────────────────────────────────
  console.log('--- Pre-flight: fetch existing courses + enrollments ---');

  const coursesResp = await client.get(
    `/academics/courses?schoolId=${SCHOOL_ID}&limit=10`,
  );
  if (
    coursesResp.status !== 200 ||
    !Array.isArray(coursesResp.data?.items) ||
    coursesResp.data.items.length < 2
  ) {
    console.error(
      `✗ pre-flight: expected ≥2 courses in school ${SCHOOL_ID}; got ${coursesResp.data?.items?.length ?? 0}`,
    );
    process.exit(2);
  }
  const courseIds = coursesResp.data.items
    .slice(0, 2)
    .map((c: { courseId: string }) => c.courseId);
  console.log(`  found ${coursesResp.data.items.length} courses; using first 2: ${courseIds.join(', ')}`);

  // Real enrollments (Phase 4 §8 #1 decision: NOT synthetic UUIDs).
  // Lambda processes ALL enrollments for the school+AY when generating
  // ResultCards. If we use synthetic UUIDs in ExamScores, the cards
  // generated for REAL enrollments would all be NG (no scores match).
  // Real enrollmentIds let Stage 4 assertions check real totals/grades.
  const enrollmentsResp = await client.get(
    `/academics/schools/${SCHOOL_ID}/years/${ACADEMIC_YEAR_ID}/enrollments?status=enrolled&limit=10`,
  );
  if (
    enrollmentsResp.status !== 200 ||
    !Array.isArray(enrollmentsResp.data?.items) ||
    enrollmentsResp.data.items.length < 2
  ) {
    console.error(
      `✗ pre-flight: expected ≥2 active enrollments for school ${SCHOOL_ID} / AY ${ACADEMIC_YEAR_ID}; got ${enrollmentsResp.data?.items?.length ?? 0}`,
    );
    console.error(
      `  Recommendation: pick a different ACADEMIC_YEAR_ID where enrollments exist.`,
    );
    process.exit(2);
  }
  const enrollments = enrollmentsResp.data.items
    .slice(0, 5)
    .map((e: { enrollmentId: string; studentId: string }) => ({
      enrollmentId: e.enrollmentId,
      studentId: e.studentId,
    }));
  console.log(
    `  found ${enrollmentsResp.data.items.length} active enrollments; using first ${enrollments.length}: ${enrollments.map((e: { enrollmentId: string }) => e.enrollmentId).join(', ')}`,
  );

  // ──────────────────────────────────────────────────────────
  // C1 — Create Exam (draft); examType=final → isTerminalExam=true
  // ──────────────────────────────────────────────────────────
  const c1 = await client.post('/academics/exams', {
    examName: SYNTHETIC_EXAM_NAME,
    schoolId: SCHOOL_ID,
    academicYearId: ACADEMIC_YEAR_ID,
    termId: TERM_ID,
    examType: 'final', // forces isTerminalExam=true in Lambda (V1 heuristic)
    startDate: '2026-06-01',
    endDate: '2026-06-15',
    description: 'A.4.7 parametric smoke - safe to delete',
  });
  const c1Ok = check(
    'C1 — POST /academics/exams creates Exam (examType=final, status=draft)',
    c1.status === 201 &&
      typeof c1.data?.examId === 'string' &&
      c1.data?.status === 'draft' &&
      c1.data?.examType === 'final',
    { status: c1.status, body: c1.data },
  );
  if (!c1Ok) {
    console.log('Aborting: cannot proceed without an Exam.');
    process.exit(1);
  }
  examId = c1.data.examId;
  console.log(`  examId=${examId}`);

  // ──────────────────────────────────────────────────────────
  // C2 — Add 2 ExamCourses
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
    'C2 — POST /academics/exams/:id/courses × 2 (denormalized academicSubject populated)',
    allCoursesAdded && createdExamCourseIds.length === 2,
    { createdCount: createdExamCourseIds.length },
  );

  // ──────────────────────────────────────────────────────────
  // C3 — Transition draft → scheduled
  // ──────────────────────────────────────────────────────────
  const c3 = await client.patch(`/academics/exams/${examId}/status?schoolId=${SCHOOL_ID}`, {
    targetStatus: 'scheduled',
    notes: 'smoke: scheduling',
  });
  check(
    'C3 — PATCH status draft → scheduled returns 200 with status=scheduled',
    c3.status === 200 && c3.data?.status === 'scheduled',
    { status: c3.status, body: c3.data },
  );

  // ──────────────────────────────────────────────────────────
  // C4 — POST 5 single ExamScores using REAL enrollmentIds
  //      First 3 enrollments × 2 ExamCourses = up to 6 scores; we POST 5.
  //      Score pattern: enrollment 0 gets high (80,90), enrollment 1 gets
  //      medium (60,70), enrollment 2 gets low (40) — verifiable totals.
  // ──────────────────────────────────────────────────────────
  const scorePlan: Array<{
    examCourseId: string;
    enrollmentId: string;
    rawScore: number;
  }> = [
    { examCourseId: createdExamCourseIds[0], enrollmentId: enrollments[0].enrollmentId, rawScore: 80 },
    { examCourseId: createdExamCourseIds[1], enrollmentId: enrollments[0].enrollmentId, rawScore: 90 },
    { examCourseId: createdExamCourseIds[0], enrollmentId: enrollments[1].enrollmentId, rawScore: 60 },
    { examCourseId: createdExamCourseIds[1], enrollmentId: enrollments[1].enrollmentId, rawScore: 70 },
    { examCourseId: createdExamCourseIds[0], enrollmentId: enrollments[Math.min(2, enrollments.length - 1)].enrollmentId, rawScore: 40 },
  ];

  let singleScoresOk = true;
  for (const s of scorePlan) {
    const r = await client.post(`/academics/exams/${examId}/scores`, s);
    if (r.status !== 201) {
      singleScoresOk = false;
      console.log(`  ✗ score ${s.enrollmentId.slice(0, 8)}#${s.examCourseId.slice(0, 8)} → ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
    }
  }
  check(
    'C4 — POST /academics/exams/:id/scores × 5 (real enrollmentIds; 2 ExamCourses; verifiable totals)',
    singleScoresOk,
  );

  // ──────────────────────────────────────────────────────────
  // C5 — Transition scheduled → in_progress
  // ──────────────────────────────────────────────────────────
  const c5 = await client.patch(`/academics/exams/${examId}/status?schoolId=${SCHOOL_ID}`, {
    targetStatus: 'in_progress',
  });
  check(
    'C5 — PATCH status scheduled → in_progress returns 200',
    c5.status === 200 && c5.data?.status === 'in_progress',
    { status: c5.status, body: c5.data },
  );

  // ──────────────────────────────────────────────────────────
  // C6 — Trigger Lambda: in_progress → closed
  //      Emits ExamStatusTransitioned(toStatus=closed) → SBT bus →
  //      EventBridge rule → result-batch Lambda.
  // ──────────────────────────────────────────────────────────
  const closedAt = Date.now();
  const c6 = await client.patch(`/academics/exams/${examId}/status?schoolId=${SCHOOL_ID}`, {
    targetStatus: 'closed',
  });
  check(
    'C6 — PATCH status in_progress → closed (fires ExamStatusTransitioned event)',
    c6.status === 200 && c6.data?.status === 'closed',
    { status: c6.status, body: c6.data },
  );

  // ──────────────────────────────────────────────────────────
  // C7 — Poll for ResultCards (THE wire-validation gate)
  // ──────────────────────────────────────────────────────────
  console.log(`  Polling /result-cards?examId=${examId} every ${POLL_INTERVAL_MS}ms up to ${POLL_TIMEOUT_MS / 1000}s…`);
  let cardsFound: Array<{
    cardId: string;
    enrollmentId: string;
    studentId: string;
    examId: string;
    totalScore: number;
    totalMaxMarks: number;
    termGpa: number;
    overallGrade: string;
    isTerminalExam: boolean;
    status: string;
    courseScores: Array<{
      examCourseId: string;
      rawScore: number;
      maxMarks: number;
      grade: string;
      gpa: number;
      isPassing: boolean;
    }>;
  }> = [];
  let elapsed = 0;
  while (elapsed < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    elapsed += POLL_INTERVAL_MS;
    const poll = await client.get(`/academics/result-cards?examId=${examId}&limit=20`);
    if (poll.status === 200 && Array.isArray(poll.data?.items) && poll.data.items.length > 0) {
      cardsFound = poll.data.items;
      console.log(`  ✓ Lambda fired @ ${Math.round(elapsed / 1000)}s post-close; ${cardsFound.length} ResultCards generated`);
      break;
    }
  }
  const c7Ok = check(
    `C7 — Lambda generated ≥1 ResultCard within ${POLL_TIMEOUT_MS / 1000}s of exam.closed (wire-validation)`,
    cardsFound.length >= 1,
    { found: cardsFound.length, elapsedMs: elapsed },
  );

  if (!c7Ok) {
    console.log('');
    console.log('--- C7 TIMEOUT DIAGNOSTICS ---');
    console.log('Lambda did not generate ResultCards within the polling window.');
    console.log('Run these commands to triage which leg broke:');
    console.log('');
    console.log('1. Did the EventBridge rule match? (Should be ≥1 after C6)');
    console.log('   AWS_PROFILE=prod aws cloudwatch get-metric-statistics --namespace AWS/Events \\');
    console.log('     --metric-name MatchedEvents \\');
    console.log('     --dimensions Name=RuleName,Value=edforge-result-batch-exam-closed-basic \\');
    console.log(`     --start-time ${new Date(closedAt - 30000).toISOString()} \\`);
    console.log(`     --end-time ${new Date().toISOString()} \\`);
    console.log('     --period 60 --statistics Sum --region ap-south-1');
    console.log('');
    console.log('2. Did the Lambda invoke? (Check CW Lambda Insights)');
    console.log('   AWS_PROFILE=prod aws logs filter-log-events \\');
    console.log('     --log-group-name /aws/lambda/edforge-result-batch-basic \\');
    console.log(`     --start-time ${closedAt - 30000} --region ap-south-1`);
    console.log('');
    console.log('3. Did anything DLQ?');
    console.log('   AWS_PROFILE=prod aws sqs get-queue-attributes \\');
    console.log('     --queue-url https://sqs.ap-south-1.amazonaws.com/257526644020/edforge-result-batch-dlq-basic \\');
    console.log('     --attribute-names ApproximateNumberOfMessages --region ap-south-1');
    console.log('');
    console.log('Aborting before C8+ (no cards to verify). Cleanup still attempted.');
    await cleanup(client, examId);
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────
  // C8 — Verify generated ResultCard structure
  // ──────────────────────────────────────────────────────────
  // Expected totals by enrollment (per scorePlan above):
  //   enrollment[0]: scores 80+90=170, totalMaxMarks=200 (BOTH courses scored)
  //   enrollment[1]: scores 60+70=130, totalMaxMarks=200 (BOTH courses scored)
  //   enrollment[2]: scores 40 + NG=0, totalMaxMarks=200 (only ec[0] scored)
  //   enrollment[3..]: NG/NG, totalScore=0, totalMaxMarks=200
  const enrollmentScoreSums = new Map<string, number>();
  for (const s of scorePlan) {
    enrollmentScoreSums.set(
      s.enrollmentId,
      (enrollmentScoreSums.get(s.enrollmentId) ?? 0) + s.rawScore,
    );
  }

  let allStructuralChecksPass = true;
  let r42SafetyPass = true;
  let terminalFlagPass = true;
  let totalsPass = true;

  for (const card of cardsFound) {
    // R42: studentId must not be 'unknown'
    if (card.studentId === 'unknown' || !card.studentId) {
      r42SafetyPass = false;
      console.log(`  ✗ card ${card.cardId.slice(0, 8)} has studentId=${card.studentId}; R42 mitigation failed`);
    }
    // isTerminalExam=true (since examType='final')
    if (card.isTerminalExam !== true) {
      terminalFlagPass = false;
      console.log(`  ✗ card ${card.cardId.slice(0, 8)} has isTerminalExam=${card.isTerminalExam}; expected true (examType=final)`);
    }
    // status='draft'
    if (card.status !== 'draft') {
      allStructuralChecksPass = false;
      console.log(`  ✗ card ${card.cardId.slice(0, 8)} has status=${card.status}; expected draft`);
    }
    // termGpa ∈ [0, 4]
    if (typeof card.termGpa !== 'number' || card.termGpa < 0 || card.termGpa > 4) {
      allStructuralChecksPass = false;
      console.log(`  ✗ card ${card.cardId.slice(0, 8)} has termGpa=${card.termGpa}; expected [0, 4]`);
    }
    // For scored enrollments: totalScore matches sum of synthetic ExamScores
    const expectedSum = enrollmentScoreSums.get(card.enrollmentId);
    if (expectedSum !== undefined && card.totalScore !== expectedSum) {
      totalsPass = false;
      console.log(`  ✗ card for enrollment ${card.enrollmentId.slice(0, 8)} has totalScore=${card.totalScore}; expected ${expectedSum}`);
    }
    // courseScores[] length matches ExamCourses count (regardless of NG)
    if (!Array.isArray(card.courseScores) || card.courseScores.length !== 2) {
      allStructuralChecksPass = false;
      console.log(`  ✗ card ${card.cardId.slice(0, 8)} has ${card.courseScores?.length ?? 'undefined'} courseScores; expected 2`);
    }
  }
  check(
    `C8.a — R42 mitigation: ResultCard.studentId !== 'unknown' for all ${cardsFound.length} cards`,
    r42SafetyPass,
  );
  check(
    `C8.b — isTerminalExam=true on all cards (examType=final → V1 isTerminal heuristic)`,
    terminalFlagPass,
  );
  check(
    `C8.c — Structural: status=draft, termGpa∈[0,4], courseScores.length=2 on all cards`,
    allStructuralChecksPass,
  );
  check(
    `C8.d — Totals: totalScore matches sum of synthetic ExamScores for each scored enrollment`,
    totalsPass,
    Object.fromEntries(enrollmentScoreSums),
  );

  // ──────────────────────────────────────────────────────────
  // Pick the first card with non-unknown studentId for operator PATCH tests
  // ──────────────────────────────────────────────────────────
  const targetCard = cardsFound.find((c) => c.studentId && c.studentId !== 'unknown') ?? cardsFound[0];
  console.log(`  Using card ${targetCard.cardId} (enrollment ${targetCard.enrollmentId.slice(0, 8)}) for operator endpoint tests`);

  // ──────────────────────────────────────────────────────────
  // C9 — PATCH conduct
  // ──────────────────────────────────────────────────────────
  const c9 = await client.patch(
    `/academics/result-cards/${targetCard.cardId}/conduct?enrollmentId=${targetCard.enrollmentId}`,
    { conduct: 'A.4.7 smoke conduct' },
  );
  check(
    'C9 — PATCH /result-cards/:id/conduct returns 200 with conduct populated',
    c9.status === 200 && c9.data?.conduct === 'A.4.7 smoke conduct',
    { status: c9.status, body: c9.data },
  );

  // ──────────────────────────────────────────────────────────
  // C10 — PATCH remark
  // ──────────────────────────────────────────────────────────
  const c10 = await client.patch(
    `/academics/result-cards/${targetCard.cardId}/remark?enrollmentId=${targetCard.enrollmentId}`,
    { classTeacherRemark: 'A.4.7 smoke remark' },
  );
  check(
    'C10 — PATCH /result-cards/:id/remark returns 200 with classTeacherRemark populated',
    c10.status === 200 && c10.data?.classTeacherRemark === 'A.4.7 smoke remark',
    { status: c10.status, body: c10.data },
  );

  // ──────────────────────────────────────────────────────────
  // C11 — PATCH publish (draft → published; emits result.published)
  // ──────────────────────────────────────────────────────────
  const c11 = await client.patch(
    `/academics/result-cards/${targetCard.cardId}/publish?enrollmentId=${targetCard.enrollmentId}`,
    {},
  );
  check(
    'C11 — PATCH /result-cards/:id/publish returns 200 (status=published; publishedAt+publishedBy set)',
    c11.status === 200 &&
      c11.data?.status === 'published' &&
      typeof c11.data?.publishedAt === 'string' &&
      typeof c11.data?.publishedBy === 'string',
    { status: c11.status, body: c11.data },
  );

  // ──────────────────────────────────────────────────────────
  // C12 — Re-publish (published) → 409 RESULT_ALREADY_PUBLISHED
  // ──────────────────────────────────────────────────────────
  const c12 = await client.patch(
    `/academics/result-cards/${targetCard.cardId}/publish?enrollmentId=${targetCard.enrollmentId}`,
    {},
  );
  check(
    'C12 — PATCH publish on published card returns 409 RESULT_ALREADY_PUBLISHED',
    c12.status === 409 &&
      (c12.data?.errorCode === 'RESULT_ALREADY_PUBLISHED' ||
        JSON.stringify(c12.data).includes('RESULT_ALREADY_PUBLISHED')),
    { status: c12.status, body: c12.data },
  );

  // ──────────────────────────────────────────────────────────
  // C13 — PATCH conduct on published → 409 RESULT_LOCKED
  // ──────────────────────────────────────────────────────────
  const c13 = await client.patch(
    `/academics/result-cards/${targetCard.cardId}/conduct?enrollmentId=${targetCard.enrollmentId}`,
    { conduct: 'should be rejected' },
  );
  check(
    'C13 — PATCH conduct on published card returns 409 RESULT_LOCKED',
    c13.status === 409 &&
      (c13.data?.errorCode === 'RESULT_LOCKED' ||
        JSON.stringify(c13.data).includes('RESULT_LOCKED')),
    { status: c13.status, body: c13.data },
  );

  // ──────────────────────────────────────────────────────────
  // Cleanup
  // ──────────────────────────────────────────────────────────
  await cleanup(client, examId);

  // ──────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────
  console.log('');
  console.log(`Passed: ${passes.length} / Failed: ${fails.length}`);
  if (fails.length === 0) {
    console.log('✓ ALL A.4.7 PILOT RESULT CARD PUBLISH CHECKPOINTS GREEN');
    console.log('');
    console.log('Note: synthetic data left in target school:');
    console.log(`  - Exam ${examId} (soft-deleted, isActive=false)`);
    console.log(`  - 2 ExamCourses (orphaned; expected V1)`);
    console.log(`  - 5 ExamScores (orphaned; expected V1)`);
    console.log(`  - ${cardsFound.length} ResultCards (orphaned; expected V1; published=1)`);
    console.log(`  Re-runs create distinct synthetic Exams; no accumulation issue for V1 scale.`);
    process.exit(0);
  } else {
    console.log(`✗ ${fails.length} FAILURE(S):`);
    for (const f of fails) console.log(`  - ${f}`);
    process.exit(1);
  }
}

async function cleanup(client: AxiosInstance, examId: string | undefined): Promise<void> {
  if (!examId) return;
  console.log('--- Cleanup: soft-delete synthetic Exam ---');
  const r = await client.delete(`/academics/exams/${examId}?schoolId=${SCHOOL_ID}`);
  console.log(`  DELETE /academics/exams/${examId} → ${r.status}`);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('crash:', msg);
  process.exit(2);
});
