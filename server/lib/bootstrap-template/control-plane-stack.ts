import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { type Construct } from 'constructs';
import path = require('path');
import { StaticSite } from './static-site';
import { ControlPlaneNag } from '../cdknag/control-plane-nag';
import { addTemplateTag } from '../utilities/helper-functions';
import { isProdAccount } from '../utilities/account-guards';
import * as sbt from '@cdklabs/sbt-aws';
import { StaticSiteDistro } from '../shared-infra/static-site-distro';
import { EventDlqStack } from '../shared-infra/event-dlq-stack';
import { TenantSeederLambda } from './tenant-seeder-lambda';

interface ControlPlaneStackProps extends cdk.StackProps {
  systemAdminEmail: string
  accessLogsBucket: cdk.aws_s3.Bucket
  distro: StaticSiteDistro
  adminSiteUrl: string
  corsAllowedOrigins: string
}

export class ControlPlaneStack extends cdk.Stack {
  public readonly regApiGatewayUrl: string;
  public readonly eventManager: sbt.IEventManager;
  public readonly eventBusName: string;
  public readonly eventDlq: EventDlqStack;
  public readonly auth: sbt.CognitoAuth;
  public readonly adminSiteUrl: string;
  public readonly staticSite: StaticSite;
  /**
   * Tenant-seeder Lambda (SBT provisionSuccess consumer). Exposed so
   * analytics-stack (a downstream stack) can attach CloudWatch alarms
   * without duplicating the Lambda construction or hardcoding ARNs.
   */
  public readonly tenantSeeder: TenantSeederLambda;

