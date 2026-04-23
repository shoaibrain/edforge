import { IdentityClientService } from './identity-client.service';
import type { RequestContext } from '@app/http-client';

const ctx: RequestContext = {
  tenantId: 't1',
  userId: 'u1',
  jwtToken: 'jwt',
  userRole: 'TenantAdmin',
  userName: 'admin',
} as any;

function fakeHttpClient(response: any, shouldFail = false) {
  return {
    get: jest.fn(async () => {
      if (shouldFail) throw new Error('identity unreachable');
      return { data: response };
    }),
  } as any;
}

describe('IdentityClientService.isFeatureEnabled', () => {
  it('returns true when the flag is explicitly enabled in workspace settings', async () => {
    const http = fakeHttpClient({ features: { 'iemis.asyncImport': true } });
    const svc = new IdentityClientService(http);

    const enabled = await svc.isFeatureEnabled('t1', 'iemis.asyncImport', ctx);
    expect(enabled).toBe(true);
  });

  it('returns false when the flag is absent from the map', async () => {
    const http = fakeHttpClient({ features: { 'iemis.descriptorEnrichment': true } });
    const svc = new IdentityClientService(http);

    const enabled = await svc.isFeatureEnabled('t1', 'iemis.asyncImport', ctx);
    expect(enabled).toBe(false);
  });

  it('returns false when the settings response has no features map at all', async () => {
    const http = fakeHttpClient({});
    const svc = new IdentityClientService(http);

    const enabled = await svc.isFeatureEnabled('t1', 'iemis.asyncImport', ctx);
    expect(enabled).toBe(false);
  });

  it('returns false (fail-closed) when the identity service is unreachable', async () => {
    const http = fakeHttpClient(null, true);
    const svc = new IdentityClientService(http);

    const enabled = await svc.isFeatureEnabled('t1', 'iemis.asyncImport', ctx);
    expect(enabled).toBe(false);
  });

  it('caches flag lookups within the TTL window', async () => {
    const http = fakeHttpClient({ features: { 'iemis.asyncImport': true } });
    const svc = new IdentityClientService(http);

    await svc.isFeatureEnabled('t1', 'iemis.asyncImport', ctx);
    await svc.isFeatureEnabled('t1', 'iemis.asyncImport', ctx);
    await svc.isFeatureEnabled('t1', 'iemis.descriptorEnrichment', ctx); // same cache entry

    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('invalidateFeatureFlagCache forces the next read to refetch', async () => {
    const http = fakeHttpClient({ features: { 'iemis.asyncImport': true } });
    const svc = new IdentityClientService(http);

    await svc.isFeatureEnabled('t1', 'iemis.asyncImport', ctx);
    svc.invalidateFeatureFlagCache('t1');
    await svc.isFeatureEnabled('t1', 'iemis.asyncImport', ctx);

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('does not cache across tenants', async () => {
    const http = fakeHttpClient({ features: { 'iemis.asyncImport': true } });
    const svc = new IdentityClientService(http);

    await svc.isFeatureEnabled('tenant-a', 'iemis.asyncImport', ctx);
    await svc.isFeatureEnabled('tenant-b', 'iemis.asyncImport', ctx);

    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('does not cache identity-service failures (subsequent calls retry)', async () => {
    let fail = true;
    const http = {
      get: jest.fn(async () => {
        if (fail) {
          fail = false;
          throw new Error('503');
        }
        return { data: { features: { 'iemis.asyncImport': true } } };
      }),
    } as any;
    const svc = new IdentityClientService(http);

    expect(await svc.isFeatureEnabled('t1', 'iemis.asyncImport', ctx)).toBe(false);
    expect(await svc.isFeatureEnabled('t1', 'iemis.asyncImport', ctx)).toBe(true);
    expect(http.get).toHaveBeenCalledTimes(2);
  });
});
