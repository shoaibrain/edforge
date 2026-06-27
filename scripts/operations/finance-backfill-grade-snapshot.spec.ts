/**
 * Sprint A.5 — backfill script unit spec (Codex round-1 hardening)
 *
 * Required by the locked plan at docs/finance-bulk-ops/sprint-plan.md
 * §A.5 Tests bullet. Covers the pure-function helpers + the lookup
 * outcome handling in isolation — no DDB, no network.
 *
 * Run via: `npm run test:scripts` (or `npx jest --config scripts/jest.config.js`)
 *
 * The integration spec against LocalStack DDB is intentionally NOT
 * included here — the repo's `*.integration.spec.ts` pattern requires
 * a running LocalStack which isn't part of the standard CI gate. The
 * pure-function coverage here pins the contract that prevents the
 * Codex P1 root cause (auth failure → silently mark all rows
 * unresolved) from regressing.
 */

import {
  resolveInvoiceGradeLevel,
  resolvePaymentGradeLevel,
  buildUpdateExpression,
  extractTenantIdFromJwt,
  StudentLookupOutcome,
  ResolutionDecision,
} from './finance-backfill-grade-snapshot';

const TENANT = 'tenant-1';
const SCHOOL = 'school-1';

describe('resolveInvoiceGradeLevel — Codex P1 tri-state outcome', () => {
  it('found + non-empty gradeLevel → resolved', () => {
    expect(
      resolveInvoiceGradeLevel({ kind: 'found', gradeLevel: '4' }),
    ).toEqual({ status: 'resolved', gradeLevel: '4' });
  });

  it('found + empty gradeLevel → unresolved (student exists but no grade)', () => {
    expect(
      resolveInvoiceGradeLevel({ kind: 'found', gradeLevel: '' }),
    ).toEqual({ status: 'unresolved' });
  });

  it('not_found → unresolved (academics 404; student really gone)', () => {
    expect(
      resolveInvoiceGradeLevel({ kind: 'not_found' }),
    ).toEqual({ status: 'unresolved' });
  });

  it('lookup_failed → SKIPPED (NOT unresolved — preserves the row for next run)', () => {
    // Pre-Codex-P1 fix this case incorrectly returned 'unresolved'
    // and would have written that status on --apply, silently
    // corrupting data during a routine academics deploy.
    const outcome: StudentLookupOutcome = {
      kind: 'lookup_failed',
      reason: 'http_401',
    };
    expect(resolveInvoiceGradeLevel(outcome)).toEqual({
      status: 'skipped',
      reason: 'http_401',
    });
  });

  it('lookup_failed reason propagates verbatim for the findings CSV', () => {
    for (const reason of ['http_403', 'http_500', 'network_ECONNREFUSED', 'network_ETIMEDOUT']) {
      expect(
        resolveInvoiceGradeLevel({ kind: 'lookup_failed', reason }),
      ).toEqual({ status: 'skipped', reason });
    }
  });
});

describe('resolvePaymentGradeLevel — Codex P1/P2 in-memory invoice map', () => {
  it('parent invoice resolved → payment resolved (snapshot copy)', () => {
    expect(
      resolvePaymentGradeLevel({ status: 'resolved', gradeLevel: '4' }),
    ).toEqual({ status: 'resolved', gradeLevel: '4' });
  });

  it('parent invoice unresolved → payment unresolved (propagates)', () => {
    expect(
      resolvePaymentGradeLevel({ status: 'unresolved' }),
    ).toEqual({ status: 'unresolved' });
  });

  it('parent invoice skipped → payment skipped, reason chained', () => {
    // If we skipped the parent (e.g. academics 401), we MUST skip
    // the payment too — don't infer a grade from nothing.
    expect(
      resolvePaymentGradeLevel({ status: 'skipped', reason: 'http_401' }),
    ).toEqual({
      status: 'skipped',
      reason: 'parent_invoice_skipped:http_401',
    });
  });

  it('parent invoice absent from map (null) → payment skipped with explicit reason', () => {
    // Codex P1/P2 root case: payment whose parent invoice was
    // outside the backfill scan scope (--limit cutoff, --tenant
    // exclusion). Pre-fix the script would have DDB-looked-up the
    // invoice and reported the pre-A.1 state in dry-run, then a
    // different state in --apply. Post-fix the map drives both
    // modes; when the map has no entry the caller must have
    // already tried the DDB fallback and got nothing usable.
    expect(resolvePaymentGradeLevel(null)).toEqual({
      status: 'skipped',
      reason: 'parent_invoice_outside_backfill_scope',
    });
  });
});

