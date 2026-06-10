import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { EmailIdentity } from './email-identity';

/**
 * S0.4a/b/c — the SES sending identity, custom MAIL FROM, and DMARC records.
 * Mirrors the repo's existing Template.fromStack specs (api-gateway.spec.ts,
 * tenant-seeder-lambda.spec.ts, analytics-stack.spec.ts).
 */
describe('EmailIdentity (SES sending foundation)', () => {
  function synth (): Template {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'ap-south-1' },
    });
    new EmailIdentity(stack, 'Email', {
      hostedZoneId: 'Z0123456789ABCDEFGHIJ',
      zoneName: 'edforge.app',
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

  it('writes exactly 3 Easy-DKIM CNAMEs into the parent zone (S0.4a)', () => {
    const records = synth().findResources('AWS::Route53::RecordSet');
    const cnames = Object.values(records).filter((r) => r.Properties?.Type === 'CNAME');
    expect(cnames).toHaveLength(3);
  });

  it('writes the MAIL FROM MX + SPF TXT for SPF alignment (S0.4b)', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Route53::RecordSet', {
      Type: 'MX',
      Name: 'bounce.mail.edforge.app.',
      ResourceRecords: ['10 feedback-smtp.ap-south-1.amazonses.com'],
    });
    t.hasResourceProperties('AWS::Route53::RecordSet', {
      Type: 'TXT',
      Name: 'bounce.mail.edforge.app.',
      ResourceRecords: ['"v=spf1 include:amazonses.com -all"'],
    });
  });

  it('publishes a DMARC policy at the org apex, p=none during rollout (S0.4c)', () => {
    synth().hasResourceProperties('AWS::Route53::RecordSet', {
      Type: 'TXT',
      Name: '_dmarc.edforge.app.',
      ResourceRecords: ['"v=DMARC1; p=none; rua=mailto:dmarc@edforge.app"'],
    });
  });
});
