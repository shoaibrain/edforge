/**
 * IdempotentInterceptor — global-wiring integration test
 *
 * Proves the Codex P1 finding is closed: the `@Idempotent()` decorator
 * actually fires in the running app because the interceptor is registered
 * as a global APP_INTERCEPTOR.
 *
 * What this validates that the unit spec can't:
 *   1. The decorator is HONORED at HTTP request time (not just in
 *      isolation against a fabricated ExecutionContext)
 *   2. A second call with the same Idempotency-Key really does NOT
 *      invoke the handler — proves the replay path works end-to-end
 *   3. A route WITHOUT @Idempotent() truly is untouched — proves the
 *      opt-out path is the default
 *
 * Uses the same NestJS Test + supertest pattern as
 * enrollment-webhook.controller.spec.ts so the testing surface stays
 * consistent with the rest of the finance service.
 */

import { Test, TestingModule } from '@nestjs/testing';
import {
  Body,
  Controller,
  INestApplication,
  Module,
  Post,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import * as request from 'supertest';
import { IdempotentInterceptor, Idempotent } from './idempotent.interceptor';
import { DynamoDBClientService } from '../services/dynamodb-client.service';
import type { IdempotencyKeyEntity } from '../entities/idempotency-key.entity';

const TENANT_ID = 'tenant-uuid';
const USER_ID = 'operator-uuid';
const VALID_KEY = '11111111-2222-4333-9444-555555555555';

@Controller('test')
class TestController {
  handlerCalls = 0;

  @Post('not-decorated')
  notDecorated(@Body() body: any) {
    this.handlerCalls++;
    return { ran: true, echo: body };
  }

  @Post('decorated')
  @Idempotent()
  decorated(@Body() body: any) {
    this.handlerCalls++;
    return { ran: true, echo: body };
  }
}

/**
 * Synthetic JWT-context middleware. The interceptor expects
 * `req.user.{tenantId,userId}` (populated by JwtAuthGuard in the real
 * stack). We bypass auth for this test and stuff the values directly.
 */
function attachUser(req: any, _res: any, next: () => void): void {
  req.user = { tenantId: TENANT_ID, userId: USER_ID };
  next();
}

@Module({
  controllers: [TestController],
  providers: [
    {
      provide: DynamoDBClientService,
      useValue: {
        getClient: jest.fn().mockResolvedValue({}),
        getItem: jest.fn().mockResolvedValue(null),
        putItem: jest.fn().mockResolvedValue(undefined),
        updateItem: jest.fn().mockResolvedValue(undefined),
        deleteItem: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
      },
    },
    // The thing under test: APP_INTERCEPTOR wiring
    { provide: APP_INTERCEPTOR, useClass: IdempotentInterceptor },
  ],
})
class TestModule {}

describe('IdempotentInterceptor (global wiring integration — Sprint 0.2)', () => {
  let app: INestApplication;
  let controller: TestController;
  let ddb: any;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(attachUser);
    await app.init();

    controller = moduleRef.get(TestController);
    ddb = moduleRef.get(DynamoDBClientService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    controller.handlerCalls = 0;
    ddb.getClient.mockClear();
    ddb.getItem.mockClear();
    ddb.putItem.mockClear();
    ddb.updateItem.mockClear();
    ddb.deleteItem.mockClear();
    ddb.query.mockClear();
    ddb.getItem.mockResolvedValue(null);
    ddb.putItem.mockResolvedValue(undefined);
    ddb.updateItem.mockResolvedValue(undefined);
    ddb.query.mockResolvedValue({ items: [], hasMore: false });
  });

  it('non-decorated route passes through — handler runs, NO DDB calls', async () => {
    const res = await request(app.getHttpServer())
      .post('/test/not-decorated')
      .send({ foo: 'bar' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ran: true, echo: { foo: 'bar' } });
    expect(controller.handlerCalls).toBe(1);
    expect(ddb.getClient).not.toHaveBeenCalled();
    expect(ddb.putItem).not.toHaveBeenCalled();
  });

  it('decorated route, first call — handler runs once, claim + finalize DDB writes', async () => {
    const res = await request(app.getHttpServer())
      .post('/test/decorated')
      .set('Idempotency-Key', VALID_KEY)
      .send({ foo: 'bar' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ran: true, echo: { foo: 'bar' } });
    expect(controller.handlerCalls).toBe(1);

    // CLAIM phase write
    expect(ddb.putItem).toHaveBeenCalledTimes(1);
    const [, claimRow, claimCond] = ddb.putItem.mock.calls[0];
    expect(claimRow.status).toBe('pending');
    expect(claimCond).toBe('attribute_not_exists(entityKey)');

    // FINALIZE phase write (fire-and-forget; microtask flush)
    await new Promise(setImmediate);
    expect(ddb.updateItem).toHaveBeenCalledTimes(1);
  });

  it('decorated route, second call with same key — handler does NOT run; stored response is replayed', async () => {
    // Simulate the first call's persisted row
    const storedRow: IdempotencyKeyEntity = {
      tenantId: TENANT_ID,
      entityKey: `IDEMPOTENCY#${USER_ID}#${VALID_KEY}`,
      entityType: 'IDEMPOTENCY_KEY',
      idempotencyKey: VALID_KEY,
      routeKey: 'POST /test/decorated',
      status: 'completed',
      responseStatus: 201,
      responseBody: JSON.stringify({ ran: true, echo: { foo: 'first-call' } }),
      claimedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 3600,
      createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 1,
    };

    // The claim PutItem will CCFE because the row "already exists"
    ddb.putItem.mockRejectedValueOnce(
      Object.assign(new Error('row exists'), {
        name: 'ConditionalCheckFailedException',
      }),
    );
    ddb.getItem.mockResolvedValueOnce(storedRow);

    const res = await request(app.getHttpServer())
      .post('/test/decorated')
      .set('Idempotency-Key', VALID_KEY)
      .send({ foo: 'second-call' }); // body different from first — replay ignores

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ran: true, echo: { foo: 'first-call' } });
    // Critical assertion: handler did NOT run
    expect(controller.handlerCalls).toBe(0);
    expect(ddb.updateItem).not.toHaveBeenCalled();
  });

  it('decorated route, missing Idempotency-Key header → 400 (not 500); handler does NOT run', async () => {
    const res = await request(app.getHttpServer())
      .post('/test/decorated')
      .send({ foo: 'bar' });

    expect(res.status).toBe(400);
    expect(res.body.message?.code ?? res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(controller.handlerCalls).toBe(0);
  });
});
