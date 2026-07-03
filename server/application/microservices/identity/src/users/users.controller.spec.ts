/**
 * UsersController — GET /users/me profile assembly.
 *
 * Pins the Cognito-first merge contract: the saved default-school
 * preference (returned by AuthService.getCurrentUser under
 * user.preferences) must be threaded onto the flat profile DTO, and the
 * endpoint must stay resilient when the DynamoDB user record is missing
 * (users created via Cognito Hosted UI / provisioning).
 */
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { RolesService } from '../roles/roles.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantContext } from '@app/auth';
import {
  currentUserProfileSchema,
  type CurrentUserResponseDto,
  type UserResponseDto,
  type SchoolAssignmentDto,
} from '@aibrains/shared-types';

describe('UsersController — GET /users/me', () => {
  let controller: UsersController;

  const mockAuthService = {
    getCurrentUser: jest.fn(),
  };

  const mockUsersService = {
    getUser: jest.fn(),
    getUserAssignments: jest.fn(),
  };

  const mockRolesService = {
    getUserPermissions: jest.fn(),
  };

  const tenant: TenantContext = {
    userId: 'user-123',
    username: 'jane-tenant-123',
    tenantId: 'tenant-123',
    tenantTier: 'BASIC',
    tenantName: 'Saraswati',
    email: 'jane@school.edu',
    globalRole: 'TenantUser',
    userPoolId: 'us-east-1_test',
    appClientId: 'client-123',
  };

  const req = { headers: { authorization: 'Bearer test-token' } } as unknown as Request;

  const buildCurrentUser = (
    preferences?: { theme: string; language: string; timezone: string; defaultSchoolId?: string },
  ): CurrentUserResponseDto => ({
    user: {
      userId: 'user-123',
      email: 'jane@school.edu',
      firstName: 'Jane',
      lastName: 'Karki',
      globalRole: 'TenantUser',
      tenantId: 'tenant-123',
      roles: [],
      preferences,
    },
    session: {
      sessionId: 'session-1',
      createdAt: '2026-07-01T00:00:00.000Z',
      expiresAt: '2026-07-01T01:00:00.000Z',
    },
  });

  const dynamoUser: UserResponseDto = {
    userId: 'user-123',
    email: 'jane@school.edu',
    firstName: 'Jane',
    lastName: 'Karki',
    displayName: 'Jane K.',
    globalRole: 'TenantUser',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };

  const assignments: SchoolAssignmentDto[] = [
    { schoolId: 'school-1', schoolName: 'Saraswati Secondary', role: 'Teacher' },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUsersService.getUserAssignments.mockResolvedValue(assignments);

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: RolesService, useValue: mockRolesService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(UsersController);
  });

  it('threads defaultSchoolId from auth preferences onto the profile', async () => {
    mockAuthService.getCurrentUser.mockResolvedValue(
      buildCurrentUser({
        theme: 'light',
        language: 'en',
        timezone: 'Asia/Kathmandu',
        defaultSchoolId: 'school-1',
      }),
    );
    mockUsersService.getUser.mockResolvedValue(dynamoUser);

    const result = await controller.getCurrentUser(tenant, req);

    expect(result.defaultSchoolId).toBe('school-1');
    expect(result.userId).toBe('user-123');
    expect(result.assignments).toEqual(assignments);
  });

  it('omits defaultSchoolId when preferences are undefined', async () => {
    mockAuthService.getCurrentUser.mockResolvedValue(buildCurrentUser(undefined));
    mockUsersService.getUser.mockResolvedValue(dynamoUser);

    const result = await controller.getCurrentUser(tenant, req);

    expect(result.defaultSchoolId).toBeUndefined();
  });

  it('returns a valid profile when the DynamoDB user record is missing', async () => {
    mockAuthService.getCurrentUser.mockResolvedValue(
      buildCurrentUser({
        theme: 'light',
        language: 'en',
        timezone: 'Asia/Kathmandu',
        defaultSchoolId: 'school-1',
      }),
    );
    mockUsersService.getUser.mockRejectedValue(new NotFoundException('User not found'));

    const result = await controller.getCurrentUser(tenant, req);

    expect(result.userId).toBe('user-123');
    expect(result.displayName).toBe('Jane Karki');
    expect(result.status).toBe('active');
    expect(result.defaultSchoolId).toBe('school-1');
    expect(currentUserProfileSchema.safeParse(result).success).toBe(true);
  });
});
