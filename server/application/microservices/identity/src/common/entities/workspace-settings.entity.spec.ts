import {
  createDefaultWorkspaceSettings,
  COUNTRY_DEFAULTS,
} from './workspace-settings.entity';

describe('createDefaultWorkspaceSettings', () => {
  const tenantId = 'test-tenant-001';
  const orgName = 'Test Org';
  const createdBy = 'admin-user';

  it('should return Nepal values when country is NPL', () => {
    const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, 'NPL');

    expect(settings.regional.defaultCurrency).toBe('NPR');
    expect(settings.regional.defaultTimezone).toBe('Asia/Kathmandu');
    expect(settings.regional.defaultCalendarSystem).toBe('bikram_sambat');
    expect(settings.regional.enableDualDateDisplay).toBe(true);
    expect(settings.regional.defaultNumberFormat).toBe('south_asian');
    expect(settings.regional.defaultLocale).toBe('ne-NP');
    expect(settings.regional.defaultDateFormat).toBe('DD/MM/YYYY');
    expect(settings.regional.defaultTimeFormat).toBe('24h');
    expect(settings.tenantId).toBe(tenantId);
    expect(settings.branding.organizationName).toBe(orgName);
  });

  it('should return US values when country is USA', () => {
    const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, 'USA');

    expect(settings.regional.defaultCurrency).toBe('USD');
    expect(settings.regional.defaultTimezone).toBe('America/New_York');
    expect(settings.regional.defaultCalendarSystem).toBe('gregorian');
    expect(settings.regional.enableDualDateDisplay).toBe(false);
    expect(settings.regional.defaultNumberFormat).toBe('international');
    expect(settings.regional.defaultLocale).toBe('en-US');
  });

  it('should return US defaults when country is undefined', () => {
    const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy);

    expect(settings.regional.defaultCurrency).toBe('USD');
    expect(settings.regional.defaultTimezone).toBe('America/New_York');
    expect(settings.regional.defaultCalendarSystem).toBe('gregorian');
    expect(settings.regional.enableDualDateDisplay).toBe(false);
    expect(settings.regional.defaultNumberFormat).toBe('international');
  });

  it('should return US defaults for unknown country XYZ', () => {
    const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, 'XYZ');

    expect(settings.regional.defaultCurrency).toBe('USD');
    expect(settings.regional.defaultTimezone).toBe('America/New_York');
    expect(settings.regional.defaultCalendarSystem).toBe('gregorian');
  });

  it('should handle case-insensitive country codes', () => {
    const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, 'npl');

    expect(settings.regional.defaultCurrency).toBe('NPR');
    expect(settings.regional.defaultCalendarSystem).toBe('bikram_sambat');
  });

  it('should set correct entity metadata', () => {
    const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, 'NPL');

    expect(settings.entityType).toBe('WORKSPACE_SETTINGS');
    expect(settings.isLocked).toBe(false);
    expect(settings.version).toBe(1);
    expect(settings.createdBy).toBe(createdBy);
    expect(settings.createdAt).toBeDefined();
  });
});
