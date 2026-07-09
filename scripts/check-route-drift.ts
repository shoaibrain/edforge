#!/usr/bin/env ts-node
/**
 * check-route-drift.ts — Sprint S0 retro.
 *
 * Catches the 2026-05-14 incident class: a new NestJS controller route
 * shipped to prod without a matching entry in
 * `server/lib/tenant-api-prod.json`, surfacing as a 403 SigV4 from API
 * Gateway when smoke-tested post-deploy.
 *
 * What this script does
 * =====================
 * 1. Walks every `*.controller.ts` in the identity, academics, and finance services.
 * 2. Extracts `@Controller('<prefix>')` and per-method
 *    `@Get/@Post/@Put/@Patch/@Delete('<subpath>')` decorators via regex.
 * 3. Joins prefix + subpath → full route path.
 * 4. Normalizes NestJS `:param` syntax → OpenAPI `{param}` syntax.
 * 5. Reads the `paths` object from `tenant-api-prod.json`.
 * 6. Reports every controller route that doesn't have a matching key
 *    in the OpenAPI document.
 *
 * Exit code
 * =========
 * - 0 if every controller route is registered.
 * - 1 if ANY route is missing — meant to be wired into CI eventually.
 *   Right now it ships as `npm run lint:routes` (advisory).
 *
 * Limitations (deliberate, for V1 scope)
 * ======================================
 * - Regex-based parsing, not AST. Won't pick up decorators built
 *   dynamically (e.g. via `@SetMetadata`). All current controllers
 *   use string-literal arguments — verified by inspection.
 * - Scans identity + academics + finance controllers (EPIC-FB task H
 *   extended the original identity-only scope — the "academics/finance
 *   aren't fronted by tenant-api-prod" assumption this script shipped
 *   with stopped being true when those services' routes were added to
 *   the OpenAPI doc).
 * - Doesn't validate the inverse (OpenAPI paths with no controller).
 *   Useful but lower-stakes; add as a follow-up if it bites.
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

// Exempt routes — for paths that are deliberately NOT in the OpenAPI
// document (e.g. internal-only health/admin endpoints exposed via
// rproxy but not API Gateway). Add with a one-line justification.
const EXEMPT_PATHS = new Set<string>([
  // Auth endpoints are added at root level via /auth/* on API GW — they
  // resolve before any controller-mounted route does, and the OpenAPI
  // doc has them under `/auth` not `/auth/login`. Skipped to avoid noisy
  // false positives from the regex parser.
  // (Add specific exemptions here with comments.)

  // Service-to-service enrollment webhooks: reached via the internal
  // Service Connect mesh (rproxy is not in the path either), deliberately
  // NOT fronted by API Gateway — no operator-facing client calls them.
  '/internal/webhooks/enrollment-completed',
  '/internal/webhooks/student-withdrawn',

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

interface ControllerRoute {
  /** Source file path relative to repo root, for error reporting. */
  sourceFile: string;
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
function parseController(filePath: string): ControllerRoute[] {
  const src = fs.readFileSync(filePath, 'utf8');

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
    routes.push({
      sourceFile: path.relative(REPO_ROOT, filePath),
      method,
      path: fullPath,
    });
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
// Main
// ============================================

function main(): number {
  const allRoutes: ControllerRoute[] = [];
  for (const dir of CONTROLLER_DIRS) {
    for (const file of findControllerFiles(dir)) {
      allRoutes.push(...parseController(file));
    }
  }

  const openapiPaths = readOpenApiPaths();

  // Deduplicate controller-route paths (multiple HTTP methods on the same
  // path are one OpenAPI path entry).
  const uniqueRoutePaths = new Map<string, ControllerRoute[]>();
  for (const r of allRoutes) {
    if (!uniqueRoutePaths.has(r.path)) uniqueRoutePaths.set(r.path, []);
    uniqueRoutePaths.get(r.path)!.push(r);
  }

  // API Gateway quota-headroom gate (2026-07-06 incident: the resource
  // tree sat at 297/300 invisibly for months; the first deploy to cross
  // the default limit burned an hour in prod retry+rollback). Every
  // unique path segment is one API GW Resource. Quota L-01C8A9E0 is now
  // 500 for this account; fail loudly at 90% so the next approach is a
  // red PR check, not a deploy surprise.
  const APIGW_RESOURCE_QUOTA = 500;
  const nodes = new Set<string>(['/']);
  for (const p of openapiPaths) {
    const segs = p.replace(/^\/+/, '').split('/');
    for (let i = 1; i <= segs.length; i++) nodes.add(segs.slice(0, i).join('/'));
  }
  const nodeCount = nodes.size;
  console.log(`API Gateway resource nodes: ${nodeCount}/${APIGW_RESOURCE_QUOTA} (quota L-01C8A9E0)`);
  if (nodeCount > APIGW_RESOURCE_QUOTA * 0.9) {
    console.error(
      `\nFATAL: ${nodeCount} API GW resource nodes exceeds 90% of the ${APIGW_RESOURCE_QUOTA} quota.` +
      `\nRequest a quota increase (service-quotas, code L-01C8A9E0) BEFORE merging more routes,` +
      `\nthen raise APIGW_RESOURCE_QUOTA here to match the new applied value.`,
    );
    return 1;
  }

  const openapiShapes = new Set([...openapiPaths].map(shapeKey));

  const missing: { path: string; routes: ControllerRoute[] }[] = [];
  const knownDriftHits: string[] = [];
  for (const [routePath, routes] of uniqueRoutePaths) {
    if (EXEMPT_PATHS.has(routePath)) continue;
    if (!openapiPaths.has(routePath) && !openapiShapes.has(shapeKey(routePath))) {
      if (KNOWN_DRIFT.has(routePath)) {
        knownDriftHits.push(routePath);
      } else {
        missing.push({ path: routePath, routes });
      }
    }
  }

  console.log(`\nchecked ${allRoutes.length} controller routes across ${uniqueRoutePaths.size} unique paths`);
  console.log(`openapi document declares ${openapiPaths.size} paths`);
  if (knownDriftHits.length > 0) {
    console.log(`${knownDriftHits.length} known-drift route(s) skipped (queued for cleanup — see KNOWN_DRIFT in this script)`);
  }

  if (missing.length === 0) {
    console.log(`\nOK — every NEW controller route is registered in ${path.relative(REPO_ROOT, OPENAPI_PATH)}.`);
    return 0;
  }

  console.error(
    `\n${missing.length} controller route(s) are NOT in ${path.relative(REPO_ROOT, OPENAPI_PATH)}:`,
  );
  console.error('  (these will return 403 SigV4 from API Gateway in prod)\n');
  for (const m of missing) {
    console.error(`  - ${m.path}`);
    for (const r of m.routes) {
      console.error(`      ${r.method.padEnd(6)} ${r.sourceFile}`);
    }
  }
  console.error(`\nTo fix: add each path to ${path.relative(REPO_ROOT, OPENAPI_PATH)} under \`paths\` (mirror an existing similar route's shape).`);
  console.error(`Or, if a route is deliberately not exposed via API Gateway, add it to EXEMPT_PATHS in scripts/check-route-drift.ts with a one-line justification.`);

  return 1;
}

process.exit(main());
