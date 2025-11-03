import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { ContainerDefinitionConfig } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { IdentityDetails } from '../interfaces/identity-details';

export function getServiceName(cfnService: cdk.aws_ecs.CfnService, tenantName: string, name: string  ): void {
  const alphaNumericName = `${tenantName}`.replace(/[^a-zA-Z0-9]/g, '');  // tenantName
  cfnService.serviceName = `${name}${alphaNumericName}`;
  cfnService.overrideLogicalId(cfnService.serviceName);
  cfnService.enableExecuteCommand = true;
}

export function createTaskDefinition (
  scope: Construct,
  isEc2Tier: boolean,
  taskExecutionRole: iam.Role,
  taskRole: iam.IRole| undefined,
  containerDef: ecs.ContainerDefinitionOptions,
): ecs.TaskDefinition {
  const familyName = `${containerDef.containerName}-TaskDef`
  const baseProps = {
    executionRole: taskExecutionRole,
    taskRole: taskRole,
    family: familyName
  };
  
  if (isEc2Tier) {
    return new ecs.Ec2TaskDefinition(scope, familyName, {
      ...baseProps,
      networkMode: ecs.NetworkMode.AWS_VPC
    });
  } else {
    // DEVELOPMENT COST OPTIMIZATION: Minimal Fargate Resource Allocation
    //
    // WHY: Fargate pricing is based on CPU and memory allocated (not actual usage)
    // Current defaults: 256 CPU units (0.25 vCPU), 512 MB RAM
    // These are the minimum viable settings for development workloads
    //
    // COST BREAKDOWN:
    // - 256 CPU (0.25 vCPU) + 512 MB: ~$0.020/hour = ~$14.40/month (24/7)
    // - For comparison: 1024 CPU (1 vCPU) + 2048 MB: ~$0.08/hour = ~$58/month
    //
    // WHEN TO INCREASE:
    // - If containers frequently OOM (out of memory)
    // - If CPU throttling occurs (check CloudWatch metrics)
    // - When moving to staging/production
    //
    // PRODUCTION MIGRATION:
    // - CPU: 512-1024 (0.5-1 vCPU) depending on workload
    // - Memory: 1024-2048 MB depending on application needs
    // - Use CloudWatch metrics to right-size based on actual utilization
    return new ecs.FargateTaskDefinition(scope, familyName, {
      ...baseProps,
      cpu: containerDef.cpu || 256, // Development: Minimum (0.25 vCPU) - Production: 512-1024
      memoryLimitMiB: containerDef.memoryLimitMiB || 512, // Development: Minimum - Production: 1024-2048
    });
  }
};

// Mapping function definition
export function getContainerDefinitionOptions(
  stack: cdk.Stack,
  jsonConfig: any,
  idpDetails: IdentityDetails
): ecs.ContainerDefinitionOptions {
  // Set default environment values (region and account)
  const defaultEnvironmentVariables = {
    AWS_REGION: cdk.Stack.of(stack).region,
    AWS_ACCOUNT_ID: cdk.Stack.of(stack).account,
    COGNITO_USER_POOL_ID: idpDetails.details.userPoolId,
    COGNITO_CLIENT_ID: idpDetails.details.appClientId,
    COGNITO_REGION: cdk.Stack.of(stack).region,
  };

  // Dynamically add environment values
  const environmentVariables = {
    ...defaultEnvironmentVariables, // Apply default values first
    ...(jsonConfig.environment || {}), // Apply additional values from JSON
  };

  const appProtocolMap: { [key: string]: ecs.AppProtocol } = {
    'ecs.AppProtocol.http': ecs.AppProtocol.http,
    'ecs.AppProtocol.http2': ecs.AppProtocol.http2,
    'ecs.AppProtocol.grpc': ecs.AppProtocol.grpc,
  };

  const protocolMap: { [key: string]: ecs.Protocol } = {
    'ecs.Protocol.TCP': ecs.Protocol.TCP,
    'ecs.Protocol.UDP': ecs.Protocol.UDP,
  };

  // Create ContainerDefinitionOptions
  const containerOptions: ecs.ContainerDefinitionOptions = {
    containerName: jsonConfig.name,
    image: ecs.ContainerImage.fromRegistry(jsonConfig.image),
    cpu: jsonConfig.cpu,
    memoryLimitMiB: jsonConfig.memoryLimitMiB,
    // portMappings: jsonConfig.portMappings?.map((port: any) => ({
    //   name: port.name,
    //   containerPort: port.containerPort,
    //   appProtocol: ecs.AppProtocol.http, 
    //   protocol: port.protocol //ecs.Protocol.TCP, // Default TCP
    // })),
    portMappings: jsonConfig.portMappings?.map((port: any) => ({
      name: port.name,
      containerPort: port.containerPort,
      appProtocol: appProtocolMap[port.appProtocol], // Map ecs.AppProtocol value or default to HTTP
      protocol:  protocolMap[port.protocol] //|| ecs.Protocol.TCP,
    })),
    environment: environmentVariables, // 
    healthCheck: jsonConfig.healthCheck ? {
      command: jsonConfig.healthCheck.command,
      interval: cdk.Duration.seconds(jsonConfig.healthCheck.interval),
      timeout: cdk.Duration.seconds(jsonConfig.healthCheck.timeout),
      retries: jsonConfig.healthCheck.retries,
      startPeriod: cdk.Duration.seconds(jsonConfig.healthCheck.startPeriod)
    } : undefined,
   
    // DEVELOPMENT COST OPTIMIZATION: CloudWatch Log Retention
    //
    // WHY: CloudWatch log storage costs ~$0.50/GB/month and accumulates over time
    // Default: Infinite retention → Costs increase continuously
    // Target: 7 days retention for development → Saves ~$5-10/month per service
    //
    // COST IMPACT:
    // - Infinite retention: Logs accumulate, costs grow over time
    // - 7 days retention: Automatic cleanup, predictable costs
    // - For a typical microservice: ~100MB logs/month → ~$0.05/month with retention
    //
    // PRODUCTION MIGRATION:
    // - Retention: 30 days (or longer based on compliance requirements)
    // - Consider log export to S3 for long-term archival (cheaper)
    // - Enable log encryption for sensitive data
    // - Set up log metric filters for alerting on errors
    logging: ecs.LogDriver.awsLogs({ 
      streamPrefix: 'ecs-container-logs',
      logRetention: logs.RetentionDays.ONE_WEEK // Development: 7 days (Production: 30+ days)
    })
  };

  return containerOptions;
}