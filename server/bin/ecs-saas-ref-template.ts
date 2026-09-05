#!/usr/bin/env node
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { assertAlarmBudget } from '../lib/utilities/alarm-budget';

// Explicit env loader. Precedence: shell > .env.<profile> > .env.
// <profile> comes from EDFORGE_ENV (explicit) or AWS_PROFILE (implicit).
//
// Implementation: dotenv (without override) silently skips keys already set
// in process.env. Load .env.<profile> BEFORE .env so the profile-specific
// values "win" against the shared defaults, but shell vars set before
// ts-node starts always win against both files (standard unix behavior).
//
// Why: `import 'dotenv/config'` loaded `.env` unconditionally, which meant
// a local `cdk diff` without `source .env.<profile>` produced a prod-shaped
// config against whatever account the AWS profile pointed at. Using
// override: true on a per-profile file broke shell overrides like
// `CDK_NAG_ENABLED=false npx cdk deploy ...`. This ordering fixes both.
const envName = process.env.EDFORGE_ENV || process.env.AWS_PROFILE;
const serverDir = path.resolve(__dirname, '..');
if (envName) {
  dotenv.config({ path: path.join(serverDir, `.env.${envName}`) });
}
dotenv.config({ path: path.join(serverDir, '.env') });
console.log(`[cdk] env file: .env + .env.${envName ?? '(none)'}`);

import { TenantTemplateStack } from '../lib/tenant-template/tenant-template-stack';
import { DestroyPolicySetter } from '../lib/utilities/destroy-policy-setter';
import { CoreAppPlaneStack } from '../lib/bootstrap-template/core-appplane-stack';
import { getEnv } from '../lib/utilities/helper-functions';
import { isProdAccount } from '../lib/utilities/account-guards';
import { shouldSynthesizeAdvancedTemplate, shouldSynthesizeSbtScriptJobs } from '../lib/utilities/stack-gates';
import { ControlPlaneStack } from '../lib/bootstrap-template/control-plane-stack';
import { SharedInfraStack } from '../lib/shared-infra/shared-infra-stack';
import { AnalyticsStack } from '../lib/analytics/analytics-stack';
import { AwsSolutionsChecks } from 'cdk-nag';

const app = new cdk.App();

// Enable CDK Nag (controlled by environment variable)
if (process.env.CDK_NAG_ENABLED === 'true') {
  cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
}
console.log('CDK NAG: ', process.env.CDK_NAG_ENABLED || 'false');

// required input parameters
if (!process.env.CDK_PARAM_SYSTEM_ADMIN_EMAIL) {
  throw new Error('Please provide system admin email');
}

if (!process.env.CDK_PARAM_TENANT_ID) {
  console.log('Tenant ID is empty, a default tenant id "basic" will be assigned');
}
const basicId = 'basic';
const basicName = 'basic';
// required input parameters
const systemAdminEmail = process.env.CDK_PARAM_SYSTEM_ADMIN_EMAIL;
const tenantId = process.env.CDK_PARAM_TENANT_ID || basicId;
const tenantName = process.env.CDK_PARAM_TENANT_NAME || basicName;
const useFederation = process.env.CDK_PARAM_USE_FEDERATION || 'true';

const commitId = getEnv('CDK_PARAM_COMMIT_ID');
const tier = getEnv('CDK_PARAM_TIER');

// default values for optional input parameters
const defaultStageName = 'prod';

// optional input parameters
const stageName = process.env.CDK_PARAM_STAGE || defaultStageName;

//A flag to check whether the Advanced cluster is exist.
//If not exist, value is INACTIVE.
const advancedCluster = process.env.CDK_ADV_CLUSTER || 'INACTIVE';

