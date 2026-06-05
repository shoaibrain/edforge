import {
  createDefaultWorkspaceSettings,
  COUNTRY_DEFAULTS,
  ARCHETYPE_DEFAULTS,
} from './workspace-settings.entity';
import {
  COUNTRY_DEFAULTS as CANONICAL_COUNTRY_DEFAULTS,
  ARCHETYPE_DEFAULTS as CANONICAL_ARCHETYPE_DEFAULTS,
} from '@aibrains/shared-types';

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

  describe('archetype-based defaults', () => {
    it('should apply PABSON archetype defaults (NPR, Asia/Kathmandu, bikram_sambat)', () => {
      const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, undefined, 'PABSON');

      expect(settings.regional.defaultCurrency).toBe('NPR');
      expect(settings.regional.defaultTimezone).toBe('Asia/Kathmandu');
      expect(settings.regional.defaultCalendarSystem).toBe('bikram_sambat');
      expect(settings.regional.enableDualDateDisplay).toBe(true);
      expect(settings.regional.defaultLocale).toBe('ne-NP');
      expect(settings.regional.defaultTimeFormat).toBe('24h');
    });

    it('should apply GENERIC archetype defaults (USD, America/New_York, gregorian)', () => {
      const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, undefined, 'GENERIC');

      expect(settings.regional.defaultCurrency).toBe('USD');
      expect(settings.regional.defaultTimezone).toBe('America/New_York');
      expect(settings.regional.defaultCalendarSystem).toBe('gregorian');
      expect(settings.regional.enableDualDateDisplay).toBe(false);
    });

    it('should let PABSON archetype override country=USA', () => {
      const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, 'USA', 'PABSON');

      // Archetype wins: PABSON enforces NPR/Asia/Kathmandu even when country=USA.
      expect(settings.regional.defaultCurrency).toBe('NPR');
      expect(settings.regional.defaultTimezone).toBe('Asia/Kathmandu');
      expect(settings.regional.defaultCalendarSystem).toBe('bikram_sambat');
    });

    it('should fall back to country defaults when archetype is unknown', () => {
      const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, 'NPL', 'XYZ');

      expect(settings.regional.defaultCurrency).toBe('NPR');
      expect(settings.regional.defaultCalendarSystem).toBe('bikram_sambat');
    });

    it('should be case-insensitive for archetype', () => {
      const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, undefined, 'pabson');

      expect(settings.regional.defaultCurrency).toBe('NPR');
      expect(settings.regional.defaultCalendarSystem).toBe('bikram_sambat');
    });
  });

  // A.5 — these maps are a hand-maintained inline copy of the canonical
  // @aibrains/shared-types defaults (duplicated because the tenant-seeder Lambda
  // JSON.stringify-injects them at synth; see the file header + CLAUDE.md
  // "change one, change both"). This drift fence fails the moment the copy
  // diverges — the gap that left USA/IND without `defaultTimeFormat`.
  describe('A.5 — inline defaults stay in lockstep with canonical shared-types', () => {
    it('COUNTRY_DEFAULTS key-set matches canonical (both directions)', () => {
      expect(Object.keys(COUNTRY_DEFAULTS).sort()).toEqual(
        Object.keys(CANONICAL_COUNTRY_DEFAULTS).sort(),
      );
    });

    it('ARCHETYPE_DEFAULTS key-set matches canonical (both directions)', () => {
      expect(Object.keys(ARCHETYPE_DEFAULTS).sort()).toEqual(
        Object.keys(CANONICAL_ARCHETYPE_DEFAULTS).sort(),
      );
    });

    it.each(Object.keys(CANONICAL_COUNTRY_DEFAULTS))(
      'COUNTRY_DEFAULTS[%s] equals the canonical map',
      (country) => {
        expect(COUNTRY_DEFAULTS[country]).toEqual(
          CANONICAL_COUNTRY_DEFAULTS[country as keyof typeof CANONICAL_COUNTRY_DEFAULTS],
        );
      },
    );

    it.each(Object.keys(CANONICAL_ARCHETYPE_DEFAULTS))(
      'ARCHETYPE_DEFAULTS[%s] equals the canonical map',
      (archetype) => {
        expect(ARCHETYPE_DEFAULTS[archetype]).toEqual(
          CANONICAL_ARCHETYPE_DEFAULTS[archetype as keyof typeof CANONICAL_ARCHETYPE_DEFAULTS],
        );
      },
    );
  });
});
