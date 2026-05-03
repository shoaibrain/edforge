/**
 * S1.T7 — capture response shapes from the ECS-served analytics endpoints
 * BEFORE cutover. Sprint 2's parity script diffs the new Lambda responses
 * against these snapshots to prove contract fidelity.
 *
 * Usage:
 *   SNAPSHOT_JWT=<TenantAdmin JWT> \
 *   SNAPSHOT_TENANT_ID=264ff030-1cd8-4dc3-bdfe-f2728c3e40d0 \
 *   SNAPSHOT_BASE_URL=https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod \
 *     npx ts-node scripts/analytics/snapshot-ecs-endpoints.ts
 *
 * Writes 5 JSON files to server/lib/analytics/lambda/api/__fixtures__/.
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface Snapshot {
  endpoint: string;
  url: string;
  status: number;
  body: unknown;
  capturedAt: string;
}

async function hit(url: string, token: string): Promise<Omit<Snapshot, 'endpoint' | 'capturedAt'>> {
  const r = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
    timeout: 30_000,
  });
  return { url, status: r.status, body: r.data };
}

async function main() {
  const jwt = process.env.SNAPSHOT_JWT;
  const tenantId = process.env.SNAPSHOT_TENANT_ID;
  const baseUrl = (process.env.SNAPSHOT_BASE_URL || '').replace(/\/$/, '');
  if (!jwt || !tenantId || !baseUrl) {
    console.error('ERROR: SNAPSHOT_JWT, SNAPSHOT_TENANT_ID, SNAPSHOT_BASE_URL required');
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const weekKey = `${new Date().getUTCFullYear()}-W16`; // arbitrary but stable

  const outDir = path.resolve(
    __dirname,
    '../../server/lib/analytics/lambda/api/__fixtures__',
  );
  fs.mkdirSync(outDir, { recursive: true });

  const endpoints: Array<{ name: string; url: string }> = [
    { name: 'tenantSeries',    url: `${baseUrl}/analytics/tenants/${tenantId}?from=${monthAgo}&to=${today}&granularity=day` },
    { name: 'adoptionReport',  url: `${baseUrl}/analytics/tenants/${tenantId}/adoption-report?week=${weekKey}` },
    { name: 'fleet',           url: `${baseUrl}/analytics/fleet?from=${monthAgo}&to=${today}` },
    { name: 'sessionHistory',  url: `${baseUrl}/me/session-history?days=30` }, // old path; becomes /users/me/... in Lambda
    { name: 'exportCsv',       url: `${baseUrl}/analytics/tenants/${tenantId}/export.csv?from=${monthAgo}&to=${today}&granularity=day` },
  ];

  for (const e of endpoints) {
    console.log(`Capturing ${e.name} → ${e.url}`);
    const { url, status, body } = await hit(e.url, jwt);
    const snap: Snapshot = { endpoint: e.name, url, status, body, capturedAt: new Date().toISOString() };
    const outFile = path.join(outDir, `${e.name}.snapshot.json`);
    fs.writeFileSync(outFile, JSON.stringify(snap, null, 2));
    console.log(`  → status ${status}, saved ${outFile}`);
  }

  console.log(`\nSaved 5 snapshots to ${outDir}`);
}

main().catch((e) => {
  console.error('snapshot-ecs-endpoints failed:', e);
  process.exit(1);
});
