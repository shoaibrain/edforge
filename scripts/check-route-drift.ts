/**
 * Route-drift linter — the routing contract between NestJS controllers, the
 * API Gateway specs and (cost-redesign C2.3) the Lambda functions.
 *
 * Four checks, every one of which used to be a 403/404 discovered after a
 * deploy:
 *
 *   1. Nest → spec: every controller route (identity, academics, finance) has
 *      a path in the spec surface — `tenant-api-prod.json` (API-A) plus
 *      `tenant-api-additions.json` (API-B only). A route missing here is a
 *      403 from API Gateway in prod.
 *   2. Spec → function: in the generated `tenant-api-lambda.json` every
 *      non-OPTIONS operation targets the function of the service whose
 *      controller declares the path (`microservices/identity/**` →
 *      identityFn, …, the analytics router → analyticsFn). Operations still
 *      on the VPC link must belong to the service the link serves (finance,
 *      until Sprint 5). This is the check nginx's prefix table used to embody.
 *   3. No residue: no Lambda-targeted operation carries `VPC_LINK`,
 *      `connectionId`, `requestParameters` or a `tenantPath` parameter, and
 *      every VPC-link-prefix operation is still `http_proxy`.
 *   4. Spec → Nest: every spec-surface path with a non-OPTIONS operation has
 *      a controller (or analytics router) route — the inverse of (1).
 *
 * Plus the API Gateway resource-node quota gate (2026-07-06 incident).
 *
 * Runs in CI via .github/workflows/lint-routes.yml together with
 * `npm run openapi:check` (the committed API-B spec must be current).
 * Path comparison is by SHAPE (`{param}` labels are metadata, API Gateway
 * matches on structure): a controller `:id` matches a spec `{invoiceId}`.
 *
 *   npm run lint:routes
 */
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Config
// ============================================

const REPO_ROOT = path.resolve(__dirname, '..');
const CONTROLLER_DIRS = [
  path.join(REPO_ROOT, 'server/application/microservices/identity/src'),
  path.join(REPO_ROOT, 'server/application/microservices/academics/src'),
  path.join(REPO_ROOT, 'server/application/microservices/finance/src'),
];
const OPENAPI_PATH = path.join(REPO_ROOT, 'server/lib/tenant-api-prod.json');
const LAMBDA_SPEC_PATH = path.join(REPO_ROOT, 'server/lib/tenant-api-lambda.json');
const ADDITIONS_PATH = path.join(REPO_ROOT, 'server/lib/tenant-api-additions.json');
const ROUTE_MAP_PATH = path.join(REPO_ROOT, 'server/lib/route-map.json');
const ANALYTICS_ROUTER_PATH = path.join(REPO_ROOT, 'server/lib/analytics/lambda/api/router.ts');

/** Stage variable that resolves each service's function (TARGET §2.2). */
export const SERVICE_FUNCTION: Record<string, string> = {
  identity: 'identityFn',
  academics: 'academicsFn',
  finance: 'financeFn',
  analytics: 'analyticsFn',
};
/** The service the VPC link still serves (finance until Sprint 5). */
export const VPCLINK_OWNER = 'financeFn';
const RESIDUE = ['VPC_LINK', 'connectionId', 'requestParameters', 'tenantPath', 'integration_uri'];

// Exempt routes — for paths that are deliberately NOT in the OpenAPI
// document (e.g. internal-only health/admin endpoints exposed via
// rproxy but not API Gateway). Add with a one-line justification.
const EXEMPT_PATHS = new Set<string>([
  // Auth endpoints are added at root level via /auth/* on API GW — they
  // resolve before any controller-mounted route does, and the OpenAPI
  // doc has them under `/auth` not `/auth/login`. Skipped to avoid noisy
  // false positives from the regex parser.
  // (Add specific exemptions here with comments.)

  // The three /internal/* service-to-service routes used to be exempt
  // ("Service Connect only"). Since cost-redesign C2.1 they are API-B paths
  // in tenant-api-additions.json, so they are part of the spec surface and
  // checked like any other route.

  // Internal container-liveness probe (AuthController @Get('health')).
  // The ALB target group checks /identity/health and the reverse proxy
  // serves /health directly (nginx `location = /health`); neither routes
  // through API Gateway to this handler, and no client calls it. Adding
  // it to the API GW spec would expose a redundant public liveness probe
  // with no consumer. (Slice 2, BH-2.1.)
  '/auth/health',
]);

