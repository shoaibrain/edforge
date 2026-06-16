import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { IdentityProvider } from './identity-provider';

/**
 * Sprint 2 — Cognito→SES cutover behind the `sesEnabled` flag.
 *  - S2.2: conditional `withSES` EmailConfiguration (flag ON → DEVELOPER + SourceArn
 *    + config set; OFF → Cognito default).
 *  - S2.6: the `PutIdentityPolicy` sending-authorization grant — the error-prone
 *    centerpiece `withSES` does NOT create. Without it Cognito gets AccessDenied
 *    at send time (user created, no email, no Send event).
 *  - S2.1b: import-safety — SES is referenced by STRING, so the per-tenant
 *    standalone synth carries no cross-stack `Fn::ImportValue`.
 */
describe('IdentityProvider — SES transport (Sprint 2)', () => {
  function synth (sesEnabled: boolean): Template {
    const app = new App();
    const stack = new Stack(app, 'TenantStack', {
      env: { account: '123456789012', region: 'ap-south-1' },
    });
    new IdentityProvider(stack, 'IdentityProvider', {
      tenantId: 'basic',
      tier: 'BASIC',
      clientAppUrl: 'https://edforge.app',
      corsAllowedOrigins: 'https://edforge.app',
      useFederation: 'false',
      sesEnabled,
      sesFromEmail: 'no-reply@mail.edforge.app',
      sesFromName: 'EdForge',
      sesReplyTo: 'support@edforge.app',
      sesIdentityName: 'mail.edforge.app',
      sesConfigurationSetName: 'edforge-transactional',
    });
    return Template.fromStack(stack);
  }

  describe('flag ON', () => {
    it('routes the pool through SES — DEVELOPER + From + config set (S2.2)', () => {
      synth(true).hasResourceProperties('AWS::Cognito::UserPool', {
        EmailConfiguration: Match.objectLike({
          EmailSendingAccount: 'DEVELOPER',
          ConfigurationSet: 'edforge-transactional',
          From: Match.stringLikeRegexp('no-reply@mail.edforge.app'),
        }),
      });
    });

    it('builds the SourceArn from the verified identity in ap-south-1 (S2.2)', () => {
      const pool = JSON.stringify(synth(true).findResources('AWS::Cognito::UserPool'));
      expect(pool).toContain('identity/mail.edforge.app');
      expect(pool).toContain('ap-south-1');
    });

    it('grants Cognito sending authorization on the identity (S2.6)', () => {
      const t = synth(true);
      t.resourceCountIs('Custom::AWS', 1);
      const grant = JSON.stringify(t.findResources('Custom::AWS'));
      expect(grant).toContain('putIdentityPolicy');
      expect(grant).toContain('cognito-tenant-basic');
      expect(grant).toContain('email.cognito-idp.amazonaws.com');
      expect(grant).toContain('ses:SendEmail');
      expect(grant).toContain('ses:SendRawEmail');
      // scoped to this pool's ARN + the account (not any pool)
      expect(grant).toContain('aws:SourceArn');
      expect(grant).toContain('aws:SourceAccount');
      // delete path tears the policy back down on rollback
      expect(grant).toContain('deleteIdentityPolicy');
    });

    it('scopes the grant Lambda IAM to Put/DeleteIdentityPolicy only (S2.6)', () => {
      const policies = JSON.stringify(synth(true).findResources('AWS::IAM::Policy'));
      expect(policies).toContain('ses:PutIdentityPolicy');
      expect(policies).toContain('ses:DeleteIdentityPolicy');
    });

    it('references SES by string only — zero Fn::ImportValue (S2.1b)', () => {
      const json = JSON.stringify(synth(true).toJSON());
      expect(json).not.toContain('Fn::ImportValue');
    });
  });

  describe('flag OFF (default)', () => {
    it('leaves the pool on COGNITO_DEFAULT — no DEVELOPER email config (S2.2)', () => {
      const pool = JSON.stringify(synth(false).findResources('AWS::Cognito::UserPool'));
      expect(pool).not.toContain('DEVELOPER');
    });

    it('creates no SES sending grant (S2.6)', () => {
      synth(false).resourceCountIs('Custom::AWS', 0);
    });
  });
});
