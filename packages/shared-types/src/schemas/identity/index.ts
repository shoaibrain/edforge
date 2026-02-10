/**
 * Identity Service Schemas
 * 
 * All schemas for the Identity microservice
 */

export * from './user.schema';
export * from './auth.schema';
export * from './security.schema';
export * from './tenant.schema';
export * from './school.schema';
export * from './role.schema';
export * from './session.schema';
export * from './academic-year.schema';
export * from './department.schema';

// Education Organization Domain (Ed-Fi aligned)
export * from './education-org-descriptors';
export * from './education-organization.schema';
export * from './state-education-agency.schema';
export * from './local-education-agency.schema';
export * from './education-service-center.schema';
export * from './education-org-hierarchy.schema';

// Staff Management (Ed-Fi aligned)
export * from './staff.schema';
export * from './staff-assignment.schema';
export * from './staff-employment-history.schema';
export * from './credential.schema';
export * from './leave.schema';

// Calendar Management (Ed-Fi aligned)
export * from './bell-schedule.schema';
export * from './calendar-date.schema';
export * from './school-year.schema';