// Known drift — routes missing from the OpenAPI doc, tolerated so the
// linter doesn't fail on every CI run and obscure NEW drift.
//
// **DRAINED to empty in Slice 2 (BH-2.1), 2026-07.** The prior 12 entries
// resolved as: 10 real operator-facing routes SPEC-ADDED to
// tenant-api-prod.json (admin/cleanup-expired-roles, users/{id}/roles/
// {schoolId}/change, users/{id}/roles/permissions/catalog,
// roles/backfill-from-staff [+new ^/roles nginx block], users/me/
// permissions, staff/by-email, sessions/user/{userId}[/revoke-all],
// school-years/current-all, schools/{schoolId}/users); /auth/health moved
// to EXEMPT_PATHS; and TWO entries were false labels produced by this
// script's former first-@Controller-only parsing of files with multiple
// controllers — now fixed (see parseController): /users/{id}/roles/
// backfill-from-staff was really /roles/backfill-from-staff, and
// /staff/{staffId}/credentials/expiring was really /credentials/expiring
// (already in-spec). Keep this set EMPTY: any new drift must be fixed
// (spec-add) or exempted, never parked here.
const KNOWN_DRIFT = new Set<string>([]);

// ============================================
// Types
// ============================================

export interface ControllerRoute {
  /** Source file path relative to repo root, for error reporting. */
  sourceFile: string;
  /** Owning service (identity | academics | finance | analytics). */
  service: string;
  /** HTTP method (uppercased). */
  method: string;
  /** Full OpenAPI-shaped path, e.g. `/schools/{schoolId}/configuration`. */
  path: string;
}

// ============================================
// Controller parsing
// ============================================

// Global so a file with MORE THAN ONE @Controller (e.g. a param-scoped
// controller + an admin controller in the same .ts) is fully enumerated;
// each @Method binds to its nearest preceding @Controller, not the first
// one in the file. (Pre-fix, first-@Controller-only mis-attributed the
// second controller's routes — the source of two false KNOWN_DRIFT
// entries: /roles/backfill-from-staff and /credentials/expiring.)
const CONTROLLER_DECORATOR_RE = /@Controller\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;
const METHOD_DECORATOR_RE =
  /@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;

