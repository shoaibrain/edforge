/**
 * EthnicityDescriptor catalog — Sprint GB3 (GB3.1).
 *
 * Closes the one Ed-Fi descriptor gap blocking a complete, compliant PABSON
 * CEHRD Flash I: the `caste_ethnicity` dimension. Each entry is a CEHRD
 * **band** (the value Flash I aggregates by); `aliases` route real-world Nepal
 * caste/ethnicity census names into the band.
 *
 * BANDS (6) preserve the existing analytics regex output exactly
 * (`report-aggregator/transforms.ts` pre-GB3.3): Brahmin/Chhetri, Janajati,
 * Madheshi, Dalit, Muslim, Other. The CEHRD reporting hierarchy is nested —
 * historical IEMIS Flash used 3 groups (Dalit / Janajati / Brahman-Chhetri &
 * others), the Flash I 2081 schema documents a 4-way enum
 * (`docs/pilot-greenlight/e1-flash-csv-schema.md:81`: Dalit, Janajati,
 * Brahmin/Chhetri, Others), and this catalog keeps the finer 6-way split.
 * Collapsing 6→4 or 6→3 (and the "Other"/"Others" spelling) is a **report-time
 * projection** in the Flash generator per the specific form year, NOT a change
 * here.
 *
 * ALIAS SOURCES (2026-06-04 research):
 *   - Hill/Madhesi Dalit membership — National Dalit Commission recognized list.
 *   - Janajati membership — NFDIN's 59 Adivasi Janajati (NEFIN), largest first
 *     (Magar, Tharu, Tamang, Newar, Rai, Gurung, Limbu per 2021 census).
 *   - Madhesi middle-caste membership — NPHC 2021 caste/ethnicity report
 *     (Yadav, Teli, Koiri/Kushwaha, Kurmi, Kanu, Hajam, Kalwar, Sudhi…).
 *   Census names + their common synonyms are aliased (e.g. Kami↔Bishwakarma,
 *   Damai↔Pariyar, Sarki↔Mijar, Gaine↔Gandharva, Koiri↔Kushwaha, Yadav↔Ahir).
 *
 * DELIBERATELY UNMAPPED (resolve to null → blank + collected warning, NEVER a
 * silent misclassification — a wrong caste band in a government report is real
 * harm). The liaison assigns these:
 *   - Madhesi high castes (Madhesi Brahmin, Rajput, Kayastha, Bhumihar) — band
 *     placement (Madheshi vs a Brahmin/Chhetri-equivalent) is a policy call.
 *   - Cross-band-ambiguous names (Lohar, Sonar, Dhanuk, Thakur) where the same
 *     token denotes different groups in Hill vs Madhes.
 *   - The 2021 census long tail (142 total groups) beyond those below.
 *   `TODO(cehrd-liaison)`: verify + extend against the official CEHRD social-
 *   group classification before the first live Flash I submission.
 *
 * URIs: `uri://ed-fi.org/EthnicityDescriptor#<Code>`. Catalog version: 1.1.0.
 */

import type { DescriptorCatalog } from './descriptor-types';

