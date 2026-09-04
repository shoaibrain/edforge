// The package's runtime export is the function itself (no `default`) and this
// tsconfig has no esModuleInterop, so a default import would compile to
// `.default(...)` and be undefined at runtime. Require it and type it from the
// declaration's default export.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serverlessExpress = require('@codegenie/serverless-express') as typeof import('@codegenie/serverless-express').default;
import type { Handler } from 'aws-lambda';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';
import { StructuredLogger } from '@app/logger';
import { FinanceModule } from './finance.module';
import { configureApp } from './app-setup';

/**
 * Lambda entry for the finance service (cost-redesign C1.3).
 *
 * The Nest application is built once per execution environment and cached in
 * module scope; every invocation is routed into it by serverless-express as a
 * plain Express request. `main.ts` remains the HTTP entry for ECS, docker
 * compose and `nest start`. Set `EDFORGE_RUNTIME=lambda` on the function so
 * the timer-driven services stay off (C1.2).
 *
 * Binary responses (PDF, ZIP) are base64-encoded for the API Gateway proxy
 * contract; the REST API must list the same content types in its
 * binaryMediaTypes.
 */
type ProxyHandler = Handler;

let cached: ProxyHandler | undefined;

export async function buildHandler(): Promise<ProxyHandler> {
  const expressApp = express();
  const app = await NestFactory.create(FinanceModule, new ExpressAdapter(expressApp), {
    logger: new StructuredLogger('finance-service'),
  });
  configureApp(app, { runtime: 'lambda' });
  await app.init();
  return serverlessExpress({
    app: expressApp,
    binarySettings: {
      contentTypes: ['application/pdf', 'application/zip', 'application/octet-stream'],
    },
  }) as unknown as ProxyHandler;
}

export const handler: ProxyHandler = async (event, context, callback) => {
  cached ??= await buildHandler();
  return cached(event, context, callback);
};

// Cost-redesign C3.3 — the same bundle serves the scheduled function (handler: index.scheduledHandler).
export { scheduledHandler } from './scheduled';
// Cost-redesign C3.7 — and the SQS worker function (handler: index.workerHandler).
export { workerHandler } from './worker';
