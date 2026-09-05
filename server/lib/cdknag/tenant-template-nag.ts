import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

/**
 * CDK Nag Suppressions for EdForge ECS Services
 *
 * IMPORTANT: This file was originally forked from the AWS SBT-AWS ECS SaaS
 * Reference Architecture which had 'orders', 'products', and 'users' services.
 * EdForge uses 'identity', 'academics', and 'finance' services.
 *
 * V1_DEFERRED: Finance service is deployed but functionally dormant in V1.
 * All three services need Nag suppressions to pass CDK synthesis.
 */
export interface TenantInfraNagProps {
  tenantId: string;
  tier: string;
  advancedCluster: string;
}

export class TenantTemplateNag extends Construct {
  constructor(scope: Construct, id: string, props: TenantInfraNagProps) {
    super(scope, id);

    const nagEcsPath = `/tenant-template-stack-${props.tenantId}/EcsCluster`;
    const nagPath = `/tenant-template-stack-${props.tenantId}`;

    // Cognito suppressions
    this.addCognitoSuppressions(props, nagPath);

    // Lambda suppressions for custom resources
    this.addLambdaSuppressions(props, nagPath);

    // EC2 mode specific suppressions

    // Service suppressions - apply for all cases where services are deployed
    // This covers: basic tier, premium tier, and advanced tier (both INACTIVE and ACTIVE)
    this.addServiceSuppressions(props, nagPath);
  }

  private addCognitoSuppressions(props: TenantInfraNagProps, nagPath: string) {
    // Try multiple possible paths for Cognito UserPool
    const possiblePaths = [
      `${nagPath}/IdentityProvider/${props.tenantId}/Resource`,
      `${nagPath}/IdentityProvider/TenantUserPool/Resource`
    ];

    // Also try paths with overrideLogicalId (currently used paths)
    const overrideLogicalIdPaths = [
      `${nagPath}/IdentityProvider/${props.tier}UserPooL${props.tenantId}`,
      `${nagPath}/${props.tier}UserPooL${props.tenantId}`
    ];

    const allPaths = [...possiblePaths, ...overrideLogicalIdPaths];

    allPaths.forEach(path => {
      try {
        NagSuppressions.addResourceSuppressionsByPath(
          cdk.Stack.of(this),
          path,
          [
            {
              id: "AwsSolutions-COG1",
              reason:
                "SaaS reference architecture - Password policy is configured appropriately",
            },
            {
              id: "AwsSolutions-COG3",
              reason:
                "SaaS reference architecture - Advanced security features not required for demo",
            },
            {
              id: "AwsSolutions-COG2",
              reason:
                "SaaS reference architecture - MFA not required for demo purposes",
            },
          ]
        );
      } catch (error) {
        // Silently continue to next path
      }
    });
  }