  constructor (scope: Construct, id: string, props: ControlPlaneStackProps) {
    super(scope, id, props);
    addTemplateTag(this, 'ControlPlaneStack');

    const cognitoAuth = new sbt.CognitoAuth(this, 'CognitoAuth', {
      controlPlaneCallbackURL: props.adminSiteUrl
    });

    // Deletion protection on the SBT-managed system-admin Cognito pool.
    //
    // SBT's CognitoAuth construct (sbt-aws 0.9.1) does not expose a
    // deletionProtection passthrough on its CognitoAuthProps. Use the L1
    // escape hatch on the underlying cognito.CfnUserPool to set the property
    // directly. This is CFN-native (no custom resource, no Lambda, no IAM
    // permissions to manage) and CDK manages the value across deploys via
    // normal stack-update semantics.
    //
    // Gated on prod account so UAT teardown (Sprint 3) is not blocked.
    if (isProdAccount()) {
      const systemAdminPoolCfn = cognitoAuth.userPool.node.defaultChild as cognito.CfnUserPool;
      systemAdminPoolCfn.deletionProtection = 'ACTIVE';
    }

    const controlPlane = new sbt.ControlPlane(this, 'controlplane-sbt', {
      systemAdminEmail: props.systemAdminEmail,
      auth: cognitoAuth,
      apiCorsConfig: {
        // =========================================================
        // EdForge CORS Configuration — driven by CDK_PARAM_CORS_ALLOWED_ORIGINS
        // =========================================================
        // UAT:  'https://uat.edforge.app,http://localhost:3000'
        // Prod: 'https://edforge.app,https://www.edforge.app'
        // AdminWeb CloudFront URL is always appended dynamically.
        // =========================================================
        allowOrigins: [
          ...props.corsAllowedOrigins.split(',').map(o => o.trim()),
          // AdminWeb CloudFront distribution (dynamically generated)
          props.adminSiteUrl,
        ],
        allowCredentials: true,
        allowHeaders: [
          // Standard headers
          'content-type',
          'accept',
          'origin',
          
          // AWS headers
          'authorization',
          'x-amz-date',
          'x-amz-security-token',
          'x-amz-user-agent',
          'x-api-key',
          
          // EdForge multi-tenant context headers
          'x-tenant-id',
          'x-school-id',
          'x-request-id',
          'x-user-role',
          'x-correlation-id',
        ],
        exposeHeaders: [
          // Headers frontend can read from responses
          'x-correlation-id',
          'x-request-id',
        ],
        allowMethods: [cdk.aws_apigatewayv2.CorsHttpMethod.ANY],
        maxAge: cdk.Duration.seconds(3600), // Cache preflight for 1 hour
      },
    });

    this.eventManager = controlPlane.eventManager;
    this.eventBusName = controlPlane.eventManager.busName;
    this.regApiGatewayUrl = controlPlane.controlPlaneAPIGatewayUrl;
    this.auth = cognitoAuth;

    // EventBridge Dead Letter Queue for failed events
    this.eventDlq = new EventDlqStack(this, 'EventDLQ', {
      eventBusName: this.eventBusName,
      environment: 'prod',
    });

    // Tenant Seeder Lambda - listens for TenantProvisioned events
    // and seeds tenant metadata to the identity service DynamoDB table.
    // Moved here from SharedInfraStack to avoid circular dependency.
    this.tenantSeeder = new TenantSeederLambda(this, 'TenantSeeder', {
      eventBusName: this.eventBusName,
    });

    // NOTE: C0a (Cognito PostAuthentication trigger) was originally wired
    // here against the control-plane pool (`cognitoAuth.userPool`), but that
    // pool only sees system-admin logins. Tenant users (TenantAdmin,
    // Teacher, Parent, Student) authenticate against each tier's dedicated
    // pool in tenant-template-stack. The trigger was moved to
    // tenant-template-stack.ts (2026-04-17) to attach to the correct pool.

    // Check if AdminWeb directory exists before creating StaticSite
    const adminWebPath = path.join(__dirname, '../../../client/AdminWeb');
    const fs = require('fs');
    
    let staticSite;
    if (fs.existsSync(adminWebPath)) {
      staticSite = new StaticSite(this, 'AdminWebUi', {
        name: 'AdminSite',
        assetDirectory: adminWebPath,
        production: true,
        clientId: this.auth.userClientId,  //.clientId,
        issuer: this.auth.tokenEndpoint,
        apiUrl: this.regApiGatewayUrl,
        wellKnownEndpointUrl: this.auth.wellKnownEndpointUrl,
        distribution: props.distro.cloudfrontDistribution,
        appBucket: props.distro.siteBucket,
        accessLogsBucket: props.accessLogsBucket,
        env: {
          account: this.account,
          region: this.region
        }
      });
    } else {
      console.log('AdminWeb directory not found, skipping StaticSite creation');
    }
    
    // Export URLs for reference by NextJS applications
    new cdk.CfnOutput(this, 'adminSiteUrl', {
      value: props.adminSiteUrl,
      description: 'CloudFront URL for Admin Web Application',
      exportName: 'AdminSiteUrl'
    });

    new cdk.CfnOutput(this, 'ControlPlaneApiUrl', {
      value: this.regApiGatewayUrl,
      description: 'Control Plane API Gateway URL for AdminWeb NextJS application',
      exportName: 'ControlPlaneApiUrl'
    });

    new cdk.CfnOutput(this, 'CognitoClientId', {
      value: this.auth.userClientId,
      description: 'Cognito App Client ID for AdminWeb',
      exportName: 'CognitoClientId'
    });

    new cdk.CfnOutput(this, 'CognitoWellKnownUrl', {
      value: this.auth.wellKnownEndpointUrl,
      description: 'Cognito OIDC Well-Known Endpoint URL (contains user pool ID)',
      exportName: 'CognitoWellKnownUrl'
    });

    new cdk.CfnOutput(this, 'CognitoTokenEndpoint', {
      value: this.auth.tokenEndpoint,
      description: 'Cognito OAuth2 Token Endpoint',
      exportName: 'CognitoTokenEndpoint'
    });

    // Export Event Bus Name for microservices (used for domain events)
    new cdk.CfnOutput(this, 'SbtEventBusName', {
      value: this.eventBusName,
      description: 'SBT Event Bus Name for EdForge microservices',
      exportName: 'SbtEventBusName'
    });

    // CDK Nag check (controlled by environment variable)
    if (process.env.CDK_NAG_ENABLED === 'true') {
      new ControlPlaneNag(this, 'controlplane-nag');
    }
  }
}
