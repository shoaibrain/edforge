import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { assertAlarmBudget, countAlarms } from './alarm-budget';

const alarm = (scope: cdk.Stack, id: string) =>
  new cloudwatch.Alarm(scope, id, { metric: new cloudwatch.Metric({ namespace: 'T', metricName: 'm' }), threshold: 1, evaluationPeriods: 1 });

describe('alarm budget (C3.4 / C0.4)', () => {
  it('counts alarms per stack across the app without synthesizing', () => {
    const app = new cdk.App();
    const a = new cdk.Stack(app, 'a'); const b = new cdk.Stack(app, 'b');
    alarm(a, 'x'); alarm(a, 'y'); alarm(b, 'z');
    expect(countAlarms(app)).toEqual({ total: 3, perStack: { a: 2, b: 1 } });
    expect(assertAlarmBudget(app, 3).total).toBe(3);
  });

  it('throws with the per-stack breakdown when the budget is exceeded', () => {
    const app = new cdk.App();
    const a = new cdk.Stack(app, 'a');
    for (let i = 0; i < 4; i++) alarm(a, `x${i}`);
    expect(() => assertAlarmBudget(app, 3)).toThrow(/4 alarms across stacks \(a=4\); the budget is 3/);
  });
});
