/**
 * Sync guard test: ensures COUNTRY_DEFAULTS in the TenantSeeder Lambda
 * inline code stays in sync with COUNTRY_DEFAULTS in workspace-settings.entity.ts.
 *
 * The Lambda code is inline (string literal) and cannot import the entity directly,
 * so we parse the Lambda source file and compare both maps.
 */

const fs = require('fs');
const path = require('path');
const { COUNTRY_DEFAULTS } = require('../../application/microservices/identity/src/common/entities/workspace-settings.entity');

/**
 * Extract the COUNTRY_DEFAULTS object from the Lambda source file by
 * isolating the block between `const COUNTRY_DEFAULTS = {` and `};`
 * then evaluating it.
 */
function parseLambdaCountryDefaults() {
  const sourceFile = path.join(__dirname, 'tenant-seeder-lambda.ts');
  const source = fs.readFileSync(sourceFile, 'utf8');

  // Find the COUNTRY_DEFAULTS block in the inline code string
  const startMarker = 'const COUNTRY_DEFAULTS = {';
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error('Could not find COUNTRY_DEFAULTS in tenant-seeder-lambda.ts');
  }

  // Find the matching closing brace by counting braces
  let braceCount = 0;
  let endIdx = startIdx + startMarker.length - 1; // point at the opening {
  for (let i = endIdx; i < source.length; i++) {
    if (source[i] === '{') braceCount++;
    if (source[i] === '}') braceCount--;
    if (braceCount === 0) {
      endIdx = i + 1;
      break;
    }
  }

  const block = source.slice(startIdx, endIdx);
  // Convert to evaluable JS: strip the `const` declaration, wrap in parens
  const objLiteral = block.replace('const COUNTRY_DEFAULTS = ', '');

  // Use Function constructor to safely evaluate the object literal
  const fn = new Function(`return (${objLiteral})`);
  return fn();
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
  const lambdaDefaults = parseLambdaCountryDefaults();
  const entityDefaults = COUNTRY_DEFAULTS;

  it('should have the same country keys in both maps', () => {
    const lambdaKeys = Object.keys(lambdaDefaults).sort();
    const entityKeys = Object.keys(entityDefaults).sort();
    expect(lambdaKeys).toEqual(entityKeys);
  });

  // Compare merged results for each country (entity uses Partial, so merge over US_DEFAULTS)
  for (const countryCode of Object.keys(entityDefaults)) {
    it(`should produce matching merged settings for ${countryCode}`, () => {
      // Lambda merges: { ...COUNTRY_DEFAULTS.USA, ...COUNTRY_DEFAULTS[country] }
      const lambdaMerged = { ...lambdaDefaults.USA, ...lambdaDefaults[countryCode] };
      // Entity merges: { ...US_DEFAULTS, ...COUNTRY_DEFAULTS[country] }
      const entityMerged = { ...ENTITY_US_DEFAULTS, ...entityDefaults[countryCode] };

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
