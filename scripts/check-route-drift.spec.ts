import * as fs from 'fs';
import * as path from 'path';
import {
  checkNestToSpec, checkNoResidue, checkSpecToFunction, checkSpecToNest, ownershipIndex,
  parseAnalyticsRouterSource, parseControllerSource, resourceNodeCount, type ControllerRoute,
} from './check-route-drift';

const REPO = path.resolve(__dirname, '..');
const r = (service: string, method: string, p: string): ControllerRoute => ({ sourceFile: `${service}.controller.ts`, service, method, path: p });
const lambdaOp = (fn: string) => ({ responses: {}, 'x-amazon-apigateway-integration': { type: 'aws_proxy', httpMethod: 'POST', uri: `arn:aws:apigateway:{{region}}:lambda:path/2015-03-31/functions/arn:aws:lambda:{{region}}:{{account_id}}:function:\${stageVariables.${fn}}/invocations` } });
const vpcOp = () => ({ parameters: [{ name: 'tenantPath', in: 'header' }], 'x-amazon-apigateway-integration': { type: 'http_proxy', connectionType: 'VPC_LINK', connectionId: '{{connection_id}}', uri: '{{integration_uri}}/x', requestParameters: {} } });
const optionsOp = () => ({ 'x-amazon-apigateway-integration': { type: 'mock' } });
const routeMap = { prefixes: { schools: { target: 'lambda' as const, fn: 'identityFn' }, academics: { target: 'lambda' as const, fn: 'academicsFn' }, finance: { target: 'vpclink' as const }, analytics: { target: 'lambda' as const, fn: 'analyticsFn' } } };

describe('route sources', () => {
  it('parses controllers with their owning service and binds methods to the nearest @Controller', () => {
    const src = `@Controller('schools/:schoolId') class A { @Get(':id') a() {} @Post() b() {} }\n@Controller('admin') class B { @Delete('x') c() {} }`;
    const routes = parseControllerSource(src, 'microservices/identity/src/a.controller.ts', 'identity');
    expect(routes.map((x) => `${x.method} ${x.path}`)).toEqual(['GET /schools/{schoolId}/{id}', 'POST /schools/{schoolId}', 'DELETE /admin/x']);
    expect(routes.every((x) => x.service === 'identity')).toBe(true);
  });

  it('parses the real analytics router into five GET routes', () => {
    const routes = parseAnalyticsRouterSource(fs.readFileSync(path.join(REPO, 'server/lib/analytics/lambda/api/router.ts'), 'utf8'));
    expect(routes.map((x) => x.path).sort()).toEqual([
      '/analytics/fleet', '/analytics/me/session-history', '/analytics/tenants/{param}',
      '/analytics/tenants/{param}/adoption-report', '/analytics/tenants/{param}/export-csv-url',
    ]);
    expect(routes.every((x) => x.method === 'GET' && x.service === 'analytics')).toBe(true);
  });
});

describe('check (1) Nest → spec surface', () => {
  it('reports a controller route absent from the surface, matching by shape, honouring exemptions', () => {
    const routes = [r('identity', 'GET', '/schools/{schoolId}'), r('finance', 'GET', '/finance/x'), r('identity', 'GET', '/auth/health')];
    const missing = checkNestToSpec(routes, new Set(['/schools/{id}']), new Set(['/auth/health']));
    expect(missing.map((m) => m.path)).toEqual(['/finance/x']);
  });
});

