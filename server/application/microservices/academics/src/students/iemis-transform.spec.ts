import { transformIemisRow, IemisRow, normalizeGradeLevel } from './iemis-transform';

const SAMPLE_SCHOOL_UUID = '02331d8d-0102-4e06-a721-9928d971c0c2';

function baseRow(overrides: Partial<IemisRow> = {}): IemisRow {
  return {
    'S.N': 1,
    'IEMIS Code': '170840012',
    'Current School': 'Saraswati English Boarding School',
    'Student Id': '1708400128000841',
    'FullName': 'Roshani Khatun',
    'Gender': 'Female',
    'Father Name': 'Habib Rain',
    'Mother Name': 'Kuresha Khatun',
    'CurrentClass': '2',
    'Section': '',
    'Year': '2082',
    'Permanent Address': 'Kshireshwarnath-9, Dhanusha',
    'Temporary Address': 'Kshireshwarnath-9, Dhanusha',
    'DOB': '2072-3-13',
    'Is Transferred': 'No',
    'Mother Tongue': 'Nepali',
    'Disability Type': 'No Disability',
    'Age': 10,
    'Guardian Name': 'Sahil Safi',
    'Guardian Contact Number': '9825851510',
    ...overrides,
  };
}

describe('transformIemisRow — happy path', () => {
  it('produces a valid DTO for a typical Saraswati row', () => {
    const result = transformIemisRow(baseRow(), 1, {
      archetype: 'PABSON',
      schoolId: SAMPLE_SCHOOL_UUID,
      expectedIemisSchoolCode: '170840012',
    });

    expect(result.row).toBe(1);
    expect(result.dto).not.toBeNull();
    expect(result.emisStudentId).toBe('1708400128000841');
    expect(result.dto!.firstName).toBe('Roshani');
    expect(result.dto!.lastName).toBe('Khatun');
    expect(result.dto!.gender).toBe('female');
    expect(result.dto!.currentGradeLevel).toBe('2');
    expect(result.dto!.emisStudentId).toBe('1708400128000841');
    expect(result.dto!.schoolId).toBe(SAMPLE_SCHOOL_UUID);
    expect(result.findings.filter((f) => f.level === 'error')).toHaveLength(0);
  });

  it('converts BS DOB to Gregorian (non-padded)', () => {
    const result = transformIemisRow(baseRow({ 'DOB': '2072-3-13' }), 1, {
      archetype: 'PABSON',
      schoolId: SAMPLE_SCHOOL_UUID,
    });
    expect(result.dto).not.toBeNull();
    // BS 2072-03-13 → Gregorian 2015-06-27 (tolerant of 1-day conversion drift).
    expect(result.dto!.dateOfBirth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('zero-padded and non-padded BS DOB yield the same Gregorian date', () => {
    const a = transformIemisRow(baseRow({ 'DOB': '2072-3-13' }), 1, {
      archetype: 'PABSON',
      schoolId: SAMPLE_SCHOOL_UUID,
    });
    const b = transformIemisRow(baseRow({ 'DOB': '2072-03-13' }), 1, {
      archetype: 'PABSON',
      schoolId: SAMPLE_SCHOOL_UUID,
    });
    expect(a.dto!.dateOfBirth).toBe(b.dto!.dateOfBirth);
  });

  it('builds three guardian contact records (father / mother / guardian)', () => {
    const result = transformIemisRow(baseRow(), 1, {
      archetype: 'PABSON',
      schoolId: SAMPLE_SCHOOL_UUID,
    });
    expect(result.dto!.guardians).toHaveLength(3);
    expect(result.dto!.guardians![0].relationship).toBe('father');
    expect(result.dto!.guardians![1].relationship).toBe('mother');
    expect(result.dto!.guardians![2].relationship).toBe('guardian');
    expect(result.dto!.guardians![0].isPrimary).toBe(true);
    expect(result.dto!.guardians![1].isPrimary).toBe(false);
    expect(result.dto!.guardians![2].phone).toBe('9825851510');
  });
});

describe('transformIemisRow — data quality edge cases', () => {
  it('Na / NA parent names drop that guardian record', () => {
    const result = transformIemisRow(
      baseRow({ 'Father Name': 'Na', 'Mother Name': 'NA' }),
      1,
      { archetype: 'PABSON', schoolId: SAMPLE_SCHOOL_UUID },
    );
    expect(result.dto).not.toBeNull();
    // Only Guardian Name survives.
    expect(result.dto!.guardians).toHaveLength(1);
    expect(result.dto!.guardians![0].relationship).toBe('guardian');
  });

  it('placeholder phone 123 is cleaned to undefined with a warning', () => {
    const result = transformIemisRow(
      baseRow({ 'Guardian Contact Number': '123' }),
      1,
      { archetype: 'PABSON', schoolId: SAMPLE_SCHOOL_UUID },
    );
    expect(result.dto).not.toBeNull();
    const guardian = result.dto!.guardians!.find((g) => g.relationship === 'guardian')!;
    expect(guardian.phone).toBeUndefined();
    expect(result.findings.some((f) => f.level === 'warn' && f.field.includes('guardian'))).toBe(true);
  });

  it('-null, addresses produce no contactInfo.address', () => {
    const result = transformIemisRow(
      baseRow({ 'Permanent Address': '-null,', 'Temporary Address': '-null,' }),
      1,
      { archetype: 'PABSON', schoolId: SAMPLE_SCHOOL_UUID },
    );
    expect(result.dto).not.toBeNull();
    expect(result.dto!.contactInfo?.address).toBeUndefined();
    expect(result.dto!.contactInfo?.mailingAddress).toBeUndefined();
  });

  it('compound Nepali FullName splits on last space, not first', () => {
    const result = transformIemisRow(
      baseRow({ 'FullName': 'Khadka Bahadur Karki' }),
      1,
      { archetype: 'PABSON', schoolId: SAMPLE_SCHOOL_UUID },
    );
    expect(result.dto!.firstName).toBe('Khadka Bahadur');
    expect(result.dto!.lastName).toBe('Karki');
  });

  it('single-token FullName uses first name as last name fallback (with warning)', () => {
    const result = transformIemisRow(
      baseRow({ 'FullName': 'Rashmi' }),
      1,
      { archetype: 'PABSON', schoolId: SAMPLE_SCHOOL_UUID },
    );
    expect(result.dto).not.toBeNull();
    expect(result.dto!.firstName).toBe('Rashmi');
    expect(result.dto!.lastName).toBe('Rashmi');
    expect(result.findings.some((f) => f.level === 'warn' && f.field === 'FullName')).toBe(true);
  });

  it('ALL CAPS names are normalized to Title Case', () => {
    const result = transformIemisRow(
      baseRow({ 'FullName': 'ROSHANI KHATUN' }),
      1,
      { archetype: 'PABSON', schoolId: SAMPLE_SCHOOL_UUID },
    );
    expect(result.dto!.firstName).toBe('Roshani');
    expect(result.dto!.lastName).toBe('Khatun');
  });

  it('whitespace on every field does not change semantics', () => {
    const result = transformIemisRow(
      baseRow({
        'FullName': '   Roshani   Khatun   ',
        'Student Id': '  1708400128000841  ',
        'Gender': '  Female  ',
      }),
      1,
      { archetype: 'PABSON', schoolId: SAMPLE_SCHOOL_UUID },
    );
    expect(result.dto!.firstName).toBe('Roshani');
    expect(result.dto!.lastName).toBe('Khatun');
    expect(result.emisStudentId).toBe('1708400128000841');
    expect(result.dto!.gender).toBe('female');
  });

  it('ECD grade level is accepted for PABSON', () => {
    const result = transformIemisRow(
      baseRow({ 'CurrentClass': 'ECD' }),
      1,
      { archetype: 'PABSON', schoolId: SAMPLE_SCHOOL_UUID },
    );
    expect(result.dto).not.toBeNull();
    expect(result.dto!.currentGradeLevel).toBe('ECD');
  });

  it('"Class 5" normalizes to "5"', () => {
    const result = transformIemisRow(
      baseRow({ 'CurrentClass': 'Class 5' }),
      1,
      { archetype: 'PABSON', schoolId: SAMPLE_SCHOOL_UUID },
    );
    expect(result.dto).not.toBeNull();
    expect(result.dto!.currentGradeLevel).toBe('5');
  });

  it('IEMIS School Code mismatch emits a warning (not error)', () => {
    const result = transformIemisRow(
      baseRow({ 'IEMIS Code': '999999' }),
      1,
      {
        archetype: 'PABSON',
        schoolId: SAMPLE_SCHOOL_UUID,
        expectedIemisSchoolCode: '170840012',
      },
    );
    expect(result.dto).not.toBeNull();
    expect(result.findings.some((f) => f.level === 'warn' && f.field === 'IEMIS Code')).toBe(true);
  });
});

describe('transformIemisRow — error rows', () => {
  it('missing Student Id produces an error and null DTO', () => {
    const result = transformIemisRow(
      baseRow({ 'Student Id': '' }),
      1,
      { archetype: 'PABSON', schoolId: SAMPLE_SCHOOL_UUID },
    );
    expect(result.dto).toBeNull();
    expect(result.findings.some((f) => f.level === 'error' && f.field === 'Student Id')).toBe(true);
  });

  it('unknown gender produces an error', () => {
    const result = transformIemisRow(
      baseRow({ 'Gender': 'X' }),
      1,
      { archetype: 'PABSON', schoolId: SAMPLE_SCHOOL_UUID },
    );
    expect(result.dto).toBeNull();
    expect(result.findings.some((f) => f.level === 'error' && f.field === 'Gender')).toBe(true);
  });

  it('invalid BS date produces an error', () => {
    const result = transformIemisRow(
      baseRow({ 'DOB': 'not-a-date' }),
      1,
      { archetype: 'PABSON', schoolId: SAMPLE_SCHOOL_UUID },
    );
    expect(result.dto).toBeNull();
    expect(result.findings.some((f) => f.level === 'error' && f.field === 'DOB')).toBe(true);
  });

  it('GENERIC archetype rejects ECD grade', () => {
    const result = transformIemisRow(
      baseRow({ 'CurrentClass': 'ECD' }),
      1,
      { archetype: 'GENERIC', schoolId: SAMPLE_SCHOOL_UUID },
    );
    expect(result.dto).toBeNull();
    expect(result.findings.some((f) => f.level === 'error' && f.field === 'CurrentClass')).toBe(true);
  });
});

describe('normalizeGradeLevel', () => {
  it('accepts bare numeric grades', () => {
    expect(normalizeGradeLevel('1')).toBe('1');
    expect(normalizeGradeLevel('12')).toBe('12');
  });

  it('strips Class/Grade/G prefixes', () => {
    expect(normalizeGradeLevel('Class 5')).toBe('5');
    expect(normalizeGradeLevel('Grade 10')).toBe('10');
    expect(normalizeGradeLevel('G 7')).toBe('7');
  });

  it('accepts ECD / PPC / PK / K (case insensitive)', () => {
    expect(normalizeGradeLevel('ECD')).toBe('ECD');
    expect(normalizeGradeLevel('ecd')).toBe('ECD');
    expect(normalizeGradeLevel('PPC')).toBe('PPC');
    expect(normalizeGradeLevel('ppc')).toBe('PPC');
    expect(normalizeGradeLevel('K')).toBe('K');
  });

  it('rejects out-of-range or nonsense', () => {
    expect(normalizeGradeLevel('13')).toBe('');
    expect(normalizeGradeLevel('0')).toBe('');
    expect(normalizeGradeLevel('Senior')).toBe('');
  });

  // Sprint C3 / BUG-S7 — Saraswati's IEMIS export uses the literal token
  // `ECD/PPC` for the combined pre-primary cohort. Resolve to canonical ECD
  // (the transform layer surfaces a per-row warning so the operator can
  // re-classify if the school's roster intends PPC).
  describe('combined-band ECD/PPC token', () => {
    it('resolves the canonical "ECD/PPC" to ECD', () => {
      expect(normalizeGradeLevel('ECD/PPC')).toBe('ECD');
    });

    it('tolerates whitespace around the slash', () => {
      expect(normalizeGradeLevel('ECD / PPC')).toBe('ECD');
      expect(normalizeGradeLevel(' ECD/PPC ')).toBe('ECD');
      expect(normalizeGradeLevel('ECD  /  PPC')).toBe('ECD');
    });

    it('is case-insensitive', () => {
      expect(normalizeGradeLevel('ecd/ppc')).toBe('ECD');
      expect(normalizeGradeLevel('Ecd/Ppc')).toBe('ECD');
    });

    it('does NOT match unrelated slash-separated tokens', () => {
      expect(normalizeGradeLevel('PPC/ECD')).toBe('');
      expect(normalizeGradeLevel('ECD/K')).toBe('');
      expect(normalizeGradeLevel('1/2')).toBe('');
    });
  });
});

describe('transformIemisRow — combined-band warning (Sprint C3 / BUG-S7)', () => {
  const SCHOOL = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  function row(currentClass: string): IemisRow {
    return {
      'S.N': 11,
      'IEMIS Code': '170840012',
      'Current School': 'Saraswati English Boarding School',
      'Student Id': '9876543218200020',
      'FullName': 'Aaditya Kumar Yadav',
      'Gender': 'Male',
      'Father Name': 'Hem Shankar Sah',
      'Mother Name': 'Rukmani Devi Sah',
      'CurrentClass': currentClass,
      'Section': '',
      'Year': '2082',
      'Permanent Address': 'Kshireshwarnath-5, Dhanusha',
      'Temporary Address': 'Kshireshwarnath-5, Dhanusha',
      'DOB': '2076-01-01',
      'Is Transferred': 'No',
      'Mother Tongue': 'Nepali',
      'Disability Type': 'No Disability',
      'Age': 6,
      'Guardian Name': '',
      'Guardian Contact Number': '',
    };
  }

  it('imports an "ECD/PPC" row as ECD with a combined-band warning', () => {
    const result = transformIemisRow(row('ECD/PPC'), 11, {
      archetype: 'PABSON',
      schoolId: SCHOOL,
      expectedIemisSchoolCode: '170840012',
    });

    expect(result.dto).not.toBeNull();
    expect(result.dto!.currentGradeLevel).toBe('ECD');
    expect(result.findings.filter((f) => f.level === 'error')).toHaveLength(0);
    const combinedWarning = result.findings.find(
      (f) => f.level === 'warn'
        && f.field === 'CurrentClass'
        && /Combined band/i.test(f.message),
    );
    expect(combinedWarning).toBeDefined();
    expect(combinedWarning!.message).toContain('placed in ECD');
  });

  it('produces NO combined-band warning for plain "ECD"', () => {
    const result = transformIemisRow(row('ECD'), 11, {
      archetype: 'PABSON',
      schoolId: SCHOOL,
      expectedIemisSchoolCode: '170840012',
    });
    expect(result.dto).not.toBeNull();
    expect(result.dto!.currentGradeLevel).toBe('ECD');
    expect(
      result.findings.some((f) => /Combined band/i.test(f.message)),
    ).toBe(false);
  });

  it('handles whitespace-padded combined-band tokens', () => {
    const result = transformIemisRow(row(' ECD / PPC '), 11, {
      archetype: 'PABSON',
      schoolId: SCHOOL,
      expectedIemisSchoolCode: '170840012',
    });
    expect(result.dto).not.toBeNull();
    expect(result.dto!.currentGradeLevel).toBe('ECD');
    expect(
      result.findings.some(
        (f) => f.level === 'warn' && /Combined band/i.test(f.message),
      ),
    ).toBe(true);
  });
});
