import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { EmailIdentity } from './email-identity';

/**
 * S0.4a/b/c (external DNS / Vercel) — the SES sending identity + custom MAIL
 * FROM + config set, and the CfnOutputs the operator copies into Vercel's DNS.
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
});
