import * as cdk from 'aws-cdk-lib';
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
import { ApiGatewayLambda } from './api-gateway-lambda';
import { stageVariableFunctionNames } from '../utilities/function-names';
import { EmailIdentity } from './email-identity';
// TenantSeederLambda moved to ControlPlaneStack to avoid circular dependency

export interface SharedInfraProps extends cdk.StackProps {
  stageName: string
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
  apiGateway: ApiGateway;
  /** API-B (cost-redesign C2.4): the strangler REST API on Lambda. */
  apiGatewayLambda: ApiGatewayLambda;
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
    

    const lambdaEcsSaaSLayers = new PythonLayerVersion(this, 'LambdaEcsSaaSLayers', {
      entry: path.join(__dirname, './layers'),
      compatibleRuntimes: [Runtime.PYTHON_3_12]
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
    


    
    this.apiGateway = new ApiGateway(this, 'ApiGateway', {
      lambdaEcsSaaSLayers: lambdaEcsSaaSLayers,
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
    

    // Cost-redesign C2.4 — API-B beside API-A. Additive: API-A's RestApi,
    // Stage and Deployment do not change; the authorizer function gains one
    // resource-policy statement. The pooled BASIC tier's functions are named
    // deterministically (utilities/function-names.ts), so the stage variables
    // are literals here and no cross-stack reference is needed.
    this.apiGatewayLambda = new ApiGatewayLambda(this, 'ApiGatewayLambda', {
      stageName: props.stageName,
      corsAllowedOrigins: props.corsAllowedOrigins,
      authorizerFunction: this.apiGateway.authorizerFunction,
      functionNames: stageVariableFunctionNames('basic'),
      apiKeyBasicTier: basicKey,
      apiKeyAdvancedTier: advanceKey,
      apiKeyPremiumTier: premiumKey,
    });
    new cdk.CfnOutput(this, 'TenantApiLambdaRestApiId', {
      value: this.apiGatewayLambda.restApi.restApiId,
      description: 'API-B (Lambda) REST API id - service stacks scope their invoke permissions to it',
      exportName: 'TenantApiLambdaRestApiId',
    });
    new cdk.CfnOutput(this, 'TenantApiLambdaUrl', {
      value: this.apiGatewayLambda.baseUrl,
      description: 'API-B (Lambda) base URL, no trailing slash - the strangler endpoint the frontend preview and service-to-service calls use',
      exportName: 'TenantApiLambdaUrl',
    });
    

    // ============================================
    // NOTE: TenantSeederLambda has been moved to ControlPlaneStack
    // to avoid circular dependency (SharedInfraStack <-> ControlPlaneStack)
    // ============================================

    //**Output */



    // Export API Gateway and site URLs for client applications
    

    // Cross-stack handles for downstream stacks (e.g., analytics-stack) that
    // attach additional methods to this REST API via
    // `RestApi.fromRestApiAttributes(...)`. Exporting the API id and root
    // resource id keeps stacks decoupled and account-portable.

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
