/**
 * LILI-BUG #504 — contract conformance for the student create path.
 *
 * `student.mapper.field-persistence.spec.ts` pins the 14 fields this issue
 * found by name. This spec exists so the NEXT one is caught automatically.
 *
 * The failure mode was structural, not a typo: `createStudentDtoToEntity`
 * builds an object literal, and `students.service.ts` then copies that into a
 * SECOND hand-maintained allow-list before writing. A field has to be named in
 * both. Every field added to the contract since has had to be remembered in two
 * places, and twice it was not — Sprint D0a.4's descriptors, then these 14.
 *
 * So rather than assert a field list, this enumerates
 * `createStudentSchema.shape` — the published contract itself — and requires
 * every declared field to be either persisted or explicitly excluded with a
 * reason. Adding a field to the contract and forgetting the allow-list fails
 * here, naming the field.
 *
 * The oracle is the item handed to `putItem`, not the response DTO: the
 * response omits fields by design, which is precisely the instrument that
 * produced a confident wrong answer during the original investigation.
 */

import { Logger } from '@nestjs/common';
import { createStudentSchema } from '@aibrains/shared-types';
import type { CreateStudentDto } from '@aibrains/shared-types';
import { StudentsService } from './students.service';

/**
 * Declared field → the entity attribute(s) that must carry it.
 *
 * Most map 1:1. `schoolId` is renamed, and `contactInfo` is flattened.
 */
const PERSISTED_AS: Record<string, string[]> = {
  firstName: ['firstName'],
  lastName: ['lastName'],
  middleName: ['middleName'],
  preferredName: ['preferredName'],
  suffix: ['suffix'],
  dateOfBirth: ['dateOfBirth'],
  gender: ['gender'],
  schoolId: ['primarySchoolId'],
  currentGradeLevel: ['currentGradeLevel'],
  stateStudentId: ['stateStudentId'],
  emisStudentId: ['emisStudentId'],
  // Honoured when supplied so a school can migrate its existing numbering;
  // generated otherwise. Uniqueness is validated only on the supplied path.
  studentNumber: ['studentNumber'],
  contactInfo: ['email', 'phone', 'phoneType', 'address', 'mailingAddress', 'useMailingAddress'],
  guardians: ['guardians'],
  emergencyContacts: ['emergencyContacts'],
  medicalInfo: ['medicalInfo'],
  specialPrograms: ['specialPrograms'],
  accommodations: ['accommodations'],
  ethnicity: ['ethnicity'],
  primaryLanguage: ['primaryLanguage'],
  homeLanguage: ['homeLanguage'],
  countryOfBirth: ['countryOfBirth'],
  sexDescriptor: ['sexDescriptor'],
  languageDescriptor: ['languageDescriptor'],
  motherTongueDescriptor: ['motherTongueDescriptor'],
  disabilities: ['disabilities'],
  ethnicityDescriptor: ['ethnicityDescriptor'],
  isTransferred: ['isTransferred'],
  belowPovertyLine: ['belowPovertyLine'],
  scholarshipCategory: ['scholarshipCategory'],
  scholarshipAmountNpr: ['scholarshipAmountNpr'],
  hasEcedExperience: ['hasEcedExperience'],
  previousSchool: ['previousSchool'],
  notes: ['notes'],
};

/** Declared but deliberately not taken from the caller's payload on create. */
const NOT_FROM_PAYLOAD_ON_CREATE: Record<string, string> = {
  enrollmentDate:
    'forced undefined — a created student starts `pending` and is enrolled by a separate action that stamps the date',
};

const ctx = {
  tenantId: 'tenant-a',
  userId: 'user-admin',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  username: 'admin',
} as unknown as Parameters<StudentsService['createStudent']>[1];

function fullDto(): CreateStudentDto {
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
    studentNumber: 'CLIENT-SUPPLIED',
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
    guardians: [
      { firstName: 'Guardian', lastName: 'One', relationship: 'mother', phone: '+9779833333333', isPrimary: true },
    ],
    emergencyContacts: [
      { name: 'First Contact', relationship: 'mother', phone: '+9779811111111', priority: 1 },
      { name: 'Second Contact', relationship: 'uncle', phone: '+9779822222222', priority: 2 },
    ],
    medicalInfo: { allergies: ['peanuts'], conditions: [], medications: [] },
    specialPrograms: ['sp'],
    accommodations: ['acc'],
    ethnicity: 'Newar',
    primaryLanguage: 'Nepali',
    homeLanguage: 'Newari',
    countryOfBirth: 'NPL',
    sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Male',
    languageDescriptor: 'uri://ed-fi.org/LanguageDescriptor#ne',
    motherTongueDescriptor: 'uri://ed-fi.org/LanguageDescriptor#new',
    disabilities: ['none'],
    ethnicityDescriptor: 'uri://ed-fi.org/EthnicityDescriptor#newar',
    isTransferred: true,
    belowPovertyLine: true,
    scholarshipCategory: 'dalit',
    scholarshipAmountNpr: 12500,
    hasEcedExperience: true,
    enrollmentDate: '2026-04-15',
    previousSchool: 'Previous School',
    notes: 'Operator note',
  } as unknown as CreateStudentDto;
}

