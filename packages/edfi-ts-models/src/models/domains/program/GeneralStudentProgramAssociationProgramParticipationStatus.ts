export interface GeneralStudentProgramAssociationProgramParticipationStatus {
  /**
   * The student's program participation status.
   */
  participationStatusDescriptor: string;
  /**
   * The date the student's program participation status began.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  statusBeginDate: string;
  /**
   * The person, organization, or department that designated the participation status.
   */
  designatedBy?: string;
  /**
   * The date the student's program participation status ended.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  statusEndDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "credentialExtensions".
 */
export interface CredentialExtensions {
  tpdm?: TpdmCredentialExtension;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_credentialExtension".
 */
export interface TpdmCredentialExtension {
  /**
   * The process, program, or pathway used to obtain certification.
   */
  certificationRouteDescriptor?: string;
  /**
   * The current status of the credential (e.g., active, suspended, etc.).
   */
  credentialStatusDescriptor?: string;
  /**
   * The specific roles or positions within an organization that the credential is intended to authorize (e.g., Principal, Reading Specialist), typically associated with service and administrative certifications.
   */
  educatorRoleDescriptor?: string;
  /**
   * Indicator that the credential was granted under the authority of a national Board Certification.
   */
  boardCertificationIndicator?: boolean;
  /**
   * The title of the certification obtained by the educator.
   */
  certificationTitle?: string;
  /**
   * The month, day, and year on which the credential status was effective.
   */
  credentialStatusDate?: string;
  personReference?: EdFiPersonReference;
  /**
   * An unordered collection of credentialStudentAcademicRecords. Reference to the person's Student Academic Records for the school(s) with which the Credential is associated.
   */
  studentAcademicRecords?: TpdmCredentialStudentAcademicRecord[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_personReference".
 */
export interface EdFiPersonReference {
  /**
   * A unique alphanumeric code assigned to a person.
   */
  personId: string;
  /**
   * This descriptor defines the originating record source system for the person.
   */
  sourceSystemDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "link".
 */
export interface Link {
  /**
   * Describes the nature of the relationship to the referenced resource.
   */
  rel?: string;
  /**
   * The URL to the related resource.
   */
  href?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_credentialStudentAcademicRecord".
 */
export interface TpdmCredentialStudentAcademicRecord {
  studentAcademicRecordReference: EdFiStudentAcademicRecordReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAcademicRecordReference".
 */
export interface EdFiStudentAcademicRecordReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The identifier for the school year.
   */
  schoolYear: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  /**
   * The term for the session during the school year.
   */
  termDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_academicWeek".
 */
export interface EdFiAcademicWeek {
  id?: string;
  /**
   * The school label for the week.
   */
  weekIdentifier: string;
  schoolReference: EdFiSchoolReference;
  /**
   * The start date for the academic week.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The end date for the academic week.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate: string;
  /**
   * The total instructional days during the academic week.
   */
  totalInstructionalDays: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_schoolReference".
 */
export interface EdFiSchoolReference {
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_academicWeekReference".
 */
export interface EdFiAcademicWeekReference {
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  /**
   * The school label for the week.
   */
  weekIdentifier: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_accountabilityRating".
 */
export interface EdFiAccountabilityRating {
  id?: string;
  /**
   * The title of the rating.
   */
  ratingTitle: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  schoolYearTypeReference: EdFiSchoolYearTypeReference;
  /**
   * An accountability rating level, designation, or assessment.
   */
  rating: string;
  /**
   * The date the rating was awarded.
   */
  ratingDate?: string;
  /**
   * The organization that assessed the rating.
   */
  ratingOrganization?: string;
  /**
   * The program associated with the accountability rating (e.g., NCLB, AEIS).
   */
  ratingProgram?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationReference".
 */
export interface EdFiEducationOrganizationReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_schoolYearTypeReference".
 */
export interface EdFiSchoolYearTypeReference {
  /**
   * Key for School Year
   */
  schoolYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessment".
 */
export interface EdFiAssessment {
  id?: string;
  /**
   * An unordered collection of assessmentAcademicSubjects. The description of the content or subject area (e.g., arts, mathematics, reading, stenography, or a foreign language) of an assessment.
   */
  academicSubjects: EdFiAssessmentAcademicSubject[];
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier: string;
  /**
   * Namespace for the assessment.
   */
  namespace: string;
  educationOrganizationReference?: EdFiEducationOrganizationReference;
  /**
   * Indicates that the assessment is adaptive.
   */
  adaptiveAssessment?: boolean;
  /**
   * An unordered collection of assessmentAssessedGradeLevels. The grade level(s) for which an assessment is designed. The semantics of null is assumed to mean that the assessment is not associated with any grade level.
   */
  assessedGradeLevels?: EdFiAssessmentAssessedGradeLevel[];
  /**
   * The category of an assessment based on format and content.
   */
  assessmentCategoryDescriptor?: string;
  /**
   * The assessment family this assessment is a member of.
   */
  assessmentFamily?: string;
  /**
   * Identifies the form of the assessment, for example a regular versus makeup form, multiple choice versus constructed response, etc.
   */
  assessmentForm?: string;
  /**
   * The title or name of the assessment.
   */
  assessmentTitle: string;
  /**
   * The version identifier for the assessment.
   */
  assessmentVersion?: number;
  contentStandard?: EdFiAssessmentContentStandard;
  /**
   * An unordered collection of assessmentIdentificationCodes. A unique number or alphanumeric code assigned to an assessment by a school, school system, a state, or other agency or entity.
   */
  identificationCodes?: EdFiAssessmentIdentificationCode[];
  /**
   * An unordered collection of assessmentLanguages. An indication of the languages in which the assessment is designed.
   */
  languages?: EdFiAssessmentLanguage[];
  /**
   * The maximum raw score achievable across all assessment items that are correct and scored at the maximum.
   */
  maxRawScore?: number;
  /**
   * Reflects the specific nomenclature used for assessment.
   */
  nomenclature?: string;
  /**
   * An unordered collection of assessmentPerformanceLevels. Definition of the performance levels and the associated cut scores. Three styles are supported: 1. Specification of performance level by minimum and maximum score, 2. Specification of performance level by cut score, using only minimum score, 3. Specification of performance level without any mapping to scores.
   */
  performanceLevels?: EdFiAssessmentPerformanceLevel[];
  /**
   * An unordered collection of assessmentPeriods. The period or window in which an assessment is supposed to be administered.
   */
  periods?: EdFiAssessmentPeriod[];
  /**
   * An unordered collection of assessmentPlatformTypes. The platforms with which the assessment may be delivered.
   */
  platformTypes?: EdFiAssessmentPlatformType[];
  /**
   * An unordered collection of assessmentPrograms. The programs associated with the assessment.
   */
  programs?: EdFiAssessmentProgram[];
  /**
   * The month, day, and year that the conceptual design for the assessment was most recently revised substantially.
   */
  revisionDate?: string;
  /**
   * An unordered collection of assessmentScores. Definition of the scores to be expected from this assessment.
   */
  scores?: EdFiAssessmentScore[];
  /**
   * An unordered collection of assessmentSections. The Section(s) to which the assessment is associated.
   */
  sections?: EdFiAssessmentSection[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentAcademicSubject".
 */
export interface EdFiAssessmentAcademicSubject {
  /**
   * The description of the content or subject area (e.g., arts, mathematics, reading, stenography, or a foreign language) of an assessment.
   */
  academicSubjectDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentAssessedGradeLevel".
 */
export interface EdFiAssessmentAssessedGradeLevel {
  /**
   * The grade level(s) for which an assessment is designed. The semantics of null is assumed to mean that the assessment is not associated with any grade level.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentContentStandard".
 */
export interface EdFiAssessmentContentStandard {
  /**
   * The publication status of the document (i.e., Adopted, Draft, Published, Deprecated, Unknown).
   */
  publicationStatusDescriptor?: string;
  /**
   * The beginning of the period during which this learning standard document is intended for use.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The end of the period during which this learning standard document is intended for use.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * The date on which this content was first published.
   */
  publicationDate?: string;
  /**
   * The year at which this content was first published.
   */
  publicationYear?: number;
  /**
   * The name of the content standard, for example Common Core.
   */
  title: string;
  /**
   * An unambiguous reference to the standards using a network-resolvable URI.
   */
  uri?: string;
  /**
   * The version identifier for the content.
   */
  version?: string;
  mandatingEducationOrganizationReference?: EdFiEducationOrganizationReference;
  /**
   * An unordered collection of assessmentContentStandardAuthors. The person or organization chiefly responsible for the intellectual content of the standard.
   */
  authors?: EdFiAssessmentContentStandardAuthor[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentContentStandardAuthor".
 */
export interface EdFiAssessmentContentStandardAuthor {
  /**
   * The person or organization chiefly responsible for the intellectual content of the standard.
   */
  author: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentIdentificationCode".
 */
export interface EdFiAssessmentIdentificationCode {
  /**
   * A coding scheme that is used for identification and record-keeping purposes by schools, social services, or other agencies to refer to an assessment.
   */
  assessmentIdentificationSystemDescriptor: string;
  /**
   * The organization code or name assigning the assessment identification code.
   */
  assigningOrganizationIdentificationCode?: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment by a school, school system, state, or other agency or entity.
   */
  identificationCode: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentLanguage".
 */
export interface EdFiAssessmentLanguage {
  /**
   * An indication of the languages in which the assessment is designed.
   */
  languageDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentPerformanceLevel".
 */
export interface EdFiAssessmentPerformanceLevel {
  /**
   * The method that the instructor of the class uses to report the performance and achievement of all students. It may be a qualitative method such as individualized teacher comments or a quantitative method such as a letter or numerical grade. In some cases, more than one type of reporting method may be used.
   */
  assessmentReportingMethodDescriptor: string;
  /**
   * The performance level(s) defined for the assessment.
   */
  performanceLevelDescriptor: string;
  /**
   * The datatype of the result. The results can be expressed as a number, percentile, range, level, etc.
   */
  resultDatatypeTypeDescriptor?: string;
  /**
   * The maximum score to make the indicated level of performance.
   */
  maximumScore?: string;
  /**
   * The minimum score required to make the indicated level of performance.
   */
  minimumScore?: string;
  /**
   * The name of the indicator being measured for a collection of performance level values.
   */
  performanceLevelIndicatorName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentPeriod".
 */
export interface EdFiAssessmentPeriod {
  /**
   * The period of time in which an assessment is supposed to be administered (e.g., Beginning of Year, Middle of Year, End of Year).
   */
  assessmentPeriodDescriptor: string;
  /**
   * The first date the assessment is to be administered.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The last date the assessment is to be administered.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentPlatformType".
 */
export interface EdFiAssessmentPlatformType {
  /**
   * The platforms with which the assessment may be delivered.
   */
  platformTypeDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentProgram".
 */
export interface EdFiAssessmentProgram {
  programReference: EdFiProgramReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programReference".
 */
export interface EdFiProgramReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName: string;
  /**
   * The type of program.
   */
  programTypeDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentScore".
 */
export interface EdFiAssessmentScore {
  /**
   * The method that the administrator of the assessment uses to report the performance and achievement of all students. It may be a qualitative method such as performance level descriptors or a quantitative method such as a numerical grade or cut score. More than one type of reporting method may be used.
   */
  assessmentReportingMethodDescriptor: string;
  /**
   * The datatype of the result. The results can be expressed as a number, percentile, range, level, etc.
   */
  resultDatatypeTypeDescriptor?: string;
  /**
   * The maximum score possible on the assessment.
   */
  maximumScore?: string;
  /**
   * The minimum score possible on the assessment.
   */
  minimumScore?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentSection".
 */
export interface EdFiAssessmentSection {
  sectionReference: EdFiSectionReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_sectionReference".
 */
export interface EdFiSectionReference {
  /**
   * The local code assigned by the School that identifies the course offering provided for the instruction of students.
   */
  localCourseCode: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  /**
   * The identifier for the school year.
   */
  schoolYear: number;
  /**
   * The local identifier assigned to a section.
   */
  sectionIdentifier: string;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentAdministration".
 */
export interface EdFiAssessmentAdministration {
  id?: string;
  /**
   * The title or name of the assessment in the context of its administration.
   */
  administrationIdentifier: string;
  assessmentReference: EdFiAssessmentReference;
  assigningEducationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * An unordered collection of assessmentAdministrationAssessmentBatteryParts. A reference to the parts of the assessment battery that are offered in this administration of the assessment.
   */
  assessmentBatteryParts?: EdFiAssessmentAdministrationAssessmentBatteryPart[];
  /**
   * An unordered collection of assessmentAdministrationPeriods. The anticipated dates for the assessment or administration window.
   */
  periods?: EdFiAssessmentAdministrationPeriod[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentReference".
 */
export interface EdFiAssessmentReference {
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier: string;
  /**
   * Namespace for the assessment.
   */
  namespace: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentAdministrationAssessmentBatteryPart".
 */
export interface EdFiAssessmentAdministrationAssessmentBatteryPart {
  assessmentBatteryPartReference: EdFiAssessmentBatteryPartReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentBatteryPartReference".
 */
export interface EdFiAssessmentBatteryPartReference {
  /**
   * The name of the part of an assessment battery.
   */
  assessmentBatteryPartName: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier: string;
  /**
   * Namespace for the assessment.
   */
  namespace: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentAdministrationPeriod".
 */
export interface EdFiAssessmentAdministrationPeriod {
  /**
   * The month, day, and year for the start of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The month, day, and year for the end of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentAdministrationParticipation".
 */
export interface EdFiAssessmentAdministrationParticipation {
  id?: string;
  assessmentAdministrationReference: EdFiAssessmentAdministrationReference;
  participatingEducationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * An unordered collection of assessmentAdministrationParticipationAdministrationPointOfContacts. Pre-identified contacts for education organizations administering the assessment.
   */
  administrationPointOfContacts?: EdFiAssessmentAdministrationParticipationAdministrationPointOfContact[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentAdministrationReference".
 */
export interface EdFiAssessmentAdministrationReference {
  /**
   * The title or name of the assessment in the context of its administration.
   */
  administrationIdentifier: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier: string;
  /**
   * The identifier assigned to an education organization.
   */
  assigningEducationOrganizationId: number;
  /**
   * Namespace for the assessment.
   */
  namespace: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentAdministrationParticipationAdministrationPointOfContact".
 */
export interface EdFiAssessmentAdministrationParticipationAdministrationPointOfContact {
  /**
   * The email address for the contact.
   */
  electronicMailAddress: string;
  /**
   * The contact's first name.
   */
  firstName: string;
  /**
   * The contact's last name.
   */
  lastSurname: string;
  /**
   * The login ID for the user; used for security access control interface.
   */
  loginId?: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentBatteryPart".
 */
export interface EdFiAssessmentBatteryPart {
  id?: string;
  /**
   * The name of the part of an assessment battery.
   */
  assessmentBatteryPartName: string;
  assessmentReference: EdFiAssessmentReference;
  /**
   * An unordered collection of assessmentBatteryPartObjectiveAssessments. A reference to the objective assessment(s) that are administered by the assessment battery part.
   */
  objectiveAssessments?: EdFiAssessmentBatteryPartObjectiveAssessment[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentBatteryPartObjectiveAssessment".
 */
export interface EdFiAssessmentBatteryPartObjectiveAssessment {
  objectiveAssessmentReference: EdFiObjectiveAssessmentReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_objectiveAssessmentReference".
 */
export interface EdFiObjectiveAssessmentReference {
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier: string;
  /**
   * A unique number or alphanumeric code assigned to an objective assessment by a school, school system, a state, or other agency or entity.
   */
  identificationCode: string;
  /**
   * Namespace for the assessment.
   */
  namespace: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentItem".
 */
export interface EdFiAssessmentItem {
  id?: string;
  /**
   * A unique number or alphanumeric code assigned to a space, room, site, building, individual, organization, program, or institution by a school, school system, state, or other agency or entity.
   */
  identificationCode: string;
  assessmentReference: EdFiAssessmentReference;
  /**
   * Category or type of the assessment item.
   */
  assessmentItemCategoryDescriptor?: string;
  /**
   * The URI (typical a URL) pointing to the entry in an assessment item bank, which describes this content item.
   */
  assessmentItemURI?: string;
  /**
   * The duration allotted for the assessment item expressed in minutes.
   */
  expectedTimeAssessed?: string;
  /**
   * The text of the item.
   */
  itemText?: string;
  /**
   * An unordered collection of assessmentItemLearningStandards. Learning standard tested by this item.
   */
  learningStandards?: EdFiAssessmentItemLearningStandard[];
  /**
   * The maximum raw score achievable across all assessment items that are correct and scored at the maximum.
   */
  maxRawScore?: number;
  /**
   * Reflects the specific nomenclature used for assessment item.
   */
  nomenclature?: string;
  /**
   * An unordered collection of assessmentItemPossibleResponses. A possible response to an assessment item.
   */
  possibleResponses?: EdFiAssessmentItemPossibleResponse[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentItemLearningStandard".
 */
export interface EdFiAssessmentItemLearningStandard {
  learningStandardReference: EdFiLearningStandardReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_learningStandardReference".
 */
export interface EdFiLearningStandardReference {
  /**
   * The identifier for the specific learning standard (e.g., 111.15.3.1.A).
   */
  learningStandardId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentItemPossibleResponse".
 */
export interface EdFiAssessmentItemPossibleResponse {
  /**
   * The response value, often an option number or code value (e.g., 1, 2, A, B, true, false).
   */
  responseValue: string;
  /**
   * Indicates the response is correct.
   */
  correctResponse?: boolean;
  /**
   * Additional text provided to define the response value.
   */
  responseDescription?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentItemReference".
 */
export interface EdFiAssessmentItemReference {
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier: string;
  /**
   * A unique number or alphanumeric code assigned to a space, room, site, building, individual, organization, program, or institution by a school, school system, state, or other agency or entity.
   */
  identificationCode: string;
  /**
   * Namespace for the assessment.
   */
  namespace: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentScoreRangeLearningStandard".
 */
export interface EdFiAssessmentScoreRangeLearningStandard {
  id?: string;
  /**
   * An unordered collection of assessmentScoreRangeLearningStandardLearningStandards. Learning standard associated with the score range.
   */
  learningStandards: EdFiAssessmentScoreRangeLearningStandardLearningStandard[];
  /**
   * A unique number or alphanumeric code assigned to the score range associated with one or more learning standards.
   */
  scoreRangeId: string;
  assessmentReference: EdFiAssessmentReference;
  objectiveAssessmentReference?: EdFiObjectiveAssessmentReference;
  /**
   * The assessment reporting method defined (e.g., scale score, RIT scale score) associated with the referenced learning standard(s).
   */
  assessmentReportingMethodDescriptor?: string;
  /**
   * The maximum score in the score range.
   */
  maximumScore: string;
  /**
   * The minimum score in the score range.
   */
  minimumScore: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_assessmentScoreRangeLearningStandardLearningStandard".
 */
export interface EdFiAssessmentScoreRangeLearningStandardLearningStandard {
  learningStandardReference: EdFiLearningStandardReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_balanceSheetDimension".
 */
export interface EdFiBalanceSheetDimension {
  id?: string;
  /**
   * The code representation of the account balance sheet dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account balance sheet dimension is valid.
   */
  fiscalYear: number;
  /**
   * A description of the account balance sheet dimension.
   */
  codeName?: string;
  /**
   * An unordered collection of balanceSheetDimensionReportingTags. Optional tag for accountability reporting.
   */
  reportingTags?: EdFiBalanceSheetDimensionReportingTag[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_balanceSheetDimensionReportingTag".
 */
export interface EdFiBalanceSheetDimensionReportingTag {
  /**
   * Optional tag for accountability reporting.
   */
  reportingTagDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_balanceSheetDimensionReference".
 */
export interface EdFiBalanceSheetDimensionReference {
  /**
   * The code representation of the account balance sheet dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account balance sheet dimension is valid.
   */
  fiscalYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_bellSchedule".
 */
export interface EdFiBellSchedule {
  id?: string;
  /**
   * Name or title of the bell schedule.
   */
  bellScheduleName: string;
  /**
   * An unordered collection of bellScheduleClassPeriods. The class periods that compose this bell schedule.
   */
  classPeriods: EdFiBellScheduleClassPeriod[];
  schoolReference: EdFiSchoolReference;
  /**
   * An alternate name for the day (e.g., Red, Blue).
   */
  alternateDayName?: string;
  /**
   * An unordered collection of bellScheduleDates. The dates for which the bell schedule applies.
   */
  dates?: EdFiBellScheduleDate[];
  /**
   * An indication of the time of day the bell schedule ends.
   */
  endTime?: string;
  /**
   * An unordered collection of bellScheduleGradeLevels. The grade levels the particular bell schedule applies to.
   */
  gradeLevels?: EdFiBellScheduleGradeLevel[];
  /**
   * An indication of the time of day the bell schedule begins.
   */
  startTime?: string;
  /**
   * The total instructional time in minutes per day for the bell schedule.
   */
  totalInstructionalTime?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_bellScheduleClassPeriod".
 */
export interface EdFiBellScheduleClassPeriod {
  classPeriodReference: EdFiClassPeriodReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_classPeriodReference".
 */
export interface EdFiClassPeriodReference {
  /**
   * An indication of the portion of a typical daily session in which students receive instruction in a specified subject (e.g., morning, sixth period, block period, or AB schedules).
   */
  classPeriodName: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_bellScheduleDate".
 */
export interface EdFiBellScheduleDate {
  /**
   * The dates for which the bell schedule applies.
   */
  date: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_bellScheduleGradeLevel".
 */
export interface EdFiBellScheduleGradeLevel {
  /**
   * The grade levels the particular bell schedule applies to.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_calendar".
 */
export interface EdFiCalendar {
  id?: string;
  /**
   * The identifier for the calendar.
   */
  calendarCode: string;
  schoolReference: EdFiSchoolReference;
  schoolYearTypeReference: EdFiSchoolYearTypeReference;
  /**
   * Indicates the type of calendar.
   */
  calendarTypeDescriptor: string;
  /**
   * An unordered collection of calendarGradeLevels. Indicates the grade level associated with the calendar.
   */
  gradeLevels?: EdFiCalendarGradeLevel[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_calendarGradeLevel".
 */
export interface EdFiCalendarGradeLevel {
  /**
   * Indicates the grade level associated with the calendar.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_calendarDate".
 */
export interface EdFiCalendarDate {
  id?: string;
  /**
   * An unordered collection of calendarDateCalendarEvents. The type of scheduled or unscheduled event for the day.
   */
  calendarEvents: EdFiCalendarDateCalendarEvent[];
  /**
   * The month, day, and year of the calendar event.
   */
  date: string;
  calendarReference: EdFiCalendarReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_calendarDateCalendarEvent".
 */
export interface EdFiCalendarDateCalendarEvent {
  /**
   * The type of scheduled or unscheduled event for the day.
   */
  calendarEventDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_calendarReference".
 */
export interface EdFiCalendarReference {
  /**
   * The identifier for the calendar.
   */
  calendarCode: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  /**
   * The identifier for the school year associated with the calendar.
   */
  schoolYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_calendarDateReference".
 */
export interface EdFiCalendarDateReference {
  /**
   * The identifier for the calendar.
   */
  calendarCode: string;
  /**
   * The month, day, and year of the calendar event.
   */
  date: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  /**
   * The identifier for the school year associated with the calendar.
   */
  schoolYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_chartOfAccount".
 */
export interface EdFiChartOfAccount {
  id?: string;
  /**
   * SEA populated code value for the valid combination of account dimensions under which financials are reported.
   */
  accountIdentifier: string;
  /**
   * The fiscal year for the account
   */
  fiscalYear: number;
  balanceSheetDimensionReference?: EdFiBalanceSheetDimensionReference;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  functionDimensionReference?: EdFiFunctionDimensionReference;
  fundDimensionReference?: EdFiFundDimensionReference;
  objectDimensionReference?: EdFiObjectDimensionReference;
  operationalUnitDimensionReference?: EdFiOperationalUnitDimensionReference;
  programDimensionReference?: EdFiProgramDimensionReference;
  projectDimensionReference?: EdFiProjectDimensionReference;
  sourceDimensionReference?: EdFiSourceDimensionReference;
  /**
   * A descriptive name for the account.
   */
  accountName?: string;
  /**
   * The type of account used in accounting such as revenue, expenditure, or balance sheet.
   */
  accountTypeDescriptor: string;
  /**
   * An unordered collection of chartOfAccountReportingTags. Optional tag for accountability reporting.
   */
  reportingTags?: EdFiChartOfAccountReportingTag[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_functionDimensionReference".
 */
export interface EdFiFunctionDimensionReference {
  /**
   * The code representation of the account function dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account function dimension is valid.
   */
  fiscalYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_fundDimensionReference".
 */
export interface EdFiFundDimensionReference {
  /**
   * The code representation of the account fund dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account fund dimension is valid.
   */
  fiscalYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_objectDimensionReference".
 */
export interface EdFiObjectDimensionReference {
  /**
   * The code representation of the account object dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account object dimension is valid.
   */
  fiscalYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_operationalUnitDimensionReference".
 */
export interface EdFiOperationalUnitDimensionReference {
  /**
   * The code representation of the account operational unit dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account operational unit dimension is valid.
   */
  fiscalYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programDimensionReference".
 */
export interface EdFiProgramDimensionReference {
  /**
   * The code representation of the account program dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account program dimension is valid.
   */
  fiscalYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_projectDimensionReference".
 */
export interface EdFiProjectDimensionReference {
  /**
   * The code representation of the account project dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account project dimension is valid.
   */
  fiscalYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_sourceDimensionReference".
 */
export interface EdFiSourceDimensionReference {
  /**
   * The code representation of the account source dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account source dimension is valid.
   */
  fiscalYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_chartOfAccountReportingTag".
 */
export interface EdFiChartOfAccountReportingTag {
  /**
   * A descriptor used at the dimension and/or chart of account levels to demote specific state needs for reporting.
   */
  reportingTagDescriptor: string;
  /**
   * The value associated with the reporting tag.
   */
  tagValue?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_chartOfAccountReference".
 */
export interface EdFiChartOfAccountReference {
  /**
   * SEA populated code value for the valid combination of account dimensions under which financials are reported.
   */
  accountIdentifier: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The fiscal year for the account
   */
  fiscalYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_classPeriod".
 */
export interface EdFiClassPeriod {
  id?: string;
  /**
   * An indication of the portion of a typical daily session in which students receive instruction in a specified subject (e.g., morning, sixth period, block period, or AB schedules).
   */
  classPeriodName: string;
  schoolReference: EdFiSchoolReference;
  /**
   * An unordered collection of classPeriodMeetingTimes. The meeting time(s) for a class period.
   */
  meetingTimes?: EdFiClassPeriodMeetingTime[];
  /**
   * Indicator of whether this class period is used for official daily attendance. Alternatively, official daily attendance may be tied to a section.
   */
  officialAttendancePeriod?: boolean;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_classPeriodMeetingTime".
 */
export interface EdFiClassPeriodMeetingTime {
  /**
   * An indication of the time of day the meeting time ends.
   */
  endTime: string;
  /**
   * An indication of the time of day the meeting time begins.
   */
  startTime: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_cohort".
 */
export interface EdFiCohort {
  id?: string;
  /**
   * The name or ID for the cohort.
   */
  cohortIdentifier: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * The academic subject associated with an academic intervention.
   */
  academicSubjectDescriptor?: string;
  /**
   * The description of the cohort and its purpose.
   */
  cohortDescription?: string;
  /**
   * The scope of cohort (e.g., school, district, classroom).
   */
  cohortScopeDescriptor?: string;
  /**
   * The type of cohort (e.g., academic intervention, classroom breakout).
   */
  cohortTypeDescriptor: string;
  /**
   * An unordered collection of cohortPrograms. The (optional) program associated with this cohort (e.g., special education).
   */
  programs?: EdFiCohortProgram[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_cohortProgram".
 */
export interface EdFiCohortProgram {
  programReference: EdFiProgramReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_cohortReference".
 */
export interface EdFiCohortReference {
  /**
   * The name or ID for the cohort.
   */
  cohortIdentifier: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_communityOrganization".
 */
export interface EdFiCommunityOrganization {
  id?: string;
  /**
   * An unordered collection of educationOrganizationCategories. The classification of the education agency within the geographic boundaries of a state according to the level of administrative and operational control granted by the state.
   */
  categories: EdFiEducationOrganizationCategory[];
  /**
   * The identifier assigned to a community organization. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  communityOrganizationId: number;
  /**
   * An unordered collection of educationOrganizationAddresses. The set of elements that describes an address for the education entity, including the street address, city, state, ZIP code, and ZIP code + 4.
   */
  addresses?: EdFiEducationOrganizationAddress[];
  /**
   * An unordered collection of educationOrganizationIdentificationCodes. A unique number or alphanumeric code assigned to an education organization by a school, school system, a state, or other agency or entity.
   */
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  /**
   * An unordered collection of educationOrganizationIndicators. An indicator or metric of an education organization.
   */
  indicators?: EdFiEducationOrganizationIndicator[];
  /**
   * An unordered collection of educationOrganizationInstitutionTelephones. The 10-digit telephone number, including the area code, for the education entity.
   */
  institutionTelephones?: EdFiEducationOrganizationInstitutionTelephone[];
  /**
   * An unordered collection of educationOrganizationInternationalAddresses. The set of elements that describes the international physical location of the education entity.
   */
  internationalAddresses?: EdFiEducationOrganizationInternationalAddress[];
  /**
   * The full, legally accepted name of the institution.
   */
  nameOfInstitution: string;
  /**
   * The current operational status of the education organization (e.g., active, inactive).
   */
  operationalStatusDescriptor?: string;
  /**
   * A short name for the institution.
   */
  shortNameOfInstitution?: string;
  /**
   * The public web site address (URL) for the education organization.
   */
  webSite?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationCategory".
 */
export interface EdFiEducationOrganizationCategory {
  /**
   * The classification of the education agency within the geographic boundaries of a state according to the level of administrative and operational control granted by the state.
   */
  educationOrganizationCategoryDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationAddress".
 */
export interface EdFiEducationOrganizationAddress {
  /**
   * The type of address listed for an individual or organization.    For example:  Physical Address, Mailing Address, Home Address, etc.)
   */
  addressTypeDescriptor: string;
  /**
   * The abbreviation for the state (within the United States) or outlying area in which an address is located.
   */
  stateAbbreviationDescriptor: string;
  /**
   * The name of the city in which an address is located.
   */
  city: string;
  /**
   * The five or nine digit zip code or overseas postal code portion of an address.
   */
  postalCode: string;
  /**
   * The street number and street name or post office box number of an address.
   */
  streetNumberName: string;
  /**
   * A general geographic indicator that categorizes U.S. territory (e.g., City, Suburban).
   */
  localeDescriptor?: string;
  /**
   * The apartment, room, or suite number of an address.
   */
  apartmentRoomSuiteNumber?: string;
  /**
   * The number of the building on the site, if more than one building shares the same address.
   */
  buildingSiteNumber?: string;
  /**
   * The congressional district in which an address is located.
   */
  congressionalDistrict?: string;
  /**
   * The Federal Information Processing Standards (FIPS) numeric code for the county issued by the National Institute of Standards and Technology (NIST). Counties are considered to be the "first-order subdivisions" of each State and statistically equivalent entity, regardless of their local designations (county, parish, borough, etc.) Counties in different States will have the same code. A unique county number is created when combined with the 2-digit FIPS State Code.
   */
  countyFIPSCode?: string;
  /**
   * An indication that the address should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * The geographic latitude of the physical address.
   */
  latitude?: string;
  /**
   * The geographic longitude of the physical address.
   */
  longitude?: string;
  /**
   * The name of the county, parish, borough, or comparable unit (within a state) in which an address is located.
   */
  nameOfCounty?: string;
  /**
   * An unordered collection of educationOrganizationAddressPeriods. The time periods for which the address is valid. For physical addresses, the periods in which the person lived at that address.
   */
  periods?: EdFiEducationOrganizationAddressPeriod[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationAddressPeriod".
 */
export interface EdFiEducationOrganizationAddressPeriod {
  /**
   * The month, day, and year for the start of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The month, day, and year for the end of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationIdentificationCode".
 */
export interface EdFiEducationOrganizationIdentificationCode {
  /**
   * The school system, state, or agency assigning the identification code.
   */
  educationOrganizationIdentificationSystemDescriptor: string;
  /**
   * A unique number or alphanumeric code that is assigned to an education organization by a school, school system, state, or other agency or entity.
   */
  identificationCode: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationIndicator".
 */
export interface EdFiEducationOrganizationIndicator {
  /**
   * The name or code for the indicator or metric.
   */
  indicatorDescriptor: string;
  /**
   * The name for a group of indicators.
   */
  indicatorGroupDescriptor?: string;
  /**
   * The value of the indicator or metric, as a value from a controlled vocabulary. The semantics of an empty value is "not submitted."
   */
  indicatorLevelDescriptor?: string;
  /**
   * The person, organization, or department that defined the metric.
   */
  designatedBy?: string;
  /**
   * The value of the indicator or metric. The semantics of an empty value is "not submitted."
   */
  indicatorValue?: string;
  /**
   * An unordered collection of educationOrganizationIndicatorPeriods. The time period or as-of date for the indicator.
   */
  periods?: EdFiEducationOrganizationIndicatorPeriod[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationIndicatorPeriod".
 */
export interface EdFiEducationOrganizationIndicatorPeriod {
  /**
   * The month, day, and year for the start of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The month, day, and year for the end of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationInstitutionTelephone".
 */
export interface EdFiEducationOrganizationInstitutionTelephone {
  /**
   * The type of communication number listed for an individual or organization.
   */
  institutionTelephoneNumberTypeDescriptor: string;
  /**
   * The telephone number including the area code, and extension, if applicable.
   */
  telephoneNumber: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationInternationalAddress".
 */
export interface EdFiEducationOrganizationInternationalAddress {
  /**
   * The type of address listed for an individual or organization. For example:  Physical Address, Mailing Address, Home Address, etc.)
   */
  addressTypeDescriptor: string;
  /**
   * The name of the country. It is strongly recommended that entries use only ISO 3166 2-letter country codes.
   */
  countryDescriptor: string;
  /**
   * The first line of the address.
   */
  addressLine1: string;
  /**
   * The second line of the address.
   */
  addressLine2?: string;
  /**
   * The third line of the address.
   */
  addressLine3?: string;
  /**
   * The fourth line of the address.
   */
  addressLine4?: string;
  /**
   * The first date the address is valid. For physical addresses, the date the individual moved to that address.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The last date the address is valid. For physical addresses, the date the individual moved from that address.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * The geographic latitude of the physical address.
   */
  latitude?: string;
  /**
   * The geographic longitude of the physical address.
   */
  longitude?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_communityOrganizationReference".
 */
export interface EdFiCommunityOrganizationReference {
  /**
   * The identifier assigned to a community organization. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  communityOrganizationId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_communityProvider".
 */
export interface EdFiCommunityProvider {
  id?: string;
  /**
   * An unordered collection of educationOrganizationCategories. The classification of the education agency within the geographic boundaries of a state according to the level of administrative and operational control granted by the state.
   */
  categories: EdFiEducationOrganizationCategory[];
  /**
   * The identifier assigned to a community provider. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  communityProviderId: number;
  communityOrganizationReference?: EdFiCommunityOrganizationReference;
  /**
   * An unordered collection of educationOrganizationAddresses. The set of elements that describes an address for the education entity, including the street address, city, state, ZIP code, and ZIP code + 4.
   */
  addresses?: EdFiEducationOrganizationAddress[];
  /**
   * An unordered collection of educationOrganizationIdentificationCodes. A unique number or alphanumeric code assigned to an education organization by a school, school system, a state, or other agency or entity.
   */
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  /**
   * An unordered collection of educationOrganizationIndicators. An indicator or metric of an education organization.
   */
  indicators?: EdFiEducationOrganizationIndicator[];
  /**
   * An unordered collection of educationOrganizationInstitutionTelephones. The 10-digit telephone number, including the area code, for the education entity.
   */
  institutionTelephones?: EdFiEducationOrganizationInstitutionTelephone[];
  /**
   * An unordered collection of educationOrganizationInternationalAddresses. The set of elements that describes the international physical location of the education entity.
   */
  internationalAddresses?: EdFiEducationOrganizationInternationalAddress[];
  /**
   * An indication of whether the provider is exempt from having a license.
   */
  licenseExemptIndicator?: boolean;
  /**
   * The full, legally accepted name of the institution.
   */
  nameOfInstitution: string;
  /**
   * The current operational status of the education organization (e.g., active, inactive).
   */
  operationalStatusDescriptor?: string;
  /**
   * Indicates the category of the provider.
   */
  providerCategoryDescriptor: string;
  /**
   * Indicates the profitability status of the provider.
   */
  providerProfitabilityDescriptor?: string;
  /**
   * Indicates the status of the provider.
   */
  providerStatusDescriptor: string;
  /**
   * An indication of whether the community provider is a school.
   */
  schoolIndicator?: boolean;
  /**
   * A short name for the institution.
   */
  shortNameOfInstitution?: string;
  /**
   * The public web site address (URL) for the education organization.
   */
  webSite?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_communityProviderLicense".
 */
export interface EdFiCommunityProviderLicense {
  id?: string;
  /**
   * The unique identifier issued by the licensing organization.
   */
  licenseIdentifier: string;
  /**
   * The organization issuing the license.
   */
  licensingOrganization: string;
  communityProviderReference: EdFiCommunityProviderReference;
  /**
   * The maximum number that can be contained or accommodated which a provider is authorized or licensed to serve.
   */
  authorizedFacilityCapacity?: number;
  /**
   * The month, day, and year on which a license is active or becomes effective.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  licenseEffectiveDate: string;
  /**
   * The month, day, and year on which a license will expire.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  licenseExpirationDate?: string;
  /**
   * The month, day, and year on which an active license was issued.
   */
  licenseIssueDate?: string;
  /**
   * An indication of the status of the license.
   */
  licenseStatusDescriptor?: string;
  /**
   * An indication of the category of the license.
   */
  licenseTypeDescriptor: string;
  /**
   * The oldest age of children a provider is authorized or licensed to serve.
   */
  oldestAgeAuthorizedToServe?: number;
  /**
   * The youngest age of children a provider is authorized or licensed to serve.
   */
  youngestAgeAuthorizedToServe?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_communityProviderReference".
 */
export interface EdFiCommunityProviderReference {
  /**
   * The identifier assigned to a community provider. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  communityProviderId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_competencyObjective".
 */
export interface EdFiCompetencyObjective {
  id?: string;
  /**
   * The designated title of the competency objective.
   */
  objective: string;
  /**
   * The grade level for which the competency objective is targeted.
   */
  objectiveGradeLevelDescriptor: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * The Identifier for the competency objective.
   */
  competencyObjectiveId?: string;
  /**
   * The description of the student competency objective.
   */
  description?: string;
  /**
   * One or more statements that describes the criteria used by teachers and students to check for attainment of a competency objective. This criteria gives clear indications as to the degree to which learning is moving through the Zone or Proximal Development toward independent achievement of the competency objective.
   */
  successCriteria?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_competencyObjectiveReference".
 */
export interface EdFiCompetencyObjectiveReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The designated title of the competency objective.
   */
  objective: string;
  /**
   * The grade level for which the competency objective is targeted.
   */
  objectiveGradeLevelDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_contact".
 */
export interface EdFiContact {
  id?: string;
  /**
   * A unique alphanumeric code assigned to a contact.
   */
  contactUniqueId: string;
  personReference?: EdFiPersonReference;
  /**
   * An unordered collection of contactAddresses. Contact's address, if different from the student address.
   */
  addresses?: EdFiContactAddress[];
  /**
   * An unordered collection of contactElectronicMails. The numbers, letters, and symbols used to identify an electronic mail (e-mail) user within the network to which the individual or organization belongs.
   */
  electronicMails?: EdFiContactElectronicMail[];
  /**
   * A name given to an individual at birth, baptism, or during another naming ceremony, or through legal change.
   */
  firstName: string;
  /**
   * The gender the contact identifies themselves as.
   */
  genderIdentity?: string;
  /**
   * An appendage, if any, used to denote an individual's generation in his family (e.g., Jr., Sr., III).
   */
  generationCodeSuffix?: string;
  /**
   * The extent of formal instruction an individual has received (e.g., the highest grade in school completed or its equivalent or the highest degree received).
   */
  highestCompletedLevelOfEducationDescriptor?: string;
  /**
   * An unordered collection of contactInternationalAddresses. The set of elements that describes an international address.
   */
  internationalAddresses?: EdFiContactInternationalAddress[];
  /**
   * An unordered collection of contactLanguages. The language(s) the individual uses to communicate. It is strongly recommended that entries use only ISO 639-2 language codes.
   */
  languages?: EdFiContactLanguage[];
  /**
   * The name borne in common by members of a family.
   */
  lastSurname: string;
  /**
   * The login ID for the user; used for security access control interface.
   */
  loginId?: string;
  /**
   * The individual's maiden name.
   */
  maidenName?: string;
  /**
   * A secondary name given to an individual at birth, baptism, or during another naming ceremony.
   */
  middleName?: string;
  /**
   * An unordered collection of contactOtherNames. Other names (e.g., alias, nickname, previous legal name) associated with a person.
   */
  otherNames?: EdFiContactOtherName[];
  /**
   * An unordered collection of contactPersonalIdentificationDocuments. The documents presented as evident to verify one's personal identity; for example: drivers license, passport, birth certificate, etc.
   */
  personalIdentificationDocuments?: EdFiContactPersonalIdentificationDocument[];
  /**
   * A prefix used to denote the title, degree, position, or seniority of the individual.
   */
  personalTitlePrefix?: string;
  /**
   * The first name the individual prefers, if different from their legal first name
   */
  preferredFirstName?: string;
  /**
   * The last name the individual prefers, if different from their legal last name
   */
  preferredLastSurname?: string;
  /**
   * A person's birth sex.
   */
  sexDescriptor?: string;
  /**
   * An unordered collection of contactTelephones. The 10-digit telephone number, including the area code, for the person.
   */
  telephones?: EdFiContactTelephone[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_contactAddress".
 */
export interface EdFiContactAddress {
  /**
   * The type of address listed for an individual or organization.    For example:  Physical Address, Mailing Address, Home Address, etc.)
   */
  addressTypeDescriptor: string;
  /**
   * The abbreviation for the state (within the United States) or outlying area in which an address is located.
   */
  stateAbbreviationDescriptor: string;
  /**
   * The name of the city in which an address is located.
   */
  city: string;
  /**
   * The five or nine digit zip code or overseas postal code portion of an address.
   */
  postalCode: string;
  /**
   * The street number and street name or post office box number of an address.
   */
  streetNumberName: string;
  /**
   * A general geographic indicator that categorizes U.S. territory (e.g., City, Suburban).
   */
  localeDescriptor?: string;
  /**
   * The apartment, room, or suite number of an address.
   */
  apartmentRoomSuiteNumber?: string;
  /**
   * The number of the building on the site, if more than one building shares the same address.
   */
  buildingSiteNumber?: string;
  /**
   * The congressional district in which an address is located.
   */
  congressionalDistrict?: string;
  /**
   * The Federal Information Processing Standards (FIPS) numeric code for the county issued by the National Institute of Standards and Technology (NIST). Counties are considered to be the "first-order subdivisions" of each State and statistically equivalent entity, regardless of their local designations (county, parish, borough, etc.) Counties in different States will have the same code. A unique county number is created when combined with the 2-digit FIPS State Code.
   */
  countyFIPSCode?: string;
  /**
   * An indication that the address should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * The geographic latitude of the physical address.
   */
  latitude?: string;
  /**
   * The geographic longitude of the physical address.
   */
  longitude?: string;
  /**
   * The name of the county, parish, borough, or comparable unit (within a state) in which an address is located.
   */
  nameOfCounty?: string;
  /**
   * An unordered collection of contactAddressPeriods. The time periods for which the address is valid. For physical addresses, the periods in which the person lived at that address.
   */
  periods?: EdFiContactAddressPeriod[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_contactAddressPeriod".
 */
export interface EdFiContactAddressPeriod {
  /**
   * The month, day, and year for the start of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The month, day, and year for the end of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_contactElectronicMail".
 */
export interface EdFiContactElectronicMail {
  /**
   * The type of email listed for an individual or organization. For example: Home/Personal, Work, etc.)
   */
  electronicMailTypeDescriptor: string;
  /**
   * The electronic mail (e-mail) address listed for an individual or organization.
   */
  electronicMailAddress: string;
  /**
   * An indication that the electronic email address should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * An indication that the electronic mail address should be used as the principal electronic mail address for an individual or organization.
   */
  primaryEmailAddressIndicator?: boolean;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_contactInternationalAddress".
 */
export interface EdFiContactInternationalAddress {
  /**
   * The type of address listed for an individual or organization. For example:  Physical Address, Mailing Address, Home Address, etc.)
   */
  addressTypeDescriptor: string;
  /**
   * The name of the country. It is strongly recommended that entries use only ISO 3166 2-letter country codes.
   */
  countryDescriptor: string;
  /**
   * The first line of the address.
   */
  addressLine1: string;
  /**
   * The second line of the address.
   */
  addressLine2?: string;
  /**
   * The third line of the address.
   */
  addressLine3?: string;
  /**
   * The fourth line of the address.
   */
  addressLine4?: string;
  /**
   * The first date the address is valid. For physical addresses, the date the individual moved to that address.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The last date the address is valid. For physical addresses, the date the individual moved from that address.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * The geographic latitude of the physical address.
   */
  latitude?: string;
  /**
   * The geographic longitude of the physical address.
   */
  longitude?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_contactLanguage".
 */
export interface EdFiContactLanguage {
  /**
   * A specification of which written or spoken communication is being used.
   */
  languageDescriptor: string;
  /**
   * An unordered collection of contactLanguageUses. A description of how the language is used (e.g. Home Language, Native Language, Spoken Language).
   */
  uses?: EdFiContactLanguageUse[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_contactLanguageUse".
 */
export interface EdFiContactLanguageUse {
  /**
   * A description of how the language is used (e.g. Home Language, Native Language, Spoken Language).
   */
  languageUseDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_contactOtherName".
 */
export interface EdFiContactOtherName {
  /**
   * The types of alternate names for an individual.
   */
  otherNameTypeDescriptor: string;
  /**
   * A name given to an individual at birth, baptism, or during another naming ceremony, or through legal change.
   */
  firstName: string;
  /**
   * An appendage, if any, used to denote an individual's generation in his family (e.g., Jr., Sr., III).
   */
  generationCodeSuffix?: string;
  /**
   * The name borne in common by members of a family.
   */
  lastSurname: string;
  /**
   * A secondary name given to an individual at birth, baptism, or during another naming ceremony.
   */
  middleName?: string;
  /**
   * A prefix used to denote the title, degree, position, or seniority of the individual.
   */
  personalTitlePrefix?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_contactPersonalIdentificationDocument".
 */
export interface EdFiContactPersonalIdentificationDocument {
  /**
   * The primary function of the document used for establishing identity.
   */
  identificationDocumentUseDescriptor: string;
  /**
   * The category of the document relative to its purpose.
   */
  personalInformationVerificationDescriptor: string;
  /**
   * Country of origin of the document. It is strongly recommended that entries use only ISO 3166 2-letter country codes.
   */
  issuerCountryDescriptor?: string;
  /**
   * The day when the document  expires, if null then never expires.
   */
  documentExpirationDate?: string;
  /**
   * The title of the document given by the issuer.
   */
  documentTitle?: string;
  /**
   * The unique identifier on the issuer's identification system.
   */
  issuerDocumentIdentificationCode?: string;
  /**
   * Name of the entity or institution that issued the document.
   */
  issuerName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_contactTelephone".
 */
export interface EdFiContactTelephone {
  /**
   * The type of communication number listed for an individual or organization.
   */
  telephoneNumberTypeDescriptor: string;
  /**
   * The telephone number including the area code, and extension, if applicable.
   */
  telephoneNumber: string;
  /**
   * An indication that the telephone number should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * The order of priority assigned to telephone numbers to define which number to attempt first, second, etc.
   */
  orderOfPriority?: number;
  /**
   * An indication that the telephone number is technically capable of sending and receiving Short Message Service (SMS) text messages.
   */
  textMessageCapabilityIndicator?: boolean;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_contactReference".
 */
export interface EdFiContactReference {
  /**
   * A unique alphanumeric code assigned to a contact.
   */
  contactUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_course".
 */
export interface EdFiCourse {
  id?: string;
  /**
   * A unique alphanumeric code assigned to a course.
   */
  courseCode: string;
  /**
   * An unordered collection of courseIdentificationCodes. The code that identifies the organization of subject matter and related learning experiences provided for the instruction of students.
   */
  identificationCodes: EdFiCourseIdentificationCode[];
  educationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * An unordered collection of courseAcademicSubjects. The intended major subject/s area of the course.
   */
  academicSubjects?: EdFiCourseAcademicSubject[];
  /**
   * Indicates the career cluster or pathway the course is associated with as part of a CTE curriculum.
   */
  careerPathwayDescriptor?: string;
  /**
   * An unordered collection of courseCompetencyLevels. The competency levels defined to rate the student for the course.
   */
  competencyLevels?: EdFiCourseCompetencyLevel[];
  /**
   * Specifies whether the course was defined by the SEA, LEA, School, or national organization.
   */
  courseDefinedByDescriptor?: string;
  /**
   * A description of the content standards and goals covered in the course. Reference may be made to state or national content standards.
   */
  courseDescription?: string;
  /**
   * An indicator of whether or not the course being described is included in the computation of the student's grade point average, and if so, if it is weighted differently from regular courses.
   */
  courseGPAApplicabilityDescriptor?: string;
  /**
   * The descriptive name given to a course of study offered in a school or other institution or organization. In departmentalized classes at the elementary, secondary, and postsecondary levels (and for staff development activities), this refers to the name by which a course is identified (e.g., American History, English III). For elementary and other non-departmentalized classes, it refers to any portion of the instruction for which a grade or report is assigned (e.g., reading, composition, spelling, and language arts).
   */
  courseTitle: string;
  /**
   * Date the course was adopted by the education agency.
   */
  dateCourseAdopted?: string;
  /**
   * An indication that this course may satisfy high school graduation requirements in the course's subject area.
   */
  highSchoolCourseRequirement?: boolean;
  /**
   * An unordered collection of courseLearningStandards. Learning standard(s) to be taught by the course.
   */
  learningStandards?: EdFiCourseLearningStandard[];
  /**
   * An unordered collection of courseLevelCharacteristics. The type of specific program or designation with which the course is associated (e.g., AP, IB, Dual Credit, CTE).
   */
  levelCharacteristics?: EdFiCourseLevelCharacteristic[];
  /**
   * Designates how many times the course may be taken with credit received by the student.
   */
  maxCompletionsForCredit?: number;
  /**
   * Conversion factor that when multiplied by the number of credits is equivalent to Carnegie units.
   */
  maximumAvailableCreditConversion?: number;
  /**
   * The value of credits or units of value awarded for the completion of a course.
   */
  maximumAvailableCredits?: number;
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  maximumAvailableCreditTypeDescriptor?: string;
  /**
   * Conversion factor that when multiplied by the number of credits is equivalent to Carnegie units.
   */
  minimumAvailableCreditConversion?: number;
  /**
   * The value of credits or units of value awarded for the completion of a course.
   */
  minimumAvailableCredits?: number;
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  minimumAvailableCreditTypeDescriptor?: string;
  /**
   * The number of parts identified for a course.
   */
  numberOfParts: number;
  /**
   * An unordered collection of courseOfferedGradeLevels. The grade levels in which the course is offered.
   */
  offeredGradeLevels?: EdFiCourseOfferedGradeLevel[];
  /**
   * The actual or estimated number of clock minutes required for class completion. This number is especially important for career and technical education classes and may represent (in minutes) the clock hour requirement of the class.
   */
  timeRequiredForCompletion?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseIdentificationCode".
 */
export interface EdFiCourseIdentificationCode {
  /**
   * A system that is used to identify the organization of subject matter and related learning experiences provided for the instruction of students.
   */
  courseIdentificationSystemDescriptor: string;
  /**
   * The organization code or name assigning the Identification Code.
   */
  assigningOrganizationIdentificationCode?: string;
  /**
   * The URL for the course catalog that defines the course identification code.
   */
  courseCatalogURL?: string;
  /**
   * A unique number or alphanumeric code assigned to a course by a school, school system, state, or other agency or entity. For multi-part course codes, concatenate the parts separated by a "/". For example, consider the following SCED code-    subject = 20 Math    course = 272 Geometry    level = G General    credits = 1.00   course sequence 1 of 1- would be entered as 20/272/G/1.00/1 of 1.
   */
  identificationCode: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseAcademicSubject".
 */
export interface EdFiCourseAcademicSubject {
  /**
   * The intended major subject/s area of the course.
   */
  academicSubjectDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseCompetencyLevel".
 */
export interface EdFiCourseCompetencyLevel {
  /**
   * The competency levels defined to rate the student for the course.
   */
  competencyLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseLearningStandard".
 */
export interface EdFiCourseLearningStandard {
  learningStandardReference: EdFiLearningStandardReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseLevelCharacteristic".
 */
export interface EdFiCourseLevelCharacteristic {
  /**
   * The type of specific program or designation with which the course is associated (e.g., AP, IB, Dual Credit, CTE).
   */
  courseLevelCharacteristicDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseOfferedGradeLevel".
 */
export interface EdFiCourseOfferedGradeLevel {
  /**
   * The grade levels in which the course is offered.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseOffering".
 */
export interface EdFiCourseOffering {
  id?: string;
  /**
   * The local code assigned by the School that identifies the course offering provided for the instruction of students.
   */
  localCourseCode: string;
  courseReference: EdFiCourseReference;
  schoolReference: EdFiSchoolReference;
  sessionReference: EdFiSessionReference;
  /**
   * An unordered collection of courseOfferingCourseLevelCharacteristics. The type of specific program or designation with which the course offering is associated (e.g., AP, IB, Dual Credit, CTE). This collection should only be populated if it differs from the course level characteristics identified at the course level.
   */
  courseLevelCharacteristics?: EdFiCourseOfferingCourseLevelCharacteristic[];
  /**
   * An unordered collection of courseOfferingCurriculumUseds. The type of curriculum used in an early learning classroom or group.
   */
  curriculumUseds?: EdFiCourseOfferingCurriculumUsed[];
  /**
   * The planned total number of clock minutes of instruction for this course offering. Generally, this should be at least as many minutes as is required for completion by the related state- or district-defined course.
   */
  instructionalTimePlanned?: number;
  /**
   * The descriptive name given to a course of study offered in the school, if different from the course title.
   */
  localCourseTitle?: string;
  /**
   * An unordered collection of courseOfferingOfferedGradeLevels. The grade levels in which the course is offered. This collection should only be populated if it differs from the offered grade levels identified at the course level.
   */
  offeredGradeLevels?: EdFiCourseOfferingOfferedGradeLevel[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseReference".
 */
export interface EdFiCourseReference {
  /**
   * A unique alphanumeric code assigned to a course.
   */
  courseCode: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_sessionReference".
 */
export interface EdFiSessionReference {
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  /**
   * The identifier for the school year.
   */
  schoolYear: number;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseOfferingCourseLevelCharacteristic".
 */
export interface EdFiCourseOfferingCourseLevelCharacteristic {
  /**
   * The type of specific program or designation with which the course offering is associated (e.g., AP, IB, Dual Credit, CTE). This collection should only be populated if it differs from the course level characteristics identified at the course level.
   */
  courseLevelCharacteristicDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseOfferingCurriculumUsed".
 */
export interface EdFiCourseOfferingCurriculumUsed {
  /**
   * The type of curriculum used in an early learning classroom or group.
   */
  curriculumUsedDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseOfferingOfferedGradeLevel".
 */
export interface EdFiCourseOfferingOfferedGradeLevel {
  /**
   * The grade levels in which the course is offered. This collection should only be populated if it differs from the offered grade levels identified at the course level.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseOfferingReference".
 */
export interface EdFiCourseOfferingReference {
  /**
   * The local code assigned by the School that identifies the course offering provided for the instruction of students.
   */
  localCourseCode: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  /**
   * The identifier for the school year.
   */
  schoolYear: number;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseTranscript".
 */
export interface EdFiCourseTranscript {
  id?: string;
  /**
   * The result from the student's attempt to take the course.
   */
  courseAttemptResultDescriptor: string;
  courseReference: EdFiCourseReference;
  externalEducationOrganizationReference?: EdFiEducationOrganizationReference;
  responsibleTeacherStaffReference?: EdFiStaffReference;
  studentAcademicRecordReference: EdFiStudentAcademicRecordReference;
  /**
   * An unordered collection of courseTranscriptAcademicSubjects. The subject area for the course transcript credits awarded in the course transcript.
   */
  academicSubjects?: EdFiCourseTranscriptAcademicSubject[];
  /**
   * An unordered collection of courseTranscriptAlternativeCourseIdentificationCodes. The code that identifies the course, course offering, the code from an external educational organization, or other alternate course code.
   */
  alternativeCourseIdentificationCodes?: EdFiCourseTranscriptAlternativeCourseIdentificationCode[];
  /**
   * The descriptive name given to a course of study offered in the school, if different from the CourseTitle.
   */
  alternativeCourseTitle?: string;
  /**
   * The organization code or name assigning the course identification code.
   */
  assigningOrganizationIdentificationCode?: string;
  /**
   * Conversion factor that when multiplied by the number of credits is equivalent to Carnegie units.
   */
  attemptedCreditConversion?: number;
  /**
   * The value of credits or units of value awarded for the completion of a course.
   */
  attemptedCredits?: number;
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  attemptedCreditTypeDescriptor?: string;
  /**
   * The URL for the course catalog that defines the course identification code.
   */
  courseCatalogURL?: string;
  /**
   * An unordered collection of courseTranscriptCoursePrograms. The program(s) that the student participated in the context of the course.
   */
  coursePrograms?: EdFiCourseTranscriptCourseProgram[];
  /**
   * Indicates that an academic course has been repeated by a student and how that repeat is to be computed in the student's academic grade average.
   */
  courseRepeatCodeDescriptor?: string;
  /**
   * The descriptive name given to a course of study offered in a school or other institution or organization. In departmentalized classes at the elementary, secondary, and postsecondary levels (and for staff development activities), this refers to the name by which a course is identified (e.g., American History, English III). For elementary and other non-departmentalized classes, it refers to any portion of the instruction for which a grade or report is assigned (e.g., reading, composition, spelling, language arts).
   */
  courseTitle?: string;
  /**
   * An unordered collection of courseTranscriptCreditCategories. A categorization for the course transcript credits awarded in the course transcript.
   */
  creditCategories?: EdFiCourseTranscriptCreditCategory[];
  /**
   * An unordered collection of courseTranscriptEarnedAdditionalCredits. The number of additional credits a student attempted and could earn for successfully completing a given course.
   */
  earnedAdditionalCredits?: EdFiCourseTranscriptEarnedAdditionalCredits[];
  /**
   * Conversion factor that when multiplied by the number of credits is equivalent to Carnegie units.
   */
  earnedCreditConversion?: number;
  /**
   * The value of credits or units of value awarded for the completion of a course.
   */
  earnedCredits?: number;
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  earnedCreditTypeDescriptor?: string;
  /**
   * Name of the external institution where the student completed the course; to be used only when the reference external education organization is not available.
   */
  externalEducationOrganizationNameOfInstitution?: string;
  /**
   * The final indicator of student performance in a class as submitted by the instructor.
   */
  finalLetterGradeEarned?: string;
  /**
   * The final indicator of student performance in a class as submitted by the instructor.
   */
  finalNumericGradeEarned?: number;
  /**
   * The method the credits were earned.
   */
  methodCreditEarnedDescriptor?: string;
  /**
   * An unordered collection of courseTranscriptPartialCourseTranscriptAwards. A collection of partial credits and/or grades a student earned against the course over the session, used when awards of credit are incremental.
   */
  partialCourseTranscriptAwards?: EdFiCourseTranscriptPartialCourseTranscriptAwards[];
  /**
   * An unordered collection of courseTranscriptSections. The section(s) associated with the course transcript.
   */
  sections?: EdFiCourseTranscriptSection[];
  /**
   * Student's grade level at time of course.
   */
  whenTakenGradeLevelDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffReference".
 */
export interface EdFiStaffReference {
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseTranscriptAcademicSubject".
 */
export interface EdFiCourseTranscriptAcademicSubject {
  /**
   * The subject area for the course transcript credits awarded in the course transcript.
   */
  academicSubjectDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseTranscriptAlternativeCourseIdentificationCode".
 */
export interface EdFiCourseTranscriptAlternativeCourseIdentificationCode {
  /**
   * A system that is used to identify the organization of subject matter and related learning experiences provided for the instruction of students.
   */
  courseIdentificationSystemDescriptor: string;
  /**
   * The organization code or name assigning the Identification Code.
   */
  assigningOrganizationIdentificationCode?: string;
  /**
   * The URL for the course catalog that defines the course identification code.
   */
  courseCatalogURL?: string;
  /**
   * A unique number or alphanumeric code assigned to a course by a school, school system, state, or other agency or entity. For multi-part course codes, concatenate the parts separated by a "/". For example, consider the following SCED code-    subject = 20 Math    course = 272 Geometry    level = G General    credits = 1.00   course sequence 1 of 1- would be entered as 20/272/G/1.00/1 of 1.
   */
  identificationCode: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseTranscriptCourseProgram".
 */
export interface EdFiCourseTranscriptCourseProgram {
  courseProgramReference: EdFiProgramReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseTranscriptCreditCategory".
 */
export interface EdFiCourseTranscriptCreditCategory {
  /**
   * A categorization for the course transcript credits awarded in the course transcript.
   */
  creditCategoryDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseTranscriptEarnedAdditionalCredits".
 */
export interface EdFiCourseTranscriptEarnedAdditionalCredits {
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  additionalCreditTypeDescriptor: string;
  /**
   * The value of credits or units of value awarded for the completion of a course
   */
  credits: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseTranscriptPartialCourseTranscriptAwards".
 */
export interface EdFiCourseTranscriptPartialCourseTranscriptAwards {
  /**
   * The date the partial credits and/or grades were awarded or earned.
   */
  awardDate: string;
  /**
   * The method the credits were earned.
   */
  methodCreditEarnedDescriptor?: string;
  /**
   * The number of credits a student earned for completing a given course.
   */
  earnedCredits: number;
  /**
   * The indicator of student performance as submitted by the instructor.
   */
  letterGradeEarned?: string;
  /**
   * The indicator of student performance as submitted by the instructor.
   */
  numericGradeEarned?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_courseTranscriptSection".
 */
export interface EdFiCourseTranscriptSection {
  sectionReference: EdFiSectionReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_credential".
 */
export interface EdFiCredential {
  id?: string;
  /**
   * Identifier or serial number assigned to the credential.
   */
  credentialIdentifier: string;
  /**
   * The abbreviation for the name of the state (within the United States) or extra-state jurisdiction in which a license/credential was issued.
   */
  stateOfIssueStateAbbreviationDescriptor: string;
  /**
   * An unordered collection of credentialAcademicSubjects. The academic subjects to which the credential pertains.
   */
  academicSubjects?: EdFiCredentialAcademicSubject[];
  /**
   * The field of certification for the certificate (e.g., Mathematics, Music).
   */
  credentialFieldDescriptor?: string;
  /**
   * An indication of the category of credential an individual holds.
   */
  credentialTypeDescriptor: string;
  /**
   * The year, month and day on which an active credential held by an individual was issued.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  effectiveDate?: string;
  /**
   * An unordered collection of credentialEndorsements. Endorsements are attachments to teaching certificates and indicate areas of specialization.
   */
  endorsements?: EdFiCredentialEndorsement[];
  /**
   * The month, day, and year on which an active credential held by an individual will expire.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  expirationDate?: string;
  /**
   * An unordered collection of credentialGradeLevels. The grade level(s) certified for teaching.
   */
  gradeLevels?: EdFiCredentialGradeLevel[];
  /**
   * The month, day, and year on which an active credential was issued to an individual.
   */
  issuanceDate: string;
  /**
   * Namespace for the credential.
   */
  namespace: string;
  /**
   * An indication of the pre-determined criteria for granting the teaching credential that an individual holds.
   */
  teachingCredentialBasisDescriptor?: string;
  /**
   * An indication of the category of a legal document giving authorization to perform teaching assignment services.
   */
  teachingCredentialDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  _ext?: CredentialExtensions;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_credentialAcademicSubject".
 */
export interface EdFiCredentialAcademicSubject {
  /**
   * The academic subjects to which the credential pertains.
   */
  academicSubjectDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_credentialEndorsement".
 */
export interface EdFiCredentialEndorsement {
  /**
   * Endorsements are attachments to teaching certificates and indicate areas of specialization.
   */
  credentialEndorsement: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_credentialGradeLevel".
 */
export interface EdFiCredentialGradeLevel {
  /**
   * The grade level(s) certified for teaching.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_credentialReference".
 */
export interface EdFiCredentialReference {
  /**
   * Identifier or serial number assigned to the credential.
   */
  credentialIdentifier: string;
  /**
   * The abbreviation for the name of the state (within the United States) or extra-state jurisdiction in which a license/credential was issued.
   */
  stateOfIssueStateAbbreviationDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_crisisEvent".
 */
export interface EdFiCrisisEvent {
  id?: string;
  /**
   * The name of the crisis event that occurred. If there is no generally accepted name for this crisis event, the suggested format: Location + Crisis type + Year.
   */
  crisisEventName: string;
  /**
   * Provides a textual description of the crisis event affecting the student. It may include details such as the nature of the crisis (e.g., natural disaster, conflict, medical emergency), its severity, location, and any other relevant information describing the crisis situation.
   */
  crisisDescription?: string;
  /**
   * The date on which the crisis ceased to affect the student. Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  crisisEndDate?: string;
  /**
   * The year, month and day on which the crisis affected the student. This date may not be the same as the date the crisis occurred if evacuation orders are implemented in anticipation of a crisis.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  crisisStartDate?: string;
  /**
   * The type or category of crisis.
   */
  crisisTypeDescriptor: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_crisisEventReference".
 */
export interface EdFiCrisisEventReference {
  /**
   * The name of the crisis event that occurred. If there is no generally accepted name for this crisis event, the suggested format: Location + Crisis type + Year.
   */
  crisisEventName: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_descriptorMapping".
 */
export interface EdFiDescriptorMapping {
  id?: string;
  /**
   * The namespace of the descriptor value to which the from descriptor value is mapped to.
   */
  mappedNamespace: string;
  /**
   * The descriptor value to which the from descriptor value is being mapped to.
   */
  mappedValue: string;
  /**
   * The namespace of the descriptor value that is being mapped to another value.
   */
  namespace: string;
  /**
   * The descriptor value that is being mapped to another value.
   */
  value: string;
  /**
   * An unordered collection of descriptorMappingModelEntities. The resources for which the descriptor mapping applies. If empty, the mapping is assumed to be applicable to all resources in which the descriptor appears.
   */
  modelEntities?: EdFiDescriptorMappingModelEntity[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_descriptorMappingModelEntity".
 */
export interface EdFiDescriptorMappingModelEntity {
  /**
   * The resources for which the descriptor mapping applies. If empty, the mapping is assumed to be applicable to all resources in which the descriptor appears.
   */
  modelEntityDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_disciplineAction".
 */
export interface EdFiDisciplineAction {
  id?: string;
  /**
   * Identifier assigned by the education organization to the discipline action.
   */
  disciplineActionIdentifier: string;
  /**
   * The date of the discipline action.
   */
  disciplineDate: string;
  /**
   * An unordered collection of disciplineActionDisciplines. Type of action, such as removal from the classroom, used to discipline the student involved as a perpetrator in a discipline incident.
   */
  disciplines: EdFiDisciplineActionDiscipline[];
  assignmentSchoolReference?: EdFiSchoolReference;
  responsibilitySchoolReference: EdFiSchoolReference;
  studentReference: EdFiStudentReference;
  /**
   * Indicates the actual length in school days of a student's disciplinary assignment.
   */
  actualDisciplineActionLength?: number;
  /**
   * The length of time in school days for the discipline action (e.g. removal, detention), if applicable.
   */
  disciplineActionLength?: number;
  /**
   * Indicates the reason for the difference, if any, between the official and actual lengths of a student's disciplinary assignment.
   */
  disciplineActionLengthDifferenceReasonDescriptor?: string;
  /**
   * An indication as to whether an offense and/or disciplinary action resulted in a meeting of a student's Individualized Education Program (IEP) team to determine appropriate placement.
   */
  iepPlacementMeetingIndicator?: boolean;
  /**
   * An indication of whether or not this disciplinary action taken against a student was imposed as a consequence of state or local zero tolerance policies.
   */
  relatedToZeroTolerancePolicy?: boolean;
  /**
   * An unordered collection of disciplineActionStaffs. The staff responsible for enforcing the discipline action.
   */
  staffs?: EdFiDisciplineActionStaff[];
  /**
   * An unordered collection of disciplineActionStudentDisciplineIncidentBehaviorAssociations. A reference to the behavior(s) by the student that led or contributed to this specific action.
   */
  studentDisciplineIncidentBehaviorAssociations?: EdFiDisciplineActionStudentDisciplineIncidentBehaviorAssociation[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_disciplineActionDiscipline".
 */
export interface EdFiDisciplineActionDiscipline {
  /**
   * Type of action, such as removal from the classroom, used to discipline the student involved as a perpetrator in a discipline incident.
   */
  disciplineDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentReference".
 */
export interface EdFiStudentReference {
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_disciplineActionStaff".
 */
export interface EdFiDisciplineActionStaff {
  staffReference: EdFiStaffReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_disciplineActionStudentDisciplineIncidentBehaviorAssociation".
 */
export interface EdFiDisciplineActionStudentDisciplineIncidentBehaviorAssociation {
  studentDisciplineIncidentBehaviorAssociationReference: EdFiStudentDisciplineIncidentBehaviorAssociationReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentDisciplineIncidentBehaviorAssociationReference".
 */
export interface EdFiStudentDisciplineIncidentBehaviorAssociationReference {
  /**
   * Describes behavior by category.
   */
  behaviorDescriptor: string;
  /**
   * A locally assigned unique identifier (within the school or school district) to identify each specific DisciplineIncident or occurrence. The same identifier should be used to document the entire discipline incident even if it included multiple offenses and multiple offenders.
   */
  incidentIdentifier: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_disciplineIncident".
 */
export interface EdFiDisciplineIncident {
  id?: string;
  /**
   * A locally assigned unique identifier (within the school or school district) to identify each specific DisciplineIncident or occurrence. The same identifier should be used to document the entire discipline incident even if it included multiple offenses and multiple offenders.
   */
  incidentIdentifier: string;
  schoolReference: EdFiSchoolReference;
  /**
   * An unordered collection of disciplineIncidentBehaviors. Describes behavior by category and provides a detailed description.
   */
  behaviors?: EdFiDisciplineIncidentBehavior[];
  /**
   * The case number assigned to the DisciplineIncident by law enforcement or other organization.
   */
  caseNumber?: string;
  /**
   * An unordered collection of disciplineIncidentExternalParticipants. Information on an individual involved in the discipline incident.
   */
  externalParticipants?: EdFiDisciplineIncidentExternalParticipant[];
  /**
   * The value of any quantifiable monetary loss directly resulting from the discipline incident. Examples include the value of repairs necessitated by vandalism of a school facility, or the value of personnel resources used for repairs or consumed by the incident.
   */
  incidentCost?: number;
  /**
   * The month, day, and year on which the discipline incident occurred.
   */
  incidentDate: string;
  /**
   * The description for an incident.
   */
  incidentDescription?: string;
  /**
   * Identifies where the discipline incident occurred and whether or not it occurred on school.
   */
  incidentLocationDescriptor?: string;
  /**
   * An indication of the time of day the incident took place.
   */
  incidentTime?: string;
  /**
   * Indicator of whether the incident was reported to law enforcement.
   */
  reportedToLawEnforcement?: boolean;
  /**
   * Information on the type of individual who reported the discipline incident. When known and/or if useful, use a more specific option code (e.g., "Counselor" rather than "Professional Staff").
   */
  reporterDescriptionDescriptor?: string;
  /**
   * Identifies the reporter of the discipline incident by name.
   */
  reporterName?: string;
  /**
   * An unordered collection of disciplineIncidentWeapons. Identifies the type of weapon used during an incident. The Federal Gun-Free Schools Act requires states to report the number of students expelled for bringing firearms to school by type of firearm.
   */
  weapons?: EdFiDisciplineIncidentWeapon[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_disciplineIncidentBehavior".
 */
export interface EdFiDisciplineIncidentBehavior {
  /**
   * Describes behavior by category and provides a detailed description.
   */
  behaviorDescriptor: string;
  /**
   * Specifies a more granular level of detail of a behavior involved in the incident.
   */
  behaviorDetailedDescription?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_disciplineIncidentExternalParticipant".
 */
export interface EdFiDisciplineIncidentExternalParticipant {
  /**
   * The role or type of participation of an individual in the discipline incident.
   */
  disciplineIncidentParticipationCodeDescriptor: string;
  /**
   * A name given to an individual at birth, baptism, or during another naming ceremony, or through legal change.
   */
  firstName: string;
  /**
   * The name borne in common by members of a family.
   */
  lastSurname: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_disciplineIncidentWeapon".
 */
export interface EdFiDisciplineIncidentWeapon {
  /**
   * Identifies the type of weapon used during an incident. The Federal Gun-Free Schools Act requires states to report the number of students expelled for bringing firearms to school by type of firearm.
   */
  weaponDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_disciplineIncidentReference".
 */
export interface EdFiDisciplineIncidentReference {
  /**
   * A locally assigned unique identifier (within the school or school district) to identify each specific DisciplineIncident or occurrence. The same identifier should be used to document the entire discipline incident even if it included multiple offenses and multiple offenders.
   */
  incidentIdentifier: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationContent".
 */
export interface EdFiEducationContent {
  id?: string;
  /**
   * A unique identifier for the education content.
   */
  contentIdentifier: string;
  learningStandardReference?: EdFiLearningStandardReference;
  /**
   * Indicates whether there are additional un-named authors. In a research report, this is often marked by the abbreviation "et al".
   */
  additionalAuthorsIndicator?: boolean;
  /**
   * An unordered collection of educationContentAppropriateGradeLevels. Grade levels for which this education content is applicable. If omitted, considered generally applicable.
   */
  appropriateGradeLevels?: EdFiEducationContentAppropriateGradeLevel[];
  /**
   * An unordered collection of educationContentAppropriateSexes. Sexes for which this education content is applicable. If omitted, considered generally applicable.
   */
  appropriateSexes?: EdFiEducationContentAppropriateSex[];
  /**
   * An unordered collection of educationContentAuthors. The individual credited with the creation of the resource.
   */
  authors?: EdFiEducationContentAuthor[];
  /**
   * The predominate type or kind characterizing the learning resource.
   */
  contentClassDescriptor?: string;
  /**
   * An amount that has to be paid or spent to buy or obtain the education content.
   */
  cost?: number;
  /**
   * The rate by which the cost applies.
   */
  costRateDescriptor?: string;
  /**
   * An unordered collection of educationContentDerivativeSourceEducationContents. Relates the education content source to the education content.
   */
  derivativeSourceEducationContents?: EdFiEducationContentDerivativeSourceEducationContent[];
  /**
   * An unordered collection of educationContentDerivativeSourceLearningResourceMetadataURIs. The URI (typical a URL) pointing to the metadata entry in a LRMI metadata repository, which describes this content item.
   */
  derivativeSourceLearningResourceMetadataURIs?: EdFiEducationContentDerivativeSourceLearningResourceMetadataURI[];
  /**
   * An unordered collection of educationContentDerivativeSourceURIs. The URI (typical a URL) pointing to an education content item.
   */
  derivativeSourceURIs?: EdFiEducationContentDerivativeSourceURI[];
  /**
   * An extended written representation of the education content.
   */
  description?: string;
  /**
   * The predominate mode of learning supported by the learning resource. Acceptable values are active, expositive, or mixed.
   */
  interactivityStyleDescriptor?: string;
  /**
   * An unordered collection of educationContentLanguages. An indication of the languages in which the Education Content is designed.
   */
  languages?: EdFiEducationContentLanguage[];
  /**
   * The URI (typical a URL) pointing to the metadata entry in a LRMI metadata repository, which describes this content item.
   */
  learningResourceMetadataURI?: string;
  /**
   * Namespace for the education content.
   */
  namespace: string;
  /**
   * The date on which this content was first published.
   */
  publicationDate?: string;
  /**
   * The year at which this content was first published.
   */
  publicationYear?: number;
  /**
   * The organization credited with publishing the resource.
   */
  publisher?: string;
  /**
   * A short description or name of the entity.
   */
  shortDescription?: string;
  /**
   * Approximate or typical time that it takes to work with or through this learning resource for the typical intended target audience expressed in minutes.
   */
  timeRequired?: string;
  /**
   * The URL where the owner specifies permissions for using the resource.
   */
  useRightsURL?: string;
  /**
   * The version identifier for the content.
   */
  version?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationContentAppropriateGradeLevel".
 */
export interface EdFiEducationContentAppropriateGradeLevel {
  /**
   * Grade levels for which this education content is applicable. If omitted, considered generally applicable.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationContentAppropriateSex".
 */
export interface EdFiEducationContentAppropriateSex {
  /**
   * Sexes for which this education content is applicable. If omitted, considered generally applicable.
   */
  sexDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationContentAuthor".
 */
export interface EdFiEducationContentAuthor {
  /**
   * The individual credited with the creation of the resource.
   */
  author: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationContentDerivativeSourceEducationContent".
 */
export interface EdFiEducationContentDerivativeSourceEducationContent {
  derivativeSourceEducationContentReference: EdFiEducationContentReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationContentReference".
 */
export interface EdFiEducationContentReference {
  /**
   * A unique identifier for the education content.
   */
  contentIdentifier: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationContentDerivativeSourceLearningResourceMetadataURI".
 */
export interface EdFiEducationContentDerivativeSourceLearningResourceMetadataURI {
  /**
   * The URI (typical a URL) pointing to the metadata entry in a LRMI metadata repository, which describes this content item.
   */
  derivativeSourceLearningResourceMetadataURI: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationContentDerivativeSourceURI".
 */
export interface EdFiEducationContentDerivativeSourceURI {
  /**
   * The URI (typical a URL) pointing to an education content item.
   */
  derivativeSourceURI: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationContentLanguage".
 */
export interface EdFiEducationContentLanguage {
  /**
   * An indication of the languages in which the Education Content is designed.
   */
  languageDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationInterventionPrescriptionAssociation".
 */
export interface EdFiEducationOrganizationInterventionPrescriptionAssociation {
  id?: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  interventionPrescriptionReference: EdFiInterventionPrescriptionReference;
  /**
   * The begin date of the period during which the intervention prescription is available.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The end date of the period during which the intervention prescription is available.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionPrescriptionReference".
 */
export interface EdFiInterventionPrescriptionReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * A unique number or alphanumeric code assigned to an intervention prescription.
   */
  interventionPrescriptionIdentificationCode: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationNetwork".
 */
export interface EdFiEducationOrganizationNetwork {
  id?: string;
  /**
   * An unordered collection of educationOrganizationCategories. The classification of the education agency within the geographic boundaries of a state according to the level of administrative and operational control granted by the state.
   */
  categories: EdFiEducationOrganizationCategory[];
  /**
   * The identifier assigned to a network of education organizations. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  educationOrganizationNetworkId: number;
  /**
   * An unordered collection of educationOrganizationAddresses. The set of elements that describes an address for the education entity, including the street address, city, state, ZIP code, and ZIP code + 4.
   */
  addresses?: EdFiEducationOrganizationAddress[];
  /**
   * An unordered collection of educationOrganizationIdentificationCodes. A unique number or alphanumeric code assigned to an education organization by a school, school system, a state, or other agency or entity.
   */
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  /**
   * An unordered collection of educationOrganizationIndicators. An indicator or metric of an education organization.
   */
  indicators?: EdFiEducationOrganizationIndicator[];
  /**
   * An unordered collection of educationOrganizationInstitutionTelephones. The 10-digit telephone number, including the area code, for the education entity.
   */
  institutionTelephones?: EdFiEducationOrganizationInstitutionTelephone[];
  /**
   * An unordered collection of educationOrganizationInternationalAddresses. The set of elements that describes the international physical location of the education entity.
   */
  internationalAddresses?: EdFiEducationOrganizationInternationalAddress[];
  /**
   * The full, legally accepted name of the institution.
   */
  nameOfInstitution: string;
  /**
   * The purpose(s) of the network (e.g., shared services, collective procurement).
   */
  networkPurposeDescriptor: string;
  /**
   * The current operational status of the education organization (e.g., active, inactive).
   */
  operationalStatusDescriptor?: string;
  /**
   * A short name for the institution.
   */
  shortNameOfInstitution?: string;
  /**
   * The public web site address (URL) for the education organization.
   */
  webSite?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationNetworkAssociation".
 */
export interface EdFiEducationOrganizationNetworkAssociation {
  id?: string;
  educationOrganizationNetworkReference: EdFiEducationOrganizationNetworkReference;
  memberEducationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * The date on which the education organization joined this network.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The date on which the education organization left this network.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationNetworkReference".
 */
export interface EdFiEducationOrganizationNetworkReference {
  /**
   * The identifier assigned to a network of education organizations. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  educationOrganizationNetworkId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationOrganizationPeerAssociation".
 */
export interface EdFiEducationOrganizationPeerAssociation {
  id?: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  peerEducationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationServiceCenter".
 */
export interface EdFiEducationServiceCenter {
  id?: string;
  /**
   * An unordered collection of educationOrganizationCategories. The classification of the education agency within the geographic boundaries of a state according to the level of administrative and operational control granted by the state.
   */
  categories: EdFiEducationOrganizationCategory[];
  /**
   * The identifier assigned to an education service center. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  educationServiceCenterId: number;
  stateEducationAgencyReference?: EdFiStateEducationAgencyReference;
  /**
   * An unordered collection of educationOrganizationAddresses. The set of elements that describes an address for the education entity, including the street address, city, state, ZIP code, and ZIP code + 4.
   */
  addresses?: EdFiEducationOrganizationAddress[];
  /**
   * An unordered collection of educationOrganizationIdentificationCodes. A unique number or alphanumeric code assigned to an education organization by a school, school system, a state, or other agency or entity.
   */
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  /**
   * An unordered collection of educationOrganizationIndicators. An indicator or metric of an education organization.
   */
  indicators?: EdFiEducationOrganizationIndicator[];
  /**
   * An unordered collection of educationOrganizationInstitutionTelephones. The 10-digit telephone number, including the area code, for the education entity.
   */
  institutionTelephones?: EdFiEducationOrganizationInstitutionTelephone[];
  /**
   * An unordered collection of educationOrganizationInternationalAddresses. The set of elements that describes the international physical location of the education entity.
   */
  internationalAddresses?: EdFiEducationOrganizationInternationalAddress[];
  /**
   * The full, legally accepted name of the institution.
   */
  nameOfInstitution: string;
  /**
   * The current operational status of the education organization (e.g., active, inactive).
   */
  operationalStatusDescriptor?: string;
  /**
   * A short name for the institution.
   */
  shortNameOfInstitution?: string;
  /**
   * The public web site address (URL) for the education organization.
   */
  webSite?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_stateEducationAgencyReference".
 */
export interface EdFiStateEducationAgencyReference {
  /**
   * The identifier assigned to a state education agency. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  stateEducationAgencyId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_educationServiceCenterReference".
 */
export interface EdFiEducationServiceCenterReference {
  /**
   * The identifier assigned to an education service center. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  educationServiceCenterId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_evaluationRubricDimension".
 */
export interface EdFiEvaluationRubricDimension {
  id?: string;
  /**
   * The numeric rating associated with the evaluation rubric dimension.
   */
  evaluationRubricRating: number;
  programEvaluationElementReference: EdFiProgramEvaluationElementReference;
  /**
   * The evaluation criterion description for the evaluation rubric dimension.
   */
  evaluationCriterionDescription: string;
  /**
   * The rating level achieved for the evaluation rubric dimension.
   */
  evaluationRubricRatingLevelDescriptor?: string;
  /**
   * The sort order of the rubric dimension.
   */
  rubricDimensionSortOrder?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programEvaluationElementReference".
 */
export interface EdFiProgramEvaluationElementReference {
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId: number;
  /**
   * The name or title of the program evaluation element.
   */
  programEvaluationElementTitle: string;
  /**
   * The name of the period for the program evaluation.
   */
  programEvaluationPeriodDescriptor: string;
  /**
   * An assigned unique identifier for the student program evaluation.
   */
  programEvaluationTitle: string;
  /**
   * The type of program evaluation conducted.
   */
  programEvaluationTypeDescriptor: string;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName: string;
  /**
   * The type of program.
   */
  programTypeDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_feederSchoolAssociation".
 */
export interface EdFiFeederSchoolAssociation {
  id?: string;
  /**
   * The month, day, and year of the first day of the feeder school association.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  feederSchoolReference: EdFiSchoolReference;
  schoolReference: EdFiSchoolReference;
  /**
   * The month, day, and year of the last day of the feeder school association.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * Describes the relationship from the feeder school to the receiving school, for example by program emphasis, such as special education, language immersion, science, or performing art.
   */
  feederRelationshipDescription?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_functionDimension".
 */
export interface EdFiFunctionDimension {
  id?: string;
  /**
   * The code representation of the account function dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account function dimension is valid.
   */
  fiscalYear: number;
  /**
   * A description of the account function dimension.
   */
  codeName?: string;
  /**
   * An unordered collection of functionDimensionReportingTags. Optional tag for accountability reporting.
   */
  reportingTags?: EdFiFunctionDimensionReportingTag[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_functionDimensionReportingTag".
 */
export interface EdFiFunctionDimensionReportingTag {
  /**
   * Optional tag for accountability reporting.
   */
  reportingTagDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_fundDimension".
 */
export interface EdFiFundDimension {
  id?: string;
  /**
   * The code representation of the account fund dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account fund dimension is valid.
   */
  fiscalYear: number;
  /**
   * A description of the account fund dimension.
   */
  codeName?: string;
  /**
   * An unordered collection of fundDimensionReportingTags. Optional tag for accountability reporting.
   */
  reportingTags?: EdFiFundDimensionReportingTag[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_fundDimensionReportingTag".
 */
export interface EdFiFundDimensionReportingTag {
  /**
   * Optional tag for accountability reporting.
   */
  reportingTagDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_generalStudentProgramAssociationProgramParticipationStatus".
 */
export interface EdFiGeneralStudentProgramAssociationProgramParticipationStatus {
  /**
   * The student's program participation status.
   */
  participationStatusDescriptor: string;
  /**
   * The date the student's program participation status began.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  statusBeginDate: string;
  /**
   * The person, organization, or department that designated the participation status.
   */
  designatedBy?: string;
  /**
   * The date the student's program participation status ended.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  statusEndDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_generalStudentProgramAssociationReference".
 */
export interface EdFiGeneralStudentProgramAssociationReference {
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName: string;
  /**
   * The type of program.
   */
  programTypeDescriptor: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_grade".
 */
export interface EdFiGrade {
  id?: string;
  /**
   * The type of grade reported (e.g., exam, final, grading period).
   */
  gradeTypeDescriptor: string;
  gradingPeriodReference: EdFiGradingPeriodReference;
  studentSectionAssociationReference: EdFiStudentSectionAssociationReference;
  /**
   * As-Of date for a grade posted as the current grade.
   */
  currentGradeAsOfDate?: string;
  /**
   * An indicator that the posted grade is an interim grade for the grading period and not the final grade.
   */
  currentGradeIndicator?: boolean;
  /**
   * A statement provided by the teacher that provides information in addition to the grade or assessment score.
   */
  diagnosticStatement?: string;
  /**
   * A description of the grade earned by the learner.
   */
  gradeEarnedDescription?: string;
  /**
   * An unordered collection of gradeLearningStandardGrades. A collection of learning standards associated with the grade.
   */
  learningStandardGrades?: EdFiGradeLearningStandardGrade[];
  /**
   * A final or interim (grading period) indicator of student performance in a class as submitted by the instructor.
   */
  letterGradeEarned?: string;
  /**
   * A final or interim (grading period) indicator of student performance in a class as submitted by the instructor.
   */
  numericGradeEarned?: number;
  /**
   * A conversion of the level to a standard set of performance levels.
   */
  performanceBaseConversionDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_gradingPeriodReference".
 */
export interface EdFiGradingPeriodReference {
  /**
   * The state's name of the period for which grades are reported.
   */
  gradingPeriodDescriptor: string;
  /**
   * The school's descriptive name of the grading period.
   */
  gradingPeriodName: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  /**
   * The identifier for the grading period school year.
   */
  schoolYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSectionAssociationReference".
 */
export interface EdFiStudentSectionAssociationReference {
  /**
   * Month, day, and year of the student's entry or assignment to the section.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The local code assigned by the School that identifies the course offering provided for the instruction of students.
   */
  localCourseCode: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  /**
   * The identifier for the school year.
   */
  schoolYear: number;
  /**
   * The local identifier assigned to a section.
   */
  sectionIdentifier: string;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_gradeLearningStandardGrade".
 */
export interface EdFiGradeLearningStandardGrade {
  /**
   * A performance level that describes the student proficiency.
   */
  performanceBaseConversionDescriptor?: string;
  /**
   * A statement provided by the teacher that provides information in addition to the grade or assessment score.
   */
  diagnosticStatement?: string;
  /**
   * A final or interim (grading period) indicator of student performance for a learning standard as submitted by the instructor.
   */
  letterGradeEarned?: string;
  /**
   * A final or interim (grading period) indicator of student performance for a learning standard as submitted by the instructor.
   */
  numericGradeEarned?: number;
  learningStandardReference: EdFiLearningStandardReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_gradebookEntry".
 */
export interface EdFiGradebookEntry {
  id?: string;
  /**
   * A unique number or alphanumeric code assigned to a gradebook entry by the source system.
   */
  gradebookEntryIdentifier: string;
  /**
   * Namespace URI for the source of the gradebook entry.
   */
  namespace: string;
  gradingPeriodReference?: EdFiGradingPeriodReference;
  sectionReference?: EdFiSectionReference;
  /**
   * The date the assignment, homework, or assessment was assigned or executed.
   */
  dateAssigned: string;
  /**
   * A description of the assignment, homework, or classroom assessment.
   */
  description?: string;
  /**
   * The date the assignment, homework, or assessment is due.
   */
  dueDate?: string;
  /**
   * The time the assignment, homework, or assessment is due.
   */
  dueTime?: string;
  /**
   * The type of the gradebook entry.
   */
  gradebookEntryTypeDescriptor?: string;
  /**
   * An unordered collection of gradebookEntryLearningStandards. LearningStandard(s) associated with the gradebook entry.
   */
  learningStandards?: EdFiGradebookEntryLearningStandard[];
  /**
   * The maximum number of points  that can be earned for the submission.
   */
  maxPoints?: number;
  /**
   * The local identifier assigned to a section.
   */
  sourceSectionIdentifier: string;
  /**
   * The name or title of the activity to be recorded in the gradebook entry.
   */
  title: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_gradebookEntryLearningStandard".
 */
export interface EdFiGradebookEntryLearningStandard {
  learningStandardReference: EdFiLearningStandardReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_gradebookEntryReference".
 */
export interface EdFiGradebookEntryReference {
  /**
   * A unique number or alphanumeric code assigned to a gradebook entry by the source system.
   */
  gradebookEntryIdentifier: string;
  /**
   * Namespace URI for the source of the gradebook entry.
   */
  namespace: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_gradeReference".
 */
export interface EdFiGradeReference {
  /**
   * Month, day, and year of the student's entry or assignment to the section.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The type of grade reported (e.g., exam, final, grading period).
   */
  gradeTypeDescriptor: string;
  /**
   * The state's name of the period for which grades are reported.
   */
  gradingPeriodDescriptor: string;
  /**
   * The school's descriptive name of the grading period.
   */
  gradingPeriodName: string;
  /**
   * The identifier for the grading period school year.
   */
  gradingPeriodSchoolYear: number;
  /**
   * The local code assigned by the School that identifies the course offering provided for the instruction of students.
   */
  localCourseCode: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  /**
   * The identifier for the school year.
   */
  schoolYear: number;
  /**
   * The local identifier assigned to a section.
   */
  sectionIdentifier: string;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_gradingPeriod".
 */
export interface EdFiGradingPeriod {
  id?: string;
  /**
   * The state's name of the period for which grades are reported.
   */
  gradingPeriodDescriptor: string;
  /**
   * The school's descriptive name of the grading period.
   */
  gradingPeriodName: string;
  schoolReference: EdFiSchoolReference;
  schoolYearTypeReference: EdFiSchoolYearTypeReference;
  /**
   * Month, day, and year of the first day of the grading period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * Month, day, and year of the last day of the grading period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate: string;
  /**
   * The sequential order of this period relative to other periods.
   */
  periodSequence?: number;
  /**
   * Total days available for educational instruction during the grading period.
   */
  totalInstructionalDays: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_graduationPlan".
 */
export interface EdFiGraduationPlan {
  id?: string;
  /**
   * The type of academic plan the student is following for graduation.
   */
  graduationPlanTypeDescriptor: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  graduationSchoolYearTypeReference: EdFiSchoolYearTypeReference;
  /**
   * An unordered collection of graduationPlanCreditsByCourses. The total credits required for graduation by taking a specific course, or by taking one or more from a set of courses.
   */
  creditsByCourses?: EdFiGraduationPlanCreditsByCourse[];
  /**
   * An unordered collection of graduationPlanCreditsByCreditCategories. The total credits required for graduation based on the credit category.
   */
  creditsByCreditCategories?: EdFiGraduationPlanCreditsByCreditCategory[];
  /**
   * An unordered collection of graduationPlanCreditsBySubjects. The total credits required in subject to graduate. Only those courses identified as a high school course requirement are eligible to meet subject credit requirements.
   */
  creditsBySubjects?: EdFiGraduationPlanCreditsBySubject[];
  /**
   * An indicator of whether the graduation plan is tailored for an individual.
   */
  individualPlan?: boolean;
  /**
   * An unordered collection of graduationPlanRequiredAssessments. The assessments and associated required score and performance level needed to satisfy graduation requirements.
   */
  requiredAssessments?: EdFiGraduationPlanRequiredAssessment[];
  /**
   * Conversion factor that when multiplied by the number of credits is equivalent to Carnegie units.
   */
  totalRequiredCreditConversion?: number;
  /**
   * The value of credits or units of value awarded for the completion of a course.
   */
  totalRequiredCredits: number;
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  totalRequiredCreditTypeDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_graduationPlanCreditsByCourse".
 */
export interface EdFiGraduationPlanCreditsByCourse {
  /**
   * Identifying name given to a collection of courses.
   */
  courseSetName: string;
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  creditTypeDescriptor?: string;
  /**
   * The grade level when the student is planned to take the course.
   */
  whenTakenGradeLevelDescriptor?: string;
  /**
   * Conversion factor that when multiplied by the number of credits is equivalent to Carnegie units.
   */
  creditConversion?: number;
  /**
   * The value of credits or units of value awarded for the completion of a course.
   */
  credits: number;
  /**
   * An unordered collection of graduationPlanCreditsByCourseCourses. The course reference that identifies the organization of subject matter and related learning experiences provided for the instruction of students.
   */
  courses: EdFiGraduationPlanCreditsByCourseCourse[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_graduationPlanCreditsByCourseCourse".
 */
export interface EdFiGraduationPlanCreditsByCourseCourse {
  courseReference: EdFiCourseReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_graduationPlanCreditsByCreditCategory".
 */
export interface EdFiGraduationPlanCreditsByCreditCategory {
  /**
   * A categorization for the course transcript credits awarded in the course transcript.
   */
  creditCategoryDescriptor: string;
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  creditTypeDescriptor?: string;
  /**
   * Conversion factor that when multiplied by the number of credits is equivalent to Carnegie units.
   */
  creditConversion?: number;
  /**
   * The value of credits or units of value awarded for the completion of a course.
   */
  credits: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_graduationPlanCreditsBySubject".
 */
export interface EdFiGraduationPlanCreditsBySubject {
  /**
   * The intended major subject area of the graduation requirement.
   */
  academicSubjectDescriptor: string;
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  creditTypeDescriptor?: string;
  /**
   * Conversion factor that when multiplied by the number of credits is equivalent to Carnegie units.
   */
  creditConversion?: number;
  /**
   * The value of credits or units of value awarded for the completion of a course.
   */
  credits: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_graduationPlanRequiredAssessment".
 */
export interface EdFiGraduationPlanRequiredAssessment {
  assessmentReference: EdFiAssessmentReference;
  /**
   * An unordered collection of graduationPlanRequiredAssessmentScores. Score required to be met or exceeded.
   */
  scores?: EdFiGraduationPlanRequiredAssessmentScore[];
  performanceLevel?: EdFiGraduationPlanRequiredAssessmentPerformanceLevel;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_graduationPlanRequiredAssessmentScore".
 */
export interface EdFiGraduationPlanRequiredAssessmentScore {
  /**
   * The method that the administrator of the assessment uses to report the performance and achievement of all students. It may be a qualitative method such as performance level descriptors or a quantitative method such as a numerical grade or cut score. More than one type of reporting method may be used.
   */
  assessmentReportingMethodDescriptor: string;
  /**
   * The datatype of the result. The results can be expressed as a number, percentile, range, level, etc.
   */
  resultDatatypeTypeDescriptor?: string;
  /**
   * The maximum score possible on the assessment.
   */
  maximumScore?: string;
  /**
   * The minimum score possible on the assessment.
   */
  minimumScore?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_graduationPlanRequiredAssessmentPerformanceLevel".
 */
export interface EdFiGraduationPlanRequiredAssessmentPerformanceLevel {
  /**
   * The method that the instructor of the class uses to report the performance and achievement of all students. It may be a qualitative method such as individualized teacher comments or a quantitative method such as a letter or numerical grade. In some cases, more than one type of reporting method may be used.
   */
  assessmentReportingMethodDescriptor: string;
  /**
   * The performance level(s) defined for the assessment.
   */
  performanceLevelDescriptor: string;
  /**
   * The datatype of the result. The results can be expressed as a number, percentile, range, level, etc.
   */
  resultDatatypeTypeDescriptor?: string;
  /**
   * The maximum score to make the indicated level of performance.
   */
  maximumScore?: string;
  /**
   * The minimum score required to make the indicated level of performance.
   */
  minimumScore?: string;
  /**
   * The name of the indicator being measured for a collection of performance level values.
   */
  performanceLevelIndicatorName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_graduationPlanReference".
 */
export interface EdFiGraduationPlanReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The type of academic plan the student is following for graduation.
   */
  graduationPlanTypeDescriptor: string;
  /**
   * The school year the student is expected to graduate.
   */
  graduationSchoolYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_intervention".
 */
export interface EdFiIntervention {
  id?: string;
  /**
   * A unique number or alphanumeric code assigned to an intervention.
   */
  interventionIdentificationCode: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * An unordered collection of interventionAppropriateGradeLevels. Grade levels for the intervention. If omitted, considered generally applicable.
   */
  appropriateGradeLevels?: EdFiInterventionAppropriateGradeLevel[];
  /**
   * An unordered collection of interventionAppropriateSexes. Sexes for the intervention. If omitted, considered generally applicable.
   */
  appropriateSexes?: EdFiInterventionAppropriateSex[];
  /**
   * The start date for the intervention implementation.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The way in which an intervention was implemented.
   */
  deliveryMethodDescriptor: string;
  /**
   * An unordered collection of interventionDiagnoses. Targeted purpose of the intervention.
   */
  diagnoses?: EdFiInterventionDiagnosis[];
  /**
   * An unordered collection of interventionEducationContents. Relates the education content source to the education content.
   */
  educationContents?: EdFiInterventionEducationContent[];
  /**
   * The end date for the intervention implementation.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * The way in which an intervention is used: curriculum, supplement, or practice.
   */
  interventionClassDescriptor: string;
  /**
   * An unordered collection of interventionInterventionPrescriptions. The reference to the intervention prescription being followed in this intervention implementation.
   */
  interventionPrescriptions?: EdFiInterventionInterventionPrescription[];
  /**
   * An unordered collection of interventionLearningResourceMetadataURIs. The URI (typical a URL) pointing to the metadata entry in a LRMI metadata repository, which describes this content item.
   */
  learningResourceMetadataURIs?: EdFiInterventionLearningResourceMetadataURI[];
  /**
   * The maximum duration of time in minutes that may be assigned for the intervention.
   */
  maxDosage?: number;
  /**
   * An unordered collection of interventionMeetingTimes. The times at which this intervention is scheduled to meet.
   */
  meetingTimes?: EdFiInterventionMeetingTime[];
  /**
   * The minimum duration of time in minutes that may be assigned for the intervention.
   */
  minDosage?: number;
  /**
   * Namespace for the intervention.
   */
  namespace?: string;
  /**
   * An unordered collection of interventionPopulationServeds. A subset of students that are the focus of the intervention.
   */
  populationServeds?: EdFiInterventionPopulationServed[];
  /**
   * An unordered collection of interventionStaffs. Relates the staff member associated with the Intervention.
   */
  staffs?: EdFiInterventionStaff[];
  /**
   * An unordered collection of interventionURIs. The URI (typical a URL) pointing to an education content item.
   */
  uris?: EdFiInterventionURI[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionAppropriateGradeLevel".
 */
export interface EdFiInterventionAppropriateGradeLevel {
  /**
   * Grade levels for the intervention. If omitted, considered generally applicable.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionAppropriateSex".
 */
export interface EdFiInterventionAppropriateSex {
  /**
   * Sexes for the intervention. If omitted, considered generally applicable.
   */
  sexDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionDiagnosis".
 */
export interface EdFiInterventionDiagnosis {
  /**
   * Targeted purpose of the intervention.
   */
  diagnosisDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionEducationContent".
 */
export interface EdFiInterventionEducationContent {
  educationContentReference: EdFiEducationContentReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionInterventionPrescription".
 */
export interface EdFiInterventionInterventionPrescription {
  interventionPrescriptionReference: EdFiInterventionPrescriptionReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionLearningResourceMetadataURI".
 */
export interface EdFiInterventionLearningResourceMetadataURI {
  /**
   * The URI (typical a URL) pointing to the metadata entry in a LRMI metadata repository, which describes this content item.
   */
  learningResourceMetadataURI: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionMeetingTime".
 */
export interface EdFiInterventionMeetingTime {
  /**
   * An indication of the time of day the meeting time ends.
   */
  endTime: string;
  /**
   * An indication of the time of day the meeting time begins.
   */
  startTime: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionPopulationServed".
 */
export interface EdFiInterventionPopulationServed {
  /**
   * A subset of students that are the focus of the intervention.
   */
  populationServedDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionStaff".
 */
export interface EdFiInterventionStaff {
  staffReference: EdFiStaffReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionURI".
 */
export interface EdFiInterventionURI {
  /**
   * The URI (typical a URL) pointing to an education content item.
   */
  uri: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionPrescription".
 */
export interface EdFiInterventionPrescription {
  id?: string;
  /**
   * A unique number or alphanumeric code assigned to an intervention prescription.
   */
  interventionPrescriptionIdentificationCode: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * An unordered collection of interventionPrescriptionAppropriateGradeLevels. Grade levels for the prescribed intervention. If omitted, considered generally applicable.
   */
  appropriateGradeLevels?: EdFiInterventionPrescriptionAppropriateGradeLevel[];
  /**
   * An unordered collection of interventionPrescriptionAppropriateSexes. Sexes for the intervention prescription. If omitted, considered generally applicable.
   */
  appropriateSexes?: EdFiInterventionPrescriptionAppropriateSex[];
  /**
   * The way in which an intervention was implemented: individual, small group, whole class, or whole school.
   */
  deliveryMethodDescriptor: string;
  /**
   * An unordered collection of interventionPrescriptionDiagnoses. Targeted purpose of the intervention prescription.
   */
  diagnoses?: EdFiInterventionPrescriptionDiagnosis[];
  /**
   * An unordered collection of interventionPrescriptionEducationContents. Relates the education content source to the education content.
   */
  educationContents?: EdFiInterventionPrescriptionEducationContent[];
  /**
   * The way in which an intervention is used: curriculum, supplement, or practice.
   */
  interventionClassDescriptor: string;
  /**
   * An unordered collection of interventionPrescriptionLearningResourceMetadataURIs. The URI (typical a URL) pointing to the metadata entry in a LRMI metadata repository, which describes this content item.
   */
  learningResourceMetadataURIs?: EdFiInterventionPrescriptionLearningResourceMetadataURI[];
  /**
   * The maximum duration of time in minutes that is recommended for the intervention.
   */
  maxDosage?: number;
  /**
   * The minimum duration of time in minutes that is recommended for the intervention.
   */
  minDosage?: number;
  /**
   * Namespace for the intervention.
   */
  namespace?: string;
  /**
   * An unordered collection of interventionPrescriptionPopulationServeds. A subset of students that are the focus of the intervention prescription.
   */
  populationServeds?: EdFiInterventionPrescriptionPopulationServed[];
  /**
   * An unordered collection of interventionPrescriptionURIs. The URI (typical a URL) pointing to an education content item.
   */
  uris?: EdFiInterventionPrescriptionURI[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionPrescriptionAppropriateGradeLevel".
 */
export interface EdFiInterventionPrescriptionAppropriateGradeLevel {
  /**
   * Grade levels for the prescribed intervention. If omitted, considered generally applicable.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionPrescriptionAppropriateSex".
 */
export interface EdFiInterventionPrescriptionAppropriateSex {
  /**
   * Sexes for the intervention prescription. If omitted, considered generally applicable.
   */
  sexDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionPrescriptionDiagnosis".
 */
export interface EdFiInterventionPrescriptionDiagnosis {
  /**
   * Targeted purpose of the intervention prescription.
   */
  diagnosisDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionPrescriptionEducationContent".
 */
export interface EdFiInterventionPrescriptionEducationContent {
  educationContentReference: EdFiEducationContentReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionPrescriptionLearningResourceMetadataURI".
 */
export interface EdFiInterventionPrescriptionLearningResourceMetadataURI {
  /**
   * The URI (typical a URL) pointing to the metadata entry in a LRMI metadata repository, which describes this content item.
   */
  learningResourceMetadataURI: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionPrescriptionPopulationServed".
 */
export interface EdFiInterventionPrescriptionPopulationServed {
  /**
   * A subset of students that are the focus of the intervention prescription.
   */
  populationServedDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionPrescriptionURI".
 */
export interface EdFiInterventionPrescriptionURI {
  /**
   * The URI (typical a URL) pointing to an education content item.
   */
  uri: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionReference".
 */
export interface EdFiInterventionReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * A unique number or alphanumeric code assigned to an intervention.
   */
  interventionIdentificationCode: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionStudy".
 */
export interface EdFiInterventionStudy {
  id?: string;
  /**
   * A unique number or alphanumeric code assigned to an intervention study.
   */
  interventionStudyIdentificationCode: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  interventionPrescriptionReference: EdFiInterventionPrescriptionReference;
  /**
   * An unordered collection of interventionStudyAppropriateGradeLevels. Grade levels participating in this study.
   */
  appropriateGradeLevels?: EdFiInterventionStudyAppropriateGradeLevel[];
  /**
   * An unordered collection of interventionStudyAppropriateSexes. Sexes participating in this study. If omitted, considered generally applicable.
   */
  appropriateSexes?: EdFiInterventionStudyAppropriateSex[];
  /**
   * The way in which an intervention was implemented: individual, small group, whole class, or whole school.
   */
  deliveryMethodDescriptor: string;
  /**
   * An unordered collection of interventionStudyEducationContents. Relates the education content source to the education content.
   */
  educationContents?: EdFiInterventionStudyEducationContent[];
  /**
   * The way in which an intervention is used: curriculum, supplement, or practice.
   */
  interventionClassDescriptor: string;
  /**
   * An unordered collection of interventionStudyInterventionEffectivenesses. Measurement of the effectiveness of the intervention study per diagnosis.
   */
  interventionEffectivenesses?: EdFiInterventionStudyInterventionEffectiveness[];
  /**
   * An unordered collection of interventionStudyLearningResourceMetadataURIs. The URI (typical a URL) pointing to the metadata entry in a LRMI metadata repository, which describes this content item.
   */
  learningResourceMetadataURIs?: EdFiInterventionStudyLearningResourceMetadataURI[];
  /**
   * The number of participants observed in the study.
   */
  participants: number;
  /**
   * An unordered collection of interventionStudyPopulationServeds. A subset of students that are the focus of the intervention study.
   */
  populationServeds?: EdFiInterventionStudyPopulationServed[];
  /**
   * An unordered collection of interventionStudyStateAbbreviations. The abbreviation for the state (within the United States) or outlying area, the school system of which the participants of the study are considered to be a part.
   */
  stateAbbreviations?: EdFiInterventionStudyStateAbbreviation[];
  /**
   * An unordered collection of interventionStudyURIs. The URI (typical a URL) pointing to an education content item.
   */
  uris?: EdFiInterventionStudyURI[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionStudyAppropriateGradeLevel".
 */
export interface EdFiInterventionStudyAppropriateGradeLevel {
  /**
   * Grade levels participating in this study.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionStudyAppropriateSex".
 */
export interface EdFiInterventionStudyAppropriateSex {
  /**
   * Sexes participating in this study. If omitted, considered generally applicable.
   */
  sexDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionStudyEducationContent".
 */
export interface EdFiInterventionStudyEducationContent {
  educationContentReference: EdFiEducationContentReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionStudyInterventionEffectiveness".
 */
export interface EdFiInterventionStudyInterventionEffectiveness {
  /**
   * Targeted purpose of the intervention (e.g., attendance issue, dropout risk) for which the effectiveness is measured.
   */
  diagnosisDescriptor: string;
  /**
   * Grade level for which effectiveness is measured.
   */
  gradeLevelDescriptor: string;
  /**
   * Population for which effectiveness is measured.
   */
  populationServedDescriptor: string;
  /**
   * An intervention demonstrates effectiveness if the research has shown that the program caused an improvement in outcomes. Values: positive effects, potentially positive effects, mixed effects, potentially negative effects, negative effects, and no discernible effects.
   */
  interventionEffectivenessRatingDescriptor: string;
  /**
   * Along a percentile distribution of students, the improvement index represents the change in an average student's percentile rank that is considered to be due to the intervention.
   */
  improvementIndex?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionStudyLearningResourceMetadataURI".
 */
export interface EdFiInterventionStudyLearningResourceMetadataURI {
  /**
   * The URI (typical a URL) pointing to the metadata entry in a LRMI metadata repository, which describes this content item.
   */
  learningResourceMetadataURI: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionStudyPopulationServed".
 */
export interface EdFiInterventionStudyPopulationServed {
  /**
   * A subset of students that are the focus of the intervention study.
   */
  populationServedDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionStudyStateAbbreviation".
 */
export interface EdFiInterventionStudyStateAbbreviation {
  /**
   * The abbreviation for the state (within the United States) or outlying area, the school system of which the participants of the study are considered to be a part.
   */
  stateAbbreviationDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_interventionStudyURI".
 */
export interface EdFiInterventionStudyURI {
  /**
   * The URI (typical a URL) pointing to an education content item.
   */
  uri: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_learningStandard".
 */
export interface EdFiLearningStandard {
  id?: string;
  /**
   * An unordered collection of learningStandardAcademicSubjects. Subject area for the learning standard.
   */
  academicSubjects: EdFiLearningStandardAcademicSubject[];
  /**
   * An unordered collection of learningStandardGradeLevels. The grade levels for the specific learning standard.
   */
  gradeLevels: EdFiLearningStandardGradeLevel[];
  /**
   * The identifier for the specific learning standard (e.g., 111.15.3.1.A).
   */
  learningStandardId: string;
  parentLearningStandardReference?: EdFiLearningStandardReference;
  contentStandard: EdFiLearningStandardContentStandard;
  /**
   * The official course title with which this learning standard is associated.
   */
  courseTitle?: string;
  /**
   * The text of the statement. The textual content that either describes a specific competency such as "Apply the Pythagorean Theorem to determine unknown side lengths in right triangles in real-world and mathematical problems in two and three dimensions." or describes a less granular group of competencies within the taxonomy of the standards document, e.g. "Understand and apply the Pythagorean Theorem," or "Geometry".
   */
  description: string;
  /**
   * An unordered collection of learningStandardIdentificationCodes. A coding scheme that is used for identification and record-keeping purposes by schools, social services, or other agencies to refer to a learning standard.
   */
  identificationCodes?: EdFiLearningStandardIdentificationCode[];
  /**
   * An additional classification of the type of a specific learning standard.
   */
  learningStandardCategoryDescriptor?: string;
  /**
   * A code designated by the promulgating body to identify the statement, e.g. 1.N.3 (usually not globally unique).
   */
  learningStandardItemCode?: string;
  /**
   * Signals the scope of usage the standard. Does not necessarily relate the standard to the governing body.
   */
  learningStandardScopeDescriptor?: string;
  /**
   * The namespace of the organization or entity who governs the standard. It is recommended the namespaces observe a URI format and begin with a domain name under the governing organization or entity control.
   */
  namespace: string;
  /**
   * One or more statements that describes the criteria used by teachers and students to check for attainment of a learning standard. This criteria gives clear indications as to the degree to which learning is moving through the Zone or Proximal Development toward independent achievement of the learning standard.
   */
  successCriteria?: string;
  /**
   * An unambiguous reference to the statement using a network-resolvable URI.
   */
  uri?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_learningStandardAcademicSubject".
 */
export interface EdFiLearningStandardAcademicSubject {
  /**
   * Subject area for the learning standard.
   */
  academicSubjectDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_learningStandardGradeLevel".
 */
export interface EdFiLearningStandardGradeLevel {
  /**
   * The grade levels for the specific learning standard.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_learningStandardContentStandard".
 */
export interface EdFiLearningStandardContentStandard {
  /**
   * The publication status of the document (i.e., Adopted, Draft, Published, Deprecated, Unknown).
   */
  publicationStatusDescriptor?: string;
  /**
   * The beginning of the period during which this learning standard document is intended for use.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The end of the period during which this learning standard document is intended for use.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * The date on which this content was first published.
   */
  publicationDate?: string;
  /**
   * The year at which this content was first published.
   */
  publicationYear?: number;
  /**
   * The name of the content standard, for example Common Core.
   */
  title: string;
  /**
   * An unambiguous reference to the standards using a network-resolvable URI.
   */
  uri?: string;
  /**
   * The version identifier for the content.
   */
  version?: string;
  mandatingEducationOrganizationReference?: EdFiEducationOrganizationReference;
  /**
   * An unordered collection of learningStandardContentStandardAuthors. The person or organization chiefly responsible for the intellectual content of the standard.
   */
  authors?: EdFiLearningStandardContentStandardAuthor[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_learningStandardContentStandardAuthor".
 */
export interface EdFiLearningStandardContentStandardAuthor {
  /**
   * The person or organization chiefly responsible for the intellectual content of the standard.
   */
  author: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_learningStandardIdentificationCode".
 */
export interface EdFiLearningStandardIdentificationCode {
  /**
   * The name of the content standard, for example Common Core.
   */
  contentStandardName: string;
  /**
   * A unique number or alphanumeric code assigned to a Learning Standard.
   */
  identificationCode: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_learningStandardEquivalenceAssociation".
 */
export interface EdFiLearningStandardEquivalenceAssociation {
  id?: string;
  /**
   * The namespace of the organization that has created and owns the association.
   */
  namespace: string;
  sourceLearningStandardReference: EdFiLearningStandardReference;
  targetLearningStandardReference: EdFiLearningStandardReference;
  /**
   * The date that the association is considered to be applicable or effective.
   */
  effectiveDate?: string;
  /**
   * Captures supplemental information on the relationship. Recommended for use only when the match is partial.
   */
  learningStandardEquivalenceStrengthDescription?: string;
  /**
   * A measure that indicates the strength or quality of the equivalence relationship.
   */
  learningStandardEquivalenceStrengthDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_localAccount".
 */
export interface EdFiLocalAccount {
  id?: string;
  /**
   * Code value for the valid combination of account dimensions by LEA under which financials are reported.
   */
  accountIdentifier: string;
  /**
   * The fiscal year for the account.
   */
  fiscalYear: number;
  chartOfAccountReference: EdFiChartOfAccountReference;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * A descriptive name for the account.
   */
  accountName?: string;
  /**
   * An unordered collection of localAccountReportingTags. Optional tag for accountability reporting.
   */
  reportingTags?: EdFiLocalAccountReportingTag[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_localAccountReportingTag".
 */
export interface EdFiLocalAccountReportingTag {
  /**
   * A descriptor used at the dimension and/or chart of account levels to demote specific state needs for reporting.
   */
  reportingTagDescriptor: string;
  /**
   * The value associated with the reporting tag.
   */
  tagValue?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_localAccountReference".
 */
export interface EdFiLocalAccountReference {
  /**
   * Code value for the valid combination of account dimensions by LEA under which financials are reported.
   */
  accountIdentifier: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The fiscal year for the account.
   */
  fiscalYear: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_localActual".
 */
export interface EdFiLocalActual {
  id?: string;
  /**
   * The date of the reported amount for the account.
   */
  asOfDate: string;
  localAccountReference: EdFiLocalAccountReference;
  /**
   * Current balance for the account.
   */
  amount: number;
  /**
   * The accounting period or grouping for which the amount is collected.
   */
  financialCollectionDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_localBudget".
 */
export interface EdFiLocalBudget {
  id?: string;
  /**
   * The date of the reported amount for the account.
   */
  asOfDate: string;
  localAccountReference: EdFiLocalAccountReference;
  /**
   * Current balance for the account.
   */
  amount: number;
  /**
   * The accounting period or grouping for which the amount is collected.
   */
  financialCollectionDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_localContractedStaff".
 */
export interface EdFiLocalContractedStaff {
  id?: string;
  /**
   * The date of the reported amount for the account.
   */
  asOfDate: string;
  localAccountReference: EdFiLocalAccountReference;
  staffReference: EdFiStaffReference;
  /**
   * Current balance for the account.
   */
  amount: number;
  /**
   * The accounting period or grouping for which the amount is collected.
   */
  financialCollectionDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_localEducationAgency".
 */
export interface EdFiLocalEducationAgency {
  id?: string;
  /**
   * An unordered collection of educationOrganizationCategories. The classification of the education agency within the geographic boundaries of a state according to the level of administrative and operational control granted by the state.
   */
  categories: EdFiEducationOrganizationCategory[];
  /**
   * The identifier assigned to a local education agency. It must be distinct from any other identifier assigned to educational organizations, such as a SchoolId, to prevent duplication.
   */
  localEducationAgencyId: number;
  educationServiceCenterReference?: EdFiEducationServiceCenterReference;
  parentLocalEducationAgencyReference?: EdFiLocalEducationAgencyReference;
  stateEducationAgencyReference?: EdFiStateEducationAgencyReference;
  /**
   * An unordered collection of localEducationAgencyAccountabilities. This entity maintains information about federal reporting and accountability for local education agencies.
   */
  accountabilities?: EdFiLocalEducationAgencyAccountability[];
  /**
   * An unordered collection of educationOrganizationAddresses. The set of elements that describes an address for the education entity, including the street address, city, state, ZIP code, and ZIP code + 4.
   */
  addresses?: EdFiEducationOrganizationAddress[];
  /**
   * A school or agency providing free public elementary or secondary education to eligible students under a specific charter granted by the state legislature or other appropriate authority and designated by such authority to be a charter school.
   */
  charterStatusDescriptor?: string;
  /**
   * An unordered collection of localEducationAgencyFederalFunds. Contains the information about the reception and use of federal funds for reporting purposes.
   */
  federalFunds?: EdFiLocalEducationAgencyFederalFunds[];
  /**
   * An unordered collection of educationOrganizationIdentificationCodes. A unique number or alphanumeric code assigned to an education organization by a school, school system, a state, or other agency or entity.
   */
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  /**
   * An unordered collection of educationOrganizationIndicators. An indicator or metric of an education organization.
   */
  indicators?: EdFiEducationOrganizationIndicator[];
  /**
   * An unordered collection of educationOrganizationInstitutionTelephones. The 10-digit telephone number, including the area code, for the education entity.
   */
  institutionTelephones?: EdFiEducationOrganizationInstitutionTelephone[];
  /**
   * An unordered collection of educationOrganizationInternationalAddresses. The set of elements that describes the international physical location of the education entity.
   */
  internationalAddresses?: EdFiEducationOrganizationInternationalAddress[];
  /**
   * The category of local education agency/district.
   */
  localEducationAgencyCategoryDescriptor: string;
  /**
   * The full, legally accepted name of the institution.
   */
  nameOfInstitution: string;
  /**
   * The current operational status of the education organization (e.g., active, inactive).
   */
  operationalStatusDescriptor?: string;
  /**
   * A short name for the institution.
   */
  shortNameOfInstitution?: string;
  /**
   * The public web site address (URL) for the education organization.
   */
  webSite?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_localEducationAgencyReference".
 */
export interface EdFiLocalEducationAgencyReference {
  /**
   * The identifier assigned to a local education agency. It must be distinct from any other identifier assigned to educational organizations, such as a SchoolId, to prevent duplication.
   */
  localEducationAgencyId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_localEducationAgencyAccountability".
 */
export interface EdFiLocalEducationAgencyAccountability {
  /**
   * An indication of whether the school or Local Education Agency (LEA) submitted a Gun-Free Schools Act (GFSA) of 1994 report to the state, as defined by Title 18, Section 921.
   */
  gunFreeSchoolsActReportingStatusDescriptor?: string;
  /**
   * An indication of whether the LEA was able to implement the provisions for public school choice under Title I, Part A, Section 1116 of ESEA as amended.
   */
  schoolChoiceImplementStatusDescriptor?: string;
  schoolYearTypeReference: EdFiSchoolYearTypeReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_localEducationAgencyFederalFunds".
 */
export interface EdFiLocalEducationAgencyFederalFunds {
  /**
   * The fiscal year for which the federal funds are received.
   */
  fiscalYear: number;
  /**
   * The total Title V, Part A funds expended by LEAs.
   */
  innovativeDollarsSpent?: number;
  /**
   * The total amount of Title V, Part A funds expended by LEAs for the four strategic priorities.
   */
  innovativeDollarsSpentStrategicPriorities?: number;
  /**
   * The total Title V, Part A funds received by LEAs.
   */
  innovativeProgramsFundsReceived?: number;
  /**
   * The amount of Section 1003(a) and 1003(g) allocations to LEAs.
   */
  schoolImprovementAllocation?: number;
  /**
   * An indication of the percentage of the Title I, Part A allocation that the SEA reserved in accordance with Section 1003(a) of ESEA and 200.100(a) of ED's regulations governing the reservation of funds for school improvement under Section 1003(a) of ESEA.
   */
  schoolImprovementReservedFundsPercentage?: number;
  /**
   * The percentage of funds used to administer assessments required by Section 1111(b) or to carry out other activities described in Section 6111 and other activities related to ensuring that the state's schools and LEAs are held accountable for results.
   */
  stateAssessmentAdministrationFunding?: number;
  /**
   * The dollar amount spent on supplemental educational services during the school year under Title I, Part A, Section 1116 of ESEA as amended.
   */
  supplementalEducationalServicesFundsSpent?: number;
  /**
   * The maximum dollar amount that may be spent per child for expenditures related to supplemental educational services under Title I of the ESEA.
   */
  supplementalEducationalServicesPerPupilExpenditure?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_localEncumbrance".
 */
export interface EdFiLocalEncumbrance {
  id?: string;
  /**
   * The date of the reported amount for the account.
   */
  asOfDate: string;
  localAccountReference: EdFiLocalAccountReference;
  /**
   * Current balance for the account.
   */
  amount: number;
  /**
   * The accounting period or grouping for which the amount is collected.
   */
  financialCollectionDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_localPayroll".
 */
export interface EdFiLocalPayroll {
  id?: string;
  /**
   * The date of the reported amount for the account.
   */
  asOfDate: string;
  localAccountReference: EdFiLocalAccountReference;
  staffReference: EdFiStaffReference;
  /**
   * Current balance for the account.
   */
  amount: number;
  /**
   * The accounting period or grouping for which the amount is collected.
   */
  financialCollectionDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_location".
 */
export interface EdFiLocation {
  id?: string;
  /**
   * A unique number or alphanumeric code assigned to a room by a school, school system, state, or other agency or entity.
   */
  classroomIdentificationCode: string;
  schoolReference: EdFiSchoolReference;
  /**
   * The most number of seats the class can maintain.
   */
  maximumNumberOfSeats?: number;
  /**
   * The number of seats that is most favorable to the class.
   */
  optimalNumberOfSeats?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_locationReference".
 */
export interface EdFiLocationReference {
  /**
   * A unique number or alphanumeric code assigned to a room by a school, school system, state, or other agency or entity.
   */
  classroomIdentificationCode: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_objectDimension".
 */
export interface EdFiObjectDimension {
  id?: string;
  /**
   * The code representation of the account object dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account object dimension is valid.
   */
  fiscalYear: number;
  /**
   * A description of the account object dimension.
   */
  codeName?: string;
  /**
   * An unordered collection of objectDimensionReportingTags. Optional tag for accountability reporting.
   */
  reportingTags?: EdFiObjectDimensionReportingTag[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_objectDimensionReportingTag".
 */
export interface EdFiObjectDimensionReportingTag {
  /**
   * Optional tag for accountability reporting.
   */
  reportingTagDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_objectiveAssessment".
 */
export interface EdFiObjectiveAssessment {
  id?: string;
  /**
   * A unique number or alphanumeric code assigned to an objective assessment by a school, school system, a state, or other agency or entity.
   */
  identificationCode: string;
  assessmentReference: EdFiAssessmentReference;
  parentObjectiveAssessmentReference?: EdFiObjectiveAssessmentReference;
  /**
   * The subject area of the objective assessment.
   */
  academicSubjectDescriptor?: string;
  /**
   * An unordered collection of objectiveAssessmentAssessmentItems. References individual test items, if appropriate.
   */
  assessmentItems?: EdFiObjectiveAssessmentAssessmentItem[];
  /**
   * The description of the objective assessment (e.g., vocabulary, measurement, or geometry).
   */
  description?: string;
  /**
   * An unordered collection of objectiveAssessmentLearningStandards. Learning standard tested by this objective assessment.
   */
  learningStandards?: EdFiObjectiveAssessmentLearningStandard[];
  /**
   * The maximum raw score achievable across all assessment items that are correct and scored at the maximum.
   */
  maxRawScore?: number;
  /**
   * Reflects the specific nomenclature used for this level of objective assessment.
   */
  nomenclature?: string;
  /**
   * The percentage of the assessment that tests this objective.
   */
  percentOfAssessment?: number;
  /**
   * An unordered collection of objectiveAssessmentPerformanceLevels. Definition of the performance levels and the associated cut scores. Three styles are supported: 1. Specification of performance level by minimum and maximum score, 2. Specification of performance level by cut score, using only minimum score, 3. Specification of performance level without any mapping to scores
   */
  performanceLevels?: EdFiObjectiveAssessmentPerformanceLevel[];
  /**
   * An unordered collection of objectiveAssessmentScores. Definition of the scores to be expected from this objective assessment.
   */
  scores?: EdFiObjectiveAssessmentScore[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_objectiveAssessmentAssessmentItem".
 */
export interface EdFiObjectiveAssessmentAssessmentItem {
  assessmentItemReference: EdFiAssessmentItemReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_objectiveAssessmentLearningStandard".
 */
export interface EdFiObjectiveAssessmentLearningStandard {
  learningStandardReference: EdFiLearningStandardReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_objectiveAssessmentPerformanceLevel".
 */
export interface EdFiObjectiveAssessmentPerformanceLevel {
  /**
   * The method that the instructor of the class uses to report the performance and achievement of all students. It may be a qualitative method such as individualized teacher comments or a quantitative method such as a letter or numerical grade. In some cases, more than one type of reporting method may be used.
   */
  assessmentReportingMethodDescriptor: string;
  /**
   * The performance level(s) defined for the assessment.
   */
  performanceLevelDescriptor: string;
  /**
   * The datatype of the result. The results can be expressed as a number, percentile, range, level, etc.
   */
  resultDatatypeTypeDescriptor?: string;
  /**
   * The maximum score to make the indicated level of performance.
   */
  maximumScore?: string;
  /**
   * The minimum score required to make the indicated level of performance.
   */
  minimumScore?: string;
  /**
   * The name of the indicator being measured for a collection of performance level values.
   */
  performanceLevelIndicatorName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_objectiveAssessmentScore".
 */
export interface EdFiObjectiveAssessmentScore {
  /**
   * The method that the administrator of the assessment uses to report the performance and achievement of all students. It may be a qualitative method such as performance level descriptors or a quantitative method such as a numerical grade or cut score. More than one type of reporting method may be used.
   */
  assessmentReportingMethodDescriptor: string;
  /**
   * The datatype of the result. The results can be expressed as a number, percentile, range, level, etc.
   */
  resultDatatypeTypeDescriptor?: string;
  /**
   * The maximum score possible on the assessment.
   */
  maximumScore?: string;
  /**
   * The minimum score possible on the assessment.
   */
  minimumScore?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_openStaffPosition".
 */
export interface EdFiOpenStaffPosition {
  id?: string;
  /**
   * The number or identifier assigned to an open staff position, typically a requisition number assigned by Human Resources.
   */
  requisitionNumber: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * An unordered collection of openStaffPositionAcademicSubjects. The teaching field required for the open staff position.
   */
  academicSubjects?: EdFiOpenStaffPositionAcademicSubject[];
  /**
   * Date the open staff position was posted.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  datePosted: string;
  /**
   * The date the posting was removed or filled.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  datePostingRemoved?: string;
  /**
   * Reflects the type of employment or contract desired for the position.
   */
  employmentStatusDescriptor: string;
  /**
   * An unordered collection of openStaffPositionInstructionalGradeLevels. The set of grade levels for which the position's assignment is responsible.
   */
  instructionalGradeLevels?: EdFiOpenStaffPositionInstructionalGradeLevel[];
  /**
   * The descriptive name of an individual's position.
   */
  positionTitle?: string;
  /**
   * Indication of whether the OpenStaffPosition was filled or retired without filling.
   */
  postingResultDescriptor?: string;
  /**
   * The name of the program for which the open staff position will be assigned.
   */
  programAssignmentDescriptor?: string;
  /**
   * The titles of employment, official status, or rank of education staff.
   */
  staffClassificationDescriptor: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_openStaffPositionAcademicSubject".
 */
export interface EdFiOpenStaffPositionAcademicSubject {
  /**
   * The teaching field required for the open staff position.
   */
  academicSubjectDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_openStaffPositionInstructionalGradeLevel".
 */
export interface EdFiOpenStaffPositionInstructionalGradeLevel {
  /**
   * The set of grade levels for which the position's assignment is responsible.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_operationalUnitDimension".
 */
export interface EdFiOperationalUnitDimension {
  id?: string;
  /**
   * The code representation of the account operational unit dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account operational unit dimension is valid.
   */
  fiscalYear: number;
  /**
   * A description of the account operational unit dimension.
   */
  codeName?: string;
  /**
   * An unordered collection of operationalUnitDimensionReportingTags. Optional tag for accountability reporting.
   */
  reportingTags?: EdFiOperationalUnitDimensionReportingTag[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_operationalUnitDimensionReportingTag".
 */
export interface EdFiOperationalUnitDimensionReportingTag {
  /**
   * Optional tag for accountability reporting.
   */
  reportingTagDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_organizationDepartment".
 */
export interface EdFiOrganizationDepartment {
  id?: string;
  /**
   * An unordered collection of educationOrganizationCategories. The classification of the education agency within the geographic boundaries of a state according to the level of administrative and operational control granted by the state.
   */
  categories: EdFiEducationOrganizationCategory[];
  /**
   * The unique identification code for the organization department. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  organizationDepartmentId: number;
  parentEducationOrganizationReference?: EdFiEducationOrganizationReference;
  /**
   * The intended major subject area of the department.
   */
  academicSubjectDescriptor?: string;
  /**
   * An unordered collection of educationOrganizationAddresses. The set of elements that describes an address for the education entity, including the street address, city, state, ZIP code, and ZIP code + 4.
   */
  addresses?: EdFiEducationOrganizationAddress[];
  /**
   * An unordered collection of educationOrganizationIdentificationCodes. A unique number or alphanumeric code assigned to an education organization by a school, school system, a state, or other agency or entity.
   */
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  /**
   * An unordered collection of educationOrganizationIndicators. An indicator or metric of an education organization.
   */
  indicators?: EdFiEducationOrganizationIndicator[];
  /**
   * An unordered collection of educationOrganizationInstitutionTelephones. The 10-digit telephone number, including the area code, for the education entity.
   */
  institutionTelephones?: EdFiEducationOrganizationInstitutionTelephone[];
  /**
   * An unordered collection of educationOrganizationInternationalAddresses. The set of elements that describes the international physical location of the education entity.
   */
  internationalAddresses?: EdFiEducationOrganizationInternationalAddress[];
  /**
   * The full, legally accepted name of the institution.
   */
  nameOfInstitution: string;
  /**
   * The current operational status of the education organization (e.g., active, inactive).
   */
  operationalStatusDescriptor?: string;
  /**
   * A short name for the institution.
   */
  shortNameOfInstitution?: string;
  /**
   * The public web site address (URL) for the education organization.
   */
  webSite?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_person".
 */
export interface EdFiPerson {
  id?: string;
  /**
   * A unique alphanumeric code assigned to a person.
   */
  personId: string;
  /**
   * This descriptor defines the originating record source system for the person.
   */
  sourceSystemDescriptor: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_postSecondaryEvent".
 */
export interface EdFiPostSecondaryEvent {
  id?: string;
  /**
   * The date the event occurred or was recorded.
   */
  eventDate: string;
  /**
   * The post secondary event that is logged.
   */
  postSecondaryEventCategoryDescriptor: string;
  postSecondaryInstitutionReference?: EdFiPostSecondaryInstitutionReference;
  studentReference: EdFiStudentReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_postSecondaryInstitutionReference".
 */
export interface EdFiPostSecondaryInstitutionReference {
  /**
   * The ID of the post secondary institution. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  postSecondaryInstitutionId: number;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_postSecondaryInstitution".
 */
export interface EdFiPostSecondaryInstitution {
  id?: string;
  /**
   * An unordered collection of educationOrganizationCategories. The classification of the education agency within the geographic boundaries of a state according to the level of administrative and operational control granted by the state.
   */
  categories: EdFiEducationOrganizationCategory[];
  /**
   * The ID of the post secondary institution. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  postSecondaryInstitutionId: number;
  /**
   * An unordered collection of educationOrganizationAddresses. The set of elements that describes an address for the education entity, including the street address, city, state, ZIP code, and ZIP code + 4.
   */
  addresses?: EdFiEducationOrganizationAddress[];
  /**
   * A classification of whether a postsecondary institution is operated by publicly elected or appointed officials (public control) or by privately elected or appointed officials and derives its major source of funds from private sources (private control).
   */
  administrativeFundingControlDescriptor?: string;
  /**
   * An unordered collection of educationOrganizationIdentificationCodes. A unique number or alphanumeric code assigned to an education organization by a school, school system, a state, or other agency or entity.
   */
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  /**
   * An unordered collection of educationOrganizationIndicators. An indicator or metric of an education organization.
   */
  indicators?: EdFiEducationOrganizationIndicator[];
  /**
   * An unordered collection of educationOrganizationInstitutionTelephones. The 10-digit telephone number, including the area code, for the education entity.
   */
  institutionTelephones?: EdFiEducationOrganizationInstitutionTelephone[];
  /**
   * An unordered collection of educationOrganizationInternationalAddresses. The set of elements that describes the international physical location of the education entity.
   */
  internationalAddresses?: EdFiEducationOrganizationInternationalAddress[];
  /**
   * An unordered collection of postSecondaryInstitutionMediumOfInstructions. The categories in which an institution serves the students.
   */
  mediumOfInstructions?: EdFiPostSecondaryInstitutionMediumOfInstruction[];
  /**
   * The full, legally accepted name of the institution.
   */
  nameOfInstitution: string;
  /**
   * The current operational status of the education organization (e.g., active, inactive).
   */
  operationalStatusDescriptor?: string;
  /**
   * A classification of whether a post secondary institution's highest level of offering is a program of 4-years or higher (4 year), 2-but-less-than 4-years (2 year), or less than 2-years.
   */
  postSecondaryInstitutionLevelDescriptor?: string;
  /**
   * A short name for the institution.
   */
  shortNameOfInstitution?: string;
  /**
   * The public web site address (URL) for the education organization.
   */
  webSite?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_postSecondaryInstitutionMediumOfInstruction".
 */
export interface EdFiPostSecondaryInstitutionMediumOfInstruction {
  /**
   * The categories in which an institution serves the students.
   */
  mediumOfInstructionDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_program".
 */
export interface EdFiProgram {
  id?: string;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName: string;
  /**
   * The type of program.
   */
  programTypeDescriptor: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * An unordered collection of programCharacteristics. Reflects important characteristics of the program, such as categories or particular indications.
   */
  characteristics?: EdFiProgramCharacteristic[];
  /**
   * An unordered collection of programLearningStandards. Learning standard followed by this program.
   */
  learningStandards?: EdFiProgramLearningStandard[];
  /**
   * A unique number or alphanumeric code assigned to a program by a school, school system, a state, or other agency or entity.
   */
  programId?: string;
  /**
   * An unordered collection of programSponsors. Ultimate and intermediate providers of funds for a particular educational or service program or activity, or for an individual's participation in the program or activity (e.g., Federal, State, ESC, District, School, Private Organization).
   */
  sponsors?: EdFiProgramSponsor[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programCharacteristic".
 */
export interface EdFiProgramCharacteristic {
  /**
   * Reflects important characteristics of the program, such as categories or particular indications.
   */
  programCharacteristicDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programLearningStandard".
 */
export interface EdFiProgramLearningStandard {
  learningStandardReference: EdFiLearningStandardReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programSponsor".
 */
export interface EdFiProgramSponsor {
  /**
   * Ultimate and intermediate providers of funds for a particular educational or service program or activity, or for an individual's participation in the program or activity (e.g., Federal, State, ESC, District, School, Private Organization).
   */
  programSponsorDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programDimension".
 */
export interface EdFiProgramDimension {
  id?: string;
  /**
   * The code representation of the account program dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account program dimension is valid.
   */
  fiscalYear: number;
  /**
   * A description of the account program dimension.
   */
  codeName?: string;
  /**
   * An unordered collection of programDimensionReportingTags. Optional tag for accountability reporting.
   */
  reportingTags?: EdFiProgramDimensionReportingTag[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programDimensionReportingTag".
 */
export interface EdFiProgramDimensionReportingTag {
  /**
   * Optional tag for accountability reporting.
   */
  reportingTagDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programEvaluation".
 */
export interface EdFiProgramEvaluation {
  id?: string;
  /**
   * The name of the period for the program evaluation.
   */
  programEvaluationPeriodDescriptor: string;
  /**
   * An assigned unique identifier for the student program evaluation.
   */
  programEvaluationTitle: string;
  /**
   * The type of program evaluation conducted.
   */
  programEvaluationTypeDescriptor: string;
  programReference: EdFiProgramReference;
  /**
   * The maximum summary numerical rating or score for the program evaluation.
   */
  evaluationMaxNumericRating?: number;
  /**
   * The minimum summary numerical rating or score for the program evaluation. If omitted, assumed to be 0.0
   */
  evaluationMinNumericRating?: number;
  /**
   * An unordered collection of programEvaluationLevels. The descriptive level(s) of ratings (cut scores) for the program evaluation.
   */
  levels?: EdFiProgramEvaluationLevel[];
  /**
   * The long description of the program evaluation.
   */
  programEvaluationDescription?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programEvaluationLevel".
 */
export interface EdFiProgramEvaluationLevel {
  /**
   * The title for a level of rating or evaluation band (e.g., Excellent, Acceptable, Needs Improvement, Unacceptable).
   */
  ratingLevelDescriptor: string;
  /**
   * The maximum numerical rating or score to achieve the evaluation rating level.
   */
  maxNumericRating?: number;
  /**
   * The minimum numerical rating or score to achieve the evaluation rating level.
   */
  minNumericRating?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programEvaluationElement".
 */
export interface EdFiProgramEvaluationElement {
  id?: string;
  /**
   * The name or title of the program evaluation element.
   */
  programEvaluationElementTitle: string;
  programEvaluationObjectiveReference?: EdFiProgramEvaluationObjectiveReference;
  programEvaluationReference: EdFiProgramEvaluationReference;
  /**
   * The maximum summary numerical rating or score for the program evaluation element.
   */
  elementMaxNumericRating?: number;
  /**
   * The minimum summary numerical rating or score for the program evaluation element. If omitted, assumed to be 0.0.
   */
  elementMinNumericRating?: number;
  /**
   * The sort order of this program evaluation element.
   */
  elementSortOrder?: number;
  /**
   * The long description of the program evaluation element.
   */
  programEvaluationElementDescription?: string;
  /**
   * An unordered collection of programEvaluationElementProgramEvaluationLevels. The descriptive level(s) of ratings (cut scores) for the program evaluation element.
   */
  programEvaluationLevels?: EdFiProgramEvaluationElementProgramEvaluationLevel[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programEvaluationObjectiveReference".
 */
export interface EdFiProgramEvaluationObjectiveReference {
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId: number;
  /**
   * The name or title of the program evaluation objective.
   */
  programEvaluationObjectiveTitle: string;
  /**
   * The name of the period for the program evaluation.
   */
  programEvaluationPeriodDescriptor: string;
  /**
   * An assigned unique identifier for the student program evaluation.
   */
  programEvaluationTitle: string;
  /**
   * The type of program evaluation conducted.
   */
  programEvaluationTypeDescriptor: string;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName: string;
  /**
   * The type of program.
   */
  programTypeDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programEvaluationReference".
 */
export interface EdFiProgramEvaluationReference {
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId: number;
  /**
   * The name of the period for the program evaluation.
   */
  programEvaluationPeriodDescriptor: string;
  /**
   * An assigned unique identifier for the student program evaluation.
   */
  programEvaluationTitle: string;
  /**
   * The type of program evaluation conducted.
   */
  programEvaluationTypeDescriptor: string;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName: string;
  /**
   * The type of program.
   */
  programTypeDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programEvaluationElementProgramEvaluationLevel".
 */
export interface EdFiProgramEvaluationElementProgramEvaluationLevel {
  /**
   * The title for a level of rating or evaluation band (e.g., Excellent, Acceptable, Needs Improvement, Unacceptable).
   */
  ratingLevelDescriptor: string;
  /**
   * The maximum numerical rating or score to achieve the evaluation rating level.
   */
  maxNumericRating?: number;
  /**
   * The minimum numerical rating or score to achieve the evaluation rating level.
   */
  minNumericRating?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programEvaluationObjective".
 */
export interface EdFiProgramEvaluationObjective {
  id?: string;
  /**
   * The name or title of the program evaluation objective.
   */
  programEvaluationObjectiveTitle: string;
  programEvaluationReference: EdFiProgramEvaluationReference;
  /**
   * The maximum summary numerical rating or score for the program evaluation objective.
   */
  objectiveMaxNumericRating?: number;
  /**
   * The minimum summary numerical rating or score for the program evaluation objective. If omitted, assumed to be 0.0
   */
  objectiveMinNumericRating?: number;
  /**
   * The sort order of this program evaluation objective.
   */
  objectiveSortOrder?: number;
  /**
   * An unordered collection of programEvaluationObjectiveProgramEvaluationLevels. The descriptive level(s) of ratings (cut scores) for the program evaluation objective.
   */
  programEvaluationLevels?: EdFiProgramEvaluationObjectiveProgramEvaluationLevel[];
  /**
   * The long description of the program evaluation objective.
   */
  programEvaluationObjectiveDescription?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_programEvaluationObjectiveProgramEvaluationLevel".
 */
export interface EdFiProgramEvaluationObjectiveProgramEvaluationLevel {
  /**
   * The title for a level of rating or evaluation band (e.g., Excellent, Acceptable, Needs Improvement, Unacceptable).
   */
  ratingLevelDescriptor: string;
  /**
   * The maximum numerical rating or score to achieve the evaluation rating level.
   */
  maxNumericRating?: number;
  /**
   * The minimum numerical rating or score to achieve the evaluation rating level.
   */
  minNumericRating?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_projectDimension".
 */
export interface EdFiProjectDimension {
  id?: string;
  /**
   * The code representation of the account project dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account project dimension is valid.
   */
  fiscalYear: number;
  /**
   * A description of the account project dimension.
   */
  codeName?: string;
  /**
   * An unordered collection of projectDimensionReportingTags. Optional tag for accountability reporting.
   */
  reportingTags?: EdFiProjectDimensionReportingTag[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_projectDimensionReportingTag".
 */
export interface EdFiProjectDimensionReportingTag {
  /**
   * Optional tag for accountability reporting.
   */
  reportingTagDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_reportCard".
 */
export interface EdFiReportCard {
  id?: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  gradingPeriodReference: EdFiGradingPeriodReference;
  studentReference: EdFiStudentReference;
  /**
   * An unordered collection of reportCardGradePointAverages. A measure of average performance for courses taken by an individual.
   */
  gradePointAverages?: EdFiReportCardGradePointAverage[];
  /**
   * An unordered collection of reportCardGrades. Grades for the classes attended by the student for this grading period.
   */
  grades?: EdFiReportCardGrade[];
  /**
   * The number of days an individual is absent when school is in session during a given reporting period.
   */
  numberOfDaysAbsent?: number;
  /**
   * The number of days an individual is present when school is in session during a given reporting period.
   */
  numberOfDaysInAttendance?: number;
  /**
   * The number of days an individual is tardy during a given reporting period.
   */
  numberOfDaysTardy?: number;
  /**
   * An unordered collection of reportCardStudentCompetencyObjectives. The student competency evaluations associated for this grading period.
   */
  studentCompetencyObjectives?: EdFiReportCardStudentCompetencyObjective[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_reportCardGradePointAverage".
 */
export interface EdFiReportCardGradePointAverage {
  /**
   * The system used for calculating the grade point average for an individual.
   */
  gradePointAverageTypeDescriptor: string;
  /**
   * The value of the grade points earned divided by the number of credits attempted.
   */
  gradePointAverageValue: number;
  /**
   * Indicator of whether or not the Grade Point Average value is cumulative.
   */
  isCumulative?: boolean;
  /**
   * The maximum value for the grade point average.
   */
  maxGradePointAverageValue?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_reportCardGrade".
 */
export interface EdFiReportCardGrade {
  gradeReference: EdFiGradeReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_reportCardStudentCompetencyObjective".
 */
export interface EdFiReportCardStudentCompetencyObjective {
  studentCompetencyObjectiveReference: EdFiStudentCompetencyObjectiveReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentCompetencyObjectiveReference".
 */
export interface EdFiStudentCompetencyObjectiveReference {
  /**
   * The state's name of the period for which grades are reported.
   */
  gradingPeriodDescriptor: string;
  /**
   * The school's descriptive name of the grading period.
   */
  gradingPeriodName: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  gradingPeriodSchoolId: number;
  /**
   * The identifier for the grading period school year.
   */
  gradingPeriodSchoolYear: number;
  /**
   * The designated title of the competency objective.
   */
  objective: string;
  /**
   * The identifier assigned to an education organization.
   */
  objectiveEducationOrganizationId: number;
  /**
   * The grade level for which the competency objective is targeted.
   */
  objectiveGradeLevelDescriptor: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_reportCardReference".
 */
export interface EdFiReportCardReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The state's name of the period for which grades are reported.
   */
  gradingPeriodDescriptor: string;
  /**
   * The school's descriptive name of the grading period.
   */
  gradingPeriodName: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  gradingPeriodSchoolId: number;
  /**
   * The identifier for the grading period school year.
   */
  gradingPeriodSchoolYear: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_restraintEvent".
 */
export interface EdFiRestraintEvent {
  id?: string;
  /**
   * A unique number or alphanumeric code assigned to a restraint event by a school, school system, state, or other agency or entity.
   */
  restraintEventIdentifier: string;
  disciplineIncidentReference?: EdFiDisciplineIncidentReference;
  schoolReference: EdFiSchoolReference;
  studentReference: EdFiStudentReference;
  /**
   * The setting where the RestraintEvent was exercised.
   */
  educationalEnvironmentDescriptor?: string;
  /**
   * Month, day, and year of the restraint event.
   */
  eventDate: string;
  /**
   * An unordered collection of restraintEventPrograms. The special education program associated with the restraint event.
   */
  programs?: EdFiRestraintEventProgram[];
  /**
   * An unordered collection of restraintEventReasons. A categorization of the circumstances or reason for the RestraintEvent.
   */
  reasons?: EdFiRestraintEventReason[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_restraintEventProgram".
 */
export interface EdFiRestraintEventProgram {
  programReference: EdFiProgramReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_restraintEventReason".
 */
export interface EdFiRestraintEventReason {
  /**
   * A categorization of the circumstances or reason for the RestraintEvent.
   */
  restraintEventReasonDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_school".
 */
export interface EdFiSchool {
  id?: string;
  /**
   * An unordered collection of educationOrganizationCategories. The classification of the education agency within the geographic boundaries of a state according to the level of administrative and operational control granted by the state.
   */
  educationOrganizationCategories: EdFiEducationOrganizationCategory[];
  /**
   * An unordered collection of schoolGradeLevels. The grade levels served at the school.
   */
  gradeLevels: EdFiSchoolGradeLevel[];
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  charterApprovalSchoolYearTypeReference?: EdFiSchoolYearTypeReference;
  localEducationAgencyReference?: EdFiLocalEducationAgencyReference;
  /**
   * An unordered collection of educationOrganizationAddresses. The set of elements that describes an address for the education entity, including the street address, city, state, ZIP code, and ZIP code + 4.
   */
  addresses?: EdFiEducationOrganizationAddress[];
  /**
   * The type of education institution as classified by its funding source, for example public or private.
   */
  administrativeFundingControlDescriptor?: string;
  /**
   * The type of agency that approved the establishment or continuation of a charter school.
   */
  charterApprovalAgencyTypeDescriptor?: string;
  /**
   * A school or agency providing free public elementary or secondary education to eligible students under a specific charter granted by the state legislature or other appropriate authority and designated by such authority to be a charter school.
   */
  charterStatusDescriptor?: string;
  /**
   * An unordered collection of educationOrganizationIdentificationCodes. A unique number or alphanumeric code assigned to an education organization by a school, school system, a state, or other agency or entity.
   */
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  /**
   * An unordered collection of educationOrganizationIndicators. An indicator or metric of an education organization.
   */
  indicators?: EdFiEducationOrganizationIndicator[];
  /**
   * An unordered collection of educationOrganizationInstitutionTelephones. The 10-digit telephone number, including the area code, for the education entity.
   */
  institutionTelephones?: EdFiEducationOrganizationInstitutionTelephone[];
  /**
   * An unordered collection of educationOrganizationInternationalAddresses. The set of elements that describes the international physical location of the education entity.
   */
  internationalAddresses?: EdFiEducationOrganizationInternationalAddress[];
  /**
   * The type of Internet access available.
   */
  internetAccessDescriptor?: string;
  /**
   * A school that has been designed: 1) to attract students of different racial/ethnic backgrounds for the purpose of reducing, preventing, or eliminating racial isolation; and/or 2) to provide an academic or social focus on a particular theme (e.g., science/math, performing arts, gifted/talented, or foreign language).
   */
  magnetSpecialProgramEmphasisSchoolDescriptor?: string;
  /**
   * The full, legally accepted name of the institution.
   */
  nameOfInstitution: string;
  /**
   * The current operational status of the education organization (e.g., active, inactive).
   */
  operationalStatusDescriptor?: string;
  /**
   * An unordered collection of schoolCategories. The one or more categories of school.
   */
  schoolCategories?: EdFiSchoolCategory[];
  /**
   * The type of education institution as classified by its primary focus.
   */
  schoolTypeDescriptor?: string;
  /**
   * A short name for the institution.
   */
  shortNameOfInstitution?: string;
  /**
   * Denotes the Title I Part A designation for the school.
   */
  titleIPartASchoolDesignationDescriptor?: string;
  /**
   * The public web site address (URL) for the education organization.
   */
  webSite?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  _ext?: SchoolExtensions;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_schoolGradeLevel".
 */
export interface EdFiSchoolGradeLevel {
  /**
   * The grade levels served at the school.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_schoolCategory".
 */
export interface EdFiSchoolCategory {
  /**
   * The one or more categories of school.
   */
  schoolCategoryDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "schoolExtensions".
 */
export interface SchoolExtensions {
  tpdm?: TpdmSchoolExtension;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_schoolExtension".
 */
export interface TpdmSchoolExtension {
  postSecondaryInstitutionReference?: EdFiPostSecondaryInstitutionReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_schoolYearType".
 */
export interface EdFiSchoolYearType {
  id?: string;
  /**
   * Key for School Year
   */
  schoolYear: number;
  /**
   * The code for the current school year.
   */
  currentSchoolYear: boolean;
  /**
   * The description for the SchoolYear type.
   */
  schoolYearDescription: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_section".
 */
export interface EdFiSection {
  id?: string;
  /**
   * The local identifier assigned to a section.
   */
  sectionIdentifier: string;
  courseOfferingReference: EdFiCourseOfferingReference;
  locationReference?: EdFiLocationReference;
  locationSchoolReference?: EdFiSchoolReference;
  /**
   * Conversion factor that when multiplied by the number of credits is equivalent to Carnegie units.
   */
  availableCreditConversion?: number;
  /**
   * The value of credits or units of value awarded for the completion of a course.
   */
  availableCredits?: number;
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  availableCreditTypeDescriptor?: string;
  /**
   * An unordered collection of sectionCharacteristics. Reflects important characteristics of the section, such as whether or not attendance is taken and the section is graded.
   */
  characteristics?: EdFiSectionCharacteristic[];
  /**
   * An unordered collection of sectionClassPeriods. The class period during which the section meets.
   */
  classPeriods?: EdFiSectionClassPeriod[];
  /**
   * An unordered collection of sectionCourseLevelCharacteristics. The type of specific program or designation with which the section is associated. This collection should only be populated if it differs from the course level characteristics identified at the course offering level.
   */
  courseLevelCharacteristics?: EdFiSectionCourseLevelCharacteristic[];
  /**
   * The setting in which a student receives education and related services.
   */
  educationalEnvironmentDescriptor?: string;
  /**
   * The primary language of instruction. If omitted, English is assumed.
   */
  instructionLanguageDescriptor?: string;
  /**
   * The media through which teachers provide instruction to students and students and teachers communicate about instructional matters.
   */
  mediumOfInstructionDescriptor?: string;
  /**
   * An unordered collection of sectionOfferedGradeLevels. The grade levels in which the section is offered. This collection should only be populated if it differs from the Offered Grade Levels identified at the course offering level.
   */
  offeredGradeLevels?: EdFiSectionOfferedGradeLevel[];
  /**
   * Indicator of whether this section is used for official daily attendance. Alternatively, official daily attendance may be tied to a class period.
   */
  officialAttendancePeriod?: boolean;
  /**
   * The type of students the section is offered and tailored to.
   */
  populationServedDescriptor?: string;
  /**
   * An unordered collection of sectionPrograms. Optional reference to program to which the section is associated.
   */
  programs?: EdFiSectionProgram[];
  /**
   * A locally-defined name for the section, generally created to make the section more recognizable in informal contexts and generally distinct from the section identifier.
   */
  sectionName?: string;
  /**
   * Specifies whether the section is for attendance only, credit only, or both.
   */
  sectionTypeDescriptor?: string;
  /**
   * When a section is part of a sequence of parts for a course, the number of the sequence. If the course has only one part, the value of this section attribute should be 1.
   */
  sequenceOfCourse?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_sectionCharacteristic".
 */
export interface EdFiSectionCharacteristic {
  /**
   * Reflects important characteristics of the section, such as whether or not attendance is taken and the section is graded.
   */
  sectionCharacteristicDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_sectionClassPeriod".
 */
export interface EdFiSectionClassPeriod {
  classPeriodReference: EdFiClassPeriodReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_sectionCourseLevelCharacteristic".
 */
export interface EdFiSectionCourseLevelCharacteristic {
  /**
   * The type of specific program or designation with which the section is associated. This collection should only be populated if it differs from the course level characteristics identified at the course offering level.
   */
  courseLevelCharacteristicDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_sectionOfferedGradeLevel".
 */
export interface EdFiSectionOfferedGradeLevel {
  /**
   * The grade levels in which the section is offered. This collection should only be populated if it differs from the Offered Grade Levels identified at the course offering level.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_sectionProgram".
 */
export interface EdFiSectionProgram {
  programReference: EdFiProgramReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_sectionAttendanceTakenEvent".
 */
export interface EdFiSectionAttendanceTakenEvent {
  id?: string;
  calendarDateReference: EdFiCalendarDateReference;
  sectionReference: EdFiSectionReference;
  staffReference?: EdFiStaffReference;
  /**
   * The date the section attendance taken event was submitted, which could be a different date than the instructional day.
   */
  eventDate: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_session".
 */
export interface EdFiSession {
  id?: string;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName: string;
  schoolReference: EdFiSchoolReference;
  schoolYearTypeReference: EdFiSchoolYearTypeReference;
  /**
   * An unordered collection of sessionAcademicWeeks. The academic weeks associated with the school year.
   */
  academicWeeks?: EdFiSessionAcademicWeek[];
  /**
   * Month, day, and year of the first day of the session.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * Month, day and year of the last day of the session.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate: string;
  /**
   * An unordered collection of sessionGradingPeriods. Grading periods associated with the session.
   */
  gradingPeriods?: EdFiSessionGradingPeriod[];
  /**
   * A descriptor value to indicate the term that the session is associated with.
   */
  termDescriptor: string;
  /**
   * The total number of instructional days in the school calendar.
   */
  totalInstructionalDays: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_sessionAcademicWeek".
 */
export interface EdFiSessionAcademicWeek {
  academicWeekReference: EdFiAcademicWeekReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_sessionGradingPeriod".
 */
export interface EdFiSessionGradingPeriod {
  gradingPeriodReference: EdFiGradingPeriodReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_sourceDimension".
 */
export interface EdFiSourceDimension {
  id?: string;
  /**
   * The code representation of the account source dimension.
   */
  code: string;
  /**
   * The fiscal year for which the account source dimension is valid.
   */
  fiscalYear: number;
  /**
   * A description of the account source dimension.
   */
  codeName?: string;
  /**
   * An unordered collection of sourceDimensionReportingTags. Optional tag for accountability reporting.
   */
  reportingTags?: EdFiSourceDimensionReportingTag[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_sourceDimensionReportingTag".
 */
export interface EdFiSourceDimensionReportingTag {
  /**
   * Optional tag for accountability reporting.
   */
  reportingTagDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staff".
 */
export interface EdFiStaff {
  id?: string;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId: string;
  personReference?: EdFiPersonReference;
  /**
   * An unordered collection of staffAddresses. The set of elements that describes an address, including the street address, city, state, and ZIP code.
   */
  addresses?: EdFiStaffAddress[];
  /**
   * An unordered collection of staffAncestryEthnicOrigins. The original peoples or cultures with which the individual identifies.
   */
  ancestryEthnicOrigins?: EdFiStaffAncestryEthnicOrigin[];
  /**
   * The month, day, and year on which an individual was born.
   */
  birthDate?: string;
  /**
   * An indicator of whether or not the person is a U.S. citizen.
   */
  citizenshipStatusDescriptor?: string;
  /**
   * An unordered collection of staffCredentials. The legal document giving authorization to perform teaching assignment services.
   */
  credentials?: EdFiStaffCredential[];
  /**
   * An unordered collection of staffElectronicMails. The numbers, letters, and symbols used to identify an electronic mail (e-mail) user within the network to which the individual or organization belongs.
   */
  electronicMails?: EdFiStaffElectronicMail[];
  /**
   * A name given to an individual at birth, baptism, or during another naming ceremony, or through legal change.
   */
  firstName: string;
  /**
   * The gender the staff member identifies themselves as.
   */
  genderIdentity?: string;
  /**
   * An appendage, if any, used to denote an individual's generation in his family (e.g., Jr., Sr., III).
   */
  generationCodeSuffix?: string;
  /**
   * The extent of formal instruction an individual has received (e.g., the highest grade in school completed or its equivalent or the highest degree received).
   */
  highestCompletedLevelOfEducationDescriptor?: string;
  /**
   * An indication of whether a teacher is classified as highly qualified for his/her assignment according to state definition. This attribute indicates the teacher is highly qualified for ALL Sections being taught.
   */
  highlyQualifiedTeacher?: boolean;
  /**
   * An indication that the individual traces his or her origin or descent to Mexico, Puerto Rico, Cuba, Central, and South America, and other Spanish cultures, regardless of race. The term, "Spanish origin," can be used in addition to "Hispanic or Latino."
   */
  hispanicLatinoEthnicity?: boolean;
  /**
   * An unordered collection of staffIdentificationCodes. A unique number or alphanumeric code assigned to a staff member by a school, school system, a state, or other agency or entity.
   */
  identificationCodes?: EdFiStaffIdentificationCode[];
  /**
   * An unordered collection of staffIdentificationDocuments. Describe the documentation of citizenship.
   */
  identificationDocuments?: EdFiStaffIdentificationDocument[];
  /**
   * An unordered collection of staffInternationalAddresses. The set of elements that describes an international address.
   */
  internationalAddresses?: EdFiStaffInternationalAddress[];
  /**
   * An unordered collection of staffLanguages. The language(s) the individual uses to communicate. It is strongly recommended that entries use only ISO 639-2 language codes.
   */
  languages?: EdFiStaffLanguage[];
  /**
   * The name borne in common by members of a family.
   */
  lastSurname: string;
  /**
   * The login ID for the user; used for security access control interface.
   */
  loginId?: string;
  /**
   * The individual's maiden name.
   */
  maidenName?: string;
  /**
   * A secondary name given to an individual at birth, baptism, or during another naming ceremony.
   */
  middleName?: string;
  /**
   * An unordered collection of staffOtherNames. Other names (e.g., alias, nickname, previous legal name) associated with a person.
   */
  otherNames?: EdFiStaffOtherName[];
  /**
   * An unordered collection of staffPersonalIdentificationDocuments. The documents presented as evident to verify one's personal identity; for example: drivers license, passport, birth certificate, etc.
   */
  personalIdentificationDocuments?: EdFiStaffPersonalIdentificationDocument[];
  /**
   * A prefix used to denote the title, degree, position, or seniority of the individual.
   */
  personalTitlePrefix?: string;
  /**
   * The first name the individual prefers, if different from their legal first name
   */
  preferredFirstName?: string;
  /**
   * The last name the individual prefers, if different from their legal last name
   */
  preferredLastSurname?: string;
  /**
   * An unordered collection of staffRaces. The general racial category which most clearly reflects the individual's recognition of his or her community or with which the individual most identifies. The way this data element is listed, it must allow for multiple entries so that each individual can specify all appropriate races.
   */
  races?: EdFiStaffRace[];
  /**
   * An unordered collection of staffRecognitions. Recognitions given to the staff for accomplishments in a co-curricular or extracurricular activity.
   */
  recognitions?: EdFiStaffRecognition[];
  /**
   * The birth sex of the staff member.
   */
  sexDescriptor?: string;
  /**
   * An unordered collection of staffTelephones. The 10-digit telephone number, including the area code, for the person.
   */
  telephones?: EdFiStaffTelephone[];
  /**
   * An unordered collection of staffTribalAffiliations. An American Indian tribe with which the staff member is affiliated.
   */
  tribalAffiliations?: EdFiStaffTribalAffiliation[];
  /**
   * An unordered collection of staffVisas. An indicator of a non-US citizen's Visa type.
   */
  visas?: EdFiStaffVisa[];
  /**
   * The total number of years that an individual has previously held a similar professional position in one or more education institutions prior to the current school year.
   */
  yearsOfPriorProfessionalExperience?: number;
  /**
   * The total number of years that an individual has previously held a teaching position in one or more education institutions prior to the current school year.
   */
  yearsOfPriorTeachingExperience?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffAddress".
 */
export interface EdFiStaffAddress {
  /**
   * The type of address listed for an individual or organization.    For example:  Physical Address, Mailing Address, Home Address, etc.)
   */
  addressTypeDescriptor: string;
  /**
   * The abbreviation for the state (within the United States) or outlying area in which an address is located.
   */
  stateAbbreviationDescriptor: string;
  /**
   * The name of the city in which an address is located.
   */
  city: string;
  /**
   * The five or nine digit zip code or overseas postal code portion of an address.
   */
  postalCode: string;
  /**
   * The street number and street name or post office box number of an address.
   */
  streetNumberName: string;
  /**
   * A general geographic indicator that categorizes U.S. territory (e.g., City, Suburban).
   */
  localeDescriptor?: string;
  /**
   * The apartment, room, or suite number of an address.
   */
  apartmentRoomSuiteNumber?: string;
  /**
   * The number of the building on the site, if more than one building shares the same address.
   */
  buildingSiteNumber?: string;
  /**
   * The congressional district in which an address is located.
   */
  congressionalDistrict?: string;
  /**
   * The Federal Information Processing Standards (FIPS) numeric code for the county issued by the National Institute of Standards and Technology (NIST). Counties are considered to be the "first-order subdivisions" of each State and statistically equivalent entity, regardless of their local designations (county, parish, borough, etc.) Counties in different States will have the same code. A unique county number is created when combined with the 2-digit FIPS State Code.
   */
  countyFIPSCode?: string;
  /**
   * An indication that the address should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * The geographic latitude of the physical address.
   */
  latitude?: string;
  /**
   * The geographic longitude of the physical address.
   */
  longitude?: string;
  /**
   * The name of the county, parish, borough, or comparable unit (within a state) in which an address is located.
   */
  nameOfCounty?: string;
  /**
   * An unordered collection of staffAddressPeriods. The time periods for which the address is valid. For physical addresses, the periods in which the person lived at that address.
   */
  periods?: EdFiStaffAddressPeriod[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffAddressPeriod".
 */
export interface EdFiStaffAddressPeriod {
  /**
   * The month, day, and year for the start of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The month, day, and year for the end of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffAncestryEthnicOrigin".
 */
export interface EdFiStaffAncestryEthnicOrigin {
  /**
   * The original peoples or cultures with which the individual identifies.
   */
  ancestryEthnicOriginDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffCredential".
 */
export interface EdFiStaffCredential {
  credentialReference: EdFiCredentialReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffElectronicMail".
 */
export interface EdFiStaffElectronicMail {
  /**
   * The type of email listed for an individual or organization. For example: Home/Personal, Work, etc.)
   */
  electronicMailTypeDescriptor: string;
  /**
   * The electronic mail (e-mail) address listed for an individual or organization.
   */
  electronicMailAddress: string;
  /**
   * An indication that the electronic email address should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * An indication that the electronic mail address should be used as the principal electronic mail address for an individual or organization.
   */
  primaryEmailAddressIndicator?: boolean;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffIdentificationCode".
 */
export interface EdFiStaffIdentificationCode {
  /**
   * A coding scheme that is used for identification and record-keeping purposes by schools, social services, or other agencies to refer to a staff member.
   */
  staffIdentificationSystemDescriptor: string;
  /**
   * The organization code or name assigning the staff Identification Code.
   */
  assigningOrganizationIdentificationCode?: string;
  /**
   * A unique number or alphanumeric code assigned to a staff member by a school, school system, a state, or other agency or entity.
   */
  identificationCode: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffIdentificationDocument".
 */
export interface EdFiStaffIdentificationDocument {
  /**
   * The primary function of the document used for establishing identity.
   */
  identificationDocumentUseDescriptor: string;
  /**
   * The category of the document relative to its purpose.
   */
  personalInformationVerificationDescriptor: string;
  /**
   * Country of origin of the document. It is strongly recommended that entries use only ISO 3166 2-letter country codes.
   */
  issuerCountryDescriptor?: string;
  /**
   * The day when the document  expires, if null then never expires.
   */
  documentExpirationDate?: string;
  /**
   * The title of the document given by the issuer.
   */
  documentTitle?: string;
  /**
   * The unique identifier on the issuer's identification system.
   */
  issuerDocumentIdentificationCode?: string;
  /**
   * Name of the entity or institution that issued the document.
   */
  issuerName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffInternationalAddress".
 */
export interface EdFiStaffInternationalAddress {
  /**
   * The type of address listed for an individual or organization. For example:  Physical Address, Mailing Address, Home Address, etc.)
   */
  addressTypeDescriptor: string;
  /**
   * The name of the country. It is strongly recommended that entries use only ISO 3166 2-letter country codes.
   */
  countryDescriptor: string;
  /**
   * The first line of the address.
   */
  addressLine1: string;
  /**
   * The second line of the address.
   */
  addressLine2?: string;
  /**
   * The third line of the address.
   */
  addressLine3?: string;
  /**
   * The fourth line of the address.
   */
  addressLine4?: string;
  /**
   * The first date the address is valid. For physical addresses, the date the individual moved to that address.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The last date the address is valid. For physical addresses, the date the individual moved from that address.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * The geographic latitude of the physical address.
   */
  latitude?: string;
  /**
   * The geographic longitude of the physical address.
   */
  longitude?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffLanguage".
 */
export interface EdFiStaffLanguage {
  /**
   * A specification of which written or spoken communication is being used.
   */
  languageDescriptor: string;
  /**
   * An unordered collection of staffLanguageUses. A description of how the language is used (e.g. Home Language, Native Language, Spoken Language).
   */
  uses?: EdFiStaffLanguageUse[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffLanguageUse".
 */
export interface EdFiStaffLanguageUse {
  /**
   * A description of how the language is used (e.g. Home Language, Native Language, Spoken Language).
   */
  languageUseDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffOtherName".
 */
export interface EdFiStaffOtherName {
  /**
   * The types of alternate names for an individual.
   */
  otherNameTypeDescriptor: string;
  /**
   * A name given to an individual at birth, baptism, or during another naming ceremony, or through legal change.
   */
  firstName: string;
  /**
   * An appendage, if any, used to denote an individual's generation in his family (e.g., Jr., Sr., III).
   */
  generationCodeSuffix?: string;
  /**
   * The name borne in common by members of a family.
   */
  lastSurname: string;
  /**
   * A secondary name given to an individual at birth, baptism, or during another naming ceremony.
   */
  middleName?: string;
  /**
   * A prefix used to denote the title, degree, position, or seniority of the individual.
   */
  personalTitlePrefix?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffPersonalIdentificationDocument".
 */
export interface EdFiStaffPersonalIdentificationDocument {
  /**
   * The primary function of the document used for establishing identity.
   */
  identificationDocumentUseDescriptor: string;
  /**
   * The category of the document relative to its purpose.
   */
  personalInformationVerificationDescriptor: string;
  /**
   * Country of origin of the document. It is strongly recommended that entries use only ISO 3166 2-letter country codes.
   */
  issuerCountryDescriptor?: string;
  /**
   * The day when the document  expires, if null then never expires.
   */
  documentExpirationDate?: string;
  /**
   * The title of the document given by the issuer.
   */
  documentTitle?: string;
  /**
   * The unique identifier on the issuer's identification system.
   */
  issuerDocumentIdentificationCode?: string;
  /**
   * Name of the entity or institution that issued the document.
   */
  issuerName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffRace".
 */
export interface EdFiStaffRace {
  /**
   * The general racial category which most clearly reflects the individual's recognition of his or her community or with which the individual most identifies. The way this data element is listed, it must allow for multiple entries so that each individual can specify all appropriate races.
   */
  raceDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffRecognition".
 */
export interface EdFiStaffRecognition {
  /**
   * The nature of recognition given to the individual for accomplishments in a co-curricular, or extra-curricular activity.
   */
  recognitionTypeDescriptor: string;
  /**
   * The category of achievement attributed to the individual.
   */
  achievementCategoryDescriptor?: string;
  /**
   * The system that defines the categories by which an achievement is attributed to the individual.
   */
  achievementCategorySystem?: string;
  /**
   * The title assigned to the achievement.
   */
  achievementTitle?: string;
  /**
   * The criteria for competency-based completion of the achievement/award.
   */
  criteria?: string;
  /**
   * The Uniform Resource Locator (URL) for the unique address of a web page describing the competency-based completion criteria for the achievement/award.
   */
  criteriaURL?: string;
  /**
   * A statement or reference describing the evidence that the individual met the criteria for attainment of the achievement/award.
   */
  evidenceStatement?: string;
  /**
   * The Uniform Resource Locator (URL) for the unique address of an image representing an award or badge associated with the achievement/award.
   */
  imageURL?: string;
  /**
   * The name of the agent, entity, or institution issuing the element.
   */
  issuerName?: string;
  /**
   * The Uniform Resource Locator (URL) from which the award was issued.
   */
  issuerOriginURL?: string;
  /**
   * The date the recognition was awarded or earned.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  recognitionAwardDate?: string;
  /**
   * Date on which the recognition expires.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  recognitionAwardExpiresDate?: string;
  /**
   * A description of the type of recognition earned by or awarded to the individual.
   */
  recognitionDescription?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffTelephone".
 */
export interface EdFiStaffTelephone {
  /**
   * The type of communication number listed for an individual or organization.
   */
  telephoneNumberTypeDescriptor: string;
  /**
   * The telephone number including the area code, and extension, if applicable.
   */
  telephoneNumber: string;
  /**
   * An indication that the telephone number should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * The order of priority assigned to telephone numbers to define which number to attempt first, second, etc.
   */
  orderOfPriority?: number;
  /**
   * An indication that the telephone number is technically capable of sending and receiving Short Message Service (SMS) text messages.
   */
  textMessageCapabilityIndicator?: boolean;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffTribalAffiliation".
 */
export interface EdFiStaffTribalAffiliation {
  /**
   * An American Indian tribe with which the staff member is affiliated.
   */
  tribalAffiliationDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffVisa".
 */
export interface EdFiStaffVisa {
  /**
   * An indicator of a non-US citizen's Visa type.
   */
  visaDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffAbsenceEvent".
 */
export interface EdFiStaffAbsenceEvent {
  id?: string;
  /**
   * The code describing the type of absence.
   */
  absenceEventCategoryDescriptor: string;
  /**
   * Date for this leave event.
   */
  eventDate: string;
  staffReference: EdFiStaffReference;
  /**
   * Expanded reason for the staff absence.
   */
  absenceEventReason?: string;
  /**
   * The hours the staff was absent, if not the entire working day.
   */
  hoursAbsent?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffCohortAssociation".
 */
export interface EdFiStaffCohortAssociation {
  id?: string;
  /**
   * Start date for the association of staff to this cohort.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  cohortReference: EdFiCohortReference;
  staffReference: EdFiStaffReference;
  /**
   * End date for the association of staff to this cohort.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * Indicator of whether the staff has access to the student records of the cohort per district interpretation of FERPA and other privacy laws, regulations, and policies.
   */
  studentRecordAccess?: boolean;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffDisciplineIncidentAssociation".
 */
export interface EdFiStaffDisciplineIncidentAssociation {
  id?: string;
  /**
   * An unordered collection of staffDisciplineIncidentAssociationDisciplineIncidentParticipationCodes. The role or type of participation of a student in a discipline incident.
   */
  disciplineIncidentParticipationCodes: EdFiStaffDisciplineIncidentAssociationDisciplineIncidentParticipationCode[];
  disciplineIncidentReference: EdFiDisciplineIncidentReference;
  staffReference: EdFiStaffReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffDisciplineIncidentAssociationDisciplineIncidentParticipationCode".
 */
export interface EdFiStaffDisciplineIncidentAssociationDisciplineIncidentParticipationCode {
  /**
   * The role or type of participation of a student in a discipline incident.
   */
  disciplineIncidentParticipationCodeDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffEducationOrganizationAssignmentAssociation".
 */
export interface EdFiStaffEducationOrganizationAssignmentAssociation {
  id?: string;
  /**
   * Month, day, and year of the start or effective date of a staff member's employment, contract, or relationship with the education organization.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The titles of employment, official status, or rank of education staff.
   */
  staffClassificationDescriptor: string;
  credentialReference?: EdFiCredentialReference;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  employmentStaffEducationOrganizationEmploymentAssociationReference?: EdFiStaffEducationOrganizationEmploymentAssociationReference;
  staffReference: EdFiStaffReference;
  /**
   * Month, day, and year of the end or termination date of a staff member's employment, contract, or relationship with the education organization.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * The ratio between the hours of work expected in a position and the hours of work normally expected in a full-time position in the same setting.
   */
  fullTimeEquivalency?: number;
  /**
   * Describes whether the assignment is this the staff member's primary assignment, secondary assignment, etc.
   */
  orderOfAssignment?: number;
  /**
   * The descriptive name of an individual's position.
   */
  positionTitle?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffEducationOrganizationEmploymentAssociationReference".
 */
export interface EdFiStaffEducationOrganizationEmploymentAssociationReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * Reflects the type of employment or contract.
   */
  employmentStatusDescriptor: string;
  /**
   * The month, day, and year on which an individual was hired for a position.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  hireDate: string;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffEducationOrganizationContactAssociation".
 */
export interface EdFiStaffEducationOrganizationContactAssociation {
  id?: string;
  /**
   * The title of the contact in the context of the education organization.
   */
  contactTitle: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  staffReference: EdFiStaffReference;
  address?: EdFiStaffEducationOrganizationContactAssociationAddress;
  /**
   * Indicates the type for the contact information.
   */
  contactTypeDescriptor?: string;
  /**
   * The email for the contact associated with the education organization.
   */
  electronicMailAddress: string;
  /**
   * An unordered collection of staffEducationOrganizationContactAssociationTelephones. The optional telephone for the contact associated with the education organization.
   */
  telephones?: EdFiStaffEducationOrganizationContactAssociationTelephone[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffEducationOrganizationContactAssociationAddress".
 */
export interface EdFiStaffEducationOrganizationContactAssociationAddress {
  /**
   * The type of address listed for an individual or organization.    For example:  Physical Address, Mailing Address, Home Address, etc.)
   */
  addressTypeDescriptor: string;
  /**
   * A general geographic indicator that categorizes U.S. territory (e.g., City, Suburban).
   */
  localeDescriptor?: string;
  /**
   * The abbreviation for the state (within the United States) or outlying area in which an address is located.
   */
  stateAbbreviationDescriptor: string;
  /**
   * The apartment, room, or suite number of an address.
   */
  apartmentRoomSuiteNumber?: string;
  /**
   * The number of the building on the site, if more than one building shares the same address.
   */
  buildingSiteNumber?: string;
  /**
   * The name of the city in which an address is located.
   */
  city: string;
  /**
   * The congressional district in which an address is located.
   */
  congressionalDistrict?: string;
  /**
   * The Federal Information Processing Standards (FIPS) numeric code for the county issued by the National Institute of Standards and Technology (NIST). Counties are considered to be the "first-order subdivisions" of each State and statistically equivalent entity, regardless of their local designations (county, parish, borough, etc.) Counties in different States will have the same code. A unique county number is created when combined with the 2-digit FIPS State Code.
   */
  countyFIPSCode?: string;
  /**
   * An indication that the address should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * The geographic latitude of the physical address.
   */
  latitude?: string;
  /**
   * The geographic longitude of the physical address.
   */
  longitude?: string;
  /**
   * The name of the county, parish, borough, or comparable unit (within a state) in which an address is located.
   */
  nameOfCounty?: string;
  /**
   * The five or nine digit zip code or overseas postal code portion of an address.
   */
  postalCode: string;
  /**
   * The street number and street name or post office box number of an address.
   */
  streetNumberName: string;
  /**
   * An unordered collection of staffEducationOrganizationContactAssociationAddressPeriods. The time periods for which the address is valid. For physical addresses, the periods in which the person lived at that address.
   */
  periods?: EdFiStaffEducationOrganizationContactAssociationAddressPeriod[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffEducationOrganizationContactAssociationAddressPeriod".
 */
export interface EdFiStaffEducationOrganizationContactAssociationAddressPeriod {
  /**
   * The month, day, and year for the start of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The month, day, and year for the end of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffEducationOrganizationContactAssociationTelephone".
 */
export interface EdFiStaffEducationOrganizationContactAssociationTelephone {
  /**
   * The type of communication number listed for an individual or organization.
   */
  telephoneNumberTypeDescriptor: string;
  /**
   * The telephone number including the area code, and extension, if applicable.
   */
  telephoneNumber: string;
  /**
   * An indication that the telephone number should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * The order of priority assigned to telephone numbers to define which number to attempt first, second, etc.
   */
  orderOfPriority?: number;
  /**
   * An indication that the telephone number is technically capable of sending and receiving Short Message Service (SMS) text messages.
   */
  textMessageCapabilityIndicator?: boolean;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffEducationOrganizationEmploymentAssociation".
 */
export interface EdFiStaffEducationOrganizationEmploymentAssociation {
  id?: string;
  /**
   * Reflects the type of employment or contract.
   */
  employmentStatusDescriptor: string;
  /**
   * The month, day, and year on which an individual was hired for a position.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  hireDate: string;
  credentialReference?: EdFiCredentialReference;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  staffReference: EdFiStaffReference;
  /**
   * Annual wage associated with the employment position being reported.
   */
  annualWage?: number;
  /**
   * The department or suborganization the employee/contractor is associated with in the education organization.
   */
  department?: string;
  /**
   * The month, day, and year on which a contract between an individual and a governing authority ends or is terminated under the provisions of the contract (or the date on which the agreement is made invalid).  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * The ratio between the hours of work expected in a position and the hours of work normally expected in a full-time position in the same setting.
   */
  fullTimeEquivalency?: number;
  /**
   * Hourly wage associated with the employment position being reported.
   */
  hourlyWage?: number;
  /**
   * Date at which the staff member was made an official offer for this employment.
   */
  offerDate?: string;
  /**
   * Type of employment separation.
   */
  separationDescriptor?: string;
  /**
   * Reason for terminating the employment.
   */
  separationReasonDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffLeave".
 */
export interface EdFiStaffLeave {
  id?: string;
  /**
   * The begin date of the staff leave.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The code describing the type of leave taken.
   */
  staffLeaveEventCategoryDescriptor: string;
  staffReference: EdFiStaffReference;
  /**
   * The end date of the staff leave.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * Expanded reason for the staff leave.
   */
  reason?: string;
  /**
   * Indicator of whether a substitute was assigned during the period of staff leave.
   */
  substituteAssigned?: boolean;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffProgramAssociation".
 */
export interface EdFiStaffProgramAssociation {
  id?: string;
  /**
   * Start date for the association of staff to this program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  programReference: EdFiProgramReference;
  staffReference: EdFiStaffReference;
  /**
   * End date for the association of staff to this program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * Indicator of whether the staff has access to the student records of the program per district interpretation of FERPA and other privacy laws, regulations, and policies.
   */
  studentRecordAccess?: boolean;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffSchoolAssociation".
 */
export interface EdFiStaffSchoolAssociation {
  id?: string;
  /**
   * The name of the program for which the individual is assigned.
   */
  programAssignmentDescriptor: string;
  calendarReference?: EdFiCalendarReference;
  schoolReference: EdFiSchoolReference;
  schoolYearTypeReference?: EdFiSchoolYearTypeReference;
  staffReference: EdFiStaffReference;
  /**
   * An unordered collection of staffSchoolAssociationAcademicSubjects. The academic subjects the individual is eligible to teach.
   */
  academicSubjects?: EdFiStaffSchoolAssociationAcademicSubject[];
  /**
   * An unordered collection of staffSchoolAssociationGradeLevels. The grade levels the individual is eligible to teach.
   */
  gradeLevels?: EdFiStaffSchoolAssociationGradeLevel[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffSchoolAssociationAcademicSubject".
 */
export interface EdFiStaffSchoolAssociationAcademicSubject {
  /**
   * The academic subjects the individual is eligible to teach.
   */
  academicSubjectDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffSchoolAssociationGradeLevel".
 */
export interface EdFiStaffSchoolAssociationGradeLevel {
  /**
   * The grade levels the individual is eligible to teach.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_staffSectionAssociation".
 */
export interface EdFiStaffSectionAssociation {
  id?: string;
  /**
   * Month, day, and year of a teacher's assignment to the section.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  sectionReference: EdFiSectionReference;
  staffReference: EdFiStaffReference;
  /**
   * The type of position the staff member holds in the specific class/section.
   */
  classroomPositionDescriptor: string;
  /**
   * Month, day, and year of the last day of a staff member's assignment to the section.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * An indication of whether a teacher is classified as highly qualified for his/her assignment according to state definition. This attribute indicates the teacher is highly qualified for this section being taught.
   */
  highlyQualifiedTeacher?: boolean;
  /**
   * Indicates the percentage of the total scheduled course time, academic standards, and/or learning activities delivered in this section by this staff member. A teacher of record designation may be based solely or partially on this contribution percentage.
   */
  percentageContribution?: number;
  /**
   * Indicates that the entire section is excluded from calculation of value-added or growth attribution calculations used for a particular teacher evaluation.
   */
  teacherStudentDataLinkExclusion?: boolean;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_stateEducationAgency".
 */
export interface EdFiStateEducationAgency {
  id?: string;
  /**
   * An unordered collection of educationOrganizationCategories. The classification of the education agency within the geographic boundaries of a state according to the level of administrative and operational control granted by the state.
   */
  categories: EdFiEducationOrganizationCategory[];
  /**
   * The identifier assigned to a state education agency. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  stateEducationAgencyId: number;
  /**
   * An unordered collection of stateEducationAgencyAccountabilities. This entity maintains information about federal reporting and accountability for state education agencies.
   */
  accountabilities?: EdFiStateEducationAgencyAccountability[];
  /**
   * An unordered collection of educationOrganizationAddresses. The set of elements that describes an address for the education entity, including the street address, city, state, ZIP code, and ZIP code + 4.
   */
  addresses?: EdFiEducationOrganizationAddress[];
  /**
   * An unordered collection of stateEducationAgencyFederalFunds. Contains the information about the reception and use of federal funds for reporting purposes.
   */
  federalFunds?: EdFiStateEducationAgencyFederalFunds[];
  /**
   * An unordered collection of educationOrganizationIdentificationCodes. A unique number or alphanumeric code assigned to an education organization by a school, school system, a state, or other agency or entity.
   */
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  /**
   * An unordered collection of educationOrganizationIndicators. An indicator or metric of an education organization.
   */
  indicators?: EdFiEducationOrganizationIndicator[];
  /**
   * An unordered collection of educationOrganizationInstitutionTelephones. The 10-digit telephone number, including the area code, for the education entity.
   */
  institutionTelephones?: EdFiEducationOrganizationInstitutionTelephone[];
  /**
   * An unordered collection of educationOrganizationInternationalAddresses. The set of elements that describes the international physical location of the education entity.
   */
  internationalAddresses?: EdFiEducationOrganizationInternationalAddress[];
  /**
   * The full, legally accepted name of the institution.
   */
  nameOfInstitution: string;
  /**
   * The current operational status of the education organization (e.g., active, inactive).
   */
  operationalStatusDescriptor?: string;
  /**
   * A short name for the institution.
   */
  shortNameOfInstitution?: string;
  /**
   * The public web site address (URL) for the education organization.
   */
  webSite?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_stateEducationAgencyAccountability".
 */
export interface EdFiStateEducationAgencyAccountability {
  /**
   * An indication of whether CTE concentrators are included in the state's computation of its graduation rate.
   */
  cteGraduationRateInclusion?: boolean;
  schoolYearTypeReference: EdFiSchoolYearTypeReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_stateEducationAgencyFederalFunds".
 */
export interface EdFiStateEducationAgencyFederalFunds {
  /**
   * The fiscal year for which the federal funds are received.
   */
  fiscalYear: number;
  /**
   * The amount of federal dollars distributed to Local Education Agencies (LEAs), retained by the State Education Agency (SEA) for program administration or other approved state-level activities (including unallocated, transferred to another state agency, or distributed to entities other than LEAs).
   */
  federalProgramsFundingAllocation?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_student".
 */
export interface EdFiStudent {
  id?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  personReference?: EdFiPersonReference;
  /**
   * The city the student was born in.
   */
  birthCity?: string;
  /**
   * The country in which an individual is born. It is strongly recommended that entries use only ISO 3166 2-letter country codes.
   */
  birthCountryDescriptor?: string;
  /**
   * The month, day, and year on which an individual was born.
   */
  birthDate: string;
  /**
   * For students born outside of the U.S., the Province or jurisdiction in which an individual is born.
   */
  birthInternationalProvince?: string;
  /**
   * A person's sex at birth.
   */
  birthSexDescriptor?: string;
  /**
   * The abbreviation for the name of the state (within the United States) or extra-state jurisdiction in which an individual was born.
   */
  birthStateAbbreviationDescriptor?: string;
  /**
   * An indicator of whether or not the person is a U.S. citizen.
   */
  citizenshipStatusDescriptor?: string;
  /**
   * For students born outside of the U.S., the date the student entered the U.S.
   */
  dateEnteredUS?: string;
  /**
   * A name given to an individual at birth, baptism, or during another naming ceremony, or through legal change.
   */
  firstName: string;
  /**
   * An appendage, if any, used to denote an individual's generation in his family (e.g., Jr., Sr., III).
   */
  generationCodeSuffix?: string;
  /**
   * An unordered collection of studentIdentificationDocuments. Describe the documentation of citizenship.
   */
  identificationDocuments?: EdFiStudentIdentificationDocument[];
  /**
   * The name borne in common by members of a family.
   */
  lastSurname: string;
  /**
   * The individual's maiden name.
   */
  maidenName?: string;
  /**
   * A secondary name given to an individual at birth, baptism, or during another naming ceremony.
   */
  middleName?: string;
  /**
   * Indicator of whether the student was born with other siblings (i.e., twins, triplets, etc.)
   */
  multipleBirthStatus?: boolean;
  /**
   * An unordered collection of studentOtherNames. Other names (e.g., alias, nickname, previous legal name) associated with a person.
   */
  otherNames?: EdFiStudentOtherName[];
  /**
   * An unordered collection of studentPersonalIdentificationDocuments. The documents presented as evident to verify one's personal identity; for example: drivers license, passport, birth certificate, etc.
   */
  personalIdentificationDocuments?: EdFiStudentPersonalIdentificationDocument[];
  /**
   * A prefix used to denote the title, degree, position, or seniority of the individual.
   */
  personalTitlePrefix?: string;
  /**
   * The first name the individual prefers, if different from their legal first name
   */
  preferredFirstName?: string;
  /**
   * The last name the individual prefers, if different from their legal last name
   */
  preferredLastSurname?: string;
  /**
   * An unordered collection of studentVisas. An indicator of a non-US citizen's Visa type.
   */
  visas?: EdFiStudentVisa[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentIdentificationDocument".
 */
export interface EdFiStudentIdentificationDocument {
  /**
   * The primary function of the document used for establishing identity.
   */
  identificationDocumentUseDescriptor: string;
  /**
   * The category of the document relative to its purpose.
   */
  personalInformationVerificationDescriptor: string;
  /**
   * Country of origin of the document. It is strongly recommended that entries use only ISO 3166 2-letter country codes.
   */
  issuerCountryDescriptor?: string;
  /**
   * The day when the document  expires, if null then never expires.
   */
  documentExpirationDate?: string;
  /**
   * The title of the document given by the issuer.
   */
  documentTitle?: string;
  /**
   * The unique identifier on the issuer's identification system.
   */
  issuerDocumentIdentificationCode?: string;
  /**
   * Name of the entity or institution that issued the document.
   */
  issuerName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentOtherName".
 */
export interface EdFiStudentOtherName {
  /**
   * The types of alternate names for an individual.
   */
  otherNameTypeDescriptor: string;
  /**
   * A name given to an individual at birth, baptism, or during another naming ceremony, or through legal change.
   */
  firstName: string;
  /**
   * An appendage, if any, used to denote an individual's generation in his family (e.g., Jr., Sr., III).
   */
  generationCodeSuffix?: string;
  /**
   * The name borne in common by members of a family.
   */
  lastSurname: string;
  /**
   * A secondary name given to an individual at birth, baptism, or during another naming ceremony.
   */
  middleName?: string;
  /**
   * A prefix used to denote the title, degree, position, or seniority of the individual.
   */
  personalTitlePrefix?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentPersonalIdentificationDocument".
 */
export interface EdFiStudentPersonalIdentificationDocument {
  /**
   * The primary function of the document used for establishing identity.
   */
  identificationDocumentUseDescriptor: string;
  /**
   * The category of the document relative to its purpose.
   */
  personalInformationVerificationDescriptor: string;
  /**
   * Country of origin of the document. It is strongly recommended that entries use only ISO 3166 2-letter country codes.
   */
  issuerCountryDescriptor?: string;
  /**
   * The day when the document  expires, if null then never expires.
   */
  documentExpirationDate?: string;
  /**
   * The title of the document given by the issuer.
   */
  documentTitle?: string;
  /**
   * The unique identifier on the issuer's identification system.
   */
  issuerDocumentIdentificationCode?: string;
  /**
   * Name of the entity or institution that issued the document.
   */
  issuerName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentVisa".
 */
export interface EdFiStudentVisa {
  /**
   * An indicator of a non-US citizen's Visa type.
   */
  visaDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAcademicRecord".
 */
export interface EdFiStudentAcademicRecord {
  id?: string;
  /**
   * The term for the session during the school year.
   */
  termDescriptor: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  schoolYearTypeReference: EdFiSchoolYearTypeReference;
  studentReference: EdFiStudentReference;
  /**
   * An unordered collection of studentAcademicRecordAcademicHonors. Academic distinctions earned by or awarded to the student.
   */
  academicHonors?: EdFiStudentAcademicRecordAcademicHonor[];
  classRanking?: EdFiStudentAcademicRecordClassRanking;
  /**
   * Conversion factor that when multiplied by the number of credits is equivalent to Carnegie units.
   */
  cumulativeAttemptedCreditConversion?: number;
  /**
   * The value of credits or units of value awarded for the completion of a course.
   */
  cumulativeAttemptedCredits?: number;
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  cumulativeAttemptedCreditTypeDescriptor?: string;
  /**
   * Conversion factor that when multiplied by the number of credits is equivalent to Carnegie units.
   */
  cumulativeEarnedCreditConversion?: number;
  /**
   * The value of credits or units of value awarded for the completion of a course.
   */
  cumulativeEarnedCredits?: number;
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  cumulativeEarnedCreditTypeDescriptor?: string;
  /**
   * An unordered collection of studentAcademicRecordDiplomas. Diploma(s) earned by the student.
   */
  diplomas?: EdFiStudentAcademicRecordDiploma[];
  /**
   * An unordered collection of studentAcademicRecordGradePointAverages. The grade point average for an individual computed as the grade points earned divided by the number of credits attempted.
   */
  gradePointAverages?: EdFiStudentAcademicRecordGradePointAverage[];
  /**
   * The month and year the student is projected to graduate.
   */
  projectedGraduationDate?: string;
  /**
   * An unordered collection of studentAcademicRecordRecognitions. Recognitions given to the student for accomplishments in a co-curricular or extracurricular activity.
   */
  recognitions?: EdFiStudentAcademicRecordRecognition[];
  /**
   * An unordered collection of studentAcademicRecordReportCards. Report cards for the student.
   */
  reportCards?: EdFiStudentAcademicRecordReportCard[];
  /**
   * Conversion factor that when multiplied by the number of credits is equivalent to Carnegie units.
   */
  sessionAttemptedCreditConversion?: number;
  /**
   * The value of credits or units of value awarded for the completion of a course.
   */
  sessionAttemptedCredits?: number;
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  sessionAttemptedCreditTypeDescriptor?: string;
  /**
   * Conversion factor that when multiplied by the number of credits is equivalent to Carnegie units.
   */
  sessionEarnedCreditConversion?: number;
  /**
   * The value of credits or units of value awarded for the completion of a course.
   */
  sessionEarnedCredits?: number;
  /**
   * The type of credits or units of value awarded for the completion of a course.
   */
  sessionEarnedCreditTypeDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAcademicRecordAcademicHonor".
 */
export interface EdFiStudentAcademicRecordAcademicHonor {
  /**
   * A designation of the type of academic distinctions earned by or awarded to the individual.
   */
  academicHonorCategoryDescriptor: string;
  /**
   * A description of the type of academic distinctions earned by or awarded to the individual.
   */
  honorDescription: string;
  /**
   * The category of achievement attributed to the individual.
   */
  achievementCategoryDescriptor?: string;
  /**
   * The system that defines the categories by which an achievement is attributed to the individual.
   */
  achievementCategorySystem?: string;
  /**
   * The title assigned to the achievement.
   */
  achievementTitle?: string;
  /**
   * The criteria for competency-based completion of the achievement/award.
   */
  criteria?: string;
  /**
   * The Uniform Resource Locator (URL) for the unique address of a web page describing the competency-based completion criteria for the achievement/award.
   */
  criteriaURL?: string;
  /**
   * A statement or reference describing the evidence that the individual met the criteria for attainment of the achievement/award.
   */
  evidenceStatement?: string;
  /**
   * The date the honor was awarded.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  honorAwardDate?: string;
  /**
   * Date on which the honor expires.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  honorAwardExpiresDate?: string;
  /**
   * The Uniform Resource Locator (URL) for the unique address of an image representing an award or badge associated with the achievement/award.
   */
  imageURL?: string;
  /**
   * The name of the agent, entity, or institution issuing the element.
   */
  issuerName?: string;
  /**
   * The Uniform Resource Locator (URL) from which the award was issued.
   */
  issuerOriginURL?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAcademicRecordClassRanking".
 */
export interface EdFiStudentAcademicRecordClassRanking {
  /**
   * The academic rank of a student in relation to his or her graduating class (e.g., 1st, 2nd, 3rd).
   */
  classRank: number;
  /**
   * Date class ranking was determined.
   */
  classRankingDate?: string;
  /**
   * The academic percentage rank of a student in relation to his or her graduating class (e.g., 95%, 80%, 50%).
   */
  percentageRanking?: number;
  /**
   * The total number of students in the student's graduating class.
   */
  totalNumberInClass: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAcademicRecordDiploma".
 */
export interface EdFiStudentAcademicRecordDiploma {
  /**
   * The type of diploma/credential that is awarded to a student in recognition of his/her completion of the curricular requirements.
   */
  diplomaTypeDescriptor: string;
  /**
   * The month, day, and year on which the student met  graduation requirements and was awarded a diploma.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  diplomaAwardDate: string;
  /**
   * The category of achievement attributed to the individual.
   */
  achievementCategoryDescriptor?: string;
  /**
   * The level of diploma/credential that is awarded to a student in recognition of completion of the curricular requirements.
   */
  diplomaLevelDescriptor?: string;
  /**
   * The system that defines the categories by which an achievement is attributed to the individual.
   */
  achievementCategorySystem?: string;
  /**
   * The title assigned to the achievement.
   */
  achievementTitle?: string;
  /**
   * The criteria for competency-based completion of the achievement/award.
   */
  criteria?: string;
  /**
   * The Uniform Resource Locator (URL) for the unique address of a web page describing the competency-based completion criteria for the achievement/award.
   */
  criteriaURL?: string;
  /**
   * Indicated a student who reached a state-defined threshold of vocational education and who attained a high school diploma or its recognized state equivalent or GED.
   */
  cteCompleter?: boolean;
  /**
   * Date on which the diploma expires.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  diplomaAwardExpiresDate?: string;
  /**
   * The description of the diploma given to the student for accomplishments.
   */
  diplomaDescription?: string;
  /**
   * A statement or reference describing the evidence that the individual met the criteria for attainment of the achievement/award.
   */
  evidenceStatement?: string;
  /**
   * The Uniform Resource Locator (URL) for the unique address of an image representing an award or badge associated with the achievement/award.
   */
  imageURL?: string;
  /**
   * The name of the agent, entity, or institution issuing the element.
   */
  issuerName?: string;
  /**
   * The Uniform Resource Locator (URL) from which the award was issued.
   */
  issuerOriginURL?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAcademicRecordGradePointAverage".
 */
export interface EdFiStudentAcademicRecordGradePointAverage {
  /**
   * The system used for calculating the grade point average for an individual.
   */
  gradePointAverageTypeDescriptor: string;
  /**
   * The value of the grade points earned divided by the number of credits attempted.
   */
  gradePointAverageValue: number;
  /**
   * Indicator of whether or not the Grade Point Average value is cumulative.
   */
  isCumulative?: boolean;
  /**
   * The maximum value for the grade point average.
   */
  maxGradePointAverageValue?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAcademicRecordRecognition".
 */
export interface EdFiStudentAcademicRecordRecognition {
  /**
   * The nature of recognition given to the individual for accomplishments in a co-curricular, or extra-curricular activity.
   */
  recognitionTypeDescriptor: string;
  /**
   * The category of achievement attributed to the individual.
   */
  achievementCategoryDescriptor?: string;
  /**
   * The system that defines the categories by which an achievement is attributed to the individual.
   */
  achievementCategorySystem?: string;
  /**
   * The title assigned to the achievement.
   */
  achievementTitle?: string;
  /**
   * The criteria for competency-based completion of the achievement/award.
   */
  criteria?: string;
  /**
   * The Uniform Resource Locator (URL) for the unique address of a web page describing the competency-based completion criteria for the achievement/award.
   */
  criteriaURL?: string;
  /**
   * A statement or reference describing the evidence that the individual met the criteria for attainment of the achievement/award.
   */
  evidenceStatement?: string;
  /**
   * The Uniform Resource Locator (URL) for the unique address of an image representing an award or badge associated with the achievement/award.
   */
  imageURL?: string;
  /**
   * The name of the agent, entity, or institution issuing the element.
   */
  issuerName?: string;
  /**
   * The Uniform Resource Locator (URL) from which the award was issued.
   */
  issuerOriginURL?: string;
  /**
   * The date the recognition was awarded or earned.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  recognitionAwardDate?: string;
  /**
   * Date on which the recognition expires.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  recognitionAwardExpiresDate?: string;
  /**
   * A description of the type of recognition earned by or awarded to the individual.
   */
  recognitionDescription?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAcademicRecordReportCard".
 */
export interface EdFiStudentAcademicRecordReportCard {
  reportCardReference: EdFiReportCardReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessment".
 */
export interface EdFiStudentAssessment {
  id?: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment administered to a student.
   */
  studentAssessmentIdentifier: string;
  assessmentReference: EdFiAssessmentReference;
  reportedSchoolReference?: EdFiSchoolReference;
  schoolYearTypeReference?: EdFiSchoolYearTypeReference;
  studentReference: EdFiStudentReference;
  /**
   * An unordered collection of studentAssessmentAccommodations. The specific type of special variation used in how an examination is presented, how it is administered, or how the test taker is allowed to respond. This generally refers to changes that do not substantially alter what the examination measures. The proper use of accommodations does not substantially change academic level or performance criteria.
   */
  accommodations?: EdFiStudentAssessmentAccommodation[];
  /**
   * The date and time an assessment was completed by the student. The use of ISO-8601 formats with a timezone designator (UTC or time offset) is recommended in order to prevent ambiguity due to time zones.
   */
  administrationDate?: string;
  /**
   * The date and time an assessment administration ended.
   */
  administrationEndDate?: string;
  /**
   * The environment in which the test was administered.
   */
  administrationEnvironmentDescriptor?: string;
  /**
   * The language in which an assessment is written and/or administered.
   */
  administrationLanguageDescriptor?: string;
  /**
   * Reported time student was assessed in minutes.
   */
  assessedMinutes?: number;
  /**
   * An unusual event occurred during the administration of the assessment. This could include fire alarm, student became ill, etc.
   */
  eventCircumstanceDescriptor?: string;
  /**
   * Describes special events that occur before during or after the assessment session that may impact use of results.
   */
  eventDescription?: string;
  /**
   * An unordered collection of studentAssessmentItems. The student's response to an assessment item and the item-level scores such as correct, incorrect, or met standard.
   */
  items?: EdFiStudentAssessmentItem[];
  /**
   * An unordered collection of studentAssessmentPerformanceLevels. The performance level(s) achieved for the student assessment.
   */
  performanceLevels?: EdFiStudentAssessmentPerformanceLevel[];
  period?: EdFiStudentAssessmentPeriod;
  /**
   * The platform with which the assessment was delivered to the student during the assessment session.
   */
  platformTypeDescriptor?: string;
  /**
   * The primary reason student is not tested.
   */
  reasonNotTestedDescriptor?: string;
  /**
   * A reported school identifier for the school the enrollment at the time of the assessment used when the assigned SchoolId is not known by the assessment vendor.
   */
  reportedSchoolIdentifier?: string;
  /**
   * Indicator if the test was a retake.
   */
  retestIndicatorDescriptor?: string;
  /**
   * An unordered collection of studentAssessmentScoreResults. A meaningful score or statistical expression of the performance of an individual. The results can be expressed as a number, percentile, range, level, etc.
   */
  scoreResults?: EdFiStudentAssessmentScoreResult[];
  /**
   * The unique number for the assessment form or answer document.
   */
  serialNumber?: string;
  /**
   * An unordered collection of studentAssessmentStudentObjectiveAssessments. The student's score and/or performance levels earned for an objective assessment.
   */
  studentObjectiveAssessments?: EdFiStudentAssessmentStudentObjectiveAssessment[];
  /**
   * The grade level of a student when assessed.
   */
  whenAssessedGradeLevelDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentAccommodation".
 */
export interface EdFiStudentAssessmentAccommodation {
  /**
   * The specific type of special variation used in how an examination is presented, how it is administered, or how the test taker is allowed to respond. This generally refers to changes that do not substantially alter what the examination measures. The proper use of accommodations does not substantially change academic level or performance criteria.
   */
  accommodationDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentItem".
 */
export interface EdFiStudentAssessmentItem {
  /**
   * The analyzed result of a student's response to an assessment item.
   */
  assessmentItemResultDescriptor: string;
  /**
   * Indicator of the response.
   */
  responseIndicatorDescriptor?: string;
  /**
   * A student's response to a stimulus on a test.
   */
  assessmentResponse?: string;
  /**
   * The formative descriptive feedback that was given to a student in response to the results from a scored/evaluated assessment item.
   */
  descriptiveFeedback?: string;
  /**
   * The test question number for this student's test item.
   */
  itemNumber?: number;
  /**
   * A meaningful raw score of the performance of a student on an assessment item.
   */
  rawScoreResult?: number;
  /**
   * The overall time that a student actually spent on the assessment item expressed in minutes.
   */
  timeAssessed?: string;
  assessmentItemReference: EdFiAssessmentItemReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentPerformanceLevel".
 */
export interface EdFiStudentAssessmentPerformanceLevel {
  /**
   * The method that the instructor of the class uses to report the performance and achievement. It may be a qualitative method such as individualized teacher comments or a quantitative method such as a letter or numerical grade. In some cases, more than one type of reporting method may be used.
   */
  assessmentReportingMethodDescriptor: string;
  /**
   * A specification of which performance level value describes the student proficiency.
   */
  performanceLevelDescriptor: string;
  /**
   * The name of the indicator being measured for a collection of performance level values.
   */
  performanceLevelIndicatorName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentPeriod".
 */
export interface EdFiStudentAssessmentPeriod {
  /**
   * The period of time in which an assessment is supposed to be administered (e.g., Beginning of Year, Middle of Year, End of Year).
   */
  assessmentPeriodDescriptor: string;
  /**
   * The first date the assessment is to be administered.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The last date the assessment is to be administered.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentScoreResult".
 */
export interface EdFiStudentAssessmentScoreResult {
  /**
   * The method that the administrator of the assessment uses to report the performance and achievement of all students. It may be a qualitative method such as performance level descriptors or a quantitative method such as a numerical grade or cut score. More than one type of reporting method may be used.
   */
  assessmentReportingMethodDescriptor: string;
  /**
   * The datatype of the result. The results can be expressed as a number, percentile, range, level, etc.
   */
  resultDatatypeTypeDescriptor: string;
  /**
   * The value of a meaningful raw score or statistical expression of the performance of an individual. The results can be expressed as a number, percentile, range, level, etc.
   */
  result: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentStudentObjectiveAssessment".
 */
export interface EdFiStudentAssessmentStudentObjectiveAssessment {
  /**
   * The date and time an assessment was completed by the student. The use of ISO-8601 formats with a timezone designator (UTC or time offset) is recommended in order to prevent ambiguity due to time zones.
   */
  administrationDate?: string;
  /**
   * The date and time an assessment administration ended.
   */
  administrationEndDate?: string;
  /**
   * Reported time student was assessed in minutes.
   */
  assessedMinutes?: number;
  objectiveAssessmentReference: EdFiObjectiveAssessmentReference;
  /**
   * An unordered collection of studentAssessmentStudentObjectiveAssessmentPerformanceLevels. The performance level(s) achieved for the objective assessment.
   */
  performanceLevels?: EdFiStudentAssessmentStudentObjectiveAssessmentPerformanceLevel[];
  /**
   * An unordered collection of studentAssessmentStudentObjectiveAssessmentScoreResults. A meaningful score or statistical expression of the performance of an individual. The results can be expressed as a number, percentile, range, level, etc.
   */
  scoreResults?: EdFiStudentAssessmentStudentObjectiveAssessmentScoreResult[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentStudentObjectiveAssessmentPerformanceLevel".
 */
export interface EdFiStudentAssessmentStudentObjectiveAssessmentPerformanceLevel {
  /**
   * The method that the instructor of the class uses to report the performance and achievement. It may be a qualitative method such as individualized teacher comments or a quantitative method such as a letter or numerical grade. In some cases, more than one type of reporting method may be used.
   */
  assessmentReportingMethodDescriptor: string;
  /**
   * A specification of which performance level value describes the student proficiency.
   */
  performanceLevelDescriptor: string;
  /**
   * The name of the indicator being measured for a collection of performance level values.
   */
  performanceLevelIndicatorName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentStudentObjectiveAssessmentScoreResult".
 */
export interface EdFiStudentAssessmentStudentObjectiveAssessmentScoreResult {
  /**
   * The method that the administrator of the assessment uses to report the performance and achievement of all students. It may be a qualitative method such as performance level descriptors or a quantitative method such as a numerical grade or cut score. More than one type of reporting method may be used.
   */
  assessmentReportingMethodDescriptor: string;
  /**
   * The datatype of the result. The results can be expressed as a number, percentile, range, level, etc.
   */
  resultDatatypeTypeDescriptor: string;
  /**
   * The value of a meaningful raw score or statistical expression of the performance of an individual. The results can be expressed as a number, percentile, range, level, etc.
   */
  result: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentEducationOrganizationAssociation".
 */
export interface EdFiStudentAssessmentEducationOrganizationAssociation {
  id?: string;
  /**
   * The type of association being represented.
   */
  educationOrganizationAssociationTypeDescriptor: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  schoolYearTypeReference?: EdFiSchoolYearTypeReference;
  studentAssessmentReference: EdFiStudentAssessmentReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentReference".
 */
export interface EdFiStudentAssessmentReference {
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier: string;
  /**
   * Namespace for the assessment.
   */
  namespace: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment administered to a student.
   */
  studentAssessmentIdentifier: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentRegistration".
 */
export interface EdFiStudentAssessmentRegistration {
  id?: string;
  assessmentAdministrationReference: EdFiAssessmentAdministrationReference;
  reportingEducationOrganizationReference?: EdFiEducationOrganizationReference;
  scheduledStudentEducationOrganizationAssessmentAccommodationReference?: EdFiStudentEducationOrganizationAssessmentAccommodationReference;
  studentEducationOrganizationAssociationReference: EdFiStudentEducationOrganizationAssociationReference;
  studentSchoolAssociationReference: EdFiStudentSchoolAssociationReference;
  testingEducationOrganizationReference?: EdFiEducationOrganizationReference;
  /**
   * An unordered collection of studentAssessmentRegistrationAssessmentAccommodations. The special variation(s) to be used in how assessments (in general) are presented, how it is administered, or how the test taker is allowed to respond. This generally refers to changes that do not substantially alter what the examination measures. The proper use of accommodations does not substantially change academic level or performance criteria.
   */
  assessmentAccommodations?: EdFiStudentAssessmentRegistrationAssessmentAccommodation[];
  /**
   * An unordered collection of studentAssessmentRegistrationAssessmentCustomizations. Key/value pairs which may be used to facilitate customization of an assessment or to support vendor reporting/analysis.
   */
  assessmentCustomizations?: EdFiStudentAssessmentRegistrationAssessmentCustomization[];
  /**
   * The grade level or primary instructional level at which the student is to be assessed.
   */
  assessmentGradeLevelDescriptor?: string;
  /**
   * The environment or format in which the assessment is expected to be administered.
   */
  platformTypeDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssessmentAccommodationReference".
 */
export interface EdFiStudentEducationOrganizationAssessmentAccommodationReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationReference".
 */
export interface EdFiStudentEducationOrganizationAssociationReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSchoolAssociationReference".
 */
export interface EdFiStudentSchoolAssociationReference {
  /**
   * The month, day, and year on which an individual enters and begins to receive instructional services in a school for each school year. The EntryDate value should be the date the student enrolled, or when the student's enrollment materially changed, such as with a grade promotion.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  entryDate: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentRegistrationAssessmentAccommodation".
 */
export interface EdFiStudentAssessmentRegistrationAssessmentAccommodation {
  /**
   * The special variation(s) to be used in how assessments (in general) are presented, how it is administered, or how the test taker is allowed to respond. This generally refers to changes that do not substantially alter what the examination measures. The proper use of accommodations does not substantially change academic level or performance criteria.
   */
  accommodationDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentRegistrationAssessmentCustomization".
 */
export interface EdFiStudentAssessmentRegistrationAssessmentCustomization {
  /**
   * An agreed upon identifier for the custom information.
   */
  customizationKey: string;
  /**
   * Custom value for the indicated CustomizationKey.
   */
  customizationValue: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentRegistrationBatteryPartAssociation".
 */
export interface EdFiStudentAssessmentRegistrationBatteryPartAssociation {
  id?: string;
  assessmentBatteryPartReference: EdFiAssessmentBatteryPartReference;
  studentAssessmentRegistrationReference: EdFiStudentAssessmentRegistrationReference;
  /**
   * An unordered collection of studentAssessmentRegistrationBatteryPartAssociationAccommodations. The special variation(s) to be used for the specific part of the assessment battery on how is presented, how it is administered, or how the test taker is allowed to respond.
   */
  accommodations?: EdFiStudentAssessmentRegistrationBatteryPartAssociationAccommodation[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentRegistrationReference".
 */
export interface EdFiStudentAssessmentRegistrationReference {
  /**
   * The title or name of the assessment in the context of its administration.
   */
  administrationIdentifier: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier: string;
  /**
   * The identifier assigned to an education organization.
   */
  assigningEducationOrganizationId: number;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * Namespace for the assessment.
   */
  namespace: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentAssessmentRegistrationBatteryPartAssociationAccommodation".
 */
export interface EdFiStudentAssessmentRegistrationBatteryPartAssociationAccommodation {
  /**
   * The special variation(s) to be used for the specific part of the assessment battery on how is presented, how it is administered, or how the test taker is allowed to respond.
   */
  accommodationDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentCohortAssociation".
 */
export interface EdFiStudentCohortAssociation {
  id?: string;
  /**
   * The month, day, and year on which the student was first identified as part of the cohort.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  cohortReference: EdFiCohortReference;
  studentReference: EdFiStudentReference;
  /**
   * The month, day, and year on which the student was removed as part of the cohort.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * An unordered collection of studentCohortAssociationSections. The cohort representing the subdivision of students within one or more sections. For example, a group of students may be given additional instruction and tracked as a cohort.
   */
  sections?: EdFiStudentCohortAssociationSection[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentCohortAssociationSection".
 */
export interface EdFiStudentCohortAssociationSection {
  sectionReference: EdFiSectionReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentCompetencyObjective".
 */
export interface EdFiStudentCompetencyObjective {
  id?: string;
  gradingPeriodReference: EdFiGradingPeriodReference;
  objectiveCompetencyObjectiveReference: EdFiCompetencyObjectiveReference;
  studentReference: EdFiStudentReference;
  /**
   * The competency level assessed for the student for the referenced competency objective.
   */
  competencyLevelDescriptor: string;
  /**
   * A statement provided by the teacher that provides information in addition to the grade or assessment score.
   */
  diagnosticStatement?: string;
  /**
   * An unordered collection of studentCompetencyObjectiveGeneralStudentProgramAssociations. Relates the student and program associated with the competency objective.
   */
  generalStudentProgramAssociations?: EdFiStudentCompetencyObjectiveGeneralStudentProgramAssociation[];
  /**
   * An unordered collection of studentCompetencyObjectiveStudentSectionAssociations. Relates the student and section associated with the competency objective.
   */
  studentSectionAssociations?: EdFiStudentCompetencyObjectiveStudentSectionAssociation[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentCompetencyObjectiveGeneralStudentProgramAssociation".
 */
export interface EdFiStudentCompetencyObjectiveGeneralStudentProgramAssociation {
  generalStudentProgramAssociationReference: EdFiGeneralStudentProgramAssociationReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentCompetencyObjectiveStudentSectionAssociation".
 */
export interface EdFiStudentCompetencyObjectiveStudentSectionAssociation {
  studentSectionAssociationReference: EdFiStudentSectionAssociationReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentContactAssociation".
 */
export interface EdFiStudentContactAssociation {
  id?: string;
  contactReference: EdFiContactReference;
  studentReference: EdFiStudentReference;
  /**
   * The numeric order of the preferred sequence or priority of contact.
   */
  contactPriority?: number;
  /**
   * Restrictions for student and/or teacher contact with the individual (e.g., the student may not be picked up by the individual).
   */
  contactRestrictions?: string;
  /**
   * Indicator of whether the person is a designated emergency contact for the student.
   */
  emergencyContactStatus?: boolean;
  /**
   * Indicator of whether the person is a legal guardian for the student.
   */
  legalGuardian?: boolean;
  /**
   * Indicator of whether the student lives with the associated contact.
   */
  livesWith?: boolean;
  /**
   * Indicator of whether the person is a primary contact for the student.
   */
  primaryContactStatus?: boolean;
  /**
   * The nature of an individual's relationship to a student, primarily used to capture family relationships.
   */
  relationDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentCTEProgramAssociation".
 */
export interface EdFiStudentCTEProgramAssociation {
  id?: string;
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  programReference: EdFiProgramReference;
  studentReference: EdFiStudentReference;
  /**
   * An unordered collection of studentCTEProgramAssociationCTEProgramServices. Indicates the service(s) being provided to the student by the CTE program.
   */
  cteProgramServices?: EdFiStudentCTEProgramAssociationCTEProgramService[];
  /**
   * The month, day, and year on which the student exited the program or stopped receiving services.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * Indicator that student is from a gender group that comprises less than 25% of the individuals employed in an occupation or field of work.
   */
  nonTraditionalGenderStatus?: boolean;
  /**
   * Indicator that student participated in career and technical education at private agencies or institutions that are reported by the state for purposes of the Elementary and Secondary Education Act (ESEA). Students in private institutions which do not receive Perkins funding are reported only in the state file.
   */
  privateCTEProgram?: boolean;
  /**
   * An unordered collection of generalStudentProgramAssociationProgramParticipationStatuses. The status of the student's program participation.
   */
  programParticipationStatuses?: EdFiGeneralStudentProgramAssociationProgramParticipationStatus[];
  /**
   * The reason the student left the program within a school or district.
   */
  reasonExitedDescriptor?: string;
  /**
   * Indicates whether the student received services during the summer session or between sessions.
   */
  servedOutsideOfRegularSession?: boolean;
  /**
   * Results of technical skills assessment aligned with industry recognized standards.
   */
  technicalSkillsAssessmentDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentCTEProgramAssociationCTEProgramService".
 */
export interface EdFiStudentCTEProgramAssociationCTEProgramService {
  /**
   * Indicates the service being provided to the student by the CTE program.
   */
  cteProgramServiceDescriptor: string;
  /**
   * Number and description of the CIP code associated with the student's CTE program.
   */
  cipCode?: string;
  /**
   * True if service is a primary service.
   */
  primaryIndicator?: boolean;
  /**
   * First date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceBeginDate?: string;
  /**
   * Last date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceEndDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentDisciplineIncidentBehaviorAssociation".
 */
export interface EdFiStudentDisciplineIncidentBehaviorAssociation {
  id?: string;
  /**
   * Describes behavior by category.
   */
  behaviorDescriptor: string;
  disciplineIncidentReference: EdFiDisciplineIncidentReference;
  studentReference: EdFiStudentReference;
  /**
   * Specifies a more granular level of detail of a behavior involved in the incident.
   */
  behaviorDetailedDescription?: string;
  /**
   * An unordered collection of studentDisciplineIncidentBehaviorAssociationDisciplineIncidentParticipationCodes. The role or type of participation of a student in a discipline incident.
   */
  disciplineIncidentParticipationCodes?: EdFiStudentDisciplineIncidentBehaviorAssociationDisciplineIncidentParticipationCode[];
  /**
   * An unordered collection of studentDisciplineIncidentBehaviorAssociationWeapons. Identifies the type(s) of weapon used by the student during a discipline incident. The Federal Gun-Free Schools Act requires states to report the number of students expelled for bringing firearms to school by type of firearm.
   */
  weapons?: EdFiStudentDisciplineIncidentBehaviorAssociationWeapon[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentDisciplineIncidentBehaviorAssociationDisciplineIncidentParticipationCode".
 */
export interface EdFiStudentDisciplineIncidentBehaviorAssociationDisciplineIncidentParticipationCode {
  /**
   * The role or type of participation of a student in a discipline incident.
   */
  disciplineIncidentParticipationCodeDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentDisciplineIncidentBehaviorAssociationWeapon".
 */
export interface EdFiStudentDisciplineIncidentBehaviorAssociationWeapon {
  /**
   * Identifies the type(s) of weapon used by the student during a discipline incident. The Federal Gun-Free Schools Act requires states to report the number of students expelled for bringing firearms to school by type of firearm.
   */
  weaponDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentDisciplineIncidentNonOffenderAssociation".
 */
export interface EdFiStudentDisciplineIncidentNonOffenderAssociation {
  id?: string;
  disciplineIncidentReference: EdFiDisciplineIncidentReference;
  studentReference: EdFiStudentReference;
  /**
   * An unordered collection of studentDisciplineIncidentNonOffenderAssociationDisciplineIncidentParticipationCodes. The role or type of participation of a student in a discipline incident.
   */
  disciplineIncidentParticipationCodes?: EdFiStudentDisciplineIncidentNonOffenderAssociationDisciplineIncidentParticipationCode[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentDisciplineIncidentNonOffenderAssociationDisciplineIncidentParticipationCode".
 */
export interface EdFiStudentDisciplineIncidentNonOffenderAssociationDisciplineIncidentParticipationCode {
  /**
   * The role or type of participation of a student in a discipline incident.
   */
  disciplineIncidentParticipationCodeDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssessmentAccommodation".
 */
export interface EdFiStudentEducationOrganizationAssessmentAccommodation {
  id?: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  studentReference: EdFiStudentReference;
  /**
   * An unordered collection of studentEducationOrganizationAssessmentAccommodationGeneralAccommodations. The special variation(s) to be used in how assessments (in general) are presented, how it is administered, or how the test taker is allowed to respond. This generally refers to changes that do not substantially alter what the examination measures. The proper use of accommodations does not substantially change academic level or performance criteria.
   */
  generalAccommodations?: EdFiStudentEducationOrganizationAssessmentAccommodationGeneralAccommodation[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssessmentAccommodationGeneralAccommodation".
 */
export interface EdFiStudentEducationOrganizationAssessmentAccommodationGeneralAccommodation {
  /**
   * The special variation(s) to be used in how assessments (in general) are presented, how it is administered, or how the test taker is allowed to respond. This generally refers to changes that do not substantially alter what the examination measures. The proper use of accommodations does not substantially change academic level or performance criteria.
   */
  accommodationDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociation".
 */
export interface EdFiStudentEducationOrganizationAssociation {
  id?: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  studentReference: EdFiStudentReference;
  /**
   * An unordered collection of studentEducationOrganizationAssociationAddresses. The set of elements that describes an address, including the street address, city, state, and ZIP code.
   */
  addresses?: EdFiStudentEducationOrganizationAssociationAddress[];
  /**
   * An unordered collection of studentEducationOrganizationAssociationAncestryEthnicOrigins. The original peoples or cultures with which the individual identifies.
   */
  ancestryEthnicOrigins?: EdFiStudentEducationOrganizationAssociationAncestryEthnicOrigin[];
  /**
   * An indication of the barrier to having internet access in the student s primary place of residence.
   */
  barrierToInternetAccessInResidenceDescriptor?: string;
  /**
   * An unordered collection of studentEducationOrganizationAssociationCohortYears. The type and year of a cohort (e.g., 9th grade) the student belongs to as determined by the year that student entered a specific grade.
   */
  cohortYears?: EdFiStudentEducationOrganizationAssociationCohortYear[];
  /**
   * An unordered collection of studentEducationOrganizationAssociationDisabilities. The disability condition(s) that best describes an individual's impairment, as determined by evaluation(s) conducted by the education organization.
   */
  disabilities?: EdFiStudentEducationOrganizationAssociationDisability[];
  /**
   * An unordered collection of studentEducationOrganizationAssociationDisplacedStudents. Information about student who was enrolled, or eligible for enrollment, but has temporarily or permanently enrolled in another school or district because of a crisis-related disruption in educational services.
   */
  displacedStudents?: EdFiStudentEducationOrganizationAssociationDisplacedStudent[];
  /**
   * An unordered collection of studentEducationOrganizationAssociationElectronicMails. The numbers, letters, and symbols used to identify an electronic mail (e-mail) user within the network to which the individual or organization belongs.
   */
  electronicMails?: EdFiStudentEducationOrganizationAssociationElectronicMail[];
  /**
   * The student's gender as last reported to the education organization.
   */
  genderIdentity?: string;
  /**
   * An indication that the individual traces his or her origin or descent to Mexico, Puerto Rico, Cuba, Central, and South America, and other Spanish cultures, regardless of race, as last reported to the education organization. The term, "Spanish origin," can be used in addition to "Hispanic or Latino."
   */
  hispanicLatinoEthnicity?: boolean;
  /**
   * An unordered collection of studentEducationOrganizationAssociationInternationalAddresses. The set of elements that describes an international address.
   */
  internationalAddresses?: EdFiStudentEducationOrganizationAssociationInternationalAddress[];
  /**
   * An indication of whether the student is able to access the internet in their primary place of residence.
   */
  internetAccessInResidence?: boolean;
  /**
   * The primary type of internet service used in the student s primary place of residence.
   */
  internetAccessTypeInResidenceDescriptor?: string;
  /**
   * An indication of whether the student can complete the full range of learning activities, including video streaming and assignment upload, without interruptions caused by poor internet performance in their primary place of residence.
   */
  internetPerformanceInResidenceDescriptor?: string;
  /**
   * An unordered collection of studentEducationOrganizationAssociationLanguages. The language(s) the individual uses to communicate. It is strongly recommended that entries use only ISO 639-3 language codes.
   */
  languages?: EdFiStudentEducationOrganizationAssociationLanguage[];
  /**
   * An indication that the student has been identified as limited English proficient by the Language Proficiency Assessment Committee (LPAC), or English proficient.
   */
  limitedEnglishProficiencyDescriptor?: string;
  /**
   * The login ID for the user; used for security access control interface.
   */
  loginId?: string;
  /**
   * An indication of whether the primary learning device is shared or not shared with another individual.
   */
  primaryLearningDeviceAccessDescriptor?: string;
  /**
   * The type of device the student uses most often to complete learning activities away from school.
   */
  primaryLearningDeviceAwayFromSchoolDescriptor?: string;
  /**
   * The provider of the primary learning device.
   */
  primaryLearningDeviceProviderDescriptor?: string;
  /**
   * Locator reference for the student photo. The specification for that reference is left to local definition.
   */
  profileThumbnail?: string;
  /**
   * An unordered collection of studentEducationOrganizationAssociationRaces. The general racial category which most clearly reflects the individual's recognition of his or her community or with which the individual most identifies as last reported to the education organization. The data model allows for multiple entries so that each individual can specify all appropriate races.
   */
  races?: EdFiStudentEducationOrganizationAssociationRace[];
  /**
   * The student's birth sex as reported to the education organization.
   */
  sexDescriptor?: string;
  /**
   * An unordered collection of studentEducationOrganizationAssociationStudentCharacteristics. Reflects important characteristics of a student. If a student has a characteristic present, that characteristic is considered true or active for that student. If a characteristic is not present, no assumption is made as to the applicability of the characteristic, but local policy may dictate otherwise.
   */
  studentCharacteristics?: EdFiStudentEducationOrganizationAssociationStudentCharacteristic[];
  /**
   * An unordered collection of studentEducationOrganizationAssociationStudentIdentificationCodes. A coding scheme that is used for identification and record-keeping purposes by schools, social services, or other agencies to refer to a student.
   */
  studentIdentificationCodes?: EdFiStudentEducationOrganizationAssociationStudentIdentificationCode[];
  /**
   * An unordered collection of studentEducationOrganizationAssociationStudentIndicators. An indicator or metric computed for the student (e.g., at risk).
   */
  studentIndicators?: EdFiStudentEducationOrganizationAssociationStudentIndicator[];
  /**
   * Military connection of the person/people whom the student is a dependent of.
   */
  supporterMilitaryConnectionDescriptor?: string;
  /**
   * An unordered collection of studentEducationOrganizationAssociationTelephones. The 10-digit telephone number, including the area code, for the person.
   */
  telephones?: EdFiStudentEducationOrganizationAssociationTelephone[];
  /**
   * An unordered collection of studentEducationOrganizationAssociationTribalAffiliations. An American Indian tribe with which the student is affiliated as last reported to the education organization.
   */
  tribalAffiliations?: EdFiStudentEducationOrganizationAssociationTribalAffiliation[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationAddress".
 */
export interface EdFiStudentEducationOrganizationAssociationAddress {
  /**
   * The type of address listed for an individual or organization.    For example:  Physical Address, Mailing Address, Home Address, etc.)
   */
  addressTypeDescriptor: string;
  /**
   * The abbreviation for the state (within the United States) or outlying area in which an address is located.
   */
  stateAbbreviationDescriptor: string;
  /**
   * The name of the city in which an address is located.
   */
  city: string;
  /**
   * The five or nine digit zip code or overseas postal code portion of an address.
   */
  postalCode: string;
  /**
   * The street number and street name or post office box number of an address.
   */
  streetNumberName: string;
  /**
   * A general geographic indicator that categorizes U.S. territory (e.g., City, Suburban).
   */
  localeDescriptor?: string;
  /**
   * The apartment, room, or suite number of an address.
   */
  apartmentRoomSuiteNumber?: string;
  /**
   * The number of the building on the site, if more than one building shares the same address.
   */
  buildingSiteNumber?: string;
  /**
   * The congressional district in which an address is located.
   */
  congressionalDistrict?: string;
  /**
   * The Federal Information Processing Standards (FIPS) numeric code for the county issued by the National Institute of Standards and Technology (NIST). Counties are considered to be the "first-order subdivisions" of each State and statistically equivalent entity, regardless of their local designations (county, parish, borough, etc.) Counties in different States will have the same code. A unique county number is created when combined with the 2-digit FIPS State Code.
   */
  countyFIPSCode?: string;
  /**
   * An indication that the address should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * The geographic latitude of the physical address.
   */
  latitude?: string;
  /**
   * The geographic longitude of the physical address.
   */
  longitude?: string;
  /**
   * The name of the county, parish, borough, or comparable unit (within a state) in which an address is located.
   */
  nameOfCounty?: string;
  /**
   * An unordered collection of studentEducationOrganizationAssociationAddressPeriods. The time periods for which the address is valid. For physical addresses, the periods in which the person lived at that address.
   */
  periods?: EdFiStudentEducationOrganizationAssociationAddressPeriod[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationAddressPeriod".
 */
export interface EdFiStudentEducationOrganizationAssociationAddressPeriod {
  /**
   * The month, day, and year for the start of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The month, day, and year for the end of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationAncestryEthnicOrigin".
 */
export interface EdFiStudentEducationOrganizationAssociationAncestryEthnicOrigin {
  /**
   * The original peoples or cultures with which the individual identifies.
   */
  ancestryEthnicOriginDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationCohortYear".
 */
export interface EdFiStudentEducationOrganizationAssociationCohortYear {
  /**
   * The type of cohort year (9th grade, graduation).
   */
  cohortYearTypeDescriptor: string;
  /**
   * The term associated with the cohort year; for example, the intended term of graduation.
   */
  termDescriptor?: string;
  schoolYearTypeReference: EdFiSchoolYearTypeReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationDisability".
 */
export interface EdFiStudentEducationOrganizationAssociationDisability {
  /**
   * A disability category that describes a individual's impairment.
   */
  disabilityDescriptor: string;
  /**
   * The source that provided the disability determination.
   */
  disabilityDeterminationSourceTypeDescriptor?: string;
  /**
   * A description of the disability diagnosis.
   */
  disabilityDiagnosis?: string;
  /**
   * The order by severity of individual's disabilities: 1- Primary, 2 -  Secondary, 3 - Tertiary, etc.
   */
  orderOfDisability?: number;
  /**
   * An unordered collection of studentEducationOrganizationAssociationDisabilityDesignations. Whether the disability is IDEA, Section 504, or other disability designation.
   */
  designations?: EdFiStudentEducationOrganizationAssociationDisabilityDesignation[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationDisabilityDesignation".
 */
export interface EdFiStudentEducationOrganizationAssociationDisabilityDesignation {
  /**
   * Whether the disability is IDEA, Section 504, or other disability designation.
   */
  disabilityDesignationDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationDisplacedStudent".
 */
export interface EdFiStudentEducationOrganizationAssociationDisplacedStudent {
  /**
   * Indicates whether a student has been displaced as a result of a crisis event.
   */
  displacedStudentStatusDescriptor: string;
  /**
   * Any student considered homeless (defined by the McKinney-Vento Homeless Education Assistance Act as lacking a fixed, regular, and adequate nighttime residence) as a result of the crisis event.
   */
  crisisHomelessnessIndicator?: boolean;
  /**
   * The date marking the end of the period during which a student is considered displaced due to a crisis event.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  displacedStudentEndDate?: string;
  /**
   * The date on which a student is officially identified as displaced due to a crisis event.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  displacedStudentStartDate?: string;
  crisisEventReference: EdFiCrisisEventReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationElectronicMail".
 */
export interface EdFiStudentEducationOrganizationAssociationElectronicMail {
  /**
   * The type of email listed for an individual or organization. For example: Home/Personal, Work, etc.)
   */
  electronicMailTypeDescriptor: string;
  /**
   * The electronic mail (e-mail) address listed for an individual or organization.
   */
  electronicMailAddress: string;
  /**
   * An indication that the electronic email address should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * An indication that the electronic mail address should be used as the principal electronic mail address for an individual or organization.
   */
  primaryEmailAddressIndicator?: boolean;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationInternationalAddress".
 */
export interface EdFiStudentEducationOrganizationAssociationInternationalAddress {
  /**
   * The type of address listed for an individual or organization. For example:  Physical Address, Mailing Address, Home Address, etc.)
   */
  addressTypeDescriptor: string;
  /**
   * The name of the country. It is strongly recommended that entries use only ISO 3166 2-letter country codes.
   */
  countryDescriptor: string;
  /**
   * The first line of the address.
   */
  addressLine1: string;
  /**
   * The second line of the address.
   */
  addressLine2?: string;
  /**
   * The third line of the address.
   */
  addressLine3?: string;
  /**
   * The fourth line of the address.
   */
  addressLine4?: string;
  /**
   * The first date the address is valid. For physical addresses, the date the individual moved to that address.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The last date the address is valid. For physical addresses, the date the individual moved from that address.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * The geographic latitude of the physical address.
   */
  latitude?: string;
  /**
   * The geographic longitude of the physical address.
   */
  longitude?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationLanguage".
 */
export interface EdFiStudentEducationOrganizationAssociationLanguage {
  /**
   * A specification of which written or spoken communication is being used.
   */
  languageDescriptor: string;
  /**
   * An unordered collection of studentEducationOrganizationAssociationLanguageUses. A description of how the language is used (e.g. Home Language, Native Language, Spoken Language).
   */
  uses?: EdFiStudentEducationOrganizationAssociationLanguageUse[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationLanguageUse".
 */
export interface EdFiStudentEducationOrganizationAssociationLanguageUse {
  /**
   * A description of how the language is used (e.g. Home Language, Native Language, Spoken Language).
   */
  languageUseDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationRace".
 */
export interface EdFiStudentEducationOrganizationAssociationRace {
  /**
   * The general racial category which most clearly reflects the individual's recognition of his or her community or with which the individual most identifies as last reported to the education organization. The data model allows for multiple entries so that each individual can specify all appropriate races.
   */
  raceDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationStudentCharacteristic".
 */
export interface EdFiStudentEducationOrganizationAssociationStudentCharacteristic {
  /**
   * The characteristic designated for the student.
   */
  studentCharacteristicDescriptor: string;
  /**
   * The person, organization, or department that designated the characteristic.
   */
  designatedBy?: string;
  /**
   * An unordered collection of studentEducationOrganizationAssociationStudentCharacteristicPeriods. The time periods for which characteristic was effective.
   */
  periods?: EdFiStudentEducationOrganizationAssociationStudentCharacteristicPeriod[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationStudentCharacteristicPeriod".
 */
export interface EdFiStudentEducationOrganizationAssociationStudentCharacteristicPeriod {
  /**
   * The month, day, and year for the start of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The month, day, and year for the end of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationStudentIdentificationCode".
 */
export interface EdFiStudentEducationOrganizationAssociationStudentIdentificationCode {
  /**
   * A coding scheme that is used for identification and record-keeping purposes by schools, social services, or other agencies to refer to a student.
   */
  studentIdentificationSystemDescriptor: string;
  /**
   * The organization code or name assigning the StudentIdentificationCode.
   */
  assigningOrganizationIdentificationCode: string;
  /**
   * A unique number or alphanumeric code assigned to a student by a school, school system, a state, or other agency or entity.
   */
  identificationCode: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationStudentIndicator".
 */
export interface EdFiStudentEducationOrganizationAssociationStudentIndicator {
  /**
   * The name of the indicator or metric.
   */
  indicatorName: string;
  /**
   * The person, organization, or department that designated the program association.
   */
  designatedBy?: string;
  /**
   * The value of the indicator or metric.
   */
  indicator: string;
  /**
   * The name for a group of indicators.
   */
  indicatorGroup?: string;
  /**
   * An unordered collection of studentEducationOrganizationAssociationStudentIndicatorPeriods. The time periods for which the indicator was effective.
   */
  periods?: EdFiStudentEducationOrganizationAssociationStudentIndicatorPeriod[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationStudentIndicatorPeriod".
 */
export interface EdFiStudentEducationOrganizationAssociationStudentIndicatorPeriod {
  /**
   * The month, day, and year for the start of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The month, day, and year for the end of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationTelephone".
 */
export interface EdFiStudentEducationOrganizationAssociationTelephone {
  /**
   * The type of communication number listed for an individual or organization.
   */
  telephoneNumberTypeDescriptor: string;
  /**
   * The telephone number including the area code, and extension, if applicable.
   */
  telephoneNumber: string;
  /**
   * An indication that the telephone number should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * The order of priority assigned to telephone numbers to define which number to attempt first, second, etc.
   */
  orderOfPriority?: number;
  /**
   * An indication that the telephone number is technically capable of sending and receiving Short Message Service (SMS) text messages.
   */
  textMessageCapabilityIndicator?: boolean;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationAssociationTribalAffiliation".
 */
export interface EdFiStudentEducationOrganizationAssociationTribalAffiliation {
  /**
   * An American Indian tribe with which the student is affiliated as last reported to the education organization.
   */
  tribalAffiliationDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentEducationOrganizationResponsibilityAssociation".
 */
export interface EdFiStudentEducationOrganizationResponsibilityAssociation {
  id?: string;
  /**
   * Month, day, and year of the start date of an education organization's responsibility for a student.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * Indications of an education organization's responsibility for a student, such as accountability, attendance, funding, etc.
   */
  responsibilityDescriptor: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  studentReference: EdFiStudentReference;
  /**
   * Month, day, and year of the end date of an education organization's responsibility for a student.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentGradebookEntry".
 */
export interface EdFiStudentGradebookEntry {
  id?: string;
  gradebookEntryReference: EdFiGradebookEntryReference;
  studentReference: EdFiStudentReference;
  /**
   * Status of whether the assignment was submitted after the due date and/or marked as.
   */
  assignmentLateStatusDescriptor?: string;
  /**
   * The competency level assessed for the student for the referenced learning objective.
   */
  competencyLevelDescriptor?: string;
  /**
   * The date an assignment was turned in or the date of an assessment.
   */
  dateFulfilled?: string;
  /**
   * A statement provided by the teacher that provides information in addition to the grade or assessment score.
   */
  diagnosticStatement?: string;
  /**
   * A final or interim (grading period) indicator of student performance in a class as submitted by the instructor.
   */
  letterGradeEarned?: string;
  /**
   * A final or interim (grading period) indicator of student performance in a class as submitted by the instructor.
   */
  numericGradeEarned?: number;
  /**
   * The points earned for the submission. With extra credit, the points earned may exceed the max points.
   */
  pointsEarned?: number;
  /**
   * The status of the student's submission.
   */
  submissionStatusDescriptor?: string;
  /**
   * The time an assignment was turned in on the date fulfilled.
   */
  timeFulfilled?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentHealth".
 */
export interface EdFiStudentHealth {
  id?: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  studentReference: EdFiStudentReference;
  /**
   * An unordered collection of studentHealthAdditionalImmunizations. A record of additional immunizations satisfactorily received and reported.
   */
  additionalImmunizations?: EdFiStudentHealthAdditionalImmunization[];
  /**
   * Date of last update of the student's health record.
   */
  asOfDate: string;
  /**
   * The year, month and day of the nonmedical exemption from vaccination claimed by the student's parent or guardian.
   */
  nonMedicalImmunizationExemptionDate?: string;
  /**
   * The type of nonmedical exemption from vaccination claimed by the student's parent or guardian.
   */
  nonMedicalImmunizationExemptionDescriptor?: string;
  /**
   * An unordered collection of studentHealthRequiredImmunizations. A record of the immunizations satisfactorily  received for those recommended to protect the student against vaccine-preventable diseases.
   */
  requiredImmunizations?: EdFiStudentHealthRequiredImmunization[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentHealthAdditionalImmunization".
 */
export interface EdFiStudentHealthAdditionalImmunization {
  /**
   * The name of the immunization that the student has received.
   */
  immunizationName: string;
  /**
   * An unordered collection of studentHealthAdditionalImmunizationDates. The year, month and day of the related additional immunization.
   */
  dates?: EdFiStudentHealthAdditionalImmunizationDate[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentHealthAdditionalImmunizationDate".
 */
export interface EdFiStudentHealthAdditionalImmunizationDate {
  /**
   * The year, month and day of the related additional immunization.
   */
  immunizationDate: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentHealthRequiredImmunization".
 */
export interface EdFiStudentHealthRequiredImmunization {
  /**
   * An indication of the type of immunization that the student has received.
   */
  immunizationTypeDescriptor: string;
  /**
   * The medical condition identified by a physician that contraindicates the vaccine.
   */
  medicalExemption?: string;
  /**
   * The year, month, and day of the medical exemption by a physician.
   */
  medicalExemptionDate?: string;
  /**
   * An unordered collection of studentHealthRequiredImmunizationDates. The year, month and day of the related required immunization.
   */
  dates?: EdFiStudentHealthRequiredImmunizationDate[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentHealthRequiredImmunizationDate".
 */
export interface EdFiStudentHealthRequiredImmunizationDate {
  /**
   * The year, month and day of the related required immunization.
   */
  immunizationDate: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentHomelessProgramAssociation".
 */
export interface EdFiStudentHomelessProgramAssociation {
  id?: string;
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  programReference: EdFiProgramReference;
  studentReference: EdFiStudentReference;
  /**
   * State defined definition for awaiting foster care.
   */
  awaitingFosterCare?: boolean;
  /**
   * The month, day, and year on which the student exited the program or stopped receiving services.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * The primary nighttime residence of the student at the time the student is identified as homeless.
   */
  homelessPrimaryNighttimeResidenceDescriptor?: string;
  /**
   * An unordered collection of studentHomelessProgramAssociationHomelessProgramServices. Indicates the service(s) being provided to the student by the homeless program.
   */
  homelessProgramServices?: EdFiStudentHomelessProgramAssociationHomelessProgramService[];
  /**
   * A homeless unaccompanied youth is a youth who is not in the physical custody of a parent or guardian and who fits the McKinney-Vento definition of homeless. Students must be both unaccompanied and homeless to be included as an unaccompanied homeless youth.
   */
  homelessUnaccompaniedYouth?: boolean;
  /**
   * An unordered collection of generalStudentProgramAssociationProgramParticipationStatuses. The status of the student's program participation.
   */
  programParticipationStatuses?: EdFiGeneralStudentProgramAssociationProgramParticipationStatus[];
  /**
   * The reason the student left the program within a school or district.
   */
  reasonExitedDescriptor?: string;
  /**
   * Indicates whether the student received services during the summer session or between sessions.
   */
  servedOutsideOfRegularSession?: boolean;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentHomelessProgramAssociationHomelessProgramService".
 */
export interface EdFiStudentHomelessProgramAssociationHomelessProgramService {
  /**
   * Indicates the service being provided to the student by the homeless program.
   */
  homelessProgramServiceDescriptor: string;
  /**
   * True if service is a primary service.
   */
  primaryIndicator?: boolean;
  /**
   * First date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceBeginDate?: string;
  /**
   * Last date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceEndDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentInterventionAssociation".
 */
export interface EdFiStudentInterventionAssociation {
  id?: string;
  cohortReference?: EdFiCohortReference;
  interventionReference: EdFiInterventionReference;
  studentReference: EdFiStudentReference;
  /**
   * A statement provided by the assigner that provides information regarding why the student was assigned to this intervention.
   */
  diagnosticStatement?: string;
  /**
   * The duration of time in minutes for which the student was assigned to participate in the intervention.
   */
  dosage?: number;
  /**
   * An unordered collection of studentInterventionAssociationInterventionEffectivenesses. A measure of the effects of an intervention in each outcome domain. The rating of effectiveness takes into account four factors: the quality of the research on the intervention, the statistical significance of the research findings, the size of the differences between participants in the intervention and comparison groups and the consistency in results.
   */
  interventionEffectivenesses?: EdFiStudentInterventionAssociationInterventionEffectiveness[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentInterventionAssociationInterventionEffectiveness".
 */
export interface EdFiStudentInterventionAssociationInterventionEffectiveness {
  /**
   * Targeted purpose of the intervention (e.g., attendance issue, dropout risk) for which the effectiveness is measured.
   */
  diagnosisDescriptor: string;
  /**
   * Grade level for which effectiveness is measured.
   */
  gradeLevelDescriptor: string;
  /**
   * Population for which effectiveness is measured.
   */
  populationServedDescriptor: string;
  /**
   * An intervention demonstrates effectiveness if the research has shown that the program caused an improvement in outcomes. Values: positive effects, potentially positive effects, mixed effects, potentially negative effects, negative effects, and no discernible effects.
   */
  interventionEffectivenessRatingDescriptor: string;
  /**
   * Along a percentile distribution of students, the improvement index represents the change in an average student's percentile rank that is considered to be due to the intervention.
   */
  improvementIndex?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentInterventionAttendanceEvent".
 */
export interface EdFiStudentInterventionAttendanceEvent {
  id?: string;
  /**
   * A code describing the attendance event, for example:         Present         Unexcused absence         Excused absence         Tardy.
   */
  attendanceEventCategoryDescriptor: string;
  /**
   * Date for this attendance event.
   */
  eventDate: string;
  interventionReference: EdFiInterventionReference;
  studentReference: EdFiStudentReference;
  /**
   * The reported reason for a student's absence.
   */
  attendanceEventReason?: string;
  /**
   * The setting in which a child receives education and related services. This attribute is only used if it differs from the EducationalEnvironment of the Section. This is only used in the AttendanceEvent if different from the associated Section.
   */
  educationalEnvironmentDescriptor?: string;
  /**
   * The amount of time in days for the event as recognized by the school: 1 day = 1, 1/2 day = 0.5, 1/3 day = 0.33.
   */
  eventDuration?: number;
  /**
   * The duration in minutes of the intervention attendance event.
   */
  interventionDuration?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentLanguageInstructionProgramAssociation".
 */
export interface EdFiStudentLanguageInstructionProgramAssociation {
  id?: string;
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  programReference: EdFiProgramReference;
  studentReference: EdFiStudentReference;
  /**
   * The duration of time in minutes for which the student was assigned to participate in the program.
   */
  dosage?: number;
  /**
   * The month, day, and year on which the student exited the program or stopped receiving services.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * An unordered collection of studentLanguageInstructionProgramAssociationEnglishLanguageProficiencyAssessments. Results of yearly English language assessment.
   */
  englishLanguageProficiencyAssessments?: EdFiStudentLanguageInstructionProgramAssociationEnglishLanguageProficiencyAssessment[];
  /**
   * An indication that an English learner student is served by an English language instruction educational program supported with Title III of ESEA funds.
   */
  englishLearnerParticipation?: boolean;
  /**
   * An unordered collection of studentLanguageInstructionProgramAssociationLanguageInstructionProgramServices. Indicates the service(s) being provided to the student by the language instruction program.
   */
  languageInstructionProgramServices?: EdFiStudentLanguageInstructionProgramAssociationLanguageInstructionProgramService[];
  /**
   * An unordered collection of generalStudentProgramAssociationProgramParticipationStatuses. The status of the student's program participation.
   */
  programParticipationStatuses?: EdFiGeneralStudentProgramAssociationProgramParticipationStatus[];
  /**
   * The reason the student left the program within a school or district.
   */
  reasonExitedDescriptor?: string;
  /**
   * Indicates whether the student received services during the summer session or between sessions.
   */
  servedOutsideOfRegularSession?: boolean;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentLanguageInstructionProgramAssociationEnglishLanguageProficiencyAssessment".
 */
export interface EdFiStudentLanguageInstructionProgramAssociationEnglishLanguageProficiencyAssessment {
  /**
   * Student is monitored on content achievement who are no longer receiving services.
   */
  monitoredDescriptor?: string;
  /**
   * Field indicating the participation in the yearly English language assessment.
   */
  participationDescriptor?: string;
  /**
   * The proficiency level for the yearly English language assessment.
   */
  proficiencyDescriptor?: string;
  /**
   * The yearly progress or growth from last year's assessment.
   */
  progressDescriptor?: string;
  schoolYearTypeReference: EdFiSchoolYearTypeReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentLanguageInstructionProgramAssociationLanguageInstructionProgramService".
 */
export interface EdFiStudentLanguageInstructionProgramAssociationLanguageInstructionProgramService {
  /**
   * Indicates the service being provided to the student by the language instruction program.
   */
  languageInstructionProgramServiceDescriptor: string;
  /**
   * True if service is a primary service.
   */
  primaryIndicator?: boolean;
  /**
   * First date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceBeginDate?: string;
  /**
   * Last date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceEndDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentMigrantEducationProgramAssociation".
 */
export interface EdFiStudentMigrantEducationProgramAssociation {
  id?: string;
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  programReference: EdFiProgramReference;
  studentReference: EdFiStudentReference;
  /**
   * The "continuation of services" provision found in Section 1304(e) of the statute provides that (1) a child who ceases to be a migratory child during a school term shall be eligible for services until the end of such term; (2) a child who is no longer a migratory child may continue to receive services for one additional school year, but only if comparable services are not available through other programs; and (3) secondary school students who were eligible for services in secondary school may continue to be served through credit accrual programs until graduation. Only students who received services at any time during their 36 month eligibility period may continue to receive services (not necessarily the same service).
   */
  continuationOfServicesReasonDescriptor?: string;
  /**
   * The eligibility expiration date is used to determine end of eligibility and to account for a child's eligibility expiring earlier than 36 months from the child's QAD. A child's eligibility would end earlier than 36 months from the child's QAD, if the child is no longer entitled to a free public education (e.g., graduated with a high school diploma, obtained a high school equivalency diploma (HSED), or for other reasons as determined by states' requirements), or if the child passes away.
   */
  eligibilityExpirationDate?: string;
  /**
   * The month, day, and year on which the student exited the program or stopped receiving services.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * Date the last qualifying move occurred; used to compute MEP status.
   */
  lastQualifyingMove: string;
  /**
   * An unordered collection of studentMigrantEducationProgramAssociationMigrantEducationProgramServices. Indicates the service(s) being provided to the student by the migrant education program.
   */
  migrantEducationProgramServices?: EdFiStudentMigrantEducationProgramAssociationMigrantEducationProgramService[];
  /**
   * Report migratory children who are classified as having "priority for services" because they are failing, or most at risk of failing to meet the state's challenging state academic content standards and challenging state student academic achievement standards, and their education has been interrupted during the regular school year.
   */
  priorityForServices: boolean;
  /**
   * An unordered collection of generalStudentProgramAssociationProgramParticipationStatuses. The status of the student's program participation.
   */
  programParticipationStatuses?: EdFiGeneralStudentProgramAssociationProgramParticipationStatus[];
  /**
   * The qualifying arrival date (QAD) is the date the child joins the worker who has already moved, or the date when the worker joins the child who has already moved. The QAD is the date that the child's eligibility for the MEP begins. The QAD is not affected by subsequent non-qualifying moves.
   */
  qualifyingArrivalDate?: string;
  /**
   * The reason the student left the program within a school or district.
   */
  reasonExitedDescriptor?: string;
  /**
   * Indicates whether the student received services during the summer session or between sessions.
   */
  servedOutsideOfRegularSession?: boolean;
  /**
   * The verified state residency for the student.
   */
  stateResidencyDate?: string;
  /**
   * The month, day, and year on which the student first entered the U.S.
   */
  usInitialEntry?: string;
  /**
   * The month, day, and year on which the student first entered a U.S. school.
   */
  usInitialSchoolEntry?: string;
  /**
   * The month, day, and year of the student's most recent entry into the U.S.
   */
  usMostRecentEntry?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentMigrantEducationProgramAssociationMigrantEducationProgramService".
 */
export interface EdFiStudentMigrantEducationProgramAssociationMigrantEducationProgramService {
  /**
   * Indicates the service being provided to the student by the migrant education program.
   */
  migrantEducationProgramServiceDescriptor: string;
  /**
   * True if service is a primary service.
   */
  primaryIndicator?: boolean;
  /**
   * First date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceBeginDate?: string;
  /**
   * Last date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceEndDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentNeglectedOrDelinquentProgramAssociation".
 */
export interface EdFiStudentNeglectedOrDelinquentProgramAssociation {
  id?: string;
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  programReference: EdFiProgramReference;
  studentReference: EdFiStudentReference;
  /**
   * The progress measured from pre- to post- test for ELA.
   */
  elaProgressLevelDescriptor?: string;
  /**
   * The month, day, and year on which the student exited the program or stopped receiving services.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * The progress measured from pre- to post-test for Mathematics.
   */
  mathematicsProgressLevelDescriptor?: string;
  /**
   * The type of program under ESEA Title I, Part D, Subpart 1 (state programs) or Subpart 2 (LEA).
   */
  neglectedOrDelinquentProgramDescriptor?: string;
  /**
   * An unordered collection of studentNeglectedOrDelinquentProgramAssociationNeglectedOrDelinquentProgramServices. Indicates the service(s) being provided to the student by the neglected or delinquent program.
   */
  neglectedOrDelinquentProgramServices?: EdFiStudentNeglectedOrDelinquentProgramAssociationNeglectedOrDelinquentProgramService[];
  /**
   * An unordered collection of generalStudentProgramAssociationProgramParticipationStatuses. The status of the student's program participation.
   */
  programParticipationStatuses?: EdFiGeneralStudentProgramAssociationProgramParticipationStatus[];
  /**
   * The reason the student left the program within a school or district.
   */
  reasonExitedDescriptor?: string;
  /**
   * Indicates whether the student received services during the summer session or between sessions.
   */
  servedOutsideOfRegularSession?: boolean;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentNeglectedOrDelinquentProgramAssociationNeglectedOrDelinquentProgramService".
 */
export interface EdFiStudentNeglectedOrDelinquentProgramAssociationNeglectedOrDelinquentProgramService {
  /**
   * Indicates the service being provided to the student by the neglected or delinquent program.
   */
  neglectedOrDelinquentProgramServiceDescriptor: string;
  /**
   * True if service is a primary service.
   */
  primaryIndicator?: boolean;
  /**
   * First date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceBeginDate?: string;
  /**
   * Last date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceEndDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentProgramAssociation".
 */
export interface EdFiStudentProgramAssociation {
  id?: string;
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  programReference: EdFiProgramReference;
  studentReference: EdFiStudentReference;
  /**
   * The month, day, and year on which the student exited the program or stopped receiving services.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * An unordered collection of generalStudentProgramAssociationProgramParticipationStatuses. The status of the student's program participation.
   */
  programParticipationStatuses?: EdFiGeneralStudentProgramAssociationProgramParticipationStatus[];
  /**
   * The reason the student left the program within a school or district.
   */
  reasonExitedDescriptor?: string;
  /**
   * Indicates whether the student received services during the summer session or between sessions.
   */
  servedOutsideOfRegularSession?: boolean;
  /**
   * An unordered collection of studentProgramAssociationServices. Indicates the service(s) being provided to the student by the program.
   */
  services?: EdFiStudentProgramAssociationService[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentProgramAssociationService".
 */
export interface EdFiStudentProgramAssociationService {
  /**
   * Indicates the service being provided to the student by the program.
   */
  serviceDescriptor: string;
  /**
   * True if service is a primary service.
   */
  primaryIndicator?: boolean;
  /**
   * First date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceBeginDate?: string;
  /**
   * Last date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceEndDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentProgramAttendanceEvent".
 */
export interface EdFiStudentProgramAttendanceEvent {
  id?: string;
  /**
   * A code describing the attendance event, for example:         Present         Unexcused absence         Excused absence         Tardy.
   */
  attendanceEventCategoryDescriptor: string;
  /**
   * Date for this attendance event.
   */
  eventDate: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  programReference: EdFiProgramReference;
  studentReference: EdFiStudentReference;
  /**
   * The reported reason for a student's absence.
   */
  attendanceEventReason?: string;
  /**
   * The setting in which a child receives education and related services. This attribute is only used if it differs from the EducationalEnvironment of the Section. This is only used in the AttendanceEvent if different from the associated Section.
   */
  educationalEnvironmentDescriptor?: string;
  /**
   * The amount of time in days for the event as recognized by the school: 1 day = 1, 1/2 day = 0.5, 1/3 day = 0.33.
   */
  eventDuration?: number;
  /**
   * The duration in minutes of the program attendance event.
   */
  programAttendanceDuration?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentProgramEvaluation".
 */
export interface EdFiStudentProgramEvaluation {
  id?: string;
  /**
   * The month, day, and year on which the evaluation was conducted.
   */
  evaluationDate: string;
  educationOrganizationReference?: EdFiEducationOrganizationReference;
  programEvaluationReference: EdFiProgramEvaluationReference;
  staffEvaluatorStaffReference?: EdFiStaffReference;
  studentReference: EdFiStudentReference;
  /**
   * The actual number of minutes to conduct the evaluation.
   */
  evaluationDuration?: number;
  /**
   * An unordered collection of studentProgramEvaluationExternalEvaluators. The external person(s) - not staff - that conducted the evaluation.
   */
  externalEvaluators?: EdFiStudentProgramEvaluationExternalEvaluator[];
  /**
   * An unordered collection of studentProgramEvaluationStudentEvaluationElements. The student's rating and/or rating levels earned for a program evaluation element.
   */
  studentEvaluationElements?: EdFiStudentProgramEvaluationStudentEvaluationElement[];
  /**
   * An unordered collection of studentProgramEvaluationStudentEvaluationObjectives. The student's rating and/or rating levels earned for a program evaluation objective.
   */
  studentEvaluationObjectives?: EdFiStudentProgramEvaluationStudentEvaluationObjective[];
  /**
   * Any comments about the summary evaluation to be captured.
   */
  summaryEvaluationComment?: string;
  /**
   * The numerical summary rating or score for the evaluation.
   */
  summaryEvaluationNumericRating?: number;
  /**
   * The summary rating level achieved based upon the rating or score.
   */
  summaryEvaluationRatingLevelDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentProgramEvaluationExternalEvaluator".
 */
export interface EdFiStudentProgramEvaluationExternalEvaluator {
  /**
   * The external person(s) - not staff - that conducted the evaluation.
   */
  externalEvaluator: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentProgramEvaluationStudentEvaluationElement".
 */
export interface EdFiStudentProgramEvaluationStudentEvaluationElement {
  /**
   * The rating level achieved based upon the rating or score for the evaluation element.
   */
  evaluationElementRatingLevelDescriptor?: string;
  /**
   * The numerical rating or score for the evaluation element.
   */
  evaluationElementNumericRating?: number;
  programEvaluationElementReference: EdFiProgramEvaluationElementReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentProgramEvaluationStudentEvaluationObjective".
 */
export interface EdFiStudentProgramEvaluationStudentEvaluationObjective {
  /**
   * The rating level achieved based upon the rating or score for the evaluation objective.
   */
  evaluationObjectiveRatingLevelDescriptor?: string;
  /**
   * The numerical rating or score for the evaluation objective.
   */
  evaluationObjectiveNumericRating?: number;
  programEvaluationObjectiveReference: EdFiProgramEvaluationObjectiveReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSchoolAssociation".
 */
export interface EdFiStudentSchoolAssociation {
  id?: string;
  /**
   * The month, day, and year on which an individual enters and begins to receive instructional services in a school for each school year. The EntryDate value should be the date the student enrolled, or when the student's enrollment materially changed, such as with a grade promotion.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  entryDate: string;
  calendarReference?: EdFiCalendarReference;
  classOfSchoolYearTypeReference?: EdFiSchoolYearTypeReference;
  graduationPlanReference?: EdFiGraduationPlanReference;
  nextYearSchoolReference?: EdFiSchoolReference;
  schoolReference: EdFiSchoolReference;
  schoolYearTypeReference?: EdFiSchoolYearTypeReference;
  studentReference: EdFiStudentReference;
  /**
   * An unordered collection of studentSchoolAssociationAlternativeGraduationPlans. The secondary graduation plan or plans associated with the student enrolled in the school.
   */
  alternativeGraduationPlans?: EdFiStudentSchoolAssociationAlternativeGraduationPlan[];
  /**
   * An unordered collection of studentSchoolAssociationEducationPlans. The type of education plan(s) the student is following, if appropriate.
   */
  educationPlans?: EdFiStudentSchoolAssociationEducationPlan[];
  /**
   * An individual who is a paid employee or works in his or her own business, profession, or farm and at the same time is enrolled in secondary, postsecondary, or adult education.
   */
  employedWhileEnrolled?: boolean;
  /**
   * The type of enrollment reflected by the StudentSchoolAssociation.
   */
  enrollmentTypeDescriptor?: string;
  /**
   * The grade level or primary instructional level at which a student enters and receives services in a school or an educational institution during a given academic session.
   */
  entryGradeLevelDescriptor: string;
  /**
   * The primary reason as to why a staff member determined that a student should be promoted or not (or be demoted) at the end of a given school term.
   */
  entryGradeLevelReasonDescriptor?: string;
  /**
   * The process by which a student enters a school during a given academic session.
   */
  entryTypeDescriptor?: string;
  /**
   * The recorded exit or withdraw date for the student.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  exitWithdrawDate?: string;
  /**
   * The circumstances under which the student exited from membership in an educational institution.
   */
  exitWithdrawTypeDescriptor?: string;
  /**
   * The full-time equivalent ratio for the student s assignment to a school for services or instruction. For example, a full-time student would have an FTE value of 1 while a half-time student would have an FTE value of 0.5.
   */
  fullTimeEquivalency?: number;
  /**
   * The anticipated grade level for the student for the next school year.
   */
  nextYearGradeLevelDescriptor?: string;
  /**
   * Indicates if a given enrollment record should be considered the primary record for a student.
   */
  primarySchool?: boolean;
  /**
   * An indicator of whether the student is enrolling to repeat a grade level, either by failure or an agreement to hold the student back.
   */
  repeatGradeIndicator?: boolean;
  /**
   * An indication of the location of a persons legal residence relative to (within or outside of) the boundaries of the public school attended and its administrative unit.
   */
  residencyStatusDescriptor?: string;
  /**
   * An indication of whether the student enrolled in this school under the provisions for public school choice
   */
  schoolChoice?: boolean;
  /**
   * The legal basis for the school choice enrollment according to local, state or federal policy or regulation. (The descriptor provides the list of available bases specific to the state
   */
  schoolChoiceBasisDescriptor?: string;
  /**
   * An indication of whether students transferred in or out of the school did so during the school year under the provisions for public school choice in accordance with Title I, Part A, Section 1116.
   */
  schoolChoiceTransfer?: boolean;
  /**
   * Idicates whether or not a student completed the most recent school term.
   */
  termCompletionIndicator?: boolean;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSchoolAssociationAlternativeGraduationPlan".
 */
export interface EdFiStudentSchoolAssociationAlternativeGraduationPlan {
  alternativeGraduationPlanReference: EdFiGraduationPlanReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSchoolAssociationEducationPlan".
 */
export interface EdFiStudentSchoolAssociationEducationPlan {
  /**
   * The type of education plan(s) the student is following, if appropriate.
   */
  educationPlanDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSchoolAttendanceEvent".
 */
export interface EdFiStudentSchoolAttendanceEvent {
  id?: string;
  /**
   * A code describing the attendance event, for example:         Present         Unexcused absence         Excused absence         Tardy.
   */
  attendanceEventCategoryDescriptor: string;
  /**
   * Date for this attendance event.
   */
  eventDate: string;
  schoolReference: EdFiSchoolReference;
  sessionReference: EdFiSessionReference;
  studentReference: EdFiStudentReference;
  /**
   * The time of day the student arrived for the attendance event in ISO 8601 format.
   */
  arrivalTime?: string;
  /**
   * The reported reason for a student's absence.
   */
  attendanceEventReason?: string;
  /**
   * The time of day the student departed for the attendance event in ISO 8601 format.
   */
  departureTime?: string;
  /**
   * The setting in which a child receives education and related services. This attribute is only used if it differs from the EducationalEnvironment of the Section. This is only used in the AttendanceEvent if different from the associated Section.
   */
  educationalEnvironmentDescriptor?: string;
  /**
   * The amount of time in days for the event as recognized by the school: 1 day = 1, 1/2 day = 0.5, 1/3 day = 0.33.
   */
  eventDuration?: number;
  /**
   * The duration in minutes of the school attendance event.
   */
  schoolAttendanceDuration?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSchoolFoodServiceProgramAssociation".
 */
export interface EdFiStudentSchoolFoodServiceProgramAssociation {
  id?: string;
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  programReference: EdFiProgramReference;
  studentReference: EdFiStudentReference;
  /**
   * Indicates that the student's National School Lunch Program (NSLP) eligibility has been determined through direct certification.
   */
  directCertification?: boolean;
  /**
   * The month, day, and year on which the student exited the program or stopped receiving services.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * An unordered collection of generalStudentProgramAssociationProgramParticipationStatuses. The status of the student's program participation.
   */
  programParticipationStatuses?: EdFiGeneralStudentProgramAssociationProgramParticipationStatus[];
  /**
   * The reason the student left the program within a school or district.
   */
  reasonExitedDescriptor?: string;
  /**
   * An unordered collection of studentSchoolFoodServiceProgramAssociationSchoolFoodServiceProgramServices. Indicates the service(s) being provided to the student by the school food service program.
   */
  schoolFoodServiceProgramServices?: EdFiStudentSchoolFoodServiceProgramAssociationSchoolFoodServiceProgramService[];
  /**
   * Indicates whether the student received services during the summer session or between sessions.
   */
  servedOutsideOfRegularSession?: boolean;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSchoolFoodServiceProgramAssociationSchoolFoodServiceProgramService".
 */
export interface EdFiStudentSchoolFoodServiceProgramAssociationSchoolFoodServiceProgramService {
  /**
   * Indicates the service being provided to the student by the school food service program.
   */
  schoolFoodServiceProgramServiceDescriptor: string;
  /**
   * True if service is a primary service.
   */
  primaryIndicator?: boolean;
  /**
   * First date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceBeginDate?: string;
  /**
   * Last date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceEndDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSection504ProgramAssociation".
 */
export interface EdFiStudentSection504ProgramAssociation {
  id?: string;
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  programReference: EdFiProgramReference;
  studentReference: EdFiStudentReference;
  /**
   * Indicates whether student has a Section 504 accommodation plan.
   */
  accommodationPlan?: boolean;
  /**
   * The month, day, and year on which the student exited the program or stopped receiving services.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * An unordered collection of generalStudentProgramAssociationProgramParticipationStatuses. The status of the student's program participation.
   */
  programParticipationStatuses?: EdFiGeneralStudentProgramAssociationProgramParticipationStatus[];
  /**
   * The reason the student left the program within a school or district.
   */
  reasonExitedDescriptor?: string;
  /**
   * Defines one or more disabilities student has that qualifies them for a Section 504 plan.
   */
  section504DisabilityDescriptor?: string;
  /**
   * Indicates whether student has a disability, either temporary or permenant, that qualifies student for Section 504 consideration. Selection of FALSE for this boolean is equivalent to marking student as 'Did Not Qualify'.
   */
  section504Eligibility: boolean;
  /**
   * The month, day, and year on which the Section 504 eligibility decision is made.
   */
  section504EligibilityDecisionDate?: string;
  /**
   * The month, day, and year on which the meeting with student's parent/guardian held to discuss the 504 eligibility of the student.
   */
  section504MeetingDate?: string;
  /**
   * Indicates whether the student received services during the summer session or between sessions.
   */
  servedOutsideOfRegularSession?: boolean;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSectionAssociation".
 */
export interface EdFiStudentSectionAssociation {
  id?: string;
  /**
   * Month, day, and year of the student's entry or assignment to the section.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  dualCreditEducationOrganizationReference?: EdFiEducationOrganizationReference;
  sectionReference: EdFiSectionReference;
  studentReference: EdFiStudentReference;
  /**
   * An indication of the student's completion status for the section.
   */
  attemptStatusDescriptor?: string;
  /**
   * Indicates whether the student assigned to the section is to receive dual credit upon successful completion.
   */
  dualCreditIndicator?: boolean;
  /**
   * Descriptor for the postsecondary institution offering college credit. This descriptor may be used to select a postsecondary institution that is not defined as an education organization, and/or select a general type of postsecondary institution.
   */
  dualCreditInstitutionDescriptor?: string;
  /**
   * For a student taking a dual credit course in a college or high school setting, indicates the type of dual credit program.
   */
  dualCreditTypeDescriptor?: string;
  /**
   * Indicates whether successful completion of the course will result in credits toward high school graduation.
   */
  dualHighSchoolCreditIndicator?: boolean;
  /**
   * Month, day, and year of the withdrawal or exit of the student from the section.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * Indicates the section is the student's homeroom. Homeroom period may the convention for taking daily attendance.
   */
  homeroomIndicator?: boolean;
  /**
   * An unordered collection of studentSectionAssociationPrograms. The program(s) that the student is participating in the context of the course.
   */
  programs?: EdFiStudentSectionAssociationProgram[];
  /**
   * An indication as to whether a student has previously taken a given course.
   */
  repeatIdentifierDescriptor?: string;
  /**
   * Indicates that the student-section combination is excluded from calculation of value-added or growth attribution calculations used for a particular teacher evaluation.
   */
  teacherStudentDataLinkExclusion?: boolean;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSectionAssociationProgram".
 */
export interface EdFiStudentSectionAssociationProgram {
  programReference: EdFiProgramReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSectionAttendanceEvent".
 */
export interface EdFiStudentSectionAttendanceEvent {
  id?: string;
  /**
   * A code describing the attendance event, for example:         Present         Unexcused absence         Excused absence         Tardy.
   */
  attendanceEventCategoryDescriptor: string;
  /**
   * Date for this attendance event.
   */
  eventDate: string;
  sectionReference: EdFiSectionReference;
  studentReference: EdFiStudentReference;
  /**
   * The time of day the student arrived for the attendance event in ISO 8601 format.
   */
  arrivalTime?: string;
  /**
   * The reported reason for a student's absence.
   */
  attendanceEventReason?: string;
  /**
   * An unordered collection of studentSectionAttendanceEventClassPeriods. The class period(s) to which the section attendance event applies.
   */
  classPeriods?: EdFiStudentSectionAttendanceEventClassPeriod[];
  /**
   * The time of day the student departed for the attendance event in ISO 8601 format.
   */
  departureTime?: string;
  /**
   * The setting in which a child receives education and related services. This attribute is only used if it differs from the EducationalEnvironment of the Section. This is only used in the AttendanceEvent if different from the associated Section.
   */
  educationalEnvironmentDescriptor?: string;
  /**
   * The amount of time in days for the event as recognized by the school: 1 day = 1, 1/2 day = 0.5, 1/3 day = 0.33.
   */
  eventDuration?: number;
  /**
   * The duration in minutes of the section attendance event.
   */
  sectionAttendanceDuration?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSectionAttendanceEventClassPeriod".
 */
export interface EdFiStudentSectionAttendanceEventClassPeriod {
  classPeriodReference: EdFiClassPeriodReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSpecialEducationProgramAssociation".
 */
export interface EdFiStudentSpecialEducationProgramAssociation {
  id?: string;
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  programReference: EdFiProgramReference;
  studentReference: EdFiStudentReference;
  /**
   * An unordered collection of studentSpecialEducationProgramAssociationDisabilities. The disability condition(s) that best describes an individual's impairment, as related to special education services received.
   */
  disabilities?: EdFiStudentSpecialEducationProgramAssociationDisability[];
  /**
   * The month, day, and year on which the student exited the program or stopped receiving services.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * Indicator of the eligibility of the student to receive special education services according to the Individuals with Disabilities Education Act (IDEA).
   */
  ideaEligibility?: boolean;
  /**
   * The effective date of the most recent IEP.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  iepBeginDate?: string;
  /**
   * The end date of the most recent IEP.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  iepEndDate?: string;
  /**
   * The date of the last IEP review.
   */
  iepReviewDate?: string;
  /**
   * The date of the last special education evaluation.
   */
  lastEvaluationDate?: string;
  /**
   * Indicates whether the student receiving special education and related services is: 1) in the age range of birth to 22 years, and 2) has a serious, ongoing illness or a chronic condition that has lasted or is anticipated to last at least 12 or more months or has required at least one month of hospitalization, and that requires daily, ongoing medical treatments and monitoring by appropriately trained personnel which may include parents or other family members, and 3) requires the routine use of medical device or of assistive technology to compensate for the loss of usefulness of a body function needed to participate in activities of daily living, and 4) lives with ongoing threat to his or her continued well-being. Aligns with federal requirements.
   */
  medicallyFragile?: boolean;
  /**
   * Indicates whether the student receiving special education and related services has been designated as multiply disabled by the admission, review, and dismissal committee as aligned with federal requirements.
   */
  multiplyDisabled?: boolean;
  /**
   * An unordered collection of generalStudentProgramAssociationProgramParticipationStatuses. The status of the student's program participation.
   */
  programParticipationStatuses?: EdFiGeneralStudentProgramAssociationProgramParticipationStatus[];
  /**
   * The reason the student left the program within a school or district.
   */
  reasonExitedDescriptor?: string;
  /**
   * Records the number of hours reduced for the shortened school day for the IEP student as compared to peers in regular education.
   */
  reductionInHoursPerWeekComparedToPeers?: number;
  /**
   * Indicate the total number of hours of instructional time per week for the school that the student attends.
   */
  schoolHoursPerWeek?: number;
  /**
   * Indicates whether the student received services during the summer session or between sessions.
   */
  servedOutsideOfRegularSession?: boolean;
  /**
   * An unordered collection of studentSpecialEducationProgramAssociationServiceProviders. The staff providing special education services to the student.
   */
  serviceProviders?: EdFiStudentSpecialEducationProgramAssociationServiceProvider[];
  /**
   * Indicator that the student's IEP requires a shortened school day.
   */
  shortenedSchoolDayIndicator?: boolean;
  /**
   * The  month, day and year on which a person stops receiving special education services.
   */
  specialEducationExitDate?: string;
  /**
   * Explanation on why a person stops receiving special education services.
   */
  specialEducationExitExplained?: string;
  /**
   * The reason why a person stops receiving special education services.
   */
  specialEducationExitReasonDescriptor?: string;
  /**
   * The number of hours per week for special education instruction and therapy.
   */
  specialEducationHoursPerWeek?: number;
  /**
   * An unordered collection of studentSpecialEducationProgramAssociationSpecialEducationProgramServices. Indicates the service(s) being provided to the student by the special education program.
   */
  specialEducationProgramServices?: EdFiStudentSpecialEducationProgramAssociationSpecialEducationProgramService[];
  /**
   * The major instructional setting (more than 50 percent of a student's special education program).
   */
  specialEducationSettingDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSpecialEducationProgramAssociationDisability".
 */
export interface EdFiStudentSpecialEducationProgramAssociationDisability {
  /**
   * A disability category that describes a individual's impairment.
   */
  disabilityDescriptor: string;
  /**
   * The source that provided the disability determination.
   */
  disabilityDeterminationSourceTypeDescriptor?: string;
  /**
   * A description of the disability diagnosis.
   */
  disabilityDiagnosis?: string;
  /**
   * The order by severity of individual's disabilities: 1- Primary, 2 -  Secondary, 3 - Tertiary, etc.
   */
  orderOfDisability?: number;
  /**
   * An unordered collection of studentSpecialEducationProgramAssociationDisabilityDesignations. Whether the disability is IDEA, Section 504, or other disability designation.
   */
  designations?: EdFiStudentSpecialEducationProgramAssociationDisabilityDesignation[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSpecialEducationProgramAssociationDisabilityDesignation".
 */
export interface EdFiStudentSpecialEducationProgramAssociationDisabilityDesignation {
  /**
   * Whether the disability is IDEA, Section 504, or other disability designation.
   */
  disabilityDesignationDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSpecialEducationProgramAssociationServiceProvider".
 */
export interface EdFiStudentSpecialEducationProgramAssociationServiceProvider {
  /**
   * Primary ServiceProvider.
   */
  primaryProvider?: boolean;
  staffReference: EdFiStaffReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSpecialEducationProgramAssociationSpecialEducationProgramService".
 */
export interface EdFiStudentSpecialEducationProgramAssociationSpecialEducationProgramService {
  /**
   * Indicates the service being provided to the student by the special education program.
   */
  specialEducationProgramServiceDescriptor: string;
  /**
   * True if service is a primary service.
   */
  primaryIndicator?: boolean;
  /**
   * First date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceBeginDate?: string;
  /**
   * Last date the student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceEndDate?: string;
  /**
   * An unordered collection of studentSpecialEducationProgramAssociationSpecialEducationProgramServiceProviders. The staff providing the service to the student.
   */
  providers?: EdFiStudentSpecialEducationProgramAssociationSpecialEducationProgramServiceProvider[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSpecialEducationProgramAssociationSpecialEducationProgramServiceProvider".
 */
export interface EdFiStudentSpecialEducationProgramAssociationSpecialEducationProgramServiceProvider {
  /**
   * Primary ServiceProvider.
   */
  primaryProvider?: boolean;
  staffReference: EdFiStaffReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentSpecialEducationProgramEligibilityAssociation".
 */
export interface EdFiStudentSpecialEducationProgramEligibilityAssociation {
  id?: string;
  /**
   * Indicates the date on which the local education agency received written consent for the evaluation from the student's parent or guardian. This is the first day of the evaluation timeframe.
   */
  consentToEvaluationReceivedDate: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  programReference: EdFiProgramReference;
  studentReference: EdFiStudentReference;
  /**
   * The date on which the student's parent gave a consent (Parent Consent Date).
   */
  consentToEvaluationDate?: string;
  /**
   * The month, day, and year when the eligibility conference is held between the parent(s)/guardian(s) and the educational organization responsible staff member(s) to review and make decision on special education related services eligibility.
   */
  eligibilityConferenceDate?: string;
  /**
   * The reason why the eligibility determination was completed beyond the required timeframe.
   */
  eligibilityDelayReasonDescriptor?: string;
  /**
   * Indicates the month, day, and year the local education agency (LEA) held the admission, review, and dismissal committee meeting regarding the child's eligibility determination for special education and related services. An individualized education plan (IEP) would be developed and implemented for a child admitted into special education on this same date.
   */
  eligibilityDeterminationDate?: string;
  /**
   * Indicates the month, day, and year when the written individual evaluation report was completed.
   */
  eligibilityEvaluationDate?: string;
  /**
   * Indicates if this is an initial evaluation or a reevaluation.
   */
  eligibilityEvaluationTypeDescriptor?: string;
  /**
   * Indicates the evaluation completed status.
   */
  evaluationCompleteIndicator?: boolean;
  /**
   * Indicates the number of student absences, if any, beginning the first instructional day following the date on which the local education agency (LEA) received written parental or guardian consent for the evaluation.
   */
  evaluationDelayDays?: number;
  /**
   * Refers to the justification as to why the evaluation report was completed beyond the state-established timeframe. This descriptor field will have allowed reasons as descriptor values.
   */
  evaluationDelayReasonDescriptor?: string;
  /**
   * Refers to additional information for delay in doing the evaluation.
   */
  evaluationLateReason?: string;
  /**
   * Indicates whether or not the student was determined eligible as a result of an evaluation.
   */
  ideaIndicator?: boolean;
  /**
   * Indicates if the evaluation is done under Part B IDEA or Part C IDEA.
   */
  ideaPartDescriptor: string;
  /**
   * The month, date, and year when an infant or toddler, from birth through age 2, began participating in the early childhood intervention (ECI) program.
   */
  originalECIServicesDate?: string;
  /**
   * Indicates the month, day, and year when the transition conference was held (for a child receiving early childhood intervention (ECI) services) among the lead agency, the family, and the local education agency (LEA) where the child resides to discuss the child's potential eligibility for early childhood special education (ECSE) services.
   */
  transitionConferenceDate?: string;
  /**
   * Indicates the month, day, and year the LEA Notification of Potentially Eligible for Special Education Services was sent by the early childhood intervention (ECI) contractor to the local education agency (LEA) to notify them that a child enrolled in ECI will shortly reach the age of eligibility for Part B services and the child is potentially eligible for services under Part B, early childhood special education (ECSE). The LEA Notification constitutes a referral to the LEA for an initial evaluation and eligibility determination of the child which the parent or guardian may opt out from the referral.
   */
  transitionNotificationDate?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentTitleIPartAProgramAssociation".
 */
export interface EdFiStudentTitleIPartAProgramAssociation {
  id?: string;
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  programReference: EdFiProgramReference;
  studentReference: EdFiStudentReference;
  /**
   * The month, day, and year on which the student exited the program or stopped receiving services.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * An unordered collection of generalStudentProgramAssociationProgramParticipationStatuses. The status of the student's program participation.
   */
  programParticipationStatuses?: EdFiGeneralStudentProgramAssociationProgramParticipationStatus[];
  /**
   * The reason the student left the program within a school or district.
   */
  reasonExitedDescriptor?: string;
  /**
   * Indicates whether the student received services during the summer session or between sessions.
   */
  servedOutsideOfRegularSession?: boolean;
  /**
   * An indication of the type of Title I program, if any, in which the student is participating and by which the student is served.
   */
  titleIPartAParticipantDescriptor: string;
  /**
   * An unordered collection of studentTitleIPartAProgramAssociationTitleIPartAProgramServices. Indicates the service(s) being provided to the student by the Title I Part A program.
   */
  titleIPartAProgramServices?: EdFiStudentTitleIPartAProgramAssociationTitleIPartAProgramService[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentTitleIPartAProgramAssociationTitleIPartAProgramService".
 */
export interface EdFiStudentTitleIPartAProgramAssociationTitleIPartAProgramService {
  /**
   * Indicates the service being provided to the student by the Title I Part A Program.
   */
  titleIPartAProgramServiceDescriptor: string;
  /**
   * True if service is a primary service.
   */
  primaryIndicator?: boolean;
  /**
   * First date the Student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceBeginDate?: string;
  /**
   * Last date the Student was in this option for the current school year.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  serviceEndDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentTransportation".
 */
export interface EdFiStudentTransportation {
  id?: string;
  studentReference: EdFiStudentReference;
  transportationEducationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * Specific requirements needed to accommodate a student's physical needs which may include special equipment installed in a vehicle or a special arrangement for transportation.
   */
  specialAccomodationRequirements?: string;
  studentBusDetails?: EdFiStudentTransportationStudentBusDetails;
  /**
   * The primary type of eligibility for transporting a student at public expense.
   */
  transportationPublicExpenseEligibilityTypeDescriptor?: string;
  /**
   * The mode or type of transportation utilized by a student to commute to and from school
   */
  transportationTypeDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentTransportationStudentBusDetails".
 */
export interface EdFiStudentTransportationStudentBusDetails {
  /**
   * Identifies the specific route taken by a bus for student transportation.
   */
  busRouteDescriptor: string;
  /**
   * The unique identifier assigned to the bus used for transporting the student.
   */
  busNumber: string;
  /**
   * The distance, typically measured in miles, that a student was transported along the route of the bus during a single trip.
   */
  mileage?: number;
  /**
   * An unordered collection of studentTransportationStudentBusDetailsTravelDayofWeeks. Specifies the day(s) of the week on which student transportation occurs.
   */
  travelDayofWeeks?: EdFiStudentTransportationStudentBusDetailsTravelDayofWeek[];
  /**
   * An unordered collection of studentTransportationStudentBusDetailsTravelDirections. Indicates the direction of travel for the student transportation route (e.g., to school, from school).
   */
  travelDirections?: EdFiStudentTransportationStudentBusDetailsTravelDirection[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentTransportationStudentBusDetailsTravelDayofWeek".
 */
export interface EdFiStudentTransportationStudentBusDetailsTravelDayofWeek {
  /**
   * Specifies the day(s) of the week on which student transportation occurs.
   */
  travelDayofWeekDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_studentTransportationStudentBusDetailsTravelDirection".
 */
export interface EdFiStudentTransportationStudentBusDetailsTravelDirection {
  /**
   * Indicates the direction of travel for the student transportation route (e.g., to school, from school).
   */
  travelDirectionDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_survey".
 */
export interface EdFiSurvey {
  id?: string;
  /**
   * Namespace for the survey.
   */
  namespace: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier: string;
  educationOrganizationReference?: EdFiEducationOrganizationReference;
  schoolYearTypeReference: EdFiSchoolYearTypeReference;
  sessionReference?: EdFiSessionReference;
  /**
   * Number of persons to whom this survey was administered.
   */
  numberAdministered?: number;
  /**
   * The category or type of survey.
   */
  surveyCategoryDescriptor?: string;
  /**
   * The title of the survey.
   */
  surveyTitle: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyCourseAssociation".
 */
export interface EdFiSurveyCourseAssociation {
  id?: string;
  courseReference: EdFiCourseReference;
  surveyReference: EdFiSurveyReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyReference".
 */
export interface EdFiSurveyReference {
  /**
   * Namespace for the survey.
   */
  namespace: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyProgramAssociation".
 */
export interface EdFiSurveyProgramAssociation {
  id?: string;
  programReference: EdFiProgramReference;
  surveyReference: EdFiSurveyReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyQuestion".
 */
export interface EdFiSurveyQuestion {
  id?: string;
  /**
   * The identifying code for the question, unique for the survey.
   */
  questionCode: string;
  surveyReference: EdFiSurveyReference;
  surveySectionReference?: EdFiSurveySectionReference;
  /**
   * An unordered collection of surveyQuestionMatrices. Information about the matrix element in the survey.
   */
  matrices?: EdFiSurveyQuestionMatrix[];
  /**
   * The form or type of question.
   */
  questionFormDescriptor: string;
  /**
   * The text of the question.
   */
  questionText: string;
  /**
   * An unordered collection of surveyQuestionResponseChoices. The optional list of possible responses to a survey question.
   */
  responseChoices?: EdFiSurveyQuestionResponseChoice[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveySectionReference".
 */
export interface EdFiSurveySectionReference {
  /**
   * Namespace for the survey.
   */
  namespace: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier: string;
  /**
   * The title or label for the survey section.
   */
  surveySectionTitle: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyQuestionMatrix".
 */
export interface EdFiSurveyQuestionMatrix {
  /**
   * For matrix questions, the text identifying each row of the matrix.
   */
  matrixElement: string;
  /**
   * The maximum score possible on a survey.
   */
  maxRawScore?: number;
  /**
   * The minimum score possible on a survey.
   */
  minRawScore?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyQuestionResponseChoice".
 */
export interface EdFiSurveyQuestionResponseChoice {
  /**
   * Sort order of this ResponseChoice within the complete list of choices attached to a SurveyQuestion. If sort order doesn't apply, the value of NumericValue or a unique, possibly sequential numeric value.
   */
  sortOrder: number;
  /**
   * A valid numeric response. If paired with a TextValue, the numeric equivalent of the TextValue.
   */
  numericValue?: number;
  /**
   * A valid text response. If paired with a NumericValue, the text equivalent of the NumericValue.
   */
  textValue?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyQuestionReference".
 */
export interface EdFiSurveyQuestionReference {
  /**
   * Namespace for the survey.
   */
  namespace: string;
  /**
   * The identifying code for the question, unique for the survey.
   */
  questionCode: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyQuestionResponse".
 */
export interface EdFiSurveyQuestionResponse {
  id?: string;
  surveyQuestionReference: EdFiSurveyQuestionReference;
  surveyResponseReference: EdFiSurveyResponseReference;
  /**
   * Additional information provided by the responder about the question in the survey.
   */
  comment?: string;
  /**
   * Indicates there was no response to the question.
   */
  noResponse?: boolean;
  /**
   * An unordered collection of surveyQuestionResponseSurveyQuestionMatrixElementResponses. For matrix questions, the response for each row of the matrix.
   */
  surveyQuestionMatrixElementResponses?: EdFiSurveyQuestionResponseSurveyQuestionMatrixElementResponse[];
  /**
   * An unordered collection of surveyQuestionResponseValues. For free-form, single- or multiple-selection questions, one or more responses.
   */
  values?: EdFiSurveyQuestionResponseValue[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyResponseReference".
 */
export interface EdFiSurveyResponseReference {
  /**
   * Namespace for the survey.
   */
  namespace: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier: string;
  /**
   * The identifier of the survey typically from the survey application.
   */
  surveyResponseIdentifier: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyQuestionResponseSurveyQuestionMatrixElementResponse".
 */
export interface EdFiSurveyQuestionResponseSurveyQuestionMatrixElementResponse {
  /**
   * For matrix questions, the text identifying each row of the matrix.
   */
  matrixElement: string;
  /**
   * The maximum score response to the question.
   */
  maxNumericResponse?: number;
  /**
   * The minimum score response to the question.
   */
  minNumericResponse?: number;
  /**
   * Indicates there was no response to the question.
   */
  noResponse?: boolean;
  /**
   * The numeric response to the question.
   */
  numericResponse?: number;
  /**
   * The text response(s) for the question.
   */
  textResponse?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyQuestionResponseValue".
 */
export interface EdFiSurveyQuestionResponseValue {
  /**
   * Primary key for the response value; a unique, usually sequential numeric value for a collection of responses, or potentially the value of NumericResponse for a single response.
   */
  surveyQuestionResponseValueIdentifier: number;
  /**
   * A numeric response to the question.
   */
  numericResponse?: number;
  /**
   * A text response to the question.
   */
  textResponse?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyResponse".
 */
export interface EdFiSurveyResponse {
  id?: string;
  /**
   * The identifier of the survey typically from the survey application.
   */
  surveyResponseIdentifier: string;
  contactReference?: EdFiContactReference;
  staffReference?: EdFiStaffReference;
  studentReference?: EdFiStudentReference;
  surveyReference: EdFiSurveyReference;
  /**
   * Email address of the respondent.
   */
  electronicMailAddress?: string;
  /**
   * Full name of the respondent.
   */
  fullName?: string;
  /**
   * Location of the respondent, often a city, district, or school.
   */
  location?: string;
  /**
   * Date of the survey response.
   */
  responseDate: string;
  /**
   * The amount of time in seconds it took for the respondent to complete the survey.
   */
  responseTime?: number;
  /**
   * An unordered collection of surveyResponseSurveyLevels. Provides information about the respondents of a survey and how they can be grouped together.
   */
  surveyLevels?: EdFiSurveyResponseSurveyLevel[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  _ext?: SurveyResponseExtensions;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyResponseSurveyLevel".
 */
export interface EdFiSurveyResponseSurveyLevel {
  /**
   * Provides information about the respondents of a survey and how they can be grouped together.
   */
  surveyLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "surveyResponseExtensions".
 */
export interface SurveyResponseExtensions {
  tpdm?: TpdmSurveyResponseExtension;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_surveyResponseExtension".
 */
export interface TpdmSurveyResponseExtension {
  personReference?: EdFiPersonReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyResponseEducationOrganizationTargetAssociation".
 */
export interface EdFiSurveyResponseEducationOrganizationTargetAssociation {
  id?: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  surveyResponseReference: EdFiSurveyResponseReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveyResponseStaffTargetAssociation".
 */
export interface EdFiSurveyResponseStaffTargetAssociation {
  id?: string;
  staffReference: EdFiStaffReference;
  surveyResponseReference: EdFiSurveyResponseReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveySection".
 */
export interface EdFiSurveySection {
  id?: string;
  /**
   * The title or label for the survey section.
   */
  surveySectionTitle: string;
  surveyReference: EdFiSurveyReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveySectionAssociation".
 */
export interface EdFiSurveySectionAssociation {
  id?: string;
  sectionReference: EdFiSectionReference;
  surveyReference: EdFiSurveyReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveySectionResponse".
 */
export interface EdFiSurveySectionResponse {
  id?: string;
  surveyResponseReference: EdFiSurveyResponseReference;
  surveySectionReference: EdFiSurveySectionReference;
  /**
   * Numeric rating computed from the survey responses for the section.
   */
  sectionRating?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveySectionResponseEducationOrganizationTargetAssociation".
 */
export interface EdFiSurveySectionResponseEducationOrganizationTargetAssociation {
  id?: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  surveySectionResponseReference: EdFiSurveySectionResponseReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveySectionResponseReference".
 */
export interface EdFiSurveySectionResponseReference {
  /**
   * Namespace for the survey.
   */
  namespace: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier: string;
  /**
   * The identifier of the survey typically from the survey application.
   */
  surveyResponseIdentifier: string;
  /**
   * The title or label for the survey section.
   */
  surveySectionTitle: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "edFi_surveySectionResponseStaffTargetAssociation".
 */
export interface EdFiSurveySectionResponseStaffTargetAssociation {
  id?: string;
  staffReference: EdFiStaffReference;
  surveySectionResponseReference: EdFiSurveySectionResponseReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidate".
 */
export interface TpdmCandidate {
  id?: string;
  /**
   * A unique alphanumeric code assigned to a candidate.
   */
  candidateIdentifier: string;
  personReference?: EdFiPersonReference;
  /**
   * An unordered collection of candidateAddresses. The set of elements that describes an address, including the street address, city, state, and ZIP code.
   */
  addresses?: TpdmCandidateAddress[];
  /**
   * The city the student was born in.
   */
  birthCity?: string;
  /**
   * The country in which an individual is born. It is strongly recommended that entries use only ISO 3166 2-letter country codes.
   */
  birthCountryDescriptor?: string;
  /**
   * The month, day, and year on which an individual was born.
   */
  birthDate: string;
  /**
   * For students born outside of the U.S., the Province or jurisdiction in which an individual is born.
   */
  birthInternationalProvince?: string;
  /**
   * A person's sex at birth.
   */
  birthSexDescriptor?: string;
  /**
   * The abbreviation for the name of the state (within the United States) or extra-state jurisdiction in which an individual was born.
   */
  birthStateAbbreviationDescriptor?: string;
  /**
   * For students born outside of the U.S., the date the student entered the U.S.
   */
  dateEnteredUS?: string;
  /**
   * An unordered collection of candidateDisabilities. The disability condition(s) that best describes an individual's impairment.
   */
  disabilities?: TpdmCandidateDisability[];
  /**
   * Indicates a state health or weather related event that displaces a group of students, and may require additional funding, educational, or social services.
   */
  displacementStatus?: string;
  /**
   * An indication of inadequate financial condition of an individual's family, as determined by family income, number of family members/dependents, participation in public assistance programs, and/or other characteristics considered relevant by federal, state, and local policy.
   */
  economicDisadvantaged?: boolean;
  /**
   * An unordered collection of candidateElectronicMails. The numbers, letters, and symbols used to identify an electronic mail (e-mail) user within the network to which the individual or organization belongs.
   */
  electronicMails?: TpdmCandidateElectronicMail[];
  /**
   * Indicates that a person passed, failed, or did not take an English Language assessment (e.g., TOEFFL).
   */
  englishLanguageExamDescriptor?: string;
  /**
   * Indicator of whether individual is a first generation college student.
   */
  firstGenerationStudent?: boolean;
  /**
   * A name given to an individual at birth, baptism, or during another naming ceremony, or through legal change.
   */
  firstName: string;
  /**
   * The gender of the candidate.
   */
  genderDescriptor?: string;
  /**
   * An appendage, if any, used to denote an individual's generation in his family (e.g., Jr., Sr., III).
   */
  generationCodeSuffix?: string;
  /**
   * An indication that the individual traces his or her origin or descent to Mexico, Puerto Rico, Cuba, Central, and South America, and other Spanish cultures, regardless of race. The term, "Spanish origin," can be used in addition to "Hispanic or Latino."
   */
  hispanicLatinoEthnicity?: boolean;
  /**
   * An unordered collection of candidateLanguages. The language(s) the individual uses to communicate.
   */
  languages?: TpdmCandidateLanguage[];
  /**
   * The name borne in common by members of a family.
   */
  lastSurname: string;
  /**
   * An indication that the student has been identified as limited English proficient by the Language Proficiency Assessment Committee (LPAC), or English proficient.
   */
  limitedEnglishProficiencyDescriptor?: string;
  /**
   * The individual's maiden name.
   */
  maidenName?: string;
  /**
   * A secondary name given to an individual at birth, baptism, or during another naming ceremony.
   */
  middleName?: string;
  /**
   * Indicator of whether the student was born with other siblings (i.e., twins, triplets, etc.)
   */
  multipleBirthStatus?: boolean;
  /**
   * An unordered collection of candidateOtherNames. Other names (e.g., alias, nickname, previous legal name) associated with a person.
   */
  otherNames?: TpdmCandidateOtherName[];
  /**
   * An unordered collection of candidatePersonalIdentificationDocuments. The documents presented as evident to verify one's personal identity; for example: drivers license, passport, birth certificate, etc.
   */
  personalIdentificationDocuments?: TpdmCandidatePersonalIdentificationDocument[];
  /**
   * A prefix used to denote the title, degree, position, or seniority of the individual.
   */
  personalTitlePrefix?: string;
  /**
   * The first name the individual prefers, if different from their legal first name
   */
  preferredFirstName?: string;
  /**
   * The last name the individual prefers, if different from their legal last name
   */
  preferredLastSurname?: string;
  /**
   * An unordered collection of candidateRaces. The general racial category which most clearly reflects the individual's recognition of his or her community or with which the individual most identifies. The data model allows for multiple entries so that each individual can specify all appropriate races.
   */
  races?: TpdmCandidateRace[];
  /**
   * The sex of the candidate.
   */
  sexDescriptor?: string;
  /**
   * An unordered collection of candidateTelephones. The 10-digit telephone number, including the area code, for the person.
   */
  telephones?: TpdmCandidateTelephone[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateAddress".
 */
export interface TpdmCandidateAddress {
  /**
   * The type of address listed for an individual or organization.    For example:  Physical Address, Mailing Address, Home Address, etc.)
   */
  addressTypeDescriptor: string;
  /**
   * The abbreviation for the state (within the United States) or outlying area in which an address is located.
   */
  stateAbbreviationDescriptor: string;
  /**
   * The name of the city in which an address is located.
   */
  city: string;
  /**
   * The five or nine digit zip code or overseas postal code portion of an address.
   */
  postalCode: string;
  /**
   * The street number and street name or post office box number of an address.
   */
  streetNumberName: string;
  /**
   * A general geographic indicator that categorizes U.S. territory (e.g., City, Suburban).
   */
  localeDescriptor?: string;
  /**
   * The apartment, room, or suite number of an address.
   */
  apartmentRoomSuiteNumber?: string;
  /**
   * The number of the building on the site, if more than one building shares the same address.
   */
  buildingSiteNumber?: string;
  /**
   * The congressional district in which an address is located.
   */
  congressionalDistrict?: string;
  /**
   * The Federal Information Processing Standards (FIPS) numeric code for the county issued by the National Institute of Standards and Technology (NIST). Counties are considered to be the "first-order subdivisions" of each State and statistically equivalent entity, regardless of their local designations (county, parish, borough, etc.) Counties in different States will have the same code. A unique county number is created when combined with the 2-digit FIPS State Code.
   */
  countyFIPSCode?: string;
  /**
   * An indication that the address should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * The geographic latitude of the physical address.
   */
  latitude?: string;
  /**
   * The geographic longitude of the physical address.
   */
  longitude?: string;
  /**
   * The name of the county, parish, borough, or comparable unit (within a state) in which an address is located.
   */
  nameOfCounty?: string;
  /**
   * An unordered collection of candidateAddressPeriods. The time periods for which the address is valid. For physical addresses, the periods in which the person lived at that address.
   */
  periods?: TpdmCandidateAddressPeriod[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateAddressPeriod".
 */
export interface TpdmCandidateAddressPeriod {
  /**
   * The month, day, and year for the start of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  /**
   * The month, day, and year for the end of the period.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateDisability".
 */
export interface TpdmCandidateDisability {
  /**
   * A disability category that describes a individual's impairment.
   */
  disabilityDescriptor: string;
  /**
   * The source that provided the disability determination.
   */
  disabilityDeterminationSourceTypeDescriptor?: string;
  /**
   * A description of the disability diagnosis.
   */
  disabilityDiagnosis?: string;
  /**
   * The order by severity of individual's disabilities: 1- Primary, 2 -  Secondary, 3 - Tertiary, etc.
   */
  orderOfDisability?: number;
  /**
   * An unordered collection of candidateDisabilityDesignations. Whether the disability is IDEA, Section 504, or other disability designation.
   */
  designations?: TpdmCandidateDisabilityDesignation[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateDisabilityDesignation".
 */
export interface TpdmCandidateDisabilityDesignation {
  /**
   * Whether the disability is IDEA, Section 504, or other disability designation.
   */
  disabilityDesignationDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateElectronicMail".
 */
export interface TpdmCandidateElectronicMail {
  /**
   * The type of email listed for an individual or organization. For example: Home/Personal, Work, etc.)
   */
  electronicMailTypeDescriptor: string;
  /**
   * The electronic mail (e-mail) address listed for an individual or organization.
   */
  electronicMailAddress: string;
  /**
   * An indication that the electronic email address should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * An indication that the electronic mail address should be used as the principal electronic mail address for an individual or organization.
   */
  primaryEmailAddressIndicator?: boolean;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateLanguage".
 */
export interface TpdmCandidateLanguage {
  /**
   * A specification of which written or spoken communication is being used.
   */
  languageDescriptor: string;
  /**
   * An unordered collection of candidateLanguageUses. A description of how the language is used (e.g. Home Language, Native Language, Spoken Language).
   */
  uses?: TpdmCandidateLanguageUse[];
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateLanguageUse".
 */
export interface TpdmCandidateLanguageUse {
  /**
   * A description of how the language is used (e.g. Home Language, Native Language, Spoken Language).
   */
  languageUseDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateOtherName".
 */
export interface TpdmCandidateOtherName {
  /**
   * The types of alternate names for an individual.
   */
  otherNameTypeDescriptor: string;
  /**
   * A name given to an individual at birth, baptism, or during another naming ceremony, or through legal change.
   */
  firstName: string;
  /**
   * An appendage, if any, used to denote an individual's generation in his family (e.g., Jr., Sr., III).
   */
  generationCodeSuffix?: string;
  /**
   * The name borne in common by members of a family.
   */
  lastSurname: string;
  /**
   * A secondary name given to an individual at birth, baptism, or during another naming ceremony.
   */
  middleName?: string;
  /**
   * A prefix used to denote the title, degree, position, or seniority of the individual.
   */
  personalTitlePrefix?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidatePersonalIdentificationDocument".
 */
export interface TpdmCandidatePersonalIdentificationDocument {
  /**
   * The primary function of the document used for establishing identity.
   */
  identificationDocumentUseDescriptor: string;
  /**
   * The category of the document relative to its purpose.
   */
  personalInformationVerificationDescriptor: string;
  /**
   * Country of origin of the document. It is strongly recommended that entries use only ISO 3166 2-letter country codes.
   */
  issuerCountryDescriptor?: string;
  /**
   * The day when the document  expires, if null then never expires.
   */
  documentExpirationDate?: string;
  /**
   * The title of the document given by the issuer.
   */
  documentTitle?: string;
  /**
   * The unique identifier on the issuer's identification system.
   */
  issuerDocumentIdentificationCode?: string;
  /**
   * Name of the entity or institution that issued the document.
   */
  issuerName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateRace".
 */
export interface TpdmCandidateRace {
  /**
   * The general racial category which most clearly reflects the individual's recognition of his or her community or with which the individual most identifies. The data model allows for multiple entries so that each individual can specify all appropriate races.
   */
  raceDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateTelephone".
 */
export interface TpdmCandidateTelephone {
  /**
   * The type of communication number listed for an individual or organization.
   */
  telephoneNumberTypeDescriptor: string;
  /**
   * The telephone number including the area code, and extension, if applicable.
   */
  telephoneNumber: string;
  /**
   * An indication that the telephone number should not be published.
   */
  doNotPublishIndicator?: boolean;
  /**
   * The order of priority assigned to telephone numbers to define which number to attempt first, second, etc.
   */
  orderOfPriority?: number;
  /**
   * An indication that the telephone number is technically capable of sending and receiving Short Message Service (SMS) text messages.
   */
  textMessageCapabilityIndicator?: boolean;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateEducatorPreparationProgramAssociation".
 */
export interface TpdmCandidateEducatorPreparationProgramAssociation {
  id?: string;
  /**
   * The begin date for the association.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  candidateReference: TpdmCandidateReference;
  educatorPreparationProgramReference: TpdmEducatorPreparationProgramReference;
  /**
   * An unordered collection of candidateEducatorPreparationProgramAssociationCohortYears. The type and year of a cohort the student belongs to as determined by the year that student entered a specific grade.
   */
  cohortYears?: TpdmCandidateEducatorPreparationProgramAssociationCohortYear[];
  /**
   * An unordered collection of candidateEducatorPreparationProgramAssociationDegreeSpecializations. Information around the area(s) of specialization for an individual.
   */
  degreeSpecializations?: TpdmCandidateEducatorPreparationProgramAssociationDegreeSpecialization[];
  /**
   * The end date for the association.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * The program pathway the candidate is following; for example: Residency, Internship, Traditional
   */
  eppProgramPathwayDescriptor?: string;
  /**
   * Reason exited for the association.
   */
  reasonExitedDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateReference".
 */
export interface TpdmCandidateReference {
  /**
   * A unique alphanumeric code assigned to a candidate.
   */
  candidateIdentifier: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_educatorPreparationProgramReference".
 */
export interface TpdmEducatorPreparationProgramReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The name of the Educator Preparation Program.
   */
  programName: string;
  /**
   * The type of program.
   */
  programTypeDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateEducatorPreparationProgramAssociationCohortYear".
 */
export interface TpdmCandidateEducatorPreparationProgramAssociationCohortYear {
  /**
   * The type of cohort year (9th grade, graduation).
   */
  cohortYearTypeDescriptor: string;
  /**
   * The term associated with the cohort year; for example, the intended term of graduation.
   */
  termDescriptor?: string;
  schoolYearTypeReference: EdFiSchoolYearTypeReference;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_candidateEducatorPreparationProgramAssociationDegreeSpecialization".
 */
export interface TpdmCandidateEducatorPreparationProgramAssociationDegreeSpecialization {
  /**
   * The major area for a degree or area of specialization for a certificate.
   */
  majorSpecialization: string;
  /**
   * The month, day, and year on which the Teacher Candidate exited the declared specialization.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * The minor area for a degree or area of specialization for a certificate.
   */
  minorSpecialization?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_educatorPreparationProgram".
 */
export interface TpdmEducatorPreparationProgram {
  id?: string;
  /**
   * The name of the Educator Preparation Program.
   */
  programName: string;
  /**
   * The type of program.
   */
  programTypeDescriptor: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  /**
   * The current accreditation status of the Educator Preparation Program.
   */
  accreditationStatusDescriptor?: string;
  /**
   * An unordered collection of educatorPreparationProgramGradeLevels. The grade levels served at the EPP Program.
   */
  gradeLevels?: TpdmEducatorPreparationProgramGradeLevel[];
  /**
   * A unique number or alphanumeric code assigned to a program by a school, school system, a state, or other agency or entity.
   */
  programId?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_educatorPreparationProgramGradeLevel".
 */
export interface TpdmEducatorPreparationProgramGradeLevel {
  /**
   * The grade levels served at the EPP Program.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluation".
 */
export interface TpdmEvaluation {
  id?: string;
  /**
   * The name or title of the evaluation.
   */
  evaluationTitle: string;
  performanceEvaluationReference: TpdmPerformanceEvaluationReference;
  /**
   * The long description of the Evaluation.
   */
  evaluationDescription?: string;
  /**
   * The type of the evaluation (e.g., observation, principal, peer, student survey, student growth).
   */
  evaluationTypeDescriptor?: string;
  /**
   * A score indicating how much homogeneity, or consensus, there is in the ratings given by judges. Most commonly a percentage scale (1-100)
   */
  interRaterReliabilityScore?: number;
  /**
   * The maximum summary numerical rating or score for the evaluation.
   */
  maxRating?: number;
  /**
   * The minimum summary numerical rating or score for the evaluation. If omitted, assumed to be 0.0.
   */
  minRating?: number;
  /**
   * An unordered collection of evaluationRatingLevels. The descriptive level(s) of ratings (cut scores) for the evaluation.
   */
  ratingLevels?: TpdmEvaluationRatingLevel[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_performanceEvaluationReference".
 */
export interface TpdmPerformanceEvaluationReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor: string;
  /**
   * The identifier for the school year.
   */
  schoolYear: number;
  /**
   * The term for the session during the school year.
   */
  termDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationRatingLevel".
 */
export interface TpdmEvaluationRatingLevel {
  /**
   * The title for a level of rating or evaluation band (e.g., Excellent, Acceptable, Needs Improvement, Unacceptable).
   */
  evaluationRatingLevelDescriptor: string;
  /**
   * The maximum numerical rating or score to achieve the evaluation rating level.
   */
  maxRating?: number;
  /**
   * The minimum numerical rating or score to achieve the evaluation rating level.
   */
  minRating?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationElement".
 */
export interface TpdmEvaluationElement {
  id?: string;
  /**
   * The name or title of the evaluation element.
   */
  evaluationElementTitle: string;
  evaluationObjectiveReference: TpdmEvaluationObjectiveReference;
  /**
   * The type of the evaluation (e.g., observation, principal, peer, student survey, student growth).
   */
  evaluationTypeDescriptor?: string;
  /**
   * The maximum summary numerical rating or score for the evaluation element.
   */
  maxRating?: number;
  /**
   * The minimum summary numerical rating or score for the evaluation element. If omitted, assumed to be 0.0.
   */
  minRating?: number;
  /**
   * An unordered collection of evaluationElementRatingLevels. The descriptive level(s) of ratings (cut scores) for evaluation element.
   */
  ratingLevels?: TpdmEvaluationElementRatingLevel[];
  /**
   * The sort order of this Evaluation Element.
   */
  sortOrder?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationObjectiveReference".
 */
export interface TpdmEvaluationObjectiveReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The name or title of the evaluation Objective.
   */
  evaluationObjectiveTitle: string;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor: string;
  /**
   * The name or title of the evaluation.
   */
  evaluationTitle: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor: string;
  /**
   * The identifier for the school year.
   */
  schoolYear: number;
  /**
   * The term for the session during the school year.
   */
  termDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationElementRatingLevel".
 */
export interface TpdmEvaluationElementRatingLevel {
  /**
   * The title for a level of rating or evaluation band (e.g., Excellent, Acceptable, Needs Improvement, Unacceptable).
   */
  evaluationRatingLevelDescriptor: string;
  /**
   * The maximum numerical rating or score to achieve the evaluation rating level.
   */
  maxRating?: number;
  /**
   * The minimum numerical rating or score to achieve the evaluation rating level.
   */
  minRating?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationElementRating".
 */
export interface TpdmEvaluationElementRating {
  id?: string;
  evaluationElementReference: TpdmEvaluationElementReference;
  evaluationObjectiveRatingReference: TpdmEvaluationObjectiveRatingReference;
  /**
   * Area identified for person to refine or improve as part of the evaluation.
   */
  areaOfRefinement?: string;
  /**
   * Area identified for reinforcement or positive feedback as part of the evaluation.
   */
  areaOfReinforcement?: string;
  /**
   * Any comments about the performance evaluation to be captured.
   */
  comments?: string;
  /**
   * The rating level achieved based upon the rating or score.
   */
  evaluationElementRatingLevelDescriptor?: string;
  /**
   * Feedback provided to the evaluated person.
   */
  feedback?: string;
  /**
   * An unordered collection of evaluationElementRatingResults. The numerical summary rating or score for the evaluation element.
   */
  results?: TpdmEvaluationElementRatingResult[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationElementReference".
 */
export interface TpdmEvaluationElementReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The name or title of the evaluation element.
   */
  evaluationElementTitle: string;
  /**
   * The name or title of the evaluation Objective.
   */
  evaluationObjectiveTitle: string;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor: string;
  /**
   * The name or title of the evaluation.
   */
  evaluationTitle: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor: string;
  /**
   * The identifier for the school year.
   */
  schoolYear: number;
  /**
   * The term for the session during the school year.
   */
  termDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationObjectiveRatingReference".
 */
export interface TpdmEvaluationObjectiveRatingReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The date for the person's evaluation.
   */
  evaluationDate: string;
  /**
   * The name or title of the evaluation Objective.
   */
  evaluationObjectiveTitle: string;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor: string;
  /**
   * The name or title of the evaluation.
   */
  evaluationTitle: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor: string;
  /**
   * A unique alphanumeric code assigned to a person.
   */
  personId: string;
  /**
   * The identifier for the school year.
   */
  schoolYear: number;
  /**
   * This descriptor defines the originating record source system for the person.
   */
  sourceSystemDescriptor: string;
  /**
   * The term for the session during the school year.
   */
  termDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationElementRatingResult".
 */
export interface TpdmEvaluationElementRatingResult {
  /**
   * The numerical summary rating or score for the evaluation.
   */
  rating: number;
  /**
   * The title of Rating Result.
   */
  ratingResultTitle: string;
  /**
   * The datatype of the result.
   */
  resultDatatypeTypeDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationObjective".
 */
export interface TpdmEvaluationObjective {
  id?: string;
  /**
   * The name or title of the evaluation Objective.
   */
  evaluationObjectiveTitle: string;
  evaluationReference: TpdmEvaluationReference;
  /**
   * The long description of the Evaluation Objective.
   */
  evaluationObjectiveDescription?: string;
  /**
   * The type of the evaluation Objective (e.g., observation, principal, peer, student survey, student growth).
   */
  evaluationTypeDescriptor?: string;
  /**
   * The maximum summary numerical rating or score for the evaluation Objective.
   */
  maxRating?: number;
  /**
   * The minimum summary numerical rating or score for the evaluation Objective. If omitted, assumed to be 0.0.
   */
  minRating?: number;
  /**
   * An unordered collection of evaluationObjectiveRatingLevels. The descriptive level(s) of ratings (cut scores) for evaluation Objective.
   */
  ratingLevels?: TpdmEvaluationObjectiveRatingLevel[];
  /**
   * The sort order of this Evaluation Objective.
   */
  sortOrder?: number;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationReference".
 */
export interface TpdmEvaluationReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor: string;
  /**
   * The name or title of the evaluation.
   */
  evaluationTitle: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor: string;
  /**
   * The identifier for the school year.
   */
  schoolYear: number;
  /**
   * The term for the session during the school year.
   */
  termDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationObjectiveRatingLevel".
 */
export interface TpdmEvaluationObjectiveRatingLevel {
  /**
   * The title for a level of rating or evaluation band (e.g., Excellent, Acceptable, Needs Improvement, Unacceptable).
   */
  evaluationRatingLevelDescriptor: string;
  /**
   * The maximum numerical rating or score to achieve the evaluation rating level.
   */
  maxRating?: number;
  /**
   * The minimum numerical rating or score to achieve the evaluation rating level.
   */
  minRating?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationObjectiveRating".
 */
export interface TpdmEvaluationObjectiveRating {
  id?: string;
  evaluationObjectiveReference: TpdmEvaluationObjectiveReference;
  evaluationRatingReference: TpdmEvaluationRatingReference;
  /**
   * Any comments about the performance evaluation to be captured.
   */
  comments?: string;
  /**
   * The rating level achieved based upon the rating or score.
   */
  objectiveRatingLevelDescriptor?: string;
  /**
   * An unordered collection of evaluationObjectiveRatingResults. The numerical summary rating or score for the evaluation Objective.
   */
  results?: TpdmEvaluationObjectiveRatingResult[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationRatingReference".
 */
export interface TpdmEvaluationRatingReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The date for the person's evaluation.
   */
  evaluationDate: string;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor: string;
  /**
   * The name or title of the evaluation.
   */
  evaluationTitle: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor: string;
  /**
   * A unique alphanumeric code assigned to a person.
   */
  personId: string;
  /**
   * The identifier for the school year.
   */
  schoolYear: number;
  /**
   * This descriptor defines the originating record source system for the person.
   */
  sourceSystemDescriptor: string;
  /**
   * The term for the session during the school year.
   */
  termDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationObjectiveRatingResult".
 */
export interface TpdmEvaluationObjectiveRatingResult {
  /**
   * The numerical summary rating or score for the evaluation.
   */
  rating: number;
  /**
   * The title of Rating Result.
   */
  ratingResultTitle: string;
  /**
   * The datatype of the result.
   */
  resultDatatypeTypeDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationRating".
 */
export interface TpdmEvaluationRating {
  id?: string;
  /**
   * The date for the person's evaluation.
   */
  evaluationDate: string;
  evaluationReference: TpdmEvaluationReference;
  performanceEvaluationRatingReference: TpdmPerformanceEvaluationRatingReference;
  sectionReference?: EdFiSectionReference;
  /**
   * The actual or estimated number of clock minutes during which the evaluation was conducted.
   */
  actualDuration?: number;
  /**
   * Any comments about the evaluation to be captured.
   */
  comments?: string;
  /**
   * The rating level achieved based upon the rating or score.
   */
  evaluationRatingLevelDescriptor?: string;
  /**
   * The Status of the poerformance evaluation.
   */
  evaluationRatingStatusDescriptor?: string;
  /**
   * An unordered collection of evaluationRatingResults. The numerical summary rating or score for the evaluation.
   */
  results?: TpdmEvaluationRatingResult[];
  /**
   * An unordered collection of evaluationRatingReviewers. The person(s) that conducted the performance evaluation.
   */
  reviewers?: TpdmEvaluationRatingReviewer[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_performanceEvaluationRatingReference".
 */
export interface TpdmPerformanceEvaluationRatingReference {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId: number;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor: string;
  /**
   * A unique alphanumeric code assigned to a person.
   */
  personId: string;
  /**
   * The identifier for the school year.
   */
  schoolYear: number;
  /**
   * This descriptor defines the originating record source system for the person.
   */
  sourceSystemDescriptor: string;
  /**
   * The term for the session during the school year.
   */
  termDescriptor: string;
  link?: Link;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationRatingResult".
 */
export interface TpdmEvaluationRatingResult {
  /**
   * The numerical summary rating or score for the evaluation.
   */
  rating: number;
  /**
   * The title of Rating Result.
   */
  ratingResultTitle: string;
  /**
   * The datatype of the result.
   */
  resultDatatypeTypeDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationRatingReviewer".
 */
export interface TpdmEvaluationRatingReviewer {
  /**
   * A name given to an individual at birth, baptism, or during another naming ceremony, or through legal change.
   */
  firstName: string;
  /**
   * The name borne in common by members of a family.
   */
  lastSurname: string;
  reviewerPersonReference?: EdFiPersonReference;
  receivedTraining?: TpdmEvaluationRatingReviewerReceivedTraining;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_evaluationRatingReviewerReceivedTraining".
 */
export interface TpdmEvaluationRatingReviewerReceivedTraining {
  /**
   * A score indicating how much homogeneity, or consensus, there is in the ratings given by judges. Most commonly a percentage scale (1-100)
   */
  interRaterReliabilityScore?: number;
  /**
   * The date on which the person administering the performance meausre received training on how to conduct performance measures.
   */
  receivedTrainingDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_financialAid".
 */
export interface TpdmFinancialAid {
  id?: string;
  /**
   * The classification of financial aid awarded to a person for the academic term/year.
   */
  aidTypeDescriptor: string;
  /**
   * The date the award was designated.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate: string;
  studentReference: EdFiStudentReference;
  /**
   * The amount of financial aid awarded to a person for the term/year.
   */
  aidAmount?: number;
  /**
   * The description of the condition (e.g., placement in a high need school) under which the aid was given.
   */
  aidConditionDescription?: string;
  /**
   * The date the award was removed.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  endDate?: string;
  /**
   * Indicates a person who receives Pell Grant aid.
   */
  pellGrantRecipient?: boolean;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_performanceEvaluation".
 */
export interface TpdmPerformanceEvaluation {
  id?: string;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor: string;
  /**
   * The term for the session during the school year.
   */
  termDescriptor: string;
  educationOrganizationReference: EdFiEducationOrganizationReference;
  schoolYearTypeReference: EdFiSchoolYearTypeReference;
  /**
   * The description of the content or subject area of a performance evaluation.
   */
  academicSubjectDescriptor?: string;
  /**
   * An unordered collection of performanceEvaluationGradeLevels. The grade levels involved with the performance evaluation.
   */
  gradeLevels?: TpdmPerformanceEvaluationGradeLevel[];
  /**
   * The long description of the Performance Evaluation.
   */
  performanceEvaluationDescription?: string;
  /**
   * An unordered collection of performanceEvaluationRatingLevels. The descriptive level(s) of ratings (cut scores) for the evaluation.
   */
  ratingLevels?: TpdmPerformanceEvaluationRatingLevel[];
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_performanceEvaluationGradeLevel".
 */
export interface TpdmPerformanceEvaluationGradeLevel {
  /**
   * The grade levels involved with the performance evaluation.
   */
  gradeLevelDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_performanceEvaluationRatingLevel".
 */
export interface TpdmPerformanceEvaluationRatingLevel {
  /**
   * The title for a level of rating or evaluation band (e.g., Excellent, Acceptable, Needs Improvement, Unacceptable).
   */
  evaluationRatingLevelDescriptor: string;
  /**
   * The maximum numerical rating or score to achieve the evaluation rating level.
   */
  maxRating?: number;
  /**
   * The minimum numerical rating or score to achieve the evaluation rating level.
   */
  minRating?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_performanceEvaluationRating".
 */
export interface TpdmPerformanceEvaluationRating {
  id?: string;
  performanceEvaluationReference: TpdmPerformanceEvaluationReference;
  personReference: EdFiPersonReference;
  /**
   * The month, day, and year on which the performance evaluation was conducted.
   */
  actualDate: string;
  /**
   * The actual or estimated number of clock minutes during which the performance evaluation was conducted.
   */
  actualDuration?: number;
  /**
   * An indication of the the time at which the performance evaluation was conducted.
   */
  actualTime?: string;
  /**
   * An indicator of whether the performance evaluation was announced or not.
   */
  announced?: boolean;
  /**
   * Any comments about the performance evaluation to be captured.
   */
  comments?: string;
  /**
   * A type of co-teaching observed as part of the performance evaluation.
   */
  coteachingStyleObservedDescriptor?: string;
  /**
   * The rating level achieved based upon the rating or score.
   */
  performanceEvaluationRatingLevelDescriptor?: string;
  /**
   * An unordered collection of performanceEvaluationRatingResults. The numerical summary rating or score for the performance evaluation.
   */
  results?: TpdmPerformanceEvaluationRatingResult[];
  /**
   * An unordered collection of performanceEvaluationRatingReviewers. The person(s) that conducted the performance evaluation.
   */
  reviewers?: TpdmPerformanceEvaluationRatingReviewer[];
  /**
   * The month, day, and year on which the performance evaluation was scheduled.
   */
  scheduleDate?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_performanceEvaluationRatingResult".
 */
export interface TpdmPerformanceEvaluationRatingResult {
  /**
   * The numerical summary rating or score for the evaluation.
   */
  rating: number;
  /**
   * The title of Rating Result.
   */
  ratingResultTitle: string;
  /**
   * The datatype of the result.
   */
  resultDatatypeTypeDescriptor: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_performanceEvaluationRatingReviewer".
 */
export interface TpdmPerformanceEvaluationRatingReviewer {
  /**
   * A name given to an individual at birth, baptism, or during another naming ceremony, or through legal change.
   */
  firstName: string;
  /**
   * The name borne in common by members of a family.
   */
  lastSurname: string;
  reviewerPersonReference?: EdFiPersonReference;
  receivedTraining?: TpdmPerformanceEvaluationRatingReviewerReceivedTraining;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_performanceEvaluationRatingReviewerReceivedTraining".
 */
export interface TpdmPerformanceEvaluationRatingReviewerReceivedTraining {
  /**
   * A score indicating how much homogeneity, or consensus, there is in the ratings given by judges. Most commonly a percentage scale (1-100)
   */
  interRaterReliabilityScore?: number;
  /**
   * The date on which the person administering the performance meausre received training on how to conduct performance measures.
   */
  receivedTrainingDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_rubricDimension".
 */
export interface TpdmRubricDimension {
  id?: string;
  /**
   * The rating achieved for the rubric dimension.
   */
  rubricRating: number;
  evaluationElementReference: TpdmEvaluationElementReference;
  /**
   * The criterion description for the rubric dimension.
   */
  criterionDescription: string;
  /**
   * The order for the rubric dimension.
   */
  dimensionOrder?: number;
  /**
   * The rating level achieved for the rubric dimension.
   */
  rubricRatingLevelDescriptor?: string;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_surveyResponsePersonTargetAssociation".
 */
export interface TpdmSurveyResponsePersonTargetAssociation {
  id?: string;
  personReference: EdFiPersonReference;
  surveyResponseReference: EdFiSurveyResponseReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "tpdm_surveySectionResponsePersonTargetAssociation".
 */
export interface TpdmSurveySectionResponsePersonTargetAssociation {
  id?: string;
  personReference: EdFiPersonReference;
  surveySectionResponseReference: EdFiSurveySectionResponseReference;
  /**
   * A unique system-generated value that identifies the version of the resource.
   */
  _etag?: string;
  /**
   * The date and time the resource was last modified.
   */
  _lastModifiedDate?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_academicWeekDelete".
 */
export interface TrackedChangesEdFiAcademicWeekDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiAcademicWeekKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_academicWeekKey".
 */
export interface TrackedChangesEdFiAcademicWeekKey {
  /**
   * The school label for the week.
   */
  weekIdentifier?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_academicWeekKeyChange".
 */
export interface TrackedChangesEdFiAcademicWeekKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiAcademicWeekKey;
  newKeyValues?: TrackedChangesEdFiAcademicWeekKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_accountabilityRatingDelete".
 */
export interface TrackedChangesEdFiAccountabilityRatingDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiAccountabilityRatingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_accountabilityRatingKey".
 */
export interface TrackedChangesEdFiAccountabilityRatingKey {
  /**
   * The title of the rating.
   */
  ratingTitle?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The school year for which the accountability rating is assessed.
   */
  schoolYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_accountabilityRatingKeyChange".
 */
export interface TrackedChangesEdFiAccountabilityRatingKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiAccountabilityRatingKey;
  newKeyValues?: TrackedChangesEdFiAccountabilityRatingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentAdministrationDelete".
 */
export interface TrackedChangesEdFiAssessmentAdministrationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiAssessmentAdministrationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentAdministrationKey".
 */
export interface TrackedChangesEdFiAssessmentAdministrationKey {
  /**
   * The title or name of the assessment in the context of its administration.
   */
  administrationIdentifier?: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier?: string;
  /**
   * Namespace for the assessment.
   */
  namespace?: string;
  /**
   * The identifier assigned to an education organization.
   */
  assigningEducationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentAdministrationKeyChange".
 */
export interface TrackedChangesEdFiAssessmentAdministrationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiAssessmentAdministrationKey;
  newKeyValues?: TrackedChangesEdFiAssessmentAdministrationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentAdministrationParticipationDelete".
 */
export interface TrackedChangesEdFiAssessmentAdministrationParticipationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiAssessmentAdministrationParticipationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentAdministrationParticipationKey".
 */
export interface TrackedChangesEdFiAssessmentAdministrationParticipationKey {
  /**
   * The title or name of the assessment in the context of its administration.
   */
  administrationIdentifier?: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier?: string;
  /**
   * The identifier assigned to an education organization.
   */
  assigningEducationOrganizationId?: number;
  /**
   * Namespace for the assessment.
   */
  namespace?: string;
  /**
   * The identifier assigned to an education organization.
   */
  participatingEducationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentAdministrationParticipationKeyChange".
 */
export interface TrackedChangesEdFiAssessmentAdministrationParticipationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiAssessmentAdministrationParticipationKey;
  newKeyValues?: TrackedChangesEdFiAssessmentAdministrationParticipationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentBatteryPartDelete".
 */
export interface TrackedChangesEdFiAssessmentBatteryPartDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiAssessmentBatteryPartKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentBatteryPartKey".
 */
export interface TrackedChangesEdFiAssessmentBatteryPartKey {
  /**
   * The name of the part of an assessment battery.
   */
  assessmentBatteryPartName?: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier?: string;
  /**
   * Namespace for the assessment.
   */
  namespace?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentBatteryPartKeyChange".
 */
export interface TrackedChangesEdFiAssessmentBatteryPartKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiAssessmentBatteryPartKey;
  newKeyValues?: TrackedChangesEdFiAssessmentBatteryPartKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentDelete".
 */
export interface TrackedChangesEdFiAssessmentDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiAssessmentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentKey".
 */
export interface TrackedChangesEdFiAssessmentKey {
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier?: string;
  /**
   * Namespace for the assessment.
   */
  namespace?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentItemDelete".
 */
export interface TrackedChangesEdFiAssessmentItemDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiAssessmentItemKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentItemKey".
 */
export interface TrackedChangesEdFiAssessmentItemKey {
  /**
   * A unique number or alphanumeric code assigned to a space, room, site, building, individual, organization, program, or institution by a school, school system, state, or other agency or entity.
   */
  identificationCode?: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier?: string;
  /**
   * Namespace for the assessment.
   */
  namespace?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentItemKeyChange".
 */
export interface TrackedChangesEdFiAssessmentItemKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiAssessmentItemKey;
  newKeyValues?: TrackedChangesEdFiAssessmentItemKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentKeyChange".
 */
export interface TrackedChangesEdFiAssessmentKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiAssessmentKey;
  newKeyValues?: TrackedChangesEdFiAssessmentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentScoreRangeLearningStandardDelete".
 */
export interface TrackedChangesEdFiAssessmentScoreRangeLearningStandardDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiAssessmentScoreRangeLearningStandardKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentScoreRangeLearningStandardKey".
 */
export interface TrackedChangesEdFiAssessmentScoreRangeLearningStandardKey {
  /**
   * A unique number or alphanumeric code assigned to the score range associated with one or more learning standards.
   */
  scoreRangeId?: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier?: string;
  /**
   * Namespace for the assessment.
   */
  namespace?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_assessmentScoreRangeLearningStandardKeyChange".
 */
export interface TrackedChangesEdFiAssessmentScoreRangeLearningStandardKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiAssessmentScoreRangeLearningStandardKey;
  newKeyValues?: TrackedChangesEdFiAssessmentScoreRangeLearningStandardKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_balanceSheetDimensionDelete".
 */
export interface TrackedChangesEdFiBalanceSheetDimensionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiBalanceSheetDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_balanceSheetDimensionKey".
 */
export interface TrackedChangesEdFiBalanceSheetDimensionKey {
  /**
   * The code representation of the account balance sheet dimension.
   */
  code?: string;
  /**
   * The fiscal year for which the account balance sheet dimension is valid.
   */
  fiscalYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_balanceSheetDimensionKeyChange".
 */
export interface TrackedChangesEdFiBalanceSheetDimensionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiBalanceSheetDimensionKey;
  newKeyValues?: TrackedChangesEdFiBalanceSheetDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_bellScheduleDelete".
 */
export interface TrackedChangesEdFiBellScheduleDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiBellScheduleKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_bellScheduleKey".
 */
export interface TrackedChangesEdFiBellScheduleKey {
  /**
   * Name or title of the bell schedule.
   */
  bellScheduleName?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_bellScheduleKeyChange".
 */
export interface TrackedChangesEdFiBellScheduleKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiBellScheduleKey;
  newKeyValues?: TrackedChangesEdFiBellScheduleKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_calendarDateDelete".
 */
export interface TrackedChangesEdFiCalendarDateDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiCalendarDateKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_calendarDateKey".
 */
export interface TrackedChangesEdFiCalendarDateKey {
  /**
   * The month, day, and year of the calendar event.
   */
  date?: string;
  /**
   * The identifier for the calendar.
   */
  calendarCode?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * The identifier for the school year associated with the calendar.
   */
  schoolYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_calendarDateKeyChange".
 */
export interface TrackedChangesEdFiCalendarDateKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiCalendarDateKey;
  newKeyValues?: TrackedChangesEdFiCalendarDateKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_calendarDelete".
 */
export interface TrackedChangesEdFiCalendarDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiCalendarKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_calendarKey".
 */
export interface TrackedChangesEdFiCalendarKey {
  /**
   * The identifier for the calendar.
   */
  calendarCode?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * The identifier for the school year associated with the calendar.
   */
  schoolYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_calendarKeyChange".
 */
export interface TrackedChangesEdFiCalendarKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiCalendarKey;
  newKeyValues?: TrackedChangesEdFiCalendarKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_chartOfAccountDelete".
 */
export interface TrackedChangesEdFiChartOfAccountDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiChartOfAccountKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_chartOfAccountKey".
 */
export interface TrackedChangesEdFiChartOfAccountKey {
  /**
   * SEA populated code value for the valid combination of account dimensions under which financials are reported.
   */
  accountIdentifier?: string;
  /**
   * The fiscal year for the account
   */
  fiscalYear?: number;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_chartOfAccountKeyChange".
 */
export interface TrackedChangesEdFiChartOfAccountKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiChartOfAccountKey;
  newKeyValues?: TrackedChangesEdFiChartOfAccountKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_classPeriodDelete".
 */
export interface TrackedChangesEdFiClassPeriodDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiClassPeriodKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_classPeriodKey".
 */
export interface TrackedChangesEdFiClassPeriodKey {
  /**
   * An indication of the portion of a typical daily session in which students receive instruction in a specified subject (e.g., morning, sixth period, block period, or AB schedules).
   */
  classPeriodName?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_classPeriodKeyChange".
 */
export interface TrackedChangesEdFiClassPeriodKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiClassPeriodKey;
  newKeyValues?: TrackedChangesEdFiClassPeriodKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_cohortDelete".
 */
export interface TrackedChangesEdFiCohortDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiCohortKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_cohortKey".
 */
export interface TrackedChangesEdFiCohortKey {
  /**
   * The name or ID for the cohort.
   */
  cohortIdentifier?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_cohortKeyChange".
 */
export interface TrackedChangesEdFiCohortKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiCohortKey;
  newKeyValues?: TrackedChangesEdFiCohortKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_communityOrganizationDelete".
 */
export interface TrackedChangesEdFiCommunityOrganizationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiCommunityOrganizationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_communityOrganizationKey".
 */
export interface TrackedChangesEdFiCommunityOrganizationKey {
  /**
   * The identifier assigned to a community organization. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  communityOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_communityOrganizationKeyChange".
 */
export interface TrackedChangesEdFiCommunityOrganizationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiCommunityOrganizationKey;
  newKeyValues?: TrackedChangesEdFiCommunityOrganizationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_communityProviderDelete".
 */
export interface TrackedChangesEdFiCommunityProviderDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiCommunityProviderKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_communityProviderKey".
 */
export interface TrackedChangesEdFiCommunityProviderKey {
  /**
   * The identifier assigned to a community provider. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  communityProviderId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_communityProviderKeyChange".
 */
export interface TrackedChangesEdFiCommunityProviderKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiCommunityProviderKey;
  newKeyValues?: TrackedChangesEdFiCommunityProviderKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_communityProviderLicenseDelete".
 */
export interface TrackedChangesEdFiCommunityProviderLicenseDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiCommunityProviderLicenseKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_communityProviderLicenseKey".
 */
export interface TrackedChangesEdFiCommunityProviderLicenseKey {
  /**
   * The unique identifier issued by the licensing organization.
   */
  licenseIdentifier?: string;
  /**
   * The organization issuing the license.
   */
  licensingOrganization?: string;
  /**
   * The identifier assigned to a community provider. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  communityProviderId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_communityProviderLicenseKeyChange".
 */
export interface TrackedChangesEdFiCommunityProviderLicenseKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiCommunityProviderLicenseKey;
  newKeyValues?: TrackedChangesEdFiCommunityProviderLicenseKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_competencyObjectiveDelete".
 */
export interface TrackedChangesEdFiCompetencyObjectiveDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiCompetencyObjectiveKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_competencyObjectiveKey".
 */
export interface TrackedChangesEdFiCompetencyObjectiveKey {
  /**
   * The grade level for which the competency objective is targeted.
   */
  objectiveGradeLevelDescriptor?: string;
  /**
   * The designated title of the competency objective.
   */
  objective?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_competencyObjectiveKeyChange".
 */
export interface TrackedChangesEdFiCompetencyObjectiveKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiCompetencyObjectiveKey;
  newKeyValues?: TrackedChangesEdFiCompetencyObjectiveKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_contactDelete".
 */
export interface TrackedChangesEdFiContactDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiContactKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_contactKey".
 */
export interface TrackedChangesEdFiContactKey {
  /**
   * A unique alphanumeric code assigned to a contact.
   */
  contactUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_contactKeyChange".
 */
export interface TrackedChangesEdFiContactKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiContactKey;
  newKeyValues?: TrackedChangesEdFiContactKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_courseDelete".
 */
export interface TrackedChangesEdFiCourseDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiCourseKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_courseKey".
 */
export interface TrackedChangesEdFiCourseKey {
  /**
   * A unique alphanumeric code assigned to a course.
   */
  courseCode?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_courseKeyChange".
 */
export interface TrackedChangesEdFiCourseKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiCourseKey;
  newKeyValues?: TrackedChangesEdFiCourseKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_courseOfferingDelete".
 */
export interface TrackedChangesEdFiCourseOfferingDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiCourseOfferingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_courseOfferingKey".
 */
export interface TrackedChangesEdFiCourseOfferingKey {
  /**
   * The local code assigned by the School that identifies the course offering provided for the instruction of students.
   */
  localCourseCode?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_courseOfferingKeyChange".
 */
export interface TrackedChangesEdFiCourseOfferingKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiCourseOfferingKey;
  newKeyValues?: TrackedChangesEdFiCourseOfferingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_courseTranscriptDelete".
 */
export interface TrackedChangesEdFiCourseTranscriptDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiCourseTranscriptKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_courseTranscriptKey".
 */
export interface TrackedChangesEdFiCourseTranscriptKey {
  /**
   * The result from the student's attempt to take the course.
   */
  courseAttemptResultDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a course.
   */
  courseCode?: string;
  /**
   * The identifier assigned to an education organization.
   */
  courseEducationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  /**
   * The term for the session during the school year.
   */
  termDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_courseTranscriptKeyChange".
 */
export interface TrackedChangesEdFiCourseTranscriptKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiCourseTranscriptKey;
  newKeyValues?: TrackedChangesEdFiCourseTranscriptKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_credentialDelete".
 */
export interface TrackedChangesEdFiCredentialDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiCredentialKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_credentialKey".
 */
export interface TrackedChangesEdFiCredentialKey {
  /**
   * The abbreviation for the name of the state (within the United States) or extra-state jurisdiction in which a license/credential was issued.
   */
  stateOfIssueStateAbbreviationDescriptor?: string;
  /**
   * Identifier or serial number assigned to the credential.
   */
  credentialIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_credentialKeyChange".
 */
export interface TrackedChangesEdFiCredentialKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiCredentialKey;
  newKeyValues?: TrackedChangesEdFiCredentialKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_crisisEventDelete".
 */
export interface TrackedChangesEdFiCrisisEventDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiCrisisEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_crisisEventKey".
 */
export interface TrackedChangesEdFiCrisisEventKey {
  /**
   * The name of the crisis event that occurred. If there is no generally accepted name for this crisis event, the suggested format: Location + Crisis type + Year.
   */
  crisisEventName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_crisisEventKeyChange".
 */
export interface TrackedChangesEdFiCrisisEventKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiCrisisEventKey;
  newKeyValues?: TrackedChangesEdFiCrisisEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_descriptorMappingDelete".
 */
export interface TrackedChangesEdFiDescriptorMappingDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiDescriptorMappingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_descriptorMappingKey".
 */
export interface TrackedChangesEdFiDescriptorMappingKey {
  /**
   * The namespace of the descriptor value to which the from descriptor value is mapped to.
   */
  mappedNamespace?: string;
  /**
   * The descriptor value to which the from descriptor value is being mapped to.
   */
  mappedValue?: string;
  /**
   * The namespace of the descriptor value that is being mapped to another value.
   */
  namespace?: string;
  /**
   * The descriptor value that is being mapped to another value.
   */
  value?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_descriptorMappingKeyChange".
 */
export interface TrackedChangesEdFiDescriptorMappingKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiDescriptorMappingKey;
  newKeyValues?: TrackedChangesEdFiDescriptorMappingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_disciplineActionDelete".
 */
export interface TrackedChangesEdFiDisciplineActionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiDisciplineActionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_disciplineActionKey".
 */
export interface TrackedChangesEdFiDisciplineActionKey {
  /**
   * Identifier assigned by the education organization to the discipline action.
   */
  disciplineActionIdentifier?: string;
  /**
   * The date of the discipline action.
   */
  disciplineDate?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_disciplineActionKeyChange".
 */
export interface TrackedChangesEdFiDisciplineActionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiDisciplineActionKey;
  newKeyValues?: TrackedChangesEdFiDisciplineActionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_disciplineIncidentDelete".
 */
export interface TrackedChangesEdFiDisciplineIncidentDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiDisciplineIncidentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_disciplineIncidentKey".
 */
export interface TrackedChangesEdFiDisciplineIncidentKey {
  /**
   * A locally assigned unique identifier (within the school or school district) to identify each specific DisciplineIncident or occurrence. The same identifier should be used to document the entire discipline incident even if it included multiple offenses and multiple offenders.
   */
  incidentIdentifier?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_disciplineIncidentKeyChange".
 */
export interface TrackedChangesEdFiDisciplineIncidentKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiDisciplineIncidentKey;
  newKeyValues?: TrackedChangesEdFiDisciplineIncidentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationContentDelete".
 */
export interface TrackedChangesEdFiEducationContentDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiEducationContentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationContentKey".
 */
export interface TrackedChangesEdFiEducationContentKey {
  /**
   * A unique identifier for the education content.
   */
  contentIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationContentKeyChange".
 */
export interface TrackedChangesEdFiEducationContentKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiEducationContentKey;
  newKeyValues?: TrackedChangesEdFiEducationContentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationOrganizationInterventionPrescriptionAssociationDelete".
 */
export interface TrackedChangesEdFiEducationOrganizationInterventionPrescriptionAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiEducationOrganizationInterventionPrescriptionAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationOrganizationInterventionPrescriptionAssociationKey".
 */
export interface TrackedChangesEdFiEducationOrganizationInterventionPrescriptionAssociationKey {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  interventionPrescriptionEducationOrganizationId?: number;
  /**
   * A unique number or alphanumeric code assigned to an intervention prescription.
   */
  interventionPrescriptionIdentificationCode?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationOrganizationInterventionPrescriptionAssociationKeyChange".
 */
export interface TrackedChangesEdFiEducationOrganizationInterventionPrescriptionAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiEducationOrganizationInterventionPrescriptionAssociationKey;
  newKeyValues?: TrackedChangesEdFiEducationOrganizationInterventionPrescriptionAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationOrganizationNetworkAssociationDelete".
 */
export interface TrackedChangesEdFiEducationOrganizationNetworkAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiEducationOrganizationNetworkAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationOrganizationNetworkAssociationKey".
 */
export interface TrackedChangesEdFiEducationOrganizationNetworkAssociationKey {
  /**
   * The identifier assigned to an education organization.
   */
  memberEducationOrganizationId?: number;
  /**
   * The identifier assigned to a network of education organizations. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  educationOrganizationNetworkId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationOrganizationNetworkAssociationKeyChange".
 */
export interface TrackedChangesEdFiEducationOrganizationNetworkAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiEducationOrganizationNetworkAssociationKey;
  newKeyValues?: TrackedChangesEdFiEducationOrganizationNetworkAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationOrganizationNetworkDelete".
 */
export interface TrackedChangesEdFiEducationOrganizationNetworkDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiEducationOrganizationNetworkKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationOrganizationNetworkKey".
 */
export interface TrackedChangesEdFiEducationOrganizationNetworkKey {
  /**
   * The identifier assigned to a network of education organizations. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  educationOrganizationNetworkId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationOrganizationNetworkKeyChange".
 */
export interface TrackedChangesEdFiEducationOrganizationNetworkKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiEducationOrganizationNetworkKey;
  newKeyValues?: TrackedChangesEdFiEducationOrganizationNetworkKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationOrganizationPeerAssociationDelete".
 */
export interface TrackedChangesEdFiEducationOrganizationPeerAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiEducationOrganizationPeerAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationOrganizationPeerAssociationKey".
 */
export interface TrackedChangesEdFiEducationOrganizationPeerAssociationKey {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  peerEducationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationOrganizationPeerAssociationKeyChange".
 */
export interface TrackedChangesEdFiEducationOrganizationPeerAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiEducationOrganizationPeerAssociationKey;
  newKeyValues?: TrackedChangesEdFiEducationOrganizationPeerAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationServiceCenterDelete".
 */
export interface TrackedChangesEdFiEducationServiceCenterDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiEducationServiceCenterKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationServiceCenterKey".
 */
export interface TrackedChangesEdFiEducationServiceCenterKey {
  /**
   * The identifier assigned to an education service center. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  educationServiceCenterId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_educationServiceCenterKeyChange".
 */
export interface TrackedChangesEdFiEducationServiceCenterKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiEducationServiceCenterKey;
  newKeyValues?: TrackedChangesEdFiEducationServiceCenterKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_evaluationRubricDimensionDelete".
 */
export interface TrackedChangesEdFiEvaluationRubricDimensionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiEvaluationRubricDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_evaluationRubricDimensionKey".
 */
export interface TrackedChangesEdFiEvaluationRubricDimensionKey {
  /**
   * The numeric rating associated with the evaluation rubric dimension.
   */
  evaluationRubricRating?: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The name or title of the program evaluation element.
   */
  programEvaluationElementTitle?: string;
  /**
   * The name of the period for the program evaluation.
   */
  programEvaluationPeriodDescriptor?: string;
  /**
   * An assigned unique identifier for the student program evaluation.
   */
  programEvaluationTitle?: string;
  /**
   * The type of program evaluation conducted.
   */
  programEvaluationTypeDescriptor?: string;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_evaluationRubricDimensionKeyChange".
 */
export interface TrackedChangesEdFiEvaluationRubricDimensionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiEvaluationRubricDimensionKey;
  newKeyValues?: TrackedChangesEdFiEvaluationRubricDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_feederSchoolAssociationDelete".
 */
export interface TrackedChangesEdFiFeederSchoolAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiFeederSchoolAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_feederSchoolAssociationKey".
 */
export interface TrackedChangesEdFiFeederSchoolAssociationKey {
  /**
   * The month, day, and year of the first day of the feeder school association.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  feederSchoolId?: number;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_feederSchoolAssociationKeyChange".
 */
export interface TrackedChangesEdFiFeederSchoolAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiFeederSchoolAssociationKey;
  newKeyValues?: TrackedChangesEdFiFeederSchoolAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_functionDimensionDelete".
 */
export interface TrackedChangesEdFiFunctionDimensionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiFunctionDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_functionDimensionKey".
 */
export interface TrackedChangesEdFiFunctionDimensionKey {
  /**
   * The code representation of the account function dimension.
   */
  code?: string;
  /**
   * The fiscal year for which the account function dimension is valid.
   */
  fiscalYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_functionDimensionKeyChange".
 */
export interface TrackedChangesEdFiFunctionDimensionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiFunctionDimensionKey;
  newKeyValues?: TrackedChangesEdFiFunctionDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_fundDimensionDelete".
 */
export interface TrackedChangesEdFiFundDimensionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiFundDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_fundDimensionKey".
 */
export interface TrackedChangesEdFiFundDimensionKey {
  /**
   * The code representation of the account fund dimension.
   */
  code?: string;
  /**
   * The fiscal year for which the account fund dimension is valid.
   */
  fiscalYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_fundDimensionKeyChange".
 */
export interface TrackedChangesEdFiFundDimensionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiFundDimensionKey;
  newKeyValues?: TrackedChangesEdFiFundDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_gradebookEntryDelete".
 */
export interface TrackedChangesEdFiGradebookEntryDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiGradebookEntryKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_gradebookEntryKey".
 */
export interface TrackedChangesEdFiGradebookEntryKey {
  /**
   * A unique number or alphanumeric code assigned to a gradebook entry by the source system.
   */
  gradebookEntryIdentifier?: string;
  /**
   * Namespace URI for the source of the gradebook entry.
   */
  namespace?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_gradebookEntryKeyChange".
 */
export interface TrackedChangesEdFiGradebookEntryKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiGradebookEntryKey;
  newKeyValues?: TrackedChangesEdFiGradebookEntryKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_gradeDelete".
 */
export interface TrackedChangesEdFiGradeDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiGradeKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_gradeKey".
 */
export interface TrackedChangesEdFiGradeKey {
  /**
   * The type of grade reported (e.g., exam, final, grading period).
   */
  gradeTypeDescriptor?: string;
  /**
   * The state's name of the period for which grades are reported.
   */
  gradingPeriodDescriptor?: string;
  /**
   * The school's descriptive name of the grading period.
   */
  gradingPeriodName?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * The identifier for the grading period school year.
   */
  gradingPeriodSchoolYear?: number;
  /**
   * Month, day, and year of the student's entry or assignment to the section.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The local code assigned by the School that identifies the course offering provided for the instruction of students.
   */
  localCourseCode?: string;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The local identifier assigned to a section.
   */
  sectionIdentifier?: string;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_gradeKeyChange".
 */
export interface TrackedChangesEdFiGradeKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiGradeKey;
  newKeyValues?: TrackedChangesEdFiGradeKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_gradingPeriodDelete".
 */
export interface TrackedChangesEdFiGradingPeriodDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiGradingPeriodKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_gradingPeriodKey".
 */
export interface TrackedChangesEdFiGradingPeriodKey {
  /**
   * The state's name of the period for which grades are reported.
   */
  gradingPeriodDescriptor?: string;
  /**
   * The school's descriptive name of the grading period.
   */
  gradingPeriodName?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * The identifier for the grading period school year.
   */
  schoolYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_gradingPeriodKeyChange".
 */
export interface TrackedChangesEdFiGradingPeriodKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiGradingPeriodKey;
  newKeyValues?: TrackedChangesEdFiGradingPeriodKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_graduationPlanDelete".
 */
export interface TrackedChangesEdFiGraduationPlanDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiGraduationPlanKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_graduationPlanKey".
 */
export interface TrackedChangesEdFiGraduationPlanKey {
  /**
   * The type of academic plan the student is following for graduation.
   */
  graduationPlanTypeDescriptor?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The school year the student is expected to graduate.
   */
  graduationSchoolYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_graduationPlanKeyChange".
 */
export interface TrackedChangesEdFiGraduationPlanKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiGraduationPlanKey;
  newKeyValues?: TrackedChangesEdFiGraduationPlanKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_interventionDelete".
 */
export interface TrackedChangesEdFiInterventionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiInterventionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_interventionKey".
 */
export interface TrackedChangesEdFiInterventionKey {
  /**
   * A unique number or alphanumeric code assigned to an intervention.
   */
  interventionIdentificationCode?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_interventionKeyChange".
 */
export interface TrackedChangesEdFiInterventionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiInterventionKey;
  newKeyValues?: TrackedChangesEdFiInterventionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_interventionPrescriptionDelete".
 */
export interface TrackedChangesEdFiInterventionPrescriptionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiInterventionPrescriptionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_interventionPrescriptionKey".
 */
export interface TrackedChangesEdFiInterventionPrescriptionKey {
  /**
   * A unique number or alphanumeric code assigned to an intervention prescription.
   */
  interventionPrescriptionIdentificationCode?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_interventionPrescriptionKeyChange".
 */
export interface TrackedChangesEdFiInterventionPrescriptionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiInterventionPrescriptionKey;
  newKeyValues?: TrackedChangesEdFiInterventionPrescriptionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_interventionStudyDelete".
 */
export interface TrackedChangesEdFiInterventionStudyDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiInterventionStudyKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_interventionStudyKey".
 */
export interface TrackedChangesEdFiInterventionStudyKey {
  /**
   * A unique number or alphanumeric code assigned to an intervention study.
   */
  interventionStudyIdentificationCode?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_interventionStudyKeyChange".
 */
export interface TrackedChangesEdFiInterventionStudyKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiInterventionStudyKey;
  newKeyValues?: TrackedChangesEdFiInterventionStudyKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_learningStandardDelete".
 */
export interface TrackedChangesEdFiLearningStandardDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiLearningStandardKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_learningStandardKey".
 */
export interface TrackedChangesEdFiLearningStandardKey {
  /**
   * The identifier for the specific learning standard (e.g., 111.15.3.1.A).
   */
  learningStandardId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_learningStandardEquivalenceAssociationDelete".
 */
export interface TrackedChangesEdFiLearningStandardEquivalenceAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiLearningStandardEquivalenceAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_learningStandardEquivalenceAssociationKey".
 */
export interface TrackedChangesEdFiLearningStandardEquivalenceAssociationKey {
  /**
   * The namespace of the organization that has created and owns the association.
   */
  namespace?: string;
  /**
   * The identifier for the specific learning standard (e.g., 111.15.3.1.A).
   */
  sourceLearningStandardId?: string;
  /**
   * The identifier for the specific learning standard (e.g., 111.15.3.1.A).
   */
  targetLearningStandardId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_learningStandardEquivalenceAssociationKeyChange".
 */
export interface TrackedChangesEdFiLearningStandardEquivalenceAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiLearningStandardEquivalenceAssociationKey;
  newKeyValues?: TrackedChangesEdFiLearningStandardEquivalenceAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_learningStandardKeyChange".
 */
export interface TrackedChangesEdFiLearningStandardKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiLearningStandardKey;
  newKeyValues?: TrackedChangesEdFiLearningStandardKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localAccountDelete".
 */
export interface TrackedChangesEdFiLocalAccountDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiLocalAccountKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localAccountKey".
 */
export interface TrackedChangesEdFiLocalAccountKey {
  /**
   * Code value for the valid combination of account dimensions by LEA under which financials are reported.
   */
  accountIdentifier?: string;
  /**
   * The fiscal year for the account.
   */
  fiscalYear?: number;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localAccountKeyChange".
 */
export interface TrackedChangesEdFiLocalAccountKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiLocalAccountKey;
  newKeyValues?: TrackedChangesEdFiLocalAccountKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localActualDelete".
 */
export interface TrackedChangesEdFiLocalActualDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiLocalActualKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localActualKey".
 */
export interface TrackedChangesEdFiLocalActualKey {
  /**
   * The date of the reported amount for the account.
   */
  asOfDate?: string;
  /**
   * Code value for the valid combination of account dimensions by LEA under which financials are reported.
   */
  accountIdentifier?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The fiscal year for the account.
   */
  fiscalYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localActualKeyChange".
 */
export interface TrackedChangesEdFiLocalActualKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiLocalActualKey;
  newKeyValues?: TrackedChangesEdFiLocalActualKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localBudgetDelete".
 */
export interface TrackedChangesEdFiLocalBudgetDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiLocalBudgetKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localBudgetKey".
 */
export interface TrackedChangesEdFiLocalBudgetKey {
  /**
   * The date of the reported amount for the account.
   */
  asOfDate?: string;
  /**
   * Code value for the valid combination of account dimensions by LEA under which financials are reported.
   */
  accountIdentifier?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The fiscal year for the account.
   */
  fiscalYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localBudgetKeyChange".
 */
export interface TrackedChangesEdFiLocalBudgetKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiLocalBudgetKey;
  newKeyValues?: TrackedChangesEdFiLocalBudgetKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localContractedStaffDelete".
 */
export interface TrackedChangesEdFiLocalContractedStaffDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiLocalContractedStaffKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localContractedStaffKey".
 */
export interface TrackedChangesEdFiLocalContractedStaffKey {
  /**
   * The date of the reported amount for the account.
   */
  asOfDate?: string;
  /**
   * Code value for the valid combination of account dimensions by LEA under which financials are reported.
   */
  accountIdentifier?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The fiscal year for the account.
   */
  fiscalYear?: number;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localContractedStaffKeyChange".
 */
export interface TrackedChangesEdFiLocalContractedStaffKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiLocalContractedStaffKey;
  newKeyValues?: TrackedChangesEdFiLocalContractedStaffKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localEducationAgencyDelete".
 */
export interface TrackedChangesEdFiLocalEducationAgencyDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiLocalEducationAgencyKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localEducationAgencyKey".
 */
export interface TrackedChangesEdFiLocalEducationAgencyKey {
  /**
   * The identifier assigned to a local education agency. It must be distinct from any other identifier assigned to educational organizations, such as a SchoolId, to prevent duplication.
   */
  localEducationAgencyId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localEducationAgencyKeyChange".
 */
export interface TrackedChangesEdFiLocalEducationAgencyKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiLocalEducationAgencyKey;
  newKeyValues?: TrackedChangesEdFiLocalEducationAgencyKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localEncumbranceDelete".
 */
export interface TrackedChangesEdFiLocalEncumbranceDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiLocalEncumbranceKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localEncumbranceKey".
 */
export interface TrackedChangesEdFiLocalEncumbranceKey {
  /**
   * The date of the reported amount for the account.
   */
  asOfDate?: string;
  /**
   * Code value for the valid combination of account dimensions by LEA under which financials are reported.
   */
  accountIdentifier?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The fiscal year for the account.
   */
  fiscalYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localEncumbranceKeyChange".
 */
export interface TrackedChangesEdFiLocalEncumbranceKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiLocalEncumbranceKey;
  newKeyValues?: TrackedChangesEdFiLocalEncumbranceKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localPayrollDelete".
 */
export interface TrackedChangesEdFiLocalPayrollDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiLocalPayrollKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localPayrollKey".
 */
export interface TrackedChangesEdFiLocalPayrollKey {
  /**
   * The date of the reported amount for the account.
   */
  asOfDate?: string;
  /**
   * Code value for the valid combination of account dimensions by LEA under which financials are reported.
   */
  accountIdentifier?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The fiscal year for the account.
   */
  fiscalYear?: number;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_localPayrollKeyChange".
 */
export interface TrackedChangesEdFiLocalPayrollKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiLocalPayrollKey;
  newKeyValues?: TrackedChangesEdFiLocalPayrollKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_locationDelete".
 */
export interface TrackedChangesEdFiLocationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiLocationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_locationKey".
 */
export interface TrackedChangesEdFiLocationKey {
  /**
   * A unique number or alphanumeric code assigned to a room by a school, school system, state, or other agency or entity.
   */
  classroomIdentificationCode?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_locationKeyChange".
 */
export interface TrackedChangesEdFiLocationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiLocationKey;
  newKeyValues?: TrackedChangesEdFiLocationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_objectDimensionDelete".
 */
export interface TrackedChangesEdFiObjectDimensionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiObjectDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_objectDimensionKey".
 */
export interface TrackedChangesEdFiObjectDimensionKey {
  /**
   * The code representation of the account object dimension.
   */
  code?: string;
  /**
   * The fiscal year for which the account object dimension is valid.
   */
  fiscalYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_objectDimensionKeyChange".
 */
export interface TrackedChangesEdFiObjectDimensionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiObjectDimensionKey;
  newKeyValues?: TrackedChangesEdFiObjectDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_objectiveAssessmentDelete".
 */
export interface TrackedChangesEdFiObjectiveAssessmentDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiObjectiveAssessmentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_objectiveAssessmentKey".
 */
export interface TrackedChangesEdFiObjectiveAssessmentKey {
  /**
   * A unique number or alphanumeric code assigned to an objective assessment by a school, school system, a state, or other agency or entity.
   */
  identificationCode?: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier?: string;
  /**
   * Namespace for the assessment.
   */
  namespace?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_objectiveAssessmentKeyChange".
 */
export interface TrackedChangesEdFiObjectiveAssessmentKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiObjectiveAssessmentKey;
  newKeyValues?: TrackedChangesEdFiObjectiveAssessmentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_openStaffPositionDelete".
 */
export interface TrackedChangesEdFiOpenStaffPositionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiOpenStaffPositionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_openStaffPositionKey".
 */
export interface TrackedChangesEdFiOpenStaffPositionKey {
  /**
   * The number or identifier assigned to an open staff position, typically a requisition number assigned by Human Resources.
   */
  requisitionNumber?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_openStaffPositionKeyChange".
 */
export interface TrackedChangesEdFiOpenStaffPositionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiOpenStaffPositionKey;
  newKeyValues?: TrackedChangesEdFiOpenStaffPositionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_operationalUnitDimensionDelete".
 */
export interface TrackedChangesEdFiOperationalUnitDimensionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiOperationalUnitDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_operationalUnitDimensionKey".
 */
export interface TrackedChangesEdFiOperationalUnitDimensionKey {
  /**
   * The code representation of the account operational unit dimension.
   */
  code?: string;
  /**
   * The fiscal year for which the account operational unit dimension is valid.
   */
  fiscalYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_operationalUnitDimensionKeyChange".
 */
export interface TrackedChangesEdFiOperationalUnitDimensionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiOperationalUnitDimensionKey;
  newKeyValues?: TrackedChangesEdFiOperationalUnitDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_organizationDepartmentDelete".
 */
export interface TrackedChangesEdFiOrganizationDepartmentDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiOrganizationDepartmentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_organizationDepartmentKey".
 */
export interface TrackedChangesEdFiOrganizationDepartmentKey {
  /**
   * The unique identification code for the organization department. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  organizationDepartmentId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_organizationDepartmentKeyChange".
 */
export interface TrackedChangesEdFiOrganizationDepartmentKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiOrganizationDepartmentKey;
  newKeyValues?: TrackedChangesEdFiOrganizationDepartmentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_personDelete".
 */
export interface TrackedChangesEdFiPersonDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiPersonKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_personKey".
 */
export interface TrackedChangesEdFiPersonKey {
  /**
   * This descriptor defines the originating record source system for the person.
   */
  sourceSystemDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a person.
   */
  personId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_personKeyChange".
 */
export interface TrackedChangesEdFiPersonKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiPersonKey;
  newKeyValues?: TrackedChangesEdFiPersonKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_postSecondaryEventDelete".
 */
export interface TrackedChangesEdFiPostSecondaryEventDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiPostSecondaryEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_postSecondaryEventKey".
 */
export interface TrackedChangesEdFiPostSecondaryEventKey {
  /**
   * The post secondary event that is logged.
   */
  postSecondaryEventCategoryDescriptor?: string;
  /**
   * The date the event occurred or was recorded.
   */
  eventDate?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_postSecondaryEventKeyChange".
 */
export interface TrackedChangesEdFiPostSecondaryEventKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiPostSecondaryEventKey;
  newKeyValues?: TrackedChangesEdFiPostSecondaryEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_postSecondaryInstitutionDelete".
 */
export interface TrackedChangesEdFiPostSecondaryInstitutionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiPostSecondaryInstitutionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_postSecondaryInstitutionKey".
 */
export interface TrackedChangesEdFiPostSecondaryInstitutionKey {
  /**
   * The ID of the post secondary institution. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  postSecondaryInstitutionId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_postSecondaryInstitutionKeyChange".
 */
export interface TrackedChangesEdFiPostSecondaryInstitutionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiPostSecondaryInstitutionKey;
  newKeyValues?: TrackedChangesEdFiPostSecondaryInstitutionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programDelete".
 */
export interface TrackedChangesEdFiProgramDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiProgramKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programKey".
 */
export interface TrackedChangesEdFiProgramKey {
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programDimensionDelete".
 */
export interface TrackedChangesEdFiProgramDimensionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiProgramDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programDimensionKey".
 */
export interface TrackedChangesEdFiProgramDimensionKey {
  /**
   * The code representation of the account program dimension.
   */
  code?: string;
  /**
   * The fiscal year for which the account program dimension is valid.
   */
  fiscalYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programDimensionKeyChange".
 */
export interface TrackedChangesEdFiProgramDimensionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiProgramDimensionKey;
  newKeyValues?: TrackedChangesEdFiProgramDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programEvaluationDelete".
 */
export interface TrackedChangesEdFiProgramEvaluationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiProgramEvaluationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programEvaluationKey".
 */
export interface TrackedChangesEdFiProgramEvaluationKey {
  /**
   * The name of the period for the program evaluation.
   */
  programEvaluationPeriodDescriptor?: string;
  /**
   * The type of program evaluation conducted.
   */
  programEvaluationTypeDescriptor?: string;
  /**
   * An assigned unique identifier for the student program evaluation.
   */
  programEvaluationTitle?: string;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programEvaluationElementDelete".
 */
export interface TrackedChangesEdFiProgramEvaluationElementDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiProgramEvaluationElementKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programEvaluationElementKey".
 */
export interface TrackedChangesEdFiProgramEvaluationElementKey {
  /**
   * The name or title of the program evaluation element.
   */
  programEvaluationElementTitle?: string;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The name of the period for the program evaluation.
   */
  programEvaluationPeriodDescriptor?: string;
  /**
   * An assigned unique identifier for the student program evaluation.
   */
  programEvaluationTitle?: string;
  /**
   * The type of program evaluation conducted.
   */
  programEvaluationTypeDescriptor?: string;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programEvaluationElementKeyChange".
 */
export interface TrackedChangesEdFiProgramEvaluationElementKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiProgramEvaluationElementKey;
  newKeyValues?: TrackedChangesEdFiProgramEvaluationElementKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programEvaluationKeyChange".
 */
export interface TrackedChangesEdFiProgramEvaluationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiProgramEvaluationKey;
  newKeyValues?: TrackedChangesEdFiProgramEvaluationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programEvaluationObjectiveDelete".
 */
export interface TrackedChangesEdFiProgramEvaluationObjectiveDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiProgramEvaluationObjectiveKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programEvaluationObjectiveKey".
 */
export interface TrackedChangesEdFiProgramEvaluationObjectiveKey {
  /**
   * The name or title of the program evaluation objective.
   */
  programEvaluationObjectiveTitle?: string;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The name of the period for the program evaluation.
   */
  programEvaluationPeriodDescriptor?: string;
  /**
   * An assigned unique identifier for the student program evaluation.
   */
  programEvaluationTitle?: string;
  /**
   * The type of program evaluation conducted.
   */
  programEvaluationTypeDescriptor?: string;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programEvaluationObjectiveKeyChange".
 */
export interface TrackedChangesEdFiProgramEvaluationObjectiveKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiProgramEvaluationObjectiveKey;
  newKeyValues?: TrackedChangesEdFiProgramEvaluationObjectiveKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_programKeyChange".
 */
export interface TrackedChangesEdFiProgramKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiProgramKey;
  newKeyValues?: TrackedChangesEdFiProgramKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_projectDimensionDelete".
 */
export interface TrackedChangesEdFiProjectDimensionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiProjectDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_projectDimensionKey".
 */
export interface TrackedChangesEdFiProjectDimensionKey {
  /**
   * The code representation of the account project dimension.
   */
  code?: string;
  /**
   * The fiscal year for which the account project dimension is valid.
   */
  fiscalYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_projectDimensionKeyChange".
 */
export interface TrackedChangesEdFiProjectDimensionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiProjectDimensionKey;
  newKeyValues?: TrackedChangesEdFiProjectDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_reportCardDelete".
 */
export interface TrackedChangesEdFiReportCardDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiReportCardKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_reportCardKey".
 */
export interface TrackedChangesEdFiReportCardKey {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The state's name of the period for which grades are reported.
   */
  gradingPeriodDescriptor?: string;
  /**
   * The school's descriptive name of the grading period.
   */
  gradingPeriodName?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  gradingPeriodSchoolId?: number;
  /**
   * The identifier for the grading period school year.
   */
  gradingPeriodSchoolYear?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_reportCardKeyChange".
 */
export interface TrackedChangesEdFiReportCardKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiReportCardKey;
  newKeyValues?: TrackedChangesEdFiReportCardKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_restraintEventDelete".
 */
export interface TrackedChangesEdFiRestraintEventDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiRestraintEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_restraintEventKey".
 */
export interface TrackedChangesEdFiRestraintEventKey {
  /**
   * A unique number or alphanumeric code assigned to a restraint event by a school, school system, state, or other agency or entity.
   */
  restraintEventIdentifier?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_restraintEventKeyChange".
 */
export interface TrackedChangesEdFiRestraintEventKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiRestraintEventKey;
  newKeyValues?: TrackedChangesEdFiRestraintEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_schoolDelete".
 */
export interface TrackedChangesEdFiSchoolDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSchoolKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_schoolKey".
 */
export interface TrackedChangesEdFiSchoolKey {
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_schoolKeyChange".
 */
export interface TrackedChangesEdFiSchoolKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSchoolKey;
  newKeyValues?: TrackedChangesEdFiSchoolKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_schoolYearTypeDelete".
 */
export interface TrackedChangesEdFiSchoolYearTypeDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSchoolYearTypeKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_schoolYearTypeKey".
 */
export interface TrackedChangesEdFiSchoolYearTypeKey {
  /**
   * Key for School Year
   */
  schoolYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_schoolYearTypeKeyChange".
 */
export interface TrackedChangesEdFiSchoolYearTypeKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSchoolYearTypeKey;
  newKeyValues?: TrackedChangesEdFiSchoolYearTypeKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_sectionAttendanceTakenEventDelete".
 */
export interface TrackedChangesEdFiSectionAttendanceTakenEventDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSectionAttendanceTakenEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_sectionAttendanceTakenEventKey".
 */
export interface TrackedChangesEdFiSectionAttendanceTakenEventKey {
  /**
   * The identifier for the calendar.
   */
  calendarCode?: string;
  /**
   * The month, day, and year of the calendar event.
   */
  date?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The local code assigned by the School that identifies the course offering provided for the instruction of students.
   */
  localCourseCode?: string;
  /**
   * The local identifier assigned to a section.
   */
  sectionIdentifier?: string;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_sectionAttendanceTakenEventKeyChange".
 */
export interface TrackedChangesEdFiSectionAttendanceTakenEventKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSectionAttendanceTakenEventKey;
  newKeyValues?: TrackedChangesEdFiSectionAttendanceTakenEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_sectionDelete".
 */
export interface TrackedChangesEdFiSectionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSectionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_sectionKey".
 */
export interface TrackedChangesEdFiSectionKey {
  /**
   * The local identifier assigned to a section.
   */
  sectionIdentifier?: string;
  /**
   * The local code assigned by the School that identifies the course offering provided for the instruction of students.
   */
  localCourseCode?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_sectionKeyChange".
 */
export interface TrackedChangesEdFiSectionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSectionKey;
  newKeyValues?: TrackedChangesEdFiSectionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_sessionDelete".
 */
export interface TrackedChangesEdFiSessionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSessionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_sessionKey".
 */
export interface TrackedChangesEdFiSessionKey {
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_sessionKeyChange".
 */
export interface TrackedChangesEdFiSessionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSessionKey;
  newKeyValues?: TrackedChangesEdFiSessionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_sourceDimensionDelete".
 */
export interface TrackedChangesEdFiSourceDimensionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSourceDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_sourceDimensionKey".
 */
export interface TrackedChangesEdFiSourceDimensionKey {
  /**
   * The code representation of the account source dimension.
   */
  code?: string;
  /**
   * The fiscal year for which the account source dimension is valid.
   */
  fiscalYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_sourceDimensionKeyChange".
 */
export interface TrackedChangesEdFiSourceDimensionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSourceDimensionKey;
  newKeyValues?: TrackedChangesEdFiSourceDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffAbsenceEventDelete".
 */
export interface TrackedChangesEdFiStaffAbsenceEventDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStaffAbsenceEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffAbsenceEventKey".
 */
export interface TrackedChangesEdFiStaffAbsenceEventKey {
  /**
   * The code describing the type of absence.
   */
  absenceEventCategoryDescriptor?: string;
  /**
   * Date for this leave event.
   */
  eventDate?: string;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffAbsenceEventKeyChange".
 */
export interface TrackedChangesEdFiStaffAbsenceEventKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStaffAbsenceEventKey;
  newKeyValues?: TrackedChangesEdFiStaffAbsenceEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffCohortAssociationDelete".
 */
export interface TrackedChangesEdFiStaffCohortAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStaffCohortAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffCohortAssociationKey".
 */
export interface TrackedChangesEdFiStaffCohortAssociationKey {
  /**
   * Start date for the association of staff to this cohort.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The name or ID for the cohort.
   */
  cohortIdentifier?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffCohortAssociationKeyChange".
 */
export interface TrackedChangesEdFiStaffCohortAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStaffCohortAssociationKey;
  newKeyValues?: TrackedChangesEdFiStaffCohortAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffDelete".
 */
export interface TrackedChangesEdFiStaffDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStaffKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffKey".
 */
export interface TrackedChangesEdFiStaffKey {
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffDisciplineIncidentAssociationDelete".
 */
export interface TrackedChangesEdFiStaffDisciplineIncidentAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStaffDisciplineIncidentAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffDisciplineIncidentAssociationKey".
 */
export interface TrackedChangesEdFiStaffDisciplineIncidentAssociationKey {
  /**
   * A locally assigned unique identifier (within the school or school district) to identify each specific DisciplineIncident or occurrence. The same identifier should be used to document the entire discipline incident even if it included multiple offenses and multiple offenders.
   */
  incidentIdentifier?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffDisciplineIncidentAssociationKeyChange".
 */
export interface TrackedChangesEdFiStaffDisciplineIncidentAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStaffDisciplineIncidentAssociationKey;
  newKeyValues?: TrackedChangesEdFiStaffDisciplineIncidentAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffEducationOrganizationAssignmentAssociationDelete".
 */
export interface TrackedChangesEdFiStaffEducationOrganizationAssignmentAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStaffEducationOrganizationAssignmentAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffEducationOrganizationAssignmentAssociationKey".
 */
export interface TrackedChangesEdFiStaffEducationOrganizationAssignmentAssociationKey {
  /**
   * The titles of employment, official status, or rank of education staff.
   */
  staffClassificationDescriptor?: string;
  /**
   * Month, day, and year of the start or effective date of a staff member's employment, contract, or relationship with the education organization.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffEducationOrganizationAssignmentAssociationKeyChange".
 */
export interface TrackedChangesEdFiStaffEducationOrganizationAssignmentAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStaffEducationOrganizationAssignmentAssociationKey;
  newKeyValues?: TrackedChangesEdFiStaffEducationOrganizationAssignmentAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffEducationOrganizationContactAssociationDelete".
 */
export interface TrackedChangesEdFiStaffEducationOrganizationContactAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStaffEducationOrganizationContactAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffEducationOrganizationContactAssociationKey".
 */
export interface TrackedChangesEdFiStaffEducationOrganizationContactAssociationKey {
  /**
   * The title of the contact in the context of the education organization.
   */
  contactTitle?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffEducationOrganizationContactAssociationKeyChange".
 */
export interface TrackedChangesEdFiStaffEducationOrganizationContactAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStaffEducationOrganizationContactAssociationKey;
  newKeyValues?: TrackedChangesEdFiStaffEducationOrganizationContactAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffEducationOrganizationEmploymentAssociationDelete".
 */
export interface TrackedChangesEdFiStaffEducationOrganizationEmploymentAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStaffEducationOrganizationEmploymentAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffEducationOrganizationEmploymentAssociationKey".
 */
export interface TrackedChangesEdFiStaffEducationOrganizationEmploymentAssociationKey {
  /**
   * Reflects the type of employment or contract.
   */
  employmentStatusDescriptor?: string;
  /**
   * The month, day, and year on which an individual was hired for a position.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  hireDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffEducationOrganizationEmploymentAssociationKeyChange".
 */
export interface TrackedChangesEdFiStaffEducationOrganizationEmploymentAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStaffEducationOrganizationEmploymentAssociationKey;
  newKeyValues?: TrackedChangesEdFiStaffEducationOrganizationEmploymentAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffKeyChange".
 */
export interface TrackedChangesEdFiStaffKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStaffKey;
  newKeyValues?: TrackedChangesEdFiStaffKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffLeaveDelete".
 */
export interface TrackedChangesEdFiStaffLeaveDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStaffLeaveKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffLeaveKey".
 */
export interface TrackedChangesEdFiStaffLeaveKey {
  /**
   * The code describing the type of leave taken.
   */
  staffLeaveEventCategoryDescriptor?: string;
  /**
   * The begin date of the staff leave.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffLeaveKeyChange".
 */
export interface TrackedChangesEdFiStaffLeaveKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStaffLeaveKey;
  newKeyValues?: TrackedChangesEdFiStaffLeaveKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffProgramAssociationDelete".
 */
export interface TrackedChangesEdFiStaffProgramAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStaffProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffProgramAssociationKey".
 */
export interface TrackedChangesEdFiStaffProgramAssociationKey {
  /**
   * Start date for the association of staff to this program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffProgramAssociationKeyChange".
 */
export interface TrackedChangesEdFiStaffProgramAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStaffProgramAssociationKey;
  newKeyValues?: TrackedChangesEdFiStaffProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffSchoolAssociationDelete".
 */
export interface TrackedChangesEdFiStaffSchoolAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStaffSchoolAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffSchoolAssociationKey".
 */
export interface TrackedChangesEdFiStaffSchoolAssociationKey {
  /**
   * The name of the program for which the individual is assigned.
   */
  programAssignmentDescriptor?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffSchoolAssociationKeyChange".
 */
export interface TrackedChangesEdFiStaffSchoolAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStaffSchoolAssociationKey;
  newKeyValues?: TrackedChangesEdFiStaffSchoolAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffSectionAssociationDelete".
 */
export interface TrackedChangesEdFiStaffSectionAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStaffSectionAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffSectionAssociationKey".
 */
export interface TrackedChangesEdFiStaffSectionAssociationKey {
  /**
   * Month, day, and year of a teacher's assignment to the section.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The local code assigned by the School that identifies the course offering provided for the instruction of students.
   */
  localCourseCode?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The local identifier assigned to a section.
   */
  sectionIdentifier?: string;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName?: string;
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_staffSectionAssociationKeyChange".
 */
export interface TrackedChangesEdFiStaffSectionAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStaffSectionAssociationKey;
  newKeyValues?: TrackedChangesEdFiStaffSectionAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_stateEducationAgencyDelete".
 */
export interface TrackedChangesEdFiStateEducationAgencyDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStateEducationAgencyKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_stateEducationAgencyKey".
 */
export interface TrackedChangesEdFiStateEducationAgencyKey {
  /**
   * The identifier assigned to a state education agency. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  stateEducationAgencyId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_stateEducationAgencyKeyChange".
 */
export interface TrackedChangesEdFiStateEducationAgencyKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStateEducationAgencyKey;
  newKeyValues?: TrackedChangesEdFiStateEducationAgencyKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAcademicRecordDelete".
 */
export interface TrackedChangesEdFiStudentAcademicRecordDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentAcademicRecordKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAcademicRecordKey".
 */
export interface TrackedChangesEdFiStudentAcademicRecordKey {
  /**
   * The term for the session during the school year.
   */
  termDescriptor?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAcademicRecordKeyChange".
 */
export interface TrackedChangesEdFiStudentAcademicRecordKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentAcademicRecordKey;
  newKeyValues?: TrackedChangesEdFiStudentAcademicRecordKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAssessmentDelete".
 */
export interface TrackedChangesEdFiStudentAssessmentDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentAssessmentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAssessmentKey".
 */
export interface TrackedChangesEdFiStudentAssessmentKey {
  /**
   * A unique number or alphanumeric code assigned to an assessment administered to a student.
   */
  studentAssessmentIdentifier?: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier?: string;
  /**
   * Namespace for the assessment.
   */
  namespace?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAssessmentEducationOrganizationAssociationDelete".
 */
export interface TrackedChangesEdFiStudentAssessmentEducationOrganizationAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentAssessmentEducationOrganizationAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAssessmentEducationOrganizationAssociationKey".
 */
export interface TrackedChangesEdFiStudentAssessmentEducationOrganizationAssociationKey {
  /**
   * The type of association being represented.
   */
  educationOrganizationAssociationTypeDescriptor?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier?: string;
  /**
   * Namespace for the assessment.
   */
  namespace?: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment administered to a student.
   */
  studentAssessmentIdentifier?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAssessmentEducationOrganizationAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentAssessmentEducationOrganizationAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentAssessmentEducationOrganizationAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentAssessmentEducationOrganizationAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAssessmentKeyChange".
 */
export interface TrackedChangesEdFiStudentAssessmentKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentAssessmentKey;
  newKeyValues?: TrackedChangesEdFiStudentAssessmentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAssessmentRegistrationBatteryPartAssociationDelete".
 */
export interface TrackedChangesEdFiStudentAssessmentRegistrationBatteryPartAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentAssessmentRegistrationBatteryPartAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAssessmentRegistrationBatteryPartAssociationKey".
 */
export interface TrackedChangesEdFiStudentAssessmentRegistrationBatteryPartAssociationKey {
  /**
   * The name of the part of an assessment battery.
   */
  assessmentBatteryPartName?: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier?: string;
  /**
   * Namespace for the assessment.
   */
  namespace?: string;
  /**
   * The title or name of the assessment in the context of its administration.
   */
  administrationIdentifier?: string;
  /**
   * The identifier assigned to an education organization.
   */
  assigningEducationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAssessmentRegistrationBatteryPartAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentAssessmentRegistrationBatteryPartAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentAssessmentRegistrationBatteryPartAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentAssessmentRegistrationBatteryPartAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAssessmentRegistrationDelete".
 */
export interface TrackedChangesEdFiStudentAssessmentRegistrationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentAssessmentRegistrationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAssessmentRegistrationKey".
 */
export interface TrackedChangesEdFiStudentAssessmentRegistrationKey {
  /**
   * The title or name of the assessment in the context of its administration.
   */
  administrationIdentifier?: string;
  /**
   * A unique number or alphanumeric code assigned to an assessment.
   */
  assessmentIdentifier?: string;
  /**
   * The identifier assigned to an education organization.
   */
  assigningEducationOrganizationId?: number;
  /**
   * Namespace for the assessment.
   */
  namespace?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentAssessmentRegistrationKeyChange".
 */
export interface TrackedChangesEdFiStudentAssessmentRegistrationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentAssessmentRegistrationKey;
  newKeyValues?: TrackedChangesEdFiStudentAssessmentRegistrationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentCohortAssociationDelete".
 */
export interface TrackedChangesEdFiStudentCohortAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentCohortAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentCohortAssociationKey".
 */
export interface TrackedChangesEdFiStudentCohortAssociationKey {
  /**
   * The month, day, and year on which the student was first identified as part of the cohort.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The name or ID for the cohort.
   */
  cohortIdentifier?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentCohortAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentCohortAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentCohortAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentCohortAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentCompetencyObjectiveDelete".
 */
export interface TrackedChangesEdFiStudentCompetencyObjectiveDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentCompetencyObjectiveKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentCompetencyObjectiveKey".
 */
export interface TrackedChangesEdFiStudentCompetencyObjectiveKey {
  /**
   * The identifier assigned to an education organization.
   */
  objectiveEducationOrganizationId?: number;
  /**
   * The designated title of the competency objective.
   */
  objective?: string;
  /**
   * The grade level for which the competency objective is targeted.
   */
  objectiveGradeLevelDescriptor?: string;
  /**
   * The state's name of the period for which grades are reported.
   */
  gradingPeriodDescriptor?: string;
  /**
   * The school's descriptive name of the grading period.
   */
  gradingPeriodName?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  gradingPeriodSchoolId?: number;
  /**
   * The identifier for the grading period school year.
   */
  gradingPeriodSchoolYear?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentCompetencyObjectiveKeyChange".
 */
export interface TrackedChangesEdFiStudentCompetencyObjectiveKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentCompetencyObjectiveKey;
  newKeyValues?: TrackedChangesEdFiStudentCompetencyObjectiveKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentContactAssociationDelete".
 */
export interface TrackedChangesEdFiStudentContactAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentContactAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentContactAssociationKey".
 */
export interface TrackedChangesEdFiStudentContactAssociationKey {
  /**
   * A unique alphanumeric code assigned to a contact.
   */
  contactUniqueId?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentContactAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentContactAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentContactAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentContactAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentCTEProgramAssociationDelete".
 */
export interface TrackedChangesEdFiStudentCTEProgramAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentCTEProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentCTEProgramAssociationKey".
 */
export interface TrackedChangesEdFiStudentCTEProgramAssociationKey {
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentCTEProgramAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentCTEProgramAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentCTEProgramAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentCTEProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentDelete".
 */
export interface TrackedChangesEdFiStudentDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentKey".
 */
export interface TrackedChangesEdFiStudentKey {
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentDisciplineIncidentBehaviorAssociationDelete".
 */
export interface TrackedChangesEdFiStudentDisciplineIncidentBehaviorAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentDisciplineIncidentBehaviorAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentDisciplineIncidentBehaviorAssociationKey".
 */
export interface TrackedChangesEdFiStudentDisciplineIncidentBehaviorAssociationKey {
  /**
   * Describes behavior by category.
   */
  behaviorDescriptor?: string;
  /**
   * A locally assigned unique identifier (within the school or school district) to identify each specific DisciplineIncident or occurrence. The same identifier should be used to document the entire discipline incident even if it included multiple offenses and multiple offenders.
   */
  incidentIdentifier?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentDisciplineIncidentBehaviorAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentDisciplineIncidentBehaviorAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentDisciplineIncidentBehaviorAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentDisciplineIncidentBehaviorAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentDisciplineIncidentNonOffenderAssociationDelete".
 */
export interface TrackedChangesEdFiStudentDisciplineIncidentNonOffenderAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentDisciplineIncidentNonOffenderAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentDisciplineIncidentNonOffenderAssociationKey".
 */
export interface TrackedChangesEdFiStudentDisciplineIncidentNonOffenderAssociationKey {
  /**
   * A locally assigned unique identifier (within the school or school district) to identify each specific DisciplineIncident or occurrence. The same identifier should be used to document the entire discipline incident even if it included multiple offenses and multiple offenders.
   */
  incidentIdentifier?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentDisciplineIncidentNonOffenderAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentDisciplineIncidentNonOffenderAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentDisciplineIncidentNonOffenderAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentDisciplineIncidentNonOffenderAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentEducationOrganizationAssessmentAccommodationDelete".
 */
export interface TrackedChangesEdFiStudentEducationOrganizationAssessmentAccommodationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentEducationOrganizationAssessmentAccommodationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentEducationOrganizationAssessmentAccommodationKey".
 */
export interface TrackedChangesEdFiStudentEducationOrganizationAssessmentAccommodationKey {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentEducationOrganizationAssessmentAccommodationKeyChange".
 */
export interface TrackedChangesEdFiStudentEducationOrganizationAssessmentAccommodationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentEducationOrganizationAssessmentAccommodationKey;
  newKeyValues?: TrackedChangesEdFiStudentEducationOrganizationAssessmentAccommodationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentEducationOrganizationAssociationDelete".
 */
export interface TrackedChangesEdFiStudentEducationOrganizationAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentEducationOrganizationAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentEducationOrganizationAssociationKey".
 */
export interface TrackedChangesEdFiStudentEducationOrganizationAssociationKey {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentEducationOrganizationAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentEducationOrganizationAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentEducationOrganizationAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentEducationOrganizationAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentEducationOrganizationResponsibilityAssociationDelete".
 */
export interface TrackedChangesEdFiStudentEducationOrganizationResponsibilityAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentEducationOrganizationResponsibilityAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentEducationOrganizationResponsibilityAssociationKey".
 */
export interface TrackedChangesEdFiStudentEducationOrganizationResponsibilityAssociationKey {
  /**
   * Indications of an education organization's responsibility for a student, such as accountability, attendance, funding, etc.
   */
  responsibilityDescriptor?: string;
  /**
   * Month, day, and year of the start date of an education organization's responsibility for a student.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentEducationOrganizationResponsibilityAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentEducationOrganizationResponsibilityAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentEducationOrganizationResponsibilityAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentEducationOrganizationResponsibilityAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentGradebookEntryDelete".
 */
export interface TrackedChangesEdFiStudentGradebookEntryDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentGradebookEntryKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentGradebookEntryKey".
 */
export interface TrackedChangesEdFiStudentGradebookEntryKey {
  /**
   * A unique number or alphanumeric code assigned to a gradebook entry by the source system.
   */
  gradebookEntryIdentifier?: string;
  /**
   * Namespace URI for the source of the gradebook entry.
   */
  namespace?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentGradebookEntryKeyChange".
 */
export interface TrackedChangesEdFiStudentGradebookEntryKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentGradebookEntryKey;
  newKeyValues?: TrackedChangesEdFiStudentGradebookEntryKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentHealthDelete".
 */
export interface TrackedChangesEdFiStudentHealthDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentHealthKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentHealthKey".
 */
export interface TrackedChangesEdFiStudentHealthKey {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentHealthKeyChange".
 */
export interface TrackedChangesEdFiStudentHealthKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentHealthKey;
  newKeyValues?: TrackedChangesEdFiStudentHealthKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentHomelessProgramAssociationDelete".
 */
export interface TrackedChangesEdFiStudentHomelessProgramAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentHomelessProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentHomelessProgramAssociationKey".
 */
export interface TrackedChangesEdFiStudentHomelessProgramAssociationKey {
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentHomelessProgramAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentHomelessProgramAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentHomelessProgramAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentHomelessProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentInterventionAssociationDelete".
 */
export interface TrackedChangesEdFiStudentInterventionAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentInterventionAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentInterventionAssociationKey".
 */
export interface TrackedChangesEdFiStudentInterventionAssociationKey {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique number or alphanumeric code assigned to an intervention.
   */
  interventionIdentificationCode?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentInterventionAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentInterventionAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentInterventionAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentInterventionAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentInterventionAttendanceEventDelete".
 */
export interface TrackedChangesEdFiStudentInterventionAttendanceEventDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentInterventionAttendanceEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentInterventionAttendanceEventKey".
 */
export interface TrackedChangesEdFiStudentInterventionAttendanceEventKey {
  /**
   * A code describing the attendance event, for example:         Present         Unexcused absence         Excused absence         Tardy.
   */
  attendanceEventCategoryDescriptor?: string;
  /**
   * Date for this attendance event.
   */
  eventDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * A unique number or alphanumeric code assigned to an intervention.
   */
  interventionIdentificationCode?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentInterventionAttendanceEventKeyChange".
 */
export interface TrackedChangesEdFiStudentInterventionAttendanceEventKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentInterventionAttendanceEventKey;
  newKeyValues?: TrackedChangesEdFiStudentInterventionAttendanceEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentKeyChange".
 */
export interface TrackedChangesEdFiStudentKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentKey;
  newKeyValues?: TrackedChangesEdFiStudentKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentLanguageInstructionProgramAssociationDelete".
 */
export interface TrackedChangesEdFiStudentLanguageInstructionProgramAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentLanguageInstructionProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentLanguageInstructionProgramAssociationKey".
 */
export interface TrackedChangesEdFiStudentLanguageInstructionProgramAssociationKey {
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentLanguageInstructionProgramAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentLanguageInstructionProgramAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentLanguageInstructionProgramAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentLanguageInstructionProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentMigrantEducationProgramAssociationDelete".
 */
export interface TrackedChangesEdFiStudentMigrantEducationProgramAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentMigrantEducationProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentMigrantEducationProgramAssociationKey".
 */
export interface TrackedChangesEdFiStudentMigrantEducationProgramAssociationKey {
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentMigrantEducationProgramAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentMigrantEducationProgramAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentMigrantEducationProgramAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentMigrantEducationProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentNeglectedOrDelinquentProgramAssociationDelete".
 */
export interface TrackedChangesEdFiStudentNeglectedOrDelinquentProgramAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentNeglectedOrDelinquentProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentNeglectedOrDelinquentProgramAssociationKey".
 */
export interface TrackedChangesEdFiStudentNeglectedOrDelinquentProgramAssociationKey {
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentNeglectedOrDelinquentProgramAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentNeglectedOrDelinquentProgramAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentNeglectedOrDelinquentProgramAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentNeglectedOrDelinquentProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentProgramAssociationDelete".
 */
export interface TrackedChangesEdFiStudentProgramAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentProgramAssociationKey".
 */
export interface TrackedChangesEdFiStudentProgramAssociationKey {
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentProgramAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentProgramAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentProgramAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentProgramAttendanceEventDelete".
 */
export interface TrackedChangesEdFiStudentProgramAttendanceEventDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentProgramAttendanceEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentProgramAttendanceEventKey".
 */
export interface TrackedChangesEdFiStudentProgramAttendanceEventKey {
  /**
   * A code describing the attendance event, for example:         Present         Unexcused absence         Excused absence         Tardy.
   */
  attendanceEventCategoryDescriptor?: string;
  /**
   * Date for this attendance event.
   */
  eventDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentProgramAttendanceEventKeyChange".
 */
export interface TrackedChangesEdFiStudentProgramAttendanceEventKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentProgramAttendanceEventKey;
  newKeyValues?: TrackedChangesEdFiStudentProgramAttendanceEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentProgramEvaluationDelete".
 */
export interface TrackedChangesEdFiStudentProgramEvaluationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentProgramEvaluationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentProgramEvaluationKey".
 */
export interface TrackedChangesEdFiStudentProgramEvaluationKey {
  /**
   * The month, day, and year on which the evaluation was conducted.
   */
  evaluationDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The name of the period for the program evaluation.
   */
  programEvaluationPeriodDescriptor?: string;
  /**
   * An assigned unique identifier for the student program evaluation.
   */
  programEvaluationTitle?: string;
  /**
   * The type of program evaluation conducted.
   */
  programEvaluationTypeDescriptor?: string;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentProgramEvaluationKeyChange".
 */
export interface TrackedChangesEdFiStudentProgramEvaluationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentProgramEvaluationKey;
  newKeyValues?: TrackedChangesEdFiStudentProgramEvaluationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSchoolAssociationDelete".
 */
export interface TrackedChangesEdFiStudentSchoolAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentSchoolAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSchoolAssociationKey".
 */
export interface TrackedChangesEdFiStudentSchoolAssociationKey {
  /**
   * The month, day, and year on which an individual enters and begins to receive instructional services in a school for each school year. The EntryDate value should be the date the student enrolled, or when the student's enrollment materially changed, such as with a grade promotion.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  entryDate?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSchoolAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentSchoolAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentSchoolAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentSchoolAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSchoolAttendanceEventDelete".
 */
export interface TrackedChangesEdFiStudentSchoolAttendanceEventDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentSchoolAttendanceEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSchoolAttendanceEventKey".
 */
export interface TrackedChangesEdFiStudentSchoolAttendanceEventKey {
  /**
   * A code describing the attendance event, for example:         Present         Unexcused absence         Excused absence         Tardy.
   */
  attendanceEventCategoryDescriptor?: string;
  /**
   * Date for this attendance event.
   */
  eventDate?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSchoolAttendanceEventKeyChange".
 */
export interface TrackedChangesEdFiStudentSchoolAttendanceEventKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentSchoolAttendanceEventKey;
  newKeyValues?: TrackedChangesEdFiStudentSchoolAttendanceEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSchoolFoodServiceProgramAssociationDelete".
 */
export interface TrackedChangesEdFiStudentSchoolFoodServiceProgramAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentSchoolFoodServiceProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSchoolFoodServiceProgramAssociationKey".
 */
export interface TrackedChangesEdFiStudentSchoolFoodServiceProgramAssociationKey {
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSchoolFoodServiceProgramAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentSchoolFoodServiceProgramAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentSchoolFoodServiceProgramAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentSchoolFoodServiceProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSection504ProgramAssociationDelete".
 */
export interface TrackedChangesEdFiStudentSection504ProgramAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentSection504ProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSection504ProgramAssociationKey".
 */
export interface TrackedChangesEdFiStudentSection504ProgramAssociationKey {
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSection504ProgramAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentSection504ProgramAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentSection504ProgramAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentSection504ProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSectionAssociationDelete".
 */
export interface TrackedChangesEdFiStudentSectionAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentSectionAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSectionAssociationKey".
 */
export interface TrackedChangesEdFiStudentSectionAssociationKey {
  /**
   * Month, day, and year of the student's entry or assignment to the section.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The local code assigned by the School that identifies the course offering provided for the instruction of students.
   */
  localCourseCode?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The local identifier assigned to a section.
   */
  sectionIdentifier?: string;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSectionAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentSectionAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentSectionAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentSectionAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSectionAttendanceEventDelete".
 */
export interface TrackedChangesEdFiStudentSectionAttendanceEventDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentSectionAttendanceEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSectionAttendanceEventKey".
 */
export interface TrackedChangesEdFiStudentSectionAttendanceEventKey {
  /**
   * A code describing the attendance event, for example:         Present         Unexcused absence         Excused absence         Tardy.
   */
  attendanceEventCategoryDescriptor?: string;
  /**
   * Date for this attendance event.
   */
  eventDate?: string;
  /**
   * The local code assigned by the School that identifies the course offering provided for the instruction of students.
   */
  localCourseCode?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The local identifier assigned to a section.
   */
  sectionIdentifier?: string;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSectionAttendanceEventKeyChange".
 */
export interface TrackedChangesEdFiStudentSectionAttendanceEventKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentSectionAttendanceEventKey;
  newKeyValues?: TrackedChangesEdFiStudentSectionAttendanceEventKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSpecialEducationProgramAssociationDelete".
 */
export interface TrackedChangesEdFiStudentSpecialEducationProgramAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentSpecialEducationProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSpecialEducationProgramAssociationKey".
 */
export interface TrackedChangesEdFiStudentSpecialEducationProgramAssociationKey {
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSpecialEducationProgramAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentSpecialEducationProgramAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentSpecialEducationProgramAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentSpecialEducationProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSpecialEducationProgramEligibilityAssociationDelete".
 */
export interface TrackedChangesEdFiStudentSpecialEducationProgramEligibilityAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentSpecialEducationProgramEligibilityAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSpecialEducationProgramEligibilityAssociationKey".
 */
export interface TrackedChangesEdFiStudentSpecialEducationProgramEligibilityAssociationKey {
  /**
   * Indicates the date on which the local education agency received written consent for the evaluation from the student's parent or guardian. This is the first day of the evaluation timeframe.
   */
  consentToEvaluationReceivedDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentSpecialEducationProgramEligibilityAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentSpecialEducationProgramEligibilityAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentSpecialEducationProgramEligibilityAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentSpecialEducationProgramEligibilityAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentTitleIPartAProgramAssociationDelete".
 */
export interface TrackedChangesEdFiStudentTitleIPartAProgramAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentTitleIPartAProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentTitleIPartAProgramAssociationKey".
 */
export interface TrackedChangesEdFiStudentTitleIPartAProgramAssociationKey {
  /**
   * The earliest date the student is involved with the program. Typically, this is the date the student becomes eligible for the program.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier assigned to an education organization.
   */
  programEducationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentTitleIPartAProgramAssociationKeyChange".
 */
export interface TrackedChangesEdFiStudentTitleIPartAProgramAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentTitleIPartAProgramAssociationKey;
  newKeyValues?: TrackedChangesEdFiStudentTitleIPartAProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentTransportationDelete".
 */
export interface TrackedChangesEdFiStudentTransportationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiStudentTransportationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentTransportationKey".
 */
export interface TrackedChangesEdFiStudentTransportationKey {
  /**
   * The identifier assigned to an education organization.
   */
  transportationEducationOrganizationId?: number;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_studentTransportationKeyChange".
 */
export interface TrackedChangesEdFiStudentTransportationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiStudentTransportationKey;
  newKeyValues?: TrackedChangesEdFiStudentTransportationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyCourseAssociationDelete".
 */
export interface TrackedChangesEdFiSurveyCourseAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSurveyCourseAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyCourseAssociationKey".
 */
export interface TrackedChangesEdFiSurveyCourseAssociationKey {
  /**
   * A unique alphanumeric code assigned to a course.
   */
  courseCode?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyCourseAssociationKeyChange".
 */
export interface TrackedChangesEdFiSurveyCourseAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSurveyCourseAssociationKey;
  newKeyValues?: TrackedChangesEdFiSurveyCourseAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyDelete".
 */
export interface TrackedChangesEdFiSurveyDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSurveyKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyKey".
 */
export interface TrackedChangesEdFiSurveyKey {
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyKeyChange".
 */
export interface TrackedChangesEdFiSurveyKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSurveyKey;
  newKeyValues?: TrackedChangesEdFiSurveyKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyProgramAssociationDelete".
 */
export interface TrackedChangesEdFiSurveyProgramAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSurveyProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyProgramAssociationKey".
 */
export interface TrackedChangesEdFiSurveyProgramAssociationKey {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The formal name of the program of instruction, training, services, or benefits available through federal, state, or local agencies.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyProgramAssociationKeyChange".
 */
export interface TrackedChangesEdFiSurveyProgramAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSurveyProgramAssociationKey;
  newKeyValues?: TrackedChangesEdFiSurveyProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyQuestionDelete".
 */
export interface TrackedChangesEdFiSurveyQuestionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSurveyQuestionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyQuestionKey".
 */
export interface TrackedChangesEdFiSurveyQuestionKey {
  /**
   * The identifying code for the question, unique for the survey.
   */
  questionCode?: string;
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyQuestionKeyChange".
 */
export interface TrackedChangesEdFiSurveyQuestionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSurveyQuestionKey;
  newKeyValues?: TrackedChangesEdFiSurveyQuestionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyQuestionResponseDelete".
 */
export interface TrackedChangesEdFiSurveyQuestionResponseDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSurveyQuestionResponseKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyQuestionResponseKey".
 */
export interface TrackedChangesEdFiSurveyQuestionResponseKey {
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The identifying code for the question, unique for the survey.
   */
  questionCode?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  /**
   * The identifier of the survey typically from the survey application.
   */
  surveyResponseIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyQuestionResponseKeyChange".
 */
export interface TrackedChangesEdFiSurveyQuestionResponseKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSurveyQuestionResponseKey;
  newKeyValues?: TrackedChangesEdFiSurveyQuestionResponseKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyResponseDelete".
 */
export interface TrackedChangesEdFiSurveyResponseDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSurveyResponseKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyResponseKey".
 */
export interface TrackedChangesEdFiSurveyResponseKey {
  /**
   * The identifier of the survey typically from the survey application.
   */
  surveyResponseIdentifier?: string;
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyResponseEducationOrganizationTargetAssociationDelete".
 */
export interface TrackedChangesEdFiSurveyResponseEducationOrganizationTargetAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSurveyResponseEducationOrganizationTargetAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyResponseEducationOrganizationTargetAssociationKey".
 */
export interface TrackedChangesEdFiSurveyResponseEducationOrganizationTargetAssociationKey {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  /**
   * The identifier of the survey typically from the survey application.
   */
  surveyResponseIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyResponseEducationOrganizationTargetAssociationKeyChange".
 */
export interface TrackedChangesEdFiSurveyResponseEducationOrganizationTargetAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSurveyResponseEducationOrganizationTargetAssociationKey;
  newKeyValues?: TrackedChangesEdFiSurveyResponseEducationOrganizationTargetAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyResponseKeyChange".
 */
export interface TrackedChangesEdFiSurveyResponseKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSurveyResponseKey;
  newKeyValues?: TrackedChangesEdFiSurveyResponseKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyResponseStaffTargetAssociationDelete".
 */
export interface TrackedChangesEdFiSurveyResponseStaffTargetAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSurveyResponseStaffTargetAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyResponseStaffTargetAssociationKey".
 */
export interface TrackedChangesEdFiSurveyResponseStaffTargetAssociationKey {
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  /**
   * The identifier of the survey typically from the survey application.
   */
  surveyResponseIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveyResponseStaffTargetAssociationKeyChange".
 */
export interface TrackedChangesEdFiSurveyResponseStaffTargetAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSurveyResponseStaffTargetAssociationKey;
  newKeyValues?: TrackedChangesEdFiSurveyResponseStaffTargetAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionAssociationDelete".
 */
export interface TrackedChangesEdFiSurveySectionAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSurveySectionAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionAssociationKey".
 */
export interface TrackedChangesEdFiSurveySectionAssociationKey {
  /**
   * The local code assigned by the School that identifies the course offering provided for the instruction of students.
   */
  localCourseCode?: string;
  /**
   * The identifier assigned to a school. It must be distinct from any other identifier assigned to educational organizations, such as a LocalEducationAgencyId, to prevent duplication.
   */
  schoolId?: number;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The local identifier assigned to a section.
   */
  sectionIdentifier?: string;
  /**
   * The identifier for the calendar for the academic session.
   */
  sessionName?: string;
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionAssociationKeyChange".
 */
export interface TrackedChangesEdFiSurveySectionAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSurveySectionAssociationKey;
  newKeyValues?: TrackedChangesEdFiSurveySectionAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionDelete".
 */
export interface TrackedChangesEdFiSurveySectionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSurveySectionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionKey".
 */
export interface TrackedChangesEdFiSurveySectionKey {
  /**
   * The title or label for the survey section.
   */
  surveySectionTitle?: string;
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionKeyChange".
 */
export interface TrackedChangesEdFiSurveySectionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSurveySectionKey;
  newKeyValues?: TrackedChangesEdFiSurveySectionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionResponseDelete".
 */
export interface TrackedChangesEdFiSurveySectionResponseDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSurveySectionResponseKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionResponseKey".
 */
export interface TrackedChangesEdFiSurveySectionResponseKey {
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  /**
   * The identifier of the survey typically from the survey application.
   */
  surveyResponseIdentifier?: string;
  /**
   * The title or label for the survey section.
   */
  surveySectionTitle?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionResponseEducationOrganizationTargetAssociationDelete".
 */
export interface TrackedChangesEdFiSurveySectionResponseEducationOrganizationTargetAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSurveySectionResponseEducationOrganizationTargetAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionResponseEducationOrganizationTargetAssociationKey".
 */
export interface TrackedChangesEdFiSurveySectionResponseEducationOrganizationTargetAssociationKey {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  /**
   * The identifier of the survey typically from the survey application.
   */
  surveyResponseIdentifier?: string;
  /**
   * The title or label for the survey section.
   */
  surveySectionTitle?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionResponseEducationOrganizationTargetAssociationKeyChange".
 */
export interface TrackedChangesEdFiSurveySectionResponseEducationOrganizationTargetAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSurveySectionResponseEducationOrganizationTargetAssociationKey;
  newKeyValues?: TrackedChangesEdFiSurveySectionResponseEducationOrganizationTargetAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionResponseKeyChange".
 */
export interface TrackedChangesEdFiSurveySectionResponseKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSurveySectionResponseKey;
  newKeyValues?: TrackedChangesEdFiSurveySectionResponseKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionResponseStaffTargetAssociationDelete".
 */
export interface TrackedChangesEdFiSurveySectionResponseStaffTargetAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesEdFiSurveySectionResponseStaffTargetAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionResponseStaffTargetAssociationKey".
 */
export interface TrackedChangesEdFiSurveySectionResponseStaffTargetAssociationKey {
  /**
   * A unique alphanumeric code assigned to a staff.
   */
  staffUniqueId?: string;
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  /**
   * The identifier of the survey typically from the survey application.
   */
  surveyResponseIdentifier?: string;
  /**
   * The title or label for the survey section.
   */
  surveySectionTitle?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_edFi_surveySectionResponseStaffTargetAssociationKeyChange".
 */
export interface TrackedChangesEdFiSurveySectionResponseStaffTargetAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesEdFiSurveySectionResponseStaffTargetAssociationKey;
  newKeyValues?: TrackedChangesEdFiSurveySectionResponseStaffTargetAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_candidateDelete".
 */
export interface TrackedChangesTpdmCandidateDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmCandidateKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_candidateKey".
 */
export interface TrackedChangesTpdmCandidateKey {
  /**
   * A unique alphanumeric code assigned to a candidate.
   */
  candidateIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_candidateEducatorPreparationProgramAssociationDelete".
 */
export interface TrackedChangesTpdmCandidateEducatorPreparationProgramAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmCandidateEducatorPreparationProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_candidateEducatorPreparationProgramAssociationKey".
 */
export interface TrackedChangesTpdmCandidateEducatorPreparationProgramAssociationKey {
  /**
   * The begin date for the association.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * A unique alphanumeric code assigned to a candidate.
   */
  candidateIdentifier?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The name of the Educator Preparation Program.
   */
  programName?: string;
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_candidateEducatorPreparationProgramAssociationKeyChange".
 */
export interface TrackedChangesTpdmCandidateEducatorPreparationProgramAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmCandidateEducatorPreparationProgramAssociationKey;
  newKeyValues?: TrackedChangesTpdmCandidateEducatorPreparationProgramAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_candidateKeyChange".
 */
export interface TrackedChangesTpdmCandidateKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmCandidateKey;
  newKeyValues?: TrackedChangesTpdmCandidateKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_educatorPreparationProgramDelete".
 */
export interface TrackedChangesTpdmEducatorPreparationProgramDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmEducatorPreparationProgramKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_educatorPreparationProgramKey".
 */
export interface TrackedChangesTpdmEducatorPreparationProgramKey {
  /**
   * The type of program.
   */
  programTypeDescriptor?: string;
  /**
   * The name of the Educator Preparation Program.
   */
  programName?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_educatorPreparationProgramKeyChange".
 */
export interface TrackedChangesTpdmEducatorPreparationProgramKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmEducatorPreparationProgramKey;
  newKeyValues?: TrackedChangesTpdmEducatorPreparationProgramKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationDelete".
 */
export interface TrackedChangesTpdmEvaluationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmEvaluationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationKey".
 */
export interface TrackedChangesTpdmEvaluationKey {
  /**
   * The name or title of the evaluation.
   */
  evaluationTitle?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor?: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle?: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor?: string;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The term for the session during the school year.
   */
  termDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationElementDelete".
 */
export interface TrackedChangesTpdmEvaluationElementDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmEvaluationElementKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationElementKey".
 */
export interface TrackedChangesTpdmEvaluationElementKey {
  /**
   * The name or title of the evaluation element.
   */
  evaluationElementTitle?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The name or title of the evaluation Objective.
   */
  evaluationObjectiveTitle?: string;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor?: string;
  /**
   * The name or title of the evaluation.
   */
  evaluationTitle?: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle?: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor?: string;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The term for the session during the school year.
   */
  termDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationElementKeyChange".
 */
export interface TrackedChangesTpdmEvaluationElementKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmEvaluationElementKey;
  newKeyValues?: TrackedChangesTpdmEvaluationElementKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationElementRatingDelete".
 */
export interface TrackedChangesTpdmEvaluationElementRatingDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmEvaluationElementRatingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationElementRatingKey".
 */
export interface TrackedChangesTpdmEvaluationElementRatingKey {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The name or title of the evaluation element.
   */
  evaluationElementTitle?: string;
  /**
   * The name or title of the evaluation Objective.
   */
  evaluationObjectiveTitle?: string;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor?: string;
  /**
   * The name or title of the evaluation.
   */
  evaluationTitle?: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle?: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor?: string;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The term for the session during the school year.
   */
  termDescriptor?: string;
  /**
   * The date for the person's evaluation.
   */
  evaluationDate?: string;
  /**
   * A unique alphanumeric code assigned to a person.
   */
  personId?: string;
  /**
   * This descriptor defines the originating record source system for the person.
   */
  sourceSystemDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationElementRatingKeyChange".
 */
export interface TrackedChangesTpdmEvaluationElementRatingKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmEvaluationElementRatingKey;
  newKeyValues?: TrackedChangesTpdmEvaluationElementRatingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationKeyChange".
 */
export interface TrackedChangesTpdmEvaluationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmEvaluationKey;
  newKeyValues?: TrackedChangesTpdmEvaluationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationObjectiveDelete".
 */
export interface TrackedChangesTpdmEvaluationObjectiveDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmEvaluationObjectiveKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationObjectiveKey".
 */
export interface TrackedChangesTpdmEvaluationObjectiveKey {
  /**
   * The name or title of the evaluation Objective.
   */
  evaluationObjectiveTitle?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor?: string;
  /**
   * The name or title of the evaluation.
   */
  evaluationTitle?: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle?: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor?: string;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The term for the session during the school year.
   */
  termDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationObjectiveKeyChange".
 */
export interface TrackedChangesTpdmEvaluationObjectiveKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmEvaluationObjectiveKey;
  newKeyValues?: TrackedChangesTpdmEvaluationObjectiveKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationObjectiveRatingDelete".
 */
export interface TrackedChangesTpdmEvaluationObjectiveRatingDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmEvaluationObjectiveRatingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationObjectiveRatingKey".
 */
export interface TrackedChangesTpdmEvaluationObjectiveRatingKey {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The name or title of the evaluation Objective.
   */
  evaluationObjectiveTitle?: string;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor?: string;
  /**
   * The name or title of the evaluation.
   */
  evaluationTitle?: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle?: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor?: string;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The term for the session during the school year.
   */
  termDescriptor?: string;
  /**
   * The date for the person's evaluation.
   */
  evaluationDate?: string;
  /**
   * A unique alphanumeric code assigned to a person.
   */
  personId?: string;
  /**
   * This descriptor defines the originating record source system for the person.
   */
  sourceSystemDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationObjectiveRatingKeyChange".
 */
export interface TrackedChangesTpdmEvaluationObjectiveRatingKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmEvaluationObjectiveRatingKey;
  newKeyValues?: TrackedChangesTpdmEvaluationObjectiveRatingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationRatingDelete".
 */
export interface TrackedChangesTpdmEvaluationRatingDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmEvaluationRatingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationRatingKey".
 */
export interface TrackedChangesTpdmEvaluationRatingKey {
  /**
   * The date for the person's evaluation.
   */
  evaluationDate?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor?: string;
  /**
   * The name or title of the evaluation.
   */
  evaluationTitle?: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle?: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor?: string;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The term for the session during the school year.
   */
  termDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a person.
   */
  personId?: string;
  /**
   * This descriptor defines the originating record source system for the person.
   */
  sourceSystemDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_evaluationRatingKeyChange".
 */
export interface TrackedChangesTpdmEvaluationRatingKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmEvaluationRatingKey;
  newKeyValues?: TrackedChangesTpdmEvaluationRatingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_financialAidDelete".
 */
export interface TrackedChangesTpdmFinancialAidDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmFinancialAidKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_financialAidKey".
 */
export interface TrackedChangesTpdmFinancialAidKey {
  /**
   * The classification of financial aid awarded to a person for the academic term/year.
   */
  aidTypeDescriptor?: string;
  /**
   * The date the award was designated.  Note: Date interpretation may vary. Ed-Fi recommends inclusive dates, but states may define dates as inclusive or exclusive. For calculations, align with local guidelines.
   */
  beginDate?: string;
  /**
   * A unique alphanumeric code assigned to a student.
   */
  studentUniqueId?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_financialAidKeyChange".
 */
export interface TrackedChangesTpdmFinancialAidKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmFinancialAidKey;
  newKeyValues?: TrackedChangesTpdmFinancialAidKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_performanceEvaluationDelete".
 */
export interface TrackedChangesTpdmPerformanceEvaluationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmPerformanceEvaluationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_performanceEvaluationKey".
 */
export interface TrackedChangesTpdmPerformanceEvaluationKey {
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor?: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor?: string;
  /**
   * The term for the session during the school year.
   */
  termDescriptor?: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle?: string;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_performanceEvaluationKeyChange".
 */
export interface TrackedChangesTpdmPerformanceEvaluationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmPerformanceEvaluationKey;
  newKeyValues?: TrackedChangesTpdmPerformanceEvaluationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_performanceEvaluationRatingDelete".
 */
export interface TrackedChangesTpdmPerformanceEvaluationRatingDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmPerformanceEvaluationRatingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_performanceEvaluationRatingKey".
 */
export interface TrackedChangesTpdmPerformanceEvaluationRatingKey {
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor?: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle?: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor?: string;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The term for the session during the school year.
   */
  termDescriptor?: string;
  /**
   * A unique alphanumeric code assigned to a person.
   */
  personId?: string;
  /**
   * This descriptor defines the originating record source system for the person.
   */
  sourceSystemDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_performanceEvaluationRatingKeyChange".
 */
export interface TrackedChangesTpdmPerformanceEvaluationRatingKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmPerformanceEvaluationRatingKey;
  newKeyValues?: TrackedChangesTpdmPerformanceEvaluationRatingKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_rubricDimensionDelete".
 */
export interface TrackedChangesTpdmRubricDimensionDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmRubricDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_rubricDimensionKey".
 */
export interface TrackedChangesTpdmRubricDimensionKey {
  /**
   * The rating achieved for the rubric dimension.
   */
  rubricRating?: number;
  /**
   * The identifier assigned to an education organization.
   */
  educationOrganizationId?: number;
  /**
   * The name or title of the evaluation element.
   */
  evaluationElementTitle?: string;
  /**
   * The name or title of the evaluation Objective.
   */
  evaluationObjectiveTitle?: string;
  /**
   * The period for the evaluation.
   */
  evaluationPeriodDescriptor?: string;
  /**
   * The name or title of the evaluation.
   */
  evaluationTitle?: string;
  /**
   * An assigned unique identifier for the performance evaluation.
   */
  performanceEvaluationTitle?: string;
  /**
   * The type of performance evaluation conducted.
   */
  performanceEvaluationTypeDescriptor?: string;
  /**
   * The identifier for the school year.
   */
  schoolYear?: number;
  /**
   * The term for the session during the school year.
   */
  termDescriptor?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_rubricDimensionKeyChange".
 */
export interface TrackedChangesTpdmRubricDimensionKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmRubricDimensionKey;
  newKeyValues?: TrackedChangesTpdmRubricDimensionKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_surveyResponsePersonTargetAssociationDelete".
 */
export interface TrackedChangesTpdmSurveyResponsePersonTargetAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmSurveyResponsePersonTargetAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_surveyResponsePersonTargetAssociationKey".
 */
export interface TrackedChangesTpdmSurveyResponsePersonTargetAssociationKey {
  /**
   * A unique alphanumeric code assigned to a person.
   */
  personId?: string;
  /**
   * This descriptor defines the originating record source system for the person.
   */
  sourceSystemDescriptor?: string;
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  /**
   * The identifier of the survey typically from the survey application.
   */
  surveyResponseIdentifier?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_surveyResponsePersonTargetAssociationKeyChange".
 */
export interface TrackedChangesTpdmSurveyResponsePersonTargetAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmSurveyResponsePersonTargetAssociationKey;
  newKeyValues?: TrackedChangesTpdmSurveyResponsePersonTargetAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_surveySectionResponsePersonTargetAssociationDelete".
 */
export interface TrackedChangesTpdmSurveySectionResponsePersonTargetAssociationDelete {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  keyValues?: TrackedChangesTpdmSurveySectionResponsePersonTargetAssociationKey;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_surveySectionResponsePersonTargetAssociationKey".
 */
export interface TrackedChangesTpdmSurveySectionResponsePersonTargetAssociationKey {
  /**
   * A unique alphanumeric code assigned to a person.
   */
  personId?: string;
  /**
   * This descriptor defines the originating record source system for the person.
   */
  sourceSystemDescriptor?: string;
  /**
   * Namespace for the survey.
   */
  namespace?: string;
  /**
   * The unique survey identifier from the survey tool.
   */
  surveyIdentifier?: string;
  /**
   * The identifier of the survey typically from the survey application.
   */
  surveyResponseIdentifier?: string;
  /**
   * The title or label for the survey section.
   */
  surveySectionTitle?: string;
  [k: string]: any | undefined;
}
/**
 * This interface was referenced by `GeneralStudentProgramAssociationProgramParticipationStatus`'s JSON-Schema
 * via the `definition` "trackedChanges_tpdm_surveySectionResponsePersonTargetAssociationKeyChange".
 */
export interface TrackedChangesTpdmSurveySectionResponsePersonTargetAssociationKeyChange {
  /**
   * Resource identifier
   */
  id?: string;
  /**
   * Change version
   */
  changeVersion?: number;
  oldKeyValues?: TrackedChangesTpdmSurveySectionResponsePersonTargetAssociationKey;
  newKeyValues?: TrackedChangesTpdmSurveySectionResponsePersonTargetAssociationKey;
  [k: string]: any | undefined;
}
