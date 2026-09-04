import { Injectable, Logger } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { RequestContext } from '../common/entities/base.entity';
import type { FinanceJobType } from '../common/entities/finance-job.entity';

/**
 * Cost-redesign C3.7 — where a 202 hand-off runs.
 *
 * `JOBS_TRANSPORT=inline` (default): the worker runs in this process after
 * the response flushes, exactly as before. `JOBS_TRANSPORT=sqs`: the job is
 * enqueued on FINANCE_JOBS_QUEUE_URL and the worker Lambda (finance/src/
 * worker.ts) runs it. The message carries the operator's request context
 * including the JWT, because the worker mints its tenant-scoped DynamoDB
 * client from it exactly as the in-process worker does; the JWT is never
 * logged. The same switch selects the DynamoDB school lock (C3.6).
 */
export const JOBS_TRANSPORT_ENV = 'JOBS_TRANSPORT';
export const FINANCE_JOBS_QUEUE_URL_ENV = 'FINANCE_JOBS_QUEUE_URL';
export type JobsTransport = 'inline' | 'sqs';

export function jobsTransport(env = process.env): JobsTransport {
  return (env[JOBS_TRANSPORT_ENV] ?? '').trim().toLowerCase() === 'sqs' ? 'sqs' : 'inline';
}

export interface FinanceJobMessage {
  version: 1;
  jobId: string;
  jobType: FinanceJobType;
  tenantId: string;
  schoolId: string;
  input: Record<string, unknown>;
  context: Pick<RequestContext, 'tenantId' | 'userId' | 'email' | 'role' | 'jwtToken'> & Partial<Pick<RequestContext, 'username' | 'schoolId'>>;
}

export interface DispatchRequest {
  jobId: string;
  jobType: FinanceJobType;
  schoolId: string;
  /** Serializable worker input (what the SQS worker hands to the worker class). */
  input: Record<string, unknown>;
  /** The in-process run (inline transport only). */
  run: () => Promise<unknown>;
}

@Injectable()
export class JobsDispatcherService {
  private readonly logger = new Logger(JobsDispatcherService.name);
  private sqs?: SQSClient;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env, sqs?: SQSClient) {
    this.sqs = sqs;
  }

  get transport(): JobsTransport {
    return jobsTransport(this.env);
  }

  async dispatch(req: DispatchRequest, context: RequestContext): Promise<{ transport: JobsTransport; messageId?: string }> {
    if (this.transport === 'inline') {
      // `setImmediate` yields to the libuv I/O cycle so the 202 flushes before
      // the CPU-bound work starts (unchanged behaviour).
      setImmediate(() => {
        req.run().catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`${req.jobType} worker unhandled: jobId=${req.jobId} ${msg}`);
        });
      });
      return { transport: 'inline' };
    }
    const queueUrl = this.env[FINANCE_JOBS_QUEUE_URL_ENV];
    if (!queueUrl) throw new Error(`${JOBS_TRANSPORT_ENV}=sqs but ${FINANCE_JOBS_QUEUE_URL_ENV} is not set`);
    const message: FinanceJobMessage = {
      version: 1,
      jobId: req.jobId,
      jobType: req.jobType,
      tenantId: context.tenantId,
      schoolId: req.schoolId,
      input: req.input,
      context: {
        tenantId: context.tenantId,
        userId: context.userId,
        email: context.email,
        role: context.role,
        jwtToken: context.jwtToken,
        ...(context.username ? { username: context.username } : {}),
        ...(context.schoolId ? { schoolId: context.schoolId } : {}),
      },
    };
    this.sqs ??= new SQSClient({});
    const out = await this.sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        jobType: { DataType: 'String', StringValue: req.jobType },
        tenantId: { DataType: 'String', StringValue: context.tenantId },
      },
    }));
    this.logger.log(`enqueued ${req.jobType} jobId=${req.jobId} schoolId=${req.schoolId} messageId=${out.MessageId ?? '?'}`);
    return { transport: 'sqs', messageId: out.MessageId };
  }
}
