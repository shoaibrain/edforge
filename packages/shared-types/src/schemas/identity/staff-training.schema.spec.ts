/**
 * staff-training.schema spec — locks the contract for the Sprint B
 * StaffTraining entity. Mirrors the credential schema test pattern.
 */

import {
  createStaffTrainingSchema,
  updateStaffTrainingSchema,
  staffTrainingResponseSchema,
  staffTrainingFilterSchema,
  trainingTypeSchema,
  trainingStatusSchema,
} from './staff-training.schema';

const validCreateBody = {
  trainingTitle: 'Inclusive Education Workshop',
  trainingType: 'inclusion' as const,
  trainingProvider: 'CEHRD Bagmati Resource Center',
  startDate: '2026-04-01',
  endDate: '2026-04-03',
  durationHours: 16,
  status: 'completed' as const,
};

describe('trainingTypeSchema (CEHRD vocabulary)', () => {
  it.each([
    ['pedagogical'], ['subject_matter'], ['technology'], ['inclusion'],
    ['leadership'], ['safety'], ['assessment'], ['language'],
    ['induction'], ['other'],
  ])('accepts canonical value %s', (v) => {
    expect(trainingTypeSchema.safeParse(v).success).toBe(true);
  });

  it.each([['credential'], ['workshop'], [''], [null], [42]])(
    'rejects %s',
    (v) => {
      expect(trainingTypeSchema.safeParse(v).success).toBe(false);
    },
  );
});

describe('trainingStatusSchema', () => {
  it.each([['scheduled'], ['in_progress'], ['completed'], ['cancelled']])(
    'accepts %s',
    (v) => {
      expect(trainingStatusSchema.safeParse(v).success).toBe(true);
    },
  );

  it.each([['done'], ['active'], ['']])('rejects %s', (v) => {
    expect(trainingStatusSchema.safeParse(v).success).toBe(false);
  });
});

describe('createStaffTrainingSchema', () => {
  describe('Happy path', () => {
    it('accepts a complete valid payload', () => {
      const r = createStaffTrainingSchema.safeParse(validCreateBody);
      expect(r.success).toBe(true);
    });

    it('accepts payload with only required fields (defaults status=completed)', () => {
      const r = createStaffTrainingSchema.safeParse({
        trainingTitle: 'X',
        trainingType: 'other' as const,
        trainingProvider: 'Y',
        startDate: '2026-01-01',
        durationHours: 4,
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.status).toBe('completed');
    });

    it('accepts ongoing training with no endDate', () => {
      const r = createStaffTrainingSchema.safeParse({
        ...validCreateBody,
        endDate: undefined,
        status: 'in_progress' as const,
      });
      expect(r.success).toBe(true);
    });

    it('accepts certificateNumber + certificateUrl + notes', () => {
      const r = createStaffTrainingSchema.safeParse({
        ...validCreateBody,
        certificateNumber: 'CEHRD-2026-12345',
        certificateUrl: 'https://example.com/certs/abc.pdf',
        notes: 'Front-row seat; recommended for induction batch.',
      });
      expect(r.success).toBe(true);
    });
  });

  describe('Validation', () => {
    it('rejects empty trainingTitle', () => {
      expect(
        createStaffTrainingSchema.safeParse({ ...validCreateBody, trainingTitle: '' }).success,
      ).toBe(false);
    });

    it('rejects trainingTitle > 150 chars', () => {
      expect(
        createStaffTrainingSchema.safeParse({
          ...validCreateBody,
          trainingTitle: 'a'.repeat(151),
        }).success,
      ).toBe(false);
    });

    it('rejects negative durationHours', () => {
      expect(
        createStaffTrainingSchema.safeParse({ ...validCreateBody, durationHours: -1 }).success,
      ).toBe(false);
    });

    it('rejects fractional durationHours (must be integer)', () => {
      expect(
        createStaffTrainingSchema.safeParse({ ...validCreateBody, durationHours: 1.5 }).success,
      ).toBe(false);
    });

    it('rejects durationHours > 9999', () => {
      expect(
        createStaffTrainingSchema.safeParse({ ...validCreateBody, durationHours: 10000 }).success,
      ).toBe(false);
    });

    it('rejects endDate before startDate', () => {
      const r = createStaffTrainingSchema.safeParse({
        ...validCreateBody,
        startDate: '2026-04-03',
        endDate: '2026-04-01',
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.flatten().fieldErrors.endDate?.[0]).toMatch(/on or after startDate/i);
      }
    });

    it('accepts endDate equal to startDate (same-day training)', () => {
      const r = createStaffTrainingSchema.safeParse({
        ...validCreateBody,
        startDate: '2026-04-01',
        endDate: '2026-04-01',
      });
      expect(r.success).toBe(true);
    });

    it('rejects malformed certificateUrl', () => {
      expect(
        createStaffTrainingSchema.safeParse({
          ...validCreateBody,
          certificateUrl: 'not-a-url',
        }).success,
      ).toBe(false);
    });
  });
});

describe('updateStaffTrainingSchema', () => {
  it('accepts an empty partial (no-op update is legal)', () => {
    expect(updateStaffTrainingSchema.safeParse({}).success).toBe(true);
  });

  it('accepts updating just status', () => {
    expect(updateStaffTrainingSchema.safeParse({ status: 'completed' }).success).toBe(true);
  });

  it('accepts updating just durationHours', () => {
    expect(updateStaffTrainingSchema.safeParse({ durationHours: 24 }).success).toBe(true);
  });

  it('rejects endDate before startDate when both are in the update', () => {
    const r = updateStaffTrainingSchema.safeParse({
      startDate: '2026-04-03',
      endDate: '2026-04-01',
    });
    expect(r.success).toBe(false);
  });

  it('accepts updating only endDate (no cross-field check without startDate)', () => {
    // The service layer is responsible for re-validating against the
    // existing entity's startDate when only one date is provided.
    expect(updateStaffTrainingSchema.safeParse({ endDate: '2026-04-10' }).success).toBe(true);
  });
});

describe('staffTrainingResponseSchema', () => {
  it('round-trips a server response shape', () => {
    const response = {
      trainingId: '11111111-1111-1111-1111-111111111111',
      staffId: '22222222-2222-2222-2222-222222222222',
      tenantId: '33333333-3333-3333-3333-333333333333',
      trainingTitle: 'Inclusion Workshop',
      trainingType: 'inclusion' as const,
      trainingProvider: 'CEHRD Bagmati',
      startDate: '2026-04-01',
      endDate: '2026-04-03',
      durationHours: 16,
      status: 'completed' as const,
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-03T00:00:00Z',
    };
    expect(staffTrainingResponseSchema.safeParse(response).success).toBe(true);
  });
});

describe('staffTrainingFilterSchema', () => {
  it('accepts empty filter', () => {
    expect(staffTrainingFilterSchema.safeParse({}).success).toBe(true);
  });

  it('accepts trainingType filter', () => {
    expect(
      staffTrainingFilterSchema.safeParse({ trainingType: 'pedagogical' }).success,
    ).toBe(true);
  });

  it('accepts startDateFrom + startDateTo range', () => {
    expect(
      staffTrainingFilterSchema.safeParse({
        startDateFrom: '2026-01-01',
        startDateTo: '2026-12-31',
      }).success,
    ).toBe(true);
  });
});
