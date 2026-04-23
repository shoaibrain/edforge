import {
  IemisPermission,
  TENANT_ADMIN_IEMIS_PERMISSIONS,
  PLATFORM_OPERATOR_IEMIS_PERMISSIONS,
  isIemisPermission,
} from './iemis-permissions';

describe('IemisPermission constants', () => {
  it('uses the canonical resource:action colon format', () => {
    for (const value of Object.values(IemisPermission)) {
      expect(value).toMatch(/^iemis:[a-z-]+$/);
    }
  });

  it('has no accidental duplicates', () => {
    const values = Object.values(IemisPermission);
    expect(new Set(values).size).toBe(values.length);
  });

  it('exposes the five expected operations', () => {
    const expected = ['iemis:import', 'iemis:export', 'iemis:verify-code', 'iemis:view-audit', 'iemis:manage-templates'];
    expect(new Set(Object.values(IemisPermission))).toEqual(new Set(expected));
  });
});

describe('role grant sets', () => {
  it('TenantAdmin seed includes Import/Export/VerifyCode/ViewAudit', () => {
    expect(TENANT_ADMIN_IEMIS_PERMISSIONS).toContain(IemisPermission.Import);
    expect(TENANT_ADMIN_IEMIS_PERMISSIONS).toContain(IemisPermission.Export);
    expect(TENANT_ADMIN_IEMIS_PERMISSIONS).toContain(IemisPermission.VerifyCode);
    expect(TENANT_ADMIN_IEMIS_PERMISSIONS).toContain(IemisPermission.ViewAudit);
  });

  it('TenantAdmin seed does NOT include ManageTemplates (platform-operator only)', () => {
    expect(TENANT_ADMIN_IEMIS_PERMISSIONS).not.toContain(IemisPermission.ManageTemplates);
  });

  it('PlatformOperator set contains ManageTemplates', () => {
    expect(PLATFORM_OPERATOR_IEMIS_PERMISSIONS).toContain(IemisPermission.ManageTemplates);
  });

  it('TenantAdmin and PlatformOperator grants are disjoint (no permission in both)', () => {
    for (const p of TENANT_ADMIN_IEMIS_PERMISSIONS) {
      expect(PLATFORM_OPERATOR_IEMIS_PERMISSIONS).not.toContain(p);
    }
  });

  it('union of the two grants covers every declared IemisPermission', () => {
    const union = new Set<string>([
      ...TENANT_ADMIN_IEMIS_PERMISSIONS,
      ...PLATFORM_OPERATOR_IEMIS_PERMISSIONS,
    ]);
    for (const v of Object.values(IemisPermission)) {
      expect(union.has(v)).toBe(true);
    }
  });
});

describe('isIemisPermission type guard', () => {
  it('returns true for known permission strings', () => {
    expect(isIemisPermission('iemis:import')).toBe(true);
    expect(isIemisPermission('iemis:manage-templates')).toBe(true);
  });

  it('returns false for unknown / non-string inputs', () => {
    expect(isIemisPermission('iemis:unknown')).toBe(false);
    expect(isIemisPermission('students:view')).toBe(false);
    expect(isIemisPermission('')).toBe(false);
    expect(isIemisPermission(null)).toBe(false);
    expect(isIemisPermission(undefined)).toBe(false);
    expect(isIemisPermission(123)).toBe(false);
    expect(isIemisPermission({})).toBe(false);
  });

  it('narrows the type in a TS context', () => {
    const candidate: unknown = 'iemis:export';
    if (isIemisPermission(candidate)) {
      // compiles because candidate is narrowed to IemisPermission
      const p: string = candidate;
      expect(p.startsWith('iemis:')).toBe(true);
    }
  });
});
