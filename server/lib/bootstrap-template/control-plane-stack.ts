import * as cdk from 'aws-cdk-lib';
import { type Construct } from 'constructs';
import path = require('path');
import { StaticSite } from './static-site';
import { ControlPlaneNag } from '../cdknag/control-plane-nag';
import { addTemplateTag } from '../utilities/helper-functions';
import * as sbt from '@cdklabs/sbt-aws';
import { StaticSiteDistro } from '../shared-infra/static-site-distro';

interface ControlPlaneStackProps extends cdk.StackProps {
  systemAdminEmail: string
  accessLogsBucket: cdk.aws_s3.Bucket
  distro: StaticSiteDistro
  adminSiteUrl: string
}

export class ControlPlaneStack extends cdk.Stack {
  public readonly regApiGatewayUrl: string;
  public readonly eventManager: sbt.IEventManager;
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
        // CORS configuration for Control Plane API (HTTP API)
        // Supports:
        // - localhost development (http://localhost:3000, http://localhost:3001)
        // - Production custom domains (https://scholian.com, https://www.scholian.com)
        // - CloudFront distributions (https://* for adminSiteUrl and appSiteUrl which are generated at deploy time)
        // - Future Vercel deployments (add specific URLs after deployment)
        //
        // Note: The wildcard 'https://*' is used for development phase to support
        // dynamically generated CloudFront URLs. For production, implement proper
        // CORS validation in Lambda Authorizer to restrict to specific origins.
        allowOrigins: [
          'http://localhost:3000',        // Local development - AdminWeb
          'http://localhost:3001',        // Local development - SaaS App
          'https://scholian.com',         // Production custom domain - AdminWeb
          'https://www.scholian.com',     // Production custom domain - AdminWeb (www)
          'https://*',                    // Wildcard to support CloudFront distributions and Vercel deployments
        ],
        allowCredentials: true,
        allowHeaders: [
          'content-type',
          'x-amz-date',
          'authorization',
          'x-api-key',
          'x-amz-security-token',
          'x-amz-user-agent',
          '*', // Wildcard to support all headers during development phase
        ],
        allowMethods: [cdk.aws_apigatewayv2.CorsHttpMethod.ANY],
        maxAge: cdk.Duration.seconds(300),
      },
    });

    this.eventManager = controlPlane.eventManager;
    this.regApiGatewayUrl = controlPlane.controlPlaneAPIGatewayUrl;
    this.auth = cognitoAuth;

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

    // CDK Nag check (controlled by environment variable)
    if (process.env.CDK_NAG_ENABLED === 'true') {
      new ControlPlaneNag(this, 'controlplane-nag');
    }
  }
}
