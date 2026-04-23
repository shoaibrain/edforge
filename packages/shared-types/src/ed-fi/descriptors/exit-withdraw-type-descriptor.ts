/**
 * ExitWithdrawTypeDescriptor catalog — Sprint 2 (S2.6).
 *
 * Ed-Fi canonical exit/withdraw reasons aligned with IEMIS Flash I dropout /
 * transfer / graduation reporting codes.
 *
 * CEHRD tracks dropout reason at the student level; Flash I aggregates to
 * per-grade counts. The resolver returns canonical Ed-Fi URIs; downstream
 * exporters translate to the Flash I cell buckets.
 *
 * URIs: `uri://ed-fi.org/ExitWithdrawTypeDescriptor#<Code>`.
 *
 * Catalog version: 1.0.0.
 */

import type { DescriptorCatalog } from './descriptor-types';

export const EXIT_WITHDRAW_TYPE_DESCRIPTOR_CATALOG: DescriptorCatalog = {
  type: 'ExitWithdrawTypeDescriptor',
  version: '1.0.0',
  entries: [
    {
      uri: 'uri://ed-fi.org/ExitWithdrawTypeDescriptor#Graduated',
      code: 'Graduated',
      codeShort: 'GR',
      displayName: { en: 'Graduated', 'ne-NP': 'उत्तीर्ण' },
      aliases: ['Passed', 'Completed', 'उत्तीर्ण'],
    },
    {
      uri: 'uri://ed-fi.org/ExitWithdrawTypeDescriptor#TransferredToOtherSchool',
      code: 'TransferredToOtherSchool',
      codeShort: 'TR',
      displayName: { en: 'Transferred to Other School', 'ne-NP': 'अर्को विद्यालयमा सरुवा' },
      aliases: ['Transferred', 'Transfer', 'अर्को विद्यालयमा सरुवा'],
    },
    {
      uri: 'uri://ed-fi.org/ExitWithdrawTypeDescriptor#DroppedOut',
      code: 'DroppedOut',
      codeShort: 'DO',
      displayName: { en: 'Dropped Out', 'ne-NP': 'विद्यालय छोडेको' },
      aliases: ['Dropout', 'Drop Out', 'Dropped', 'विद्यालय छोडेको'],
    },
    {
      uri: 'uri://ed-fi.org/ExitWithdrawTypeDescriptor#Deceased',
      code: 'Deceased',
      codeShort: 'DE',
      displayName: { en: 'Deceased', 'ne-NP': 'मृत्यु' },
      aliases: ['Died', 'मृत्यु'],
    },
    {
      uri: 'uri://ed-fi.org/ExitWithdrawTypeDescriptor#Migrated',
      code: 'Migrated',
      codeShort: 'MI',
      displayName: { en: 'Migrated (Left Country)', 'ne-NP': 'विदेश गएको' },
      // IEMIS distinguishes domestic transfer (TR) from international migration (MI).
      aliases: ['Migration', 'Left Country', 'विदेश गएको'],
    },
    {
      uri: 'uri://ed-fi.org/ExitWithdrawTypeDescriptor#ExpelledSuspended',
      code: 'ExpelledSuspended',
      codeShort: 'EX',
      displayName: { en: 'Expelled or Long Suspension', 'ne-NP': 'निष्कासित' },
      aliases: ['Expelled', 'Suspended', 'निष्कासित'],
    },
    {
      uri: 'uri://ed-fi.org/ExitWithdrawTypeDescriptor#NotEnrolledContinuing',
      code: 'NotEnrolledContinuing',
      codeShort: 'NC',
      displayName: { en: 'Not Enrolled, Continuing', 'ne-NP': 'भर्ना नभएको, जारी' },
      // Used for students who skipped a year but are expected to return.
      aliases: ['Gap', 'Gap Year', 'भर्ना नभएको'],
    },
    {
      uri: 'uri://ed-fi.org/ExitWithdrawTypeDescriptor#Other',
      code: 'Other',
      codeShort: 'OT',
      displayName: { en: 'Other', 'ne-NP': 'अन्य' },
      aliases: ['अन्य'],
    },
  ],
};
