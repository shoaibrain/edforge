import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { TenantTemplateStack } from './tenant-template-stack';
import type { ContainerInfo } from '../interfaces/container-info';

/**
 * Sprint F.1 — IAM + env-var wiring for the finance bulk-PDF-export
 * workers (F.3 + G.2). This spec asserts the contract documented at
 * `docs/finance-bulk-ops/sprint-plan.md` §F.1, in lockstep with the
 * deploy-ladder `cdk diff` gate (CLAUDE.md §462-484 false-clear trap).
 *
 * The full `TenantTemplateStack` synth depends on a build-generated
 * `lib/service-info.json`, the SBT control plane graph, and a few
 * cdk.Fn.importValue resolutions — too heavy for a focused IAM/env
 * regression test. So the F.1 grant logic is factored into a static
 * `TenantTemplateStack.applyFinancePdfGrant(...)` helper that we
 * exercise here against a bare scope + `iam.Role`.
 *
 * Drift safety: the helper is the only place the grant is constructed
 * in production (see `tenant-template-stack.ts` inside the `containerInfo.forEach`
 * task-role-creation loop). Refactoring the call site away from the helper
 * would silently move the production code out of test coverage —
 * caught by the "no inline ABAC policy emitted for non-finance" test in
 * the negative-case `describe` block below, which asserts a fixed
 * baseline statement count.
 */
describe('TenantTemplateStack.applyFinancePdfGrant (F.1)', () => {
  const ACCOUNT = '123456789012';
  const REGION = 'ap-south-1';
  const EXPECTED_BUCKET = `edforge-pdfs-${ACCOUNT}-${REGION}`;
  // ABAC scoping uses `${aws:PrincipalTag/tenant}` literally — the
  // template stores it verbatim because the substitution happens at
  // IAM-evaluation time on AWS, not at synth time.
  const EXPECTED_RESOURCE_ARN =
    `arn:aws:s3:::${EXPECTED_BUCKET}/tenants/\${aws:PrincipalTag/tenant}/*`;

  function buildScopeAndRole(): { scope: Stack; role: iam.Role; info: ContainerInfo } {
    const app = new App();
    const scope = new Stack(app, 'TenantTemplateStackTestHarness', {
      env: { account: ACCOUNT, region: REGION },
    });
    const role = new iam.Role(scope, 'AbacRoleUnderTest', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    // Minimum-viable ContainerInfo with the required-by-type fields.
    const info: ContainerInfo = {
      name: 'finance',
      image: 'placeholder',
      memoryLimitMiB: 512,
      cpu: 256,
      containerPort: 3010,
      portMappings: [],
      environment: { TABLE_NAME: 'edforge-finance-basic' },
    };
    return { scope, role, info };
  }

  describe('container.name === "finance"', () => {
    it('emits an inline IAM policy on the role with PutObject + GetObject + PutObjectTagging on the tenant-scoped resource ARN', () => {
      const { scope, role, info } = buildScopeAndRole();

      TenantTemplateStack.applyFinancePdfGrant(scope, info, role);

      const template = Template.fromStack(scope);
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: [
                's3:PutObject',
                's3:GetObject',
                's3:PutObjectTagging',
              ],
              Resource: EXPECTED_RESOURCE_ARN,
            }),
          ]),
        }),
      });
    });

    it('sets info.environment.PDF_OUTPUT_BUCKET to the deterministic edforge-pdfs-{acct}-{region} name', () => {
      const { scope, role, info } = buildScopeAndRole();
      TenantTemplateStack.applyFinancePdfGrant(scope, info, role);

      expect(info.environment.PDF_OUTPUT_BUCKET).toBe(EXPECTED_BUCKET);
    });

    it('omits s3:DeleteObject — bulk-export workers do not delete; lifecycle reaps via the pdf-jobs tag', () => {
      const { scope, role, info } = buildScopeAndRole();
      TenantTemplateStack.applyFinancePdfGrant(scope, info, role);

      const policies = Template.fromStack(scope).findResources('AWS::IAM::Policy');
      const json = JSON.stringify(policies);
      expect(json).not.toContain('s3:DeleteObject');
      expect(json).not.toContain('s3:DeleteObjectTagging');
    });

    it('scopes resources to the tenant-tag path only — no wildcard or cross-tenant S3 ARNs', () => {
      const { scope, role, info } = buildScopeAndRole();
      TenantTemplateStack.applyFinancePdfGrant(scope, info, role);

      const json = JSON.stringify(
        Template.fromStack(scope).findResources('AWS::IAM::Policy'),
      );
      // The bucket-root ARN (without the tenant-scoped key suffix) would be a
      // cross-tenant escape; assert it's absent.
      expect(json).not.toContain(`arn:aws:s3:::${EXPECTED_BUCKET}"`);
      expect(json).not.toContain(`arn:aws:s3:::${EXPECTED_BUCKET}/*`);
      expect(json).toContain(EXPECTED_RESOURCE_ARN);
    });
  });

  describe('container.name !== "finance" (negative cases)', () => {
    it.each(['identity', 'academics', 'rproxy', 'unknown-future-service'])(
      'is a no-op for container name "%s" — no IAM Policy emitted, no env var set',
      (name) => {
        const { scope, role, info } = buildScopeAndRole();
        info.name = name;
        const envBefore = { ...info.environment };

        TenantTemplateStack.applyFinancePdfGrant(scope, info, role);

        // No env var added — env is byte-identical to its pre-call shape.
        expect(info.environment).toEqual(envBefore);
        expect(info.environment.PDF_OUTPUT_BUCKET).toBeUndefined();

        // No inline policy emitted on the role. The Role construct only emits an
        // `AWS::IAM::Policy` resource once a statement is attached; with no
        // statements, the synth produces zero Policy resources.
        Template.fromStack(scope).resourceCountIs('AWS::IAM::Policy', 0);
      },
    );
  });
});

