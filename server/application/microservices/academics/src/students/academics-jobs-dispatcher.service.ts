import { Injectable, Logger } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { RequestContext } from '../common/entities/base.entity';
import type { IemisRow } from './iemis-transform';
import { IemisImportStagingService } from './iemis-import-staging.service';

/**
 * Cost-redesign C3.11 — where the IEMIS import's 202 hand-off runs.
 * `JOBS_TRANSPORT=inline` (default): in this process after the response
 * flushes, as before. `sqs`: rows staged in S3, one message on
 * ACADEMICS_JOBS_QUEUE_URL, the academics worker function runs it.
 */
export const JOBS_TRANSPORT_ENV = 'JOBS_TRANSPORT';
export const ACADEMICS_JOBS_QUEUE_URL_ENV = 'ACADEMICS_JOBS_QUEUE_URL';

export interface IemisImportJobMessage {
  version: 1;
  jobId: string;
  jobType: 'iemis_import';
  tenantId: string;
  schoolId: string;
  stagingKey: string;
  enrollInAcademicYearId?: string;
  context: Pick<RequestContext, 'tenantId' | 'userId' | 'email' | 'role' | 'jwtToken'> & Partial<Pick<RequestContext, 'username' | 'schoolId'>>;
}

export interface IemisDispatchRequest {
  jobId: string;
  schoolId: string;
  rows: IemisRow[];
  enrollInAcademicYearId?: string;
  run: () => Promise<unknown>;
}

@Injectable()
export class AcademicsJobsDispatcherService {
  private readonly logger = new Logger(AcademicsJobsDispatcherService.name);
  private sqs?: SQSClient;

  constructor(private readonly staging: IemisImportStagingService, private readonly env: NodeJS.ProcessEnv = process.env, sqs?: SQSClient) {
    this.sqs = sqs;
  }

  get transport(): 'inline' | 'sqs' {
    return (this.env[JOBS_TRANSPORT_ENV] ?? '').trim().toLowerCase() === 'sqs' ? 'sqs' : 'inline';
  }

  async dispatch(req: IemisDispatchRequest, context: RequestContext): Promise<{ transport: 'inline' | 'sqs'; messageId?: string; stagingKey?: string }> {
    if (this.transport === 'inline') {
      setImmediate(() => {
        req.run().catch((err: unknown) => {
          this.logger.error(`executeIemisImportAsync uncaught jobId=${req.jobId} — ${err instanceof Error ? err.message : String(err)}`);
        });
      });
      return { transport: 'inline' };
    }
    const queueUrl = this.env[ACADEMICS_JOBS_QUEUE_URL_ENV];
    if (!queueUrl) throw new Error(`${JOBS_TRANSPORT_ENV}=sqs but ${ACADEMICS_JOBS_QUEUE_URL_ENV} is not set`);
    const stagingKey = await this.staging.put(req.jobId, req.rows, context);
    const message: IemisImportJobMessage = {
      version: 1,
      jobId: req.jobId,
      jobType: 'iemis_import',
      tenantId: context.tenantId,
      schoolId: req.schoolId,
      stagingKey,
      ...(req.enrollInAcademicYearId ? { enrollInAcademicYearId: req.enrollInAcademicYearId } : {}),
      context: {
        tenantId: context.tenantId, userId: context.userId, email: context.email, role: context.role, jwtToken: context.jwtToken,
        ...(context.username ? { username: context.username } : {}),
        ...(context.schoolId ? { schoolId: context.schoolId } : {}),
      },
    };
    this.sqs ??= new SQSClient({});
    const out = await this.sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: { jobType: { DataType: 'String', StringValue: 'iemis_import' }, tenantId: { DataType: 'String', StringValue: context.tenantId } },
    }));
    this.logger.log(`enqueued iemis_import jobId=${req.jobId} schoolId=${req.schoolId} rows=${req.rows.length} messageId=${out.MessageId ?? '?'}`);
    return { transport: 'sqs', messageId: out.MessageId, stagingKey };
  }
}
