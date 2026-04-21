/**
 * Sprint B.7 — Contract test for tenant immutable-field rejection.
 *
 * Asserts that the UpdateTenantDto Zod schema rejects the four identity
 * fields (archetype, country, tier, subdomain) with a targeted "immutable"
 * error — replacing the prior silent-strip behavior flagged in the Sprint A
 * tenant-read-surface audit (docs/security/tenant-read-surface-audit.md,
 * Open Items #2).
 *
 * The schema is the canonical boundary — the controller's ZodValidationPipe
 * hands Zod errors back to the client as 400. Validating at the schema
 * level means every call site (AdminWeb, SBT ScriptJob, tenant API) sees
 * the same behavior without per-caller wiring.
 */
import { updateTenantSchema } from '@aibrains/shared-types';

describe('UpdateTenantDto immutability contract', () => {
  it('accepts a mutable-fields-only PATCH', () => {
    const result = updateTenantSchema.safeParse({
      name: 'Renamed Tenant',
      contactEmail: 'admin@example.com',
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['archetype', 'GENERIC'],
    ['country', 'USA'],
    ['tier', 'ADVANCED'],
    ['subdomain', 'hijacker'],
  ])('rejects %s with a targeted "immutable" message', (field, value) => {
    const result = updateTenantSchema.safeParse({ [field]: value });
    expect(result.success).toBe(false);
    if (result.success) return; // narrows for TS
    const issue = result.error.issues.find((i) => i.path[0] === field);
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/immutable/i);
    expect(issue!.message).toContain(field);
  });

  it('reports every immutable violation when multiple are attempted', () => {
    const result = updateTenantSchema.safeParse({
      name: 'Still-allowed rename',
      archetype: 'GENERIC',
      country: 'USA',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fields = result.error.issues.map((i) => i.path[0]).sort();
    expect(fields).toEqual(['archetype', 'country']);
  });

  it('does not surface immutable errors when the fields are absent', () => {
    // Baseline — proves the rule fires only on explicit attempts, not on
    // omission.
    const result = updateTenantSchema.safeParse({
      name: 'OK',
      contactEmail: 'a@b.com',
    });
    expect(result.success).toBe(true);
  });
});