describe('check (2) spec → function', () => {
  const ownership = ownershipIndex([r('identity', 'GET', '/schools/{id}'), r('academics', 'GET', '/academics/students'), r('finance', 'GET', '/finance/invoices'), r('analytics', 'GET', '/analytics/fleet')]);
  it('passes when every operation targets its owner and VPC-link operations belong to finance', () => {
    const spec = { paths: { '/schools/{schoolId}': { get: lambdaOp('identityFn'), options: optionsOp() }, '/academics/students': { get: lambdaOp('academicsFn') }, '/finance/invoices': { get: vpcOp() }, '/analytics/fleet': { get: lambdaOp('analyticsFn') } } };
    expect(checkSpecToFunction(spec, ownership)).toEqual([]);
  });
  it('flags the wrong function, an unowned path and a VPC-link operation not owned by finance', () => {
    const spec = { paths: { '/schools/{schoolId}': { get: lambdaOp('academicsFn') }, '/nobody': { get: lambdaOp('identityFn') }, '/academics/students': { get: vpcOp() } } };
    const problems = checkSpecToFunction(spec, ownership);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/targets academicsFn but the controller lives in the identityFn service/);
    expect(problems[1]).toMatch(/no controller declares/);
    expect(problems[2]).toMatch(/on the VPC link .* but owned by academicsFn/);
  });
});

describe('check (3) no residue', () => {
  it('flags VPC-link residue on a Lambda prefix and a non-http_proxy op on a VPC-link prefix', () => {
    const dirty = { ...lambdaOp('identityFn'), parameters: [{ name: 'tenantPath', in: 'header' }] };
    const spec = { paths: { '/schools/a': { get: dirty, options: optionsOp() }, '/finance/x': { get: lambdaOp('financeFn') }, '/academics/y': { get: lambdaOp('academicsFn') } } };
    const problems = checkNoResidue(spec, routeMap);
    expect(problems).toEqual([
      'GET /schools/a: residue "tenantPath" on a Lambda-targeted operation',
      'GET /finance/x: VPC-link prefix but integration is aws_proxy',
    ]);
  });
});

describe('check (4) spec → Nest', () => {
  it('flags a spec path nobody declares and ignores OPTIONS-only paths', () => {
    const ownership = ownershipIndex([r('identity', 'GET', '/schools/{id}')]);
    const surface = { paths: { '/': { options: optionsOp() }, '/schools/{schoolId}': { get: {} }, '/ghost': { get: {} } } };
    expect(checkSpecToNest(surface, ownership)).toEqual(['/ghost: in the spec but no controller or analytics route declares it']);
  });
});

describe('quota gate', () => {
  it('counts one node per unique segment prefix plus the root', () => {
    expect(resourceNodeCount(['/a/b', '/a/c', '/d'])).toBe(5);
  });
});

describe('repo lockstep (C2.1/C2.3)', () => {
  it('the /internal additions are exactly the controller routes under /internal, each targeting its owning service', () => {
    const additions = JSON.parse(fs.readFileSync(path.join(REPO, 'server/lib/tenant-api-additions.json'), 'utf8')) as { paths: Record<string, { fn: string; methods: string[] }> };
    const found: Record<string, { fn: string; methods: string[] }> = {};
    const fnOf: Record<string, string> = { identity: 'identityFn', academics: 'academicsFn', finance: 'financeFn' };
    for (const svc of ['identity', 'academics', 'finance']) {
      const dir = path.join(REPO, 'server/application/microservices', svc, 'src');
      const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' || e.name === 'dist' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.controller.ts') ? [path.join(d, e.name)] : []);
      for (const f of walk(dir)) {
        for (const rt of parseControllerSource(fs.readFileSync(f, 'utf8'), path.relative(REPO, f), svc)) {
          if (!rt.path.startsWith('/internal/')) continue;
          found[rt.path] ??= { fn: fnOf[svc], methods: [] };
          found[rt.path].methods.push(rt.method.toLowerCase());
        }
      }
    }
    const ours = Object.fromEntries(Object.entries(additions.paths).filter(([p]) => p.startsWith('/internal/')).map(([p, a]) => [p, { fn: a.fn, methods: [...a.methods].sort() }]));
    const theirs = Object.fromEntries(Object.entries(found).map(([p, a]) => [p, { fn: a.fn, methods: [...a.methods].sort() }]));
    expect(ours).toEqual(theirs);
  });
});
