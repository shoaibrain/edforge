/**
 * LanguageDescriptor catalog — Sprint 2 (S2.2).
 *
 * Covers Nepali + major recognized minority languages per the Nepal Constitution
 * (Schedule 6) and IEMIS Flash I demographics. Aliases include:
 *   - English spelling variants observed in real Saraswati IEMIS xlsx
 *     (e.g. `Maithali` — common misspelling of Maithili; 386 students)
 *   - Devanagari native-script names (so the resolver accepts either script)
 *
 * Angika is included despite being absent from the original plan list because
 * a real Saraswati student row carries it (Madhes Province). CEHRD recognizes
 * it as a distinct language.
 *
 * URIs follow Ed-Fi 5.x: `uri://ed-fi.org/LanguageDescriptor#<Code>`.
 *
 * Catalog version: 1.0.0 (initial seed). Bump minor when entries are added,
 * major when any existing URI/code is renamed (breaking consumers).
 */

import type { DescriptorCatalog } from './descriptor-types';

export const LANGUAGE_DESCRIPTOR_CATALOG: DescriptorCatalog = {
  type: 'LanguageDescriptor',
  version: '1.0.0',
  entries: [
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Nepali',
      code: 'Nepali',
      displayName: { en: 'Nepali', 'ne-NP': 'नेपाली' },
      aliases: ['nep', 'नेपाली'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Maithili',
      code: 'Maithili',
      displayName: { en: 'Maithili', 'ne-NP': 'मैथिली' },
      // "Maithali" is a common misspelling observed in live Saraswati rows.
      aliases: ['Maithali', 'Maithil', 'मैथिली'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Bhojpuri',
      code: 'Bhojpuri',
      displayName: { en: 'Bhojpuri', 'ne-NP': 'भोजपुरी' },
      aliases: ['भोजपुरी'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Tharu',
      code: 'Tharu',
      displayName: { en: 'Tharu', 'ne-NP': 'थारू' },
      aliases: ['थारू'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Tamang',
      code: 'Tamang',
      displayName: { en: 'Tamang', 'ne-NP': 'तामाङ' },
      aliases: ['तामाङ'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Newar',
      code: 'Newar',
      displayName: { en: 'Newar', 'ne-NP': 'नेवार' },
      aliases: ['Newari', 'Nepal Bhasa', 'नेवार', 'नेपाल भाषा'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Bajjika',
      code: 'Bajjika',
      displayName: { en: 'Bajjika', 'ne-NP': 'बज्जिका' },
      aliases: ['बज्जिका'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Magar',
      code: 'Magar',
      displayName: { en: 'Magar', 'ne-NP': 'मगर' },
      aliases: ['Magar Dhut', 'मगर'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Doteli',
      code: 'Doteli',
      displayName: { en: 'Doteli', 'ne-NP': 'डोटेली' },
      aliases: ['डोटेली'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Urdu',
      code: 'Urdu',
      displayName: { en: 'Urdu', 'ne-NP': 'उर्दू' },
      aliases: ['उर्दू'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Awadhi',
      code: 'Awadhi',
      displayName: { en: 'Awadhi', 'ne-NP': 'अवधी' },
      aliases: ['अवधी'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Limbu',
      code: 'Limbu',
      displayName: { en: 'Limbu', 'ne-NP': 'लिम्बू' },
      aliases: ['लिम्बू'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Gurung',
      code: 'Gurung',
      displayName: { en: 'Gurung', 'ne-NP': 'गुरुङ' },
      aliases: ['Tamu', 'गुरुङ'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#English',
      code: 'English',
      displayName: { en: 'English', 'ne-NP': 'अंग्रेजी' },
      aliases: ['eng', 'अंग्रेजी'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Sanskrit',
      code: 'Sanskrit',
      displayName: { en: 'Sanskrit', 'ne-NP': 'संस्कृत' },
      aliases: ['संस्कृत'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Hindi',
      code: 'Hindi',
      displayName: { en: 'Hindi', 'ne-NP': 'हिन्दी' },
      aliases: ['हिन्दी', 'हिंदी'],
    },
    {
      uri: 'uri://ed-fi.org/LanguageDescriptor#Angika',
      code: 'Angika',
      displayName: { en: 'Angika', 'ne-NP': 'अङ्गिका' },
      // Observed on 1 Saraswati student row (Madhes Province heritage language).
      aliases: ['अङ्गिका', 'अंगिका'],
    },
  ],
};
