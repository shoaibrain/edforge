import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { IdentityProvider } from './identity-provider';

/**
 * Sprint 2 — Cognito→SES cutover behind the `sesEnabled` flag.
 *  - S2.2: conditional `withSES` EmailConfiguration (flag ON → DEVELOPER + SourceArn
 *    + config set; OFF → Cognito default).
 *  - S2.1b: import-safety — SES is referenced by STRING, so the per-tenant
 *    standalone synth carries no cross-stack `Fn::ImportValue`.
 *
 * NOTE: the S2.6 sending-authorization grant (PutIdentityPolicy) was moved out
 * of this construct in PR #<NEW> after a 2026-06-19 CFN/IAM eventual-consistency
 * race tore down the SES cutover deploy. Its tests now live in
 * `shared-infra/email-identity.spec.ts` next to the construct that emits it.
 * The flag-OFF "no Custom::AWS" assertion below is preserved: identity-provider
 * itself must remain free of any Custom::AWS resources regardless of flag.
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

    it('emits NO Custom::AWS resources — the SES grant lives in shared-infra now (S2.6 placement)', () => {
      // Post-refactor: identity-provider only flips the pool's
      // EmailConfiguration; it does NOT create the PutIdentityPolicy grant.
      // The grant lives in shared-infra/email-identity.ts to eliminate the
      // CFN/IAM eventual-consistency race that bit the 2026-06-19 deploy.
      synth(true).resourceCountIs('Custom::AWS', 0);
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

    it('creates no Custom::AWS resources (S2.6 placement)', () => {
      synth(false).resourceCountIs('Custom::AWS', 0);
    });
  });
});
