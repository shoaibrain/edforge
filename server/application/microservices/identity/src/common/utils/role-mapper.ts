/**
 * Maps Ed-Fi StaffRole values to ABAC SchoolRole values.
 *
 * StaffRole is the Ed-Fi aligned, snake_case role used in
 * Staff and StaffAssignment entities.
 * SchoolRole is the PascalCase role used in RoleAssignment
 * entities for frontend ABAC permission checks.
 */

import { StaffRole } from '../entities/staff.entity';
import { SchoolRole } from '../entities/base.entity';

const STAFF_TO_SCHOOL_ROLE: Record<StaffRole, SchoolRole> = {
  principal: 'Principal',
  vice_principal: 'VicePrincipal',
  teacher: 'Teacher',
  counselor: 'Counselor',
  nurse: 'Nurse',
  admin_staff: 'Staff',
  support_staff: 'Staff',
  it_staff: 'Staff',
  librarian: 'Staff',
  substitute: 'Teacher',
  contractor: 'Staff',
};

export function staffRoleToSchoolRole(staffRole: StaffRole): SchoolRole {
  return STAFF_TO_SCHOOL_ROLE[staffRole] ?? 'Staff';
}
