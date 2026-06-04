/**
 * GB0.2b — `complianceRequiredDescriptors` is first-class archetype table data
 * (no longer hand-supplied at the aggregator). PABSON carries the CEHRD Flash I
 * descriptor set; GENERIC carries none; the schema validates the field against
 * the canonical descriptor-type enum.
 */

import { ARCHETYPE_DEFAULTS_TABLE } from './archetype-defaults';
import { archetypeDefaultsSchema } from '../schemas/archetype-defaults.schema';
import { descriptorTypeNameSchema } from '../ed-fi/descriptors/descriptor-types';

describe('GB0.2b complianceRequiredDescriptors — first-class archetype data', () => {
  it('PABSON requires the full CEHRD Flash I descriptor set incl. EthnicityDescriptor (GB3.5)', () => {
    const pabson = ARCHETYPE_DEFAULTS_TABLE.PABSON.complianceRequiredDescriptors;
    for (const d of [
      'GradeLevelDescriptor',
      'SexDescriptor',
      'LanguageDescriptor',
      'DisabilityDescriptor',
      'ExitWithdrawTypeDescriptor',
      'EthnicityDescriptor',
    ] as const) {
      expect(pabson).toContain(d);
    }
    // Exact set — locks against a spurious added descriptor (the 6 above + length).
    expect(pabson).toHaveLength(6);
    // Every entry is a valid descriptor type name; catalog-presence is GB0.5.
    for (const d of pabson) {
      expect(descriptorTypeNameSchema.options as readonly string[]).toContain(d);
    }
    // GB3.1 registered the EthnicityDescriptor type + catalog.
    expect(descriptorTypeNameSchema.options as readonly string[]).toContain('EthnicityDescriptor');
  });

  it('GENERIC requires no compliance descriptors', () => {
    expect(ARCHETYPE_DEFAULTS_TABLE.GENERIC.complianceRequiredDescriptors).toEqual([]);
  });

  it('the schema accepts the real table rows and rejects a non-descriptor value', () => {
    expect(() => archetypeDefaultsSchema.parse(ARCHETYPE_DEFAULTS_TABLE.PABSON)).not.toThrow();
    expect(() => archetypeDefaultsSchema.parse(ARCHETYPE_DEFAULTS_TABLE.GENERIC)).not.toThrow();
    const bad = {
      ...ARCHETYPE_DEFAULTS_TABLE.PABSON,
      complianceRequiredDescriptors: ['NotARealDescriptor'],
    };
    expect(() => archetypeDefaultsSchema.parse(bad)).toThrow();
  });
});
