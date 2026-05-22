/**
 * TenantMetadataReader — academics-local DDB GetItem helper.
 *
 * Sprint D.1.3 (2026-05-22) — lazy-seed of GradingPolicy needs the tenant's
 * `archetype` field to pick the corresponding ArchetypeDefaults profile.
 * The data lives at `TENANT#<id>` `METADATA` in the identity DDB table.
 *
 * Why inline (rather than depend on `@edforge/tenant-settings-resolver`):
 *   That workspace package is `"private": true` — not on npm registry —
 *   and the academics Dockerfile copies only `server/application/package.json`
 *   then runs `npm install`, which CANNOT resolve workspace-only packages.
 *   Same publish-gate constraint that applies to AdminWeb per CLAUDE.md
 *   "AdminWeb publish-gate gotcha". Inlining a ~30 LOC reader is the
 *   pragmatic V1 fix; a future cleanup may publish the resolver and
 *   collapse this duplication.
 *
 * IAM grant: the academics task role must have `dynamodb:GetItem` on
 * `edforge-identity-basic` keyed by partition `tenantId` + sort
 * `entityKey='METADATA'`. The existing cross-table read pattern for
 * workspace settings already exercises this grant.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  DynamoDBClient,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';

export interface TenantMetadata {
  tenantId: string;
  archetype?: 'PABSON' | 'GENERIC' | 'CBSE_IN' | 'NAIS_US' | 'GEMS_UAE';
  country?: string;
  tier?: string;
  status?: string;
  name?: string;
}

export class TenantMetadataNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`Tenant METADATA row not found for tenant=${tenantId}`);
    this.name = 'TenantMetadataNotFoundError';
  }
}

const TENANT_METADATA_SK = 'METADATA';

@Injectable()
export class TenantMetadataReaderService {
  private readonly logger = new Logger(TenantMetadataReaderService.name);
  private readonly ddb: DynamoDBClient;
  private readonly identityTable: string;

  constructor() {
    this.ddb = new DynamoDBClient({
      region: process.env.AWS_REGION,
      maxAttempts: 3,
    });
    this.identityTable =
      process.env.IDENTITY_TABLE_NAME || 'edforge-identity-basic';
  }

  /**
   * Returns the tenant's METADATA row projected to the narrow shape
   * the lazy-seed path needs. Throws `TenantMetadataNotFoundError`
   * if the row is missing; callers should fall back to a sensible
   * archetype-agnostic default rather than 5xx the operator GET.
   */
  async getTenantMetadata(tenantId: string): Promise<TenantMetadata> {
    const response = await this.ddb.send(
      new GetItemCommand({
        TableName: this.identityTable,
        Key: {
          tenantId: { S: tenantId },
          entityKey: { S: TENANT_METADATA_SK },
        },
        ConsistentRead: false,
      }),
    );
    if (!response.Item) {
      throw new TenantMetadataNotFoundError(tenantId);
    }
    const it = response.Item;
    return {
      tenantId,
      archetype: it.archetype?.S as TenantMetadata['archetype'],
      country: it.country?.S,
      tier: it.tier?.S,
      status: it.status?.S,
      name: it.name?.S,
    };
  }
}
