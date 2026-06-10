import { CfnOutput, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ses from 'aws-cdk-lib/aws-ses';

export interface EmailIdentityProps {
  /**
   * The SES sending identity — a dedicated subdomain so transactional-email
   * reputation is isolated from the root domain, e.g. `mail.edforge.app`.
   */
  readonly sendingDomain: string
  /** Custom MAIL FROM subdomain for SPF alignment, e.g. `bounce.mail.edforge.app`. */
  readonly mailFromDomain: string
  /** DMARC aggregate-report (rua) mailbox, e.g. `dmarc@edforge.app`. */
  readonly dmarcReportEmail: string
  /** SES configuration-set name, e.g. `edforge-transactional`. */
  readonly configurationSetName: string
}

/**
 * Account-singleton Amazon SES sending identity for EdForge account email.
 *
 * EXTERNAL-DNS setup: `edforge.app` DNS is hosted at Vercel, not Route53, so CDK
 * owns only the AWS side — the verified sending subdomain (`sendingDomain`), its
 * custom MAIL FROM, and the transactional configuration set. CDK cannot write to
 * Vercel's zone, so instead of creating DNS records it emits `CfnOutput`s listing
 * the exact DKIM / MAIL FROM / DMARC records the operator must add in Vercel.
 * SES verifies the identity once those records propagate.
 *
 * DMARC is published at `_dmarc.<sendingDomain>` (the sending subdomain only) so
 * it never touches the root `edforge.app` policy (which carries unrelated mail,
 * e.g. Zoho).
 *
 * The Cognito pools consume this identity BY NAME STRING (never the construct)
 * so the per-tenant `cdk deploy --exclusively` synth carries no cross-stack
 * `Fn::ImportValue`. Sending is gated separately by `CDK_PARAM_SES_ENABLED` and
 * the per-pool sending-authorization policy added in a later sprint.
 */
export class EmailIdentity extends Construct {
  /** The verified sending domain, e.g. `mail.edforge.app`. Pass to pools as a string. */
  public readonly identityName: string;
  /** The configuration-set name. Pass to pools as a string. */
  public readonly configurationSetName: string;

  constructor (scope: Construct, id: string, props: EmailIdentityProps) {
    super(scope, id);

    const configurationSet = new ses.ConfigurationSet(this, 'ConfigSet', {
      configurationSetName: props.configurationSetName,
    });

    const identity = new ses.EmailIdentity(this, 'Identity', {
      identity: ses.Identity.domain(props.sendingDomain),
      mailFromDomain: props.mailFromDomain,
      configurationSet,
    });

    const region = Stack.of(this).region;
    const dmarcName = `_dmarc.${props.sendingDomain}`;
    const dmarcValue = `v=DMARC1; p=none; rua=mailto:${props.dmarcReportEmail}`;

    // CDK cannot write to Vercel's DNS, so these outputs ARE the contract: the
    // operator copies them into Vercel's zone, then SES verifies the identity.
    // S0.4a — 3 Easy-DKIM CNAMEs (names/targets resolved at deploy time).
    new CfnOutput(this, 'SesDkimCname1', { value: `${identity.dkimDnsTokenName1} CNAME ${identity.dkimDnsTokenValue1}`, description: 'Add to Vercel DNS — DKIM 1/3 (CNAME)' });
    new CfnOutput(this, 'SesDkimCname2', { value: `${identity.dkimDnsTokenName2} CNAME ${identity.dkimDnsTokenValue2}`, description: 'Add to Vercel DNS — DKIM 2/3 (CNAME)' });
    new CfnOutput(this, 'SesDkimCname3', { value: `${identity.dkimDnsTokenName3} CNAME ${identity.dkimDnsTokenValue3}`, description: 'Add to Vercel DNS — DKIM 3/3 (CNAME)' });
    // S0.4b — custom MAIL FROM (SPF alignment for DMARC).
    new CfnOutput(this, 'SesMailFromMx', { value: `${props.mailFromDomain} MX 10 feedback-smtp.${region}.amazonses.com`, description: 'Add to Vercel DNS — MAIL FROM (MX)' });
    new CfnOutput(this, 'SesMailFromSpf', { value: `${props.mailFromDomain} TXT "v=spf1 include:amazonses.com -all"`, description: 'Add to Vercel DNS — MAIL FROM (SPF TXT)' });
    // S0.4c — DMARC for the sending subdomain only (does not touch root edforge.app).
    new CfnOutput(this, 'SesDmarc', { value: `${dmarcName} TXT "${dmarcValue}"`, description: 'Add to Vercel DNS — DMARC (TXT, sending subdomain)' });

    this.identityName = props.sendingDomain;
    this.configurationSetName = props.configurationSetName;
  }
}
