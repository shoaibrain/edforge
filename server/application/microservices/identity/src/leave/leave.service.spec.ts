/**
 * Unit spec for LeaveService — Sprint C0.b.1.
 *
 * Locks the cancel path against the regression that caused the 2026-05-14
 * S3.2 smoke 500: a malformed body with `reason` (instead of
 * `cancellationReason`) made it past the un-validated controller and
 * passed `undefined` into the DDB UpdateItem expression, which rejected
 * the value with a 500. The controller now Zod-validates the body so
 * that path can't repeat; this spec covers the post-validation behavior
 * of the service itself:
 *
 *   - 404 when the leave row doesn't exist
 *   - 400 when status is not in ['pending', 'approved']
 *   - 2xx + DDB UpdateItem with a defined cancellationReason
 *   - LeaveCancelled event published with cancelledBy + reason
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeaveService } from './leave.service';
import type { Leave } from '../common/entities/leave.entity';
import type { RequestContext } from '../common/entities/base.entity';

function makeLeave(overrides: Partial<Leave> = {}): Leave {
  return {
    tenantId: 't',
    entityKey: 'STAFF#s#LEAVE#l',
    entityType: 'LEAVE',
    leaveId: 'l',
    staffId: 's',
    staffName: 'A B',
    schoolId: 'sch',
    schoolName: 'Sch',
    leaveType: 'casual',
    startDate: '2026-08-01',
    endDate: '2026-08-01',
    durationType: 'full_day',
    totalDays: 1,
    totalHours: 8,
    reason: 'rest',
    status: 'pending',
    version: 1,
    createdAt: '2026-07-30T00:00:00Z',
    updatedAt: '2026-07-30T00:00:00Z',
    createdBy: 'u',
    updatedBy: 'u',
    ...overrides,
  } as unknown as Leave;
}

const ctx: RequestContext = {
  userId: 'admin-1',
  tenantId: 't',
  email: 'a@b.c',
  globalRole: 'TenantAdmin',
  jwtToken: 'jwt',
  username: 'a@b.c',
} as RequestContext;

function buildService(opts: {
  getItem: jest.Mock;
  updateItem: jest.Mock;
  publishEvent?: jest.Mock;
}): { svc: LeaveService; publishEvent: jest.Mock } {
  const ddb = {
    getClient: jest.fn().mockResolvedValue({}),
    getItem: opts.getItem,
    updateItem: opts.updateItem,
  } as any;
  const publishEvent = opts.publishEvent ?? jest.fn().mockResolvedValue(undefined);
  const eventsService = { publishEvent } as any;
  const svc = new LeaveService(ddb, eventsService);
  return { svc, publishEvent };
}

describe('LeaveService.cancelLeaveRequest — C0.b.1', () => {
  it('throws NotFoundException when the leave row is missing', async () => {
    const { svc } = buildService({
      getItem: jest.fn().mockResolvedValue(null),
      updateItem: jest.fn(),
    });
    await expect(
      svc.cancelLeaveRequest('s', 'l', 'cleanup', ctx),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when status is not pending or approved', async () => {
    const { svc } = buildService({
      getItem: jest.fn().mockResolvedValue(makeLeave({ status: 'rejected' })),
      updateItem: jest.fn(),
    });
    await expect(
      svc.cancelLeaveRequest('s', 'l', 'cleanup', ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates status to cancelled, returns 2xx-shaped response, emits LeaveCancelled event', async () => {
    const existing = makeLeave({ status: 'approved' });
    const cancelled = makeLeave({
      status: 'cancelled',
      cancellationReason: 'cleanup',
      cancelledAt: 'now',
      version: 2,
    } as Partial<Leave>);
    const getItem = jest.fn().mockResolvedValue(existing);
    const updateItem = jest.fn().mockResolvedValue(cancelled);
    const { svc, publishEvent } = buildService({ getItem, updateItem });

    const r = await svc.cancelLeaveRequest('s', 'l', 'cleanup', ctx);

    // Service composed the SET expression with a *defined* cancellationReason.
    // This is the line that previously received `undefined` and 500'd.
    expect(updateItem).toHaveBeenCalledTimes(1);
    const updateCallArgs = updateItem.mock.calls[0];
    const values = updateCallArgs[4];
    expect(values[':cancellationReason']).toBe('cleanup');
    expect(values[':status']).toBe('cancelled');

    // LeaveCancelled event was published (Approve/Reject parity).
    expect(publishEvent).toHaveBeenCalledTimes(1);
    const evt = publishEvent.mock.calls[0][0];
    expect(evt.eventType).toBe('LeaveCancelled');
    expect(evt.leaveId).toBe('l');
    expect(evt.staffId).toBe('s');
    expect(evt.cancelledBy).toBe(ctx.userId);
    expect(evt.cancellationReason).toBe('cleanup');

    expect(r.leaveId).toBe('l');
  });
});
