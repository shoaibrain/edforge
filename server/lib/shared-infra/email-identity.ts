import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as route53 from 'aws-cdk-lib/aws-route53';

export interface EmailIdentityProps {
  /** Route53 hosted-zone id for the parent domain (e.g. the `edforge.app` zone). */
  readonly hostedZoneId: string
  /** Parent zone name, e.g. `edforge.app`. */
  readonly zoneName: string
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
 * Verifies a dedicated subdomain (`sendingDomain`) and writes the Easy-DKIM,
 * custom MAIL FROM (SPF), and DMARC records into the parent Route53 zone, and
 * owns the transactional configuration set. The DKIM record names are CFN
 * tokens (`Fn::GetAtt`), so the L2 `route53.CnameRecord` leaves them verbatim
 * rather than appending the zone suffix — the documented behaviour for
 * unresolved record names.
 *
 * The Cognito pools consume this identity **by name string** (never the
 * construct) so the per-tenant `cdk deploy --exclusively` synth carries no
 * cross-stack `Fn::ImportValue`. Sending is gated behind `CDK_PARAM_SES_ENABLED`
 * and the per-pool sending-authorization policy added in a later sprint; this
 * construct only stands up the identity + DNS + config set.
 */
export class EmailIdentity extends Construct {
  /** The verified sending domain, e.g. `mail.edforge.app`. Pass to pools as a string. */
  public readonly identityName: string;
  /** The configuration-set name. Pass to pools as a string. */
  public readonly configurationSetName: string;

  constructor (scope: Construct, id: string, props: EmailIdentityProps) {
    super(scope, id);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });

    const configurationSet = new ses.ConfigurationSet(this, 'ConfigSet', {
      configurationSetName: props.configurationSetName,
    });

    const identity = new ses.EmailIdentity(this, 'Identity', {
      identity: ses.Identity.domain(props.sendingDomain),
      mailFromDomain: props.mailFromDomain,
      configurationSet,
    });

    // S0.4a — Easy-DKIM CNAMEs in the parent zone. Names/values are GetAtt
    // tokens, so CnameRecord leaves recordName verbatim (no zone-suffix append).
    const dkimTokens: Array<[string, string]> = [
      [identity.dkimDnsTokenName1, identity.dkimDnsTokenValue1],
      [identity.dkimDnsTokenName2, identity.dkimDnsTokenValue2],
      [identity.dkimDnsTokenName3, identity.dkimDnsTokenValue3],
    ];
    dkimTokens.forEach(([recordName, value], i) => {
      new route53.CnameRecord(this, `Dkim${i + 1}`, {
        zone,
        recordName,
        domainName: value,
      });
    });

    // S0.4b — custom MAIL FROM: MX + SPF TXT. Without these SES's envelope-from
    // is amazonses.com and SPF cannot align to edforge.app for DMARC.
    new route53.MxRecord(this, 'MailFromMx', {
      zone,
      recordName: props.mailFromDomain,
      values: [{ priority: 10, hostName: `feedback-smtp.${Stack.of(this).region}.amazonses.com` }],
    });
    new route53.TxtRecord(this, 'MailFromSpf', {
      zone,
      recordName: props.mailFromDomain,
      values: ['v=spf1 include:amazonses.com -all'],
    });

    // S0.4c — DMARC at the org apex. p=none during rollout; tighten to
    // quarantine/reject once aggregate reports confirm DKIM/SPF alignment.
    new route53.TxtRecord(this, 'Dmarc', {
      zone,
      recordName: `_dmarc.${props.zoneName}`,
      values: [`v=DMARC1; p=none; rua=mailto:${props.dmarcReportEmail}`],
    });

    this.identityName = props.sendingDomain;
    this.configurationSetName = props.configurationSetName;
  }
}
