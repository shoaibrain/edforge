/**
 * Cost-redesign C2.6 — service-to-service base URLs for a function outside
 * the VPC. The task definitions carry Cloud Map names
 * (http://identity-api.<ns>.sc:3010) that only resolve inside the VPC; a
 * Lambda must call the other services through API-B instead. Only the
 * variables the container already has are repointed, so a service that
 * never calls finance does not gain a FINANCE_SERVICE_URL.
 */
export const SERVICE_URL_KEYS = ['IDENTITY_SERVICE_URL', 'ACADEMICS_SERVICE_URL', 'FINANCE_SERVICE_URL'] as const;

export function withApiBServiceUrls(env: Record<string, string>, apiBBaseUrl: string): Record<string, string> {
  const out = { ...env };
  for (const key of SERVICE_URL_KEYS) if (key in out) out[key] = apiBBaseUrl;
  return out;
}
