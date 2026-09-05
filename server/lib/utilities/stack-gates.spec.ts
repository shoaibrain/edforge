import { ADVANCED_TEMPLATE_FLAG, shouldSynthesizeAdvancedTemplate } from './stack-gates';

describe('shouldSynthesizeAdvancedTemplate (C0.1)', () => {
  it('is off when the flag is absent', () => {
    expect(shouldSynthesizeAdvancedTemplate({})).toBe(false);
  });

  it.each(['false', 'FALSE', '', ' ', '0', 'yes', 'on'])(
    'is off for %j',
    (value) => {
      expect(shouldSynthesizeAdvancedTemplate({ [ADVANCED_TEMPLATE_FLAG]: value })).toBe(false);
    },
  );

  it.each(['true', 'TRUE', ' true '])('is on for %j', (value) => {
    expect(shouldSynthesizeAdvancedTemplate({ [ADVANCED_TEMPLATE_FLAG]: value })).toBe(true);
  });

  it('ignores unrelated advanced-tier flags', () => {
    expect(
      shouldSynthesizeAdvancedTemplate({ CDK_PARAM_USE_EC2_ADVANCED: 'true', CDK_ADV_CLUSTER: 'ACTIVE' }),
    ).toBe(false);
  });
});

describe('shouldSynthesizeSbtScriptJobs (C7.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { shouldSynthesizeSbtScriptJobs, SBT_SCRIPT_JOBS_FLAG } = require('./stack-gates');
  it('is off unless the flag is exactly true', () => {
    expect(shouldSynthesizeSbtScriptJobs({})).toBe(false);
    expect(shouldSynthesizeSbtScriptJobs({ [SBT_SCRIPT_JOBS_FLAG]: 'false' })).toBe(false);
    expect(shouldSynthesizeSbtScriptJobs({ [SBT_SCRIPT_JOBS_FLAG]: ' TRUE ' })).toBe(true);
  });
});
