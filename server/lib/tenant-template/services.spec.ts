import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { HttpNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { EcsService } from './services';
import type { ContainerInfo } from '../interfaces/container-info';

function synth(desiredCount: number | undefined) {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'T', { env: { account: '111111111111', region: 'ap-south-1' } });
  const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2, natGateways: 0 });
  const cluster = new ecs.Cluster(stack, 'Cluster', { vpc });
  const ecsSG = new ec2.SecurityGroup(stack, 'Sg', { vpc });
  const namespace = new HttpNamespace(stack, 'Ns', { name: 'basic' });
  const info: ContainerInfo = {
    name: 'identity',
    image: '111111111111.dkr.ecr.ap-south-1.amazonaws.com/identity',
    memoryLimitMiB: 512,
    cpu: 256,
    containerPort: 3010,
    ...(desiredCount === undefined ? {} : { desiredCount }),
    portMappings: [{ name: 'identity', containerPort: 3010 }],
    environment: { TABLE_NAME: 'edforge-identity-basic' },
  };
  new EcsService(stack, 'identity-EcsServices', {
    tenantId: 'basic', tenantName: 'basic', isEc2Tier: false, isRProxy: false, isTarget: false,
    vpc, cluster, ecsSG, namespace, info,
    identityDetails: { name: 'Cognito', details: {} } as never,
  });
  return Template.fromStack(stack);
}

describe('EcsService desired count (cost-redesign C4.4/C5.3)', () => {
  it('runs one task when the manifest says nothing', () => {
    synth(undefined).hasResourceProperties('AWS::ECS::Service', { DesiredCount: 1 });
  });

  it('keeps the service and its definition but runs nothing when the manifest says 0', () => {
    const t = synth(0);
    t.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 0 });
    t.resourceCountIs('AWS::ECS::TaskDefinition', 1);
  });
});
