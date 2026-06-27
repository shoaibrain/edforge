/**
 * AttendancePolicyResolverService spec (Sprint 2 / S2.T4).
 *
 * Locks the resolution order (school override → archetype default → platform)
 * and the graceful-degradation contract (a failed school-config or archetype
 * read falls back, never throws).
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { AttendancePolicyResolverService } from './attendance-policy-resolver.service';

const ctx = { tenantId: 't1', userId: 'u1', email: 'e', role: 'r', jwtToken: 'jwt' } as any;

function makeService() {
  const identityClient = { getSchoolConfiguration: jest.fn<any>() };
  const reader = { getArchetype: jest.fn<any>() };
  const service = new AttendancePolicyResolverService(identityClient as any, reader as any);
  return { service, identityClient, reader };
}

describe('AttendancePolicyResolverService.resolveEffectivePolicy', () => {
  let h: ReturnType<typeof makeService>;
  beforeEach(() => { h = makeService(); });

  it('school override wins over the archetype default (legacy "both" coerces to daily_presence)', async () => {
    h.identityClient.getSchoolConfiguration.mockResolvedValue({ attendancePolicy: 'both' });
    h.reader.getArchetype.mockResolvedValue('PABSON');

    const r = await h.service.resolveEffectivePolicy('sch', ctx);
    expect(r.effectiveMode).toBe('daily_presence');
    expect(r.modeSource).toBe('school');
  });

  it('falls back to the PABSON archetype default (daily_presence) when there is no school override', async () => {
    h.identityClient.getSchoolConfiguration.mockResolvedValue({});
    h.reader.getArchetype.mockResolvedValue('PABSON');

    const r = await h.service.resolveEffectivePolicy('sch', ctx);
    expect(r.effectiveMode).toBe('daily_presence');
    expect(r.modeSource).toBe('archetype');
    expect(r.countingSource).toBe('archetype');
    expect(r.archetype).toBe('PABSON');
  });

  it('GENERIC archetype default is per_section_granular', async () => {
    h.identityClient.getSchoolConfiguration.mockResolvedValue(null);
    h.reader.getArchetype.mockResolvedValue('GENERIC');

    const r = await h.service.resolveEffectivePolicy('sch', ctx);
    expect(r.effectiveMode).toBe('per_section_granular');
    expect(r.modeSource).toBe('archetype');
  });

  it('degrades to the platform default when the archetype is absent', async () => {
    h.identityClient.getSchoolConfiguration.mockResolvedValue(null);
    h.reader.getArchetype.mockResolvedValue(undefined);

    const r = await h.service.resolveEffectivePolicy('sch', ctx);
    expect(r.effectiveMode).toBe('per_section_granular');
    expect(r.modeSource).toBe('platform');
    expect(r.countingSource).toBe('platform');
    expect(r.archetype).toBeUndefined();
  });

  it('degrades gracefully (no throw) when the archetype read fails', async () => {
    h.identityClient.getSchoolConfiguration.mockResolvedValue(null);
    h.reader.getArchetype.mockRejectedValue(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));

    const r = await h.service.resolveEffectivePolicy('sch', ctx);
    expect(r.effectiveMode).toBe('per_section_granular');
    expect(r.modeSource).toBe('platform');
  });

  it('degrades gracefully (no throw) when the school-config read fails', async () => {
    h.identityClient.getSchoolConfiguration.mockRejectedValue(new Error('timeout'));
    h.reader.getArchetype.mockResolvedValue('PABSON');

    const r = await h.service.resolveEffectivePolicy('sch', ctx);
    expect(r.effectiveMode).toBe('daily_presence'); // school read failed → archetype default
    expect(r.modeSource).toBe('archetype');
  });

  it('returns the researched platform counting policy', async () => {
    h.identityClient.getSchoolConfiguration.mockResolvedValue(null);
    h.reader.getArchetype.mockResolvedValue('PABSON');

    const r = await h.service.resolveEffectivePolicy('sch', ctx);
    expect(r.countingPolicy.chronicThresholdPct).toBe(10);
    expect(r.countingPolicy.atRiskThresholdPct).toBe(90);
    expect(r.countingPolicy.attendingCategories).toEqual(['present', 'late', 'tardy', 'remote']);
    expect(r.countingPolicy.excusedTreatment).toBe('absent_for_rate');
    expect(r.countingPolicy.chronicCountsExcused).toBe(true);
  });
});
