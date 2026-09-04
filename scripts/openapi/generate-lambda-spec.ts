/**
 * Cost-redesign C2.2 — generate API-B's OpenAPI document.
 *
 *   npx tsx scripts/openapi/generate-lambda-spec.ts          # writes server/lib/tenant-api-lambda.json
 *   npx tsx scripts/openapi/generate-lambda-spec.ts --check  # exits 1 if the committed file is stale
 *
 * Inputs (all under server/lib): tenant-api-prod.json (API-A's spec, the
 * source of truth for the 279 operator-facing paths), route-map.json (top-level
 * prefix → lambda stage variable | vpclink) and tenant-api-additions.json
 * (API-B-only paths with explicit targets).
 *
 * For a `lambda` prefix every non-OPTIONS operation's integration becomes
 * `aws_proxy` / `POST` against `${stageVariables.<fn>}` — the same stage-variable
 * slot the authorizer already uses — with no connection, no request-parameter
 * mappings and no `tenantPath` header (the services derive the tenant from the
 * JWT). `vpclink` prefixes are copied verbatim, OPTIONS mocks are copied
 * verbatim everywhere, and `security` never changes. Additions get a full
 * operation plus the standard OPTIONS mock. The root gains the binary media
 * types serverless-express base64-encodes. Output is deterministic, so the
 * committed file is diffable and `--check` is a CI gate.
 */
import * as fs from 'fs';
import * as path from 'path';

type Json = Record<string, unknown>;
type Operation = Record<string, unknown> & {
  parameters?: Array<{ name: string; in: string; required?: boolean; type?: string }>;
  'x-amazon-apigateway-integration'?: Json;
};
type PathItem = Record<string, Operation>;
export type Spec = Json & { paths: Record<string, PathItem> };
export type RouteMap = { prefixes: Record<string, { target: 'lambda'; fn: string } | { target: 'vpclink' }> };
export type Additions = { paths: Record<string, { fn: string; methods: string[] }> };

export const BINARY_MEDIA_TYPES = ['application/pdf', 'application/zip', 'application/octet-stream'];
export const STAGE_VARIABLE_FUNCTIONS = ['identityFn', 'academicsFn', 'financeFn', 'analyticsFn'] as const;
const AUTHORIZER_SECURITY = [{ sharedApigatewayTenantApiAuthorizer: [] as string[] }];
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head']);

export function lambdaIntegration(fn: string): Json {
  return {
    type: 'aws_proxy',
    httpMethod: 'POST',
    uri: `arn:aws:apigateway:{{region}}:lambda:path/2015-03-31/functions/arn:aws:lambda:{{region}}:{{account_id}}:function:\${stageVariables.${fn}}/invocations`,
    passthroughBehavior: 'when_no_match',
  };
}

const prefixOf = (p: string) => p.split('/')[1] ?? '';
const pathParams = (p: string) => [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);

