/**
 * SecurityController unit tests — login-history limit validation
 * (PR #420 review / P2a).
 *
 * `?limit=abc` (NaN) and `?limit=0` previously fell through the `limit ? ...`
 * guard and dropped the DynamoDB Limit entirely, letting one request scan the
 * whole login-history partition. The controller now bounds the page size:
 * default 20, reject non-positive-integers with 400, clamp oversized to 100.
 */

import { BadRequestException } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';

describe('SecurityController — login-history limit validation (P2a)', () => {
  let controller: SecurityController;
  let mockService: { getLoginHistory: jest.Mock };

  // buildContext only reads these fields + req.headers.authorization.
  const tenant: any = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    email: 'u1@example.com',
    globalRole: 'TenantUser',
    username: 'u1',
  };
  const req: any = { headers: { authorization: 'Bearer tok' } };

  beforeEach(() => {
    mockService = {
      getLoginHistory: jest
        .fn()
        .mockResolvedValue({ entries: [], total: 0, hasMore: false }),
    };
    controller = new SecurityController(mockService as unknown as SecurityService);
  });

  const call = (limit: string | undefined, cursor = '') =>
    controller.getLoginHistory('user-1', limit as any, cursor, tenant, req);

  it('defaults to 20 when limit is absent', async () => {
    await call(undefined);
    expect(mockService.getLoginHistory).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      20,
      undefined,
    );
  });

  it('forwards a valid limit unchanged', async () => {
    await call('50');
    expect(mockService.getLoginHistory.mock.calls[0][2]).toBe(50);
  });

  it('clamps an oversized limit to 100', async () => {
    await call('999999');
    expect(mockService.getLoginHistory.mock.calls[0][2]).toBe(100);
  });

  it.each(['abc', '0', '-5', '1.5', '  '])(
    'rejects invalid limit %p with 400 and does not hit the service',
    async (bad) => {
      await expect(call(bad)).rejects.toBeInstanceOf(BadRequestException);
      expect(mockService.getLoginHistory).not.toHaveBeenCalled();
    },
  );

  it('maps an empty cursor to undefined and forwards a real cursor', async () => {
    await call('10', 'the-cursor');
    expect(mockService.getLoginHistory).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      10,
      'the-cursor',
    );
  });
});
