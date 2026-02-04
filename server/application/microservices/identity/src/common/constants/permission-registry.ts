/**
 * Permission Registry — Canonical catalog of all resources, actions, and metadata.
 * Single source of truth for permission definitions across the identity service.
 *
 * Used by:
 * - GET /permissions/catalog endpoint (frontend consumes this)
 * - Startup validation of DEFAULT_ROLE_PERMISSIONS
 * - Future: permission assignment UI
 */

export interface PermissionDefinition {
  resource: string;
  actions: string[];
  description: string;
  category: PermissionCategory;
}

export type PermissionCategory =
  | 'academic'
  | 'student-management'
  | 'staff-management'
  | 'finance'
  | 'health'
  | 'scheduling'
  | 'portal'
  | 'administration';

export const PERMISSION_REGISTRY: PermissionDefinition[] = [
  {
    resource: 'students',
    actions: ['view', 'create', 'edit', 'delete', 'manage', 'export'],
    description: 'Student records and profiles',
    category: 'student-management',
  },
  {
    resource: 'teachers',
    actions: ['view', 'create', 'edit', 'delete', 'manage'],
    description: 'Teacher profiles and assignments',
    category: 'staff-management',
  },
  {
    resource: 'staff',
    actions: ['view', 'create', 'edit', 'delete', 'manage'],
    description: 'Non-teaching staff records',
    category: 'staff-management',
  },
  {
    resource: 'grades',
    actions: ['view', 'create', 'edit', 'delete', 'export'],
    description: 'Student grades and assessments',
    category: 'academic',
  },
  {
    resource: 'attendance',
    actions: ['view', 'create', 'edit', 'delete', 'export'],
    description: 'Student and staff attendance records',
    category: 'academic',
  },
  {
    resource: 'enrollment',
    actions: ['view', 'create', 'edit', 'delete', 'approve'],
    description: 'Student enrollment management',
    category: 'student-management',
  },
  {
    resource: 'curriculum',
    actions: ['view', 'create', 'edit', 'delete', 'manage'],
    description: 'Curriculum and course management',
    category: 'academic',
  },
  {
    resource: 'scheduling',
    actions: ['view', 'create', 'edit', 'delete', 'manage'],
    description: 'Class and event scheduling',
    category: 'scheduling',
  },
  {
    resource: 'reports',
    actions: ['view', 'export', 'finance'],
    description: 'Report generation and viewing',
    category: 'administration',
  },
  {
    resource: 'settings',
    actions: ['school', 'manage'],
    description: 'School and system settings',
    category: 'administration',
  },
  {
    resource: 'billing',
    actions: ['view', 'create', 'edit', 'delete', 'manage'],
    description: 'Billing and invoicing',
    category: 'finance',
  },
  {
    resource: 'payroll',
    actions: ['view', 'create', 'edit', 'manage'],
    description: 'Staff payroll',
    category: 'finance',
  },
  {
    resource: 'expenses',
    actions: ['view', 'create', 'edit', 'delete', 'approve', 'manage'],
    description: 'School expense tracking',
    category: 'finance',
  },
  {
    resource: 'special-programs',
    actions: ['view', 'create', 'edit', 'delete', 'manage'],
    description: 'Special education and counseling programs',
    category: 'student-management',
  },
  {
    resource: 'health-records',
    actions: ['view', 'create', 'edit', 'delete', 'manage'],
    description: 'Student health records',
    category: 'health',
  },
  {
    resource: 'student-portal',
    actions: ['grades', 'attendance', 'schedule', 'assignments'],
    description: 'Student self-service portal',
    category: 'portal',
  },
  {
    resource: 'parent-portal',
    actions: ['grades', 'attendance', 'schedule', 'fees'],
    description: 'Parent self-service portal',
    category: 'portal',
  },
];

/**
 * Validate that DEFAULT_ROLE_PERMISSIONS only reference registry-defined
 * resource:action combinations. Call at startup to catch misconfigurations.
 *
 * Handles wildcard patterns: `*:*`, `resource:*`, `resource:action1,action2`
 */
export function validatePermissionsAgainstRegistry(
  defaultPermissions: Record<string, string[]>,
  registry: PermissionDefinition[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const resourceActionMap = new Map<string, Set<string>>();

  for (const def of registry) {
    resourceActionMap.set(def.resource, new Set(def.actions));
  }

  for (const [role, perms] of Object.entries(defaultPermissions)) {
    for (const perm of perms) {
      const colonIdx = perm.indexOf(':');
      if (colonIdx === -1) {
        errors.push(`${role}: invalid format '${perm}' (missing colon separator)`);
        continue;
      }

      const resource = perm.substring(0, colonIdx);
      const actionsStr = perm.substring(colonIdx + 1);

      // Full wildcard — skip validation
      if (resource === '*') continue;

      const registeredActions = resourceActionMap.get(resource);
      if (!registeredActions) {
        errors.push(`${role}: unknown resource '${resource}' in '${perm}'`);
        continue;
      }

      // Action wildcard — skip action validation
      if (actionsStr === '*') continue;

      // Validate each comma-separated action
      for (const action of actionsStr.split(',')) {
        if (!registeredActions.has(action)) {
          errors.push(`${role}: unknown action '${action}' for resource '${resource}' in '${perm}'`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