function buildService() {
  const putItem = jest.fn().mockResolvedValue(undefined);
  const dynamoDBClient = {
    getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
    getItem: jest.fn().mockResolvedValue(null),
    putItem,
    query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
  };
  const identityClient = {
    getSchool: jest.fn().mockResolvedValue({
      schoolId: 'school-1',
      schoolCode: 'WHS',
      name: 'Test School',
      schoolType: 'elementary',
      gradeRange: { start: '1', end: '10' },
      status: 'active',
      timezone: 'Asia/Kathmandu',
      locale: 'ne-NP',
      academicCalendarType: 'annual',
    }),
    createPortalUser: jest.fn().mockResolvedValue(null),
  };
  const studentIdService = { generateStudentUniqueId: jest.fn().mockResolvedValue('WHS-2026-00001') };
  const eventsService = { publishStudentCreated: jest.fn().mockResolvedValue(undefined) };

  const service = new StudentsService(
    ...([
      dynamoDBClient, eventsService, identityClient, studentIdService, {}, {}, {},
    ] as unknown as ConstructorParameters<typeof StudentsService>),
  );
  return { service, putItem };
}

/** The item actually handed to DynamoDB — the only trustworthy oracle here. */
async function writtenItem(): Promise<Record<string, unknown>> {
  const { service, putItem } = buildService();
  await service.createStudent(fullDto(), ctx);
  expect(putItem).toHaveBeenCalledTimes(1);
  return putItem.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('#504 — every field the create contract declares is accounted for', () => {
  const declared = Object.keys(createStudentSchema.shape);

  it('the contract declares the field count this spec was written against', () => {
    // A bare tripwire: if this number moves, a field was added or removed and
    // the mapping table below needs a decision, not a silent pass.
    expect(declared.length).toBe(35);
  });

  it.each(Object.keys(createStudentSchema.shape))(
    '%s is either mapped to an entity attribute or excluded with a stated reason',
    (field) => {
      const known = field in PERSISTED_AS || field in NOT_FROM_PAYLOAD_ON_CREATE;
      // If this fails, a new contract field exists and nobody decided whether
      // it persists. That decision is the point — not this assertion.
      expect(known).toBe(true);
    },
  );
});

describe('#504 — a fully populated create actually writes every mapped field', () => {
  it.each(
    Object.entries(PERSISTED_AS).flatMap(([field, attrs]) => attrs.map((a) => [field, a] as const)),
  )('%s reaches the stored item as %s', async (_field, attribute) => {
    const item = await writtenItem();
    expect(item[attribute]).toBeDefined();
  });

  it('writes both emergency contacts, not just the first', async () => {
    const item = await writtenItem();
    expect(item.emergencyContacts).toHaveLength(2);
  });

  it('writes the mailing address separately from the residential one', async () => {
    const item = await writtenItem();
    expect((item.address as { city?: string }).city).toBe('Kathmandu');
    expect((item.mailingAddress as { city?: string }).city).toBe('Lalitpur');
  });
});

describe('#504 — the deliberate exclusions stay excluded', () => {
  it('honours a client-supplied studentNumber, so an existing numbering can migrate', async () => {
    const item = await writtenItem();
    expect(item.studentNumber).toBe('CLIENT-SUPPLIED');
  });

  it('generates a studentNumber when the payload omits one', async () => {
    const { service, putItem } = buildService();
    const dto = fullDto() as unknown as Record<string, unknown>;
    delete dto.studentNumber;
    await service.createStudent(dto as unknown as CreateStudentDto, ctx);
    expect((putItem.mock.calls[0][1] as Record<string, unknown>).studentNumber).toBe('WHS-2026-00001');
  });

  it('starts the student pending with no enrolment date, whatever the payload said', async () => {
    const item = await writtenItem();
    expect(item.status).toBe('pending');
    expect(item.enrollmentDate).toBeUndefined();
  });
});
