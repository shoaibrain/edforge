import { aws_cognito, type StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { type IdentityDetails } from '../interfaces/identity-details';
import { isProdAccount } from '../utilities/account-guards';

interface IdentityProviderStackProps extends StackProps {
  tenantId: string
  tier: string
  clientAppUrl: string // EdForge application URL for email templates
  corsAllowedOrigins: string // Comma-separated origins for Cognito callback URLs
  useFederation: string
  /**
   * When true, the pool sends account email via Amazon SES (`EmailSendingAccount`
   * DEVELOPER) instead of Cognito's default. Default false → `COGNITO_DEFAULT`
   * (today's behavior). Flag-gated by `CDK_PARAM_SES_ENABLED`; never flip on
   * before SES production access is granted. SES values are passed as plain
   * STRINGS (never the shared-infra construct) so the per-tenant standalone
   * synth carries no cross-stack `Fn::ImportValue`.
   *
   * The PutIdentityPolicy grant that authorizes this pool to send via the
   * shared identity is NOT created here — it lives in `shared-infra-stack` next
   * to the SES identity (see `EmailIdentityProps.enableCognitoBasicGrant`).
   * That refactor was driven by a CFN/IAM eventual-consistency race when the
   * grant was co-located with the pool (2026-06-19 incident); the grant now
   * uses a custom-Lambda CR with retry on AccessDenied. The same env flag
   * (`CDK_PARAM_SES_ENABLED`) controls both sides.
   */
  sesEnabled?: boolean
  sesFromEmail?: string
  sesFromName?: string
  sesReplyTo?: string
  /** Verified SES sending identity (domain), e.g. `mail.edforge.app`. */
  sesIdentityName?: string
  sesConfigurationSetName?: string
}

export class IdentityProvider extends Construct {
  public readonly tenantUserPool: aws_cognito.UserPool;
  public readonly tenantUserPoolClient: aws_cognito.UserPoolClient;
  public readonly identityDetails: IdentityDetails;
  constructor (scope: Construct, id: string, props: IdentityProviderStackProps) {
    super(scope, id);

    // S2.2 — conditional SES transport. When enabled, withSES sets the pool's
    // EmailConfiguration to DEVELOPER + SourceArn (the shared verified identity)
    // + the transactional config set; disabled → undefined → Cognito's default
    // email (today's behavior). Flag-gated by sesEnabled (CDK_PARAM_SES_ENABLED).
    const sesEmail = props.sesEnabled && props.sesFromEmail && props.sesIdentityName
      ? aws_cognito.UserPoolEmail.withSES({
        fromEmail: props.sesFromEmail,
        fromName: props.sesFromName,
        replyTo: props.sesReplyTo,
        configurationSetName: props.sesConfigurationSetName,
        sesVerifiedDomain: props.sesIdentityName,
      })
      : undefined;

    this.tenantUserPool = new aws_cognito.UserPool(this, props.tenantId, {
      email: sesEmail,
      autoVerify: { email: true },
      // Note: Advanced Security Mode disabled (OFF is default when not specified)
      // For production, consider enabling ENFORCED with aws_cognito.StandardThreatProtectionMode.FULL
      selfSignUpEnabled: props.useFederation.toLowerCase() === 'true',
      // Deletion protection in prod blocks accidental pool deletion
      // (operator typo, console misclick). Gated on prod account so UAT
      // teardown via cleanup.sh remains unblocked.
      deletionProtection: isProdAccount(),

      accountRecovery: aws_cognito.AccountRecovery.EMAIL_ONLY,
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        }
      },
      // password policy
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true
      },
      customAttributes: {
        tenantId: new aws_cognito.StringAttribute({
          mutable: true
        }),
        userRole: new aws_cognito.StringAttribute({
          mutable: true
        }),
        apiKey: new aws_cognito.StringAttribute({
          mutable: true
        }),
        // adding this new custom attribute so that we can determine which API Key
        // to use without having to hit an external db in the lambda tenant_authorizer function
        tenantTier: new aws_cognito.StringAttribute({
          mutable: true
        }),
        tenantName: new aws_cognito.StringAttribute({
          mutable: true
        })

      },
      userInvitation: {
        emailSubject: 'Welcome to EdForge - Your Account is Ready',
        // Branded HTML email template — Cognito only supports {username} and {####} variables.
        // props.clientAppUrl is interpolated at CDK synthesis time.
        // Uses table-based layout with inline CSS for Outlook/Gmail/Apple Mail compatibility.
        emailBody: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>EdForge Account</title></head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;">

<!-- Header -->
<tr><td style="background-color:#1565c0;padding:28px 40px;border-radius:8px 8px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:0.5px;">EdForge</td>
<td align="right" style="color:rgba(255,255,255,0.85);font-size:14px;">Education Platform</td>
</tr>
</table>
</td></tr>

<!-- Body -->
<tr><td style="background-color:#ffffff;padding:40px 44px;border-left:1px solid #e0e0e0;border-right:1px solid #e0e0e0;">

<p style="margin:0 0 10px;font-size:22px;font-weight:600;color:#1a1a1a;">Your Account is Ready</p>
<p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.7;">Welcome to EdForge! Your account has been created. Use the credentials below to sign in.</p>

<!-- Credentials Box -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
<tr><td style="background-color:#e3f2fd;border:1px solid #bbdefb;border-radius:8px;padding:24px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding-bottom:16px;">
<span style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Username</span><br>
<span style="font-size:17px;color:#1a1a1a;font-weight:600;word-break:break-all;">{username}</span>
</td></tr>
<tr><td style="border-top:1px solid #bbdefb;padding-top:16px;">
<span style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Temporary Password</span><br>
<span style="font-size:17px;color:#1a1a1a;font-weight:600;font-family:'Courier New',monospace;letter-spacing:1px;">{####}</span>
</td></tr>
</table>
</td></tr>
</table>

<!-- CTA Button -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0">
<tr><td align="center" style="background-color:#1565c0;border-radius:6px;">
<a href="${props.clientAppUrl}" target="_blank" style="display:inline-block;padding:14px 48px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">Sign In to EdForge</a>
</td></tr>
</table>
</td></tr>
</table>

<!-- Important Notice -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
<tr><td style="background-color:#fff3e0;border-left:4px solid #ff9800;padding:14px 20px;border-radius:0 4px 4px 0;">
<p style="margin:0;font-size:14px;color:#e65100;font-weight:600;">Please change your password after your first login.</p>
</td></tr>
</table>

<p style="margin:0;font-size:14px;color:#555;line-height:1.7;">After signing in, go to <strong>Settings &rarr; Workspace</strong> to confirm your organization's currency, timezone, and calendar system.</p>

</td></tr>

<!-- Footer -->
<tr><td style="background-color:#fafafa;padding:24px 40px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;border-top:none;">
<p style="margin:0 0 6px;font-size:13px;color:#888;">Need help? Contact your administrator.</p>
<p style="margin:0;font-size:12px;color:#aaa;">&copy; EdForge Technologies. All rights reserved.</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`,
        smsMessage:
          `EdForge: Your account is ready. Login at ${props.clientAppUrl} | User: {username} | Temp pass: {####}`,
      }
    });

    // Override logical ID to remove hash and include tier info
    const cleanTenantId = props.tenantId.replace(/[^a-zA-Z0-9]/g, '');
    (this.tenantUserPool.node.defaultChild as aws_cognito.CfnUserPool).overrideLogicalId(`${props.tier.toLowerCase()}UserPool${cleanTenantId}`);

    // Add tags for cleanup identification
    Tags.of(this.tenantUserPool).add('SaaSFactory', 'ECS-SaaS-Ref');

    // S2.6 grant: NOT created here — see the `sesEnabled` prop docstring.
    // The grant lives in shared-infra-stack's `EmailIdentity` construct, which
    // owns the SES identity it permissions. The same `CDK_PARAM_SES_ENABLED`
    // env flag controls both sides (the grant emission there, this pool's
    // EmailConfiguration flip above).

    const writeAttributes = new aws_cognito.ClientAttributes()
      .withStandardAttributes({ email: true })
      .withCustomAttributes('tenantId', 'userRole', 'apiKey', 'tenantTier', 'tenantName');

    // CRITICAL: readAttributes must be explicitly configured for custom attributes
    // to be included in JWT tokens. Without this, tokens won't contain custom attributes
    // even if writeAttributes is set and users have the attributes.
    const readAttributes = new aws_cognito.ClientAttributes()
      .withStandardAttributes({ email: true })
      .withCustomAttributes('tenantId', 'userRole', 'apiKey', 'tenantTier', 'tenantName');

    // Build callback URLs from CORS allowed origins
    // Each origin gets a trailing slash appended for Cognito compatibility
    const callbackUrls = props.corsAllowedOrigins
      .split(',')
      .map(o => o.trim())
      .filter(o => o.length > 0)
      .map(o => o.endsWith('/') ? o : `${o}/`);

    this.tenantUserPoolClient = new aws_cognito.UserPoolClient(this, 'tenantUserPoolClient', {
      userPool: this.tenantUserPool,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        adminUserPassword: false,
        userSrp: true,
        custom: false
      },
      readAttributes: readAttributes,
      writeAttributes: writeAttributes,
      oAuth: {
        callbackUrls: callbackUrls,
        logoutUrls: callbackUrls,
        scopes: [
          aws_cognito.OAuthScope.EMAIL,
          aws_cognito.OAuthScope.OPENID,
          aws_cognito.OAuthScope.PROFILE
        ],
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true
        }
      }
    });

    this.identityDetails = {
      name: 'Cognito',
      details: {
        userPoolId: this.tenantUserPool.userPoolId,
        appClientId: this.tenantUserPoolClient.userPoolClientId
      }
    };
  }
}
