#!/usr/bin/env ts-node
/**
 * authz-coverage.ts — Authorization coverage audit for EdForge controllers.
 *
 * Why this exists
 * ===============
 * The permission-matrix tests prove the decision engine is correct *where it is
 * applied*. They cannot tell you about an endpoint that forgot to apply it. For
 * a pilot greenlight the most dangerous gap is an endpoint that any
 * authenticated user (a Parent, a Student) can hit because it carries no
 * authorization. This script produces the honest map: every controller route,
 * its effective guards, and a classification — and fails CI if a new
 * un-reviewed unguarded route appears.
 *
 * Enforcement model (verified by inspection)
 * ==========================================
 * - AuthN: `@UseGuards(JwtAuthGuard)`, usually at the controller (class) level.
 * - AuthZ (resource): `@RequirePermission({resource, action})` read by
 *   `PermissionGuard`. CRITICAL: `PermissionGuard` is a NO-OP without the
 *   decorator (`if (!permission) return true`), so enforcement keys on the
 *   DECORATOR, not the guard.
 * - AuthZ (global role): `@RequireGlobalRole(...)` read by `GlobalRoleGuard`.
 * - Self-enforcing guards (no decorator needed): `IemisPermissionGuard`,
 *   `InternalApiKeyGuard`, `StaffReadGuard` (denies portal accounts on staff
 *   HR reads).
 *
 * Classification
 * ==============
 * - `authz`       — has @RequirePermission / @RequireGlobalRole, or a
 *                   self-enforcing authz guard.
 * - `internal`    — InternalApiKeyGuard (service-to-service).
 * - `authn-only`  — authenticated (JwtAuthGuard) but NO authz enforcement.
 *                   Any logged-in user in the tenant can hit it. REVIEW.
 * - `public`      — no JwtAuthGuard at all. Unauthenticated. REVIEW.
 *
 * `authn-only` + `public` are REVIEW routes. The gate fails if any REVIEW route
 * is not in `scripts/audit/authz-allowlist.txt` (intentional, justified).
 *
 * Usage
 * =====
 *   npx ts-node scripts/audit/authz-coverage.ts            # gate (exit 1 on un-allowlisted REVIEW)
 *   npx ts-node scripts/audit/authz-coverage.ts --report <path>   # also write the markdown map
 *   npx ts-node scripts/audit/authz-coverage.ts --self-test       # parser unit checks
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVICE_DIRS = ['identity', 'academics', 'finance'].map((s) =>
  path.join(REPO_ROOT, 'server/application/microservices', s, 'src'),
);
const ALLOWLIST_PATH = path.join(__dirname, 'authz-allowlist.txt');
const BASELINE_PATH = path.join(__dirname, 'authz-baseline.txt');

const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All']);
const AUTHN_GUARDS = new Set(['JwtAuthGuard']);
const SELF_ENFORCING_AUTHZ_GUARDS = new Set(['IemisPermissionGuard', 'InternalApiKeyGuard', 'StaffReadGuard']);
const AUTHZ_DECORATORS = new Set(['RequirePermission', 'RequireGlobalRole', 'RequireIemisPermission']);

type Classification = 'authz' | 'internal' | 'authn-only' | 'public';

interface RouteCoverage {
  service: string;
  controller: string;
  method: string;
  routePath: string;
  guards: string[];
  authzDecorators: string[];
  classification: Classification;
  note?: string;
  key: string; // "METHOD /path"
}

// ============================================================
// AST extraction
// ============================================================

function decoratorsOf(node: ts.Node): { name: string; args: ts.NodeArray<ts.Expression> | ts.Expression[] }[] {
  const decs = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
  const out: { name: string; args: ts.Expression[] }[] = [];
  for (const d of decs ?? []) {
    const expr = d.expression;
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
      out.push({ name: expr.expression.text, args: Array.from(expr.arguments) });
    } else if (ts.isIdentifier(expr)) {
      out.push({ name: expr.text, args: [] });
    }
  }
  return out;
}

function stringArg(args: ts.Expression[]): string | undefined {
  const a = args[0];
  if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) return a.text;
  return undefined;
}

/** Guard names from a @UseGuards(...) decorator — bare `Guard` or `new Guard()`. */
function guardNames(args: ts.Expression[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (ts.isIdentifier(a)) out.push(a.text);
    else if (ts.isNewExpression(a) && ts.isIdentifier(a.expression)) out.push(a.expression.text);
  }
  return out;
}

