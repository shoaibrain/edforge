import { matchesPermission } from './permission-matcher';

describe('matchesPermission', () => {
  describe('exact matches', () => {
    it('should match exact resource:action', () => {
      expect(matchesPermission('students:view', 'students', 'view')).toBe(true);
    });

    it('should not match different action', () => {
      expect(matchesPermission('students:view', 'students', 'edit')).toBe(false);
    });

    it('should not match different resource', () => {
      expect(matchesPermission('teachers:view', 'students', 'view')).toBe(false);
    });
  });

  describe('multi-action patterns', () => {
    it('should match first action in comma-separated list', () => {
      expect(matchesPermission('students:view,edit', 'students', 'view')).toBe(true);
    });

    it('should match second action in comma-separated list', () => {
      expect(matchesPermission('students:view,edit', 'students', 'edit')).toBe(true);
    });

    it('should not match action not in list', () => {
      expect(matchesPermission('students:view,edit', 'students', 'delete')).toBe(false);
    });

    it('should match any action in a longer list', () => {
      expect(matchesPermission('attendance:view,create,edit', 'attendance', 'create')).toBe(true);
    });
  });

  describe('wildcard patterns', () => {
    it('should match wildcard action', () => {
      expect(matchesPermission('students:*', 'students', 'delete')).toBe(true);
    });

    it('should not match wildcard action with wrong resource', () => {
      expect(matchesPermission('students:*', 'teachers', 'view')).toBe(false);
    });

    it('should match full wildcard', () => {
      expect(matchesPermission('*:*', 'anything', 'everything')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should return false for pattern without colon', () => {
      expect(matchesPermission('invalid', 'invalid', 'view')).toBe(false);
    });

    it('should handle resource with special characters', () => {
      expect(matchesPermission('health-records:view', 'health-records', 'view')).toBe(true);
    });

    it('should handle compound permission names', () => {
      expect(matchesPermission('reports:view,export', 'reports', 'export')).toBe(true);
    });

    it('should handle settings:school pattern', () => {
      expect(matchesPermission('settings:school', 'settings', 'school')).toBe(true);
    });

    it('should not match partial action names', () => {
      expect(matchesPermission('students:view', 'students', 'vi')).toBe(false);
    });
  });

  describe('student and parent portal permissions', () => {
    it('should match student portal-style permission', () => {
      expect(matchesPermission('student-portal:grades', 'student-portal', 'grades')).toBe(true);
    });

    it('should match parent portal-style permission', () => {
      expect(matchesPermission('parent-portal:attendance', 'parent-portal', 'attendance')).toBe(true);
    });

    it('should match standard resource permissions added for student self-service', () => {
      expect(matchesPermission('grades:view', 'grades', 'view')).toBe(true);
      expect(matchesPermission('attendance:view', 'attendance', 'view')).toBe(true);
      expect(matchesPermission('scheduling:view', 'scheduling', 'view')).toBe(true);
      expect(matchesPermission('courses:view', 'courses', 'view')).toBe(true);
      expect(matchesPermission('enrollment:view', 'enrollment', 'view')).toBe(true);
    });

    it('should deny create/edit/delete actions for student permissions', () => {
      expect(matchesPermission('grades:view', 'grades', 'create')).toBe(false);
      expect(matchesPermission('grades:view', 'grades', 'edit')).toBe(false);
      expect(matchesPermission('grades:view', 'grades', 'delete')).toBe(false);
      expect(matchesPermission('attendance:view', 'attendance', 'create')).toBe(false);
      expect(matchesPermission('scheduling:view', 'scheduling', 'edit')).toBe(false);
    });

    it('should not match students:view for student role (not granted)', () => {
      // Student role does NOT have students:view to prevent admin listing access
      expect(matchesPermission('grades:view', 'students', 'view')).toBe(false);
    });

    it('should not cross-match portal permissions with standard resource checks', () => {
      // student-portal:grades should NOT match a check for resource=grades, action=view
      expect(matchesPermission('student-portal:grades', 'grades', 'view')).toBe(false);
      expect(matchesPermission('parent-portal:attendance', 'attendance', 'view')).toBe(false);
    });
  });
});
