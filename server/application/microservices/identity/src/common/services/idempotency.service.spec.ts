/**
 * IdempotencyService unit tests — Sprint S0.10
 *
 * Covers:
 *   - key validation: rejects too-short and too-long keys
 *   - body hashing: stable + deterministic
 *   - first invocation: executes, persists 'completed' with cached body
 *   - replay with same body: returns cached value, does NOT re-execute
 *   - replay with different body: throws IdempotencyConflictError
 *   - executor failure: persists 'failed' marker, propagates error
 *   - in_progress on read: surfaces as conflict (V1 simplification)
 */

import { Test, TestingModule } from '@nestjs/testing';
import {
  IdempotencyService,
  IdempotencyConflictError,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  IDEMPOTENCY_KEY_MAX_LENGTH,
} from './idempotency.service';
import { DynamoDBClientService } from './dynamodb-client.service';
import { RequestContext, GlobalRole } from '../entities/base.entity';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let mockDynamoDBClient: any;

  const mockContext: RequestContext = {
    userId: 'admin-user',
    tenantId: 'tenant-1',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt',
  };

  // A valid 32-char key (UUID-shape, also satisfies min/max bounds).
  const VALID_KEY = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(async () => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
      getItem: jest.fn().mockResolvedValue(null),
      putItem: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        {
          provide: IdempotencyService,
          useFactory: (db: DynamoDBClientService) => new IdempotencyService(db),
          inject: [DynamoDBClientService],
        },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('header convention constants', () => {
    it('exposes the canonical header name', () => {
      expect(IDEMPOTENCY_HEADER).toBe('Idempotency-Key');
    });

    it('sets reasonable length bounds', () => {
      expect(IDEMPOTENCY_KEY_MIN_LENGTH).toBeLessThan(IDEMPOTENCY_KEY_MAX_LENGTH);
      expect(IDEMPOTENCY_KEY_MAX_LENGTH).toBeLessThanOrEqual(64);
    });
  });

  describe('validateKey', () => {
    it('accepts a UUID-shaped key', () => {
      expect(service.validateKey(VALID_KEY)).toBe(VALID_KEY);
    });

    it('trims whitespace', () => {
      expect(service.validateKey(`  ${VALID_KEY}  `)).toBe(VALID_KEY);
    });

    it('rejects keys shorter than the minimum', () => {
      expect(() => service.validateKey('too-short')).toThrow(/Invalid Idempotency-Key/);
    });

    it('rejects keys longer than the maximum', () => {
      const tooLong = 'x'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1);
      expect(() => service.validateKey(tooLong)).toThrow(/Invalid Idempotency-Key/);
    });

    it('rejects an empty key', () => {
      expect(() => service.validateKey('')).toThrow(/Invalid Idempotency-Key/);
    });
  });

  describe('hashRequestBody', () => {
    it('produces a deterministic hash for the same body', () => {
      const body = { name: 'AY 2083', startDate: '2026-04-15' };
      expect(service.hashRequestBody(body)).toBe(service.hashRequestBody(body));
    });

    it('produces different hashes for different bodies', () => {
      const a = service.hashRequestBody({ name: 'AY 2083' });
      const b = service.hashRequestBody({ name: 'AY 2084' });
      expect(a).not.toBe(b);
    });

    it('produces a stable hash for an undefined body (no-body POST/DELETE)', () => {
      const h1 = service.hashRequestBody(undefined);
      const h2 = service.hashRequestBody(undefined);
      expect(h1).toBe(h2);
      // And distinct from a serialized empty-string body — these are
      // semantically different request shapes, so they hash differently.
      expect(h1).not.toBe(service.hashRequestBody(''));
    });
  });

  describe('runOnce — first invocation', () => {
    it('executes the executor when no prior key exists', async () => {
      const executor = jest.fn().mockResolvedValue({ yearId: 'new-uuid' });

      const result = await service.runOnce(mockContext, {
        idempotencyKey: VALID_KEY,
        requestSignature: 'POST /academic-years',
        requestBody: { name: 'AY 2083' },
        executor,
      });

      expect(executor).toHaveBeenCalledTimes(1);
      expect(result.fromCache).toBe(false);
      expect(result.value).toEqual({ yearId: 'new-uuid' });
    });

    it('persists an in_progress reservation, then a completed row', async () => {
      const executor = jest.fn().mockResolvedValue('ok');

      await service.runOnce(mockContext, {
        idempotencyKey: VALID_KEY,
        requestSignature: 'POST /things',
        requestBody: { x: 1 },
        executor,
      });

      // Two putItem calls: reservation (in_progress) + completion.
      expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(2);
      const [, reservation] = mockDynamoDBClient.putItem.mock.calls[0];
      const [, completion] = mockDynamoDBClient.putItem.mock.calls[1];
      expect(reservation.status).toBe('in_progress');
      expect(completion.status).toBe('completed');
      expect(completion.cachedResponse?.body).toBe('ok');
    });
  });

  describe('runOnce — replay with same body', () => {
    it('returns the cached value without executing again', async () => {
      const cachedBody = { yearId: 'cached-uuid' };
      const bodyHash = service.hashRequestBody({ name: 'AY 2083' });

      mockDynamoDBClient.getItem.mockResolvedValue({
        idempotencyKey: VALID_KEY,
        requestBodyHash: bodyHash,
        status: 'completed',
        cachedResponse: { statusCode: 200, body: cachedBody },
      });

      const executor = jest.fn();
      const result = await service.runOnce(mockContext, {
        idempotencyKey: VALID_KEY,
        requestSignature: 'POST /academic-years',
        requestBody: { name: 'AY 2083' },
        executor,
      });

      expect(executor).not.toHaveBeenCalled();
      expect(result.fromCache).toBe(true);
      expect(result.value).toEqual(cachedBody);
    });
  });

  describe('runOnce — replay with different body', () => {
    it('throws IdempotencyConflictError when the cached row has a different body hash', async () => {
      const previousHash = service.hashRequestBody({ name: 'AY 2083' });
      mockDynamoDBClient.getItem.mockResolvedValue({
        idempotencyKey: VALID_KEY,
        requestBodyHash: previousHash,
        status: 'completed',
        cachedResponse: { statusCode: 200, body: { yearId: 'cached' } },
      });

      const executor = jest.fn();
      await expect(
        service.runOnce(mockContext, {
          idempotencyKey: VALID_KEY,
          requestSignature: 'POST /academic-years',
          // Different body — should conflict.
          requestBody: { name: 'AY 2084' },
          executor,
        }),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);

      expect(executor).not.toHaveBeenCalled();
    });
  });

  describe('runOnce — executor failure', () => {
    it('persists a failed marker and propagates the error', async () => {
      const executor = jest.fn().mockRejectedValue(new Error('downstream 500'));

      await expect(
        service.runOnce(mockContext, {
          idempotencyKey: VALID_KEY,
          requestSignature: 'POST /things',
          requestBody: {},
          executor,
        }),
      ).rejects.toThrow('downstream 500');

      // Two puts: reservation, then failed marker.
      expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(2);
      const [, failedMarker] = mockDynamoDBClient.putItem.mock.calls[1];
      expect(failedMarker.status).toBe('failed');
    });
  });

  describe('runOnce — in_progress race', () => {
    it('conflicts on a replay that finds the prior request still in_progress', async () => {
      const hash = service.hashRequestBody({ x: 1 });
      mockDynamoDBClient.getItem.mockResolvedValue({
        idempotencyKey: VALID_KEY,
        requestBodyHash: hash,
        status: 'in_progress',
      });

      await expect(
        service.runOnce(mockContext, {
          idempotencyKey: VALID_KEY,
          requestSignature: 'POST /things',
          requestBody: { x: 1 },
          executor: jest.fn(),
        }),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
    });
  });
});
