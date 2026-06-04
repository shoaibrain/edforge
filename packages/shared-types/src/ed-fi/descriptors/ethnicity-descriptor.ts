/**
 * EthnicityDescriptor catalog — Sprint GB3 (GB3.1).
 *
 * Closes the one Ed-Fi descriptor gap blocking a complete, compliant PABSON
 * CEHRD Flash I: the `caste_ethnicity` dimension. Each entry is a CEHRD
 * **band** (the value Flash I aggregates by); `aliases` route real-world Nepal
 * caste/ethnicity tokens into the band.
 *
 * Bands (6) preserve the existing analytics regex output exactly
 * (`report-aggregator/transforms.ts` pre-GB3.3) so GB3.3 is a behavior-
 * preserving refactor: Brahmin/Chhetri, Janajati, Madheshi, Dalit, Muslim, Other.
 *
 * ⚠️ Banding-grouping is a CEHRD-liaison decision, flagged not assumed:
 *   - The Flash I 2081 report's `caste_ethnicity` enum is documented as a 4-way
 *     grouping (Dalit, Janajati, Brahmin/Chhetri, Others) in
 *     `docs/pilot-greenlight/e1-flash-csv-schema.md:81`. This catalog keeps the
 *     finer 6-band split (Madheshi, Muslim distinct) to match current code; if
 *     CEHRD requires the 4-way collapse (Madheshi/Muslim → Others) and/or the
 *     plural "Others" spelling, that is a report-time projection in the Flash I
 *     generator, NOT a change here — revisit with the liaison.
 *   - The `aliases` below are a seeded, well-established subset. The Nepal caste
 *     long tail is large; unmapped values resolve to `null` (→ blank + a
 *     collected warning at the import/transform boundary), NEVER a silent
 *     misclassification. The liaison extends the alias map over time.
 *     `TODO(cehrd-liaison)`: verify + extend the caste→band aliases against the
 *     official CEHRD social-group classification.
 *
 * URIs: `uri://ed-fi.org/EthnicityDescriptor#<Code>`. Catalog version: 1.0.0.
 */

import type { DescriptorCatalog } from './descriptor-types';

export const ETHNICITY_DESCRIPTOR_CATALOG: DescriptorCatalog = {
  type: 'EthnicityDescriptor',
  version: '1.0.0',
  entries: [
    {
      // Code is `Brahmin` (not `BrahminChhetri`) to preserve the existing
      // `#Brahmin` URI used in analytics fixtures; the band is Brahmin/Chhetri.
      uri: 'uri://ed-fi.org/EthnicityDescriptor#Brahmin',
      code: 'Brahmin',
      displayName: { en: 'Brahmin/Chhetri', 'ne-NP': 'ब्राह्मण/क्षेत्री' },
      aliases: [
        'Brahmin/Chhetri',
        'Bahun',
        'Chhetri',
        'Kshetri',
        'Kshatriya',
        'Thakuri',
        'Sanyasi',
        'Dasnami',
        'Hill_Brahmin',
        'Hill Brahmin',
        'Hill_Chhetri',
        'Hill Chhetri',
        'Tarai_Brahmin',
        'Terai Brahmin',
      ],
    },
    {
      uri: 'uri://ed-fi.org/EthnicityDescriptor#Janajati',
      code: 'Janajati',
      displayName: { en: 'Janajati', 'ne-NP': 'जनजाति' },
      aliases: [
        'Adivasi Janajati',
        'Adibasi Janajati',
        'Indigenous',
        'Hill_Janajati',
        'Hill Janajati',
        'Tarai_Janajati',
        'Terai Janajati',
        'Newar',
        'Magar',
        'Tamang',
        'Rai',
        'Limbu',
        'Gurung',
        'Sherpa',
      ],
    },
    {
      uri: 'uri://ed-fi.org/EthnicityDescriptor#Madheshi',
      code: 'Madheshi',
      displayName: { en: 'Madheshi', 'ne-NP': 'मधेशी' },
      aliases: [
        'Madhesi',
        'Madheshi Other Caste',
        'Tarai_Madheshi',
        'Terai Madheshi',
        'Yadav',
        'Teli',
        'Koiri',
        'Kurmi',
      ],
    },
    {
      uri: 'uri://ed-fi.org/EthnicityDescriptor#Dalit',
      code: 'Dalit',
      displayName: { en: 'Dalit', 'ne-NP': 'दलित' },
      aliases: [
        'Hill_Dalit',
        'Hill Dalit',
        'Tarai_Dalit',
        'Terai Dalit',
        'Kami',
        'Damai',
        'Sarki',
        'Bishwakarma',
        'Pariyar',
        'Sunar',
        'Lohar',
        'Chamar',
        'Musahar',
        'Dom',
      ],
    },
    {
      uri: 'uri://ed-fi.org/EthnicityDescriptor#Muslim',
      code: 'Muslim',
      displayName: { en: 'Muslim', 'ne-NP': 'मुसलमान' },
      aliases: ['Musalman', 'Mussalman', 'Miya', 'Islam'],
    },
    {
      uri: 'uri://ed-fi.org/EthnicityDescriptor#Other',
      code: 'Other',
      displayName: { en: 'Other', 'ne-NP': 'अन्य' },
      aliases: ['Others', 'Miscellaneous', 'Marwadi', 'Marwari', 'Bangali', 'Bengali', 'Jain', 'Sikh', 'Foreigner'],
    },
  ],
};
