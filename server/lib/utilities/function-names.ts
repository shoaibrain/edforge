/**
 * Deterministic Lambda function names (cost-redesign). API-B resolves its
 * stage variables to these names, so the constructs that create the
 * functions and the construct that names them in the API share this file.
 * A name here is set once at creation: renaming a function is a replacement.
 */
export const ANALYTICS_API_FUNCTION_NAME = 'edforge-analytics-api';

/** identity | academics | finance → edforge-<svc>-<tier>-api (LambdaService, C1.6). */
export function serviceFunctionName(serviceName: string, tier: string): string {
  return `edforge-${serviceName}-${tier.toLowerCase()}-api`;
}

/** The stage-variable → function-name map API-B carries for a tier. */
export function stageVariableFunctionNames(tier: string): Record<'identityFn' | 'academicsFn' | 'financeFn' | 'analyticsFn', string> {
  return {
    identityFn: serviceFunctionName('identity', tier),
    academicsFn: serviceFunctionName('academics', tier),
    financeFn: serviceFunctionName('finance', tier),
    analyticsFn: ANALYTICS_API_FUNCTION_NAME,
  };
}

/** CloudFormation export carrying API-B's REST API id (shared-infra → service stacks). */
export const API_B_REST_API_ID_EXPORT = 'TenantApiLambdaRestApiId';

/** CloudFormation export carrying API-B's base URL (no trailing slash): https://<id>.execute-api.<region>.amazonaws.com/<stage>. */
export const API_B_URL_EXPORT = 'TenantApiLambdaUrl';
