/**
 * Education Organization Ed-Fi Mapper
 *
 * Converts EdForge Education Organization data (School, LEA, SEA, ESC) to
 * Ed-Fi Data Standard format for compliance export.
 * Ed-Fi Data Standard v6.0: https://docs.ed-fi.org/reference/data-exchange/data-standard/
 */

import type { SchoolResponseDto } from '../../schemas/identity/school.schema';
import type { SeaResponseDto } from '../../schemas/identity/state-education-agency.schema';
import type { LeaResponseDto } from '../../schemas/identity/local-education-agency.schema';
import type { EscResponseDto } from '../../schemas/identity/education-service-center.schema';
import type { NetworkResponseDto } from '../../schemas/identity/education-org-network.schema';
import type { EducationOrgAddress, EducationOrgIdentificationCode, InstitutionTelephone } from '../../schemas/identity/education-organization.schema';

// ============================================================================
// Ed-Fi Resource Interfaces
// ============================================================================

export interface EdFiSchool {
  schoolId: number;
  nameOfInstitution: string;
  shortNameOfInstitution?: string;
  webSite?: string;
  operationalStatusDescriptor?: string;
  schoolCategories?: EdFiDescriptorRef[];
  schoolTypeDescriptor?: string;
  gradeLevels?: EdFiDescriptorRef[];
  charterStatusDescriptor?: string;
  administrativeFundingControlDescriptor?: string;
  titleIPartASchoolDesignationDescriptor?: string;
  addresses?: EdFiEducationOrganizationAddress[];
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  institutionTelephones?: EdFiInstitutionTelephone[];
  localEducationAgencyReference?: { localEducationAgencyId: number };
  _ext?: EdForgeSchoolExtension;
}

export interface EdFiLocalEducationAgency {
  localEducationAgencyId: number;
  nameOfInstitution: string;
  shortNameOfInstitution?: string;
  webSite?: string;
  operationalStatusDescriptor: string;
  localEducationAgencyCategoryDescriptor: string;
  charterStatusDescriptor?: string;
  categories?: EdFiDescriptorRef[];
  addresses?: EdFiEducationOrganizationAddress[];
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  institutionTelephones?: EdFiInstitutionTelephone[];
  stateEducationAgencyReference?: { stateEducationAgencyId: number };
  educationServiceCenterReference?: { educationServiceCenterId: number };
  parentLocalEducationAgencyReference?: { localEducationAgencyId: number };
  _ext?: EdForgeLeaExtension;
}

export interface EdFiStateEducationAgency {
  stateEducationAgencyId: number;
  nameOfInstitution: string;
  shortNameOfInstitution?: string;
  webSite?: string;
  operationalStatusDescriptor: string;
  categories?: EdFiDescriptorRef[];
  addresses?: EdFiEducationOrganizationAddress[];
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  institutionTelephones?: EdFiInstitutionTelephone[];
  _ext?: EdForgeSeaExtension;
}

export interface EdFiEducationServiceCenter {
  educationServiceCenterId: number;
  nameOfInstitution: string;
  shortNameOfInstitution?: string;
  webSite?: string;
  operationalStatusDescriptor: string;
  categories?: EdFiDescriptorRef[];
  addresses?: EdFiEducationOrganizationAddress[];
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  institutionTelephones?: EdFiInstitutionTelephone[];
  stateEducationAgencyReference?: { stateEducationAgencyId: number };
  _ext?: EdForgeEscExtension;
}

// ============================================================================
// Ed-Fi Sub-Resource Interfaces
// ============================================================================

export interface EdFiDescriptorRef {
  [descriptorName: string]: string;
}

export interface EdFiEducationOrganizationAddress {
  addressTypeDescriptor: string;
  streetNumberName: string;
  apartmentRoomSuiteNumber?: string;
  city: string;
  stateAbbreviationDescriptor: string;
  postalCode: string;
  nameOfCounty?: string;
  countyFIPSCode?: string;
  latitude?: string;
  longitude?: string;
}

export interface EdFiEducationOrganizationIdentificationCode {
  educationOrganizationIdentificationSystemDescriptor: string;
  identificationCode: string;
}

export interface EdFiInstitutionTelephone {
  institutionTelephoneNumberTypeDescriptor: string;
  telephoneNumber: string;
}

// ============================================================================
// EdForge Extension Interfaces (round-trip preservation)
// ============================================================================

export interface EdForgeSchoolExtension {
  edforge_schoolId: string;
  edforge_tenantId?: string;
  edforge_schoolCode: string;
  edforge_internalSchoolType: string;
}

