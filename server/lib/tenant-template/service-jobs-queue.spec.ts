import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ServiceJobsQueue, JobsDlqAlarm, serviceJobsQueueName } from './service-jobs-queue';

describe('ServiceJobsQueue + JobsDlqAlarm (C3.7 / C3.11)', () => {
  const stack = new cdk.Stack(new cdk.App(), 'T', { env: { account: '111111111111', region: 'ap-south-1' } });
  const fin = new ServiceJobsQueue(stack, 'F', { serviceName: 'finance', tier: 'basic', workerTimeout: cdk.Duration.seconds(900) });
  const aca = new ServiceJobsQueue(stack, 'A', { serviceName: 'academics', tier: 'basic', workerTimeout: cdk.Duration.seconds(900) });
  new JobsDlqAlarm(stack, 'Alarm', { tier: 'basic', deadLetterQueues: { finance: fin.deadLetterQueue, academics: aca.deadLetterQueue } });
  const t = Template.fromStack(stack);

  it('names queues deterministically, encrypts them, keeps messages a day, visibility = worker timeout + 60 s, DLQ after three receives', () => {
    expect(serviceJobsQueueName('finance', 'BASIC')).toBe('edforge-finance-jobs-basic');
    t.resourceCountIs('AWS::SQS::Queue', 4);
    t.hasResourceProperties('AWS::SQS::Queue', Match.objectLike({ QueueName: 'edforge-finance-jobs-basic', SqsManagedSseEnabled: true, MessageRetentionPeriod: 86400, VisibilityTimeout: 960, RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }) }));
    t.hasResourceProperties('AWS::SQS::Queue', Match.objectLike({ QueueName: 'edforge-academics-jobs-basic-dlq', MessageRetentionPeriod: 86400 }));
  });

  it('is one alarm over both dead-letter queues', () => {
    t.resourceCountIs('AWS::CloudWatch::Alarm', 1);
    t.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({ AlarmName: 'edforge-jobs-dlq-basic', Threshold: 0, Metrics: Match.arrayWith([Match.objectLike({ Expression: 'FILL(finance, 0) + FILL(academics, 0)' })]) }));
  });
});
