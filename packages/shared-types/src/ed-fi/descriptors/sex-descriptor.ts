/**
 * SexDescriptor catalog — Sprint 2 (S2.4).
 *
 * Ed-Fi 5.x SexDescriptor values: `Male`, `Female`, `Other`, `Not Selected`.
 * CEHRD / IEMIS Flash I maps to three values (Male / Female / Other). Aliases
 * cover:
 *   - IEMIS/CEHRD shortcodes (`M`, `F`)
 *   - Devanagari script variants
 *   - Case variants handled by the resolver (all alias lookups are
 *     case-insensitive, so we don't enumerate `male`/`MALE` here).
 *
 * Catalog version: 1.0.0.
 */

import type { DescriptorCatalog } from './descriptor-types';

export const SEX_DESCRIPTOR_CATALOG: DescriptorCatalog = {
  type: 'SexDescriptor',
  version: '1.0.0',
  entries: [
    {
      uri: 'uri://ed-fi.org/SexDescriptor#Male',
      code: 'Male',
      codeShort: 'M',
      displayName: { en: 'Male', 'ne-NP': 'पुरुष' },
      aliases: ['M', 'Boy', 'पुरुष', 'पु'],
    },
    {
      uri: 'uri://ed-fi.org/SexDescriptor#Female',
      code: 'Female',
      codeShort: 'F',
      displayName: { en: 'Female', 'ne-NP': 'महिला' },
      aliases: ['F', 'Girl', 'महिला', 'म'],
    },
    {
      uri: 'uri://ed-fi.org/SexDescriptor#Other',
      code: 'Other',
      codeShort: 'O',
      displayName: { en: 'Other', 'ne-NP': 'अन्य' },
      aliases: ['O', 'Third Gender', 'अन्य'],
    },
  ],
};
