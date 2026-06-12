/**
 * S1.10 — demo tenant loader, integration against a CONTRACT-VALIDATING fake.
 *
 * The fake validates every POST/PATCH body against the real
 * @aibrains/shared-types create-schema, rejects unknown routes, enforces the
 * scores/bulk `?schoolId=` query + legal exam status transitions, and returns
 * the real GET envelopes ({items} / {schoolRoles} / {students}). So a green
 * run here means the loader's payloads + paths actually satisfy the API
 * contract — not just that the loader issued some request.
 */

import { randomUUID } from 'crypto';

import { z } from 'zod';
import {
  assignRoleSchema,
  bulkExamScoreSchema,
  createAcademicYearSchema,
  createCourseSchema,
  createEnrollmentSchema,
  createExamCourseSchema,
  createExamSchema,
  createFeeStructureSchema,
  createGradingPeriodSchema,
  createSchoolSchema,
  createSectionSchema,
  createStudentSchema,
  createUserSchema,
  enrollStudentInSectionSchema,
  generateInvoiceSchema,
  recordManualPaymentSchema,
} from '@aibrains/shared-types';

import { buildDemoTenant } from './generate';
import { ApiClient, ApiResponse, DemoSeeder, HttpMethod, SeederError } from './seeder';

type Row = Record<string, unknown>;
type Envelope = 'items' | 'schoolRoles' | 'students';

interface Route {
  method: HttpMethod;
  re: RegExp;
  schema?: z.ZodTypeAny;
  idField?: string;
  getEnvelope?: Envelope;
  /** Required query param (e.g. scores/bulk needs schoolId). */
  requireQuery?: string;
  /** POST store key override (e.g. payments/manual → /payments). */
  storeKey?: (p: string) => string;
  /** GET collection key override (e.g. scoped enrollment list). */
  getKey?: (p: string) => string;
  /** Marks the exam-status PATCH for legal-transition enforcement. */
  examStatus?: boolean;
}

const ROUTES: Route[] = [
  // GET collections (idempotency lists)
  { method: 'GET', re: /^\/schools$/, getEnvelope: 'items' },
  { method: 'GET', re: /^\/schools\/[^/]+\/academic-years$/, getEnvelope: 'items' },
  { method: 'GET', re: /^\/schools\/[^/]+\/academic-years\/[^/]+\/grading-periods$/, getEnvelope: 'items' },
  { method: 'GET', re: /^\/users$/, getEnvelope: 'items' },
  { method: 'GET', re: /^\/users\/[^/]+\/roles$/, getEnvelope: 'schoolRoles' },
  { method: 'GET', re: /^\/academics\/courses$/, getEnvelope: 'items' },
  { method: 'GET', re: /^\/academics\/sections$/, getEnvelope: 'items' },
  { method: 'GET', re: /^\/academics\/students$/, getEnvelope: 'items' },
  { method: 'GET', re: /^\/academics\/schools\/[^/]+\/years\/[^/]+\/enrollments$/, getEnvelope: 'items', getKey: () => '/academics/enrollments' },
  { method: 'GET', re: /^\/academics\/sections\/[^/]+\/students$/, getEnvelope: 'students' },
  { method: 'GET', re: /^\/academics\/exams$/, getEnvelope: 'items' },
  { method: 'GET', re: /^\/finance\/schools\/[^/]+\/fee-structures$/, getEnvelope: 'items' },
  { method: 'GET', re: /^\/finance\/schools\/[^/]+\/invoices$/, getEnvelope: 'items' },
  { method: 'GET', re: /^\/finance\/schools\/[^/]+\/payments$/, getEnvelope: 'items' },
  // POST creates (validated)
  { method: 'POST', re: /^\/schools$/, schema: createSchoolSchema, idField: 'schoolId' },
  { method: 'POST', re: /^\/schools\/[^/]+\/academic-years$/, schema: createAcademicYearSchema, idField: 'yearId' },
  { method: 'POST', re: /^\/schools\/[^/]+\/academic-years\/[^/]+\/grading-periods$/, schema: createGradingPeriodSchema, idField: 'termId' },
  { method: 'POST', re: /^\/users$/, schema: createUserSchema, idField: 'userId' },
  { method: 'POST', re: /^\/users\/[^/]+\/roles$/, schema: assignRoleSchema },
  { method: 'POST', re: /^\/academics\/courses$/, schema: createCourseSchema, idField: 'courseId' },
  { method: 'POST', re: /^\/academics\/sections$/, schema: createSectionSchema, idField: 'sectionId' },
  { method: 'POST', re: /^\/academics\/students$/, schema: createStudentSchema, idField: 'studentId' },
  { method: 'POST', re: /^\/academics\/enrollments$/, schema: createEnrollmentSchema, idField: 'enrollmentId' },
  { method: 'POST', re: /^\/academics\/sections\/[^/]+\/students$/, schema: enrollStudentInSectionSchema },
  { method: 'POST', re: /^\/academics\/exams$/, schema: createExamSchema, idField: 'examId' },
  { method: 'POST', re: /^\/academics\/exams\/[^/]+\/courses$/, schema: createExamCourseSchema, idField: 'examCourseId' },
  { method: 'POST', re: /^\/academics\/exams\/[^/]+\/scores\/bulk$/, schema: bulkExamScoreSchema, requireQuery: 'schoolId' },
  { method: 'POST', re: /^\/finance\/schools\/[^/]+\/fee-structures$/, schema: createFeeStructureSchema, idField: 'id' },
  { method: 'POST', re: /^\/finance\/schools\/[^/]+\/invoices$/, schema: generateInvoiceSchema, idField: 'id' },
  { method: 'POST', re: /^\/finance\/schools\/[^/]+\/payments\/manual$/, schema: recordManualPaymentSchema, idField: 'id', storeKey: (p) => p.replace(/\/manual$/, '') },
  // PATCH exam status (legal-transition enforced)
  { method: 'PATCH', re: /^\/academics\/exams\/[^/]+\/status$/, examStatus: true },
];

