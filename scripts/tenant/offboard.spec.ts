import { buildOffboardingDetail, parseArgs } from './offboard';

describe('scripts/tenant/offboard', () => {
  it('parses the tenant, the confirmation and the execute switch; dry-run is the default', () => {
    expect(parseArgs(['--tenant', 't-1'])).toEqual({ tenantId: 't-1', confirmProduction: false, execute: false });
    expect(parseArgs(['--tenant', 't-1', '--confirm-production', '--execute'])).toEqual({ tenantId: 't-1', confirmProduction: true, execute: true });
    expect(() => parseArgs(['--execute'])).toThrow(/usage/);
  });

  it('builds the offboarding detail SBT would send, plus confirmProduction only when asked', () => {
    const registration = { tenantRegistrationId: 'reg-1', sbtaws_active: true, tenantId: 't-1' };
    expect(buildOffboardingDetail(registration, 't-1', false)).toEqual({ tenantRegistrationId: 'reg-1', sbtaws_active: true, tenantId: 't-1', tier: 'BASIC' });
    expect(buildOffboardingDetail({ ...registration, tier: 'BASIC' }, 't-1', true)).toMatchObject({ confirmProduction: true, tier: 'BASIC' });
    expect(() => buildOffboardingDetail({ sbtaws_active: true }, 't-1', true)).toThrow(/tenantRegistrationId/);
  });
});