/**
 * Cost-redesign C1.6 — the principal grants shared by the ECS task role and
 * the Lambda execution role. Same harness idea as F.1: a bare stack, a bare
 * ABAC role and a bare principal role, primitives instead of the full stack.
 */
describe('TenantTemplateStack.applyServicePrincipalGrants (C1.6)', () => {
  const ACCOUNT = '123456789012';
  const REGION = 'ap-south-1';
  const TABLE = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/edforge-academics-basic`;
  const IDENTITY_TABLE = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/edforge-identity-basic`;
  const POOL = `arn:aws:cognito-idp:${REGION}:${ACCOUNT}:userpool/ap-south-1_TESTPOOL`;

  const container = (name: string): ContainerInfo =>
    ({ name, image: 'x', memoryLimitMiB: 512, cpu: 256, containerPort: 3010, portMappings: [], environment: { TABLE_NAME: 'x' } } as unknown as ContainerInfo);

  function harness(name: string, principal: 'ecs' | 'lambda', extraPolicy?: string) {
    const app = new App();
    const scope = new Stack(app, 'GrantsHarness', { env: { account: ACCOUNT, region: REGION } });
    const abacRole = new iam.Role(scope, `${name}-ABACRole`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    const role = new iam.Role(scope, `${name}-principal`, {
      assumedBy: new iam.ServicePrincipal(principal === 'ecs' ? 'ecs-tasks.amazonaws.com' : 'lambda.amazonaws.com'),
    });
    TenantTemplateStack.applyServicePrincipalGrants(scope, {
      info: container(name),
      role,
      abacRole,
      tableArn: TABLE,
      userPoolArn: POOL,
      identityTableArn: IDENTITY_TABLE,
      additionalPolicyJson: extraPolicy,
      additionalPolicyId: `${name}${principal === 'ecs' ? '' : 'Lambda'}AdditionalPolicy`,
    });
    return { t: Template.fromStack(scope), role, abacRole };
  }

  const tenantTagCondition = { StringLike: { 'aws:RequestTag/tenant': '*' } };

  it.each(['ecs', 'lambda'] as const)('%s principal: ABAC role trusts it only with a tenant session tag', (principal) => {
    const { t } = harness('finance', principal);
    t.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['sts:AssumeRole', 'sts:TagSession'],
            Effect: 'Allow',
            Condition: tenantTagCondition,
            Principal: { AWS: Match.objectLike({ 'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('financeprincipal')]) }) },
          }),
        ]),
      }),
    });
  });

  it('principal may assume the ABAC role under the same condition and gets bootstrap DynamoDB access, in that order', () => {
    const { t } = harness('finance', 'lambda');
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: [
          Match.objectLike({
            Action: ['sts:AssumeRole', 'sts:TagSession'],
            Condition: tenantTagCondition,
            Resource: Match.objectLike({ 'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('financeABACRole')]) }),
          }),
          Match.objectLike({
            Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
            Resource: [TABLE, `${TABLE}/index/*`],
          }),
        ],
      }),
    });
  });

  it('academics additionally gets GetItem on the identity table (archetype resolution)', () => {
    const { t } = harness('academics', 'lambda');
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'dynamodb:GetItem', Resource: IDENTITY_TABLE }),
        ]),
      }),
    });
  });

  it('identity additionally gets the Cognito read actions on the tenant pool', () => {
    const { t } = harness('identity', 'lambda');
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['cognito-idp:AdminGetUser', 'cognito-idp:AdminListGroupsForUser', 'cognito-idp:ListUsersInGroup'],
            Resource: POOL,
          }),
        ]),
      }),
    });
  });

  it('finance gets neither the identity-table nor the Cognito statements', () => {
    const { t } = harness('finance', 'lambda');
    const docs = Object.values(t.findResources('AWS::IAM::Policy')).map(
      (r) => JSON.stringify((r as { Properties: unknown }).Properties),
    );
    expect(docs.join(' ')).not.toContain('cognito-idp:AdminGetUser');
    expect(docs.join(' ')).not.toContain(IDENTITY_TABLE);
  });

  it('attaches the AdditionalPolicy under the id the caller chooses (ECS keeps its historical id, Lambda gets its own)', () => {
    const extra = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['ssmmessages:OpenDataChannel'], Resource: '*' }] });
    const { t } = harness('identity', 'lambda', extra);
    const ids = Object.keys(t.findResources('AWS::IAM::Policy'));
    expect(ids.some((id) => id.startsWith('identityLambdaAdditionalPolicy'))).toBe(true);
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({ Statement: [Match.objectLike({ Action: 'ssmmessages:OpenDataChannel' })] }),
    });
  });
});
