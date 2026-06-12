/**
 * S1.12 — demo tenant reset.
 *
 * seed → plant a non-demo row → reset → demo rows gone, non-demo survives,
 * re-seed → identical counts. Plus the confirmDemo guard.
 */

import { buildDemoTenant } from './generate';
import { ApiClient, ApiResponse, DemoSeeder, HttpMethod } from './seeder';
import { DemoReset, isDemoEmail, standardResetTargets } from './reset';

type Row = Record<string, unknown>;

/** Fake backend with DELETE support, for the seed→reset→re-seed cycle. */
class FakeApiClient implements ApiClient {
  store = new Map<string, Row[]>();
  private n = 0;
  private norm(p: string): string {
    return p.split('?')[0];
  }
  async request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const p = this.norm(path);
    if (method === 'GET') return { status: 200, body: { items: this.store.get(p) ?? [] } as unknown as T };
    if (method === 'PATCH') return { status: 200, body: { ok: true } as unknown as T };
    if (method === 'DELETE') {
      const id = p.split('/').pop()!;
      const collection = p.slice(0, p.lastIndexOf('/'));
      const arr = this.store.get(collection) ?? [];
      this.store.set(collection, arr.filter((r) => String(r.id) !== id && String(r.studentId) !== id && String(r.userId) !== id));
      return { status: 204, body: {} as T };
    }
    if (p.endsWith('/scores/bulk')) return { status: 200, body: { ok: true } as unknown as T };
    const key = p.endsWith('/payments/manual') ? p.replace(/\/manual$/, '') : p;
    const id = `id-${++this.n}`;
    const row: Row = { id, ...(body as Row) };
    const arr = this.store.get(key) ?? [];
    arr.push(row);
    this.store.set(key, arr);
    return { status: 201, body: row as unknown as T };
  }
}

describe('DemoReset — S1.12', () => {
  it('refuses to run without confirmDemo', async () => {
    const fake = new FakeApiClient();
    await expect(new DemoReset(fake, { confirmDemo: false }).reset()).rejects.toThrow(/confirmDemo/);
  });

  it('deletes only demo rows; a hand-planted non-demo row survives; re-seed is identical', async () => {
    const data = buildDemoTenant('GENERIC');
    const fake = new FakeApiClient();

    // Plant a real (non-demo) user + student BEFORE seeding.
    fake.store.set('/users', [{ id: 'real-1', userId: 'real-1', email: 'principal@realschool.org' }]);
    fake.store.set('/academics/students', [
      { id: 'real-s1', studentId: 'real-s1', studentNumber: 'REAL-1', email: 'kid@realschool.org' },
    ]);

    const first = await new DemoSeeder(fake).seed(data);
    expect(first.created.user).toBe(data.staff.length);
    expect(first.created.student).toBe(200);

    const reset = await new DemoReset(fake, { confirmDemo: true }).reset(standardResetTargets());
    expect(reset.deleted.user).toBe(data.staff.length);
    expect(reset.deleted.student).toBe(200);
    expect(reset.kept.user).toBe(1);
    expect(reset.kept.student).toBe(1);

    // Non-demo rows still present.
    const users = fake.store.get('/users')!;
    const students = fake.store.get('/academics/students')!;
    expect(users.some((u) => u.email === 'principal@realschool.org')).toBe(true);
    expect(users.every((u) => !isDemoEmail(u.email) || u.id === 'real-1')).toBe(true);
    expect(students.some((s) => s.studentNumber === 'REAL-1')).toBe(true);
    expect(users).toHaveLength(1);
    expect(students).toHaveLength(1);

    // Re-seed produces the same counts (idempotent baseline restored).
    const second = await new DemoSeeder(fake).seed(data);
    expect(second.created.user).toBe(data.staff.length);
    expect(second.created.student).toBe(200);
  });
});
