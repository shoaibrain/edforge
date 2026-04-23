/**
 * Sprint 3 — StudentSchoolAssociation + SchoolYearType mapper tests.
 */

import {
  academicYearToSchoolYearType,
  buildStudentSchoolAssociationId,
  enrollmentToStudentSchoolAssociation,
  studentSchoolAssociationSchema,
  type EnrollmentForSsaProjection,
} from './student-school-association.mapper';

const baseEnrollment: EnrollmentForSsaProjection = {
  tenantId: 'tenant-abc',
  studentId: 'student-uuid-1',
  schoolId: '00000000-0000-0000-0000-000000000001',
  academicYearId: 'year-uuid-1',
  enrollmentId: 'enr-1',
  gradeLevel: '5',
  entryDate: '2025-04-15',
  entryGradeLevelDescriptor:
    'uri://ed-fi.org/GradeLevelDescriptor#FifthGrade',
  primarySchool: true,
};

describe('academicYearToSchoolYearType', () => {
  it('prefers startYearBS when present', () => {
    const out = academicYearToSchoolYearType({
      startYearBS: 2082,
      startYear: 2025,
      name: '2082-2083',
    });
    expect(out?.schoolYear).toBe(2082);
    expect(out?.schoolYearDescription).toBe('2082-2083');
  });

  it('falls back to startYear when BS not set', () => {
    const out = academicYearToSchoolYearType({
      startYear: 2025,
      name: '2025-2026',
    });
    expect(out?.schoolYear).toBe(2025);
  });

  it('parses year from name as last resort', () => {
    const out = academicYearToSchoolYearType({ name: '2083-2084' });
    expect(out?.schoolYear).toBe(2083);
    expect(out?.schoolYearDescription).toBe('2083-2084');
  });

  it('returns null when no year info is available', () => {
    expect(academicYearToSchoolYearType({})).toBeNull();
    expect(academicYearToSchoolYearType({ name: 'SY' })).toBeNull();
  });
});

describe('enrollmentToStudentSchoolAssociation', () => {
  it('projects the minimum required fields', () => {
    const ssa = enrollmentToStudentSchoolAssociation(baseEnrollment, null);
    expect(ssa.studentSchoolAssociationId).toBe(
      `SSA#${baseEnrollment.schoolId}#${baseEnrollment.academicYearId}#${baseEnrollment.studentId}`,
    );
    expect(ssa.studentUniqueId).toBe(baseEnrollment.studentId);
    expect(ssa.entryDate).toBe('2025-04-15');
    expect(ssa.primarySchool).toBe(true);
    expect(ssa.schoolYear).toBeUndefined();
    expect(studentSchoolAssociationSchema.safeParse(ssa).success).toBe(true);
  });

  it('embeds the schoolYear reference when AcademicYear is provided', () => {
    const ssa = enrollmentToStudentSchoolAssociation(baseEnrollment, {
      startYearBS: 2082,
      name: '2082-2083',
    });
    expect(ssa.schoolYear?.schoolYear).toBe(2082);
    expect(ssa.schoolYear?.schoolYearDescription).toBe('2082-2083');
  });

  it('defaults primarySchool to true when enrollment field is missing', () => {
    const { primarySchool: _, ...trimmed } = baseEnrollment;
    const ssa = enrollmentToStudentSchoolAssociation(trimmed, null);
    expect(ssa.primarySchool).toBe(true);
  });

  it('passes through exit fields and withdraw-type descriptor', () => {
    const enrollment: EnrollmentForSsaProjection = {
      ...baseEnrollment,
      exitWithdrawDate: '2026-02-01',
      exitWithdrawTypeDescriptor:
        'uri://ed-fi.org/ExitWithdrawTypeDescriptor#TransferredToOtherSchool',
    };
    const ssa = enrollmentToStudentSchoolAssociation(enrollment, null);
    expect(ssa.exitWithdrawDate).toBe('2026-02-01');
    expect(ssa.exitWithdrawTypeDescriptor).toBe(
      'uri://ed-fi.org/ExitWithdrawTypeDescriptor#TransferredToOtherSchool',
    );
  });

  it('rejects a projection whose descriptors do NOT exist in the catalog', () => {
    const enrollment: EnrollmentForSsaProjection = {
      ...baseEnrollment,
      entryGradeLevelDescriptor:
        'uri://ed-fi.org/GradeLevelDescriptor#Bogus',
    };
    const ssa = enrollmentToStudentSchoolAssociation(enrollment, null);
    const parsed = studentSchoolAssociationSchema.safeParse(ssa);
    expect(parsed.success).toBe(false);
  });
});

describe('buildStudentSchoolAssociationId', () => {
  it('mirrors the Enrollment SK format', () => {
    expect(
      buildStudentSchoolAssociationId({
        schoolId: 'sch',
        academicYearId: 'yr',
        studentId: 'stu',
      }),
    ).toBe('SSA#sch#yr#stu');
  });
});