export const ETHNICITY_DESCRIPTOR_CATALOG: DescriptorCatalog = {
  type: 'EthnicityDescriptor',
  version: '1.1.0',
  entries: [
    {
      // Code is `Brahmin` (not `BrahminChhetri`) to preserve the existing
      // `#Brahmin` URI used in analytics fixtures; the band is Brahmin/Chhetri
      // (Khas Arya hill high castes).
      uri: 'uri://ed-fi.org/EthnicityDescriptor#Brahmin',
      code: 'Brahmin',
      displayName: { en: 'Brahmin/Chhetri', 'ne-NP': 'ब्राह्मण/क्षेत्री' },
      aliases: [
        'Brahmin/Chhetri',
        'Khas Arya',
        'Bahun',
        'Hill Brahmin',
        'Hill_Brahmin',
        'Brahman-Hill',
        'Chhetri',
        'Kshetri',
        'Chhettri',
        'Kshatriya',
        'Hill Chhetri',
        'Hill_Chhetri',
        'Thakuri',
        'Sanyasi',
        'Dasnami',
        'Sanyasi/Dasnami',
      ],
    },
    {
      // Adivasi Janajati (NFDIN 59 indigenous nationalities). Largest groups +
      // well-recognized hill/mountain/terai nationalities.
      uri: 'uri://ed-fi.org/EthnicityDescriptor#Janajati',
      code: 'Janajati',
      displayName: { en: 'Janajati', 'ne-NP': 'जनजाति' },
      aliases: [
        'Adivasi Janajati',
        'Adibasi Janajati',
        'Indigenous',
        'Hill Janajati',
        'Hill_Janajati',
        'Terai Janajati',
        'Tarai Janajati',
        'Magar',
        'Tharu',
        'Tamang',
        'Newar',
        'Newa',
        'Rai',
        'Gurung',
        'Tamu',
        'Limbu',
        'Subba',
        'Sherpa',
        'Sunuwar',
        'Yakkha',
        'Chepang',
        'Thakali',
        'Bhote',
        'Dhimal',
        'Rajbanshi',
        'Santhal',
        'Satar',
        'Gangai',
        'Tajpuriya',
        'Kumal',
        'Majhi',
        'Danuwar',
        'Darai',
        'Bote',
        'Pahari',
        'Hyolmo',
        'Yolmo',
        'Thami',
        'Thangmi',
        'Bhujel',
        'Jirel',
        'Lepcha',
        'Chhantyal',
      ],
    },
    {
      // Madhesi caste groups (Terai-origin middle/backward castes). High Madhesi
      // castes (Brahmin/Rajput/Kayastha/Bhumihar) are intentionally NOT here —
      // see header (liaison-assigned).
      uri: 'uri://ed-fi.org/EthnicityDescriptor#Madheshi',
      code: 'Madheshi',
      displayName: { en: 'Madheshi', 'ne-NP': 'मधेशी' },
      aliases: [
        'Madhesi',
        'Madhesi Other Caste',
        'Yadav',
        'Ahir',
        'Teli',
        'Koiri',
        'Kushwaha',
        'Kurmi',
        'Kanu',
        'Hajam',
        'Kalwar',
        'Sudhi',
        'Baniya',
        'Halwai',
        'Kewat',
        'Mallah',
        'Rajbhar',
        'Nuniya',
        'Mali',
        'Kahar',
        'Kewarat',
      ],
    },
    {
      // Dalit (formerly "untouchable") — National Dalit Commission list.
      uri: 'uri://ed-fi.org/EthnicityDescriptor#Dalit',
      code: 'Dalit',
      displayName: { en: 'Dalit', 'ne-NP': 'दलित' },
      aliases: [
        'Hill Dalit',
        'Hill_Dalit',
        'Madhesi Dalit',
        'Terai Dalit',
        'Tarai Dalit',
        // Hill Dalit
        'Kami',
        'Bishwakarma',
        'Bishwokarma',
        'B.K.',
        'Damai',
        'Pariyar',
        'Dholi',
        'Sarki',
        'Mijar',
        'Charmakar',
        'Gaine',
        'Gandharva',
        'Badi',
        // Madhesi Dalit
        'Chamar',
        'Harijan',
        'Ram',
        'Mochi',
        'Musahar',
        'Sada',
        'Dusadh',
        'Paswan',
        'Pasi',
        'Tatma',
        'Khatwe',
        'Dhobi',
        'Dom',
        'Bantar',
        'Halkhor',
        'Halalkor',
        'Khatik',
        'Kori',
        'Chidimar',
        'Pattharkatta',
      ],
    },
    {
      uri: 'uri://ed-fi.org/EthnicityDescriptor#Muslim',
      code: 'Muslim',
      displayName: { en: 'Muslim', 'ne-NP': 'मुसलमान' },
      aliases: ['Musalman', 'Mussalman', 'Miya', 'Islam', 'Churaute'],
    },
    {
      uri: 'uri://ed-fi.org/EthnicityDescriptor#Other',
      code: 'Other',
      displayName: { en: 'Other', 'ne-NP': 'अन्य' },
      aliases: ['Others', 'Miscellaneous', 'Marwadi', 'Marwari', 'Bangali', 'Bengali', 'Jain', 'Sikh', 'Punjabi', 'Foreigner'],
    },
  ],
};
