/**
 * S3Service unit tests — Sprint F.2.
 *
 * Mocks `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` +
 * `@aws-sdk/lib-storage` + `@app/auth/token-vending-machine`. Pattern follows
 * identity's `s3-presigner.service.spec.ts` (class-based mocks so
 * `new S3Client(...)` produces an instance with reliably-set properties).
 *
 * Critical contracts being guarded:
 *   1. Every PUT carries `Tagging: 'lifecycle=pdf-jobs'`.
 *      Untagged objects survive the analytics-stack 7d lifecycle by design;
 *      a missing tag would leak storage forever.
 *   2. `presignGet` default TTL = 900s per F.2 locked plan.
 *   3. `putZip(stream)` uses `@aws-sdk/lib-storage` `Upload`, not
 *      `PutObjectCommand` (so multipart >5MB just works).
 *   4. `putPdf(buffer)` uses `PutObjectCommand`, not `Upload`.
 *   5. TVM `assumeRole(jwt, 3600)` is called for every public method
 *      (per-operation cred refresh — F.1 review tail-of-60min-job concern).
 *   6. TVM returns UPPER-CamelCase keys (AccessKeyId etc.); S3Client gets
 *      lowercase (accessKeyId etc.) — same regression class as identity #191.
 *   7. `requestChecksumCalculation: 'WHEN_REQUIRED'` set (identity precedent
 *      for SDK v3.730+ flexible-checksum opt-out).
 *   8. S3Client is `.destroy()`-ed on success AND failure (resource hygiene).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Readable } from 'stream';
import { S3Service } from './s3.service';

const mockS3ClientConstructor = jest.fn();
const mockS3ClientSend = jest.fn();
const mockS3ClientDestroy = jest.fn();
const mockGetSignedUrl = jest.fn();
const mockUploadConstructor = jest.fn();
const mockUploadDone = jest.fn();
const mockAssumeRole = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  __esModule: true,
  S3Client: class MockS3Client {
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
      mockS3ClientConstructor(config);
    }
    send(command: unknown) {
      return mockS3ClientSend(command);
    }
    destroy() {
      mockS3ClientDestroy();
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

jest.mock('@aws-sdk/lib-storage', () => ({
  __esModule: true,
  Upload: class MockUpload {
    params: unknown;
    client: unknown;
    constructor(opts: { client: unknown; params: unknown }) {
      this.params = opts.params;
      this.client = opts.client;
      mockUploadConstructor(opts);
    }
    done() {
      return mockUploadDone();
    }
  },
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  __esModule: true,
  getSignedUrl: (...args: any[]) => mockGetSignedUrl(...args),
}));

jest.mock('@app/auth/token-vending-machine', () => ({
  TokenVendingMachine: class MockTokenVendingMachine {
    constructor(_shouldValidateToken?: boolean) {}
    assumeRole(jwtToken: string, ttl: number) {
      return mockAssumeRole(jwtToken, ttl);
    }
  },
}));

describe('S3Service (F.2)', () => {
  let service: S3Service;
  const ORIGINAL_ENV = process.env;

  const stsCredentials = {
    AccessKeyId: 'ASIA-FAKE-ACCESS-KEY',
    SecretAccessKey: 'fake-secret-access-key',
    SessionToken: 'FQoGZXIvYXdz-fake-session-token',
    Expiration: '2026-06-30T16:00:00Z',
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      PDF_OUTPUT_BUCKET: 'edforge-pdfs-257526644020-ap-south-1',
      AWS_REGION: 'ap-south-1',
    };
    mockAssumeRole.mockResolvedValue(JSON.stringify(stsCredentials));
    mockS3ClientSend.mockResolvedValue({});
    mockUploadDone.mockResolvedValue({});
    mockGetSignedUrl.mockResolvedValue('https://signed-url-from-mock');

    const module: TestingModule = await Test.createTestingModule({
      providers: [S3Service],
    }).compile();
    service = module.get<S3Service>(S3Service);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ============================================================
  // Construction + env-var contract
  // ============================================================
  describe('construction', () => {
    it('exposes the bucket name via getBucketName()', () => {
      expect(service.getBucketName()).toBe('edforge-pdfs-257526644020-ap-south-1');
    });

    it('does NOT throw when PDF_OUTPUT_BUCKET is empty (warns instead — keeps service instantiable in dev/test)', async () => {
      delete process.env.PDF_OUTPUT_BUCKET;
      await expect(
        Test.createTestingModule({ providers: [S3Service] }).compile(),
      ).resolves.toBeDefined();
    });
  });

  // ============================================================
  // putPdf — buffer path uses PutObjectCommand with Tagging
  // ============================================================
  describe('putPdf', () => {
    it('sends a PutObjectCommand with Bucket + Key + Body + Tagging=lifecycle=pdf-jobs', async () => {
      const buffer = Buffer.from('fake-pdf-bytes');

      await service.putPdf('tenant-A', 'jwt-A', 'tenants/tenant-A/schools/s1/pdf-jobs/job1/invoice-001.pdf', buffer);

      expect(mockS3ClientSend).toHaveBeenCalledTimes(1);
      const command = mockS3ClientSend.mock.calls[0][0];
      expect(command.input).toEqual({
        Bucket: 'edforge-pdfs-257526644020-ap-south-1',
        Key: 'tenants/tenant-A/schools/s1/pdf-jobs/job1/invoice-001.pdf',
        Body: buffer,
        Tagging: 'lifecycle=pdf-jobs',
      });
    });

    it('uses PutObjectCommand (NOT lib-storage Upload) for buffer puts', async () => {
      await service.putPdf('t', 'j', 'k', Buffer.from('x'));

      expect(mockUploadConstructor).not.toHaveBeenCalled();
      expect(mockS3ClientSend).toHaveBeenCalledTimes(1);
    });

    it('destroys the S3Client after the put completes', async () => {
      await service.putPdf('t', 'j', 'k', Buffer.from('x'));

      expect(mockS3ClientDestroy).toHaveBeenCalledTimes(1);
    });

    it('destroys the S3Client even when the put throws', async () => {
      mockS3ClientSend.mockRejectedValueOnce(new Error('AccessDenied'));

      await expect(service.putPdf('t', 'j', 'k', Buffer.from('x'))).rejects.toThrow('AccessDenied');

      expect(mockS3ClientDestroy).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // putZip — stream path uses lib-storage Upload with Tagging
  // ============================================================
  describe('putZip', () => {
    it('uses lib-storage Upload (multipart-capable), NOT PutObjectCommand, with Tagging=lifecycle=pdf-jobs', async () => {
      const stream = Readable.from(['chunk1', 'chunk2']);

      await service.putZip('tenant-B', 'jwt-B', 'tenants/tenant-B/schools/s1/pdf-jobs/job2/invoices.zip', stream);

      expect(mockS3ClientSend).not.toHaveBeenCalled();
      expect(mockUploadConstructor).toHaveBeenCalledTimes(1);

      const uploadOpts = mockUploadConstructor.mock.calls[0][0];
      expect(uploadOpts.params).toEqual({
        Bucket: 'edforge-pdfs-257526644020-ap-south-1',
        Key: 'tenants/tenant-B/schools/s1/pdf-jobs/job2/invoices.zip',
        Body: stream,
        Tagging: 'lifecycle=pdf-jobs',
      });
    });

    it('awaits Upload.done() to drive multipart completion', async () => {
      await service.putZip('t', 'j', 'k', Readable.from(['x']));

      expect(mockUploadDone).toHaveBeenCalledTimes(1);
    });

    it('destroys the S3Client after the upload completes', async () => {
      await service.putZip('t', 'j', 'k', Readable.from(['x']));

      expect(mockS3ClientDestroy).toHaveBeenCalledTimes(1);
    });

    it('destroys the S3Client even when Upload.done() throws', async () => {
      mockUploadDone.mockRejectedValueOnce(new Error('PartFailure'));

      await expect(service.putZip('t', 'j', 'k', Readable.from(['x']))).rejects.toThrow('PartFailure');

      expect(mockS3ClientDestroy).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // presignGet — TTL contract + key passthrough
  // ============================================================
  describe('presignGet', () => {
    it('mints a GET URL with 900s default TTL (locked F.2 plan)', async () => {
      await service.presignGet('tenant-C', 'jwt-C', 'tenants/tenant-C/schools/s1/pdf-jobs/job3/invoices.zip');

      const [, command, options] = mockGetSignedUrl.mock.calls[0];
      expect(command.input).toEqual({
        Bucket: 'edforge-pdfs-257526644020-ap-south-1',
        Key: 'tenants/tenant-C/schools/s1/pdf-jobs/job3/invoices.zip',
      });
      expect(options).toEqual({ expiresIn: 900 });
    });

    it('honors a custom expirySec override (e.g. F.4 job-GET re-mint with 60s buffer)', async () => {
      await service.presignGet('t', 'j', 'k', 60);

      const [, , options] = mockGetSignedUrl.mock.calls[0];
      expect(options).toEqual({ expiresIn: 60 });
    });

    it('returns the signed URL string unchanged from getSignedUrl', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://signed?x-amz-signature=abc');

      const result = await service.presignGet('t', 'j', 'k');

      expect(result).toBe('https://signed?x-amz-signature=abc');
    });

    it('destroys the S3Client after the URL is minted', async () => {
      await service.presignGet('t', 'j', 'k');

      expect(mockS3ClientDestroy).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // TVM credential wiring — regression guards
  // ============================================================
  describe('TVM credential wiring (regression guards)', () => {
    it.each([
      ['putPdf', async (s: S3Service) => s.putPdf('t', 'jwt-X', 'k', Buffer.from('x'))],
      ['putZip', async (s: S3Service) => s.putZip('t', 'jwt-X', 'k', Readable.from(['x']))],
      ['presignGet', async (s: S3Service) => s.presignGet('t', 'jwt-X', 'k')],
    ])(
      '%s calls TVM.assumeRole(jwt, 3600) and constructs a fresh S3Client per call',
      async (_methodName, invoke) => {
        await invoke(service);

        expect(mockAssumeRole).toHaveBeenCalledWith('jwt-X', 3600);
        expect(mockS3ClientConstructor).toHaveBeenCalledTimes(1);
      },
    );

    it('maps TVM UPPER-CamelCase credential keys to S3Client lowercase keys (identity PR #191 regression class)', async () => {
      await service.putPdf('t', 'jwt', 'k', Buffer.from('x'));

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

    it('constructs S3Client with requestChecksumCalculation: WHEN_REQUIRED (SDK v3.730+ regression guard)', async () => {
      await service.putPdf('t', 'jwt', 'k', Buffer.from('x'));

      expect(mockS3ClientConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ requestChecksumCalculation: 'WHEN_REQUIRED' }),
      );
    });

    it('propagates TVM errors (no swallow)', async () => {
      mockAssumeRole.mockRejectedValueOnce(new Error('STS-AccessDenied'));

      await expect(service.putPdf('t', 'jwt', 'k', Buffer.from('x'))).rejects.toThrow('STS-AccessDenied');
      expect(mockS3ClientSend).not.toHaveBeenCalled();
    });
  });
});
