/**
 * DDB-direct resolver — used by in-VPC Lambdas (analytics aggregator, future
 * insights/digest Lambdas).
 *
 * Why DDB-direct vs HTTP:
 *   - Aggregator runs at high frequency (~10K events/day per healthy tenant)
 *   - HTTP to identity service adds 50-200ms p99 + a hard dependency on
 *     identity ECS uptime; DDB-direct is faster + decouples failure modes
 *   - IAM grant is narrow: dynamodb:GetItem on the identity table for
 *     SK pattern SETTINGS#WORKSPACE only
 *
 * Read shape: PK=TENANT#<id>, SK=SETTINGS#WORKSPACE.
 *
 * Caller responsibility (caller, NOT this package):
 *   - Add the IAM grant in CDK (the analytics-stack does this for the
 *     aggregator)
 *   - Pass the right table name (varies by tier in V1: edforge-identity-basic
 *     / -premium / -advanced; in V1 only -basic exists)
 */

import {
  DynamoDBClient,
  GetItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import {
  BaseTenantSettingsResolver,
  type BaseResolverOptions,
} from './resolver';
import {
  TenantSettingsBackendError,
  TenantSettingsNotFoundError,
  type TenantBrandingSettings,
  type TenantPolicySettings,
  type TenantWorkspaceSettings,
  type RegionalSettings,
} from './types';

export interface DdbResolverOptions extends BaseResolverOptions {
  /** Identity service DDB table name (e.g., 'edforge-identity-basic'). */
  tableName: string;
  /** Pre-constructed DDB client. If omitted, the resolver creates one. */
  ddbClient?: DynamoDBClient;
}

const SETTINGS_SK = 'SETTINGS#WORKSPACE';

export class DdbTenantSettingsResolver extends BaseTenantSettingsResolver {
  private readonly ddb: DynamoDBClient;
  private readonly tableName: string;

  constructor(opts: DdbResolverOptions) {
    super(opts);
    if (!opts.tableName) {
      throw new Error('DdbTenantSettingsResolver: tableName is required');
    }
    this.tableName = opts.tableName;
    this.ddb =
      opts.ddbClient ??
      new DynamoDBClient({
        region: process.env.AWS_REGION,
        maxAttempts: 3,
      });
  }

  protected async fetchUncached(tenantId: string): Promise<TenantWorkspaceSettings> {
    let response;
    try {
      response = await this.ddb.send(
        new GetItemCommand({
          TableName: this.tableName,
          Key: {
            tenantId: { S: tenantId },
            entityKey: { S: SETTINGS_SK },
          },
          ConsistentRead: false,
        }),
      );
    } catch (err) {
      throw new TenantSettingsBackendError(
        `DDB GetItem failed for tenant=${tenantId}: ${(err as Error).message}`,
        err,
      );
    }

    if (!response.Item) {
      throw new TenantSettingsNotFoundError(tenantId);
    }

    return marshalToWorkspaceSettings(tenantId, response.Item);
  }
}

/**
 * Convert a raw DDB Item (AttributeValue map) to a TenantWorkspaceSettings.
 *
 * Uses unmarshall-by-field rather than @aws-sdk/util-dynamodb to avoid
 * pulling in another runtime dep. The shape is small + stable.
 */
function marshalToWorkspaceSettings(
  tenantId: string,
  item: Record<string, AttributeValue>,
): TenantWorkspaceSettings {
  const regional = unmarshalMap(item.regional);
  const branding = unmarshalMap(item.branding);
  const policies = unmarshalMap(item.policies);

  if (!regional || !branding || !policies) {
    throw new TenantSettingsBackendError(
      `tenant=${tenantId}: workspace settings row is malformed (missing regional/branding/policies)`,
    );
  }

  return {
    tenantId,
    regional: regional as unknown as RegionalSettings,
    branding: branding as unknown as TenantBrandingSettings,
    policies: policies as unknown as TenantPolicySettings,
    isLocked: item.isLocked?.BOOL ?? false,
    lockReason: item.lockReason?.S,
    workspaceConfirmedAt: item.workspaceConfirmedAt?.S,
    onboardingCompletedAt: item.onboardingCompletedAt?.S,
  };
}

/** Best-effort recursive AttributeValue → JS object converter for nested M shapes. */
function unmarshalMap(av?: AttributeValue): Record<string, unknown> | undefined {
  if (!av || !av.M) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(av.M)) {
    out[k] = unmarshalValue(v);
  }
  return out;
}

function unmarshalValue(av: AttributeValue): unknown {
  if (av.S !== undefined) return av.S;
  if (av.N !== undefined) return Number(av.N);
  if (av.BOOL !== undefined) return av.BOOL;
  if (av.NULL) return null;
  if (av.M) return unmarshalMap(av);
  if (av.L) return av.L.map(unmarshalValue);
  return undefined;
}
