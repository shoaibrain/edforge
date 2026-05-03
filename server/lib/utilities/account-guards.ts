// Account-id gate used to enable production-only protections at synth time.
//
// Returns true when synthesizing against the EdForge production account.
// CDK CLI sets CDK_DEFAULT_ACCOUNT from the resolved AWS profile, so this
// reads as a plain string at synth time — it is NOT a CDK Token.
//
// Why use this instead of EDFORGE_ENV: EDFORGE_ENV is a string the developer
// types and can fat-finger ("EDFORGE_ENV=prod" while AWS_PROFILE=uat would
// erroneously enable prod-only protections on UAT stacks). Account-id is
// resolved from the AWS credentials chain — fail-closed for any wrong shell
// state.
//
// Used by:
//   - bin/ecs-saas-ref-template.ts        terminationProtection
//   - shared-infra-stack.ts               TenantMappingTable deletionProtectionEnabled
//   - tenant-template/ecs-dynamodb.ts     per-tenant table deletionProtectionEnabled
//   - tenant-template/identity-provider.ts Cognito tenant pool deletionProtection
//   - analytics/analytics-stack.ts        analytics tables deletionProtectionEnabled
//   - bootstrap-template/control-plane-stack.ts custom-resource for system-admin pool

export const PROD_ACCOUNT_ID = '257526644020';

export const isProdAccount = (): boolean =>
  process.env.CDK_DEFAULT_ACCOUNT === PROD_ACCOUNT_ID;
