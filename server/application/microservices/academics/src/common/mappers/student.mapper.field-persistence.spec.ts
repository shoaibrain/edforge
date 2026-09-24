/**
 * LILI-BUG #504 — the 14 declared student fields that were silently discarded.
 *
 * Runtime evidence (issue #504): `POST /academics/students` accepted all 35
 * fields the published contract declares, returned 201, and persisted 21 of
 * them. The rest were dropped in two places — `createStudentDtoToEntity`
 * never read them, and `studentEntityToDto` hardcoded several to `undefined`
 * on the way back out.
 *
 * WHY THE OBVIOUS TEST DOES NOT WORK, recorded because two instruments gave
 * confident wrong answers before the real one was found:
 *
 *   1. "absent from the read response ⇒ dropped on write" is FALSE — the
 *      response DTO omits fields by design.
 *   2. "`version` unchanged ⇒ no write happened" is FALSE — `version` is not
 *      in the response DTO at all, so the comparison was
 *      `undefined !== undefined` for every probe. The positive control failed
 *      too, which is the only reason it was caught.
 *
 * The valid oracle is what actually gets written. This spec pins the mapper
 * layer; `students.service.contract-conformance.spec.ts` pins the whole
 * create path down to the item handed to DynamoDB.
 */

import {
  createStudentDtoToEntity,
  updateStudentDtoToEntity,
  studentEntityToDto,
} from './student.mapper';
import type { Student } from '../entities/student.entity';
import type { CreateStudentDto, UpdateStudentDto } from '@aibrains/shared-types';

/** Every field #504 found was accepted and then thrown away. */
const DROPPED_ON_CREATE = [
  'suffix',
  'stateStudentId',
  'ethnicity',
  'primaryLanguage',
  'homeLanguage',
  'countryOfBirth',
  'previousSchool',
  'notes',
  'scholarshipAmountNpr',
  'hasEcedExperience',
  'mailingAddress',
  'useMailingAddress',
  'phoneType',
] as const;

function fullCreateDto(): CreateStudentDto {
  return {
    firstName: 'Test',
    lastName: 'Student',
    middleName: 'M',
    preferredName: 'T',
    suffix: 'Jr',
    dateOfBirth: '2012-05-04',
    gender: 'male',
    schoolId: 'school-1',
    currentGradeLevel: '5',
    studentNumber: 'SN-1',
    stateStudentId: 'STATE-123',
    emisStudentId: '1234567890123456',
    contactInfo: {
      email: 'test@example.com',
      phone: '+9779800000000',
      phoneType: 'mobile',
      address: { street1: 'Line 1', city: 'Kathmandu', country: 'NPL' },
      mailingAddress: { street1: 'PO Box 9', city: 'Lalitpur', country: 'NPL' },
      useMailingAddress: true,
    },
    guardians: [],
    emergencyContacts: [
      { name: 'First Contact', relationship: 'mother', phone: '+9779811111111', priority: 1 },
      { name: 'Second Contact', relationship: 'uncle', phone: '+9779822222222', priority: 2 },
    ],
    specialPrograms: ['sp'],
    accommodations: ['acc'],
    ethnicity: 'Newar',
    primaryLanguage: 'Nepali',
    homeLanguage: 'Newari',
    countryOfBirth: 'NPL',
    scholarshipAmountNpr: 12500,
    hasEcedExperience: true,
    enrollmentDate: '2026-04-15',
    previousSchool: 'Previous School',
    notes: 'Operator note',
  } as unknown as CreateStudentDto;
}

