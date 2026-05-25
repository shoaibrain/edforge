/**
 * S3PresignerService Unit Tests — Sprint C.0-followup C.0-fu.3.
 *
 * The two specific bugs C.0.7 ran into at deploy time would have been
 * caught here at unit-test time, with the mocks below in place:
 *
 *   1. PR #190 (missing @UseGuards on BrandingController) — caught by
 *      branding.service.spec.ts mocking TenantCredentials directly.
 *   2. PR #191 (lowercase `creds.accessKeyId` vs TVM's capitalized
 *      `AccessKeyId`) — caught here: the `assertGetClientCredentialMapping`
 *      test asserts the S3Client constructor receives lowercase keys
 *      `{accessKeyId, secretAccessKey, sessionToken}` populated from the
 *      uppercase keys that TVM returns.
 *
 * The TVM (TokenVendingMachine) returns a JSON-stringified `Credentials`
 * object from AWS STS, which uses UPPER-CamelCase. The v3 S3Client
 * constructor expects lowercase keys. This casing-shift is the entire
 * point of the unit test.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { S3PresignerService } from './s3-presigner.service';

// Mock the AWS SDK modules so the test never hits real STS or S3.
// Use class-based mocks (instead of jest.fn().mockImplementation as a
// constructor) so `new S3Client(...)`/`new PutObjectCommand(...)` produces
// instances whose properties are reliably set — same gotcha class as the
// TVM mock below.
const mockS3ClientConstructor = jest.fn();
const mockGetSignedUrl = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  __esModule: true,
  S3Client: class MockS3Client {
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
      mockS3ClientConstructor(config);
    }
  },
  PutObjectCommand: class MockPutObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  GetObjectCommand: class MockGetObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  __esModule: true,
  getSignedUrl: (...args: any[]) => mockGetSignedUrl(...args),
}));

// TokenVendingMachine is imported from @app/auth/token-vending-machine.
// Its `assumeRole(jwt, ttl)` returns a JSON-string of AWS STS Credentials.
// We mock the whole class so the test never tries to assume a real role.
// Use class-based mock (instead of jest.fn().mockImplementation) so the
// `new TokenVendingMachine(false)` invocation produces an instance whose
// prototype has the assumeRole method — bypassing the subtle gotchas of
// `new jest.fn()` constructor-mock interactions.
const mockAssumeRole = jest.fn();
jest.mock('@app/auth/token-vending-machine', () => ({
  TokenVendingMachine: class MockTokenVendingMachine {
    constructor(_shouldValidateToken?: boolean) {}
    assumeRole(jwtToken: string, ttl: number) {
      return mockAssumeRole(jwtToken, ttl);
    }
  },
}));

describe('S3PresignerService', () => {
  let service: S3PresignerService;
  const ORIGINAL_ENV = process.env;

  // The exact STS-shape credentials TVM returns — UPPER-CamelCase keys.
  // PR #191 hotfix established this as the wire format.
  const stsCredentials = {
    AccessKeyId: 'ASIA-FAKE-ACCESS-KEY',
    SecretAccessKey: 'fake-secret-access-key',
    SessionToken: 'FQoGZXIvYXdz-fake-session-token',
    Expiration: '2026-05-25T05:00:00Z',
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      PDF_ASSETS_BUCKET: 'edforge-pdf-assets-257526644020-ap-south-1',
      AWS_REGION: 'ap-south-1',
    };
    mockAssumeRole.mockResolvedValue(JSON.stringify(stsCredentials));
    mockGetSignedUrl.mockResolvedValue('https://signed-url-from-mock');

    const module: TestingModule = await Test.createTestingModule({
      providers: [S3PresignerService],
    }).compile();

    service = module.get<S3PresignerService>(S3PresignerService);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ============================================================
  // Constructor + env-var contract
  // ============================================================
  describe('construction', () => {
    it('throws when PDF_ASSETS_BUCKET env var is missing', async () => {
      delete process.env.PDF_ASSETS_BUCKET;

      await expect(
        Test.createTestingModule({
          providers: [S3PresignerService],
        }).compile(),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('exposes the bucket name via getBucketName()', () => {
      expect(service.getBucketName()).toBe('edforge-pdf-assets-257526644020-ap-south-1');
    });
  });

  // ============================================================
  // The C.0.7 hotfix #191 regression guard — TVM credential casing
  // ============================================================
  describe('TVM credential mapping (regression guard for PR #191)', () => {
    it('constructs S3Client with lowercase keys mapped from TVM uppercase response', async () => {
      await service.presignPut('mock-jwt', 'tenants/x/schools/y/branding/logo/z.png', 'image/png', 100);

      // PR #191 lesson: TVM returns AccessKeyId, SecretAccessKey, SessionToken (capitalized).
      // The v3 S3Client constructor expects accessKeyId, secretAccessKey, sessionToken (lowercase).
      // If the code reads `creds.accessKeyId` instead of `creds.AccessKeyId`, the credential
      // object passed to S3Client has all-undefined values and the SDK throws
      // "Resolved credential object is not valid".
      expect(mockS3ClientConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'ap-south-1',
          credentials: {
            accessKeyId: 'ASIA-FAKE-ACCESS-KEY',
            secretAccessKey: 'fake-secret-access-key',
            sessionToken: 'FQoGZXIvYXdz-fake-session-token',
          },
        }),
      );
    });

    it('passes the caller JWT through to TVM.assumeRole', async () => {
      await service.presignPut('the-real-jwt', 'k', 'image/png', 1);

      expect(mockAssumeRole).toHaveBeenCalledWith('the-real-jwt', 3600);
    });
  });

  // ============================================================
  // presignPut — input pass-through
  // ============================================================
  describe('presignPut', () => {
    it('signs the URL with ContentType + ContentLength baked into the PutObjectCommand', async () => {
      await service.presignPut('jwt', 'tenants/x/branding/logo/z.png', 'image/png', 67);

      // The PutObjectCommand instance is the second arg to getSignedUrl; assert
      // its input includes the contract fields.
      const [, command, options] = mockGetSignedUrl.mock.calls[0];
      expect(command.input).toEqual(
        expect.objectContaining({
          Bucket: 'edforge-pdf-assets-257526644020-ap-south-1',
          Key: 'tenants/x/branding/logo/z.png',
          ContentType: 'image/png',
          ContentLength: 67,
        }),
      );
      expect(options).toEqual({ expiresIn: 300 });
    });

    it('honors a custom expiresInSeconds override', async () => {
      await service.presignPut('jwt', 'k', 'image/png', 1, 60);

      const [, , options] = mockGetSignedUrl.mock.calls[0];
      expect(options).toEqual({ expiresIn: 60 });
    });
  });

  // ============================================================
  // presignGet — for C.0-fu.2 signed-URL response
  // ============================================================
  describe('presignGet', () => {
    it('signs the URL with the bucket + key, defaulting to 10-min TTL', async () => {
      await service.presignGet('jwt', 'tenants/x/branding/logo/abc.png');

      const [, command, options] = mockGetSignedUrl.mock.calls[0];
      expect(command.input).toEqual({
        Bucket: 'edforge-pdf-assets-257526644020-ap-south-1',
        Key: 'tenants/x/branding/logo/abc.png',
      });
      expect(options).toEqual({ expiresIn: 600 });
    });

    it('returns the signed URL string from getSignedUrl unchanged', async () => {
      mockGetSignedUrl.mockResolvedValue('https://my-signed-url?x-amz-signature=abc');

      const result = await service.presignGet('jwt', 'k');

      expect(result).toBe('https://my-signed-url?x-amz-signature=abc');
    });
  });
});
