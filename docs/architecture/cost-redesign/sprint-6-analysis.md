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

## As executed (2026-09-05, 03:29–03:58 UTC)

| Step | Deploy | Result |
|---|---|---|
| C6.1 tenant-template | 102 s | four services, task definitions and task roles, cluster nested stack, namespace, security group, rproxy role, target group and listener rule gone; three ABAC trust policies lose the task-role statements; eight container log groups retained (orphaned, 30-day retention); the IEMIS audit emit-failure filter and alarm re-created on the identity function's log group under a new name; alarms stay at ten. |
| C6.2 analytics | 25 s | ALB widgets and the API-A attach gone (eleven permissions, ten methods, eight resources, one authorizer on API-A); every API-A export left without an importer. |
| C6.3 + C6.4/C6.6 shared-infra | 149 s, one deploy | API-A with its deployment, stage, usage plans, log group and retention; both load balancers, listeners, target groups; the ALB security group; the VPC link; the VPC with six subnets, route tables, routes, the internet gateway, the NAT gateway and its Elastic IP, the two gateway endpoints and the default-SG restriction custom resource; sixteen outputs. API-B took over the account-level CloudWatch logging role. |
| C6.5 ECR | CLI | 30-day expiry lifecycle policy on identity, academics and finance. The rproxy repository deletion is denied to the deployer (`ecr:DeleteRepository` is not in its ECR policy); the operator runs it from CloudShell: `aws ecr delete-repository --region ap-south-1 --repository-name rproxy --force`. |

Account afterwards: one REST API (API-B), no load balancer, no VPC link,
NAT gateway `deleted`, no Elastic IP, only the default VPC, no ECS cluster;
API-B answering on all four prefixes with five stage variables, zero 5xx,
zero function errors, the finance schedules running through the window.

Two deviations from the plan, both recorded here rather than silently:

- **D6.6 — C6.3 and C6.4/C6.6 shipped as one shared-infra deploy.** The first
  C6.3 deploy failed at synth because the VPC removal was being edited in the
  same worktree while the deploy synthesized from it; nothing reached
  CloudFormation. Rather than juggle the tree back to the C6.3 commit, the
  two changes went out together once the VPC exports' pre-flight was also
  clean. Lesson, now in the operator memory: never edit source while
  `scripts/deploy.sh` is synthesizing from the worktree.
- The eight ECS-era log groups were orphaned (`RemovalPolicy.RETAIN`), not
  deleted. They cost cents at 30-day retention; C8.5 removes them.

Follow-ups for Sprint 8, in priority order:

1. **Make the functions the only path.** `CDK_PARAM_LAMBDA_SERVICES` still
   gates every function; a tenant-template deploy without the flag would now
   delete the production services. Remove the flag (C8.5) before any other
   deploy of that stack.
2. `service-info.txt` still carries the `Rproxy` block, the Service Connect
   URLs and the ECS resource sizes; `tenant-api-prod.json` remains the source
   spec for the generator and stays.
3. The `ApiGateway` construct name and file now describe a construct that
   holds only the authorizer; rename with the C8.5 sweep.
4. `edforge-analytics-functions-errors` has been in ALARM since Sprint 0 with
   no erroring function since; C8.1.
