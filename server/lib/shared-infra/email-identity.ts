import { CfnOutput, Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';

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
  /**
   * Operator mailbox subscribed to the reputation-alarm topic. Resolved in `bin`
   * from `CDK_PARAM_OPERATOR_ALERT_EMAIL` (falling back to the system-admin
   * email). When unset the topic + alarms are still created — subscribe later.
   */
  readonly operatorAlertEmail?: string
}

/**
 * Account-singleton Amazon SES sending substrate for EdForge account email:
 * the verified identity, its observability (event tracking + reputation alarms),
 * and the guardrails (suppression) — everything that hangs off the transactional
 * configuration set.
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
 * Observability (Sprint 1): a CloudWatch event destination publishes per-send
 * SEND/DELIVERY/BOUNCE/COMPLAINT/REJECT/RENDERING_FAILURE counts; two
 * account-level reputation alarms (bounce > 5%, complaint > 0.1%) fire to the
 * `edforge-email-events` SNS topic; config-set suppression drops repeat sends to
 * addresses that have bounced or complained. These ship BEFORE the pool switch
 * so deliverability is observable the moment SES sending turns on.
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
      // S1.4 — config-set-level suppression: SES drops repeat sends to addresses
      // that have hard-bounced or complained, protecting account reputation.
      suppressionReasons: ses.SuppressionReasons.BOUNCES_AND_COMPLAINTS,
    });

    const identity = new ses.EmailIdentity(this, 'Identity', {
      identity: ses.Identity.domain(props.sendingDomain),
      mailFromDomain: props.mailFromDomain,
      configurationSet,
    });

    // S1.1 — publish per-send event counts to CloudWatch (namespace AWS/SES,
    // dimensioned by config set) so deliveries/bounces/complaints are traceable.
    configurationSet.addEventDestination('CloudWatchEvents', {
      destination: ses.EventDestination.cloudWatchDimensions([{
        name: 'ses:configuration-set',
        source: ses.CloudWatchDimensionSource.MESSAGE_TAG,
        defaultValue: props.configurationSetName,
      }]),
      events: [
        ses.EmailSendingEvent.SEND,
        ses.EmailSendingEvent.DELIVERY,
        ses.EmailSendingEvent.BOUNCE,
        ses.EmailSendingEvent.COMPLAINT,
        ses.EmailSendingEvent.REJECT,
        ses.EmailSendingEvent.RENDERING_FAILURE,
      ],
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

    // S1.2 — operator alert topic for the reputation alarms. Intentionally NOT
    // SSE-encrypted: a CloudWatch alarm cannot publish to a topic encrypted with
    // the AWS-managed `alias/aws/sns` key (that key policy can't grant the
    // CloudWatch service principal), so SSE here would SILENTLY drop every alert.
    // The payload is non-sensitive ops metadata ("bounce rate exceeded"). An
    // EnforceSSL policy still satisfies cdk-nag SNS3; SNS2 (SSE) is suppressed
    // below with that reason. Mirrors analytics/core-appplane OperatorAlertTopic.
    const alertTopic = new sns.Topic(this, 'EmailEventsTopic', {
      topicName: 'edforge-email-events',
      displayName: 'EdForge Email Reputation Alerts',
    });
    alertTopic.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'EnforceSSL',
      effect: iam.Effect.DENY,
      principals: [new iam.AnyPrincipal()],
      actions: ['sns:Publish'],
      resources: [alertTopic.topicArn],
      conditions: { Bool: { 'aws:SecureTransport': 'false' } },
    }));
    NagSuppressions.addResourceSuppressions(alertTopic, [{
      id: 'AwsSolutions-SNS2',
      reason:
        'Operator reputation-alarm topic carries non-sensitive ops metadata. SSE via the AWS-managed alias/aws/sns key would BREAK delivery (CloudWatch alarms cannot publish to a topic encrypted with that key); a CMK is unjustified for non-sensitive alerts. Consistent with the OperatorAlertTopic in analytics/core-appplane.',
    }], true);
    if (props.operatorAlertEmail) {
      alertTopic.addSubscription(new subscriptions.EmailSubscription(props.operatorAlertEmail));
    }

    // S1.3 — account-level reputation alarms. SES auto-pauses sending at ~5%
    // bounce / ~0.1% complaint; these fire to the operator well before that
    // ceiling. The Reputation.* metrics are ACCOUNT-WIDE — there is no
    // per-config-set dimension for them — so they carry no Dimensions.
    const snsAction = new cwActions.SnsAction(alertTopic);
    const bounceAlarm = new cloudwatch.Alarm(this, 'BounceRateAlarm', {
      alarmName: `${props.configurationSetName}-bounce-rate`,
      alarmDescription: 'SES account bounce rate over 5% — sending-pause risk.',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SES',
        metricName: 'Reputation.BounceRate',
        statistic: 'Average',
        period: Duration.hours(1),
      }),
      threshold: 0.05,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    bounceAlarm.addAlarmAction(snsAction);

    const complaintAlarm = new cloudwatch.Alarm(this, 'ComplaintRateAlarm', {
      alarmName: `${props.configurationSetName}-complaint-rate`,
      alarmDescription: 'SES account complaint rate over 0.1% — sending-pause risk.',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/SES',
        metricName: 'Reputation.ComplaintRate',
        statistic: 'Average',
        period: Duration.hours(1),
      }),
      threshold: 0.001,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    complaintAlarm.addAlarmAction(snsAction);

    this.identityName = props.sendingDomain;
    this.configurationSetName = props.configurationSetName;
  }
}
