import { CfnOutput, CustomResource, Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Provider } from 'aws-cdk-lib/custom-resources';
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
  /**
   * S2.6 — Emit the SES identity policy (`cognito-tenant-basic`) that
   * authorizes Cognito user pools in this account+region to send via the
   * verified identity.
   *
   * **Architectural placement.** The grant is a permission ON a SES identity
   * that lives in shared-infra-stack — not a tenant-template concern. The
   * previous placement (`tenant-template-stack-basic`) co-located the grant
   * with the consumer pool, which created two problems that bit us in prod:
   *
   *   1. **CFN/IAM eventual-consistency race.** CDK's `AwsCustomResource`
   *      attached the SES permissions to the shared provider Lambda's role
   *      via inline `AWS::IAM::Policy` in the same deploy unit as the SES
   *      API invocation. CFN ordered them correctly, but IAM data-plane
   *      propagation lagged → AccessDenied on first attempt. (Observed
   *      2026-06-19: SesSendingGrant CREATE_FAILED after 7s; stack rolled
   *      back.)
   *
   *   2. **Multi-tier scalability.** ADVANCED/PREMIUM tiers (currently
   *      V1_DEFERRED per CLAUDE.md) would each need their own grant — three
   *      copies of the race-prone pattern.
   *
   * **Robustness mechanism.** A dedicated custom-resource Lambda handles
   * `PutIdentityPolicy` / `DeleteIdentityPolicy` with linear-backoff retry
   * on `AccessDenied` (up to 6 × 5s = 30s). `AwsCustomResource` doesn't
   * retry AccessDenied because it can't distinguish transient propagation
   * from real bugs; this Lambda makes that distinction explicit. If the
   * first deploy of the grant still races, the retry absorbs it — no
   * operator intervention, no second-deploy choreography.
   *
   * **Scope.** Cognito Service Principal × this SES identity × account
   * × region-scoped Cognito userpool ARN wildcard. The wildcard substitutes
   * the previous per-pool `ArnLike` condition (which would have required
   * pulling the pool ARN via `Fn::ImportValue` from tenant-template-stack —
   * forbidden by S2.1b). Effective scope today is identical (V1 ships one
   * pool per tier; the AWS account is single-tenant operator-owned).
   *
   * Flag-gated by `enableCognitoBasicGrant` (wired from
   * `CDK_PARAM_SES_ENABLED` in `bin/`). When false → no grant resources
   * synthesize.
   */
  readonly enableCognitoBasicGrant?: boolean
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

    // S2.6 — Cognito BASIC tenant pool's SES sending-authorization grant.
    // See the prop docstring above for the architectural rationale.
    if (props.enableCognitoBasicGrant) {
      const identityArn =
        `arn:${Stack.of(this).partition}:ses:${region}:${Stack.of(this).account}:identity/${props.sendingDomain}`;
      // Region+account Cognito userpool wildcard — see prop docstring (S2.1b).
      const cognitoUserPoolArnPattern =
        `arn:${Stack.of(this).partition}:cognito-idp:${region}:${Stack.of(this).account}:userpool/*`;
      const sendingPolicy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Sid: 'AllowCognitoTenantBasicSend',
          Effect: 'Allow',
          Principal: { Service: 'email.cognito-idp.amazonaws.com' },
          Action: ['ses:SendEmail', 'ses:SendRawEmail'],
          Resource: identityArn,
          Condition: {
            StringEquals: { 'aws:SourceAccount': Stack.of(this).account },
            ArnLike: { 'aws:SourceArn': cognitoUserPoolArnPattern },
          },
        }],
      });

      // Custom Lambda CR handler. The retry-on-AccessDenied is what makes
      // this construct safe to deploy in a single CFN pass even with the IAM
      // propagation race — see the prop docstring above. AWS SDK v3 is
      // bundled into the Node 22 Lambda runtime, no asset bundle needed.
      //
      // Budget: exponential backoff capped at 32s/retry × 10 attempts.
      // Total wait between attempts (success path): 0s.
      // Total wait (worst case, 9 failures before 10th attempt):
      //   2 + 4 + 8 + 16 + 32 + 32 + 32 + 32 + 32 = 190s.
      // The 32s cap keeps a single retry from monopolizing the budget.
      // Sized from 2026-06-19 incident: ap-south-1 IAM propagation took
      // > 30s in 6-attempt × 5s fixed-delay budget; AWS docs say IAM
      // eventual consistency can be "a few seconds to several minutes."
      // Lambda timeout 300s gives 110s safety margin over the worst case.
      const grantHandler = new lambda.Function(this, 'CognitoBasicGrantHandler', {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        description:
          'Manages SES identity policy cognito-tenant-basic on mail.edforge.app. ' +
          'Retries AccessDenied (IAM eventual consistency) with exponential backoff ' +
          '(2s..32s cap × 10 attempts; ~190s worst-case budget) before failing.',
        timeout: Duration.seconds(300),
        memorySize: 128,
        logRetention: logs.RetentionDays.ONE_MONTH,
        code: lambda.Code.fromInline([
          "const { SESClient, PutIdentityPolicyCommand, DeleteIdentityPolicyCommand } = require('@aws-sdk/client-ses');",
          '',
          'exports.handler = async (event) => {',
          '  const ses = new SESClient({});',
          '  const props = event.ResourceProperties || {};',
          '  const MAX_ATTEMPTS = 10;',
          '  const INITIAL_DELAY_MS = 2000;',
          '  const MAX_DELAY_MS = 32000;',
          '',
          '  async function withRetry(operation, label) {',
          '    let lastError;',
          '    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {',
          '      try { return await operation(); }',
          '      catch (err) {',
          '        lastError = err;',
          '        const code = err.name || err.Code || "";',
          '        const isTransient =',
          '          code === "AccessDenied" ||',
          '          code === "AccessDeniedException" ||',
          '          code === "ThrottlingException";',
          '        if (!isTransient || attempt === MAX_ATTEMPTS) {',
          '          console.error(label + " failed on attempt " + attempt + "/" + MAX_ATTEMPTS + ": " + code + ": " + err.message);',
          '          throw err;',
          '        }',
          '        const delay = Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS);',
          '        console.log(label + " transient " + code + " on attempt " + attempt + "/" + MAX_ATTEMPTS + "; retrying in " + delay + "ms (IAM eventual consistency)");',
          '        await new Promise(function (r) { setTimeout(r, delay); });',
          '      }',
          '    }',
          '    throw lastError;',
          '  }',
          '',
          '  if (event.RequestType === "Delete") {',
          '    await withRetry(',
          '      function () { return ses.send(new DeleteIdentityPolicyCommand({ Identity: props.Identity, PolicyName: props.PolicyName })); },',
          '      "DeleteIdentityPolicy"',
          '    );',
          '    return { PhysicalResourceId: event.PhysicalResourceId };',
          '  }',
          '',
          '  // Create + Update both upsert via PutIdentityPolicy (idempotent).',
          '  await withRetry(',
          '    function () { return ses.send(new PutIdentityPolicyCommand({ Identity: props.Identity, PolicyName: props.PolicyName, Policy: props.Policy })); },',
          '    "PutIdentityPolicy"',
          '  );',
          '',
          '  return { PhysicalResourceId: "ses-grant-cognito-tenant-basic" };',
          '};',
          '',
        ].join('\n')),
      });
      grantHandler.addToRolePolicy(new iam.PolicyStatement({
        actions: ['ses:PutIdentityPolicy', 'ses:DeleteIdentityPolicy'],
        resources: [identityArn],
      }));
      // cdk-nag suppressions for the Lambda execution role:
      //   IAM4 — AWSLambdaBasicExecutionRole (managed policy for CloudWatch
      //          Logs). Standard for every CDK-created Lambda; replacing it
      //          with a customer-managed equivalent adds noise without
      //          changing the security posture.
      //   IAM5 — Lambda's default log-group ARN wildcard.
      NagSuppressions.addResourceSuppressions(grantHandler.role!, [
        { id: 'AwsSolutions-IAM4', reason: 'CDK-default AWSLambdaBasicExecutionRole for Lambda CloudWatch Logs. Identical to all other custom-resource Lambdas in this stack; replacing with an inline equivalent is noise without security gain.' },
        { id: 'AwsSolutions-IAM5', reason: 'Wildcard is on the Lambda function\'s own log-stream ARN under its log-group (CDK default). The functional SES grant policy is scoped to a single identity ARN above.' },
      ], true);

      const provider = new Provider(this, 'CognitoBasicGrantProvider', {
        onEventHandler: grantHandler,
        logRetention: logs.RetentionDays.ONE_MONTH,
      });
      NagSuppressions.addResourceSuppressions(provider, [
        { id: 'AwsSolutions-IAM4', reason: 'CDK Provider framework Lambda uses AWSLambdaBasicExecutionRole. Internal CDK construct; consistent with other Provider usages in the repo.' },
        { id: 'AwsSolutions-IAM5', reason: 'CDK Provider framework role wildcards are over its own Lambda invocation + log-group ARNs only. No external resource exposure.' },
        { id: 'AwsSolutions-L1', reason: 'Provider framework Lambda runtime is pinned by CDK; we cannot override.' },
      ], true);

      new CustomResource(this, 'CognitoBasicGrant', {
        serviceToken: provider.serviceToken,
        resourceType: 'Custom::SesIdentityPolicy',
        properties: {
          Identity: props.sendingDomain,
          PolicyName: 'cognito-tenant-basic',
          // CFN passes Properties as strings; the Lambda parses the policy.
          Policy: sendingPolicy,
        },
      });
    }
  }
}