// R41.A.hotfix — read account/region directly from CDK_DEFAULT_* env vars
// instead of `app.account` / `app.region` (which return undefined in this CDK
// version → Stack falls back to AWS::AccountId / AWS::Region pseudo-params →
// `Stack.of(this).region` returns a CDK token at synth time).
//
// R41.A's `api-gateway.ts` needs literal region/account at synth so the
// imported API GW Swagger's authorizer URI carries a valid ARN at import
// time (API GW rejects ${stageVariables.*} or token markers in the
// region/account portions of authorizerUri). Reading the env vars
// directly gives us literal strings; the api-gateway.ts guard throws if
// they're unset.
//
// The deploy wrapper (scripts/deploy.sh) exports these from the
// AWS profile. Local `cdk synth` runs need them in the shell.
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION
};

// Stack-level termination protection is enabled ONLY when synthesizing against
// the production account. UAT teardown (Sprint 3) MUST remain unblocked, so
// the gate is account-id based, not environment-name based. See
// utilities/account-guards.ts for the reasoning.
const stackTerminationProtection = isProdAccount();

// Previously CDK_PARAM_NEXTJS_APP_URL — renamed
// because the client app is a Vite MFE on Vercel, not NextJS.
const clientAppUrl = process.env.CDK_PARAM_CLIENT_APP_URL || 'https://edforge.app';

// CDK_PARAM_CORS_ALLOWED_ORIGINS: comma-separated list of allowed
// CORS origins per environment.
// Example shape (substitute your own deployment URLs):
//   'https://<your-tenant-frontend>,http://localhost:3000'
// This value is injected into the API Gateway OpenAPI spec at synth
// time via placeholder substitution in api-gateway.ts and is also
// passed to analytics-stack for the pdfAssetsBucket CORS rule.
//
// Hard requirement: the env var must be explicitly set (via .env.<profile>
// or the shell). A silent fallback to a prod-shaped default previously
// caused destructive diffs against UAT when the per-profile env file was
// not sourced. See /Users/shoaibrain/.claude/plans/twinkly-crafting-lake.md.
if (!process.env.CDK_PARAM_CORS_ALLOWED_ORIGINS) {
  throw new Error(
    'CDK_PARAM_CORS_ALLOWED_ORIGINS is required. ' +
    'Source .env.<profile> (e.g. `source .env.uat`) before running cdk, ' +
    'or set EDFORGE_ENV=<profile> when invoking.',
  );
}
const corsAllowedOrigins = process.env.CDK_PARAM_CORS_ALLOWED_ORIGINS;

// SES account-email inputs. The shared sending identity + custom MAIL FROM +
// config set are created ONLY when CDK_PARAM_SES_SENDING_DOMAIN is set — so
// until the operator opts in, shared-infra is unchanged. edforge.app DNS is
// hosted at Vercel (not Route53), so CDK emits the required DNS records as
// CfnOutputs for manual entry. *Sending* via SES is gated separately by
// CDK_PARAM_SES_ENABLED at the Cognito pools (added in a later sprint).
const sesSendingDomain = process.env.CDK_PARAM_SES_SENDING_DOMAIN;
const sesMailFromDomain = process.env.CDK_PARAM_SES_MAIL_FROM_DOMAIN || 'bounce.mail.edforge.app';
const sesDmarcReportEmail = process.env.CDK_PARAM_SES_DMARC_RUA || 'dmarc@edforge.app';
const sesConfigurationSetName = 'edforge-transactional';

// S2.1a — SES *sending* gate for the Cognito pools (separate from identity
// creation above). Default false → pools stay COGNITO_DEFAULT, zero behavior
// change. NEVER flip on before SES production access is granted. Threaded as
// plain strings (never the shared-infra construct) so the per-tenant standalone
// synth carries no SES Fn::ImportValue.
const sesEnabled = (process.env.CDK_PARAM_SES_ENABLED ?? 'false').toLowerCase() === 'true';
const sesFromEmail = process.env.CDK_PARAM_SES_FROM_EMAIL || 'no-reply@mail.edforge.app';
const sesFromName = process.env.CDK_PARAM_SES_FROM_NAME || 'EdForge';
const sesReplyTo = process.env.CDK_PARAM_SES_REPLY_TO || 'support@edforge.app';
const sesIdentityName = sesSendingDomain ?? 'mail.edforge.app';

