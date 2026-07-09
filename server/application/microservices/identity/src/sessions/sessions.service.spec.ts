/**
 * SessionsService — admin/self revocation teeth (Sprint 4: S4.1a / S4.2 / S4.4).
 *
 * Cognito is globally mocked in jest.setup.js (AdminUserGlobalSignOutCommand is
 * a jest.fn; the client's send resolves), so we assert the command was built
 * with the TARGET user's Cognito username.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminUserGlobalSignOutCommand } from '@aws-sdk/client-cognito-identity-provider';
import { SessionsService } from './sessions.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityAnalyticsEventsService } from '../common/services/identity-analytics-events.service';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';

describe('SessionsService — revocation teeth', () => {
  let service: SessionsService;

  const mockDb = {
    getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
    getItem: jest.fn(),
    query: jest.fn(),
    updateItem: jest.fn().mockResolvedValue({}),
  };
  const mockAnalytics = { emitSessionRevoked: jest.fn() };

  const adminCtx: RequestContext = {
    userId: 'admin-1',
    tenantId: 't-1',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'jwt',
  };
  const selfCtx: RequestContext = {
    ...adminCtx,
    userId: 'user-1',
    globalRole: 'TenantUser' as GlobalRole,
  };
  const oneActiveSession = { items: [{ entityKey: 'SESSION#s1', sessionId: 's1', userId: 'user-1' }] };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Explicit (don't lean on jest.setup.js) so a UserPoolId:'' regression is
    // caught by the assertions below (review P3).
    process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: DynamoDBClientService, useValue: mockDb },
        { provide: IdentityAnalyticsEventsService, useValue: mockAnalytics },
      ],
    }).compile();
    service = mod.get<SessionsService>(SessionsService);
  });

  describe('revokeUserSessions (admin)', () => {
    it('403s a non-admin caller', async () => {
      await expect(service.revokeUserSessions('user-1', selfCtx)).rejects.toBeInstanceOf(
        ForbiddenException
      );
    });

    it('404s a target not in the caller tenant — cross-tenant defense (S4.1a)', async () => {
      mockDb.getItem.mockResolvedValue(null); // target absent from caller's tenant partition
      await expect(
        service.revokeUserSessions('tenant-b-user', adminCtx)
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockDb.query).not.toHaveBeenCalled(); // rejected before any revoke
    });

    it('revokes the target rows AND global-signs-out the TARGET (S4.2), emits admin event (S4.4)', async () => {
      mockDb.getItem.mockResolvedValue({
        userId: 'user-1',
        cognitoUsername: 'cognito-user-1',
        globalRole: 'TenantUser',
      });
      mockDb.query.mockResolvedValue(oneActiveSession);

      const res = await service.revokeUserSessions('user-1', adminCtx);

      expect(res.revokedCount).toBe(1);
      expect(mockDb.updateItem).toHaveBeenCalled(); // DDB row flipped
      // Global sign-out uses the TARGET's username + the configured pool.
      expect(AdminUserGlobalSignOutCommand).toHaveBeenCalledWith(
        { UserPoolId: 'test-pool-id', Username: 'cognito-user-1' }
      );
      expect(mockAnalytics.emitSessionRevoked).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          metadata: expect.objectContaining({ admin: true, revokedBy: 'admin-1', globalSignOut: true }),
        })
      );
    });
  });

  describe('revokeAllSessions (self)', () => {
    it('global-signs-out on a full "sign out everywhere"', async () => {
      mockDb.getItem.mockResolvedValue({ userId: 'user-1', cognitoUsername: 'cognito-user-1' });
      mockDb.query.mockResolvedValue(oneActiveSession);

      await service.revokeAllSessions({}, selfCtx);

      expect(AdminUserGlobalSignOutCommand).toHaveBeenCalledWith(
        { UserPoolId: 'test-pool-id', Username: 'cognito-user-1' }
      );
    });

    it('does NOT global-sign-out when a current session is truly preserved', async () => {
      // exceptCurrentSession matches an active session → it is skipped/kept.
      mockDb.query.mockResolvedValue(oneActiveSession); // sessionId 's1'
      await service.revokeAllSessions({ exceptCurrentSession: 's1' }, selfCtx);
      expect(AdminUserGlobalSignOutCommand).not.toHaveBeenCalled();
    });

    it('DOES global-sign-out when exceptCurrentSession is stale/bogus (nothing preserved) — review P2', async () => {
      // Caller-controlled exceptCurrentSession matches no active session, so every
      // active session is revoked → refresh tokens must die too.
      mockDb.getItem.mockResolvedValue({ userId: 'user-1', cognitoUsername: 'cognito-user-1' });
      mockDb.query.mockResolvedValue(oneActiveSession); // only 's1' active
      await service.revokeAllSessions({ exceptCurrentSession: 'not-a-real-session' }, selfCtx);
      expect(AdminUserGlobalSignOutCommand).toHaveBeenCalledWith(
        { UserPoolId: 'test-pool-id', Username: 'cognito-user-1' }
      );
    });
  });
});
