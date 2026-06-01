/**
 * GradeLevelDescriptor catalog — Sprint 2 (S2.5).
 *
 * Canonical mapping between EdForge's `ORDERED_GRADES`
 * ([../../schemas/identity/grade-levels.ts](../../schemas/identity/grade-levels.ts))
 * and Ed-Fi's GradeLevelDescriptor URIs. Each grade is a separate entry —
 * the resolver does NOT collapse codes. See the `ECD/PPC` note below.
 *
 * IEMIS-specific bands:
 *   - `ECD` (Early Childhood Development — 3 to ~5 yrs)
 *   - `PPC` (Pre-Primary Class — ~4 to ~6 yrs)
 *
 * **Known lossy upstream token: `ECD/PPC`.** 54 Saraswati students carry the
 * literal combined string because the school does not track ECD vs PPC
 * separately. This resolver intentionally does NOT alias `ECD/PPC` to either
 * ECD or PPC — the combined token is ambiguous and would misrepresent student
 * counts in Flash I exports if silently routed. Sprint 3's Student importer
 * is the disambiguation point: it must ask the admin to split the 54 rows
 * (or default to PPC with an audit trail) BEFORE persisting. If the importer
 * passes `ECD/PPC` directly to `resolveDescriptor`, it will get `null`, and
 * the S2.9 fixture test asserts this is the only Saraswati value that
 * does NOT resolve.
 *
 * URIs: `uri://ed-fi.org/GradeLevelDescriptor#<Code>`.
 *
 * Catalog version: 1.0.0.
 */

import type { DescriptorCatalog } from './descriptor-types';

export const GRADE_LEVEL_DESCRIPTOR_CATALOG: DescriptorCatalog = {
  type: 'GradeLevelDescriptor',
  version: '1.0.0',
  entries: [
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#EarlyChildhoodDevelopment',
      code: 'EarlyChildhoodDevelopment',
      codeShort: 'ECD',
      displayName: {
        en: 'Early Childhood Development',
        'ne-NP': 'प्रारम्भिक बाल शिक्षा',
      },
      // PABSON operational codes 'PG' (Playgroup) and 'NUR' (Nursery)
      // collapse into the ECD IEMIS reporting band. The resolver returns
      // this entry when looking up either code so Nepal CEHRD's Flash I/II
      // export emits 'EarlyChildhoodDevelopment'. We alias only the
      // canonical codes, not the English labels — "Nursery" as a free-form
      // string is ambiguous across Nepal schools (some use it for ECD-age
      // children, others for PPC-age), so importers must disambiguate by
      // mapping to a specific code before resolveDescriptor sees it.
      aliases: ['ECD', 'PG', 'NUR', 'Early Childhood', 'प्रारम्भिक बाल शिक्षा'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#PrePrimaryClass',
      code: 'PrePrimaryClass',
      codeShort: 'PPC',
      displayName: { en: 'Pre-Primary Class', 'ne-NP': 'पूर्व-प्राथमिक कक्षा' },
      // PABSON operational codes 'LKG' (Lower KG) and 'UKG' (Upper KG)
      // collapse into the PPC IEMIS reporting band. As with the ECD entry
      // above, we alias only the canonical codes, not the English labels —
      // legacy 'Nursery' string ingestion is intentionally NOT handled here
      // because the word is ambiguous; importers must map it to a code
      // (PG / NUR / LKG / UKG / PPC) before resolveDescriptor.
      aliases: ['PPC', 'LKG', 'UKG', 'Pre-Primary', 'पूर्व-प्राथमिक कक्षा'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#Prekindergarten',
      code: 'Prekindergarten',
      codeShort: 'PK',
      displayName: { en: 'Pre-Kindergarten', 'ne-NP': 'पूर्व-किन्डरगार्टन' },
      aliases: ['PK', 'Pre-K', 'Pre K'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#Kindergarten',
      code: 'Kindergarten',
      codeShort: 'K',
      displayName: { en: 'Kindergarten', 'ne-NP': 'किन्डरगार्टन' },
      aliases: ['K'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#FirstGrade',
      code: 'FirstGrade',
      codeShort: '1',
      displayName: { en: 'First Grade', 'ne-NP': 'कक्षा १' },
      aliases: ['1', 'Grade 1', 'Class 1', 'G1', 'कक्षा १'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#SecondGrade',
      code: 'SecondGrade',
      codeShort: '2',
      displayName: { en: 'Second Grade', 'ne-NP': 'कक्षा २' },
      aliases: ['2', 'Grade 2', 'Class 2', 'G2', 'कक्षा २'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#ThirdGrade',
      code: 'ThirdGrade',
      codeShort: '3',
      displayName: { en: 'Third Grade', 'ne-NP': 'कक्षा ३' },
      aliases: ['3', 'Grade 3', 'Class 3', 'G3', 'कक्षा ३'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#FourthGrade',
      code: 'FourthGrade',
      codeShort: '4',
      displayName: { en: 'Fourth Grade', 'ne-NP': 'कक्षा ४' },
      aliases: ['4', 'Grade 4', 'Class 4', 'G4', 'कक्षा ४'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#FifthGrade',
      code: 'FifthGrade',
      codeShort: '5',
      displayName: { en: 'Fifth Grade', 'ne-NP': 'कक्षा ५' },
      aliases: ['5', 'Grade 5', 'Class 5', 'G5', 'कक्षा ५'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#SixthGrade',
      code: 'SixthGrade',
      codeShort: '6',
      displayName: { en: 'Sixth Grade', 'ne-NP': 'कक्षा ६' },
      aliases: ['6', 'Grade 6', 'Class 6', 'G6', 'कक्षा ६'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#SeventhGrade',
      code: 'SeventhGrade',
      codeShort: '7',
      displayName: { en: 'Seventh Grade', 'ne-NP': 'कक्षा ७' },
      aliases: ['7', 'Grade 7', 'Class 7', 'G7', 'कक्षा ७'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#EighthGrade',
      code: 'EighthGrade',
      codeShort: '8',
      displayName: { en: 'Eighth Grade', 'ne-NP': 'कक्षा ८' },
      aliases: ['8', 'Grade 8', 'Class 8', 'G8', 'कक्षा ८'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#NinthGrade',
      code: 'NinthGrade',
      codeShort: '9',
      displayName: { en: 'Ninth Grade', 'ne-NP': 'कक्षा ९' },
      aliases: ['9', 'Grade 9', 'Class 9', 'G9', 'कक्षा ९'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#TenthGrade',
      code: 'TenthGrade',
      codeShort: '10',
      displayName: { en: 'Tenth Grade', 'ne-NP': 'कक्षा १०' },
      aliases: ['10', 'Grade 10', 'Class 10', 'G10', 'SEE', 'कक्षा १०'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#EleventhGrade',
      code: 'EleventhGrade',
      codeShort: '11',
      displayName: { en: 'Eleventh Grade', 'ne-NP': 'कक्षा ११' },
      aliases: ['11', 'Grade 11', 'Class 11', 'G11', 'कक्षा ११'],
    },
    {
      uri: 'uri://ed-fi.org/GradeLevelDescriptor#TwelfthGrade',
      code: 'TwelfthGrade',
      codeShort: '12',
      displayName: { en: 'Twelfth Grade', 'ne-NP': 'कक्षा १२' },
      aliases: ['12', 'Grade 12', 'Class 12', 'G12', 'कक्षा १२'],
    },
  ],
};
