import { generateLambdaSpec, render, BINARY_MEDIA_TYPES, type Spec, type RouteMap, type Additions } from './generate-lambda-spec';

const httpProxy = (uri: string, extra: Record<string, unknown> = {}) => ({
  type: 'http_proxy',
  connectionId: '{{connection_id}}',
  httpMethod: 'ANY',
  uri: `{{integration_uri}}${uri}`,
  requestParameters: { 'integration.request.header.tenantPath': 'context.authorizer.tenantPath', ...extra },
  connectionType: 'VPC_LINK',
  passthroughBehavior: 'when_no_match',
});
const security = [{ sharedApigatewayTenantApiAuthorizer: [] }];
const options = (params?: string[]) => ({
  consumes: ['application/json'],
  ...(params ? { parameters: params.map((name) => ({ name, in: 'path', required: true, type: 'string' })) } : {}),
  responses: { '204': { description: '204 response' } },
  'x-amazon-apigateway-integration': { type: 'mock', responses: { default: { statusCode: '204', responseParameters: { 'method.response.header.Access-Control-Allow-Methods': "'GET,PATCH,OPTIONS'" } } }, passthroughBehavior: 'when_no_match' },
});

const fixture = (): Spec => ({
  swagger: '2.0',
  info: { version: '{{version}}', title: '{{API_TITLE}}' },
  basePath: '/{{stage}}',
  paths: {
    '/': { options: options() },
    '/schools/{schoolId}': {
      get: {
        parameters: [
          { name: 'tenantPath', in: 'header', required: true, type: 'string' },
          { name: 'schoolId', in: 'path', required: true, type: 'string' },
        ],
        responses: {},
        security,
        'x-amazon-apigateway-integration': httpProxy('/schools/{schoolId}', { 'integration.request.path.schoolId': 'method.request.path.schoolId' }),
      },
      options: options(['schoolId']),
    },
    '/auth/login': {
      post: { consumes: ['application/json'], produces: ['application/json'], responses: {}, 'x-amazon-apigateway-integration': httpProxy('/auth/login') },
      options: options(),
    },
    '/finance/schools/{schoolId}/invoices': {
      get: {
        parameters: [{ name: 'tenantPath', in: 'header', required: true, type: 'string' }, { name: 'schoolId', in: 'path', required: true, type: 'string' }],
        responses: {},
        security,
        'x-amazon-apigateway-integration': httpProxy('/finance/schools/{schoolId}/invoices', { 'integration.request.path.schoolId': 'method.request.path.schoolId' }),
      },
      options: options(['schoolId']),
    },
  },
});
const routeMap: RouteMap = { prefixes: { '': { target: 'lambda', fn: 'identityFn' }, schools: { target: 'lambda', fn: 'identityFn' }, auth: { target: 'lambda', fn: 'identityFn' }, finance: { target: 'vpclink' } } };
const additions: Additions = { paths: { '/analytics/tenants/{tenantId}': { fn: 'analyticsFn', methods: ['get'] }, '/internal/webhooks/enrollment-completed': { fn: 'financeFn', methods: ['post'] } } };