// Same operatorAlertEmail feeds shared-infra (SES reputation alarms),
// analytics-stack AND core-appplane-stack so every operator topic gets an email
// subscription. Falls back to CDK_PARAM_SYSTEM_ADMIN_EMAIL for compatibility.
const operatorAlertEmail =
  process.env.CDK_PARAM_OPERATOR_ALERT_EMAIL || systemAdminEmail;

const sharedInfraStack = new SharedInfraStack(app, 'shared-infra-stack', {
  stageName: stageName,
  corsAllowedOrigins: corsAllowedOrigins,
  sesSendingDomain,
  sesMailFromDomain,
  sesDmarcReportEmail,
  sesConfigurationSetName,
  operatorAlertEmail,
  // S2.6 — the SES grant moved here from tenant-template-stack-basic so it
  // co-locates with the SES identity it permissions. Same flag (`sesEnabled`,
  // backed by CDK_PARAM_SES_ENABLED) controls both: the grant emission here +
  // the Cognito pool's EmailConfiguration flip in tenant-template below.
  enableCognitoBasicGrant: sesEnabled,
  terminationProtection: stackTerminationProtection,
  env
});

const controlPlaneStack = new ControlPlaneStack(app, 'controlplane-stack', {
  systemAdminEmail: systemAdminEmail,
  tenantApiUrl: sharedInfraStack.apiGatewayLambda.baseUrl,
  accessLogsBucket: sharedInfraStack.accessLogsBucket,
  distro: sharedInfraStack.adminSiteDistro,
  adminSiteUrl: sharedInfraStack.adminSiteUrl,
  corsAllowedOrigins: corsAllowedOrigins,
  terminationProtection: stackTerminationProtection,
  env
});

const coreAppPlaneStack = new CoreAppPlaneStack(app, 'core-appplane-stack', {
  regApiGatewayUrl: controlPlaneStack.regApiGatewayUrl,
  eventManager: controlPlaneStack.eventManager,
  eventBusName: controlPlaneStack.eventBusName, // SBT Event Bus for microservices
  auth: controlPlaneStack.auth,
  accessLogsBucket: sharedInfraStack.accessLogsBucket,
  clientAppUrl: clientAppUrl,
  tenantMappingTable: sharedInfraStack.tenantMappingTable,
  operatorAlertEmail,
  scriptJobsEnabled: shouldSynthesizeSbtScriptJobs(),
  terminationProtection: stackTerminationProtection,
  env
});
cdk.Aspects.of(coreAppPlaneStack).add(new DestroyPolicySetter());

// Layer 2: analytics stack. Created after controlplane (needs eventBusName)
// and declared as a dependency of core-appplane so the SBT bus rules are
// attached before services that emit to it come online.
const analyticsEnabled = process.env.CDK_PARAM_ANALYTICS_ENABLED || 'false';
const analyticsStack = new AnalyticsStack(app, 'analytics-stack', {
  eventBusName: controlPlaneStack.eventBusName,
  operatorAlertEmail,
  analyticsEnabled,
  // Phase 4 (Sprint I-2) — pilot observability inputs
  tenantSeederLambda: controlPlaneStack.tenantSeeder.lambda,
  tenantProvisionerLambda: controlPlaneStack.tenantLifecycle.provisioner,
  tenantDeprovisionerLambda: controlPlaneStack.tenantLifecycle.deprovisioner,
  // CORS origins for the pdfAssetsBucket — operator-supplied via
  // CDK_PARAM_CORS_ALLOWED_ORIGINS so EdForge ships no hardcoded
  // production URLs (S9 pre-flight invariant).
  corsAllowedOrigins,
  terminationProtection: stackTerminationProtection,
  env,
});
analyticsStack.addDependency(controlPlaneStack);
coreAppPlaneStack.addDependency(analyticsStack);

