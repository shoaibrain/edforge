/**
 * AuthService — login-history wiring (Sprint IA-1, S1.1).
 *
 * Verifies that AuthService.login() persists a login-history row via
 * SecurityService.recordLoginAttempt on BOTH outcomes:
 *   - success → status 'success' under the authenticated (tenantId, userId)
 *   - invalid-credentials → status 'failed', attributed to the user resolved
 *     by email (GSI1), so it surfaces in their history + feeds lockout.
 * And that a history-write failure never breaks an otherwise-successful login.
 *
 * The Cognito client is created inside the AuthService constructor, so we spy
 * on the constructed instance's `.send` directly (no aws-sdk-client-mock —
 * that lib is incompatible with the installed SDK version). DynamoDBClientService
 * / SecurityService / analytics are injected mocks.
 */

import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityAnalyticsEventsService } from '../common/services/identity-analytics-events.service';
import { SecurityService } from '../security/security.service';
import type { User } from '../common/entities/user.entity';

const TENANT_ID = '21aea5da-511f-4dfa-a6f2-6971f63a719f';
const USER_ID = 'user-sub-123';
const EMAIL = 'teacher@example.com';

const existingUser = {
  tenantId: TENANT_ID,
  entityKey: `USER#${USER_ID}`,
  entityType: 'USER',
  userId: USER_ID,
  email: EMAIL,
  firstName: 'Test',
  lastName: 'Teacher',
  globalRole: 'TenantUser',
  status: 'active',
} as unknown as User;

const AUTH_SUCCESS = {
  AuthenticationResult: {
    AccessToken: 'access-token',
    RefreshToken: 'refresh-token',
    ExpiresIn: 3600,
    IdToken: 'id-token',
  },
};

const GET_USER_RESULT = {
  Username: 'cognito-username',
  UserAttributes: [
    { Name: 'custom:tenantId', Value: TENANT_ID },
    { Name: 'sub', Value: USER_ID },
    { Name: 'given_name', Value: 'Test' },
    { Name: 'family_name', Value: 'Teacher' },
    { Name: 'custom:userRole', Value: 'TenantUser' },
  ],
};

describe('AuthService — login history wiring (S1.1)', () => {
  let service: AuthService;
  let cognitoSend: jest.Mock;
  let dynamo: {
    getSystemClient: jest.Mock;
    getItem: jest.Mock;
    updateItem: jest.Mock;
    putItem: jest.Mock;
    query: jest.Mock;
    queryGSI: jest.Mock;
  };
  let security: { recordLoginAttempt: jest.Mock };
  let analytics: {
    emitLoginSuccess: jest.Mock;
    emitSessionCreated: jest.Mock;
    emitLoginFailure: jest.Mock;
  };

  /** Default Cognito behaviour = successful auth + user lookup. The SDK is
   * globally mocked in jest.setup.js; mocked commands are plain `{ type }`
   * objects, so we branch on `command.type`, not `instanceof`. */
  function cognitoHappyPath(): void {
    cognitoSend.mockImplementation((command: any) => {
      if (command?.type === 'AdminInitiateAuthCommand') return Promise.resolve(AUTH_SUCCESS);
      if (command?.type === 'AdminGetUserCommand') return Promise.resolve(GET_USER_RESULT);
      return Promise.resolve({});
    });
  }

  beforeEach(async () => {
    process.env.COGNITO_USER_POOL_ID = 'pool-id';
    process.env.COGNITO_CLIENT_ID = 'client-id';

    dynamo = {
      getSystemClient: jest.fn().mockReturnValue({}),
      getItem: jest.fn().mockResolvedValue(existingUser),
      updateItem: jest.fn().mockResolvedValue(undefined),
      putItem: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
      queryGSI: jest.fn().mockResolvedValue({ items: [existingUser], hasMore: false }),
    };
    security = { recordLoginAttempt: jest.fn().mockResolvedValue(undefined) };
    analytics = {
      emitLoginSuccess: jest.fn(),
      emitSessionCreated: jest.fn(),
      emitLoginFailure: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DynamoDBClientService, useValue: dynamo },
        { provide: IdentityAnalyticsEventsService, useValue: analytics },
        { provide: SecurityService, useValue: security },
      ],
    }).compile();
    service = moduleRef.get(AuthService);

    // The Cognito client is globally mocked in jest.setup.js; its `send` is the
    // shared jest.fn exposed as global.__mocks__.cognito.
    cognitoSend = (global as any).__mocks__.cognito as jest.Mock;
  });

  it('records a success login-history row for the authenticated user', async () => {
    cognitoHappyPath();

    const res = await service.login(
      { email: EMAIL, password: 'correct' } as any,
      { deviceType: 'desktop' } as any,
      '1.2.3.4',
      'UA/1.0',
    );

    expect(res.tokenType).toBe('Bearer');
    expect(security.recordLoginAttempt).toHaveBeenCalledWith(
      TENANT_ID,
      USER_ID,
      'success',
      { ipAddress: '1.2.3.4', userAgent: 'UA/1.0' },
    );
  });

  it('records a failed login-history row on invalid credentials (user resolved by email)', async () => {
    const err = Object.assign(new Error('bad password'), { name: 'NotAuthorizedException' });
    cognitoSend.mockRejectedValue(err);

    await expect(
      service.login(
        { email: EMAIL, password: 'wrong' } as any,
        undefined,
        '1.2.3.4',
        'UA/1.0',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(dynamo.queryGSI).toHaveBeenCalled();
    expect(security.recordLoginAttempt).toHaveBeenCalledWith(
      TENANT_ID,
      USER_ID,
      'failed',
      expect.objectContaining({ failureReason: 'Invalid credentials', ipAddress: '1.2.3.4' }),
    );
  });

  it('skips the failed row when the email resolves to no user', async () => {
    const err = Object.assign(new Error('bad'), { name: 'NotAuthorizedException' });
    cognitoSend.mockRejectedValue(err);
    dynamo.queryGSI.mockResolvedValueOnce({ items: [], hasMore: false });

    await expect(
      service.login({ email: 'ghost@example.com', password: 'x' } as any, undefined, undefined, undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(security.recordLoginAttempt).not.toHaveBeenCalled();
  });

  it('does not fail an otherwise-successful login when history recording throws', async () => {
    cognitoHappyPath();
    security.recordLoginAttempt.mockRejectedValueOnce(new Error('ddb unavailable'));

    await expect(
      service.login({ email: EMAIL, password: 'correct' } as any, undefined, undefined, undefined),
    ).resolves.toMatchObject({ tokenType: 'Bearer' });
  });
});
