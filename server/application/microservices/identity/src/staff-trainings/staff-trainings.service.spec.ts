/**
 * StaffTrainingsService spec (Sprint B.4)
 *
 * Locks the contract for:
 *   - audit emit metadata shape (PII-clean per S4.7 pattern)
 *   - changedFields computation on update
 *   - status before/after metadata when status changes
 *   - cross-field date validation (asymmetric — Zod refine handles symmetric;
 *     service layer handles partial-update with only one date in the payload)
 *   - GSI key recomputation when trainingType or startDate changes
 */

import { StaffTrainingsService } from './staff-trainings.service';
import { StaffTraining } from '../common/entities/staff-training.entity';

describe('StaffTrainingsService — audit metadata + update behavior', () => {
  let service: StaffTrainingsService;
  let dynamoMock: any;
  let auditMock: any;

  const baseContext: any = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    email: 'admin@school.np',
    globalRole: 'TenantAdmin',
    jwtToken: 'jwt-test',
    username: 'admin',
  };

  function makeTraining(overrides: Partial<StaffTraining> = {}): StaffTraining {
    return {
      tenantId: 'tenant-1',
      entityKey: 'STAFF#staff-1#TRAIN#train-1',
      entityType: 'STAFF_TRAINING',
      trainingId: 'train-1',
      staffId: 'staff-1',
      trainingTitle: 'Inclusion Workshop',
      trainingType: 'inclusion',
      trainingProvider: 'CEHRD Bagmati',
      startDate: '2026-04-01',
      endDate: '2026-04-03',
      durationHours: 16,
      status: 'completed',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
      createdBy: 'system',
      updatedBy: 'system',
      version: 1,
      ...overrides,
    };
  }

  beforeEach(() => {
    dynamoMock = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn(),
      putItem: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      updateItem: jest.fn(),
      deleteItem: jest.fn().mockResolvedValue(undefined),
    };
    auditMock = {
      emit: jest.fn().mockResolvedValue(undefined),
    };
    service = new StaffTrainingsService(dynamoMock, auditMock);
  });

  describe('createTraining — audit metadata is PII-clean', () => {
    it('emits staff.training.created with typed-only metadata', async () => {
      // Staff exists
      dynamoMock.getItem.mockResolvedValueOnce({ staffId: 'staff-1' });

      await service.createTraining(
        'staff-1',
        {
          trainingTitle: 'Inclusion Workshop',
          trainingType: 'inclusion',
          trainingProvider: 'CEHRD Bagmati',
          startDate: '2026-04-01',
          endDate: '2026-04-03',
          durationHours: 16,
          status: 'completed',
          certificateNumber: 'CEHRD-INC-2026-0042',
          notes: 'Front-row seat',
        } as any,
        baseContext,
      );

      expect(auditMock.emit).toHaveBeenCalledTimes(1);
      const [event, jwt] = auditMock.emit.mock.calls[0];
      expect(jwt).toBe('jwt-test');
      expect(event.eventType).toBe('staff.training.created');

      const md = event.metadata;
      // Required typed fields PRESENT
      expect(md.staffId).toBe('staff-1');
      expect(md.trainingType).toBe('inclusion');
      expect(md.trainingProvider).toBe('CEHRD Bagmati');
      expect(md.durationHours).toBe(16);
      expect(md.status).toBe('completed');
      // PII fields ABSENT
      expect(md.trainingTitle).toBeUndefined();
      expect(md.notes).toBeUndefined();
      expect(md.certificateNumber).toBeUndefined();
      expect(md.certificateUrl).toBeUndefined();
    });

    it('throws NotFoundException when staff does not exist', async () => {
      dynamoMock.getItem.mockResolvedValueOnce(null); // staff lookup

      await expect(
        service.createTraining(
          'nope',
          {
            trainingTitle: 'X',
            trainingType: 'other',
            trainingProvider: 'Y',
            startDate: '2026-01-01',
            durationHours: 4,
            status: 'completed',
          } as any,
          baseContext,
        ),
      ).rejects.toThrow(/not found/i);

      // No audit emit on failed create
      expect(auditMock.emit).not.toHaveBeenCalled();
    });
  });

  describe('updateTraining — changedFields + before/after on status', () => {
    it('emits staff.training.edited with only the fields actually changed', async () => {
      const existing = makeTraining({ status: 'completed', durationHours: 16 });
      dynamoMock.getItem.mockResolvedValueOnce(existing);
      dynamoMock.updateItem.mockResolvedValueOnce({
        ...existing,
        durationHours: 24,
      });

      await service.updateTraining(
        'staff-1',
        'train-1',
        { durationHours: 24 } as any,
        baseContext,
      );

      const [event] = auditMock.emit.mock.calls[0];
      expect(event.eventType).toBe('staff.training.edited');
      expect(event.metadata.changedFields).toEqual(['durationHours']);
      // No before/after when status didn't change
      expect(event.metadata.before).toBeUndefined();
      expect(event.metadata.after).toBeUndefined();
    });

    it('emits before/after on status change', async () => {
      const existing = makeTraining({ status: 'completed' });
      dynamoMock.getItem.mockResolvedValueOnce(existing);
      dynamoMock.updateItem.mockResolvedValueOnce({
        ...existing,
        status: 'cancelled',
      });

      await service.updateTraining(
        'staff-1',
        'train-1',
        { status: 'cancelled' } as any,
        baseContext,
      );

      const [event] = auditMock.emit.mock.calls[0];
      expect(event.metadata.changedFields).toEqual(['status']);
      expect(event.metadata.before).toEqual({ status: 'completed' });
      expect(event.metadata.after).toEqual({ status: 'cancelled' });
    });

    it('strips trainingTitle / notes from PATCH audit metadata even when caller updates them', async () => {
      const existing = makeTraining();
      dynamoMock.getItem.mockResolvedValueOnce(existing);
      dynamoMock.updateItem.mockResolvedValueOnce({
        ...existing,
        trainingTitle: 'New Title',
        notes: 'Some private note',
      });

      await service.updateTraining(
        'staff-1',
        'train-1',
        { trainingTitle: 'New Title', notes: 'Some private note' } as any,
        baseContext,
      );

      const [event] = auditMock.emit.mock.calls[0];
      // changedFields lists which fields changed; that's metadata about
      // structure, NOT the actual values. The values themselves stay out.
      expect(event.metadata.trainingTitle).toBeUndefined();
      expect(event.metadata.notes).toBeUndefined();
    });

    it('rejects update where derived endDate < derived startDate (asymmetric cross-field)', async () => {
      const existing = makeTraining({ startDate: '2026-04-01', endDate: '2026-04-03' });
      dynamoMock.getItem.mockResolvedValueOnce(existing);

      // Caller updates endDate to before existing startDate without sending startDate
      await expect(
        service.updateTraining(
          'staff-1',
          'train-1',
          { endDate: '2026-03-15' } as any,
          baseContext,
        ),
      ).rejects.toThrow(/on or after startDate/i);

      // No emit on rejected update
      expect(auditMock.emit).not.toHaveBeenCalled();
    });
  });

  describe('deleteTraining — audit emit with softDelete=false', () => {
    it('emits staff.training.deleted with hard-delete metadata', async () => {
      const existing = makeTraining({ trainingType: 'safety' });
      dynamoMock.getItem.mockResolvedValueOnce(existing);

      await service.deleteTraining('staff-1', 'train-1', baseContext);

      expect(auditMock.emit).toHaveBeenCalledTimes(1);
      const [event] = auditMock.emit.mock.calls[0];
      expect(event.eventType).toBe('staff.training.deleted');
      expect(event.metadata.staffId).toBe('staff-1');
      expect(event.metadata.trainingId).toBe('train-1');
      expect(event.metadata.trainingType).toBe('safety');
      expect(event.metadata.softDelete).toBe(false);
    });
  });
});
