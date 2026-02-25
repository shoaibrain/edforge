import { DataScopeService, DataScope } from './data-scope.service';
import { IdentityClientService } from './identity-client.service';
import { DynamoDBClientService } from './dynamodb-client.service';
import type { RequestContext } from '../entities';

describe('DataScopeService', () => {
  let service: DataScopeService;
  let identityClient: jest.Mocked<IdentityClientService>;
  let dynamoDBClient: jest.Mocked<DynamoDBClientService>;

  const baseContext: RequestContext = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    email: 'user@school.org',
    role: 'StandardUser',
    jwtToken: 'test-token',
    username: 'user1',
  };

  beforeEach(() => {
    identityClient = {
      getUserRole: jest.fn(),
      getStaffByEmail: jest.fn(),
    } as any;

    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      queryGSI: jest.fn(),
    } as any;

    service = new DataScopeService(identityClient, dynamoDBClient);
  });

  // ==========================================================================
  // resolveScope
  // ==========================================================================

  describe('resolveScope', () => {
    it('should return school scope for TenantAdmin', async () => {
      const context = { ...baseContext, role: 'TenantAdmin' };
      const scope = await service.resolveScope('user-1', 'school-1', context);

      expect(scope.type).toBe('school');
      expect(scope.role).toBe('TenantAdmin');
      expect(identityClient.getUserRole).not.toHaveBeenCalled();
    });

    it('should return school scope for Principal', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Principal' });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('school');
      expect(scope.role).toBe('Principal');
    });

    it('should return school scope for Staff', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Staff' });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('school');
      expect(scope.role).toBe('Staff');
    });

    it('should return school scope for Accountant', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Accountant' });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('school');
      expect(scope.role).toBe('Accountant');
    });

    it('should resolve teacher scope with sections and students', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Teacher', staffId: 'staff-1' });
      dynamoDBClient.getClient.mockResolvedValue({} as any);
      dynamoDBClient.queryGSI
        // First call: sections query
        .mockResolvedValueOnce({
          items: [
            { sectionId: 'sec-1' },
            { sectionId: 'sec-2' },
          ],
          lastEvaluatedKey: undefined,
          hasMore: false,
        })
        // Second call: enrollments for sec-1
        .mockResolvedValueOnce({
          items: [
            { studentId: 'stu-1' },
            { studentId: 'stu-2' },
          ],
          lastEvaluatedKey: undefined,
          hasMore: false,
        })
        // Third call: enrollments for sec-2
        .mockResolvedValueOnce({
          items: [
            { studentId: 'stu-2' },
            { studentId: 'stu-3' },
          ],
          lastEvaluatedKey: undefined,
          hasMore: false,
        });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('section');
      expect(scope.role).toBe('Teacher');
      expect(scope.sectionIds).toEqual(['sec-1', 'sec-2']);
      expect(scope.studentIds).toEqual(expect.arrayContaining(['stu-1', 'stu-2', 'stu-3']));
      expect(scope.studentIds).toHaveLength(3); // stu-2 deduped
    });

    it('should return empty section scope when teacher has no sections', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Teacher', staffId: 'staff-1' });
      dynamoDBClient.getClient.mockResolvedValue({} as any);
      dynamoDBClient.queryGSI.mockResolvedValueOnce({
        items: [],
        lastEvaluatedKey: undefined,
        hasMore: false,
      });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('section');
      expect(scope.sectionIds).toEqual([]);
      expect(scope.studentIds).toEqual([]);
    });

    it('should return school scope for VicePrincipal', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'VicePrincipal' });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('school');
      expect(scope.role).toBe('VicePrincipal');
    });

    it('should return school scope for Counselor', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Counselor' });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('school');
      expect(scope.role).toBe('Counselor');
    });

    it('should return empty section scope when Teacher has no staffId (fail-closed)', async () => {
      // Teacher without staffId should get empty scope, NOT school-wide
      identityClient.getUserRole.mockResolvedValue({ role: 'Teacher', staffId: undefined });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('section');
      expect(scope.role).toBe('Teacher');
      expect(scope.sectionIds).toEqual([]);
      expect(scope.studentIds).toEqual([]);
      // Should NOT have called queryGSI since there's no staffId to look up
      expect(dynamoDBClient.queryGSI).not.toHaveBeenCalled();
    });

    it('should deduplicate students across multiple sections', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Teacher', staffId: 'staff-1' });
      dynamoDBClient.getClient.mockResolvedValue({} as any);
      dynamoDBClient.queryGSI
        .mockResolvedValueOnce({
          items: [{ sectionId: 'sec-1' }, { sectionId: 'sec-2' }],
          lastEvaluatedKey: undefined,
          hasMore: false,
        })
        // Both sections have overlapping students
        .mockResolvedValueOnce({
          items: [{ studentId: 'stu-1' }, { studentId: 'stu-2' }],
          lastEvaluatedKey: undefined,
          hasMore: false,
        })
        .mockResolvedValueOnce({
          items: [{ studentId: 'stu-1' }, { studentId: 'stu-3' }],
          lastEvaluatedKey: undefined,
          hasMore: false,
        });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.studentIds).toHaveLength(3);
      expect(new Set(scope.studentIds).size).toBe(3); // no duplicates
    });

    it('should default to school scope when no role found', async () => {
      identityClient.getUserRole.mockResolvedValue(null);

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('school');
    });

    it('should default to school scope on error (fail-open by default)', async () => {
      identityClient.getUserRole.mockRejectedValue(new Error('Network error'));

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('school');
    });

    it('should throw on error when DATA_SCOPE_FAIL_CLOSED is true', async () => {
      const originalEnv = process.env.DATA_SCOPE_FAIL_CLOSED;
      process.env.DATA_SCOPE_FAIL_CLOSED = 'true';

      identityClient.getUserRole.mockRejectedValue(new Error('Network error'));

      await expect(
        service.resolveScope('user-1', 'school-1', baseContext),
      ).rejects.toThrow();

      process.env.DATA_SCOPE_FAIL_CLOSED = originalEnv;
    });
  });

  // ==========================================================================
  // isStudentInScope
  // ==========================================================================

  describe('isStudentInScope', () => {
    it('should return true for school scope (any student)', () => {
      const scope: DataScope = { type: 'school', schoolId: 'school-1' };
      expect(service.isStudentInScope(scope, 'any-student')).toBe(true);
    });

    it('should return true when student is in section scope', () => {
      const scope: DataScope = {
        type: 'section',
        schoolId: 'school-1',
        studentIds: ['stu-1', 'stu-2'],
      };
      expect(service.isStudentInScope(scope, 'stu-1')).toBe(true);
    });

    it('should return false when student is not in section scope', () => {
      const scope: DataScope = {
        type: 'section',
        schoolId: 'school-1',
        studentIds: ['stu-1', 'stu-2'],
      };
      expect(service.isStudentInScope(scope, 'stu-3')).toBe(false);
    });

    it('should return false for empty student scope', () => {
      const scope: DataScope = {
        type: 'section',
        schoolId: 'school-1',
        studentIds: [],
      };
      expect(service.isStudentInScope(scope, 'stu-1')).toBe(false);
    });
  });

  // ==========================================================================
  // isSectionInScope
  // ==========================================================================

  describe('isSectionInScope', () => {
    it('should return true for school scope (any section)', () => {
      const scope: DataScope = { type: 'school', schoolId: 'school-1' };
      expect(service.isSectionInScope(scope, 'any-section')).toBe(true);
    });

    it('should return true when section is in scope', () => {
      const scope: DataScope = {
        type: 'section',
        schoolId: 'school-1',
        sectionIds: ['sec-1', 'sec-2'],
      };
      expect(service.isSectionInScope(scope, 'sec-1')).toBe(true);
    });

    it('should return false when section is not in scope', () => {
      const scope: DataScope = {
        type: 'section',
        schoolId: 'school-1',
        sectionIds: ['sec-1'],
      };
      expect(service.isSectionInScope(scope, 'sec-99')).toBe(false);
    });
  });

  // ==========================================================================
  // filterByStudentScope
  // ==========================================================================

  describe('filterByStudentScope', () => {
    const items = [
      { studentId: 'stu-1', grade: 'A' },
      { studentId: 'stu-2', grade: 'B' },
      { studentId: 'stu-3', grade: 'C' },
    ];

    it('should return all items for school scope', () => {
      const scope: DataScope = { type: 'school', schoolId: 'school-1' };
      expect(service.filterByStudentScope(scope, items)).toHaveLength(3);
    });

    it('should filter items for section scope', () => {
      const scope: DataScope = {
        type: 'section',
        schoolId: 'school-1',
        studentIds: ['stu-1', 'stu-3'],
      };
      const result = service.filterByStudentScope(scope, items);
      expect(result).toHaveLength(2);
      expect(result.map(r => r.studentId)).toEqual(['stu-1', 'stu-3']);
    });

    it('should return empty array when section scope has no students', () => {
      const scope: DataScope = {
        type: 'section',
        schoolId: 'school-1',
        studentIds: [],
      };
      expect(service.filterByStudentScope(scope, items)).toHaveLength(0);
    });

    it('should skip items without studentId', () => {
      const scope: DataScope = {
        type: 'section',
        schoolId: 'school-1',
        studentIds: ['stu-1'],
      };
      const itemsWithMissing = [
        { studentId: 'stu-1', grade: 'A' },
        { studentId: undefined, grade: 'X' },
      ];
      const result = service.filterByStudentScope(scope, itemsWithMissing);
      expect(result).toHaveLength(1);
    });
  });
});