/** Find every *.controller.ts under the given directory, recursively. */
function findControllerFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules + dist + tests
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') continue;
      out.push(...findControllerFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.controller.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Normalize NestJS path syntax to OpenAPI path syntax. */
function normalizePath(raw: string): string {
  // Strip leading + trailing slashes, then re-add a single leading slash.
  const stripped = raw.replace(/^\/+|\/+$/g, '');
  // NestJS `:param` → OpenAPI `{param}`.
  const openapied = stripped.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  return openapied === '' ? '/' : '/' + openapied;
}

/** Join a controller prefix and a method subpath, OpenAPI-normalized. */
function joinPaths(prefix: string, subpath: string): string {
  const a = prefix.replace(/^\/+|\/+$/g, '');
  const b = subpath.replace(/^\/+|\/+$/g, '');
  if (!a && !b) return '/';
  if (!a) return normalizePath('/' + b);
  if (!b) return normalizePath('/' + a);
  return normalizePath('/' + a + '/' + b);
}

/** Parse one controller file and return every route it exposes. */
export function parseController(filePath: string, service = serviceOf(filePath)): ControllerRoute[] {
  return parseControllerSource(fs.readFileSync(filePath, 'utf8'), path.relative(REPO_ROOT, filePath), service);
}

/** identity | academics | finance from a microservices/<svc>/ path. */
export function serviceOf(filePath: string): string {
  const m = filePath.replace(/\\/g, '/').match(/microservices\/([a-z]+)\//);
  return m ? m[1] : 'unknown';
}

export function parseControllerSource(src: string, sourceFile: string, service: string): ControllerRoute[] {
  // Collect every @Controller with its source offset (a file may declare
  // several). Order of matchAll is source order.
  const controllers: Array<{ index: number; prefix: string }> = [];
  CONTROLLER_DECORATOR_RE.lastIndex = 0;
  let cm: RegExpExecArray | null;
  while ((cm = CONTROLLER_DECORATOR_RE.exec(src)) !== null) {
    controllers.push({ index: cm.index, prefix: cm[1] ?? '' });
  }
  if (controllers.length === 0) return []; // no @Controller — not a controller

  const routes: ControllerRoute[] = [];
  METHOD_DECORATOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = METHOD_DECORATOR_RE.exec(src)) !== null) {
    // A routed @Method must live inside a @Controller class, i.e. after the
    // first @Controller. If one somehow appears before it, we can't know
    // its prefix — skip rather than mis-attribute it to controllers[0].
    if (match.index < controllers[0].index) continue;
    // Bind this @Method to the nearest @Controller declared BEFORE it.
    let prefix = controllers[0].prefix;
    for (const c of controllers) {
      if (c.index < match.index) prefix = c.prefix;
      else break;
    }
    const method = match[1].toUpperCase();
    const subpath = match[2] ?? '';
    const fullPath = joinPaths(prefix, subpath);
    routes.push({ sourceFile, service, method, path: fullPath });
  }
  return routes;
}

/**
 * The analytics API Lambda's router (`ROUTES` in router.ts) is the fourth
 * route source: `{ method: 'GET', pattern: /^\/analytics\/tenants\/([^/]+)$/ }`
 * → GET /analytics/tenants/{param}.
 */
export function parseAnalyticsRouterSource(src: string, sourceFile = 'server/lib/analytics/lambda/api/router.ts'): ControllerRoute[] {
  const routes: ControllerRoute[] = [];
  const re = /method:\s*'([A-Z]+)',\s*pattern:\s*\/\^((?:\\\/[^$]*?))\$\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const p = m[2].replace(/\\\//g, '/').replace(/\(\[\^\/\]\+\)/g, '{param}');
    routes.push({ sourceFile, service: 'analytics', method: m[1], path: p });
  }
  return routes;
}

// ============================================
// OpenAPI parsing
// ============================================

function readOpenApiPaths(): Set<string> {
  const raw = fs.readFileSync(OPENAPI_PATH, 'utf8');
  const doc = JSON.parse(raw);
  const paths = doc.paths ?? {};
  return new Set(Object.keys(paths));
}

// API Gateway matches on path STRUCTURE; `{param}` labels are metadata
// (the S1.3 periodId/termId incident documented in KNOWN_DRIFT above was
// this exact false-positive class). Compare shapes, not labels: a
// controller `:id` matches a spec `{invoiceId}` at the same position.
function shapeKey(p: string): string {
  return p.replace(/\{[^}]+\}/g, '{}');
}

// ============================================
// Spec helpers
// ============================================

type Operation = Record<string, unknown>;
type SpecDoc = { paths: Record<string, Record<string, Operation>> };
type RouteMap = { prefixes: Record<string, { target: 'lambda'; fn: string } | { target: 'vpclink' }> };

const prefixOf = (p: string) => p.split('/')[1] ?? '';
const isOp = (method: string) => method !== 'options' && !method.startsWith('x-');
const integrationOf = (op: Operation) => (op['x-amazon-apigateway-integration'] ?? {}) as { type?: string; uri?: string };
const fnOf = (op: Operation) => integrationOf(op).uri?.match(/\$\{stageVariables\.([A-Za-z]+)\}/)?.[1];

/** Path shape → the functions whose controllers declare it. */
export function ownershipIndex(routes: ControllerRoute[]): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const r of routes) {
    const fn = SERVICE_FUNCTION[r.service];
    if (!fn) continue;
    const key = shapeKey(r.path);
    if (!idx.has(key)) idx.set(key, new Set());
    idx.get(key)!.add(fn);
  }
  return idx;
}

