import {
  deprovisionRefusal,
  deprovisionSuccessDetail,
  lifecycleFailureDetail,
  normalizeArchetype,
  normalizeTenantTag,
  provisionSuccessDetail,
  usernameFor,
} from './sbt-lifecycle';

describe('sbt-lifecycle — the script job contract, as pure functions', () => {
  it('normalises archetype and tenantTag the way provision-tenant.sh did', () => {
    expect(normalizeArchetype('pabson')).toBe('PABSON');
    expect(normalizeArchetype('CBSE_IN')).toBe('GENERIC');
    expect(normalizeArchetype(undefined)).toBe('GENERIC');
    expect(normalizeTenantTag('internal-dev')).toBe('internal-dev');
    expect(normalizeTenantTag('internal-dev-rehearsal')).toBe('internal-dev-rehearsal');
    expect(normalizeTenantTag('typo')).toBe('production');
    expect(normalizeTenantTag(undefined)).toBe('production');
    expect(usernameFor('  Admin@School.EDU.NP ')).toBe('admin@school.edu.np');
  });

  it('builds the provisionSuccess envelope SBT PATCHes back and the seeder reads', () => {
    const detail = provisionSuccessDetail({
      tenantRegistrationId: 'reg-1',
      tenantId: 'tenant-1',
      tenantName: 'saraswati',
      email: 'admin@example.com',
      tier: 'BASIC',
      country: 'NPL',
      archetype: 'PABSON',
      tenantTag: 'internal-dev-rehearsal',
      prices: [{ id: 'p1', metricName: 'seats' }],
      alertTopicArn: 'arn:aws:sns:ap-south-1:111111111111:edforge-alerts-tenant-tenant-1',
      tenantConfig: { userPoolId: 'pool', appClientId: 'client', apiGatewayUrl: 'https://api.example.com/prod' },
    }) as { tenantRegistrationId: string; tenantId: string; jobOutput: { tenantData: Record<string, unknown>; tenantRegistrationData: Record<string, unknown> } };
    expect(detail.tenantRegistrationId).toBe('reg-1');
    expect(detail.tenantId).toBe('tenant-1');
    expect(detail.jobOutput.tenantRegistrationData).toEqual({ registrationStatus: 'Created' });
    expect(detail.jobOutput.tenantData).toMatchObject({
      tenantId: 'tenant-1',
      tenantName: 'saraswati',
      email: 'admin@example.com',
      tier: 'BASIC',
      country: 'NPL',
      archetype: 'PABSON',
      tenantTag: 'internal-dev-rehearsal',
      alertTopicArn: 'arn:aws:sns:ap-south-1:111111111111:edforge-alerts-tenant-tenant-1',
    });
    expect(JSON.parse(detail.jobOutput.tenantData.tenantConfig as string)).toEqual({
      userPoolId: 'pool',
      appClientId: 'client',
      apiGatewayUrl: 'https://api.example.com/prod',
    });
  });

  it('builds the failure and deprovision envelopes with the job identifier key SBT routes on', () => {
    expect(lifecycleFailureDetail('reg-1', 'Failed to provision tenant.', 'tier PREMIUM')).toEqual({
      tenantRegistrationId: 'reg-1',
      jobOutput: { tenantStatus: 'Failed to provision tenant.', reason: 'tier PREMIUM' },
    });
    expect(deprovisionSuccessDetail('reg-1', 'tenant-1')).toEqual({
      tenantRegistrationId: 'reg-1',
      tenantId: 'tenant-1',
      jobOutput: { tenantData: {}, tenantRegistrationData: { registrationStatus: 'Deleted' } },
    });
  });

  describe('deprovisionRefusal — default-deny (D7.4)', () => {
    it('refuses production, untagged and missing rows unless confirmProduction is true', () => {
      expect(deprovisionRefusal({ tenantTag: 'production' }, undefined)).toMatch(/tagged production/);
      expect(deprovisionRefusal({}, undefined)).toMatch(/no tenantTag/);
      expect(deprovisionRefusal(undefined, undefined)).toMatch(/no identity METADATA row/);
      expect(deprovisionRefusal({ tenantTag: 'production' }, 'true')).toMatch(/tagged production/);
      expect(deprovisionRefusal({ tenantTag: 'production' }, true)).toBeNull();
      expect(deprovisionRefusal(undefined, true)).toBeNull();
    });

    it('lets internal tenants through without confirmation', () => {
      expect(deprovisionRefusal({ tenantTag: 'internal-dev' }, undefined)).toBeNull();
      expect(deprovisionRefusal({ tenantTag: 'internal-dev-rehearsal' }, false)).toBeNull();
    });
  });
});
