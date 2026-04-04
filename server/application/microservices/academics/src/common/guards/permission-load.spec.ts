/**
 * Performance Test: Concurrent Permission Checks
 *
 * Simulates 50 Teachers hitting the PermissionGuard simultaneously
 * (e.g., 50 Teachers marking attendance at 8 AM).
 *
 * Validates:
 * - p99 < 2s with caching enabled
 * - Cache hit ratio > 80% for repeated checks
 * - No request queueing or deadlock under load
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { IdentityClientService } from '../services/identity-client.service';

// Mock AuditLoggerService
jest.mock('@app/logger', () => ({
  AuditLoggerService: jest.fn().mockImplementation(() => ({
    logPermissionDenied: jest.fn(),
  })),
}));

function createMockContext(userId: string, schoolId: string): ExecutionContext {
  const request = {
    user: {
      userId,
      tenantId: 'tenant-1',
      email: `${userId}@school.org`,
      globalRole: 'StandardUser',
    },
    params: {},
    query: { schoolId },
    body: {},
    path: '/academics/attendance',
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('Permission Load Test', () => {
  let guard: PermissionGuard;
  let reflector: Reflector;
  let identityClient: jest.Mocked<IdentityClientService>;
  let checkPermissionCallCount: number;

  beforeEach(async () => {
    checkPermissionCallCount = 0;

    identityClient = {
      checkPermission: jest.fn().mockImplementation(async () => {
        checkPermissionCallCount++;
        // Simulate network latency (10-50ms)
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 40));
        return { allowed: true };
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionGuard,
        { provide: Reflector, useValue: new Reflector() },
        { provide: IdentityClientService, useValue: identityClient },
      ],
    }).compile();

    guard = module.get<PermissionGuard>(PermissionGuard);
    reflector = module.get<Reflector>(Reflector);

    // All requests check attendance:create
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      resource: 'attendance',
      action: 'create',
    });
  });

  it('should handle 50 concurrent permission checks from different teachers under 2s', async () => {
    const CONCURRENT_USERS = 50;

    const requests = Array.from({ length: CONCURRENT_USERS }, (_, i) =>
      guard.canActivate(createMockContext(`teacher-${i}`, 'school-1')),
    );

    const start = Date.now();
    const results = await Promise.all(requests);
    const elapsed = Date.now() - start;

    // All should be allowed
    expect(results.every((r) => r === true)).toBe(true);

    // p99 should be under 2 seconds
    expect(elapsed).toBeLessThan(2000);

    // All 50 should have called identity service (different users, no cache hits)
    expect(checkPermissionCallCount).toBe(CONCURRENT_USERS);
  });

  it('should achieve high cache hit ratio for repeated checks from same users', async () => {
    const USERS = 10;
    const REQUESTS_PER_USER = 5;

    // First wave: cold cache
    const firstWave = Array.from({ length: USERS }, (_, i) =>
      guard.canActivate(createMockContext(`teacher-${i}`, 'school-1')),
    );
    await Promise.all(firstWave);

    // Reset counter
    checkPermissionCallCount = 0;

    // Second wave: same users (should hit cache)
    const totalRepeated = USERS * (REQUESTS_PER_USER - 1);
    const secondWave: Promise<boolean>[] = [];
    for (let round = 1; round < REQUESTS_PER_USER; round++) {
      for (let i = 0; i < USERS; i++) {
        secondWave.push(
          guard.canActivate(createMockContext(`teacher-${i}`, 'school-1')),
        );
      }
    }

    const start = Date.now();
    const results = await Promise.all(secondWave);
    const elapsed = Date.now() - start;

    // All should be allowed
    expect(results.every((r) => r === true)).toBe(true);

    // Cache should serve all repeated requests (0 new identity service calls)
    expect(checkPermissionCallCount).toBe(0);

    // Cached responses should be near-instant
    expect(elapsed).toBeLessThan(100);
  });

  it('should handle mixed allow/deny decisions under concurrent load', async () => {
    // Even-numbered teachers are allowed, odd are denied
    identityClient.checkPermission.mockImplementation(async (userId: string) => {
      await new Promise((r) => setTimeout(r, 10));
      const num = parseInt(userId.split('-')[1], 10);
      return num % 2 === 0
        ? { allowed: true }
        : { allowed: false, reason: 'No permission' };
    });

    const USERS = 20;
    const results = await Promise.allSettled(
      Array.from({ length: USERS }, (_, i) =>
        guard.canActivate(createMockContext(`teacher-${i}`, 'school-1')),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // 10 even teachers allowed, 10 odd teachers denied (ForbiddenException)
    expect(fulfilled).toHaveLength(10);
    expect(rejected).toHaveLength(10);

    // Verify rejected are ForbiddenException
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException);
    }
  });
});