const LEGAL: Record<string, string[]> = {
  draft: ['scheduled'],
  scheduled: ['in_progress', 'draft'],
  in_progress: ['closed', 'scheduled'],
  closed: ['published'],
  published: [],
};

class ValidatingFake implements ApiClient {
  store = new Map<string, Row[]>();
  private examStatus = new Map<string, string>();
  validatedSchemas = new Set<string>();

  constructor(private readonly failOn?: (path: string, method: HttpMethod) => boolean) {}

  private norm(p: string): string {
    return p.split('?')[0];
  }

  async request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const p = this.norm(path);
    const route = ROUTES.find((r) => r.method === method && r.re.test(p));
    if (!route) return { status: 404, body: { error: `no route: ${method} ${p}` } as unknown as T };

    if (method === 'GET') {
      const key = route.getKey ? route.getKey(p) : p;
      const rows = this.store.get(key) ?? [];
      const env = route.getEnvelope ?? 'items';
      return { status: 200, body: { [env]: rows } as unknown as T };
    }

    if (this.failOn?.(p, method)) return { status: 400, body: { error: 'forced' } as unknown as T };

    if (route.requireQuery && !path.includes(`${route.requireQuery}=`)) {
      return { status: 400, body: { error: `missing query ${route.requireQuery}` } as unknown as T };
    }

    if (route.schema) {
      const parsed = route.schema.safeParse(body);
      if (!parsed.success) {
        return { status: 400, body: { error: 'schema', issues: parsed.error.issues.slice(0, 4) } as unknown as T };
      }
      this.validatedSchemas.add(p.replace(/[a-f0-9-]{16,}/gi, ':id'));
    }

    if (route.examStatus) {
      const examId = p.split('/')[3];
      const target = (body as Row)?.targetStatus as string;
      const current = this.examStatus.get(examId) ?? 'draft';
      if (!(LEGAL[current] ?? []).includes(target)) {
        return { status: 409, body: { error: `illegal transition ${current} -> ${target}` } as unknown as T };
      }
      this.examStatus.set(examId, target);
      return { status: 200, body: { ok: true } as unknown as T };
    }

    // scores/bulk is an action (no stored collection)
    if (p.endsWith('/scores/bulk')) return { status: 200, body: { ok: true } as unknown as T };

