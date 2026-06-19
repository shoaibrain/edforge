import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { EmailIdentity } from './email-identity';

/**
 * S0.4a/b/c (external DNS / Vercel) — the SES sending identity + custom MAIL
 * FROM + config set, and the CfnOutputs the operator copies into Vercel's DNS.
 * S1.1–S1.4 (observability) — event destination, suppression, the
 * `edforge-email-events` alert topic, and the two reputation alarms.
 * CDK creates NO DNS records (it cannot write to Vercel). Mirrors the repo's
 * existing Template.fromStack specs.
 */
describe('EmailIdentity (SES sending foundation, external DNS)', () => {
  function synth (): Template {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'ap-south-1' },
    });
    new EmailIdentity(stack, 'Email', {
      sendingDomain: 'mail.edforge.app',
      mailFromDomain: 'bounce.mail.edforge.app',
      dmarcReportEmail: 'dmarc@edforge.app',
      configurationSetName: 'edforge-transactional',
      operatorAlertEmail: 'ops@edforge.app',
    });
    return Template.fromStack(stack);
  }

  it('verifies the subdomain identity with a custom MAIL FROM (S0.4a/b)', () => {
    synth().hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: 'mail.edforge.app',
      MailFromAttributes: { MailFromDomain: 'bounce.mail.edforge.app' },
    });
  });

  it('owns the transactional configuration set (S0.4c)', () => {
    synth().hasResourceProperties('AWS::SES::ConfigurationSet', {
      Name: 'edforge-transactional',
    });
  });

  it('creates NO DNS records — those live in Vercel (external DNS)', () => {
    synth().resourceCountIs('AWS::Route53::RecordSet', 0);
  });

  it('outputs the 3 Easy-DKIM CNAME records for Vercel (S0.4a)', () => {
    const t = synth();
    for (const i of [1, 2, 3]) {
      const outputs = t.findOutputs('*', { Description: `Add to Vercel DNS — DKIM ${i}/3 (CNAME)` });
      expect(Object.keys(outputs)).toHaveLength(1);
    }
  });

  it('outputs the MAIL FROM MX + SPF records for Vercel (S0.4b)', () => {
    const t = synth();
    t.hasOutput('*', { Value: 'bounce.mail.edforge.app MX 10 feedback-smtp.ap-south-1.amazonses.com' });
    t.hasOutput('*', { Value: 'bounce.mail.edforge.app TXT "v=spf1 include:amazonses.com -all"' });
  });

  it('outputs a DMARC record scoped to the sending subdomain, p=none (S0.4c)', () => {
    synth().hasOutput('*', {
      Value: '_dmarc.mail.edforge.app TXT "v=DMARC1; p=none; rua=mailto:dmarc@edforge.app"',
    });
  });

  it('tracks the 6 send events to CloudWatch, dimensioned by config set (S1.1)', () => {
    synth().hasResourceProperties('AWS::SES::ConfigurationSetEventDestination', {
      EventDestination: Match.objectLike({
        Enabled: true,
        MatchingEventTypes: ['send', 'delivery', 'bounce', 'complaint', 'reject', 'renderingFailure'],
        CloudWatchDestination: {
          DimensionConfigurations: [{
            DimensionName: 'ses:configuration-set',
            DimensionValueSource: 'messageTag',
            DefaultDimensionValue: 'edforge-transactional',
          }],
        },
      }),
    });
  });

  it('enables config-set suppression for bounces + complaints (S1.4)', () => {
    synth().hasResourceProperties('AWS::SES::ConfigurationSet', {
      Name: 'edforge-transactional',
      SuppressionOptions: { SuppressedReasons: ['BOUNCE', 'COMPLAINT'] },
    });
  });

  it('creates the edforge-email-events topic with an SSL-only policy + email sub (S1.2)', () => {
    const t = synth();
    t.hasResourceProperties('AWS::SNS::Topic', { TopicName: 'edforge-email-events' });
    t.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'ops@edforge.app',
    });
    t.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([Match.objectLike({
          Sid: 'EnforceSSL',
          Effect: 'Deny',
          Condition: { Bool: { 'aws:SecureTransport': 'false' } },
        })]),
      }),
    });
  });

  it('alarms on account-level bounce + complaint reputation, routed to the topic (S1.3)', () => {
    const t = synth();
    t.resourceCountIs('AWS::CloudWatch::Alarm', 2);
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/SES',
      MetricName: 'Reputation.BounceRate',
      Statistic: 'Average',
      Threshold: 0.05,
      ComparisonOperator: 'GreaterThanThreshold',
      AlarmActions: Match.arrayWith([
        Match.objectLike({ Ref: Match.stringLikeRegexp('EmailEventsTopic') }),
      ]),
    });
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/SES',
      MetricName: 'Reputation.ComplaintRate',
      Threshold: 0.001,
      ComparisonOperator: 'GreaterThanThreshold',
      AlarmActions: Match.arrayWith([
        Match.objectLike({ Ref: Match.stringLikeRegexp('EmailEventsTopic') }),
      ]),
    });
  });

  /**
   * S2.6 — Cognito sending-authorization grant (PutIdentityPolicy).
   *
   * This block lives here (not in identity-provider.spec.ts) post-refactor:
   * the grant is a permission ON the SES identity that lives in this stack,
   * so it's owned by this construct. The previous placement in
   * tenant-template-stack-basic produced a CFN/IAM eventual-consistency race
   * that tore down the SES cutover deploy on 2026-06-19 — the race is now
   * absorbed by the custom-Lambda CR's retry-on-AccessDenied (industry
   * standard mitigation for this class of failure).
   */
  describe('Cognito grant (S2.6, enableCognitoBasicGrant ON)', () => {
    function synthWithGrant (): Template {
      const app = new App();
      const stack = new Stack(app, 'TestStackGrant', {
        env: { account: '123456789012', region: 'ap-south-1' },
      });
      new EmailIdentity(stack, 'Email', {
        sendingDomain: 'mail.edforge.app',
        mailFromDomain: 'bounce.mail.edforge.app',
        dmarcReportEmail: 'dmarc@edforge.app',
        configurationSetName: 'edforge-transactional',
        operatorAlertEmail: 'ops@edforge.app',
        enableCognitoBasicGrant: true,
      });
      return Template.fromStack(stack);
    }

    it('emits exactly one SesIdentityPolicy custom resource', () => {
      synthWithGrant().resourceCountIs('Custom::SesIdentityPolicy', 1);
    });

    it('uses a dedicated custom-Lambda CR (NOT AwsCustomResource) to enable retry-on-AccessDenied', () => {
      const t = synthWithGrant();
      // AwsCustomResource leaves a Custom::AWS type behind; ours is Custom::SesIdentityPolicy.
      t.resourceCountIs('Custom::AWS', 0);
    });

    it('handler retries AccessDenied with exponential backoff to absorb IAM eventual-consistency (2026-06-19 incident)', () => {
      const lambdas = JSON.stringify(synthWithGrant().findResources('AWS::Lambda::Function'));
      // The retry primitives appear in the inline source.
      expect(lambdas).toContain('PutIdentityPolicyCommand');
      expect(lambdas).toContain('DeleteIdentityPolicyCommand');
      expect(lambdas).toContain('AccessDenied');
      expect(lambdas).toContain('withRetry');
      expect(lambdas).toContain('MAX_ATTEMPTS');
      // Exponential backoff (not fixed): bumped per 2026-06-19 incident
      // where ap-south-1 IAM propagation exceeded the original 6 × 5s budget.
      expect(lambdas).toContain('INITIAL_DELAY_MS');
      expect(lambdas).toContain('MAX_DELAY_MS');
      expect(lambdas).toContain('Math.pow');
    });

    it('grants Cognito sending authorization scoped by account + region+account Cognito-ARN pattern (S2.6)', () => {
      const cr = JSON.stringify(synthWithGrant().findResources('Custom::SesIdentityPolicy'));
      expect(cr).toContain('cognito-tenant-basic');
      expect(cr).toContain('email.cognito-idp.amazonaws.com');
      expect(cr).toContain('ses:SendEmail');
      expect(cr).toContain('ses:SendRawEmail');
      expect(cr).toContain('aws:SourceAccount');
      expect(cr).toContain('aws:SourceArn');
      expect(cr).toContain('cognito-idp');
      expect(cr).toContain('userpool/*');
    });

    it('scopes the Lambda IAM to Put/DeleteIdentityPolicy on this identity only (S2.6 least privilege)', () => {
      const policies = JSON.stringify(synthWithGrant().findResources('AWS::IAM::Policy'));
      expect(policies).toContain('ses:PutIdentityPolicy');
      expect(policies).toContain('ses:DeleteIdentityPolicy');
      expect(policies).toContain('identity/mail.edforge.app');
    });
  });

  describe('Cognito grant (S2.6, default OFF)', () => {
    it('emits NO grant resources when the flag is omitted', () => {
      synth().resourceCountIs('Custom::SesIdentityPolicy', 0);
    });
  });
});