// ============================================
// Checks (pure; main() wires the files)
// ============================================

/** (1) Nest → spec surface. Returns the missing paths with their routes. */
export function checkNestToSpec(
  routes: ControllerRoute[],
  surfacePaths: Set<string>,
  exempt: Set<string> = EXEMPT_PATHS,
): Array<{ path: string; routes: ControllerRoute[] }> {
  const shapes = new Set([...surfacePaths].map(shapeKey));
  const byPath = new Map<string, ControllerRoute[]>();
  for (const r of routes) {
    if (!byPath.has(r.path)) byPath.set(r.path, []);
    byPath.get(r.path)!.push(r);
  }
  const missing: Array<{ path: string; routes: ControllerRoute[] }> = [];
  for (const [p, rs] of byPath) {
    if (exempt.has(p) || KNOWN_DRIFT.has(p)) continue;
    if (!surfacePaths.has(p) && !shapes.has(shapeKey(p))) missing.push({ path: p, routes: rs });
  }
  return missing;
}

/** (2) Spec → function: each operation targets its owner. */
export function checkSpecToFunction(lambdaSpec: SpecDoc, ownership: Map<string, Set<string>>): string[] {
  const problems: string[] = [];
  for (const [p, item] of Object.entries(lambdaSpec.paths)) {
    const owners = ownership.get(shapeKey(p));
    for (const [method, op] of Object.entries(item)) {
      if (!isOp(method)) continue;
      const integ = integrationOf(op);
      if (integ.type === 'aws_proxy') {
        const fn = fnOf(op);
        if (!fn) { problems.push(`${method.toUpperCase()} ${p}: aws_proxy integration without a \${stageVariables.<fn>} slot`); continue; }
        if (!owners) { problems.push(`${method.toUpperCase()} ${p}: targets ${fn} but no controller declares this path`); continue; }
        if (owners.size > 1) { problems.push(`${method.toUpperCase()} ${p}: declared by several services (${[...owners].join(', ')})`); continue; }
        if (!owners.has(fn)) problems.push(`${method.toUpperCase()} ${p}: targets ${fn} but the controller lives in the ${[...owners][0]} service`);
      } else if (integ.type === 'http_proxy') {
        if (!owners) { problems.push(`${method.toUpperCase()} ${p}: on the VPC link but no controller declares this path`); continue; }
        if (!owners.has(VPCLINK_OWNER)) problems.push(`${method.toUpperCase()} ${p}: on the VPC link (serves ${VPCLINK_OWNER}) but owned by ${[...owners].join(', ')}`);
      } else {
        problems.push(`${method.toUpperCase()} ${p}: unexpected integration type ${integ.type ?? 'none'}`);
      }
    }
  }
  return problems;
}

/** (3) No residue on Lambda-targeted operations; VPC-link prefixes untouched. */
export function checkNoResidue(lambdaSpec: SpecDoc, routeMap: RouteMap): string[] {
  const problems: string[] = [];
  for (const [p, item] of Object.entries(lambdaSpec.paths)) {
    const entry = routeMap.prefixes[prefixOf(p)];
    const vpc = entry?.target === 'vpclink';
    for (const [method, op] of Object.entries(item)) {
      if (!isOp(method)) continue;
      const text = JSON.stringify(op);
      if (vpc) {
        if (integrationOf(op).type !== 'http_proxy') problems.push(`${method.toUpperCase()} ${p}: VPC-link prefix but integration is ${integrationOf(op).type}`);
        continue;
      }
      for (const token of RESIDUE) if (text.includes(token)) problems.push(`${method.toUpperCase()} ${p}: residue "${token}" on a Lambda-targeted operation`);
    }
  }
  return problems;
}

/** (4) Spec → Nest: every surface path with a real operation has an owner. */
export function checkSpecToNest(surface: SpecDoc, ownership: Map<string, Set<string>>): string[] {
  const problems: string[] = [];
  for (const [p, item] of Object.entries(surface.paths)) {
    if (!Object.keys(item).some(isOp)) continue;
    if (!ownership.has(shapeKey(p))) problems.push(`${p}: in the spec but no controller or analytics route declares it`);
  }
  return problems;
}

