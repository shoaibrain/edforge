/**
 * S3 presigner service for the PDF-assets bucket.
 *
 * Tenant isolation: uses the per-tenant ABAC credentials produced by
 * `TokenVendingMachine.assumeRole`. The ABAC role's S3 policy scopes
 * `s3:PutObject` / `s3:GetObject` to keys under
 * `tenants/${aws:PrincipalTag/tenant}/*`, so a presigned URL signed with
 * those credentials cannot place an object outside the caller's tenant
 * partition, even if the BrandingService is buggy.
 *
 * Bucket name is read once from `PDF_ASSETS_BUCKET` env var (set by
 * tenant-template-stack.ts task def). The name follows the deterministic
 * `edforge-pdf-assets-{account}-{region}` convention from analytics-stack
 * (C.0.6) — no CFN export, no cross-stack coupling (R46 mitigation).
 */

import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { TokenVendingMachine } from '@app/auth/token-vending-machine';

const DEFAULT_PUT_EXPIRY_SECONDS = 300;
const DEFAULT_GET_EXPIRY_SECONDS = 600;

@Injectable()
export class S3PresignerService {
  private readonly logger = new Logger(S3PresignerService.name);
  private readonly bucketName: string;
  private readonly region: string;

  constructor() {
    const bucket = process.env.PDF_ASSETS_BUCKET;
    if (!bucket) {
      throw new InternalServerErrorException(
        'PDF_ASSETS_BUCKET env var is not set — task def is misconfigured'
      );
    }
    this.bucketName = bucket;
    this.region = process.env.AWS_REGION ?? 'ap-south-1';
    this.logger.log(`PDF assets bucket: ${this.bucketName} (${this.region})`);
  }

  getBucketName(): string {
    return this.bucketName;
  }

  /**
   * Build an S3 client backed by per-tenant ABAC credentials. Every
   * presigned URL minted from this client is scoped (by IAM, not by
   * convention) to the caller's tenant partition.
   */
  private async getClient(jwtToken: string): Promise<S3Client> {
    const tvm = new TokenVendingMachine(false);
    const credsJson = await tvm.assumeRole(jwtToken, 3600);
    const creds = JSON.parse(credsJson);
    // TVM returns AWS STS-shape credentials (capitalized keys); the v3
    // SDK constructor expects lowercase. Mirrors the mapping used in
    // DynamoDBClientService.getClient.
    return new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: creds.AccessKeyId,
        secretAccessKey: creds.SecretAccessKey,
        sessionToken: creds.SessionToken,
      },
    });
  }

  /**
   * Mint a short-lived presigned PUT URL. ContentType is signed in so the
   * browser cannot upload as a different MIME than what the BrandingService
   * vetted server-side.
   */
  async presignPut(
    jwtToken: string,
    key: string,
    contentType: string,
    contentLength: number,
    expiresInSeconds = DEFAULT_PUT_EXPIRY_SECONDS,
  ): Promise<string> {
    const client = await this.getClient(jwtToken);
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });
    return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }

  async presignGet(
    jwtToken: string,
    key: string,
    expiresInSeconds = DEFAULT_GET_EXPIRY_SECONDS,
  ): Promise<string> {
    const client = await this.getClient(jwtToken);
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }
}
