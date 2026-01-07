import * as cdk from 'aws-cdk-lib';
import { type Construct } from 'constructs';
import path = require('path');
import { StaticSite } from './static-site';
import { ControlPlaneNag } from '../cdknag/control-plane-nag';
import { addTemplateTag } from '../utilities/helper-functions';
import * as sbt from '@cdklabs/sbt-aws';
import { StaticSiteDistro } from '../shared-infra/static-site-distro';
import { EventDlqStack } from '../shared-infra/event-dlq-stack';

interface ControlPlaneStackProps extends cdk.StackProps {
  systemAdminEmail: string
  accessLogsBucket: cdk.aws_s3.Bucket
  distro: StaticSiteDistro
  adminSiteUrl: string
}

export class ControlPlaneStack extends cdk.Stack {
  public readonly regApiGatewayUrl: string;
  public readonly eventManager: sbt.IEventManager;
  public readonly eventBusName: string;
  public readonly eventDlq: EventDlqStack;
  public readonly auth: sbt.CognitoAuth;
  public readonly adminSiteUrl: string;
  public readonly staticSite: StaticSite;

  constructor (scope: Construct, id: string, props: ControlPlaneStackProps) {
    super(scope, id, props);
    addTemplateTag(this, 'ControlPlaneStack');

    const cognitoAuth = new sbt.CognitoAuth(this, 'CognitoAuth', {
      controlPlaneCallbackURL: props.adminSiteUrl
    });

    const controlPlane = new sbt.ControlPlane(this, 'controlplane-sbt', {
      systemAdminEmail: props.systemAdminEmail,
      auth: cognitoAuth,
      apiCorsConfig: {
        // =========================================================
        // EdForge CORS Configuration for MFE Architecture
        // =========================================================
        // 
        // LOCAL DEV: All MFE ports need CORS (cross-origin between ports)
        // PRODUCTION: Single origin from CloudFront (edforge.app)
        // =========================================================
        allowOrigins: [
          // =============================
          // LOCAL DEVELOPMENT - MFE Ports
          // =============================
          // Each MFE app runs on its own port during development
          'http://localhost:3000',  // Shell (orchestrator, auth, routing)
          'http://localhost:3001',  // Ed-Fi integration
          'http://localhost:3002',  // Academics
          'http://localhost:3003',  // Finance
          'http://localhost:3005',  // Special Programs
          'http://localhost:3006',  // People/HR
          'http://localhost:3007',  // Messages
          'http://localhost:3008',  // Analytics
          
          // =============================
          // PRODUCTION - S3 + CloudFront
          // =============================
          // All MFE assets served from same CloudFront distribution
          'https://edforge.app',
          'https://www.edforge.app',
          
          // AdminWeb CloudFront distribution (dynamically generated)
          // This resolves to the actual CloudFront domain at deployment time
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
