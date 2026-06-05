import { Logger } from '@nestjs/common';
import { TenantMetadataReaderService } from './tenant-metadata-reader.service';

/**
 * Shared archetype resolution with the honest-degradation contract, so every
 * academics caller degrades identically and a future caller can't re-introduce
 * the 2026-06-04 GB2 silent-degradation drift (the WARN-swallow of an infra
 * error that masked a missing IAM grant as "this tenant has no archetype").
 *
 *   - missing METADATA row → `undefined` (getArchetype's expected absence) →
 *     quiet degrade;
 *   - infra/permission failure (getArchetype THROWS — AccessDenied, throttle,
 *     timeout) → logged at ERROR with the actionable IAM hint + the caller's
 *     `degradeNote`, then degraded (returns `undefined`) so the operator request
 *     still responds and the smoke / log alarms catch it.
 *
 * Takes the reader as a parameter (rather than owning a singleton) so each
 * caller keeps its own lazy-`new` factory — existing specs stub that factory.
 */
export async function resolveArchetypeOrDegrade(
  reader: Pick<TenantMetadataReaderService, 'getArchetype'>,
  tenantId: string,
  logger: Logger,
  degradeNote: string,
): Promise<string | undefined> {
  try {
    return await reader.getArchetype(tenantId);
  } catch (e: unknown) {
    logger.error(
      `resolveTenantArchetype: identity-table read FAILED for tenant=${tenantId} ` +
        `(check academics task role dynamodb:GetItem on edforge-identity-<tier>); ` +
        `${degradeNote}. err=${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
}
