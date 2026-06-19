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
import { addTemplateTag } from '../utilities/helper-functions';
import { isProdAccount } from '../utilities/account-guards';
import { StaticSiteDistro } from './static-site-distro';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';

import { SharedInfraNag } from '../cdknag/shared-infra-nag';
import { ApiGateway } from './api-gateway';
import { UsagePlans } from './usage-plans';
import { EmailIdentity } from './email-identity';
// TenantSeederLambda moved to ControlPlaneStack to avoid circular dependency

export interface SharedInfraProps extends cdk.StackProps {
  stageName: string
  azCount: number
  corsAllowedOrigins: string
  /**
   * SES account-email inputs. When `sesSendingDomain` is set, the shared SES
   * sending identity + custom MAIL FROM + configuration set are created and the
   * required DNS records are emitted as CfnOutputs (added manually in Vercel —
   * edforge.app DNS is hosted there, not Route53). Until then shared-infra
   * synthesizes identically (no SES resources). The pools only *use* the
   * identity once `CDK_PARAM_SES_ENABLED` flips on.
   */
  sesSendingDomain?: string
  sesMailFromDomain?: string
  sesDmarcReportEmail?: string
  sesConfigurationSetName?: string
  /** Operator mailbox subscribed to the SES reputation-alarm topic. */
  operatorAlertEmail?: string
  /**
   * S2.6 — Emit the SES identity policy that authorizes Cognito BASIC tenant
   * pools to send via the verified identity. Wired from `CDK_PARAM_SES_ENABLED`
   * in `bin/`. Defaulted false → no grant resources synthesize, byte-identical
   * to today's shared-infra-stack. See `EmailIdentityProps.enableCognitoBasicGrant`
   * for the full architectural rationale (race-avoidance via custom-Lambda CR
   * with retry on AccessDenied).
   */
  enableCognitoBasicGrant?: boolean
}

export class SharedInfraStack extends cdk.Stack {
  vpc: ec2.IVpc;
  alb: elbv2.ApplicationLoadBalancer;
  albSG: ec2.ISecurityGroup;
  listener: elbv2.ApplicationListener;
  nlbListener: elbv2.NetworkListener;
  apiGateway: ApiGateway;
  adminSiteUrl: string;
  adminSiteDistro: StaticSiteDistro;
  accessLogsBucket: cdk.aws_s3.Bucket;
  public readonly tenantMappingTable: Table;
  /** SES sending identity name + config-set name — passed to the Cognito pools as plain strings. */
  public readonly sesIdentityName?: string;
  public readonly sesConfigurationSetName?: string;