    const id = randomUUID();
    const row: Row = { id, ...(body as Row) };
    if (route.idField) row[route.idField] = id;
    if (p === '/academics/exams') this.examStatus.set(id, 'draft');
    const key = route.storeKey ? route.storeKey(p) : p;
    const arr = this.store.get(key) ?? [];
    arr.push(row);
    this.store.set(key, arr);
    return { status: 201, body: row as unknown as T };
  }
}

describe.each(['PABSON', 'GENERIC'] as const)('DemoSeeder — %s (contract-validated)', (archetype) => {
  const data = buildDemoTenant(archetype);

  it('seeds the full bundle; every payload passes the real create-schema', async () => {
    const fake = new ValidatingFake();
    const summary = await new DemoSeeder(fake).seed(data);

    expect(summary.created.school).toBe(1);
    expect(summary.created.academicYear).toBe(1);
    expect(summary.created.term).toBe(3);
    expect(summary.created.user).toBe(data.staff.length);
    expect(summary.created.roleAssignment).toBe(data.staff.length);
    expect(summary.created.course).toBe(data.courses.length);
    expect(summary.created.courseSection).toBe(data.courseSections.length);
    expect(summary.created.student).toBe(200);
    expect(summary.created.enrollment).toBe(200);
    expect(summary.created.exam).toBe(1);
    expect(summary.created.examCourse).toBe(data.examCourses.length);
    expect(summary.created.examScores).toBeGreaterThanOrEqual(1);
    expect(summary.created['examStatus:scheduled']).toBe(1);
    expect(summary.created['examStatus:in_progress']).toBe(1);
    expect(summary.created['examStatus:closed']).toBe(1);
    expect(summary.created['examStatus:published']).toBe(1);
    expect(summary.created.feeStructure).toBe(data.feeStructures.length);
    expect(summary.created.invoice).toBe(200);
    expect(summary.created.payment).toBe(data.payments.length);

    // Proof the fake actually validated the high-risk payloads.
    expect(fake.validatedSchemas.has('/schools')).toBe(true);
    expect(fake.validatedSchemas.has('/academics/exams/:id/courses')).toBe(true);
    expect(fake.validatedSchemas.has('/academics/exams/:id/scores/bulk')).toBe(true);
  });

  it('is idempotent — a second run against the same backend creates nothing', async () => {
    const fake = new ValidatingFake();
    await new DemoSeeder(fake).seed(data);
    const second = await new DemoSeeder(fake).seed(data);
    for (const [kind, count] of Object.entries(second.created)) {
      expect([kind, count]).toEqual([kind, 0]);
    }
    expect(second.skipped.student).toBe(200);
    expect(second.skipped.roleAssignment).toBe(data.staff.length);
    expect(second.skipped.enrollment).toBe(200);
    expect(second.skipped.payment).toBe(data.payments.length);
  });
});

describe('DemoSeeder — failure surfacing', () => {
  it('throws SeederError with kind + path + status when a create fails', async () => {
    const data = buildDemoTenant('GENERIC');
    const fake = new ValidatingFake((path, method) => path === '/schools' && method === 'POST');
    const err = await new DemoSeeder(fake).seed(data).catch((e) => e);
    expect(err).toBeInstanceOf(SeederError);
    expect(err.kind).toBe('school');
    expect(err.status).toBe(400);
  });

  it('surfaces an illegal exam status transition if the loader ever skips a step', async () => {
    // Directly prove the fake rejects the draft->published skip the old loader did.
    const fake = new ValidatingFake();
    const exam = await fake.request('POST', '/academics/exams', {});
    const examId = (exam.body as Row).id;
    const bad = await fake.request('PATCH', `/academics/exams/${examId}/status`, { targetStatus: 'published' });
    expect(bad.status).toBe(409);
  });

  it('rejects an unknown route (the loader cannot silently hit a non-existent endpoint)', async () => {
    const fake = new ValidatingFake();
    const res = await fake.request('POST', '/academics/not-a-real-endpoint', {});
    expect(res.status).toBe(404);
  });
});

describe('buildDemoTenant — determinism', () => {
  it.each(['PABSON', 'GENERIC'] as const)('%s: same seed → identical bundle', (a) => {
    expect(buildDemoTenant(a, 'x')).toEqual(buildDemoTenant(a, 'x'));
  });
});
