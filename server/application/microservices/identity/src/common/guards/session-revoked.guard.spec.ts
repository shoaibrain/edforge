import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SessionRevokedGuard } from './session-revoked.guard';
import { DynamoDBClientService } from '../services/dynamodb-client.service';

// A decodable (unsigned, test-only) JWT carrying sub + custom:tenantId.
function makeJwt(sub: string, tenantId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub, 'custom:tenantId': tenantId }),
  ).toString('base64');
  return `h.${payload}.s`;
}

function ctxWithBearer(bearer?: string): ExecutionContext {
  const request = { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('SessionRevokedGuard (SR.2)', () => {
  let guard: SessionRevokedGuard;
  let ddb: any;
  const JWT = makeJwt('user-1', 'tenant-1');

  beforeEach(() => {
    ddb = {
      getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
      queryGSI: jest.fn(),
    };
    guard = new SessionRevokedGuard(ddb as DynamoDBClientService);
  });

  it('allows a request whose tracked session is still active', async () => {
    ddb.queryGSI.mockResolvedValue({ items: [{ status: 'active' }] });
    await expect(guard.canActivate(ctxWithBearer(JWT))).resolves.toBe(true);
    expect(ddb.queryGSI).toHaveBeenCalledTimes(1);
  });

  it('401s a request whose tracked session was revoked', async () => {
    ddb.queryGSI.mockResolvedValue({ items: [{ status: 'revoked' }] });
    await expect(guard.canActivate(ctxWithBearer(JWT))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('allows an UNtracked token (no session row) — never locks out live traffic', async () => {
    ddb.queryGSI.mockResolvedValue({ items: [] });
    await expect(guard.canActivate(ctxWithBearer(JWT))).resolves.toBe(true);
  });

  it('allows requests with no bearer (public/health routes)', async () => {
    await expect(guard.canActivate(ctxWithBearer(undefined))).resolves.toBe(true);
    expect(ddb.getClient).not.toHaveBeenCalled();
  });

  it('allows an undecodable bearer (lets JwtAuthGuard reject it)', async () => {
    await expect(guard.canActivate(ctxWithBearer('not-a-jwt'))).resolves.toBe(true);
    expect(ddb.getClient).not.toHaveBeenCalled();
  });

  it('FAILS OPEN when the lookup throws — a revoke gate must not self-inflict an outage', async () => {
    ddb.queryGSI.mockRejectedValue(new Error('ddb down'));
    await expect(guard.canActivate(ctxWithBearer(JWT))).resolves.toBe(true);
  });

  it('caches the decision — a second call within the window skips the DDB read', async () => {
    ddb.queryGSI.mockResolvedValue({ items: [{ status: 'active' }] });
    await guard.canActivate(ctxWithBearer(JWT));
    await guard.canActivate(ctxWithBearer(JWT));
    expect(ddb.queryGSI).toHaveBeenCalledTimes(1); // second hit served from cache
  });

  it('scopes the DDB client to the token tenant and queries GSI2 by token hash', async () => {
    ddb.queryGSI.mockResolvedValue({ items: [] });
    await guard.canActivate(ctxWithBearer(JWT));
    expect(ddb.getClient).toHaveBeenCalledWith('tenant-1', JWT);
    const [, index, pk] = ddb.queryGSI.mock.calls[0];
    expect(index).toBe('GSI2');
    expect(pk).toMatch(/^TOKEN#/);
  });
});
