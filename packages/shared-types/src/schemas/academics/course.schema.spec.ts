/**
 * Curriculum single-subject rework — `subjectArea` (Ed-Fi V6 Core rollup) is now
 * OPTIONAL on create, because it is a derived projection of the granular
 * `academicSubject` (the archetype Edge). The "at least one of subjectArea /
 * academicSubject" invariant is enforced server-side (a zod .refine here would
 * make createCourseSchema a ZodEffects and break
 * `updateCourseSchema = createCourseSchema.partial().omit(...)`), so this spec
 * only pins the contract-level optionality.
 */

import { createCourseSchema } from './course.schema';

const base = {
  schoolId: '11111111-1111-1111-1111-111111111111',
  courseCode: 'NCF-NEP-G45',
  courseName: 'Nepali',
  courseType: 'required' as const,
  credits: 4,
  typicalDuration: 'year' as const,
  gradeLevels: ['4', '5'],
};

describe('createCourseSchema — subjectArea optionality (single-subject rework)', () => {
  it('accepts a course with only the granular academicSubject (subjectArea omitted)', () => {
    const parsed = createCourseSchema.parse({ ...base, academicSubject: 'nepali' });
    expect(parsed.academicSubject).toBe('nepali');
    expect(parsed.subjectArea).toBeUndefined();
  });

  it('accepts a course with only the coarse subjectArea (back-compat)', () => {
    const parsed = createCourseSchema.parse({ ...base, subjectArea: 'world_languages' });
    expect(parsed.subjectArea).toBe('world_languages');
  });

  it('parses with neither at the schema level (the EITHER-OR invariant is server-enforced)', () => {
    expect(() => createCourseSchema.parse(base)).not.toThrow();
  });

  it('updateCourseSchema (partial) still derives cleanly from createCourseSchema', async () => {
    const { updateCourseSchema } = await import('./course.schema');
    expect(() => updateCourseSchema.parse({ courseName: 'Nepali (rev)' })).not.toThrow();
  });
});
