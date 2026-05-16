/**
 * C0.c.2 — Event taxonomy contract tests.
 *
 * Covers:
 *   - EVENT_REGISTRY completeness (the 22 events listed in the sprint plan)
 *   - listEventTypes returns the same set
 *   - Each registered schema parses a minimal happy-path payload
 *   - Each registered schema rejects `{}` (forces required-field discipline)
 *   - validateEvent narrows correctly on success
 *   - validateEvent returns UNKNOWN_EVENT_TYPE on unregistered eventType
 *   - validateEvent returns INVALID_PAYLOAD on registered but malformed event
 *
 * Pilot-agnostic per invariant 13.
 */

import {
  EVENT_REGISTRY,
  EventType,
  validateEvent,
  listEventTypes,
} from './taxonomy';

const PLAN_EVENT_TYPES: EventType[] = [
  // School (4)
  'school.created',
  'school.activated',
  'school.updated',
  'school.deactivated',
  // Academic Year (3)
  'academic_year.created',
  'academic_year.activated',
  'academic_year.completed',
  // Term (3)
  'term.created',
  'term.updated',
  'term.exam_scheduled',
  // Enrollment (4)
  'enrollment.created',
  'enrollment.promoted',
  'enrollment.retained',
  'enrollment.withdrawn',
  // Attendance (2)
  'attendance.recorded',
  'attendance.updated',
  // Exam (3)
  'exam.created',
  'exam.closed',
  'exam.published',
  // Result (1)
  'result.published',
  // Reporting (2)
  'reporting.submitted',
  'reporting.submission_due',
  // Calendar (3)
  'calendar.block_created',
  'calendar.block_updated',
  'calendar.block_deleted',
];

const BASE_ENVELOPE = {
  timestamp: '2026-05-15T12:00:00.000Z',
  tenantId: 'tenant-c0c2',
  sourceUserId: 'user-c0c2',
};

/**
 * Minimal happy-path payloads — one per registered event type. Each
 * carries only the required fields (envelope + domain). If a schema
 * later tightens, the corresponding entry MUST be updated; the
 * `acceptsMinimalPayload` test below fails on omission, surfacing the
 * dependency.
 */