  private addLambdaSuppressions(props: TenantInfraNagProps, nagPath: string) {
    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagPath}/AWS679f53fac002430cb0da5b7982bd2287/ServiceRole/Resource`],
        [
          {
            id: "AwsSolutions-IAM4",
            reason:
              "SaaS reference architecture - AWS managed policies acceptable for demo",
            appliesTo: [
              "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
            ],
          },
        ]
      );
    } catch (error) {
      console.log(
        "Lambda ServiceRole resource not found, skipping suppression"
      );
    }

    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagPath}/AWS679f53fac002430cb0da5b7982bd2287/Resource`],
        [
          {
            id: "AwsSolutions-L1",
            reason:
              "SaaS reference architecture - Lambda runtime acceptable for demo",
          },
        ]
      );
    } catch (error) {
      console.log("Lambda resource not found, skipping suppression");
    }
  }

  private addEc2Suppressions(props: TenantInfraNagProps, nagEcsPath: string) {
    // ENI Trunking suppressions
    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagEcsPath}/EniTrunking/CustomEniTrunkingRole/Resource`,
          `${nagEcsPath}/EniTrunking/EC2Role/Resource`,
        ],
        [
          {
            id: "AwsSolutions-IAM4",
            reason:
              "SaaS reference architecture - AWS managed policies acceptable for demo",
            appliesTo: [
              "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role",
            ],
          },
        ]
      );
    } catch (error) {
      console.log("ENI Trunking resources not found, skipping suppressions");
    }

    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagEcsPath}/EniTrunking/CustomEniTrunkingRole/Resource`],
        [
          {
            id: "AwsSolutions-IAM4",
            reason:
              "SaaS reference architecture - AWS managed policies acceptable for demo",
            appliesTo: [
              "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
            ],
          },
        ]
      );
    } catch (error) {
      console.log("CustomEniTrunkingRole resource not found, skipping suppression");
    }

    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagEcsPath}/EniTrunking/EC2Role/DefaultPolicy/Resource`],
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "SaaS reference architecture - Wildcard permissions acceptable for demo",
            appliesTo: ["Action::ecs:Submit*", "Resource::*"],
          },
        ]
      );
    } catch (error) {
      console.log("EC2Role DefaultPolicy resource not found, skipping suppression");
    }

    // Launch Template Role suppression
    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagEcsPath}/EcsCluster/launchTemplateRole/Resource`],
        [
          {
            id: "AwsSolutions-IAM4",
            reason:
              "SaaS reference architecture - AWS managed policies acceptable for demo",
            appliesTo: [
              "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role",
            ],
          },
        ]
      );
    } catch (error) {
      console.log("Launch Template Role resource not found, skipping suppression");
    }

    // Auto Scaling Group suppressions
    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/DrainECSHook/Function/ServiceRole/Resource`,
        ],
        [
          {
            id: "AwsSolutions-IAM4",
            reason:
              "SaaS reference architecture - AWS managed policies acceptable for demo",
            appliesTo: [
              "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
            ],
          },
        ]
      );
    } catch (error) {
      console.log("Auto Scaling Group DrainECSHook ServiceRole not found, skipping suppression");
    }

    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/DrainECSHook/Function/Resource`,
        ],
        [
          {
            id: "AwsSolutions-L1",
            reason:
              "SaaS reference architecture - Lambda runtime acceptable for demo",
          },
        ]
      );
    } catch (error) {
      console.log("Auto Scaling Group DrainECSHook Function not found, skipping suppression");
    }

    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/ASG`],
        [
          {
            id: "AwsSolutions-EC26",
            reason:
              "SaaS reference architecture - EBS encryption not required for demo",
          },
          {
            id: "AwsSolutions-AS3",
            reason:
              "SaaS reference architecture - Auto Scaling notifications not required for demo",
          },
        ]
      );
    } catch (error) {
      console.log("Auto Scaling Group ASG not found, skipping suppression");
    }

    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/DrainECSHook/Function/ServiceRole/DefaultPolicy/Resource`,
        ],
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "SaaS reference architecture - Wildcard permissions acceptable for demo",
            appliesTo: [
              {
                regex: "/^Resource::arn:(.*):autoscaling:(.*):(.*)*$/g",
              },
              "Resource::*",
            ],
          },
        ]
      );
    } catch (error) {
      console.log("Auto Scaling Group DefaultPolicy not found, skipping suppression");
    }

    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/LifecycleHookDrainHook/Topic/Resource`,
        ],
        [
          {
            id: "AwsSolutions-SNS2",
            reason:
              "SaaS reference architecture - SNS encryption not required for demo",
          },
          {
            id: "AwsSolutions-SNS3",
            reason: "SaaS reference architecture - SNS SSL not required for demo",
          },
        ]
      );
    } catch (error) {
      console.log("Auto Scaling Group SNS Topic not found, skipping suppression");
    }
  }

  private addServiceSuppressions(props: TenantInfraNagProps, nagPath: string) {
    // EdForge services: identity, academics, finance
    try {
      // ECS Task Execution Role suppressions
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagPath}/identity-EcsServices/ecsTaskExecutionRole-${props.tenantId}/Resource`,
          `${nagPath}/academics-EcsServices/ecsTaskExecutionRole-${props.tenantId}/Resource`,
          `${nagPath}/finance-EcsServices/ecsTaskExecutionRole-${props.tenantId}/Resource`,
        ],
        [
          {
            id: "AwsSolutions-IAM4",
            reason:
              "EdForge ECS services - AWS managed policies acceptable for task execution",
            appliesTo: [
              "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
            ],
          },
        ]
      );
    } catch (error) {
      console.log(
        "Some ECS Task Execution Role resources not found, skipping suppressions"
      );
    }

    try {
      // ECS Task Definition suppressions
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagPath}/identity-EcsServices/identity-TaskDef/Resource`,
          `${nagPath}/academics-EcsServices/academics-TaskDef/Resource`,
          `${nagPath}/finance-EcsServices/finance-TaskDef/Resource`,
        ],
        [
          {
            id: "AwsSolutions-ECS2",
            reason:
              "EdForge ECS services - Environment variables used for service configuration",
          },
        ]
      );
    } catch (error) {
      console.log(
        "Some ECS Task Definition resources not found, skipping suppressions"
      );
    }

    try {
      // ECS Task Role suppressions
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagPath}/identity-ecsTaskRole/Resource`,
          `${nagPath}/academics-ecsTaskRole/Resource`,
          `${nagPath}/finance-ecsTaskRole/Resource`,
        ],
        [
          {
            id: "AwsSolutions-IAM4",
            reason:
              "EdForge ECS services - AWS managed policies acceptable for ECS tasks",
            appliesTo: [
              "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role",
            ],
          },
        ]
      );
    } catch (error) {
      console.log(
        "Some ECS Task Role resources not found, skipping suppressions"
      );
    }

    try {
      // ECS Task Role Default Policy suppressions (for wildcard permissions)
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagPath}/identity-ecsTaskRole/DefaultPolicy/Resource`,
          `${nagPath}/academics-ecsTaskRole/DefaultPolicy/Resource`,
          `${nagPath}/finance-ecsTaskRole/DefaultPolicy/Resource`,
        ],
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "EdForge ECS services - Wildcard permissions for STS AssumeRole/TagSession (ABAC)",
            appliesTo: ["Resource::*"],
          },
        ]
      );
    } catch (error) {
      console.log(
        "Some ECS Task Role Default Policy resources not found, skipping suppressions"
      );
    }

    try {
      // Additional Policy suppressions (for DynamoDB access and Cognito)
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagPath}/identityAdditionalPolicy/Resource`,
          `${nagPath}/academicsAdditionalPolicy/Resource`,
          `${nagPath}/financeAdditionalPolicy/Resource`,
        ],
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "EdForge ECS services - Wildcard permissions for SSM and EventBridge",
            appliesTo: ["Resource::*"],
          },
        ]
      );
    } catch (error) {
      console.log("Additional Policy resources not found, skipping suppression");
    }

    try {
      // Task Definition suppressions (direct path)
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagPath}/identity-TaskDef/Resource`,
          `${nagPath}/academics-TaskDef/Resource`,
          `${nagPath}/finance-TaskDef/Resource`,
        ],
        [
          {
            id: "AwsSolutions-ECS2",
            reason:
              "EdForge ECS services - Environment variables used for service configuration",
          },
        ]
      );
    } catch (error) {
      console.log(
        "Some Task Definition resources not found, skipping suppressions"
      );
    }

  }
}
