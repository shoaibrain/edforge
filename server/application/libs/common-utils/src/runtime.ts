/**
 * Where the service process is running.
 *
 * `http`   — a long-lived process serving its own HTTP listener (ECS task,
 *            `nest start`, docker compose). Background timers are allowed.
 * `lambda` — a request-scoped execution environment behind API Gateway or an
 *            event source. The environment is frozen between invocations, so
 *            anything that relies on wall-clock timers (setInterval, delayed
 *            setTimeout) must not start; the cost-redesign moves that work to
 *            EventBridge Scheduler and SQS workers.
 *
 * Selected by `EDFORGE_RUNTIME`; anything but the literal `lambda` is `http`,
 * so existing deployments and local runs are unaffected.
 */
export type AppRuntime = 'http' | 'lambda';

export const EDFORGE_RUNTIME_ENV = 'EDFORGE_RUNTIME';

export function currentRuntime(env: NodeJS.ProcessEnv = process.env): AppRuntime {
  return (env[EDFORGE_RUNTIME_ENV] ?? '').trim().toLowerCase() === 'lambda' ? 'lambda' : 'http';
}

export function isLambdaRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return currentRuntime(env) === 'lambda';
}
