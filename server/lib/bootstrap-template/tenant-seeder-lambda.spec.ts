/**
 * Sync guard test — ensures the TenantSeeder Lambda's inline COUNTRY_DEFAULTS
 * (sourced from @edforge/tenant-locale-defaults via synth-time JSON injection)
 * stays in sync with the entity's COUNTRY_DEFAULTS in identity service.
 *
 * Background:
 *   - server/lib/bootstrap-template/tenant-seeder-lambda.ts (CDK construct)
 *     imports COUNTRY_DEFAULTS from @edforge/tenant-locale-defaults and bakes
 *     it into the inline Lambda code at synth time.
 *   - server/application/microservices/identity/src/common/entities/
 *     workspace-settings.entity.ts owns its own copy of the same map (cannot
 *     import from a workspace package because the ECS Dockerfile uses a
 *     simple `npm install` pattern that doesn't resolve private packages).
 *
 * This test catches drift between the two by:
 *   1. Synthesizing the seeder Lambda construct → extracting the inline
 *      JSON literal from the rendered template.
 *   2. Comparing the merged-defaults output with the identity entity's.
 */

const fs = require('fs');
const path = require('path');
const { COUNTRY_DEFAULTS: ENTITY_DEFAULTS } = require('../../application/microservices/identity/src/common/entities/workspace-settings.entity');

/**
 * Extract the COUNTRY_DEFAULTS object literal from the rendered inline
 * Lambda code (i.e., the string that ends up inside `Code.fromInline`).
 *
 * We instantiate the construct in a synth context (`cdk.App` + minimal
 * stack), let it produce its inline code, then pluck the literal out.
 */
function extractInlineCountryDefaults() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cdk = require('aws-cdk-lib');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TenantSeederLambda } = require('./tenant-seeder-lambda');

  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  new TenantSeederLambda(stack, 'TestSeeder', {
    eventBusName: 'test-bus',
  });

  // The Lambda code is set via Code.fromInline; CDK exposes it via the
  // synthesized template as the ZipFile property of AWS::Lambda::Function.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Template } = require('aws-cdk-lib/assertions');
  const template = Template.fromStack(stack);
  const fns = template.findResources('AWS::Lambda::Function');
  const inline = (Object.values(fns) as Array<{ Properties?: { Code?: { ZipFile?: string } } }>)
    .map((r) => r.Properties && r.Properties.Code && r.Properties.Code.ZipFile)
    .find((v) => typeof v === 'string' && v.includes('COUNTRY_DEFAULTS'));

  if (!inline) {
    throw new Error('Could not find Lambda inline code with COUNTRY_DEFAULTS');
  }

  const startMarker = 'const COUNTRY_DEFAULTS = ';
  const startIdx = inline.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error('Could not locate COUNTRY_DEFAULTS literal in inline code');
  }
  const literalStart = startIdx + startMarker.length;

  let braceCount = 0;
  let endIdx = literalStart;
  let started = false;
  for (let i = literalStart; i < inline.length; i++) {
    const ch = inline[i];
    if (ch === '{') {
      braceCount++;
      started = true;
    } else if (ch === '}') {
      braceCount--;
      if (started && braceCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }

  const literal = inline.slice(literalStart, endIdx);
  // The literal is JSON-shaped (the seeder uses JSON.stringify); parse it.
  return JSON.parse(literal);
}

/**
 * Entity US_DEFAULTS baseline — must match the Lambda's US_DEFAULTS.
 * Both paths merge country overrides on top of US defaults, so we compare
 * the final merged output (not the raw Partial maps).
 */
const ENTITY_US_DEFAULTS = {
  defaultTimezone: 'America/New_York',
  defaultLocale: 'en-US',
  defaultDateFormat: 'MM/DD/YYYY',
  defaultTimeFormat: '12h',
  defaultWeekStartsOn: 'sunday',
  defaultCurrency: 'USD',
  defaultCalendarSystem: 'gregorian',
  enableDualDateDisplay: false,
  defaultNumberFormat: 'international',
};

describe('COUNTRY_DEFAULTS sync guard', () => {
  const lambdaDefaults = extractInlineCountryDefaults();

  it('should have the same country keys in both maps', () => {
    const lambdaKeys = Object.keys(lambdaDefaults).sort();
    const entityKeys = Object.keys(ENTITY_DEFAULTS).sort();
    expect(lambdaKeys).toEqual(entityKeys);
  });

  for (const countryCode of Object.keys(ENTITY_DEFAULTS)) {
    it(`should produce matching merged settings for ${countryCode}`, () => {
      // Lambda merges: { ...COUNTRY_DEFAULTS.USA, ...COUNTRY_DEFAULTS[country] }
      const lambdaMerged = { ...lambdaDefaults.USA, ...lambdaDefaults[countryCode] };
      // Entity merges: { ...US_DEFAULTS, ...COUNTRY_DEFAULTS[country] }
      const entityMerged = { ...ENTITY_US_DEFAULTS, ...ENTITY_DEFAULTS[countryCode] };

      const allKeys = new Set([
        ...Object.keys(lambdaMerged),
        ...Object.keys(entityMerged),
      ]);

      for (const key of allKeys) {
        expect({ country: countryCode, key, value: lambdaMerged[key] })
          .toEqual({ country: countryCode, key, value: entityMerged[key] });
      }
    });
  }
});
