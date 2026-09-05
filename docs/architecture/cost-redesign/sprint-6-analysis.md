# Sprint 6 pre-implementation audit and decisions (2026-09-05)

State at the start: production runs on API-B; identity, academics, finance
and analytics are served by functions, bulk jobs by the SQS workers, the
finance timers by EventBridge Scheduler; all four ECS services are at
`desiredCount 0` (PR #451). The operator asked for the teardown to proceed
overnight with production interruption accepted for the day.

## What was read

- `tenant-template-stack.ts` (1,145 lines): the ECS-era constructs are the
  imported VPC (`EcsVpcId`, `AvailabilityZones`, `PrivateSubnetIds`), the
  `ecsSG` security group, the `EcsCluster` nested stack, the Cloud Map
  `HttpNamespace`, four `EcsService`s (each with an ALB target group and a
  listener rule on the imported `ListenerArn`, and the ALB security group
  imported as `AlbSgId`), the rproxy task role, and per service an ECS task
  role that `applyServicePrincipalGrants` also registers in the ABAC role's
  trust policy. The ABAC roles, tables, functions, queues, schedules,
  alarms, Cognito and the result-batch pipeline do not touch any of these.
  `taskRoles` is read only to grant `sqs:SendMessage` to the container
  roles.
- `services.ts`, `ecs-cluster.ts`, `ecs-utils.ts`: the service construct,
  the cluster nested stack, and helpers of which only
  `defaultServiceEnvironment` has a non-ECS caller.
- `cdknag/tenant-template-nag.ts`: takes `isEc2Tier`/`isRProxy` for EC2-tier
  suppressions under the cluster path.
- `shared-infra-stack.ts` (526 lines): VPC (`natGateways: 1`, two gateway
  endpoints, CIDR overrides), ALB + listener + target group, NLB + listener
  + ALB target, VPC link, the `ApiGateway` construct (API-A `SpecRestApi`,
  its access-log group, execution-log retention, the authorizer function,
  its role and the `AuthorizerAccessRole`), `UsagePlans` on API-A, and the
  exports `EcsVpcId`, `PrivSub*RouteId`, `PrivateSubnetIds`,
  `AvailabilityZones`, `ALBDnsName`, `ALBArn`, `AlbSgId`, `ListenerArn`,
  `ApiGatewayUrl`, `TenantApiRestApiId`, `TenantApiRootResourceId`,
  `TenantApiAuthorizerArn`. `ApiGatewayLambda` (API-B) takes `nlb` and
  `vpcLink` for stage variables no integration uses since C5.1.
- `analytics-stack.ts`: two ALB dashboard widgets on
  `albLoadBalancerFullName` (an implicit cross-stack export), and the API-A
  attach (`RestApi.fromRestApiAttributes` + `TokenAuthorizer` + five routes)
  that C2.7 was meant to delete and did not — CloudFormation still owns
  those API-A resources and the stack still imports `TenantApiRestApiId`,
  `TenantApiRootResourceId` and `TenantApiAuthorizerArn`.
- The live export → importer map (captured before Sprint 4): tenant-template
  imports `EcsVpcId`, `AlbSgId`, `ListenerArn`, `PrivateSubnetIds`,
  `TenantApiLambdaRestApiId`, `TenantApiLambdaUrl`; analytics imports
  `TenantApiAuthorizerArn`, `TenantApiRestApiId`, `TenantApiRootResourceId`,
  `TenantApiLambdaRestApiId` and the ALB full name; nothing imports
  `ALBDnsName`, `ALBArn`, `ApiGatewayUrl`, `AvailabilityZones`,
  `PrivSub*RouteId`.

## Decisions

| # | Decision | Why |
|---|---|---|
| D6.1 | **C6.4 and C6.6 are one change: the VPC goes with the NAT.** | CDK refuses `natGateways: 0` while `PRIVATE_WITH_EGRESS` subnets exist, and changing the subnet type replaces the subnets — a pointless replacement of a VPC nothing uses once C6.1 and C6.3 have deployed. Nothing outside shared-infra and the tenant stack references the VPC. The plan's "keep the VPC one sprint" buys nothing at $0 and costs a deploy. |
| D6.2 | **C6.2 removes analytics' API-A attach as well as the ALB widgets.** | It is the last importer of the three API-A exports; C6.3 cannot delete API-A while it exists. The routes it owns have been dead on API-A since 2026-07-09 (F2.2). |
| D6.3 | **The ABAC roles keep `ecs-tasks.amazonaws.com` as their base principal in C6.1.** | The only statements that matter are the function-role statements `applyServicePrincipalGrants` adds; removing the task roles removes their statements, and leaving the base principal keeps the trust-policy diff a pure deletion during a night-time teardown. A service principal cannot assume the role without a task definition that names it, and none exists. Cleanup under C8.5. |
| D6.4 | **Deploy order:** C6.1 tenant-template → C6.2 analytics → C6.3 shared-infra (API-A, LBs, VPC link, their exports) → C6.4/C6.6 shared-infra (VPC, NAT, endpoints, remaining exports) → C6.5 ECR. `list-imports` on every export a step removes must be empty immediately before that step. | The export choreography in the plan, with C6.2 moved ahead of C6.3 because of D6.2. |
| D6.5 | `service-info.txt` keeps its container blocks (they feed the functions' environment and policies); the `Rproxy` block and the Service Connect URLs become dead data until C8.5. | Scope: the teardown, not the manifest rewrite. `<NAMESPACE>` is still substituted with the tenant name so no placeholder leaks into an environment. |

## Verification per step

- After each deploy: the stack `UPDATE_COMPLETE`; zero DynamoDB, Cognito or
  S3 lines in the diff; an unauthenticated request through the production
  domain answered by API-B's authorizer; API-B 5xx and function errors
  unchanged; alarms unchanged.
- After C6.3: `apigateway get-rest-apis` lists API-B and the SBT control
  plane API only; `describe-load-balancers` empty; API-B's stage still has
  its authorizer function name variable.
- After C6.4/C6.6: `describe-nat-gateways` shows the gateway `deleted`,
  `describe-addresses` no allocated address, `describe-vpcs` only the
  default VPC, `list-exports` none of the removed names.
- After C6.5: `describe-repositories` without `rproxy`; lifecycle policies
  on the three service repositories.
