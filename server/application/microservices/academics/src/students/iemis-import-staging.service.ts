import { Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { TokenVendingMachine } from '@app/auth';
import type { IemisRow } from './iemis-transform';

/**
 * Cost-redesign C3.11 — an IEMIS import's rows, staged for the worker.
 *
 * Up to 1,000 rows do not fit an SQS message (256 KB), so the controller
 * writes them to the reports-staging bucket under the tenant's ABAC prefix
 * (`tenant=<tenantId>/iemis-import/<jobId>.json`) with tenant-vended
 * credentials — the same TVM path every DynamoDB call takes — and the
 * message carries the key. The object is tagged so a bucket lifecycle rule
 * expires it after a day even if the worker's own delete never runs.
 */
export const IEMIS_STAGING_TAG = 'edforge:ephemeral=iemis-import';

export interface StagingContext { tenantId: string; jwtToken: string }

@Injectable()
export class IemisImportStagingService {
  private readonly logger = new Logger(IemisImportStagingService.name);

  constructor(private readonly clientFactory: (jwtToken: string) => Promise<S3Client> = IemisImportStagingService.vendedClient) {}

  static bucket(): string {
    const b = process.env.REPORTS_STAGING_BUCKET;
    if (!b) throw new Error('REPORTS_STAGING_BUCKET is not set');
    return b;
  }

  static key(tenantId: string, jobId: string): string {
    return `tenant=${tenantId}/iemis-import/${jobId}.json`;
  }

  static async vendedClient(jwtToken: string): Promise<S3Client> {
    const creds = JSON.parse(await new TokenVendingMachine(false).assumeRole(jwtToken, 3600));
    return new S3Client({
      region: process.env.AWS_REGION || 'ap-south-1',
      credentials: { accessKeyId: creds.AccessKeyId, secretAccessKey: creds.SecretAccessKey, sessionToken: creds.SessionToken },
    });
  }

  async put(jobId: string, rows: IemisRow[], context: StagingContext): Promise<string> {
    const key = IemisImportStagingService.key(context.tenantId, jobId);
    const client = await this.clientFactory(context.jwtToken);
    await client.send(new PutObjectCommand({
      Bucket: IemisImportStagingService.bucket(),
      Key: key,
      Body: JSON.stringify(rows),
      ContentType: 'application/json',
      Tagging: IEMIS_STAGING_TAG,
    }));
    return key;
  }

  async get(key: string, context: StagingContext): Promise<IemisRow[]> {
    const client = await this.clientFactory(context.jwtToken);
    const out = await client.send(new GetObjectCommand({ Bucket: IemisImportStagingService.bucket(), Key: key }));
    const body = await out.Body?.transformToString();
    if (!body) throw new Error(`staged IEMIS rows missing at ${key}`);
    return JSON.parse(body) as IemisRow[];
  }

  /** Best effort: the lifecycle rule is the backstop. */
  async delete(key: string, context: StagingContext): Promise<void> {
    try {
      const client = await this.clientFactory(context.jwtToken);
      await client.send(new DeleteObjectCommand({ Bucket: IemisImportStagingService.bucket(), Key: key }));
    } catch (err) {
      this.logger.warn(`staged rows not deleted (${key}): ${(err as Error).message}`);
    }
  }
}