export interface EdForgeLeaExtension {
  edforge_leaId: string;
  edforge_tenantId: string;
}

export interface EdForgeSeaExtension {
  edforge_seaId: string;
  edforge_tenantId: string;
}

export interface EdForgeEscExtension {
  edforge_escId: string;
  edforge_tenantId: string;
}

// ============================================================================
// Descriptor URI Helpers
// ============================================================================

/**
 * Build an Ed-Fi descriptor URI from namespace and value.
 * @example toEdFiDescriptorUri('SchoolCategoryDescriptor', 'High School')
 *          => 'uri://ed-fi.org/SchoolCategoryDescriptor#High School'
 */
export function toEdFiDescriptorUri(namespace: string, value: string): string {
  return `uri://ed-fi.org/${namespace}#${value}`;
}

/** Map an operational status value to its Ed-Fi descriptor URI */
function mapOperationalStatus(status: string): string {
  const statusLabels: Record<string, string> = {
    Active: 'Active',
    Added: 'Added',
    ChangedAgency: 'Changed Agency',
    Closed: 'Closed',
    Inactive: 'Inactive',
    New: 'New',
    Reopened: 'Reopened',
    Future: 'Future',
  };
  return toEdFiDescriptorUri('OperationalStatusDescriptor', statusLabels[status] || status);
}

/** Map an address type value to its Ed-Fi descriptor URI */
function mapAddressType(type: string): string {
  return toEdFiDescriptorUri('AddressTypeDescriptor', type);
}

/** Map a state abbreviation to its Ed-Fi descriptor URI */
function mapStateAbbreviation(state: string): string {
  return toEdFiDescriptorUri('StateAbbreviationDescriptor', state);
}

/** Map an identification system value to its Ed-Fi descriptor URI */
function mapIdentificationSystem(system: string): string {
  const systemLabels: Record<string, string> = {
    NCES: 'NCES Identification Number',
    SEA: 'SEA',
    DUNS: 'DUNS',
    Federal: 'Federal',
    Other: 'Other',
  };
  return toEdFiDescriptorUri(
    'EducationOrganizationIdentificationSystemDescriptor',
    systemLabels[system] || system
  );
}

/** Map a telephone number type value to its Ed-Fi descriptor URI */
function mapTelephoneType(type: string): string {
  return toEdFiDescriptorUri('InstitutionTelephoneNumberTypeDescriptor', type);
}

/** Map a school category value to its Ed-Fi descriptor URI */
function mapSchoolCategory(value: string): string {
  const categoryLabels: Record<string, string> = {
    AllLevels: 'All Levels',
    Elementary: 'Elementary School',
    HighSchool: 'High School',
    MiddleSchool: 'Middle School',
    SecondarySchool: 'Secondary School',
    Ungraded: 'Ungraded',
  };
  return toEdFiDescriptorUri('SchoolCategoryDescriptor', categoryLabels[value] || value);
}

/** Map a school type descriptor value to its Ed-Fi descriptor URI */
function mapSchoolType(value: string): string {
  const typeLabels: Record<string, string> = {
    Regular: 'Regular',
    SpecialEducation: 'Special Education',
    CareerAndTechnical: 'Career and Technical Education',
    Alternative: 'Alternative',
  };
  return toEdFiDescriptorUri('SchoolTypeDescriptor', typeLabels[value] || value);
}

/** Map a grade level descriptor value to its Ed-Fi descriptor URI */
function mapGradeLevel(value: string): string {
  const gradeLabels: Record<string, string> = {
    InfantToddler: 'Infant/toddler',
    Prenursery: 'Prenursery',
    Nursery: 'Nursery',
    Prekindergarten: 'Pre-Kindergarten',
    TransitionalKindergarten: 'Transitional Kindergarten',
    Kindergarten: 'Kindergarten',
    FirstGrade: 'First grade',
    SecondGrade: 'Second grade',
    ThirdGrade: 'Third grade',
    FourthGrade: 'Fourth grade',
    FifthGrade: 'Fifth grade',
    SixthGrade: 'Sixth grade',
    SeventhGrade: 'Seventh grade',
    EighthGrade: 'Eighth grade',
    NinthGrade: 'Ninth grade',
    TenthGrade: 'Tenth grade',
    EleventhGrade: 'Eleventh grade',
    TwelfthGrade: 'Twelfth grade',
    Postsecondary: 'Postsecondary',
    Ungraded: 'Ungraded',
    Other: 'Other',
  };
  return toEdFiDescriptorUri('GradeLevelDescriptor', gradeLabels[value] || value);
}

