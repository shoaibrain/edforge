#!/usr/bin/env node
import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import { TenantTemplateStack } from '../lib/tenant-template/tenant-template-stack';
import { DestroyPolicySetter } from '../lib/utilities/destroy-policy-setter';
import { CoreAppPlaneStack } from '../lib/bootstrap-template/core-appplane-stack';
import { getEnv } from '../lib/utilities/helper-functions';
import { ControlPlaneStack } from '../lib/bootstrap-template/control-plane-stack';
import { SharedInfraStack } from '../lib/shared-infra/shared-infra-stack';
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
const AzCount = 3;
const basicName = 'basic';
if(AzCount < 2 || AzCount > 3) {
  throw new Error('Availability Zones count must be between 2 and 3 (inclusive). Current value: ' + AzCount);
}
// required input parameters
const systemAdminEmail = process.env.CDK_PARAM_SYSTEM_ADMIN_EMAIL;
const tenantId = process.env.CDK_PARAM_TENANT_ID || basicId;
const tenantName = process.env.CDK_PARAM_TENANT_NAME || basicName;
const useFederation = process.env.CDK_PARAM_USE_FEDERATION || 'true';

const commitId = getEnv('CDK_PARAM_COMMIT_ID');
const tier = getEnv('CDK_PARAM_TIER');

// Determine useEc2 based on tier using environment variables directly
const useEc2 = tier === 'PREMIUM' ? process.env.CDK_PARAM_USE_EC2_PREMIUM === 'true' :
              tier === 'ADVANCED' ? process.env.CDK_PARAM_USE_EC2_ADVANCED === 'true' :
              process.env.CDK_PARAM_USE_EC2_BASIC === 'true';
const useRProxy = process.env.CDK_PARAM_USE_RPROXY !== 'false';

// default values for optional input parameters
const defaultStageName = 'prod';

// optional input parameters
const stageName = process.env.CDK_PARAM_STAGE || defaultStageName;

//A flag to check whether the Advanced cluster is exist.
//If not exist, value is INACTIVE.
const advancedCluster = process.env.CDK_ADV_CLUSTER || 'INACTIVE';

const env = {
  account: app.account,
  region: app.region
};

const clientAppUrl = process.env.CDK_PARAM_NEXTJS_APP_URL || 'https://edforge.app';

const sharedInfraStack = new SharedInfraStack(app, 'shared-infra-stack', {
  stageName: stageName,
  azCount: AzCount,
  env
});

const controlPlaneStack = new ControlPlaneStack(app, 'controlplane-stack', {
  systemAdminEmail: systemAdminEmail,
  accessLogsBucket: sharedInfraStack.accessLogsBucket,
  distro: sharedInfraStack.adminSiteDistro,
  adminSiteUrl: sharedInfraStack.adminSiteUrl,
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
  env
});
cdk.Aspects.of(coreAppPlaneStack).add(new DestroyPolicySetter());

const tenantTemplateStack = new TenantTemplateStack(app, `tenant-template-stack-${tenantId}`, {
  tenantId: tenantId,
  tenantName: tenantName,
  stageName: stageName,
  tenantMappingTable: sharedInfraStack.tenantMappingTable,
  commitId: commitId,
  tier: tier,
  advancedCluster: advancedCluster,
  clientAppUrl: clientAppUrl,
  eventBusName: controlPlaneStack.eventBusName, // SBT Event Bus for microservices
  useFederation: useFederation,
  useEc2: useEc2,
  useRProxy: useRProxy,
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
 */
const advancedTierTempStack = new TenantTemplateStack(app, `tenant-template-stack-advanced`, {
  tenantId: 'advanced',
  tenantName: tenantName,
  stageName: stageName,
  tenantMappingTable: sharedInfraStack.tenantMappingTable,
  commitId: commitId,
  tier: 'advanced',
  advancedCluster: 'INACTIVE',
  clientAppUrl: clientAppUrl,
  eventBusName: controlPlaneStack.eventBusName, // SBT Event Bus for microservices
  useFederation: useFederation,
  useEc2: process.env.CDK_PARAM_USE_EC2_ADVANCED === 'true',
  useRProxy: false,
  env
});
tenantTemplateStack.addDependency(sharedInfraStack);
advancedTierTempStack.addDependency(sharedInfraStack);

cdk.Tags.of(tenantTemplateStack).add('TenantId', tenantId);
cdk.Tags.of(tenantTemplateStack).add('TenantName', tenantName);

cdk.Aspects.of(tenantTemplateStack).add(new DestroyPolicySetter());
