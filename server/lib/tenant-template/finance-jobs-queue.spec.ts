import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { FinanceJobsQueue, financeJobsQueueName } from './finance-jobs-queue';

describe('FinanceJobsQueue (C3.7)', () => {
  const stack = new cdk.Stack(new cdk.App(), 'T', { env: { account: '111111111111', region: 'ap-south-1' } });
  new FinanceJobsQueue(stack, 'Q', { tier: 'basic', workerTimeout: cdk.Duration.seconds(900) });
  const t = Template.fromStack(stack);

  it('names the queue deterministically, encrypts it, keeps messages a day, and sets visibility to the worker timeout plus a minute', () => {
    expect(financeJobsQueueName('BASIC')).toBe('edforge-finance-jobs-basic');
    t.resourceCountIs('AWS::SQS::Queue', 2);
    t.hasResourceProperties('AWS::SQS::Queue', Match.objectLike({
      QueueName: 'edforge-finance-jobs-basic', SqsManagedSseEnabled: true, MessageRetentionPeriod: 86400, VisibilityTimeout: 960,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
    }));
    t.hasResourceProperties('AWS::SQS::Queue', Match.objectLike({ QueueName: 'edforge-finance-jobs-basic-dlq', MessageRetentionPeriod: 86400 }));
  });

  it('alarms on any message in the dead-letter queue', () => {
    t.resourceCountIs('AWS::CloudWatch::Alarm', 1);
    t.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({ AlarmName: 'edforge-finance-jobs-basic-dlq', MetricName: 'ApproximateNumberOfMessagesVisible', Threshold: 0, Statistic: 'Maximum' }));
  });
});