function joinPath(prefix: string, sub: string): string {
  const parts = [prefix, sub].filter((p) => p && p.length > 0).join('/');
  let p = '/' + parts.replace(/\/+/g, '/').replace(/^\//, '');
  if (p.length > 1) p = p.replace(/\/$/, '');
  return p;
}

function classify(guards: string[], authzDecorators: string[]): { classification: Classification; note?: string } {
  const hasAuthn = guards.some((g) => AUTHN_GUARDS.has(g));
  const hasSelfEnforcing = guards.some((g) => SELF_ENFORCING_AUTHZ_GUARDS.has(g));
  const hasAuthzDecorator = authzDecorators.length > 0;
  const hasPermGuardNoDecorator =
    (guards.includes('PermissionGuard') || guards.includes('GlobalRoleGuard')) && !hasAuthzDecorator;

  if (guards.includes('InternalApiKeyGuard')) return { classification: 'internal' };
  if (hasAuthzDecorator || hasSelfEnforcing) return { classification: 'authz' };
  if (hasAuthn) {
    return {
      classification: 'authn-only',
      note: hasPermGuardNoDecorator ? 'authz guard present but NO @RequirePermission (no-op)' : undefined,
    };
  }
  return { classification: 'public' };
}

/** Parse a single controller source into route coverage records. Pure — unit-testable. */
export function analyzeSource(source: string, service: string, controllerLabel: string): RouteCoverage[] {
  const sf = ts.createSourceFile(controllerLabel, source, ts.ScriptTarget.Latest, true);
  const routes: RouteCoverage[] = [];

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node)) {
      const classDecs = decoratorsOf(node);
      const controllerDec = classDecs.find((d) => d.name === 'Controller');
      if (controllerDec) {
        const prefix = stringArg(controllerDec.args as ts.Expression[]) ?? '';
        const classGuards = classDecs
          .filter((d) => d.name === 'UseGuards')
          .flatMap((d) => guardNames(d.args as ts.Expression[]));
        const classAuthzDecorators = classDecs.filter((d) => AUTHZ_DECORATORS.has(d.name)).map((d) => d.name);

        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          const decs = decoratorsOf(member);
          const httpDec = decs.find((d) => HTTP_DECORATORS.has(d.name));
          if (!httpDec) continue;

          const sub = stringArg(httpDec.args as ts.Expression[]) ?? '';
          const methodGuards = decs.filter((d) => d.name === 'UseGuards').flatMap((d) => guardNames(d.args as ts.Expression[]));
          const methodAuthzDecorators = decs.filter((d) => AUTHZ_DECORATORS.has(d.name)).map((d) => d.name);

          const guards = Array.from(new Set([...classGuards, ...methodGuards]));
          const authzDecorators = Array.from(new Set([...classAuthzDecorators, ...methodAuthzDecorators]));
          const httpMethod = httpDec.name.toUpperCase();
          const routePath = joinPath(prefix, sub);
          const { classification, note } = classify(guards, authzDecorators);

          routes.push({
            service,
            controller: controllerLabel,
            method: httpMethod,
            routePath,
            guards,
            authzDecorators,
            classification,
            note,
            key: `${httpMethod} ${routePath}`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return routes;
}

// ============================================================
// File discovery
// ============================================================

function findControllerFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '__tests__'].includes(entry.name)) continue;
      out.push(...findControllerFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.controller.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function analyzeAll(): RouteCoverage[] {
  const routes: RouteCoverage[] = [];
  for (const dir of SERVICE_DIRS) {
    const service = path.basename(path.dirname(dir));
    for (const file of findControllerFiles(dir)) {
      const source = fs.readFileSync(file, 'utf8');
      routes.push(...analyzeSource(source, service, path.basename(file)));
    }
  }
  return routes.sort((a, b) => a.key.localeCompare(b.key));
}

function readKeys(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter((l) => l.length > 0);
}

/** Union of intentional allowlist + the known-baseline (pending authz triage). */
function loadAllowlist(): Set<string> {
  return new Set([...readKeys(ALLOWLIST_PATH), ...readKeys(BASELINE_PATH)]);
}

/** Reproducibly (re)write authz-baseline.txt = all REVIEW keys minus the allowlist. */
function seedBaseline(routes: RouteCoverage[]): number {
  const allow = new Set(readKeys(ALLOWLIST_PATH));
  const keys = routes
    .filter((r) => r.classification === 'authn-only' || r.classification === 'public')
    .map((r) => r.key)
    .filter((k) => !allow.has(k))
    .sort();
  const header = [
    '# Authorization BASELINE — pre-existing authn-only routes pending authorization.',
    '# Reproducibly generated by: npx ts-node scripts/audit/authz-coverage.ts --seed-baseline',
    '# (= every authn-only/public route MINUS the intentional authz-allowlist.txt).',
    '#',
    '# These routes are authenticated (JwtAuthGuard) but carry NO guard-level',
    '# authorization. Recorded as the KNOWN baseline so the gate passes today and',
    '# fails on any NEW unguarded route. They are NOT approved — DRAIN this file as',
    '# endpoints gain guard-level authz. Priority + interpretation:',
    '# docs/alpha-launch/authz-coverage-findings.md',
    '',
  ];
  fs.writeFileSync(BASELINE_PATH, header.join('\n') + keys.join('\n') + '\n');
  console.log(`Wrote baseline (${keys.length} routes) → ${path.relative(REPO_ROOT, BASELINE_PATH)}`);
  return 0;
}

// ============================================================
// Reporting
// ============================================================

function buildReport(routes: RouteCoverage[]): string {
  const counts = routes.reduce<Record<string, number>>((acc, r) => {
    acc[r.classification] = (acc[r.classification] ?? 0) + 1;
    return acc;
  }, {});
  const lines: string[] = [];
  lines.push('# Authorization Coverage — generated map');
  lines.push('');
  lines.push('> Generated by `scripts/audit/authz-coverage.ts`. Do not edit by hand.');
  lines.push('');
  lines.push(
    `**Totals:** ${routes.length} routes — ` +
      `authz ${counts.authz ?? 0}, internal ${counts.internal ?? 0}, ` +
      `**authn-only ${counts['authn-only'] ?? 0}**, **public ${counts.public ?? 0}**.`,
  );
  lines.push('');
  const review = routes.filter((r) => r.classification === 'authn-only' || r.classification === 'public');
  if (review.length) {
    lines.push('## REVIEW — routes without resource authorization');
    lines.push('');
    lines.push('| Class | Route | Guards | Note |');
    lines.push('|---|---|---|---|');
    for (const r of review) {
      lines.push(`| ${r.classification} | \`${r.key}\` | ${r.guards.join(', ') || '—'} | ${r.note ?? ''} |`);
    }
    lines.push('');
  }
  lines.push('## Full map');
  lines.push('');
  const services = Array.from(new Set(routes.map((r) => r.service))).sort();
  for (const service of services) {
    lines.push(`### ${service}`);
    lines.push('');
    lines.push('| Route | Class | Authz | Guards |');
    lines.push('|---|---|---|---|');
    for (const r of routes.filter((x) => x.service === service)) {
      lines.push(`| \`${r.key}\` | ${r.classification} | ${r.authzDecorators.join(', ') || '—'} | ${r.guards.join(', ') || '—'} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ============================================================
// Self-test
// ============================================================

function selfTest(): number {
  const fixture = `
    @Controller('demo')
    @UseGuards(JwtAuthGuard)
    export class DemoController {
      @Get(':id')
      @UseGuards(PermissionGuard)
      @RequirePermission({ resource: 'students', action: 'view' })
      getOne() {}

      @Get()
      listAll() {}                      // authn-only (no decorator)

      @Post()
      @UseGuards(PermissionGuard)
      createNoDecorator() {}            // authn-only — guard present, no decorator (no-op)

      @Delete(':id')
      @UseGuards(InternalApiKeyGuard)
      internalOnly() {}                 // internal

      @Patch('iemis')
      @UseGuards(new IemisPermissionGuard())
      iemisNewExpr() {}                 // authz — self-enforcing guard via new-expression

      @Get('staff')
      @UseGuards(StaffReadGuard)
      staffRead() {}                    // authz — self-enforcing staff-read guard
    }

    @Controller('public-thing')
    export class PublicController {
      @Get('health')
      health() {}                       // public (no JwtAuthGuard)
    }
  `;
  const routes = analyzeSource(fixture, 'identity', 'demo.controller.ts');
  const by = (k: string) => routes.find((r) => r.key === k);
  const checks: [string, boolean][] = [
    ['authz route', by('GET /demo/:id')?.classification === 'authz'],
    ['authn-only (no decorator at all)', by('GET /demo')?.classification === 'authn-only'],
    ['authn-only + no-op note', by('POST /demo')?.note?.includes('no-op') === true],
    ['internal', by('DELETE /demo/:id')?.classification === 'internal'],
    ['new-expression self-enforcing guard → authz', by('PATCH /demo/iemis')?.classification === 'authz'],
    ['StaffReadGuard self-enforcing → authz', by('GET /demo/staff')?.classification === 'authz'],
    ['public', by('GET /public-thing/health')?.classification === 'public'],
    ['route count', routes.length === 7],
  ];
  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) ok = false;
  }
  return ok ? 0 : 1;
}

// ============================================================
// CLI
// ============================================================

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();

  const routes = analyzeAll();

  if (argv.includes('--list-review')) {
    for (const r of routes.filter((x) => x.classification === 'authn-only' || x.classification === 'public')) {
      console.log(r.key);
    }
    return 0;
  }

  if (argv.includes('--seed-baseline')) return seedBaseline(routes);

  const allowlist = loadAllowlist();

  const reportIdx = argv.indexOf('--report');
  if (reportIdx !== -1 && argv[reportIdx + 1]) {
    const outPath = path.resolve(REPO_ROOT, argv[reportIdx + 1]);
    fs.writeFileSync(outPath, buildReport(routes));
    console.log(`Wrote coverage map → ${path.relative(REPO_ROOT, outPath)}`);
  }

  const review = routes.filter((r) => r.classification === 'authn-only' || r.classification === 'public');
  const unallowlisted = review.filter((r) => !allowlist.has(r.key));

  const counts = routes.reduce<Record<string, number>>((acc, r) => {
    acc[r.classification] = (acc[r.classification] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `\nauthz-coverage: ${routes.length} routes — authz ${counts.authz ?? 0}, internal ${counts.internal ?? 0}, ` +
      `authn-only ${counts['authn-only'] ?? 0}, public ${counts.public ?? 0}`,
  );

  if (unallowlisted.length === 0) {
    console.log(`✓ Every authn-only/public route is allowlisted (${allowlist.size} entries).`);
    return 0;
  }

  console.error(`\n✗ ${unallowlisted.length} route(s) lack resource authorization and are NOT allowlisted:\n`);
  for (const r of unallowlisted) {
    console.error(`  [${r.classification}] ${r.key}   (${r.controller}; guards: ${r.guards.join(', ') || 'none'})${r.note ? ` — ${r.note}` : ''}`);
  }
  console.error(
    `\nResolve each: add resource authorization (@RequirePermission / @RequireGlobalRole), or — if intentionally\n` +
      `open — add the route key to scripts/audit/authz-allowlist.txt with a one-line justification.`,
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
