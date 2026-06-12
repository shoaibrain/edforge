/**
 * S1.10 — demo tenant loader (integration against an in-memory fake).
 *
 * Asserts the full bundle seeds in dependency order with refs resolved to
 * returned ids, a re-run is a no-op (idempotent), and a failing create
 * surfaces a SeederError with context.
 */

import { buildDemoTenant } from './generate';
import { ApiClient, ApiResponse, DemoSeeder, HttpMethod, SeederError } from './seeder';

type Row = Record<string, unknown>;

/** In-memory backend: RESTful collections keyed by path (query stripped). */
class FakeApiClient implements ApiClient {
  store = new Map<string, Row[]>();
  posts: Array<{ method: HttpMethod; path: string; body: unknown }> = [];
  private n = 0;

  constructor(private readonly failOn?: (path: string, method: HttpMethod) => boolean) {}

  private norm(path: string): string {
    return path.split('?')[0];
  }

  async request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const p = this.norm(path);
    if (method === 'GET') {
      return { status: 200, body: { items: this.store.get(p) ?? [] } as unknown as T };
    }
    this.posts.push({ method, path: p, body });
    if (this.failOn?.(p, method)) {
      return { status: 400, body: { error: 'forced failure' } as unknown as T };
    }
    if (method === 'PATCH') return { status: 200, body: { ok: true } as unknown as T };
    if (p.endsWith('/scores/bulk')) return { status: 200, body: { ok: true } as unknown as T };
    // payments/manual lands in the listable /payments collection
    const key = p.endsWith('/payments/manual') ? p.replace(/\/manual$/, '') : p;
    const id = `id-${++this.n}`;
    const row: Row = { id, ...(body as Row) };
    const arr = this.store.get(key) ?? [];
    arr.push(row);
    this.store.set(key, arr);
    return { status: 201, body: row as unknown as T };
  }
}

describe.each(['PABSON', 'GENERIC'] as const)('DemoSeeder — %s', (archetype) => {
  const data = buildDemoTenant(archetype);

  it('seeds the full bundle in dependency order, refs resolved to ids', async () => {
    const fake = new FakeApiClient();
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
    expect(summary.created.examScores).toBe(1);
    expect(summary.created.examPublish).toBe(1);
    expect(summary.created.feeStructure).toBe(data.feeStructures.length);
    expect(summary.created.invoice).toBe(200);
    expect(summary.created.payment).toBe(data.payments.length);

    // Foreign keys were resolved to returned ids, not left as local refs.
    const sectionPost = fake.posts.find((p) => p.path === '/academics/sections');
    const body = sectionPost!.body as Row;
    expect(String(body.courseId)).toMatch(/^id-\d+$/);
    expect(String(body.primaryTeacherId)).toMatch(/^id-\d+$/);

    // School create carried the reserved emis code + k12/private type.
    const schoolPost = fake.posts.find((p) => p.path === '/schools')!.body as Row;
    expect(String(schoolPost.emisSchoolCode)).toMatch(/^9999\d{4}$/);
  });

  it('is idempotent — a second run against the same backend creates nothing', async () => {
    const fake = new FakeApiClient();
    await new DemoSeeder(fake).seed(data);
    const second = await new DemoSeeder(fake).seed(data);

    for (const [kind, count] of Object.entries(second.created)) {
      expect([kind, count]).toEqual([kind, 0]);
    }
    expect(second.skipped.school).toBe(1);
    expect(second.skipped.student).toBe(200);
    expect(second.skipped.payment).toBe(data.payments.length);
  });

  it('can skip the heavy course-section membership + scores', async () => {
    const fake = new FakeApiClient();
    const summary = await new DemoSeeder(fake, {
      courseSectionMembership: false,
      recordScoresAndPublish: false,
    }).seed(data);
    expect(summary.created.sectionMembership).toBeUndefined();
    expect(summary.created.examScores).toBeUndefined();
    expect(summary.created.examPublish).toBeUndefined();
    // ...but the structural entities are still created.
    expect(summary.created.student).toBe(200);
  });
});

describe('DemoSeeder — failure surfacing', () => {
  it('throws a SeederError with kind + path + status when a create fails', async () => {
    const data = buildDemoTenant('GENERIC');
    const fake = new FakeApiClient((path, method) => path === '/schools' && method === 'POST');
    await expect(new DemoSeeder(fake).seed(data)).rejects.toBeInstanceOf(SeederError);
    const err = await new DemoSeeder(fake).seed(data).catch((e) => e);
    expect(err.kind).toBe('school');
    expect(err.path).toBe('/schools');
    expect(err.status).toBe(400);
  });

  it('surfaces a deep failure (student create) with context', async () => {
    const data = buildDemoTenant('GENERIC');
    const fake = new FakeApiClient((path, method) => path === '/academics/students' && method === 'POST');
    const err = await new DemoSeeder(fake).seed(data).catch((e) => e);
    expect(err).toBeInstanceOf(SeederError);
    expect(err.kind).toBe('student');
  });
});
