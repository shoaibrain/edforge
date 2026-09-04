import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import type { IConstruct } from 'constructs';

/** Cost-redesign C0.4: the account carries at most this many billable alarms across all stacks. */
export const ALARM_BUDGET = 10;

export interface AlarmBudgetReport {
  total: number;
  perStack: Record<string, number>;
}

/** Count `AWS::CloudWatch::Alarm` resources under a construct tree, per stack. Synth-free: constructs exist once instantiated. */
export function countAlarms(root: IConstruct): AlarmBudgetReport {
  const perStack: Record<string, number> = {};
  for (const c of root.node.findAll()) {
    if (!(c instanceof cloudwatch.CfnAlarm)) continue;
    const stackName = c.node.path.split('/')[0];
    perStack[stackName] = (perStack[stackName] ?? 0) + 1;
  }
  return { total: Object.values(perStack).reduce((a, b) => a + b, 0), perStack };
}

/** Throws at synth time when the tree holds more alarms than the budget. */
export function assertAlarmBudget(root: IConstruct, budget = ALARM_BUDGET): AlarmBudgetReport {
  const report = countAlarms(root);
  if (report.total > budget) {
    const breakdown = Object.entries(report.perStack).map(([s, n]) => `${s}=${n}`).join(', ');
    throw new Error(`Alarm budget exceeded: ${report.total} alarms across stacks (${breakdown}); the budget is ${budget} (docs/architecture/cost-redesign/MIGRATION_PLAN.md C0.4). Consolidate with metric math or retire one.`);
  }
  return report;
}