/** API Gateway resource nodes for a set of paths (one node per unique segment prefix). */
export function resourceNodeCount(paths: Iterable<string>): number {
  const nodes = new Set<string>(['/']);
  for (const p of paths) {
    const segs = p.replace(/^\/+/, '').split('/');
    for (let i = 1; i <= segs.length; i++) nodes.add(segs.slice(0, i).join('/'));
  }
  return nodes.size;
}

// ============================================
// Main
// ============================================

function main(): number {
  const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  const source = readJson<SpecDoc>(OPENAPI_PATH);
  const additions = readJson<{ paths: Record<string, { fn: string; methods: string[] }> }>(ADDITIONS_PATH);
  const lambdaSpec = readJson<SpecDoc>(LAMBDA_SPEC_PATH);
  const routeMap = readJson<RouteMap>(ROUTE_MAP_PATH);

  const routes: ControllerRoute[] = [];
  for (const dir of CONTROLLER_DIRS) for (const file of findControllerFiles(dir)) routes.push(...parseController(file));
  routes.push(...parseAnalyticsRouterSource(fs.readFileSync(ANALYTICS_ROUTER_PATH, 'utf8')));
  const ownership = ownershipIndex(routes);

  // Spec surface = API-A's paths + API-B-only additions.
  const surface: SpecDoc = { paths: { ...source.paths } };
  for (const [p, a] of Object.entries(additions.paths)) surface.paths[p] = Object.fromEntries(a.methods.map((m) => [m, {}]));
  const surfacePaths = new Set(Object.keys(surface.paths));

  let failed = false;
  const report = (title: string, problems: string[]) => {
    if (problems.length === 0) { console.log(`OK   ${title}`); return; }
    failed = true;
    console.error(`FAIL ${title} — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
  };

  // Quota gate on the larger surface (API-B carries the additions).
  const APIGW_RESOURCE_QUOTA = 500;
  const nodeCount = resourceNodeCount(Object.keys(lambdaSpec.paths));
  console.log(`API Gateway resource nodes: ${nodeCount}/${APIGW_RESOURCE_QUOTA} (quota L-01C8A9E0)`);
  if (nodeCount > APIGW_RESOURCE_QUOTA * 0.9) {
    console.error(`\nFATAL: ${nodeCount} API GW resource nodes exceeds 90% of the ${APIGW_RESOURCE_QUOTA} quota. Request an increase (L-01C8A9E0) before merging more routes.`);
    return 1;
  }
  console.log(`checked ${routes.length} routes (${routes.filter((r) => r.service !== 'analytics').length} controller + ${routes.filter((r) => r.service === 'analytics').length} analytics) against ${surfacePaths.size} spec paths (${Object.keys(source.paths).length} API-A + ${Object.keys(additions.paths).length} API-B additions); API-B spec ${Object.keys(lambdaSpec.paths).length} paths\n`);

  const missing = checkNestToSpec(routes, surfacePaths);
  report('(1) every controller route is in the spec surface', missing.map((m) => `${m.path}  [${m.routes.map((r) => `${r.method} ${r.sourceFile}`).join('; ')}]`));
  if (missing.length) console.error(`     fix: add the path to server/lib/tenant-api-prod.json (operator-facing) or tenant-api-additions.json (API-B only), then npm run openapi:generate; or exempt it in EXEMPT_PATHS with a reason.`);
  report('(2) every API-B operation targets the function that owns the path', checkSpecToFunction(lambdaSpec, ownership));
  report('(3) no VPC-link residue on Lambda-targeted operations', checkNoResidue(lambdaSpec, routeMap));
  report('(4) every spec path has a controller or analytics route', checkSpecToNest(surface, ownership));

  if (!failed) console.log('\nOK — routing contract holds (Nest ⇄ spec ⇄ function).');
  return failed ? 1 : 0;
}

if (require.main === module) process.exit(main());
