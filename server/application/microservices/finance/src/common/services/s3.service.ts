/**
 * S3 Client Service for Finance Service — Sprint F.2.
 *
 * Wraps `@aws-sdk/client-s3` for the finance bulk-PDF-export workflow.
 *
 * Design contract (matches the F.1 + F.3 sprint plan + DynamoDBClientService
 * precedent in the same directory):
 *
 *   - All operations use TVM-minted ABAC credentials, NOT the ECS task role.
 *     The task role has no S3 grants; the F.1 grant lives on the finance
 *     ABAC role (`finance-ABACRole/DefaultPolicy`) scoped via
 *     `${aws:PrincipalTag/tenant}` interpolation. A PUT issued under the
 *     task role would AccessDenied.
 *
 *   - Every method instantiates a fresh `S3Client` via TVM `assumeRole(jwt, 3600)`.
 *     One STS call per service-method invocation. This gives each operation a
 *     fresh 3600s window — required because F.3's bulk-export jobs run up to
 *     60 min and the worker's tail PutObject would otherwise hit `ExpiredToken`
 *     if a single client were shared from job start.
 *
 *   - All PUT operations tag objects `lifecycle=pdf-jobs` at PutObject time.
 *     This is non-negotiable — the analytics-stack S3 lifecycle rule on
 *     `edforge-pdfs-{acct}-{region}` is TAG-based, NOT prefix-based. Untagged
 *     objects survive past the 7-day window (intentional design for the future
 *     audit-copy use case). See `analytics-stack.ts` §1362-1366.
 *
 *   - Multipart uploads via `@aws-sdk/lib-storage`'s `Upload` class for
 *     stream-based puts. The lib handles 5MB+ multipart splitting + parallel
 *     parts + abort-on-error automatically. Buffer-based puts use plain
 *     `PutObjectCommand` (always single-part).
 *
 *   - `requestChecksumCalculation: 'WHEN_REQUIRED'` mirrors the identity
 *     `S3PresignerService` precedent — works around the SDK v3.730+ flexible-
 *     checksum regression that breaks presigned PUT in some browsers.
 *
 *   - No retry policy at the service layer. Errors propagate to the worker.
 *     F.3's worker has its own retry policy at the per-object granularity.
 *
 *   - `tenantId` arg is logged for traceability but NOT used in key
 *     construction. The IAM tenant scoping comes from the STS session tag
 *     (TVM derives this from the JWT's tenant claim). If the caller passes a
 *     `tenantId` that doesn't match the JWT, S3 rejects the request — the
 *     tag is the only authoritative signal.
 */

import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { TokenVendingMachine } from '@app/auth/token-vending-machine';
import { Readable } from 'stream';

const LIFECYCLE_TAG = 'lifecycle=pdf-jobs';
const DEFAULT_PRESIGN_TTL_SEC = 900;

@Injectable()
export class S3Service implements OnApplicationShutdown {
  private readonly logger = new Logger(S3Service.name);
  private readonly bucketName: string;
  private readonly region: string;

  constructor() {
    this.bucketName = process.env.PDF_OUTPUT_BUCKET || '';
    if (!this.bucketName) {
      this.logger.warn(
        'PDF_OUTPUT_BUCKET env var is empty — S3Service operations will fail at runtime. ' +
          'This is expected during local dev without ECS env injection (Sprint F.1 wires this in prod).',
      );
    }
    this.region = process.env.AWS_REGION || 'us-east-1';
  }

  onApplicationShutdown(signal?: string): void {
    this.logger.log(`S3Service shutdown (signal: ${signal || 'none'})`);
  }

  getBucketName(): string {
    return this.bucketName;
  }

  /**
   * Upload a finished PDF buffer to S3 under the caller-supplied key.
   * The key MUST resolve under `tenants/<caller-tenant>/...` or the
   * ABAC IAM policy rejects the request.
   */
  async putPdf(
    tenantId: string,
    jwtToken: string,
    key: string,
    buffer: Buffer,
  ): Promise<void> {
    this.logger.log(`putPdf tenantId=${tenantId} key=${key} size=${buffer.length}`);
    const client = await this.getClient(jwtToken);
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: buffer,
          Tagging: LIFECYCLE_TAG,
        }),
      );
    } finally {
      client.destroy();
    }
  }

  /**
   * Upload a stream (typically an archiver/Zip pipe in F.3 or pdf-lib merged
   * output in H.3) to S3 via lib-storage's Upload class. Handles multipart
   * splitting automatically above 5MB.
   */
  async putZip(
    tenantId: string,
    jwtToken: string,
    key: string,
    stream: Readable,
  ): Promise<void> {
    this.logger.log(`putZip tenantId=${tenantId} key=${key}`);
    const client = await this.getClient(jwtToken);
    try {
      const upload = new Upload({
        client,
        params: {
          Bucket: this.bucketName,
          Key: key,
          Body: stream,
          Tagging: LIFECYCLE_TAG,
        },
      });
      await upload.done();
    } finally {
      client.destroy();
    }
  }

  /**
   * Mint a presigned GET URL for the operator to download the artifact.
   * Default TTL is 900s (15 min) per the F.2 locked plan. F.4's
   * `GET /finance/jobs/:jobId` re-mints if the URL is within 60s of expiry.
   */
  async presignGet(
    tenantId: string,
    jwtToken: string,
    key: string,
    expirySec: number = DEFAULT_PRESIGN_TTL_SEC,
  ): Promise<string> {
    this.logger.log(`presignGet tenantId=${tenantId} key=${key} ttl=${expirySec}s`);
    const client = await this.getClient(jwtToken);
    try {
      return await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
        { expiresIn: expirySec },
      );
    } finally {
      client.destroy();
    }
  }

  private async getClient(jwtToken: string): Promise<S3Client> {
    const tvm = new TokenVendingMachine(false);
    const credsJson = await tvm.assumeRole(jwtToken, 3600);
    const creds = JSON.parse(credsJson);
    return new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: creds.AccessKeyId,
        secretAccessKey: creds.SecretAccessKey,
        sessionToken: creds.SessionToken,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }
}