const HAPPY_PATHS: Record<EventType, Record<string, unknown>> = {
  // School
  'school.created': {
    ...BASE_ENVELOPE,
    eventType: 'school.created',
    schoolId: 'school-1',
    schoolCode: 'SCH001',
    name: 'Test School',
    schoolType: 'elementary',
  },
  'school.activated': {
    ...BASE_ENVELOPE,
    eventType: 'school.activated',
    schoolId: 'school-1',
    activatedAt: '2026-05-15T12:00:00.000Z',
  },
  'school.updated': {
    ...BASE_ENVELOPE,
    eventType: 'school.updated',
    schoolId: 'school-1',
    updatedFields: ['name', 'principalName'],
  },
  'school.deactivated': {
    ...BASE_ENVELOPE,
    eventType: 'school.deactivated',
    schoolId: 'school-1',
    deactivatedAt: '2026-05-15T12:00:00.000Z',
  },
  // Academic Year
  'academic_year.created': {
    ...BASE_ENVELOPE,
    eventType: 'academic_year.created',
    schoolId: 'school-1',
    yearId: 'year-1',
    name: 'AY 2026-27',
    startDate: '2026-08-01',
    endDate: '2027-05-31',
    calendarType: 'semester',
  },
  'academic_year.activated': {
    ...BASE_ENVELOPE,
    eventType: 'academic_year.activated',
    schoolId: 'school-1',
    yearId: 'year-1',
    activatedAt: '2026-05-15T12:00:00.000Z',
  },
  'academic_year.completed': {
    ...BASE_ENVELOPE,
    eventType: 'academic_year.completed',
    schoolId: 'school-1',
    yearId: 'year-1',
    completedAt: '2026-05-15T12:00:00.000Z',
  },
  // Term
  'term.created': {
    ...BASE_ENVELOPE,
    eventType: 'term.created',
    schoolId: 'school-1',
    yearId: 'year-1',
    termId: 'term-1',
    name: 'Term 1',
    startDate: '2026-08-01',
    endDate: '2026-10-31',
  },
  'term.updated': {
    ...BASE_ENVELOPE,
    eventType: 'term.updated',
    schoolId: 'school-1',
    yearId: 'year-1',
    termId: 'term-1',
    updatedFields: ['name'],
  },
  'term.exam_scheduled': {
    ...BASE_ENVELOPE,
    eventType: 'term.exam_scheduled',
    schoolId: 'school-1',
    yearId: 'year-1',
    termId: 'term-1',
    examWindowStart: '2026-10-20',
    examWindowEnd: '2026-10-31',
  },
  // Enrollment
  'enrollment.created': {
    ...BASE_ENVELOPE,
    eventType: 'enrollment.created',
    enrollmentId: 'enr-1',
    studentId: 'std-1',
    schoolId: 'school-1',
    yearId: 'year-1',
    gradeLevel: '5',
    status: 'enrolled',
  },
  'enrollment.promoted': {
    ...BASE_ENVELOPE,
    eventType: 'enrollment.promoted',
    enrollmentId: 'enr-2',
    priorEnrollmentId: 'enr-1',
    studentId: 'std-1',
    schoolId: 'school-1',
    fromYearId: 'year-1',
    toYearId: 'year-2',
    fromGradeLevel: '5',
    toGradeLevel: '6',
  },
  'enrollment.retained': {
    ...BASE_ENVELOPE,
    eventType: 'enrollment.retained',
    enrollmentId: 'enr-2',
    priorEnrollmentId: 'enr-1',
    studentId: 'std-1',
    schoolId: 'school-1',
    yearId: 'year-2',
    gradeLevel: '5',
  },
  'enrollment.withdrawn': {
    ...BASE_ENVELOPE,
    eventType: 'enrollment.withdrawn',
    enrollmentId: 'enr-1',
    studentId: 'std-1',
    schoolId: 'school-1',
    withdrawnAt: '2026-05-15T12:00:00.000Z',
  },
  // Attendance
  'attendance.recorded': {
    ...BASE_ENVELOPE,
    eventType: 'attendance.recorded',
    attendanceId: 'att-1',
    enrollmentId: 'enr-1',
    schoolId: 'school-1',
    date: '2026-08-15',
    status: 'present',
  },
  'attendance.updated': {
    ...BASE_ENVELOPE,
    eventType: 'attendance.updated',
    attendanceId: 'att-1',
    enrollmentId: 'enr-1',
    schoolId: 'school-1',
    date: '2026-08-15',
    previousStatus: 'absent',
    newStatus: 'excused',
  },
  // Exam
  'exam.created': {
    ...BASE_ENVELOPE,
    eventType: 'exam.created',
    examId: 'exam-1',
    schoolId: 'school-1',
    yearId: 'year-1',
    termId: 'term-1',
    examName: 'Term 1 Exam',
    examType: 'terminal',
    startDate: '2026-10-20',
    endDate: '2026-10-31',
  },
  'exam.closed': {
    ...BASE_ENVELOPE,
    eventType: 'exam.closed',
    examId: 'exam-1',
    schoolId: 'school-1',
    termId: 'term-1',
    closedAt: '2026-11-01T00:00:00.000Z',
  },
  'exam.published': {
    ...BASE_ENVELOPE,
    eventType: 'exam.published',
    examId: 'exam-1',
    schoolId: 'school-1',
    termId: 'term-1',
    publishedAt: '2026-11-05T00:00:00.000Z',
  },
  // Result
  'result.published': {
    ...BASE_ENVELOPE,
    eventType: 'result.published',
    cardId: 'card-1',
    enrollmentId: 'enr-1',
    schoolId: 'school-1',
    termId: 'term-1',
    examId: 'exam-1',
    isTerminal: false,
    publishedAt: '2026-11-05T00:00:00.000Z',
  },
  // Reporting
  'reporting.submitted': {
    ...BASE_ENVELOPE,
    eventType: 'reporting.submitted',
    reportId: 'rpt-1',
    schoolId: 'school-1',
    yearId: 'year-1',
    reportType: 'IEMIS_NPL_CEHRD',
    submittedAt: '2027-04-01T00:00:00.000Z',
  },
  'reporting.submission_due': {
    ...BASE_ENVELOPE,
    eventType: 'reporting.submission_due',
    schoolId: 'school-1',
    yearId: 'year-1',
    reportType: 'IEMIS_NPL_CEHRD',
    dueDate: '2027-04-15',
  },
  // Calendar — multi-day block
  'calendar.block_created': {
    ...BASE_ENVELOPE,
    eventType: 'calendar.block_created',
    blockId: 'block-1',
    schoolId: 'school-1',
    yearId: 'year-1',
    blockName: 'Dashain',
    blockDescriptor: 'holiday',
    startDate: '2026-10-15',
    endDate: '2026-10-24',
    dateCount: 10,
  },
  'calendar.block_updated': {
    ...BASE_ENVELOPE,
    eventType: 'calendar.block_updated',
    blockId: 'block-1',
    schoolId: 'school-1',
    updatedFields: ['blockName'],
  },
  'calendar.block_deleted': {
    ...BASE_ENVELOPE,
    eventType: 'calendar.block_deleted',
    blockId: 'block-1',
    schoolId: 'school-1',
    deletedDateCount: 10,
  },
};

