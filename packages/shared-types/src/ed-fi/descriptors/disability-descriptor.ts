/**
 * DisabilityDescriptor catalog — Sprint 2 (S2.3).
 *
 * Eight CEHRD disability categories per Nepal IEMIS Flash I + the explicit
 * `NoDisability` entry that matches the 607 Saraswati rows carrying that
 * literal value. Note that 171 Saraswati rows carry `null` for Disability
 * Type and 1 carries `N/A` — the resolver interprets those as alias of
 * `NoDisability` via alias `N/A`, while `null`/`undefined` input returns
 * `null` (missing, not "no disability").
 *
 * URIs: `uri://ed-fi.org/DisabilityDescriptor#<Code>`.
 *
 * Catalog version: 1.0.0.
 */

import type { DescriptorCatalog } from './descriptor-types';

export const DISABILITY_DESCRIPTOR_CATALOG: DescriptorCatalog = {
  type: 'DisabilityDescriptor',
  version: '1.0.0',
  entries: [
    {
      uri: 'uri://ed-fi.org/DisabilityDescriptor#NoDisability',
      code: 'NoDisability',
      codeShort: 'NONE',
      displayName: { en: 'No Disability', 'ne-NP': 'अपांगता छैन' },
      aliases: ['No Disability', 'None', 'N/A', 'अपांगता छैन'],
    },
    {
      uri: 'uri://ed-fi.org/DisabilityDescriptor#Physical',
      code: 'Physical',
      codeShort: 'DD-01',
      displayName: { en: 'Physical Disability', 'ne-NP': 'शारीरिक अपांगता' },
      aliases: ['Physical Disability', 'Motor', 'शारीरिक', 'शारीरिक अपांगता'],
    },
    {
      uri: 'uri://ed-fi.org/DisabilityDescriptor#Vision',
      code: 'Vision',
      codeShort: 'DD-02',
      displayName: { en: 'Vision Impairment', 'ne-NP': 'दृष्टिविहीन' },
      aliases: ['Blind', 'Visual', 'Visual Impairment', 'Vision Impairment', 'दृष्टिविहीन', 'दृष्टि'],
    },
    {
      uri: 'uri://ed-fi.org/DisabilityDescriptor#Hearing',
      code: 'Hearing',
      codeShort: 'DD-03',
      displayName: { en: 'Hearing Impairment', 'ne-NP': 'श्रवणविहीन' },
      aliases: ['Deaf', 'Hearing Impairment', 'Hearing Impaired', 'श्रवणविहीन', 'श्रवण'],
    },
    {
      uri: 'uri://ed-fi.org/DisabilityDescriptor#DeafBlind',
      code: 'DeafBlind',
      codeShort: 'DD-04',
      displayName: { en: 'Deaf-Blind', 'ne-NP': 'दृष्टि र श्रवण दुवै' },
      aliases: ['Deaf-Blind', 'Deaf Blind', 'DeafBlindness', 'दृष्टि र श्रवण दुवै'],
    },
    {
      uri: 'uri://ed-fi.org/DisabilityDescriptor#Speech',
      code: 'Speech',
      codeShort: 'DD-05',
      displayName: { en: 'Speech Impairment', 'ne-NP': 'बोलीसम्बन्धी' },
      aliases: ['Mute', 'Speech Impairment', 'Speech Impaired', 'बोलीसम्बन्धी', 'बोली'],
    },
    {
      uri: 'uri://ed-fi.org/DisabilityDescriptor#Intellectual',
      code: 'Intellectual',
      codeShort: 'DD-06',
      displayName: { en: 'Intellectual Disability', 'ne-NP': 'बौद्धिक अपांगता' },
      aliases: ['Intellectual Disability', 'Cognitive', 'बौद्धिक', 'बौद्धिक अपांगता'],
    },
    {
      uri: 'uri://ed-fi.org/DisabilityDescriptor#Autism',
      code: 'Autism',
      codeShort: 'DD-07',
      displayName: { en: 'Autism Spectrum', 'ne-NP': 'अटिजम' },
      aliases: ['ASD', 'Autism Spectrum', 'Autism Spectrum Disorder', 'अटिजम'],
    },
    {
      uri: 'uri://ed-fi.org/DisabilityDescriptor#Multiple',
      code: 'Multiple',
      codeShort: 'DD-08',
      displayName: { en: 'Multiple Disabilities', 'ne-NP': 'बहुअपांगता' },
      aliases: ['Multiple Disabilities', 'Multi', 'बहुअपांगता', 'बहु अपांगता'],
    },
  ],
};
