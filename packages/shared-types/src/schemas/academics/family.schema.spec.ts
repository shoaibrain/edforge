/**
 * Family Group schema spec — EPIC-FB Sprint FB-1.1
 *
 * Coverage:
 *   - familyResponseSchema positives + negatives (bounds, uuid formats, P1d)
 *   - createFamilySchema / updateFamilySchema
 *   - familyMemberSchema / addFamilyMemberSchema
 *   - studentFamilyViewSchema 200-with-null contract (FB-1.5)
 */

import {
  familyResponseSchema,
  createFamilySchema,
  updateFamilySchema,
  familyMemberSchema,
  addFamilyMemberSchema,
  studentFamilyViewSchema,
  type FamilyResponseDto,
  type StudentFamilyViewDto,
} from './family.schema';

const FAMILY_ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const SIBLING_ID = '44444444-4444-4444-8444-444444444444';

const VALID_FAMILY: Record<string, unknown> = {
  id: FAMILY_ID,
  schoolId: SCHOOL_ID,
  name: 'Adhikari family',
  primaryContact: { name: 'Ram Adhikari' },
  createdBy: 'operator-1',
  createdAt: '2026-07-04T10:00:00Z',
  updatedAt: '2026-07-04T10:00:00Z',
};

describe('familyResponseSchema', () => {
  it('accepts a minimal valid family (contact name only)', () => {
    const parsed: FamilyResponseDto = familyResponseSchema.parse(VALID_FAMILY);
    expect(parsed.name).toBe('Adhikari family');
    expect(parsed.primaryContact.phone).toBeUndefined();
  });

  it('accepts full primaryContact (phone + email) and notes', () => {
    const parsed = familyResponseSchema.parse({
      ...VALID_FAMILY,
      primaryContact: {
        name: 'Ram Adhikari',
        phone: '+9779812345678',
        email: 'Ram@Example.com',
      },
      notes: 'Negotiated family deal — see agreement.',
    });
    // emailSchema lowercases on parse (shared convention).
    expect(parsed.primaryContact.email).toBe('ram@example.com');
    expect(parsed.notes).toContain('Negotiated');
  });

  it('rejects a non-uuid id / schoolId', () => {
    expect(familyResponseSchema.safeParse({ ...VALID_FAMILY, id: 'fam-1' }).success).toBe(false);
    expect(familyResponseSchema.safeParse({ ...VALID_FAMILY, schoolId: '' }).success).toBe(false);
  });

  it('rejects empty name and name > 120 chars', () => {
    expect(familyResponseSchema.safeParse({ ...VALID_FAMILY, name: '' }).success).toBe(false);
    expect(
      familyResponseSchema.safeParse({ ...VALID_FAMILY, name: 'x'.repeat(121) }).success,
    ).toBe(false);
  });

  it('rejects contact name > 120, malformed email, and notes > 500', () => {
    expect(
      familyResponseSchema.safeParse({
        ...VALID_FAMILY,
        primaryContact: { name: 'x'.repeat(121) },
      }).success,
    ).toBe(false);
    expect(
      familyResponseSchema.safeParse({
        ...VALID_FAMILY,
        primaryContact: { name: 'Ram', email: 'not-an-email' },
      }).success,
    ).toBe(false);
    expect(
      familyResponseSchema.safeParse({ ...VALID_FAMILY, notes: 'x'.repeat(501) }).success,
    ).toBe(false);
  });

  it('P1d — isActive is NOT part of the response contract (stripped, never required)', () => {
    // Absent parses fine…
    expect(familyResponseSchema.safeParse(VALID_FAMILY).success).toBe(true);
    // …and a row carrying it is stripped, not surfaced.
    const parsed = familyResponseSchema.parse({ ...VALID_FAMILY, isActive: true });
    expect('isActive' in parsed).toBe(false);
  });
});

