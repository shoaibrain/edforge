import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { FinanceSchedules, FunctionsErrorsAlarm, scheduledFunctionEnvironment, workerFunctionEnvironment, apiFunctionEnvironment } from './finance-schedules';

function synth(enabled: boolean, paymentSweepEnabled?: boolean) {
  const stack = new cdk.Stack(new cdk.App(), 'T', { env: { account: '111111111111', region: 'ap-south-1' } });
  const fn = new lambda.Function(stack, 'Fn', { runtime: lambda.Runtime.NODEJS_22_X, handler: 'index.scheduledHandler', code: lambda.Code.fromInline('x') });
  new FinanceSchedules(stack, 'S', { fn, enabled, paymentSweepEnabled });
  return Template.fromStack(stack);
}

describe('FinanceSchedules (C3.4)', () => {
  it('creates the four schedules with their cron, Kathmandu time zone and the job input carrying the scheduled-time attribute', () => {
    const t = synth(true);
    t.resourceCountIs('AWS::Scheduler::Schedule', 4);
    for (const [job, cron] of [['recurring-billing', 'cron(30 1 * * ? *)'], ['overdue-detection', 'cron(0 * * * ? *)'], ['billing-reconciliation', 'cron(30 * * * ? *)'], ['payment-sweep', 'cron(*/30 * * * ? *)']]) {
      t.hasResourceProperties('AWS::Scheduler::Schedule', Match.objectLike({
        ScheduleExpression: cron, ScheduleExpressionTimezone: 'Asia/Kathmandu',
        Target: Match.objectLike({ Input: `{"job":"${job}","scheduledTime":"<aws.scheduler.scheduled-time>"}` }),
      }));
    }
  });

  it('ships every schedule DISABLED until enabled; the payment sweep stays disabled even then', () => {
    const off = synth(false);
    expect(Object.values(off.findResources('AWS::Scheduler::Schedule')).every((r) => r.Properties.State === 'DISABLED')).toBe(true);
    const on = synth(true);
    const states = Object.values(on.findResources('AWS::Scheduler::Schedule')).map((r) => [JSON.parse(r.Properties.Target.Input).job, r.Properties.State]);
    expect(Object.fromEntries(states)).toEqual({ 'recurring-billing': 'ENABLED', 'overdue-detection': 'ENABLED', 'billing-reconciliation': 'ENABLED', 'payment-sweep': 'DISABLED' });
    expect(Object.fromEntries(Object.values(synth(true, true).findResources('AWS::Scheduler::Schedule')).map((r) => [JSON.parse(r.Properties.Target.Input).job, r.Properties.State]))['payment-sweep']).toBe('ENABLED');
  });
});

describe('FunctionsErrorsAlarm (C3.4)', () => {
  it('is one alarm summing FILL(errors, 0) across the given functions', () => {
    const stack = new cdk.Stack(new cdk.App(), 'T', { env: { account: '111111111111', region: 'ap-south-1' } });
    const mk = (id: string) => new lambda.Function(stack, id, { runtime: lambda.Runtime.NODEJS_22_X, handler: 'i.h', code: lambda.Code.fromInline('x') });
    new FunctionsErrorsAlarm(stack, 'A', { alarmName: 'edforge-finance-functions-errors-basic', description: 'd', functions: { api: mk('Api'), scheduled: mk('Sched') } });
    const t = Template.fromStack(stack);
    t.resourceCountIs('AWS::CloudWatch::Alarm', 1);
    t.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({
      AlarmName: 'edforge-finance-functions-errors-basic', Threshold: 0, EvaluationPeriods: 1, TreatMissingData: 'notBreaching',
      Metrics: Match.arrayWith([Match.objectLike({ Expression: 'FILL(api, 0) + FILL(scheduled, 0)' })]),
    }));
  });
});

describe('function environments vs the task definition (C3.5)', () => {
  it('the scheduled function runs the three timers even when ECS has them off; the sweep flag is untouched', () => {
    const env = { TABLE_NAME: 't', DISABLE_RECURRING_BILLING: 'true', DISABLE_OVERDUE_DETECTION: 'true', DISABLE_BILLING_RECONCILIATION: 'true', DISABLE_PAYMENT_SWEEP: 'true', JOBS_TRANSPORT: 'sqs' };
    expect(scheduledFunctionEnvironment(env)).toEqual({ ...env, DISABLE_RECURRING_BILLING: 'false', DISABLE_OVERDUE_DETECTION: 'false', DISABLE_BILLING_RECONCILIATION: 'false' });
  });
  it('a worker function always uses the queue transport', () => {
    expect(workerFunctionEnvironment({ JOBS_TRANSPORT: 'inline', X: '1' })).toEqual({ JOBS_TRANSPORT: 'sqs', X: '1' });
  });
  it('an API function follows the task definition unless the canary override puts a dispatching service on the queue', () => {
    expect(apiFunctionEnvironment({ JOBS_TRANSPORT: 'inline', X: '1' })).toEqual({ JOBS_TRANSPORT: 'inline', X: '1' });
    expect(apiFunctionEnvironment({ JOBS_TRANSPORT: 'inline', X: '1' }, 'sqs')).toEqual({ JOBS_TRANSPORT: 'sqs', X: '1' });
    expect(apiFunctionEnvironment({ X: '1' }, 'sqs')).toEqual({ X: '1' });
  });
});