/** Map a LEA category value to its Ed-Fi descriptor URI */
function mapLeaCategory(value: string): string {
  const categoryLabels: Record<string, string> = {
    Independent: 'Independent',
    CharterLEA: 'Charter LEA',
    Intermediate: 'Intermediate',
    SupervisoryUnion: 'Supervisory Union',
    Other: 'Other',
  };
  return toEdFiDescriptorUri('LocalEducationAgencyCategoryDescriptor', categoryLabels[value] || value);
}

/** Map a charter status value to its Ed-Fi descriptor URI */
function mapCharterStatus(value: string): string {
  const statusLabels: Record<string, string> = {
    NotACharter: 'Not a Charter School',
    SchoolCharter: 'School Charter',
    CollegeUniversityCharter: 'College/University Charter',
    OpenEnrollment: 'Open Enrollment',
  };
  return toEdFiDescriptorUri('CharterStatusDescriptor', statusLabels[value] || value);
}

// ============================================================================
// Shared Sub-Resource Mappers
// ============================================================================

function mapAddresses(addresses?: EducationOrgAddress[]): EdFiEducationOrganizationAddress[] | undefined {
  if (!addresses || addresses.length === 0) return undefined;
  return addresses.map(addr => ({
    addressTypeDescriptor: mapAddressType(addr.addressTypeDescriptor),
    streetNumberName: addr.streetNumberName,
    apartmentRoomSuiteNumber: addr.apartmentRoomSuiteNumber,
    city: addr.city,
    stateAbbreviationDescriptor: mapStateAbbreviation(addr.stateAbbreviationDescriptor),
    postalCode: addr.postalCode,
    nameOfCounty: addr.nameOfCounty,
    countyFIPSCode: addr.countyFIPSCode,
    latitude: addr.latitude,
    longitude: addr.longitude,
  }));
}

function mapIdentificationCodes(codes?: EducationOrgIdentificationCode[]): EdFiEducationOrganizationIdentificationCode[] | undefined {
  if (!codes || codes.length === 0) return undefined;
  return codes.map(code => ({
    educationOrganizationIdentificationSystemDescriptor: mapIdentificationSystem(
      code.educationOrganizationIdentificationSystemDescriptor
    ),
    identificationCode: code.identificationCode,
  }));
}

function mapTelephones(telephones?: InstitutionTelephone[]): EdFiInstitutionTelephone[] | undefined {
  if (!telephones || telephones.length === 0) return undefined;
  return telephones.map(tel => ({
    institutionTelephoneNumberTypeDescriptor: mapTelephoneType(
      tel.institutionTelephoneNumberTypeDescriptor
    ),
    telephoneNumber: tel.telephoneNumber,
  }));
}

// ============================================================================
// School Mapper
// ============================================================================

/**
 * Convert EdForge School to Ed-Fi School format.
 * Note: SchoolResponseDto uses a string schoolCode (EdForge internal), while
 * Ed-Fi requires a numeric schoolId. The schoolCode is preserved in _ext.
 * The caller must provide the numeric Ed-Fi school ID separately if different.
 */
export function toEdFiSchool(
  school: SchoolResponseDto,
  edfiSchoolId?: number
): EdFiSchool {
  const result: EdFiSchool = {
    schoolId: edfiSchoolId ?? 0, // Caller should provide the numeric Ed-Fi ID
    nameOfInstitution: school.name,
    shortNameOfInstitution: school.shortName,
    webSite: school.website,
  };

  // School categories
  if (school.schoolCategories && school.schoolCategories.length > 0) {
    result.schoolCategories = school.schoolCategories.map(cat => ({
      schoolCategoryDescriptor: mapSchoolCategory(cat),
    }));
  }

  // School type descriptor
  if (school.schoolTypeDescriptor) {
    result.schoolTypeDescriptor = mapSchoolType(school.schoolTypeDescriptor);
  }

  // Grade levels
  if (school.gradeLevels && school.gradeLevels.length > 0) {
    result.gradeLevels = school.gradeLevels.map(gl => ({
      gradeLevelDescriptor: mapGradeLevel(gl),
    }));
  }

  // Charter status
  if (school.charterStatusDescriptor) {
    result.charterStatusDescriptor = mapCharterStatus(school.charterStatusDescriptor);
  }

  // Administrative funding control
  if (school.administrativeFundingControlDescriptor) {
    result.administrativeFundingControlDescriptor = toEdFiDescriptorUri(
      'AdministrativeFundingControlDescriptor',
      school.administrativeFundingControlDescriptor === 'Public' ? 'Public School' :
      school.administrativeFundingControlDescriptor === 'Private' ? 'Private School' :
      school.administrativeFundingControlDescriptor
    );
  }

  // Title I
  if (school.titleIPartASchoolDesignationDescriptor) {
    result.titleIPartASchoolDesignationDescriptor = school.titleIPartASchoolDesignationDescriptor;
  }

  // Addresses (from Ed-Fi-style addresses if present, or map from legacy address)
  if (school.address) {
    result.addresses = [{
      addressTypeDescriptor: toEdFiDescriptorUri('AddressTypeDescriptor', 'Physical'),
      streetNumberName: school.address.street1,
      apartmentRoomSuiteNumber: school.address.street2,
      city: school.address.city || '',
      stateAbbreviationDescriptor: toEdFiDescriptorUri('StateAbbreviationDescriptor', school.address.state || ''),
      postalCode: school.address.zipCode || '',
    }];
  }

  // Identification codes
  if (school.identificationCodes && school.identificationCodes.length > 0) {
    result.identificationCodes = mapIdentificationCodes(school.identificationCodes);
  }

  // Telephones
  if (school.institutionTelephones && school.institutionTelephones.length > 0) {
    result.institutionTelephones = mapTelephones(school.institutionTelephones);
  }

  // EdForge extension for round-trip
  result._ext = {
    edforge_schoolId: school.schoolId,
    edforge_schoolCode: school.schoolCode,
    edforge_internalSchoolType: school.schoolType,
  };

  return result;
}

