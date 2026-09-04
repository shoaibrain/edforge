import { currentRuntime, isLambdaRuntime } from './runtime';

describe('runtime detection (C1.2)', () => {
  it('defaults to http when EDFORGE_RUNTIME is unset', () => {
    expect(currentRuntime({})).toBe('http');
    expect(isLambdaRuntime({})).toBe(false);
  });

  it.each(['lambda', 'LAMBDA', ' lambda '])('is lambda for %j', (v) => {
    expect(currentRuntime({ EDFORGE_RUNTIME: v })).toBe('lambda');
    expect(isLambdaRuntime({ EDFORGE_RUNTIME: v })).toBe(true);
  });

  it.each(['http', 'ecs', '', 'true', 'aws-lambda'])('is http for %j', (v) => {
    expect(currentRuntime({ EDFORGE_RUNTIME: v })).toBe('http');
  });

  it('reads process.env by default', () => {
    const before = process.env.EDFORGE_RUNTIME;
    process.env.EDFORGE_RUNTIME = 'lambda';
    try {
      expect(isLambdaRuntime()).toBe(true);
    } finally {
      if (before === undefined) delete process.env.EDFORGE_RUNTIME;
      else process.env.EDFORGE_RUNTIME = before;
    }
  });
});