describe('generateLambdaSpec (C2.2)', () => {
  const out = generateLambdaSpec(fixture(), routeMap, additions);

  it('converts lambda-prefix operations to aws_proxy on the stage variable, with no residue', () => {
    const get = out.paths['/schools/{schoolId}'].get;
    expect(get['x-amazon-apigateway-integration']).toEqual({
      type: 'aws_proxy',
      httpMethod: 'POST',
      uri: 'arn:aws:apigateway:{{region}}:lambda:path/2015-03-31/functions/arn:aws:lambda:{{region}}:{{account_id}}:function:${stageVariables.identityFn}/invocations',
      passthroughBehavior: 'when_no_match',
    });
    expect(JSON.stringify(get)).not.toMatch(/VPC_LINK|connectionId|tenantPath|requestParameters|integration_uri/);
    expect(get.parameters).toEqual([{ name: 'schoolId', in: 'path', required: true, type: 'string' }]);
    expect(get.security).toEqual(security);
  });

  it('leaves the unauthenticated operation unauthenticated and strips only the integration', () => {
    const post = out.paths['/auth/login'].post;
    expect(post.security).toBeUndefined();
    expect(post.consumes).toEqual(['application/json']);
    expect((post['x-amazon-apigateway-integration'] as { type: string }).type).toBe('aws_proxy');
  });

  it('copies vpclink prefixes and every OPTIONS mock verbatim', () => {
    expect(out.paths['/finance/schools/{schoolId}/invoices']).toEqual(fixture().paths['/finance/schools/{schoolId}/invoices']);
    expect(out.paths['/schools/{schoolId}'].options).toEqual(fixture().paths['/schools/{schoolId}'].options);
    expect(out.paths['/'].options).toEqual(fixture().paths['/'].options);
  });

  it('adds the additions with a full operation, the authorizer, path parameters and a cloned OPTIONS mock', () => {
    const item = out.paths['/analytics/tenants/{tenantId}'];
    expect(item.get.security).toEqual(security);
    expect(item.get.parameters).toEqual([{ name: 'tenantId', in: 'path', required: true, type: 'string' }]);
    expect((item.get['x-amazon-apigateway-integration'] as { uri: string }).uri).toContain('${stageVariables.analyticsFn}');
    expect(item.options.parameters).toEqual([{ name: 'tenantId', in: 'path', required: true, type: 'string' }]);
    expect((item.options['x-amazon-apigateway-integration'] as { type: string }).type).toBe('mock');
    const hook = out.paths['/internal/webhooks/enrollment-completed'];
    expect(Object.keys(hook).sort()).toEqual(['options', 'post']);
    expect((hook.post['x-amazon-apigateway-integration'] as { uri: string }).uri).toContain('${stageVariables.financeFn}');
    expect(hook.options.parameters).toBeUndefined();
    const allow = (op: Record<string, unknown>) => (op['x-amazon-apigateway-integration'] as { responses: { default: { responseParameters: Record<string, string> } } }).responses.default.responseParameters['method.response.header.Access-Control-Allow-Methods'];
    expect(allow(item.options)).toBe("'GET,OPTIONS'");
    expect(allow(hook.options)).toBe("'POST,OPTIONS'");
    // source OPTIONS mocks are untouched
    expect(allow(out.paths['/schools/{schoolId}'].options)).toBe("'GET,PATCH,OPTIONS'");
  });

  it('declares the binary media types at the root and keeps the placeholders', () => {
    expect(out['x-amazon-apigateway-binary-media-types']).toEqual(BINARY_MEDIA_TYPES);
    expect(out.info).toEqual({ version: '{{version}}', title: '{{API_TITLE}}' });
    expect(out.basePath).toBe('/{{stage}}');
  });

  it('counts: every source path present, additions appended, no source op left with http_proxy under a lambda prefix', () => {
    expect(Object.keys(out.paths).length).toBe(Object.keys(fixture().paths).length + 2);
    for (const [p, item] of Object.entries(out.paths)) {
      const prefix = p.split('/')[1] ?? '';
      for (const [m, op] of Object.entries(item)) {
        const t = (op['x-amazon-apigateway-integration'] as { type: string }).type;
        if (m === 'options') expect(t).toBe('mock');
        else if (prefix === 'finance') expect(t).toBe('http_proxy');
        else expect(t).toBe('aws_proxy');
      }
    }
  });

  it('is deterministic and idempotent', () => {
    expect(render(generateLambdaSpec(fixture(), routeMap, additions))).toBe(render(out));
  });

  it('fails on an unmapped prefix, an unknown function, an overlapping addition, a bad method', () => {
    const noMap: RouteMap = { prefixes: { ...routeMap.prefixes } };
    delete noMap.prefixes['schools'];
    expect(() => generateLambdaSpec(fixture(), noMap, additions)).toThrow(/no entry for prefix "schools"/);
    expect(() => generateLambdaSpec(fixture(), { prefixes: { ...routeMap.prefixes, schools: { target: 'lambda', fn: 'nopeFn' } } }, additions)).toThrow(/unknown function "nopeFn"/);
    expect(() => generateLambdaSpec(fixture(), routeMap, { paths: { '/auth/login': { fn: 'identityFn', methods: ['post'] } } })).toThrow(/already exists/);
    expect(() => generateLambdaSpec(fixture(), routeMap, { paths: { '/x': { fn: 'identityFn', methods: ['fetch'] } } })).toThrow(/invalid method/);
  });
});
