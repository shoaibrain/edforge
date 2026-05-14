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
 * 1. Walks every `*.controller.ts` in the identity service.
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
 * - Only checks identity controllers. Academics + finance live in
 *   different controllers but currently aren't fronted by tenant-api-prod
 *   (they route via rproxy). Extend `CONTROLLER_GLOBS` when that changes.
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
]);

// Known drift — routes that are missing from the OpenAPI doc but were
// missing BEFORE this linter shipped (2026-05-14). The linter would
// otherwise fail on every CI run and obscure NEW drift. Triage and
// either (a) add to the OpenAPI doc + remove from this list, or
// (b) move to EXEMPT_PATHS with a justification, in follow-up PRs.
//
// **Each entry here is technically a latent 403 SigV4 waiting to happen
// when an operator first hits the endpoint.** Drain this list during
// the next infrastructure-hygiene sprint.
const KNOWN_DRIFT = new Set<string>([
  // S1.3 drained `/schools/{schoolId}/academic-years/{yearId}/grading-periods/{termId}`
  // — root cause was a path-parameter naming mismatch: NestJS controller used
  // `:termId` while the OpenAPI doc used `{periodId}`. API Gateway matched the
  // structure correctly at runtime (parameter labels are just metadata for
  // path matching), but the linter did exact-string comparison and flagged
  // drift. Fixed in tenant-api-prod.json by renaming periodId → termId
  // throughout that route block. 22 known-drift routes remaining.
  '/admin/cleanup-expired-roles',
  '/auth/health',
  '/staff/{staffId}/credentials/expiring',
  '/users/{id}/roles/{schoolId}/change',
  '/users/{id}/roles/permissions/catalog',
  '/users/{id}/roles/backfill-from-staff',
  '/school-years/current-all',
  '/schools/{schoolId}/users',
  '/users/{userId}/security',
  '/users/{userId}/security/change-password',
  '/users/{userId}/security/mfa/setup',
  '/users/{userId}/security/mfa/verify',
  '/users/{userId}/security/mfa/disable',
  '/users/{userId}/security/sessions',
  '/users/{userId}/security/sessions/{sessionId}',
  '/users/{userId}/security/sessions/revoke-all',
  '/users/{userId}/security/login-history',
  '/sessions/user/{userId}',
  '/sessions/user/{userId}/revoke-all',
  '/staff/by-email',
  '/staff/{assignmentId}',
  '/users/me/permissions',
]);

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

const CONTROLLER_DECORATOR_RE = /@Controller\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/;
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
  const controllerMatch = CONTROLLER_DECORATOR_RE.exec(src);
  if (!controllerMatch) return []; // file has no @Controller — not a controller
  const prefix = controllerMatch[1] ?? '';

  const routes: ControllerRoute[] = [];
  METHOD_DECORATOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = METHOD_DECORATOR_RE.exec(src)) !== null) {
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

  const missing: { path: string; routes: ControllerRoute[] }[] = [];
  const knownDriftHits: string[] = [];
  for (const [routePath, routes] of uniqueRoutePaths) {
    if (EXEMPT_PATHS.has(routePath)) continue;
    if (!openapiPaths.has(routePath)) {
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