describe('EVENT_REGISTRY — completeness', () => {
  it('contains exactly the 25 plan-listed events (= 22 plan items, expanded)', () => {
    // The plan text says "~22 events"; the expansion counts to 25 — the
    // exam group has 3 (created/closed/published) and the calendar group
    // has 3 (block_c/u/d), both of which the plan list shows in full.
    expect(Object.keys(EVENT_REGISTRY).sort()).toEqual([...PLAN_EVENT_TYPES].sort());
  });

  it('listEventTypes returns the registry keys', () => {
    expect(listEventTypes().sort()).toEqual([...PLAN_EVENT_TYPES].sort());
  });

  it('every registry entry has a corresponding happy-path fixture in this spec', () => {
    const registryKeys = new Set(Object.keys(EVENT_REGISTRY));
    const fixtureKeys = new Set(Object.keys(HAPPY_PATHS));
    expect(fixtureKeys).toEqual(registryKeys);
  });
});

describe('EVENT_REGISTRY — per-schema happy / sad path', () => {
  it.each(PLAN_EVENT_TYPES)('%s accepts a minimal happy-path payload', (eventType) => {
    const payload = HAPPY_PATHS[eventType];
    const schema = EVENT_REGISTRY[eventType];
    const result = schema.safeParse(payload);
    if (!result.success) {
      // Surface the failed paths to make debugging trivial.
      throw new Error(
        `Schema for ${eventType} rejected its happy-path fixture: ` +
          JSON.stringify(result.error.issues, null, 2),
      );
    }
    expect(result.success).toBe(true);
  });

  it.each(PLAN_EVENT_TYPES)('%s rejects an empty object', (eventType) => {
    const schema = EVENT_REGISTRY[eventType];
    expect(schema.safeParse({}).success).toBe(false);
  });
});

describe('validateEvent', () => {
  it('returns success and narrows to DomainEvent on a valid payload', () => {
    // Cast: fixture maps lose the `eventType: string` constraint through
    // generic indexing; the field IS present (asserted elsewhere) so the
    // cast is safe.
    const result = validateEvent(
      HAPPY_PATHS['school.created'] as { eventType: string; [k: string]: unknown },
    );
    expect(result.success).toBe(true);
    if (result.success) {
      // TypeScript narrowing — `result.data.eventType` should be the literal.
      expect(result.data.eventType).toBe('school.created');
    }
  });

  it('returns UNKNOWN_EVENT_TYPE on an unregistered eventType', () => {
    const result = validateEvent({
      ...BASE_ENVELOPE,
      eventType: 'not.a.real.event',
    });
    expect(result).toEqual({
      success: false,
      error: 'UNKNOWN_EVENT_TYPE',
      eventType: 'not.a.real.event',
    });
  });

  it('returns INVALID_PAYLOAD on registered but malformed event', () => {
    const result = validateEvent({
      eventType: 'school.created',
      // missing required envelope fields + schoolId/code/name/schoolType
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('INVALID_PAYLOAD');
      if (result.error === 'INVALID_PAYLOAD') {
        expect(result.eventType).toBe('school.created');
        // Required-field violations should be detected — at least timestamp,
        // tenantId, and the school-specific fields.
        const paths = result.details.issues.map((i) => i.path.join('.'));
        expect(paths).toEqual(expect.arrayContaining(['timestamp', 'tenantId']));
      }
    }
  });
});
