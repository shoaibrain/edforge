/**
 * Sprint 3 — studentDescriptorPatchSchema + Student schema Sprint 3 fields.
 */

import { studentDescriptorPatchSchema, createStudentSchema } from './student.schema';

describe('studentDescriptorPatchSchema', () => {
  it('accepts an empty payload (all fields optional)', () => {
    expect(studentDescriptorPatchSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a minimal patch with valid URIs', () => {
    const parsed = studentDescriptorPatchSchema.safeParse({
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Male',
      languageDescriptor: 'uri://ed-fi.org/LanguageDescriptor#Nepali',
      motherTongueDescriptor: 'uri://ed-fi.org/LanguageDescriptor#Maithili',
      disabilities: [
        {
          descriptor: 'uri://ed-fi.org/DisabilityDescriptor#Hearing',
          notes: 'Mild, no accommodation required',
        },
      ],
      isTransferred: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a URI not in the catalog', () => {
    const parsed = studentDescriptorPatchSchema.safeParse({
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Bogus',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a malformed URI', () => {
    const parsed = studentDescriptorPatchSchema.safeParse({
      languageDescriptor: 'not-a-uri',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects scholarshipCategory when belowPovertyLine=false', () => {
    const parsed = studentDescriptorPatchSchema.safeParse({
      belowPovertyLine: false,
      scholarshipCategory: 'OBC',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts scholarshipCategory when belowPovertyLine=true', () => {
    const parsed = studentDescriptorPatchSchema.safeParse({
      belowPovertyLine: true,
      scholarshipCategory: 'OBC',
    });
    expect(parsed.success).toBe(true);
  });

  it('caps disabilities at 8 entries', () => {
    const nine = Array.from({ length: 9 }).map(() => ({
      descriptor: 'uri://ed-fi.org/DisabilityDescriptor#Physical',
    }));
    expect(studentDescriptorPatchSchema.safeParse({ disabilities: nine }).success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    const parsed = studentDescriptorPatchSchema.safeParse({
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Male',
      foo: 'bar',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('createStudentSchema — Sprint 3 descriptor fields', () => {
  const baseStudent = {
    firstName: 'Roshani',
    lastName: 'Khatun',
    dateOfBirth: '2015-03-13',
    gender: 'female' as const,
    schoolId: '00000000-0000-0000-0000-000000000001',
    currentGradeLevel: '2',
  };

  it('accepts a student with Sprint 3 descriptor fields set', () => {
    const parsed = createStudentSchema.safeParse({
      ...baseStudent,
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Female',
      motherTongueDescriptor: 'uri://ed-fi.org/LanguageDescriptor#Maithili',
      disabilities: [],
      isTransferred: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an invalid descriptor URI at create time', () => {
    const parsed = createStudentSchema.safeParse({
      ...baseStudent,
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#NotValid',
    });
    expect(parsed.success).toBe(false);
  });

  it('isTransferred stays undefined when omitted (service layer defaults to false on write)', () => {
    const parsed = createStudentSchema.parse(baseStudent);
    expect(parsed.isTransferred).toBeUndefined();
  });
});