function convertOperation(op: Operation, fn: string): Operation {
  const out: Operation = {};
  for (const [k, v] of Object.entries(op)) {
    if (k === 'parameters') {
      const kept = (v as Operation['parameters'])!.filter((p) => !(p.in === 'header' && p.name === 'tenantPath'));
      if (kept.length) out.parameters = kept;
    } else if (k === 'x-amazon-apigateway-integration') {
      out[k] = lambdaIntegration(fn);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function optionsMockFor(source: Spec, p: string): Operation {
  // Clone the OPTIONS mock of a source path with the same number of path
  // parameters; only the parameter names differ.
  const wanted = pathParams(p).length;
  const donor = Object.entries(source.paths).find(([sp, item]) => item.options && pathParams(sp).length === wanted);
  if (!donor) throw new Error(`no OPTIONS mock in the source spec with ${wanted} path parameter(s) to clone for ${p}`);
  const clone = JSON.parse(JSON.stringify(donor[1].options)) as Operation;
  if (wanted) clone.parameters = pathParams(p).map((name) => ({ name, in: 'path', required: true, type: 'string' }));
  else delete clone.parameters;
  return clone;
}

function additionOperation(p: string, fn: string): Operation {
  const params = pathParams(p).map((name) => ({ name, in: 'path', required: true, type: 'string' }));
  return {
    consumes: ['application/json'],
    produces: ['application/json'],
    ...(params.length ? { parameters: params } : {}),
    responses: {},
    security: AUTHORIZER_SECURITY,
    'x-amazon-apigateway-integration': lambdaIntegration(fn),
  };
}

export function generateLambdaSpec(source: Spec, routeMap: RouteMap, additions: Additions): Spec {
  const paths: Record<string, PathItem> = {};
  for (const [p, item] of Object.entries(source.paths)) {
    const entry = routeMap.prefixes[prefixOf(p)];
    if (!entry) throw new Error(`route-map.json has no entry for prefix "${prefixOf(p)}" (path ${p})`);
    if (entry.target === 'vpclink') {
      paths[p] = item;
      continue;
    }
    if (!STAGE_VARIABLE_FUNCTIONS.includes(entry.fn as (typeof STAGE_VARIABLE_FUNCTIONS)[number])) {
      throw new Error(`route-map.json: unknown function "${entry.fn}" for prefix "${prefixOf(p)}"`);
    }
    const converted: PathItem = {};
    for (const [method, op] of Object.entries(item)) {
      converted[method] = method === 'options' || !HTTP_METHODS.has(method) ? op : convertOperation(op, entry.fn);
    }
    paths[p] = converted;
  }
  for (const p of Object.keys(additions.paths).sort()) {
    const a = additions.paths[p];
    if (p in source.paths) throw new Error(`tenant-api-additions.json: ${p} already exists in the source spec`);
    if (!STAGE_VARIABLE_FUNCTIONS.includes(a.fn as (typeof STAGE_VARIABLE_FUNCTIONS)[number])) {
      throw new Error(`tenant-api-additions.json: unknown function "${a.fn}" for ${p}`);
    }
    const item: PathItem = {};
    for (const m of a.methods) {
      if (!HTTP_METHODS.has(m)) throw new Error(`tenant-api-additions.json: ${p} has an invalid method "${m}"`);
      item[m] = additionOperation(p, a.fn);
    }
    item.options = optionsMockFor(source, p);
    paths[p] = item;
  }
  const { paths: _omit, ...root } = source;
  return { ...root, 'x-amazon-apigateway-binary-media-types': BINARY_MEDIA_TYPES, paths };
}

export function render(spec: Spec): string {
  return JSON.stringify(spec, null, 2) + '\n';
}

function main(): number {
  const lib = path.resolve(__dirname, '../../server/lib');
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(lib, f), 'utf8'));
  const out = path.join(lib, 'tenant-api-lambda.json');
  const rendered = render(generateLambdaSpec(read('tenant-api-prod.json'), read('route-map.json'), read('tenant-api-additions.json')));
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (current !== rendered) {
      console.error(`STALE: ${path.relative(process.cwd(), out)} differs from the generator output — run: npm run openapi:generate`);
      return 1;
    }
    console.log(`ok: ${path.relative(process.cwd(), out)} is current`);
    return 0;
  }
  fs.writeFileSync(out, rendered);
  const spec = JSON.parse(rendered) as Spec;
  let lambdaOps = 0, vpcOps = 0, mocks = 0;
  for (const item of Object.values(spec.paths)) {
    for (const [m, op] of Object.entries(item)) {
      const t = (op['x-amazon-apigateway-integration'] as Json | undefined)?.type;
      if (m === 'options') mocks++;
      else if (t === 'aws_proxy') lambdaOps++;
      else if (t === 'http_proxy') vpcOps++;
    }
  }
  console.log(`wrote ${path.relative(process.cwd(), out)}: ${Object.keys(spec.paths).length} paths, ${lambdaOps} Lambda operations, ${vpcOps} VPC-link operations, ${mocks} OPTIONS mocks`);
  return 0;
}

if (require.main === module) process.exit(main());