// ============================================================================
// LEA Mapper
// ============================================================================

/**
 * Convert EdForge LEA to Ed-Fi LocalEducationAgency format.
 * Hierarchy references (SEA, ESC, parent LEA) use internal UUIDs in EdForge
 * but Ed-Fi requires numeric IDs. The caller must resolve these.
 */
export function toEdFiLocalEducationAgency(
  lea: LeaResponseDto,
  refs?: {
    seaEdFiId?: number;
    escEdFiId?: number;
    parentLeaEdFiId?: number;
  }
): EdFiLocalEducationAgency {
  const result: EdFiLocalEducationAgency = {
    localEducationAgencyId: lea.localEducationAgencyId,
    nameOfInstitution: lea.nameOfInstitution,
    shortNameOfInstitution: lea.shortNameOfInstitution,
    webSite: lea.webSite,
    operationalStatusDescriptor: mapOperationalStatus(lea.operationalStatusDescriptor),
    localEducationAgencyCategoryDescriptor: mapLeaCategory(lea.leaCategoryDescriptor),
  };

  if (lea.charterStatusDescriptor) {
    result.charterStatusDescriptor = mapCharterStatus(lea.charterStatusDescriptor);
  }

  if (lea.categories && lea.categories.length > 0) {
    result.categories = lea.categories.map(cat => ({
      educationOrganizationCategoryDescriptor: cat.educationOrganizationCategoryDescriptor,
    }));
  }

  result.addresses = mapAddresses(lea.addresses);
  result.identificationCodes = mapIdentificationCodes(lea.identificationCodes);
  result.institutionTelephones = mapTelephones(lea.telephones);

  // Hierarchy references
  if (refs?.seaEdFiId) {
    result.stateEducationAgencyReference = { stateEducationAgencyId: refs.seaEdFiId };
  }
  if (refs?.escEdFiId) {
    result.educationServiceCenterReference = { educationServiceCenterId: refs.escEdFiId };
  }
  if (refs?.parentLeaEdFiId) {
    result.parentLocalEducationAgencyReference = { localEducationAgencyId: refs.parentLeaEdFiId };
  }

  result._ext = {
    edforge_leaId: lea.id,
    edforge_tenantId: lea.tenantId,
  };

  return result;
}

// ============================================================================
// SEA Mapper
// ============================================================================

/**
 * Convert EdForge SEA to Ed-Fi StateEducationAgency format.
 */
export function toEdFiStateEducationAgency(sea: SeaResponseDto): EdFiStateEducationAgency {
  const result: EdFiStateEducationAgency = {
    stateEducationAgencyId: sea.stateEducationAgencyId,
    nameOfInstitution: sea.nameOfInstitution,
    shortNameOfInstitution: sea.shortNameOfInstitution,
    webSite: sea.webSite,
    operationalStatusDescriptor: mapOperationalStatus(sea.operationalStatusDescriptor),
  };

  if (sea.categories && sea.categories.length > 0) {
    result.categories = sea.categories.map(cat => ({
      educationOrganizationCategoryDescriptor: cat.educationOrganizationCategoryDescriptor,
    }));
  }

  result.addresses = mapAddresses(sea.addresses);
  result.identificationCodes = mapIdentificationCodes(sea.identificationCodes);
  result.institutionTelephones = mapTelephones(sea.telephones);

  result._ext = {
    edforge_seaId: sea.id,
    edforge_tenantId: sea.tenantId,
  };

  return result;
}

