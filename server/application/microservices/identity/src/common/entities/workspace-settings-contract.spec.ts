/**
 * API Contract Tests for Workspace Settings Response
 *
 * Validates that GET /tenants/:id/settings returns correct regional defaults
 * based on the tenant's country. These tests validate the contract that the
 * frontend relies on for rendering country-specific UI.
 */
import { createDefaultWorkspaceSettings } from './workspace-settings.entity';

describe('Workspace Settings API Contract', () => {
  const tenantId = 'contract-test-tenant';
  const orgName = 'Contract Test Org';
  const createdBy = 'system';

  describe('NPL tenant settings response', () => {
    it('should contain Nepal-specific regional values', () => {
      const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, 'NPL');

      expect(settings.regional).toEqual(
        expect.objectContaining({
          defaultCurrency: 'NPR',
          defaultCalendarSystem: 'bikram_sambat',
          defaultTimezone: 'Asia/Kathmandu',
          enableDualDateDisplay: true,
          defaultNumberFormat: 'south_asian',
          defaultLocale: 'ne-NP',
          defaultDateFormat: 'DD/MM/YYYY',
        }),
      );
    });

    it('should have correct entity structure for DynamoDB', () => {
      const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, 'NPL');

      expect(settings.tenantId).toBe(tenantId);
      expect(settings.entityType).toBe('WORKSPACE_SETTINGS');
      expect(settings.branding.organizationName).toBe(orgName);
      expect(settings.policies.defaultAttendancePolicy).toBe('daily');
      expect(settings.isLocked).toBe(false);
      expect(settings.version).toBe(1);
    });
  });

  describe('USA tenant settings response', () => {
    it('should contain US-specific regional values', () => {
      const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, 'USA');

      expect(settings.regional).toEqual(
        expect.objectContaining({
          defaultCurrency: 'USD',
          defaultCalendarSystem: 'gregorian',
          defaultTimezone: 'America/New_York',
          enableDualDateDisplay: false,
          defaultNumberFormat: 'international',
          defaultLocale: 'en-US',
          defaultDateFormat: 'MM/DD/YYYY',
        }),
      );
    });
  });

  describe('Tenant without country gets US defaults', () => {
    it('should fall back to US defaults when no country provided', () => {
      const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy);

      expect(settings.regional.defaultCurrency).toBe('USD');
      expect(settings.regional.defaultCalendarSystem).toBe('gregorian');
      expect(settings.regional.defaultTimezone).toBe('America/New_York');
      expect(settings.regional.enableDualDateDisplay).toBe(false);
    });

    it('should fall back to US defaults for empty string country', () => {
      const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, '');

      expect(settings.regional.defaultCurrency).toBe('USD');
      expect(settings.regional.defaultCalendarSystem).toBe('gregorian');
    });
  });

  describe('Response shape matches WorkspaceSettingsResponseDto contract', () => {
    it('should include all required fields for frontend consumption', () => {
      const settings = createDefaultWorkspaceSettings(tenantId, orgName, createdBy, 'NPL');

      // These fields must exist — frontend relies on them
      expect(settings).toHaveProperty('tenantId');
      expect(settings).toHaveProperty('regional');
      expect(settings).toHaveProperty('branding');
      expect(settings).toHaveProperty('policies');
      expect(settings).toHaveProperty('isLocked');
      expect(settings).toHaveProperty('createdAt');
      expect(settings).toHaveProperty('updatedAt');

      // Regional sub-fields
      expect(settings.regional).toHaveProperty('defaultCurrency');
      expect(settings.regional).toHaveProperty('defaultTimezone');
      expect(settings.regional).toHaveProperty('defaultLocale');
      expect(settings.regional).toHaveProperty('defaultDateFormat');
      expect(settings.regional).toHaveProperty('defaultTimeFormat');
      expect(settings.regional).toHaveProperty('defaultWeekStartsOn');
      expect(settings.regional).toHaveProperty('defaultCalendarSystem');
      expect(settings.regional).toHaveProperty('enableDualDateDisplay');
      expect(settings.regional).toHaveProperty('defaultNumberFormat');
    });
  });
});
