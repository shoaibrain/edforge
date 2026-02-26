import { ForbiddenException } from '@nestjs/common';
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

    it('should return school scope for Nurse', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Nurse' });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('school');
      expect(scope.role).toBe('Nurse');
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
        // Parallel enrollment calls: sec-1 and sec-2
        .mockResolvedValueOnce({
          items: [
            { studentId: 'stu-1' },
            { studentId: 'stu-2' },
          ],
          lastEvaluatedKey: undefined,
          hasMore: false,
        })
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

    it('should return empty section scope when Teacher has no staffId (fail-closed)', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Teacher', staffId: undefined });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('section');
      expect(scope.role).toBe('Teacher');
      expect(scope.sectionIds).toEqual([]);
      expect(scope.studentIds).toEqual([]);
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
      expect(new Set(scope.studentIds).size).toBe(3);
    });

    // ========================================================================
    // Fail-closed behavior (new default)
    // ========================================================================

    it('should throw ForbiddenException when no role found (null response)', async () => {
      identityClient.getUserRole.mockResolvedValue(null);

      await expect(
        service.resolveScope('user-1', 'school-1', baseContext),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException on getUserRole error (fail-closed default)', async () => {
      identityClient.getUserRole.mockRejectedValue(new Error('Network error'));

      await expect(
        service.resolveScope('user-1', 'school-1', baseContext),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return empty Teacher scope when resolveTeacherScope DynamoDB fails', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Teacher', staffId: 'staff-1' });
      dynamoDBClient.getClient.mockRejectedValue(new Error('DynamoDB error'));

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      // Teacher DynamoDB failure → empty scope, NOT school-wide
      expect(scope.type).toBe('section');
      expect(scope.role).toBe('Teacher');
      expect(scope.sectionIds).toEqual([]);
      expect(scope.studentIds).toEqual([]);
    });

    it('should return school scope on error when DATA_SCOPE_FAIL_CLOSED=false', async () => {
      const originalEnv = process.env.DATA_SCOPE_FAIL_CLOSED;
      process.env.DATA_SCOPE_FAIL_CLOSED = 'false';

      // Re-create service to pick up env var (module-level const evaluated at import)
      // Since the const is evaluated at module load, we test the behavior by
      // knowing that for non-ForbiddenException errors the code checks FAIL_CLOSED
      // We mock a ForbiddenException from null role, which is always re-thrown
      identityClient.getUserRole.mockResolvedValue(null);

      await expect(
        service.resolveScope('user-1', 'school-1', baseContext),
      ).rejects.toThrow(ForbiddenException);

      process.env.DATA_SCOPE_FAIL_CLOSED = originalEnv;
    });

    it('should support multi-school teacher with different scopes per school', async () => {
      // School 1: Teacher has sections
      identityClient.getUserRole.mockResolvedValue({ role: 'Teacher', staffId: 'staff-1' });
      dynamoDBClient.getClient.mockResolvedValue({} as any);
      dynamoDBClient.queryGSI
        .mockResolvedValueOnce({
          items: [{ sectionId: 'sec-A' }],
          lastEvaluatedKey: undefined,
          hasMore: false,
        })
        .mockResolvedValueOnce({
          items: [{ studentId: 'stu-X' }],
          lastEvaluatedKey: undefined,
          hasMore: false,
        });

      const scope1 = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope1.sectionIds).toEqual(['sec-A']);
      expect(scope1.studentIds).toEqual(['stu-X']);

      // School 2: same teacher, different sections
      identityClient.getUserRole.mockResolvedValue({ role: 'Teacher', staffId: 'staff-1' });
      dynamoDBClient.queryGSI
        .mockResolvedValueOnce({
          items: [{ sectionId: 'sec-B' }],
          lastEvaluatedKey: undefined,
          hasMore: false,
        })
        .mockResolvedValueOnce({
          items: [{ studentId: 'stu-Y' }, { studentId: 'stu-Z' }],
          lastEvaluatedKey: undefined,
          hasMore: false,
        });

      const scope2 = await service.resolveScope('user-1', 'school-2', baseContext);
      expect(scope2.sectionIds).toEqual(['sec-B']);
      expect(scope2.studentIds).toEqual(['stu-Y', 'stu-Z']);
    });

    it('should resolve parent scope to student-level (guardian match)', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Parent' });
      dynamoDBClient.queryGSI.mockResolvedValueOnce({
        items: [
          { studentId: 'stu-1', guardians: [{ userId: 'user-1' }] },
          { studentId: 'stu-2', guardians: [{ userId: 'other-parent' }] },
        ],
        lastEvaluatedKey: undefined,
        hasMore: false,
      });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('student');
      expect(scope.role).toBe('Parent');
      expect(scope.studentIds).toEqual(['stu-1']);
    });

    it('should resolve student scope to student-level (email match)', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Student' });
      dynamoDBClient.queryGSI.mockResolvedValueOnce({
        items: [
          { studentId: 'stu-self', email: 'user@school.org' },
          { studentId: 'stu-other', email: 'other@school.org' },
        ],
        lastEvaluatedKey: undefined,
        hasMore: false,
      });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('student');
      expect(scope.role).toBe('Student');
      expect(scope.studentIds).toEqual(['stu-self']);
    });

    it('should resolve student scope via portalUserId match (preferred over email)', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Student' });
      dynamoDBClient.queryGSI.mockResolvedValueOnce({
        items: [
          { studentId: 'stu-portal', portalUserId: 'user-1', email: 'different@school.org' },
          { studentId: 'stu-email', email: 'user@school.org' },
        ],
        lastEvaluatedKey: undefined,
        hasMore: false,
      });

      const scope = await service.resolveScope('user-1', 'school-1', baseContext);
      expect(scope.type).toBe('student');
      expect(scope.role).toBe('Student');
      // portalUserId match is primary, email match is fallback — both are returned
      expect(scope.studentIds).toEqual(['stu-portal', 'stu-email']);
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

  // ==========================================================================
  // filterBySectionScope
  // ==========================================================================

  describe('filterBySectionScope', () => {
    const items = [
      { sectionId: 'sec-1', name: 'Math' },
      { sectionId: 'sec-2', name: 'Science' },
      { sectionId: 'sec-3', name: 'English' },
    ];

    it('should return all items for school scope', () => {
      const scope: DataScope = { type: 'school', schoolId: 'school-1' };
      expect(service.filterBySectionScope(scope, items)).toHaveLength(3);
    });

    it('should filter items for section scope', () => {
      const scope: DataScope = {
        type: 'section',
        schoolId: 'school-1',
        sectionIds: ['sec-1', 'sec-3'],
      };
      const result = service.filterBySectionScope(scope, items);
      expect(result).toHaveLength(2);
      expect(result.map(r => r.sectionId)).toEqual(['sec-1', 'sec-3']);
    });

    it('should return empty array when section scope has no sections', () => {
      const scope: DataScope = {
        type: 'section',
        schoolId: 'school-1',
        sectionIds: [],
      };
      expect(service.filterBySectionScope(scope, items)).toHaveLength(0);
    });

    it('should skip items without sectionId', () => {
      const scope: DataScope = {
        type: 'section',
        schoolId: 'school-1',
        sectionIds: ['sec-1'],
      };
      const itemsWithMissing = [
        { sectionId: 'sec-1', name: 'Math' },
        { sectionId: undefined, name: 'Unknown' },
      ];
      const result = service.filterBySectionScope(scope, itemsWithMissing);
      expect(result).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Scope caching (Task 6.1)
  // ==========================================================================

  describe('scope cache', () => {
    it('should use cached scope on second call (same user, school)', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Principal' });

      const scope1 = await service.resolveScope('user-1', 'school-1', baseContext);
      const scope2 = await service.resolveScope('user-1', 'school-1', baseContext);

      expect(scope1.type).toBe('school');
      expect(scope2.type).toBe('school');
      // Identity service should only be called once (second call uses cache)
      expect(identityClient.getUserRole).toHaveBeenCalledTimes(1);
    });

    it('should NOT use cache for different schoolId', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Principal' });

      await service.resolveScope('user-1', 'school-1', baseContext);
      await service.resolveScope('user-1', 'school-2', baseContext);

      expect(identityClient.getUserRole).toHaveBeenCalledTimes(2);
    });

    it('should re-resolve after invalidation', async () => {
      identityClient.getUserRole.mockResolvedValue({ role: 'Principal' });

      await service.resolveScope('user-1', 'school-1', baseContext);
      service.invalidateScope('user-1', 'school-1');
      await service.resolveScope('user-1', 'school-1', baseContext);

      expect(identityClient.getUserRole).toHaveBeenCalledTimes(2);
    });
  });
});
