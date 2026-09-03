// Synth-time gates for stacks that exist in the CDK app but must not be
// deployed by default.
//
// The V1_DEFERRED Advanced-tier template (`tenant-template-stack-advanced`)
// is scaffolding for a future silo tier. Left in the app unconditionally it
// was deployed to production, where its `INACTIVE` cluster still carried a
// t3.micro auto-scaling group, a second tenant Cognito pool and two alarms
// (docs/architecture/cost-redesign/CURRENT_STATE.md §4.1). Gating the
// instantiation keeps the code and keeps `cdk deploy --all` / `cdk diff`
// from resurrecting the stack.

export const ADVANCED_TEMPLATE_FLAG = 'CDK_PARAM_ADVANCED_TEMPLATE_ENABLED';

export const shouldSynthesizeAdvancedTemplate = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => (env[ADVANCED_TEMPLATE_FLAG] ?? '').trim().toLowerCase() === 'true';
