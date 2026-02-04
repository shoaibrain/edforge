/**
 * Domain Mapper for Ed-Fi TypeScript Models
 * Routes entities to their appropriate Ed-Fi domain folders based on naming patterns
 */

export type DomainName =
  | 'assessment'
  | 'student-identification-and-demographics'
  | 'education-organization'
  | 'staff'
  | 'teaching-and-learning'
  | 'bell-schedule'
  | 'student-academic-record'
  | 'finance'
  | 'calendar'
  | 'intervention'
  | 'discipline'
  | 'attendance'
  | 'special-education'
  | 'enrollment'
  | 'credential'
  | 'program'
  | 'master-schedule'
  | 'common';

/**
 * Maps entity names to their Ed-Fi domains
 * @param entityName - The entity name (e.g., "edFi_academicWeek" or "academicWeek")
 * @returns The domain folder name in kebab-case
 */
export function mapEntityToDomain(entityName: string): DomainName {
  // Remove edFi_ prefix if present
  const normalizedName = entityName.replace(/^edFi_/, '').toLowerCase();

  // Assessment domain
  if (normalizedName.startsWith('assessment')) {
    return 'assessment';
  }

  // Finance domain
  if (
    normalizedName.startsWith('balancesheet') ||
    normalizedName.startsWith('chartofaccount') ||
    normalizedName.startsWith('budget') ||
    normalizedName.startsWith('account') ||
    normalizedName.startsWith('contract') ||
    normalizedName.startsWith('fiscal') ||
    normalizedName.startsWith('fund') ||
    normalizedName.startsWith('journal') ||
    normalizedName.startsWith('payroll') ||
    normalizedName.startsWith('vendor')
  ) {
    return 'finance';
  }

  // Bell Schedule domain
  if (normalizedName.startsWith('bellschedule') || normalizedName.startsWith('bell')) {
    return 'bell-schedule';
  }

  // Calendar domain
  if (normalizedName.startsWith('calendar') || normalizedName.startsWith('academicweek')) {
    return 'calendar';
  }

  // Staff domain
  if (
    normalizedName.startsWith('staff') ||
    normalizedName.startsWith('teacher') ||
    normalizedName.startsWith('teachercandidate') ||
    normalizedName.startsWith('personnel')
  ) {
    return 'staff';
  }

  // Education Organization domain
  if (
    normalizedName.startsWith('school') ||
    normalizedName.startsWith('localeducationagency') ||
    normalizedName.startsWith('educationorganization') ||
    normalizedName.startsWith('educationorganizationnetwork') ||
    normalizedName.startsWith('educationorganizationinterventionprescription') ||
    normalizedName.startsWith('educationcommunityorganization') ||
    normalizedName.startsWith('educationcontent') ||
    normalizedName.startsWith('education') && !normalizedName.includes('student') && !normalizedName.includes('staff')
  ) {
    return 'education-organization';
  }

  // Teaching and Learning domain
  if (
    normalizedName.startsWith('section') ||
    normalizedName.startsWith('course') ||
    normalizedName.startsWith('classperiod') ||
    normalizedName.startsWith('learningstandard') ||
    normalizedName.startsWith('learningobjective') ||
    normalizedName.startsWith('gradebookentry') ||
    normalizedName.startsWith('grade') && !normalizedName.includes('level') ||
    normalizedName.startsWith('competencyobjective')
  ) {
    return 'teaching-and-learning';
  }

  // Student Academic Record domain
  if (
    normalizedName.startsWith('reportcard') ||
    normalizedName.startsWith('transcript') ||
    normalizedName.startsWith('studentgradebookentry') ||
    normalizedName.startsWith('grade') && normalizedName.includes('level') ||
    normalizedName.startsWith('graduationplan') ||
    normalizedName.startsWith('diploma') ||
    normalizedName.startsWith('studentcompetencyobjective')
  ) {
    return 'student-academic-record';
  }

  // Student Identification and Demographics domain
  if (
    normalizedName.startsWith('student') &&
    !normalizedName.includes('assessment') &&
    !normalizedName.includes('attendance') &&
    !normalizedName.includes('discipline') &&
    !normalizedName.includes('enrollment') &&
    !normalizedName.includes('program') &&
    !normalizedName.includes('intervention') &&
    !normalizedName.includes('specialeducation') &&
    !normalizedName.includes('gradebook') &&
    !normalizedName.includes('competency') &&
    !normalizedName.includes('reportcard') &&
    !normalizedName.includes('transcript')
  ) {
    return 'student-identification-and-demographics';
  }

  // Intervention domain
  if (
    normalizedName.startsWith('intervention') ||
    normalizedName.includes('intervention')
  ) {
    return 'intervention';
  }

  // Discipline domain
  if (
    normalizedName.startsWith('discipline') ||
    normalizedName.includes('disciplineincident') ||
    normalizedName.includes('disciplineaction')
  ) {
    return 'discipline';
  }

  // Attendance domain
  if (
    normalizedName.startsWith('attendance') ||
    normalizedName.includes('attendanceevent')
  ) {
    return 'attendance';
  }

  // Special Education domain
  if (
    normalizedName.startsWith('specialeducation') ||
    normalizedName.includes('specialeducation') ||
    normalizedName.startsWith('iep') ||
    normalizedName.includes('iep')
  ) {
    return 'special-education';
  }

  // Enrollment domain
  if (
    normalizedName.startsWith('enrollment') ||
    normalizedName.includes('enrollment') ||
    normalizedName.startsWith('withdrawal')
  ) {
    return 'enrollment';
  }

  // Credential domain
  if (
    normalizedName.startsWith('credential') ||
    normalizedName.includes('credential') ||
    normalizedName.startsWith('certification')
  ) {
    return 'credential';
  }

  // Program domain
  if (
    normalizedName.startsWith('program') ||
    normalizedName.includes('program') ||
    normalizedName.startsWith('studentprogramassociation')
  ) {
    return 'program';
  }

  // Master Schedule domain
  if (
    normalizedName.startsWith('masterschedule') ||
    normalizedName.includes('masterschedule')
  ) {
    return 'master-schedule';
  }

  // Default to common for unmapped entities
  return 'common';
}

/**
 * Get all domain names
 */
export function getAllDomains(): DomainName[] {
  return [
    'assessment',
    'student-identification-and-demographics',
    'education-organization',
    'staff',
    'teaching-and-learning',
    'bell-schedule',
    'student-academic-record',
    'finance',
    'calendar',
    'intervention',
    'discipline',
    'attendance',
    'special-education',
    'enrollment',
    'credential',
    'program',
    'master-schedule',
    'common',
  ];
}

