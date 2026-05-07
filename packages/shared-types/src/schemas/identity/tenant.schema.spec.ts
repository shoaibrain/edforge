import {
  tenantTagSchema,
  type TenantTag,
  updateTenantSchema,
  tenantResponseSchema,
} from './tenant.schema';

describe('tenantTagSchema', () => {
  it.each<[TenantTag]>([
    ['production'],
    ['internal-dev'],
    ['internal-dev-rehearsal'],
  ])('accepts %s', (input) => {
    expect(tenantTagSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    ['', 'empty string'],
    ['Production', 'wrong case'],
    ['internal_dev', 'underscore form'],
    ['rehearsal', 'truncated'],
    ['unknown-tag', 'unknown literal'],
  ])('rejects %s (%s)', (input) => {
    expect(tenantTagSchema.safeParse(input).success).toBe(false);
  });

  it('does NOT silently default — caller must supply a value', () => {
    // Defaults are applied by the controller, not the schema, so that a
    // missing value at the API surface is an explicit decision.
    const r = tenantTagSchema.safeParse(undefined);
    expect(r.success).toBe(false);
  });
});

describe('updateTenantSchema — tenantTag immutability', () => {
  it('rejects updates that include tenantTag with a targeted error message', () => {
    const r = updateTenantSchema.safeParse({ tenantTag: 'internal-dev' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path.join('.') === 'tenantTag')?.message;
      expect(msg).toMatch(/tenantTag is immutable/);
    }
  });

  it('also rejects tenantTag even with a valid enum value', () => {
    const r = updateTenantSchema.safeParse({ tenantTag: 'production' });
    expect(r.success).toBe(false);
  });

  it('accepts an update that omits tenantTag entirely', () => {
    const r = updateTenantSchema.safeParse({ name: 'New name' });
    expect(r.success).toBe(true);
  });
});

describe('tenantResponseSchema — tenantTag', () => {
  const baseResponse = {
    tenantId: 't-1',
    name: 'Test',
    subdomain: 'test',
    contactEmail: 'a@b.com',
    tier: 'basic' as const,
    status: 'active' as const,
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
  };

  it('accepts a response that includes a valid tenantTag', () => {
    const r = tenantResponseSchema.safeParse({ ...baseResponse, tenantTag: 'production' });
    expect(r.success).toBe(true);
  });

  it('accepts a response that omits tenantTag (transition window — backfill not yet complete)', () => {
    const r = tenantResponseSchema.safeParse(baseResponse);
    expect(r.success).toBe(true);
  });

  it('rejects a response with an invalid tenantTag value', () => {
    const r = tenantResponseSchema.safeParse({ ...baseResponse, tenantTag: 'staging' });
    expect(r.success).toBe(false);
  });
});
