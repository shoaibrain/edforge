/**
 * Cost-redesign C7.2 — operator offboarding of a tenant through the SBT bus.
 *
 *   npx tsx scripts/tenant/offboard.ts --tenant <tenantId> [--confirm-production] [--execute]
 *
 * Puts `sbt_aws_offboardingRequest` on the SBT event bus the way SBT's
 * registration service does, with one extra field only this script sets:
 * `confirmProduction: true`. The deprovisioner function refuses a tenant with
 * no identity METADATA row, no tenantTag or the `production` tag unless that
 * field is present (default-deny, D7.4), so AdminWeb's delete works for
 * internal tenants and this script is the only way to remove a production or
 * legacy untagged one.
 *
 * Order for a production tenant: delete the registration in AdminWeb first
 * (SBT marks it inactive and deletes the tenant record; the deprovisioner
 * refuses and the data stays), then run this script with
 * --confirm-production. Dry-run by default; --execute sends the event.
 *
 * Needs events:PutEvents on the SBT bus, cloudformation:ListExports and
 * dynamodb:Scan on the SBT registration table — an operator profile, not the
 * deployer user.
 */
import { CloudFormationClient, ListExportsCommand } from '@aws-sdk/client-cloudformation';
import { DynamoDBClient, ListTablesCommand, ScanCommand, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

export const OFFBOARDING_DETAIL_TYPE = 'sbt_aws_offboardingRequest';
export const CONTROL_PLANE_SOURCE = 'sbt.control.plane';
export const BUS_NAME_EXPORT = 'SbtEventBusName';

export interface Args {
  tenantId: string;
  confirmProduction: boolean;
  execute: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { tenantId: '', confirmProduction: false, execute: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tenant' && argv[i + 1]) args.tenantId = argv[++i];
    else if (argv[i] === '--confirm-production') args.confirmProduction = true;
    else if (argv[i] === '--execute') args.execute = true;
    else if (argv[i] === '--dry-run') args.execute = false;
  }
  if (!args.tenantId) throw new Error('usage: offboard.ts --tenant <tenantId> [--confirm-production] [--execute]');
  return args;
}

/**
 * The detail SBT itself sends is the tenant record merged with the
 * registration item; the deprovisioner needs tenantRegistrationId, tenantId
 * and tier, and reads confirmProduction.
 */
export function buildOffboardingDetail(
  registration: Record<string, unknown>,
  tenantId: string,
  confirmProduction: boolean,
): Record<string, unknown> {
  const tenantRegistrationId = registration.tenantRegistrationId;
  if (typeof tenantRegistrationId !== 'string' || !tenantRegistrationId) {
    throw new Error(`registration for tenant ${tenantId} has no tenantRegistrationId`);
  }
  return {
    ...registration,
    tenantRegistrationId,
    tenantId,
    tier: typeof registration.tier === 'string' && registration.tier ? registration.tier : 'BASIC',
    ...(confirmProduction ? { confirmProduction: true } : {}),
  };
}

function unmarshal(item: Record<string, AttributeValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (v.S !== undefined) out[k] = v.S;
    else if (v.N !== undefined) out[k] = Number(v.N);
    else if (v.BOOL !== undefined) out[k] = v.BOOL;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const region = process.env.AWS_REGION ?? 'ap-south-1';
  const cfn = new CloudFormationClient({ region });
  const ddb = new DynamoDBClient({ region });
  const events = new EventBridgeClient({ region });

  const exports = await cfn.send(new ListExportsCommand({}));
  const busName = exports.Exports?.find((e) => e.Name === BUS_NAME_EXPORT)?.Value;
  if (!busName) throw new Error(`export ${BUS_NAME_EXPORT} not found`);

  const tables = await ddb.send(new ListTablesCommand({}));
  const registrationTable = tables.TableNames?.find((t) => t.includes('TenantRegistrationTable'));
  if (!registrationTable) throw new Error('SBT tenant registration table not found');

  const scan = await ddb.send(
    new ScanCommand({
      TableName: registrationTable,
      FilterExpression: 'tenantId = :t',
      ExpressionAttributeValues: { ':t': { S: args.tenantId } },
    }),
  );
  const registration = scan.Items?.[0];
  if (!registration) throw new Error(`no registration row has tenantId ${args.tenantId}`);

  const detail = buildOffboardingDetail(unmarshal(registration), args.tenantId, args.confirmProduction);
  const entry = { EventBusName: busName, Source: CONTROL_PLANE_SOURCE, DetailType: OFFBOARDING_DETAIL_TYPE, Detail: JSON.stringify(detail) };
  console.log(JSON.stringify({ mode: args.execute ? 'execute' : 'dry-run', entry }, null, 2));
  if (!args.execute) {
    console.log('dry run — add --execute to send the offboarding request');
    return;
  }
  const res = await events.send(new PutEventsCommand({ Entries: [entry] }));
  if ((res.FailedEntryCount ?? 0) > 0) throw new Error(`PutEvents failed: ${JSON.stringify(res.Entries)}`);
  console.log(`offboarding requested for ${args.tenantId} (event ${res.Entries?.[0]?.EventId}); watch edforge-tenant-deprovisioner and the provisioning-alerts topic`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
