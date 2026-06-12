/**
 * Demo tenant reset — Sprint S1.12.
 *
 * Re-baselines a demo tenant by deleting only the rows the demo engine
 * created, identified by their reserved markers (the `.test` email domain,
 * the `S#####` student-number shape, the `9999NNNN` emis band). A
 * hand-planted non-demo row therefore survives a reset.
 *
 * Two safety layers: the caller must pass `confirmDemo: true` (the CLI sets
 * it only after confirming the tenant carries the S3.1 `isDemo` flag), and
 * every target's marker predicate is matched per-row before deletion — so a
 * mis-pointed reset against a real tenant deletes nothing.
 */

import type { ApiClient, HttpMethod } from './seeder';
import { DEMO_EMAIL_DOMAIN } from './synthetic-identity';

type Row = Record<string, unknown>;

/** A collection to sweep: list it, keep non-demo rows, delete demo rows. */
export interface ResetTarget {
  kind: string;
  listPath: string;
  /** True iff the row was created by the demo engine (safe to delete). */
  isDemoRow: (row: Row) => boolean;
  /** DELETE path for a row id. */
  deletePath: (id: string) => string;
  idField: string;
}

export interface ResetSummary {
  deleted: Record<string, number>;
  kept: Record<string, number>;
}

// --- reserved-marker predicates (exported for reuse + the S3.9 safety scan) ---

export function isDemoEmail(value: unknown): boolean {
  return typeof value === 'string' && value.endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}
export function isDemoStudentNumber(value: unknown): boolean {
  return typeof value === 'string' && /^S\d{5}$/.test(value);
}
export function isDemoEmisStudentId(value: unknown): boolean {
  return typeof value === 'string' && /^9999\d{12}$/.test(value);
}
export function isDemoEmisSchoolCode(value: unknown): boolean {
  return typeof value === 'string' && /^9999\d{4}$/.test(value);
}

/**
 * The standard reset targets for the PII-bearing tenant-wide collections.
 * Extend with school-scoped collections (courses, sections, finance) as
 * their DELETE endpoints land (some arrive with Sprint S6).
 */
export function standardResetTargets(): ResetTarget[] {
  return [
    {
      kind: 'student',
      listPath: '/academics/students',
      isDemoRow: (r) => isDemoStudentNumber(r.studentNumber) || isDemoEmisStudentId(r.emisStudentId) || isDemoEmail(r.email),
      deletePath: (id) => `/academics/students/${id}`,
      idField: 'studentId',
    },
    {
      kind: 'user',
      listPath: '/users',
      isDemoRow: (r) => isDemoEmail(r.email),
      deletePath: (id) => `/users/${id}`,
      idField: 'userId',
    },
  ];
}

export class DemoReset {
  constructor(
    private readonly client: ApiClient,
    private readonly opts: { confirmDemo: boolean },
  ) {}

  private async list(path: string): Promise<Row[]> {
    const res = await this.client.request<unknown>('GET', path);
    if (res.status < 200 || res.status >= 300) return [];
    const b = res.body as Row[] | { items?: Row[]; data?: Row[] } | null;
    if (Array.isArray(b)) return b;
    if (b && Array.isArray((b as { items?: Row[] }).items)) return (b as { items: Row[] }).items;
    if (b && Array.isArray((b as { data?: Row[] }).data)) return (b as { data: Row[] }).data;
    return [];
  }

  async reset(targets: ResetTarget[] = standardResetTargets()): Promise<ResetSummary> {
    if (!this.opts.confirmDemo) {
      throw new Error('DemoReset refused: confirmDemo must be true (tenant must be isDemo).');
    }
    const summary: ResetSummary = { deleted: {}, kept: {} };
    for (const t of targets) {
      summary.deleted[t.kind] = 0;
      summary.kept[t.kind] = 0;
      for (const row of await this.list(t.listPath)) {
        if (!t.isDemoRow(row)) {
          summary.kept[t.kind] += 1;
          continue;
        }
        const id = String(row[t.idField] ?? row.id);
        const res = await this.client.request('DELETE' as HttpMethod, t.deletePath(id));
        if (res.status >= 200 && res.status < 300) summary.deleted[t.kind] += 1;
      }
    }
    return summary;
  }
}