describe('createFamilySchema', () => {
  const VALID_CREATE = {
    schoolId: SCHOOL_ID,
    name: 'Adhikari family',
    primaryContact: { name: 'Ram Adhikari' },
  };

  it('accepts a valid create payload', () => {
    expect(createFamilySchema.parse(VALID_CREATE).schoolId).toBe(SCHOOL_ID);
  });

  it('requires schoolId, name, and primaryContact', () => {
    const { schoolId: _s, ...noSchool } = VALID_CREATE;
    const { name: _n, ...noName } = VALID_CREATE;
    const { primaryContact: _p, ...noContact } = VALID_CREATE;
    expect(createFamilySchema.safeParse(noSchool).success).toBe(false);
    expect(createFamilySchema.safeParse(noName).success).toBe(false);
    expect(createFamilySchema.safeParse(noContact).success).toBe(false);
  });

  it('rejects notes > 500', () => {
    expect(
      createFamilySchema.safeParse({ ...VALID_CREATE, notes: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});

describe('updateFamilySchema', () => {
  it('accepts an empty partial (no-op PATCH body)', () => {
    expect(updateFamilySchema.safeParse({}).success).toBe(true);
  });

  it('accepts each field independently', () => {
    expect(updateFamilySchema.safeParse({ name: 'Renamed family' }).success).toBe(true);
    expect(
      updateFamilySchema.safeParse({ primaryContact: { name: 'Sita Adhikari' } }).success,
    ).toBe(true);
    expect(updateFamilySchema.safeParse({ notes: 'updated' }).success).toBe(true);
  });

  it('has no identity fields — id/schoolId in the body are stripped, not applied', () => {
    const parsed = updateFamilySchema.parse({ name: 'Renamed', schoolId: SCHOOL_ID, id: FAMILY_ID });
    expect('schoolId' in parsed).toBe(false);
    expect('id' in parsed).toBe(false);
  });

  it('still enforces bounds on provided fields', () => {
    expect(updateFamilySchema.safeParse({ name: '' }).success).toBe(false);
    expect(updateFamilySchema.safeParse({ name: 'x'.repeat(121) }).success).toBe(false);
  });
});

describe('familyMemberSchema', () => {
  const VALID_MEMBER = {
    familyId: FAMILY_ID,
    studentId: STUDENT_ID,
    studentName: 'Anisha Adhikari',
    addedBy: 'operator-1',
    createdAt: '2026-07-04T10:00:00Z',
  };

  it('accepts a valid member row (relationshipNote optional)', () => {
    const parsed = familyMemberSchema.parse(VALID_MEMBER);
    expect(parsed.relationshipNote).toBeUndefined();
  });

  it('accepts relationshipNote ≤ 200 and rejects > 200', () => {
    expect(
      familyMemberSchema.safeParse({ ...VALID_MEMBER, relationshipNote: 'eldest sibling' }).success,
    ).toBe(true);
    expect(
      familyMemberSchema.safeParse({ ...VALID_MEMBER, relationshipNote: 'x'.repeat(201) }).success,
    ).toBe(false);
  });

  it('rejects non-uuid familyId / studentId', () => {
    expect(familyMemberSchema.safeParse({ ...VALID_MEMBER, familyId: 'nope' }).success).toBe(false);
    expect(familyMemberSchema.safeParse({ ...VALID_MEMBER, studentId: 'nope' }).success).toBe(false);
  });
});

describe('addFamilyMemberSchema', () => {
  it('accepts studentId alone and with relationshipNote', () => {
    expect(addFamilyMemberSchema.safeParse({ studentId: STUDENT_ID }).success).toBe(true);
    expect(
      addFamilyMemberSchema.safeParse({ studentId: STUDENT_ID, relationshipNote: 'youngest' })
        .success,
    ).toBe(true);
  });

  it('rejects missing / malformed studentId and relationshipNote > 200', () => {
    expect(addFamilyMemberSchema.safeParse({}).success).toBe(false);
    expect(addFamilyMemberSchema.safeParse({ studentId: 'nope' }).success).toBe(false);
    expect(
      addFamilyMemberSchema.safeParse({ studentId: STUDENT_ID, relationshipNote: 'x'.repeat(201) })
        .success,
    ).toBe(false);
  });
});

describe('studentFamilyViewSchema — FB-1.5 200-with-null contract', () => {
  it('accepts the unlinked-student shape: family null + empty siblings', () => {
    const parsed: StudentFamilyViewDto = studentFamilyViewSchema.parse({
      family: null,
      siblings: [],
    });
    expect(parsed.family).toBeNull();
    expect(parsed.siblings).toHaveLength(0);
  });

  it('accepts a linked student with siblings (gradeLevel optional per sibling)', () => {
    const parsed = studentFamilyViewSchema.parse({
      family: VALID_FAMILY,
      siblings: [
        { studentId: SIBLING_ID, studentName: 'Bibek Adhikari', gradeLevel: 'UKG' },
        { studentId: STUDENT_ID, studentName: 'Anisha Adhikari' },
      ],
    });
    expect(parsed.family!.id).toBe(FAMILY_ID);
    expect(parsed.siblings[0].gradeLevel).toBe('UKG');
    expect(parsed.siblings[1].gradeLevel).toBeUndefined();
  });

  it('rejects when family is omitted entirely (nullable ≠ optional — the key must be present)', () => {
    expect(studentFamilyViewSchema.safeParse({ siblings: [] }).success).toBe(false);
  });

  it('rejects sibling entries with malformed studentId', () => {
    expect(
      studentFamilyViewSchema.safeParse({
        family: null,
        siblings: [{ studentId: 'nope', studentName: 'X' }],
      }).success,
    ).toBe(false);
  });
});
