/**
 * Layer 6.2 — tenant enumerator.
 *
 * Reads the active-tenant list from `edforge-identity-basic` by scanning
 * rows where `entityKey = 'METADATA'`. This is the same table the
 * TenantSeeder Lambda writes to on provision success, so it's authoritative.
 *
 * CRITICAL: we enumerate from this table, NOT from the analytics aggregates
 * table. A dormant tenant has no recent aggregate rows and would be missed
 * if we enumerated from there.
 *
 * The rollup Lambda and any other consumer should call `enumerateActiveTenants`
 * — it handles DynamoDB scan pagination internally.
 */

import {
  DynamoDBClient,
  ScanCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';

export interface ActiveTenant {
  tenantId: string;
  name: string;
  tier: string;
  status: string;
  provisionedAt: string; // createdAt
  contactEmail?: string;
  alertTopicArn?: string;
}

const DEFAULT_TABLE = 'edforge-identity-basic';

export async function enumerateActiveTenants(
  ddb: DynamoDBClient,
  opts: { tableName?: string; onlyActive?: boolean } = {},
): Promise<ActiveTenant[]> {
  const table = opts.tableName ?? DEFAULT_TABLE;
  const onlyActive = opts.onlyActive ?? true;

  const out: ActiveTenant[] = [];
  const seen = new Set<string>();
  let lastKey: Record<string, AttributeValue> | undefined;

  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: 'entityKey = :k',
        ExpressionAttributeValues: { ':k': { S: 'METADATA' } },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of r.Items || []) {
      const tenantId = item.tenantId?.S;
      if (!tenantId || seen.has(tenantId)) continue;
      seen.add(tenantId);

      const status = item.status?.S ?? 'active';
      if (onlyActive && status !== 'active') continue;

      out.push({
        tenantId,
        name: item.name?.S ?? tenantId,
        tier: item.tier?.S ?? 'BASIC',
        status,
        provisionedAt: item.createdAt?.S ?? '',
        contactEmail: item.contactEmail?.S,
        alertTopicArn: item.alertTopicArn?.S,
      });
    }
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);

  return out;
}
