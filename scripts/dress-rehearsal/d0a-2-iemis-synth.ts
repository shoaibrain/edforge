/**
 * D0a.2 Dress Rehearsal — IEMIS Import Synthesizer
 *
 * Produces a 15-row synthetic IEMIS XLSX file (matching the real CEHRD column
 * structure observed in Saraswati's actual pilot file at /Users/shoaibrain/
 * edforge/test-data-1.xlsx — 20 columns, sheet `Student_List_2082_All`) plus a
 * sibling JSON file of the same rows ready to POST directly to
 * `/academics/students/import/iemis`.
 *
 * Purpose: validate D0a.2 (IEMIS transformer extension — Ed-Fi descriptor
 * fields) end-to-end on `dev-pabson-primary` without waiting for the principal
 * to upload her next grade.
 *
 * Target: dev tenant `21aea5da-…`, school `4209e3d8-d2e2-4e0e-9961-790341c264f4`
 *         emisSchoolCode `888888888` (matches the dev tenant fixture).
 *
 * The 15 rows are designed to exercise every D0a.2 code path:
 *   - sexDescriptor derivation from Gender (Male/Female)
 *   - motherTongueDescriptor lookup (Nepali / Maithili / Bhojpuri / Tharu /
 *     Newari / unknown)
 *   - disabilities lookup (NoDisability / Physical / Vision / Hearing /
 *     unknown)
 *   - isTransferred parse (No / Yes / garbage)
 * Plus transformer guard rails:
 *   - Cross-school IEMIS Code (warning fires)
 *   - Combined-band ECD/PPC grade (warning fires)
 *   - Placeholder phone "123" (warning fires)
 *
 * Outputs:
 *   /tmp/dress-rehearsal-d0a-2-<ts>.xlsx
 *   /tmp/dress-rehearsal-d0a-2-<ts>.json   (parsed rows ready for POST body)
 *
 * Usage:
 *   cd /Users/shoaibrain/edforge
 *   node --experimental-strip-types scripts/dress-rehearsal/d0a-2-iemis-synth.ts
 * Or via the frontend's node_modules (which has xlsx installed):
 *   node -r ts-node/register scripts/dress-rehearsal/d0a-2-iemis-synth.ts
 *
 * The XLSX file is for documentation / operator-experience artifact. The JSON
 * file is what the dress-rehearsal runner POSTs to the import endpoint (the
 * frontend parses XLSX client-side then POSTs JSON — we skip the parse step
 * for the dress rehearsal).
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

interface IemisRow {
  'S.N': string;
  'IEMIS Code': string;
  'Current School': string;
  'Student Id': string;
  'FullName': string;
  'Gender': string;
  'Father Name': string;
  'Mother Name': string;
  'CurrentClass': string;
  'Section': string;
  'Year': string;
  'Permanent Address': string;
  'Temporary Address': string;
  'DOB': string;
  'Is Transferred': string;
  'Mother Tongue': string;
  'Disability Type': string;
  'Age': string;
  'Guardian Name': string;
  'Guardian Contact Number': string;
}

// ── Dev tenant target ──
const DEV_SCHOOL_NAME = 'Shree Saraswati English Boarding School';
const DEV_EMIS_CODE = '888888888'; // matches dev-pabson-primary's emisSchoolCode
const YEAR_BS = '2082';
// Student Id prefix = emisSchoolCode (9 digits) + 7-digit unique suffix.
// We use the range 5050xxx — fresh range chosen after the 2026-05-19 dress
// rehearsal found that 9900xxx had ~240 leftover students from prior dev
// smokes still living in DDB (possibly soft-deleted but the IEMIS dedup
// GSI7 still finds them). 5050xxx hasn't been used by any prior smoke as
// of this date and shouldn't collide.
const STUDENT_ID_BASE = 8888888885_050000n;

// Place a single row with a cross-school code to fire the cross-school
// IEMIS warning. This is row #12 in the design.
const CROSS_SCHOOL_CODE = '999999999';

interface RowDesign {
  fullName: string;
  gender: 'Male' | 'Female';
  fatherName: string;
  motherName: string;
  currentClass: string;
  dobBs: string;
  motherTongue: string;
  disability: string;
  isTransferred: string;
  iemisCode?: string; // override DEV_EMIS_CODE for cross-school test
  guardianContact?: string; // override empty for placeholder-phone test
  permanentAddress?: string;
  notes: string;
}

const DESIGN: RowDesign[] = [
  {
    fullName: 'Aarav Sharma',
    gender: 'Male',
    fatherName: 'Rajesh Sharma',
    motherName: 'Sita Sharma',
    currentClass: '5',
    dobBs: '2071-3-15',
    motherTongue: 'Nepali',
    disability: 'No Disability',
    isTransferred: 'No',
    permanentAddress: 'Kathmandu-2, Bagmati',
    notes: 'Happy path #1: Male, Nepali, No Disability, No transfer',
  },
  {
    fullName: 'Anushka Karki',
    gender: 'Female',
    fatherName: 'Bishnu Karki',
    motherName: 'Maya Karki',
    currentClass: '8',
    dobBs: '2068-5-20',
    motherTongue: 'Nepali',
    disability: 'No Disability',
    isTransferred: 'No',
    permanentAddress: 'Lalitpur-5, Bagmati',
    notes: 'Happy path #2: Female, Nepali, No Disability, No transfer',
  },
  {
    fullName: 'Riya Mahato',
    gender: 'Female',
    fatherName: 'Suresh Mahato',
    motherName: 'Rita Devi Mahato',
    currentClass: '3',
    dobBs: '2073-7-10',
    motherTongue: 'Maithili',
    disability: 'No Disability',
    isTransferred: 'No',
    permanentAddress: 'Janakpurdham-1, Dhanusha',
    notes: 'Maithili regional language',
  },
  {
    fullName: 'Bishnu Tharu',
    gender: 'Male',
    fatherName: 'Hari Tharu',
    motherName: 'Sunita Tharu',
    currentClass: '6',
    dobBs: '2070-11-5',
    motherTongue: 'Bhojpuri',
    disability: 'No Disability',
    isTransferred: 'Yes',
    permanentAddress: 'Birgunj-7, Parsa',
    notes: 'Bhojpuri language + transferred-in flag',
  },
  {
    fullName: 'Manisha Chaudhary',
    gender: 'Female',
    fatherName: 'Ram Chaudhary',
    motherName: 'Kamala Chaudhary',
    currentClass: '4',
    dobBs: '2072-2-28',
    motherTongue: 'Tharu',
    disability: 'No Disability',
    isTransferred: 'No',
    permanentAddress: 'Dang-3, Lumbini',
    notes: 'Tharu native (alias for Tharu descriptor)',
  },
  {
    fullName: 'Sushma Shrestha',
    gender: 'Female',
    fatherName: 'Pradip Shrestha',
    motherName: 'Bina Shrestha',
    currentClass: '7',
    dobBs: '2069-9-12',
    motherTongue: 'Newari',
    disability: 'No Disability',
    isTransferred: 'No',
    permanentAddress: 'Patan-9, Bagmati',
    notes: 'Newari language (alias for Newar descriptor)',
  },
  {
    fullName: 'Test Klingon',
    gender: 'Male',
    fatherName: 'Test Father',
    motherName: 'Test Mother',
    currentClass: '2',
    dobBs: '2074-1-1',
    motherTongue: 'Klingon', // unknown — should warn
    disability: 'No Disability',
    isTransferred: 'No',
    permanentAddress: 'Test Address-1, Test',
    notes: 'EXPECTED WARNING: unknown Mother Tongue "Klingon"',
  },
  {
    fullName: 'Ramesh Magar',
    gender: 'Male',
    fatherName: 'Bir Magar',
    motherName: 'Lila Magar',
    currentClass: '9',
    dobBs: '2067-8-3',
    motherTongue: 'Nepali',
    disability: 'Physical Disability',
    isTransferred: 'No',
    permanentAddress: 'Pokhara-12, Gandaki',
    notes: 'Physical disability descriptor (#Physical URI)',
  },
  {
    fullName: 'Priya Adhikari',
    gender: 'Female',
    fatherName: 'Mohan Adhikari',
    motherName: 'Gita Adhikari',
    currentClass: '6',
    dobBs: '2070-4-22',
    motherTongue: 'Nepali',
    disability: 'Visual Impairment',
    isTransferred: 'No',
    permanentAddress: 'Bhaktapur-4, Bagmati',
    notes: 'Vision impairment (English alias for #Vision URI)',
  },
  {
    fullName: 'Hari Shrestha',
    gender: 'Male',
    fatherName: 'Shyam Shrestha',
    motherName: 'Indra Shrestha',
    currentClass: '5',
    dobBs: '2071-2-11',
    motherTongue: 'Nepali',
    disability: 'Deaf',
    isTransferred: 'No',
    permanentAddress: 'Kirtipur-1, Bagmati',
    notes: 'Hearing impairment (Deaf alias for #Hearing URI)',
  },
  {
    fullName: 'Mira Test-Disability',
    gender: 'Female',
    fatherName: 'Krishna Test',
    motherName: 'Sushila Test',
    currentClass: '10',
    dobBs: '2066-12-30',
    motherTongue: 'Nepali',
    disability: 'Some Other Mystery Condition', // unknown — should warn
    isTransferred: 'No',
    permanentAddress: 'Test Address-2, Test',
    notes: 'EXPECTED WARNING: unknown Disability Type',
  },
  {
    fullName: 'Krishna Pandey',
    gender: 'Male',
    fatherName: 'Ganesh Pandey',
    motherName: 'Saraswati Pandey',
    currentClass: '7',
    dobBs: '2069-5-15',
    motherTongue: 'Nepali',
    disability: 'No Disability',
    isTransferred: 'No',
    iemisCode: CROSS_SCHOOL_CODE, // override — should fire IEMIS Code warning
    permanentAddress: 'Chitwan-4, Bagmati',
    notes: 'EXPECTED WARNING: cross-school IEMIS Code (' +
      CROSS_SCHOOL_CODE + ' vs dest ' + DEV_EMIS_CODE + ')',
  },
  {
    fullName: 'Sangita Yadav',
    gender: 'Female',
    fatherName: 'Ramesh Yadav',
    motherName: 'Anita Yadav',
    currentClass: 'ECD/PPC', // combined-band — should warn
    dobBs: '2078-3-1',
    motherTongue: 'Nepali',
    disability: 'No Disability',
    isTransferred: 'No',
    permanentAddress: 'Sarlahi-2, Madhesh',
    notes: 'EXPECTED WARNING: combined-band ECD/PPC (Sprint C3.T1)',
  },
  {
    fullName: 'Devi Sah',
    gender: 'Female',
    fatherName: 'Lal Sah',
    motherName: 'Rama Sah',
    currentClass: '4',
    dobBs: '2072-7-4',
    motherTongue: 'Nepali',
    disability: 'No Disability',
    isTransferred: 'No',
    guardianContact: '123', // placeholder phone — should warn
    permanentAddress: 'Mahottari-3, Madhesh',
    notes: 'EXPECTED WARNING: placeholder guardian phone "123"',
  },
  {
    fullName: 'Mohan Khatri',
    gender: 'Male',
    fatherName: 'Surya Khatri',
    motherName: 'Parvati Khatri',
    currentClass: '8',
    dobBs: '2068-2-9',
    motherTongue: 'Nepali',
    disability: 'No Disability',
    isTransferred: 'garbage', // unrecognized — should warn
    permanentAddress: 'Dhading-6, Bagmati',
    notes: 'EXPECTED WARNING: garbage Is Transferred → field blank',
  },
];

function buildRows(): IemisRow[] {
  return DESIGN.map((d, i) => {
    const studentId = (STUDENT_ID_BASE + BigInt(i + 1)).toString();
    return {
      'S.N': String(i + 1),
      'IEMIS Code': d.iemisCode ?? DEV_EMIS_CODE,
      'Current School': DEV_SCHOOL_NAME,
      'Student Id': studentId,
      'FullName': d.fullName,
      'Gender': d.gender,
      'Father Name': d.fatherName,
      'Mother Name': d.motherName,
      'CurrentClass': d.currentClass,
      'Section': '',
      'Year': YEAR_BS,
      'Permanent Address': d.permanentAddress ?? '-null,',
      'Temporary Address': d.permanentAddress ?? '-null,',
      'DOB': d.dobBs,
      'Is Transferred': d.isTransferred,
      'Mother Tongue': d.motherTongue,
      'Disability Type': d.disability,
      'Age': '', // operator-facing; not used by transformer
      'Guardian Name': '',
      'Guardian Contact Number': d.guardianContact ?? '',
    };
  });
}

function main() {
  const rows = buildRows();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const xlsxPath = `/tmp/dress-rehearsal-d0a-2-${ts}.xlsx`;
  const jsonPath = `/tmp/dress-rehearsal-d0a-2-${ts}.json`;

  // Build XLSX
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: [
      'S.N', 'IEMIS Code', 'Current School', 'Student Id', 'FullName',
      'Gender', 'Father Name', 'Mother Name', 'CurrentClass', 'Section',
      'Year', 'Permanent Address', 'Temporary Address', 'DOB', 'Is Transferred',
      'Mother Tongue', 'Disability Type', 'Age', 'Guardian Name', 'Guardian Contact Number',
    ],
  });
  XLSX.utils.book_append_sheet(wb, ws, 'Student_List_2082_All');
  XLSX.writeFile(wb, xlsxPath);

  // Build JSON sibling (what frontend would POST after parsing)
  fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2));

  console.log(`Wrote ${rows.length} synthetic rows:`);
  console.log(`  XLSX: ${xlsxPath}`);
  console.log(`  JSON: ${jsonPath}`);
  console.log('');
  console.log('Row design summary (S.N → expected outcome):');
  DESIGN.forEach((d, i) => {
    console.log(`  Row ${i + 1}: ${d.fullName.padEnd(28)} | ${d.notes}`);
  });
}

main();