// ============================================================================
// ESC Mapper
// ============================================================================

/**
 * Convert EdForge ESC to Ed-Fi EducationServiceCenter format.
 */
export function toEdFiEducationServiceCenter(
  esc: EscResponseDto,
  seaEdFiId?: number
): EdFiEducationServiceCenter {
  const result: EdFiEducationServiceCenter = {
    educationServiceCenterId: esc.educationServiceCenterId,
    nameOfInstitution: esc.nameOfInstitution,
    shortNameOfInstitution: esc.shortNameOfInstitution,
    webSite: esc.webSite,
    operationalStatusDescriptor: mapOperationalStatus(esc.operationalStatusDescriptor),
  };

  if (esc.categories && esc.categories.length > 0) {
    result.categories = esc.categories.map(cat => ({
      educationOrganizationCategoryDescriptor: cat.educationOrganizationCategoryDescriptor,
    }));
  }

  result.addresses = mapAddresses(esc.addresses);
  result.identificationCodes = mapIdentificationCodes(esc.identificationCodes);
  result.institutionTelephones = mapTelephones(esc.telephones);

  if (seaEdFiId) {
    result.stateEducationAgencyReference = { stateEducationAgencyId: seaEdFiId };
  }

  result._ext = {
    edforge_escId: esc.id,
    edforge_tenantId: esc.tenantId,
  };

  return result;
}

// ============================================================================
// Batch Converters
// ============================================================================

export function toEdFiSchoolBatch(schools: SchoolResponseDto[]): EdFiSchool[] {
  return schools.map(s => toEdFiSchool(s));
}

export function toEdFiLeaBatch(leas: LeaResponseDto[]): EdFiLocalEducationAgency[] {
  return leas.map(l => toEdFiLocalEducationAgency(l));
}

// ============================================================================
// Network Mapper
// ============================================================================

export interface EdFiEducationOrganizationNetwork {
  educationOrganizationNetworkId: number;
  nameOfInstitution: string;
  shortNameOfInstitution?: string;
  webSite?: string;
  operationalStatusDescriptor: string;
  networkPurposeDescriptor: string;
  categories?: EdFiDescriptorRef[];
  addresses?: EdFiEducationOrganizationAddress[];
  identificationCodes?: EdFiEducationOrganizationIdentificationCode[];
  institutionTelephones?: EdFiInstitutionTelephone[];
  _ext?: EdForgeNetworkExtension;
}

export interface EdForgeNetworkExtension {
  edforge_networkId: string;
  edforge_tenantId: string;
}

/** Map a network purpose value to its Ed-Fi descriptor URI */
function mapNetworkPurpose(value: string): string {
  const purposeLabels: Record<string, string> = {
    Collaborative: 'Collaborative',
    Disciplinary: 'Disciplinary',
    Governance: 'Governance',
    'Shared Services': 'Shared Services',
    Other: 'Other',
  };
  return toEdFiDescriptorUri('NetworkPurposeDescriptor', purposeLabels[value] || value);
}

/**
 * Convert EdForge Network to Ed-Fi EducationOrganizationNetwork format.
 */
export function toEdFiEducationOrganizationNetwork(
  network: NetworkResponseDto,
): EdFiEducationOrganizationNetwork {
  const result: EdFiEducationOrganizationNetwork = {
    educationOrganizationNetworkId: network.educationOrganizationNetworkId,
    nameOfInstitution: network.nameOfInstitution,
    shortNameOfInstitution: network.shortNameOfInstitution,
    webSite: network.webSite,
    operationalStatusDescriptor: mapOperationalStatus(network.operationalStatusDescriptor),
    networkPurposeDescriptor: mapNetworkPurpose(network.networkPurposeDescriptor),
  };

  if (network.categories && network.categories.length > 0) {
    result.categories = network.categories.map(cat => ({
      educationOrganizationCategoryDescriptor: cat.educationOrganizationCategoryDescriptor,
    }));
  }

  result.addresses = mapAddresses(network.addresses);
  result.identificationCodes = mapIdentificationCodes(network.identificationCodes);
  result.institutionTelephones = mapTelephones(network.telephones);

  result._ext = {
    edforge_networkId: network.id,
    edforge_tenantId: network.tenantId,
  };

  return result;
}

export function toEdFiNetworkBatch(networks: NetworkResponseDto[]): EdFiEducationOrganizationNetwork[] {
  return networks.map(n => toEdFiEducationOrganizationNetwork(n));
}
