/**
 * S1.T6 — path router. Maps (method, path) to handler name + params.
 */

export interface RouteMatch {
  handler:
    | 'tenantSeries'
    | 'adoptionReport'
    | 'fleet'
    | 'sessionHistory'
    | 'exportCsvUrl';
  params: Record<string, string>;
}

const ROUTES: Array<{
  method: string;
  pattern: RegExp;
  handler: RouteMatch['handler'];
  paramNames: string[];
}> = [
  {
    method: 'GET',
    pattern: /^\/analytics\/tenants\/([^/]+)\/adoption-report$/,
    handler: 'adoptionReport',
    paramNames: ['tenantId'],
  },
  {
    method: 'GET',
    pattern: /^\/analytics\/tenants\/([^/]+)\/export-csv-url$/,
    handler: 'exportCsvUrl',
    paramNames: ['tenantId'],
  },
  {
    method: 'GET',
    pattern: /^\/analytics\/tenants\/([^/]+)$/,
    handler: 'tenantSeries',
    paramNames: ['tenantId'],
  },
  {
    method: 'GET',
    pattern: /^\/analytics\/fleet$/,
    handler: 'fleet',
    paramNames: [],
  },
  {
    method: 'GET',
    pattern: /^\/analytics\/me\/session-history$/,
    handler: 'sessionHistory',
    paramNames: [],
  },
];

export function route(method: string, path: string): RouteMatch | null {
  const m = method.toUpperCase();
  const p = path.replace(/\/$/, '') || '/';
  for (const r of ROUTES) {
    if (r.method !== m) continue;
    const match = p.match(r.pattern);
    if (!match) continue;
    const params: Record<string, string> = {};
    for (let i = 0; i < r.paramNames.length; i++) {
      params[r.paramNames[i]] = decodeURIComponent(match[i + 1]);
    }
    return { handler: r.handler, params };
  }
  return null;
}
