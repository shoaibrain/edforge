import { withApiBServiceUrls } from './service-urls';

describe('withApiBServiceUrls (C2.6)', () => {
  it('repoints only the service-URL variables the container already has', () => {
    const env = { TABLE_NAME: 't', IDENTITY_SERVICE_URL: 'http://identity-api.ns.sc:3010', FINANCE_SERVICE_URL: 'http://finance-api.ns.sc:3010', INTERNAL_API_KEY: 'k' };
    expect(withApiBServiceUrls(env, 'https://abc.execute-api.ap-south-1.amazonaws.com/prod')).toEqual({
      TABLE_NAME: 't',
      IDENTITY_SERVICE_URL: 'https://abc.execute-api.ap-south-1.amazonaws.com/prod',
      FINANCE_SERVICE_URL: 'https://abc.execute-api.ap-south-1.amazonaws.com/prod',
      INTERNAL_API_KEY: 'k',
    });
    expect(withApiBServiceUrls({ TABLE_NAME: 't' }, 'https://x')).toEqual({ TABLE_NAME: 't' });
  });
});
