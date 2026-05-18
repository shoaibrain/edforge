/**
 * CalendarDate entity ↔ response-schema contract test
 *
 * **Why this test exists.** Sprint C4 introduced four block-association
 * fields on the CalendarDate entity (`blockId`, `blockName`,
 * `blockDescriptor`, `subEventName`) — but those fields were missed in
 * the response Zod schema (`calendarDateResponseSchema`) for ~weeks.
 * Result: the frontend couldn't render multi-day-block context on the
 * calendar grid without a second `GET /calendar-blocks` round-trip per
 * date. Fixed in Sprint C4-FE PR A by adding the fields to the schema.
 *
 * **What this test prevents.** Any future field added to the
 * `CalendarDate` entity must either:
 *   1. Appear in `calendarDateResponseSchema` (visible to API consumers), OR
 *   2. Be listed in `INTERNAL_ONLY_FIELDS` below with a reason (DDB index
 *      keys, framework metadata, etc. that intentionally stay server-side).
 *
 * If a new entity field doesn't match either case, this test fails and
 * forces the author to decide: project the field, or document why it's
 * internal-only.
 *
 * Pattern is reusable — apply to other entities (Staff, Student,
 * AcademicYear, Term, BellSchedule, CalendarBlock) as a follow-up.
 */

import { calendarDateResponseSchema } from '@aibrains/shared-types';
import { createCalendarDateEntity } from '../calendar-date.entity';

/**
 * Fields that exist on the entity but are intentionally NOT projected
 * into the API response. Each entry needs a one-liner reason so future
 * contributors understand the exclusion.
 */
const INTERNAL_ONLY_FIELDS = new Set<string>([
  // DDB primary key components — composite of (tenantId, entityKey).
  // Consumers identify dates by (schoolId, date) via `calendarDateId`.
  'tenantId',
  'entityKey',

  // Entity-type discriminator — internal sentinel used by DDB queries
  // (entityType === 'CALENDARDATE'). Not useful to API consumers.
  'entityType',

  // Optimistic-concurrency version — internal to the write path.
  'version',

  // GSI1 keys — populated for the AY-date index lookup. Internal to
  // DDB query routing. Consumers don't see GSI shape.
  'gsi1pk',
  'gsi1sk',

  // GSI9 keys — populated only when blockId is set (sparse). Powers
  // the block→child-dates query for cascade-delete. Internal.
  'gsi9pk',
  'gsi9sk',

  // BaseEntity audit fields — created/updated By + At. The schema
  // exposes the timestamps but not the actor IDs, by design (audit
  // log is the canonical source of "who"; this would just duplicate).
  'createdBy',
  'updatedBy',
]);

describe('CalendarDate entity ↔ calendarDateResponseSchema contract', () => {
  // Build a fully-populated entity to enumerate every possible field.
  // Note: this uses the factory so optional fields default sensibly.
  const sampleEntity = createCalendarDateEntity('t1', 's1', {
    date: '2026-10-17',
    academicYearId: 'ay1',
    calendarEvents: [],
    isInstructionalDay: true,
    isHoliday: false,
    isWeekend: false,
    dayOfWeek: 'saturday',
    // Set every optional field so the entity dump includes them.
    calendarId: 'c1',
    bellScheduleId: 'b1',
    bellScheduleName: 'Regular',
    gradingPeriodId: 'gp1',
    gradingPeriodName: 'Term 1',
    dayNumber: 1,
    instructionalDayNumber: 1,
    notes: 'sample',
    blockId: 'block-1',
    blockName: 'Dashain',
    blockDescriptor: 'religious_festival',
    subEventName: 'Mahaastami',
    createdAt: '2026-01-01T00:00:00Z',
    createdBy: 'user1',
    updatedAt: '2026-01-01T00:00:00Z',
    updatedBy: 'user1',
    version: 1,
  });

  const entityFields = Object.keys(sampleEntity);
  const schemaShape = calendarDateResponseSchema.shape;
  const schemaFields = new Set(Object.keys(schemaShape));

  describe('every entity field is either projected or explicitly internal-only', () => {
    for (const field of entityFields) {
      it(`field "${field}" — projected in schema OR in INTERNAL_ONLY_FIELDS`, () => {
        const isProjected = schemaFields.has(field);
        const isInternal = INTERNAL_ONLY_FIELDS.has(field);

        if (!isProjected && !isInternal) {
          throw new Error(
            `Entity field "${field}" is neither projected in calendarDateResponseSchema ` +
              `nor listed in INTERNAL_ONLY_FIELDS. Either:\n` +
              `  1. Add it to calendarDateResponseSchema (preferred — makes it visible to the FE), OR\n` +
              `  2. Add it to INTERNAL_ONLY_FIELDS in this spec with a one-line reason explaining ` +
              `why it stays server-side.`,
          );
        }

        expect(isProjected || isInternal).toBe(true);
      });
    }
  });

  describe('the four Sprint C4 block-association fields are projected', () => {
    // Direct assertion that the C4 fields specifically reach the FE,
    // independent of the generic field-coverage scan above. If someone
    // accidentally removes the schema entries, this test fails loudly.
    it.each([
      ['blockId'],
      ['blockName'],
      ['blockDescriptor'],
      ['subEventName'],
    ])('"%s" is in calendarDateResponseSchema', (field) => {
      expect(schemaFields.has(field)).toBe(true);
    });
  });

  describe('INTERNAL_ONLY_FIELDS sanity — every entry exists on the entity', () => {
    // Prevent the allowlist from drifting: every name in
    // INTERNAL_ONLY_FIELDS must reference a real entity field.
    for (const field of INTERNAL_ONLY_FIELDS) {
      it(`"${field}" exists on the CalendarDate entity`, () => {
        expect(entityFields).toContain(field);
      });
    }
  });
});