describe('#504 — createStudentDtoToEntity keeps every field the contract accepts', () => {
  it.each(DROPPED_ON_CREATE)('carries %s through to the entity', (field) => {
    const entity = createStudentDtoToEntity(fullCreateDto()) as Record<string, unknown>;
    // contactInfo fields are flattened onto the entity, so one lookup covers both.
    expect(entity[field]).toBeDefined();
  });

  it('flattens contactInfo, including the mailing address and its toggle', () => {
    const e = createStudentDtoToEntity(fullCreateDto());
    expect(e.email).toBe('test@example.com');
    expect(e.phoneType).toBe('mobile');
    expect(e.mailingAddress?.city).toBe('Lalitpur');
    expect(e.useMailingAddress).toBe(true);
    // The residential address must survive independently of the mailing one.
    expect(e.address?.city).toBe('Kathmandu');
  });

  it('keeps EVERY emergency contact, not just the first', () => {
    // The old mapper wrote `emergencyContacts[0]` into a singular
    // `emergencyContact` attribute, so a second contact was discarded on
    // write — invisible to the operator, who saw their input accepted.
    const e = createStudentDtoToEntity(fullCreateDto());
    expect(e.emergencyContacts).toHaveLength(2);
    expect(e.emergencyContacts?.[1].name).toBe('Second Contact');
  });

  it('preserves each contact call order instead of stamping everyone priority 1', () => {
    const e = createStudentDtoToEntity(fullCreateDto());
    expect(e.emergencyContacts?.map((c) => c.priority)).toEqual([1, 2]);
  });

  it('persists the money field as a number, not a string', () => {
    // scholarshipAmountNpr feeds CEHRD Flash reporting; a string would pass
    // JSON round-trips and break aggregation silently.
    const e = createStudentDtoToEntity(fullCreateDto());
    expect(typeof e.scholarshipAmountNpr).toBe('number');
    expect(e.scholarshipAmountNpr).toBe(12500);
  });
});

describe('#504 — studentEntityToDto stops hardcoding fields to undefined', () => {
  function entityWithAll(): Student {
    return {
      ...createStudentDtoToEntity(fullCreateDto()),
      tenantId: 't', entityKey: 'STUDENT#s', entityType: 'STUDENT', studentId: 's',
      primarySchoolId: 'school-1', currentGradeLevel: '5', status: 'active',
      guardians: [],
      createdAt: '2026-04-15T00:00:00Z', updatedAt: '2026-04-15T00:00:00Z',
    } as unknown as Student;
  }

  it.each(['suffix', 'stateStudentId', 'ethnicity', 'primaryLanguage', 'homeLanguage', 'countryOfBirth', 'previousSchool', 'notes'])(
    'projects %s from the entity instead of a literal undefined',
    (field) => {
      const dto = studentEntityToDto(entityWithAll()) as unknown as Record<string, unknown>;
      expect(dto[field]).toBeDefined();
    },
  );

  it('round-trips the mailing address and its toggle through contactInfo', () => {
    const dto = studentEntityToDto(entityWithAll());
    expect(dto.contactInfo?.mailingAddress?.city).toBe('Lalitpur');
    expect(dto.contactInfo?.useMailingAddress).toBe(true);
    expect(dto.contactInfo?.phoneType).toBe('mobile');
  });

  it('returns all emergency contacts with their stored priorities', () => {
    const dto = studentEntityToDto(entityWithAll());
    expect(dto.emergencyContacts).toHaveLength(2);
    expect(dto.emergencyContacts?.map((c) => c.priority)).toEqual([1, 2]);
  });
});

