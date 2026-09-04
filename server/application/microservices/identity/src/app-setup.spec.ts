import type { INestApplication } from '@nestjs/common';
import { configureApp as configureIdentity } from './app-setup';
import { configureApp as configureAcademics } from '../../academics/src/app-setup';
import { configureApp as configureFinance } from '../../finance/src/app-setup';

/**
 * C1.1 — the HTTP entry and the Lambda entry share one setup; the only
 * runtime-dependent pieces are `compression()` (HTTP only, API Gateway
 * compresses for Lambda) and the shutdown hooks (no SIGTERM in Lambda).
 */
function fakeApp() {
  const registerDependencies = jest.fn();
  const app = {
    use: jest.fn(),
    useGlobalFilters: jest.fn(),
    useGlobalPipes: jest.fn(),
    get: jest.fn(() => ({ registerDependencies })),
    enableCors: jest.fn(),
    enableShutdownHooks: jest.fn(),
  };
  return { app: app as unknown as INestApplication, spies: app, registerDependencies };
}

const middlewareNames = (use: jest.Mock) =>
  use.mock.calls.map((c) => (typeof c[0] === 'function' ? c[0].name : typeof c[0]));

describe.each([
  ['identity', configureIdentity, false],
  ['academics', configureAcademics, true],
  ['finance', configureFinance, true],
] as const)('%s configureApp', (_name, configure, hasShutdownHooks) => {
  it('registers compression only for the http runtime', () => {
    const http = fakeApp();
    configure(http.app, { runtime: 'http' });
    expect(middlewareNames(http.spies.use)).toContain('compression');

    const lambda = fakeApp();
    configure(lambda.app, { runtime: 'lambda' });
    expect(middlewareNames(lambda.spies.use)).not.toContain('compression');
  });

  it('registers the correlation middleware, global filter, pipe, health deps and CORS in both runtimes', () => {
    for (const runtime of ['http', 'lambda'] as const) {
      const { app, spies, registerDependencies } = fakeApp();
      configure(app, { runtime });
      expect(middlewareNames(spies.use)).toContain('correlationMiddleware');
      expect(spies.useGlobalFilters).toHaveBeenCalledTimes(1);
      expect(spies.useGlobalPipes).toHaveBeenCalledTimes(1);
      expect(registerDependencies).toHaveBeenCalledTimes(1);
      expect(spies.enableCors).toHaveBeenCalledWith(
        expect.objectContaining({ credentials: true, exposedHeaders: ['X-Correlation-Id'] }),
      );
    }
  });

  it('enables shutdown hooks only for the http runtime, where the service declares them', () => {
    const http = fakeApp();
    configure(http.app, { runtime: 'http' });
    expect(http.spies.enableShutdownHooks).toHaveBeenCalledTimes(hasShutdownHooks ? 1 : 0);

    const lambda = fakeApp();
    configure(lambda.app, { runtime: 'lambda' });
    expect(lambda.spies.enableShutdownHooks).not.toHaveBeenCalled();
  });
});