describe('buildUpdateExpression', () => {
  it('resolved → sets gradeLevel + gsi14 pair + status with attribute_not_exists guard', () => {
    const expr = buildUpdateExpression(
      TENANT,
      SCHOOL,
      'INVOICE',
      { status: 'resolved', gradeLevel: '4' },
      '2026-07-15',
    );

    expect(expr).not.toBeNull();
    expect(expr!.UpdateExpression).toMatch(/gradeLevel = :gl/);
    expect(expr!.UpdateExpression).toMatch(/gsi14pk = :gsi14pk/);
    expect(expr!.UpdateExpression).toMatch(/gsi14sk = :gsi14sk/);
    expect(expr!.UpdateExpression).toMatch(/gradeLevelResolutionStatus = :status/);
    expect(expr!.ConditionExpression).toBe('attribute_not_exists(gradeLevel)');
    expect(expr!.ExpressionAttributeValues).toMatchObject({
      ':status': { S: 'resolved' },
      ':gl': { S: '4' },
      ':gsi14pk': { S: `TENANT#${TENANT}#SCHOOL#${SCHOOL}#GRADE#4` },
      ':gsi14sk': { S: 'INVOICE#2026-07-15' },
    });
  });

  it('unresolved → sets ONLY the status field (no gradeLevel, no gsi14 pair → stays sparse)', () => {
    const expr = buildUpdateExpression(
      TENANT,
      SCHOOL,
      'INVOICE',
      { status: 'unresolved' },
      '2026-07-15',
    );

    expect(expr).not.toBeNull();
    expect(expr!.UpdateExpression).toBe('SET gradeLevelResolutionStatus = :status');
    expect(expr!.ExpressionAttributeValues).toEqual({
      ':status': { S: 'unresolved' },
    });
    expect(expr!.ConditionExpression).toBe('attribute_not_exists(gradeLevel)');
  });

  it('Codex P1 — skipped → returns null (NO DDB write — row preserved for next run)', () => {
    // This is the assertion that pins the safety-net behavior: a
    // skipped resolution MUST NOT produce any UpdateItem. The whole
    // point of distinguishing skipped from unresolved is that
    // skipped rows are re-tried, not committed.
    const skipped: ResolutionDecision = { status: 'skipped', reason: 'http_401' };
    expect(buildUpdateExpression(TENANT, SCHOOL, 'INVOICE', skipped, '2026-07-15')).toBeNull();
    expect(buildUpdateExpression(TENANT, SCHOOL, 'PAYMENT', skipped, '2026-07-15T10:30:00Z')).toBeNull();
  });

  it('PAYMENT entity → gsi14sk uses PAYMENT# prefix (not INVOICE#)', () => {
    const expr = buildUpdateExpression(
      TENANT,
      SCHOOL,
      'PAYMENT',
      { status: 'resolved', gradeLevel: '4' },
      '2026-07-15T10:30:00Z',
    );

    expect(expr).not.toBeNull();
    expect(expr!.ExpressionAttributeValues[':gsi14sk']).toEqual({
      S: 'PAYMENT#2026-07-15T10:30:00Z',
    });
  });
});

describe('extractTenantIdFromJwt — Codex P1 auth header derivation', () => {
  // Build a minimal Cognito-style JWT (header.payload.signature). We
  // only need a valid payload segment; header/signature can be
  // arbitrary opaque strings since the extractor only parses payload.
  function makeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.signature`;
  }

  it('extracts custom:tenantId from a valid Cognito ID-token payload', () => {
    const jwt = makeJwt({ 'custom:tenantId': 'tenant-uuid-123', email: 'op@example.com' });
    expect(extractTenantIdFromJwt(jwt)).toBe('tenant-uuid-123');
  });

  it('returns empty string when custom:tenantId claim is absent', () => {
    const jwt = makeJwt({ email: 'op@example.com' });
    expect(extractTenantIdFromJwt(jwt)).toBe('');
  });

  it('returns empty string on malformed JWT (no throws)', () => {
    // The function MUST never throw — the CLI prints a friendly
    // error and exits 1 when the tenantId can't be extracted.
    expect(extractTenantIdFromJwt('not-a-jwt')).toBe('');
    expect(extractTenantIdFromJwt('')).toBe('');
    expect(extractTenantIdFromJwt('only.two-segments')).toBe('');
    expect(extractTenantIdFromJwt('a.not-base64.b')).toBe('');
  });
});