describe('#504 — the singular-to-array emergency-contact migration', () => {
  function legacyEntity(over: Partial<Student> = {}): Student {
    return {
      tenantId: 't', entityKey: 'STUDENT#s', entityType: 'STUDENT', studentId: 's',
      firstName: 'A', lastName: 'B', dateOfBirth: '2012-01-01', gender: 'male',
      primarySchoolId: 'school-1', currentGradeLevel: '5', status: 'active',
      guardians: [],
      createdAt: '', updatedAt: '',
      ...over,
    } as unknown as Student;
  }

  it('reads the deprecated singular attribute for rows written before the array', () => {
    const dto = studentEntityToDto(legacyEntity({
      emergencyContact: { name: 'Legacy', relationship: 'aunt', phone: '+977980' },
    }));
    expect(dto.emergencyContacts).toHaveLength(1);
    expect(dto.emergencyContacts?.[0].name).toBe('Legacy');
  });

  it('defaults a legacy contact to priority 1, which is what it always implied', () => {
    const dto = studentEntityToDto(legacyEntity({
      emergencyContact: { name: 'Legacy', relationship: 'aunt', phone: '+977980' },
    }));
    expect(dto.emergencyContacts?.[0].priority).toBe(1);
  });

  it('prefers the array when BOTH attributes exist on a migrated row', () => {
    // A DDB SET-only update cannot remove the stale singular, so both coexist
    // after migration. Reading the singular first would resurrect the old
    // truncated contact and silently hide the real list.
    const dto = studentEntityToDto(legacyEntity({
      emergencyContact: { name: 'Stale Singular', relationship: 'aunt', phone: '+977980' },
      emergencyContacts: [
        { name: 'Current One', relationship: 'mother', phone: '+977981', priority: 1 },
        { name: 'Current Two', relationship: 'father', phone: '+977982', priority: 2 },
      ],
    }));
    expect(dto.emergencyContacts).toHaveLength(2);
    expect(dto.emergencyContacts?.[0].name).toBe('Current One');
  });
});

describe('#504 — updateStudentDtoToEntity carries the same fields on PATCH', () => {
  it.each(['suffix', 'stateStudentId', 'ethnicity', 'primaryLanguage', 'homeLanguage', 'countryOfBirth', 'previousSchool', 'notes', 'scholarshipAmountNpr', 'hasEcedExperience'])(
    'emits %s when the patch carries it',
    (field) => {
      const dto = { [field]: field === 'scholarshipAmountNpr' ? 500 : field === 'hasEcedExperience' ? true : 'v' } as unknown as UpdateStudentDto;
      const updates = updateStudentDtoToEntity(dto) as Record<string, unknown>;
      expect(updates[field]).toBeDefined();
    },
  );

  it('emits NOTHING for a field the patch omits, so a partial update stays partial', () => {
    const updates = updateStudentDtoToEntity({ notes: 'only this' } as unknown as UpdateStudentDto);
    expect(Object.keys(updates)).toEqual(['notes']);
  });

  it('replaces the whole emergency-contact array rather than truncating to the first', () => {
    const updates = updateStudentDtoToEntity({
      emergencyContacts: [
        { name: 'One', relationship: 'mother', phone: '+9779811111111', priority: 1 },
        { name: 'Two', relationship: 'father', phone: '+9779822222222', priority: 2 },
      ],
    } as unknown as UpdateStudentDto);
    expect(updates.emergencyContacts).toHaveLength(2);
  });

  it('carries the mailing address and its toggle off contactInfo', () => {
    const updates = updateStudentDtoToEntity({
      contactInfo: {
        mailingAddress: { street1: 'PO Box 9', city: 'Lalitpur', country: 'NPL' },
        useMailingAddress: true,
        phoneType: 'home',
      },
    } as unknown as UpdateStudentDto);
    expect(updates.mailingAddress?.city).toBe('Lalitpur');
    expect(updates.useMailingAddress).toBe(true);
    expect(updates.phoneType).toBe('home');
  });

  it('does NOT persist the eight Ed-Fi descriptors, which have an audited path of their own', () => {
    // `updateStudentSchema` declares them only because it derives from
    // `createStudentSchema.partial()`. S3.7 routes every descriptor edit
    // through PATCH /students/:id/descriptors so the
    // `student.descriptor.edited` IEMIS audit event always fires. Persisting
    // them here would create a second, UNAUDITED write path for Flash I/II
    // demographic data — a compliance regression, not a feature.
    const updates = updateStudentDtoToEntity({
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Male',
      languageDescriptor: 'uri://x#ne',
      motherTongueDescriptor: 'uri://x#ne',
      disabilities: ['none'],
      ethnicityDescriptor: 'uri://x#newar',
      isTransferred: true,
      belowPovertyLine: true,
      scholarshipCategory: 'dalit',
    } as unknown as UpdateStudentDto);

    expect(Object.keys(updates)).toHaveLength(0);
  });
});