  constructor (scope: Construct, id: string, props: SharedInfraProps) {
    // Forward StackProps (env, terminationProtection, tags, etc.) to the
    // parent. Previously called as `super(scope, id)`, which silently
    // dropped every standard CDK Stack prop — including the new
    // terminationProtection flag wired in by Sprint 2 (T2.4). Other stacks
    // in this app (control-plane, analytics, core-appplane,
    // tenant-template) already do the right thing.
    super(scope, id, props);
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

      // Sprint 6 (T6.6): NAT Gateway count reduced from 3 (one per AZ — the
      // L2 default) to 1. At pilot scale with no third-party allowlists on
      // the egress IP, the cost saving (~$66/month) materially exceeds the
      // single-AZ-egress-failure risk. CFN picks which AZ keeps the NAT —
      // non-deterministic by design ("Option A" per Sprint 6 deploy
      // runbook). Re-evaluate at scale or before any third-party adds an
      // IP allowlist.
      natGateways: 1,

      // Sprint 5 (T5.1): VPC Flow Logs DISABLED for pilot.
      //
      // Flow logs at FlowLogTrafficType.ALL ingest every accept and reject
      // packet — cost was projected at $15-30/month (audit) but realized
      // CloudWatch Logs line in Cost Explorer is $0.27/month, with the
      // bulk landing under EC2-Other. At pilot traffic with no active
      // network-issue investigation, the data is unread.
      //
      // Re-enable on demand by re-introducing the flowLogs block (use
      // FlowLogTrafficType.REJECT for noise-bounded debugging, with
      // RetentionDays.ONE_WEEK on the destination log group).
    });
    cdk.Tags.of(this.vpc).add('sbt-ecs-vpc', 'true');

    // Sprint 5 (T5.4): Gateway VPC Endpoints for S3 and DynamoDB.
    //
    // Free at the endpoint layer; only data-transfer is charged. Removes
    // egress through NAT for S3/DDB API traffic, which directly addresses
    // the EC2-Other line item (51% of monthly cost). Also eliminates a
    // large fraction of the data-processing charge per NAT Gateway —
    // critical setup for the Sprint 6 NAT 3→1 reduction.
    //
    // Routes are added automatically to all private-subnet route tables
    // by the L2 GatewayVpcEndpoint construct.
    new ec2.GatewayVpcEndpoint(this, 'S3GatewayEndpoint', {
      vpc: this.vpc,
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });
    new ec2.GatewayVpcEndpoint(this, 'DynamoDbGatewayEndpoint', {
      vpc: this.vpc,
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

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
      corsAllowedOrigins: props.corsAllowedOrigins,
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

    // RETAIN: TenantMappingTable maps tenants to stacks.
    // Losing this table orphans all tenant infrastructure.
    //
    // deletionProtectionEnabled is a defense-in-depth layer: RemovalPolicy.RETAIN
    // protects the table from CFN-driven deletion, but a direct
    // `aws dynamodb delete-table` bypasses RETAIN. With deletion protection on,
    // the API call also fails. Gated on prod account so UAT teardown remains
    // unblocked.
    this.tenantMappingTable = new Table(this, 'TenantMappingTable', {
      partitionKey: { name: 'tenantId', type: AttributeType.STRING },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      deletionProtection: isProdAccount(),
    });

    // Create Usage Plans for API rate limiting
    
    new UsagePlans(this, 'UsagePlans', {
      apiGateway: this.apiGateway.restApi,
      apiKeyBasicTier: basicKey,
      apiKeyAdvancedTier: advanceKey,
      apiKeyPremiumTier: premiumKey
    });
    

    // ============================================
    // NOTE: TenantSeederLambda has been moved to ControlPlaneStack
    // to avoid circular dependency (SharedInfraStack <-> ControlPlaneStack)
    // ============================================

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

    // Export API Gateway and site URLs for client applications
    
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.apiGateway.restApi.url,
      description: 'Tenant API Gateway URL (REST API) for SaaS application',
      exportName: 'ApiGatewayUrl'  // New export name for cross-stack references
    });

    // Cross-stack handles for downstream stacks (e.g., analytics-stack) that
    // attach additional methods to this REST API via
    // `RestApi.fromRestApiAttributes(...)`. Exporting the API id and root
    // resource id keeps stacks decoupled and account-portable.
    new cdk.CfnOutput(this, 'TenantApiRestApiId', {
      value: this.apiGateway.restApi.restApiId,
      description: 'Tenant API Gateway REST API id (for downstream stacks attaching routes)',
      exportName: 'TenantApiRestApiId',
    });
    new cdk.CfnOutput(this, 'TenantApiRootResourceId', {
      value: this.apiGateway.restApi.restApiRootResourceId,
      description: 'Tenant API Gateway root resource id (/) — used by downstream stacks',
      exportName: 'TenantApiRootResourceId',
    });
    new cdk.CfnOutput(this, 'TenantApiAuthorizerArn', {
      value: this.apiGateway.authorizerFunction.functionArn,
      description: 'Shared tenant API Lambda authorizer ARN — reuse from downstream stacks',
      exportName: 'TenantApiAuthorizerArn',
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

    // SES sending identity for account email (Cognito invites). Created only
    // when the operator has set the sending domain, so until then shared-infra
    // is byte-identical (no SES resources, zero behavior change). DNS records
    // are emitted as CfnOutputs for manual entry in Vercel (edforge.app DNS is
    // hosted there). Sending is gated separately by CDK_PARAM_SES_ENABLED.
    if (props.sesSendingDomain) {
      const email = new EmailIdentity(this, 'EdforgeEmailIdentity', {
        sendingDomain: props.sesSendingDomain,
        mailFromDomain: props.sesMailFromDomain ?? 'bounce.mail.edforge.app',
        dmarcReportEmail: props.sesDmarcReportEmail ?? 'dmarc@edforge.app',
        configurationSetName: props.sesConfigurationSetName ?? 'edforge-transactional',
        operatorAlertEmail: props.operatorAlertEmail,
        enableCognitoBasicGrant: props.enableCognitoBasicGrant,
      });
      this.sesIdentityName = email.identityName;
      this.sesConfigurationSetName = email.configurationSetName;
      new cdk.CfnOutput(this, 'SesIdentityName', {
        value: email.identityName,
        description: 'SES sending identity (verified subdomain) for account email',
      });
      new cdk.CfnOutput(this, 'SesConfigurationSetName', {
        value: email.configurationSetName,
        description: 'SES configuration set for account email',
      });
    }

    // CDK Nag check (controlled by environment variable)
    if (process.env.CDK_NAG_ENABLED === 'true') {
      new SharedInfraNag(this, 'SharedInfraNag', { stageName: props.stageName });
    }
  }

  ssmLookup (parameterName: string) {
    return StringParameter.valueForStringParameter(this, parameterName);
  }
}
