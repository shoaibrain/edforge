import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import { type Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import { type ApiKeySSMParameterNames } from '../interfaces/api-key-ssm-parameter-names';
// import { TenantApiKey } from './tenant-api-key';
import { addTemplateTag } from '../utilities/helper-functions';
import { StaticSiteDistro } from './static-site-distro';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';

import { SharedInfraNag } from '../cdknag/shared-infra-nag';
import { ApiGateway } from './api-gateway';
import { UsagePlans } from './usage-plans';
import * as events from 'aws-cdk-lib/aws-events';
import { EventBridgeDlq } from './Resources/eventbridge-dlq';
import { EventBridgeArchive } from './Resources/eventbridge-archive';
import { EventBridgeRules } from './Resources/eventbridge-rules';
// import { EventMonitoring } from './Resources/event-monitoring';
import { ParentPortalLambdaStub } from './Resources/parent-portal-lambda-stub';
// import { KinesisFirehoseStub } from './Resources/kinesis-firehose-stub';
// import { FirehoseTransformerLambda } from './Resources/firehose-transformer-lambda';
import { S3DataLake } from './Resources/s3-data-lake';
// import { GlueTables } from './Resources/glue-tables';
// import { GlueEtlJobs } from './Resources/glue-etl-jobs';

export interface SharedInfraProps extends cdk.StackProps {
  stageName: string
  azCount: number
}

export class SharedInfraStack extends cdk.Stack {
  vpc: ec2.IVpc;
  alb: elbv2.ApplicationLoadBalancer;
  albSG: ec2.ISecurityGroup;
  listener: elbv2.ApplicationListener;
  nlbListener: elbv2.NetworkListener;
  apiGateway: ApiGateway;
  adminSiteUrl: string;
  // nextjsAppUrl: string; // Removed in revert
  adminSiteDistro: StaticSiteDistro;
  accessLogsBucket: cdk.aws_s3.Bucket;
  public readonly tenantMappingTable: Table;

  constructor (scope: Construct, id: string, props: SharedInfraProps) {
    super(scope, id);
    addTemplateTag(this, 'SharedInfraStack');
    
    // Define API Key SSM Parameter Names internally
    const apiKeySSMParameterNames = {
      basic: {
        keyId: 'apiKeyBasicTierKeyId',
        value: 'apiKeyBasicTierValue'
      },
      advanced: {
        keyId: 'apiKeyAdvancedTierKeyId',
        value: 'apiKeyAdvancedTierValue'
      },
      premium: {
        keyId: 'apiKeyPremiumTierKeyId',
        value: 'apiKeyPremiumTierValue'
      }
    };
    
    const azs = cdk.Fn.getAzs(this.region);

    const selectedAzs = Array(props.azCount).fill('').map(() => '');

    for (let i = 0; i < props.azCount; i++) {
      selectedAzs[i] = cdk.Fn.select(i, azs);
    }

    this.vpc = new ec2.Vpc(this, 'sbt-ecs-vpc', {
      // maxAzs: props.azCount,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      availabilityZones: selectedAzs,

      flowLogs: {
        'sbt-ecs-vpcFlowLog': {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(),
          trafficType: ec2.FlowLogTrafficType.ALL
        }
      }
    });
    cdk.Tags.of(this.vpc).add('sbt-ecs-vpc', 'true');

    this.vpc.privateSubnets.forEach((subnet, index) => {
      const cfnSubnet = subnet.node.defaultChild as ec2.CfnSubnet;
      cfnSubnet.addPropertyOverride('CidrBlock', `10.0.${index * 64}.0/18`);
    });
    this.vpc.publicSubnets.forEach((subnet, index) => {
      const cfnSubnet = subnet.node.defaultChild as ec2.CfnSubnet;
      cfnSubnet.addPropertyOverride('CidrBlock', `10.0.${192 + index}.0/24`);
    });

    new cdk.CfnOutput(this, 'PrivateSubnetIds', { value: this.vpc.privateSubnets.map(subnet => subnet.subnetId).join(','), exportName: 'PrivateSubnetIds' });
    new cdk.CfnOutput(this, 'AvailabilityZones', { value: selectedAzs.join(','), exportName:'AvailabilityZones' });

    // use a security group to provide a secure connection between the ALB and the containers
    this.albSG = new ec2.SecurityGroup(this, 'alb-sg', {
      vpc: this.vpc,
      allowAllOutbound: true
    });

    this.albSG.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(80),
      'Allow https traffic'
    );

    // ALB Creation
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'sbt-ecs-alb', {
      vpc: this.vpc,
      internetFacing: false,
      securityGroup: this.albSG,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });

    this.listener = this.alb.addListener('alb-listener', {
      open: true,
      port: 80
    });

    const nlb = new elbv2.NetworkLoadBalancer(this, 'sbt-ecs-nlb', {
      vpc: this.vpc,
      internetFacing: false,
      crossZoneEnabled: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });

    this.nlbListener = nlb.addListener('nlb-listener', {
      port: 80
    });

    const nlbTargetGroup = this.nlbListener.addTargets('nlb-targets', {
      targets: [new targets.AlbListenerTarget(this.listener)], 
      port: 80,
      healthCheck: {
        protocol: elbv2.Protocol.HTTP
      }
    });

    nlbTargetGroup.node.addDependency(this.listener);

    const targetGroupHttp = new elbv2.ApplicationTargetGroup(this, 'alb-tg', {
      port: 80,
      vpc: this.vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP
    });

    this.listener.addTargetGroups('alb-listener-tg', {
      targetGroups: [targetGroupHttp]
    });

    const lambdaEcsSaaSLayers = new PythonLayerVersion(this, 'LambdaEcsSaaSLayers', {
      entry: path.join(__dirname, './layers'),
      compatibleRuntimes: [Runtime.PYTHON_3_10]
    });

    // Generate API Keys automatically in CDK (Best Practice)
    
    const basicKey = new apigateway.ApiKey(this, 'BasicTierApiKey', {
      description: 'API Key for Basic Tier tenants'
    });

    const advanceKey = new apigateway.ApiKey(this, 'AdvancedTierApiKey', {
      description: 'API Key for Advanced Tier tenants'
    });

    const premiumKey = new apigateway.ApiKey(this, 'PremiumTierApiKey', {
      description: 'API Key for Premium Tier tenants'
    });

    // Store API Key values in SSM Parameter Store (Secure)
    new StringParameter(this, 'BasicApiKeyValue', {
      parameterName: apiKeySSMParameterNames.basic.value,
      stringValue: basicKey.keyId,
      description: 'Basic Tier API Key Value'
    });

    new StringParameter(this, 'AdvancedApiKeyValue', {
      parameterName: apiKeySSMParameterNames.advanced.value,
      stringValue: advanceKey.keyId,
      description: 'Advanced Tier API Key Value'
    });

    new StringParameter(this, 'PremiumApiKeyValue', {
      parameterName: apiKeySSMParameterNames.premium.value,
      stringValue: premiumKey.keyId,
      description: 'Premium Tier API Key Value'
    });

    new StringParameter(this, 'BasicApiKeyId', {
      parameterName: apiKeySSMParameterNames.basic.keyId,
      stringValue: basicKey.keyId,
      description: 'Basic Tier API Key ID'
    });

    new StringParameter(this, 'AdvancedApiKeyId', {
      parameterName: apiKeySSMParameterNames.advanced.keyId,
      stringValue: advanceKey.keyId,
      description: 'Advanced Tier API Key ID'
    });

    new StringParameter(this, 'PremiumApiKeyId', {
      parameterName: apiKeySSMParameterNames.premium.keyId,
      stringValue: premiumKey.keyId,
      description: 'Premium Tier API Key ID'
    });
    

    const vpcLink = new apigateway.VpcLink(this, 'ecs-vpc-link', {
      targets: [nlb]
    });

    
    this.apiGateway = new ApiGateway(this, 'ApiGateway', {
      lambdaEcsSaaSLayers: lambdaEcsSaaSLayers,
      stageName: props.stageName,
      nlb,
      vpcLink: vpcLink,
      apiKeyBasicTier: {
        apiKeyId: basicKey.keyId,
        value: basicKey.keyId
      },
      apiKeyAdvancedTier: {
        apiKeyId: advanceKey.keyId,
        value: advanceKey.keyId
      },
      apiKeyPremiumTier: {
        apiKeyId: premiumKey.keyId,
        value: premiumKey.keyId
      }
    });
    

    new cdk.CfnOutput(this, 'EcsVpcId', {
      value: this.vpc.vpcId,
      exportName: 'EcsVpcId'
    });

    this.vpc.privateSubnets.forEach((subnet, index) => {
      new cdk.CfnOutput(this, `PrivSub${index+1}RouteId`, {
        value: subnet.routeTable.routeTableId,
        exportName: `PrivSub${index+1}RouteId`,
        description: `Private Subnet ${index+1} Router ID`,
      });
    });
    
    //**Provider Admin Cloudfront */
    this.accessLogsBucket = new cdk.aws_s3.Bucket(this, 'AccessLogsBucket', {
      enforceSSL: true,
      autoDeleteObjects: true,
      accessControl: cdk.aws_s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    this.adminSiteDistro = new StaticSiteDistro(this, 'adminsite', {
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      accessLogsBucket: this.accessLogsBucket,
      env: {
        account: this.account,
        region: this.region
      }
    });
    this.adminSiteUrl = `https://${this.adminSiteDistro.cloudfrontDistribution.domainName}`;

    this.tenantMappingTable = new Table(this, 'TenantMappingTable', {
      partitionKey: { name: 'tenantId', type: AttributeType.STRING },
      pointInTimeRecoverySpecification: { 
        pointInTimeRecoveryEnabled: true 
      }
    });

    // Create Usage Plans for API rate limiting
    
    new UsagePlans(this, 'UsagePlans', {
      apiGateway: this.apiGateway.restApi,
      apiKeyBasicTier: basicKey,
      apiKeyAdvancedTier: advanceKey,
      apiKeyPremiumTier: premiumKey
    });
    

    // ============================================
    // EventBridge Infrastructure (Phase 0)
    // ============================================
    
    // Create dedicated EventBus for EdForge application events
    // const eventBus = new events.EventBus(this, 'EdForgeEventBus');

    // Create DLQ resources
    // const eventBridgeDlq = new EventBridgeDlq(this, 'EventBridgeDlq');

    // Create event archive bucket
    /*
    const eventArchive = new EventBridgeArchive(this, 'EventBridgeArchive', {
      eventBus: eventBus
    });
    */

    // Create S3 data lake for Analytics
    // const dataLake = new S3DataLake(this, 'S3DataLake');

    // Create stub Lambda function for Parent Portal (will be fully implemented in Phase 3)
    // const parentPortalLambda = new ParentPortalLambdaStub(this, 'ParentPortalLambdaStub');

    // Create Lambda transformer for Firehose (Phase 4: extracts service name for partitioning)
    // const firehoseTransformer = new FirehoseTransformerLambda(this, 'FirehoseTransformerLambda');

    // Create stub Firehose stream for Analytics (will be fully implemented in Phase 3)
    // Enhanced in Phase 4 with Lambda transformation for service partitioning
    /*
    const firehoseStream = new KinesisFirehoseStub(this, 'KinesisFirehoseStub', {
      dataLakeBucket: dataLake.dataLakeBucket,
      transformerLambda: firehoseTransformer.handler
    });
    */

    // Create EventBridge rules on the EdForge EventBus
    /*
    const eventBridgeRules = new EventBridgeRules(this, 'EventBridgeRules', {
      eventBus: eventBus,
      parentPortalHandler: parentPortalLambda.handler,
      // firehoseStream: firehoseStream.firehoseStream,
      parentPortalDlq: eventBridgeDlq.parentPortalDlq,
      analyticsDlq: eventBridgeDlq.analyticsDlq
    });
    */

    // Create CloudWatch monitoring and alarms
    /*
    new EventMonitoring(this, 'EventMonitoring', {
      parentPortalDlq: eventBridgeDlq.parentPortalDlq,
      analyticsDlq: eventBridgeDlq.analyticsDlq,
      parentPortalHandler: parentPortalLambda.handler,
      firehoseStream: firehoseStream.firehoseStream
    });
    */

    // ============================================
    // Phase 4: Analytics Glue Tables and Athena
    // ============================================
    
    // Create Glue database and tables for Analytics
    /*
    const glueTables = new GlueTables(this, 'GlueTables', {
      dataLakeBucket: dataLake.dataLakeBucket
    });

    // Create Glue ETL jobs for materialized views
    const glueEtlJobs = new GlueEtlJobs(this, 'GlueEtlJobs', {
      dataLakeBucket: dataLake.dataLakeBucket,
      glueDatabase: glueTables.database
    });
    */

    //**Output */
    new cdk.CfnOutput(this, 'ALBDnsName', {
      value: this.alb.loadBalancerDnsName,
      exportName: 'ALBDnsName'
    });
    new cdk.CfnOutput(this, 'ALBArn', {
      value: this.alb.loadBalancerArn,
      exportName: 'ALBArn'
    });

    new cdk.CfnOutput(this, 'AlbSgId', {
      value: this.albSG.securityGroupId,
      exportName: 'AlbSgId'
    });

    new cdk.CfnOutput(this, 'ListenerArn', {
      value: this.listener.listenerArn,
      exportName: 'ListenerArn'
    });

    // Export API Gateway and site URLs for NextJS applications
    
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {  
      value: this.apiGateway.restApi.url,
      description: 'Tenant API Gateway URL (REST API) for SaaS application',
      exportName: 'ApiGatewayUrl'  // New export name for cross-stack references
    });
    

    new cdk.CfnOutput(this, 'adminSiteUrl', {
      value: this.adminSiteUrl,
      description: 'CloudFront URL for Admin Web (used by Control Plane)'
    });

    // Export Event Bus ARN for microservices
    /*
    new cdk.CfnOutput(this, 'EventBusArn', {
      value: eventBus.eventBusArn,
      description: 'EdForge Event Bus ARN',
      exportName: 'EdForgeEventBusArn'
    });
    */

    // Export Data Lake Bucket Name
    /*
    new cdk.CfnOutput(this, 'DataLakeBucketName', {
      value: dataLake.dataLakeBucket.bucketName,
      description: 'S3 Data Lake Bucket Name',
      exportName: 'DataLakeBucketName'
    });
    */
    
    // Export Analytics infrastructure details
    /*
    new cdk.CfnOutput(this, 'GlueDatabaseName', {
      value: glueTables.database.ref,
      description: 'Glue database name for Analytics',
      exportName: 'GlueDatabaseName'
    });

    new cdk.CfnOutput(this, 'AthenaWorkgroupName', {
      value: glueTables.workgroup.name || 'edforge-analytics-workgroup',
      description: 'Athena workgroup name for Analytics queries',
      exportName: 'AthenaWorkgroupName'
    });

    new cdk.CfnOutput(this, 'AthenaResultsBucket', {
      value: glueTables.resultsBucket.bucketName,
      description: 'S3 bucket for Athena query results',
      exportName: 'AthenaResultsBucket'
    });
    */

    // CDK Nag check (controlled by environment variable)
    if (process.env.CDK_NAG_ENABLED === 'true') {
      new SharedInfraNag(this, 'SharedInfraNag', { stageName: props.stageName });
    }
  }

  ssmLookup (parameterName: string) {
    return StringParameter.valueForStringParameter(this, parameterName);
  }
}