const tenantTemplateStack = new TenantTemplateStack(app, `tenant-template-stack-${tenantId}`, {
  tenantId: tenantId,
  tenantName: tenantName,
  stageName: stageName,
  tenantMappingTable: sharedInfraStack.tenantMappingTable,
  commitId: commitId,
  tier: tier,
  advancedCluster: advancedCluster,
  clientAppUrl: clientAppUrl,
  corsAllowedOrigins: corsAllowedOrigins,
  eventBusName: controlPlaneStack.eventBusName, // SBT Event Bus for microservices
  useFederation: useFederation,
  // Cost-redesign C1.6 — Lambda functions per service alongside ECS. Off by
  // default; scripts/deploy.sh builds the bundles when the flag is on.
  apiJobsTransport: process.env.CDK_PARAM_API_JOBS_TRANSPORT === 'sqs' ? 'sqs' : undefined,
  sesEnabled,
  sesFromEmail,
  sesFromName,
  sesReplyTo,
  sesIdentityName,
  sesConfigurationSetName,
  terminationProtection: stackTerminationProtection,
  env
});

/**
 * V1_DEFERRED: Advanced Tier Template Stack
 *
 * This stack creates the Advanced tier infrastructure template. It is part of the
 * original SBT-AWS ECS SaaS reference architecture multi-tier design.
 *
 * In V1 MVP, only the Basic tier (tenant-template-stack-basic) is actively used.
 * This Advanced template stack is synthesized by CDK but should NOT be deployed
 * independently — it serves as the template for per-tenant Advanced stacks
 * created by provision-tenant.sh during Advanced tier onboarding.
 *
 * Known issues to fix before enabling:
 * 1. CDK Nag suppressions reference legacy service names (orders, products, users)
 *    instead of EdForge services (identity, academics, finance)
 * 2. Advanced cluster reference assumes cluster already exists (ACTIVE mode)
 * 3. Table naming mismatch with TenantSeeder Lambda
 *
 * To re-enable Advanced tier:
 * 1. Fix CDK Nag in tenant-template-nag.ts for EdForge service names
 * 2. Fix TenantSeeder to resolve table names dynamically
 * 3. Test cdk deploy of a per-tenant Advanced stack end-to-end
 * 4. Remove tier guard in provision-tenant.sh
 *
 * Gated behind CDK_PARAM_ADVANCED_TEMPLATE_ENABLED=true (lib/utilities/stack-gates.ts).
 * Synthesized unconditionally, this template was deployed to production where
 * its INACTIVE cluster still ran a t3.micro auto-scaling group around the clock
 * (docs/architecture/cost-redesign/CURRENT_STATE.md §4.1). The deployed stack is
 * deleted by runbook; the code stays.
 */
if (shouldSynthesizeAdvancedTemplate()) {
  const advancedTierTempStack = new TenantTemplateStack(app, `tenant-template-stack-advanced`, {
    tenantId: 'advanced',
    tenantName: tenantName,
    stageName: stageName,
    tenantMappingTable: sharedInfraStack.tenantMappingTable,
    commitId: commitId,
    tier: 'advanced',
    advancedCluster: 'INACTIVE',
    clientAppUrl: clientAppUrl,
    corsAllowedOrigins: corsAllowedOrigins,
    eventBusName: controlPlaneStack.eventBusName, // SBT Event Bus for microservices
    useFederation: useFederation,
    env
  });
  advancedTierTempStack.addDependency(sharedInfraStack);
}
tenantTemplateStack.addDependency(sharedInfraStack);

cdk.Tags.of(tenantTemplateStack).add('TenantId', tenantId);
cdk.Tags.of(tenantTemplateStack).add('TenantName', tenantName);

// DestroyPolicySetter removed: tenant-template-stack contains DynamoDB
// tables with production school data. The per-resource removalPolicy
// (RETAIN on DynamoDB, DESTROY on ephemeral resources) is now the
// source of truth. Re-enabling this aspect would override RETAIN on tables.

// Cost-redesign C0.4 / C3.4 — at most 10 billable alarms across every stack, checked at synth.
assertAlarmBudget(app);
