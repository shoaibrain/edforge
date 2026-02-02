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
});
