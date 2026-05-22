/**
 * Sprint 0.4.4 — ArchetypeDefaultsService unit spec.
 */

import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ArchetypeDefaultsService } from './archetype-defaults.service';

describe('ArchetypeDefaultsService', () => {
  let service: ArchetypeDefaultsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ArchetypeDefaultsService],
    }).compile();
    service = moduleRef.get(ArchetypeDefaultsService);
  });

  it('returns PABSON defaults', () => {
    const d = service.getDefaults('PABSON');
    expect(d.archetype).toBe('PABSON');
    expect(d.currency).toBe('NPR');
    expect(d.calendarSystem).toBe('bikram_sambat');
    expect(d.boardExams.find((e) => e.examType === 'BLE')).toBeDefined();
    expect(d.letterGrades.find((g) => g.letter === 'NG')).toBeDefined();
  });

  it('returns GENERIC defaults', () => {
    const d = service.getDefaults('GENERIC');
    expect(d.archetype).toBe('GENERIC');
    expect(d.currency).toBe('USD');
    expect(d.boardExams).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    expect(service.getDefaults('pabson').archetype).toBe('PABSON');
    expect(service.getDefaults('Pabson').archetype).toBe('PABSON');
  });

  it('throws NotFoundException with errorCode ARCHETYPE_NOT_FOUND for unknown', () => {
    expect.assertions(3);
    try {
      service.getDefaults('CBSE_IN');
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundException);
      const body = (err as NotFoundException).getResponse() as Record<string, unknown>;
      expect(body.errorCode).toBe('ARCHETYPE_NOT_FOUND');
      // Should surface supportedArchetypes for the operator
      expect(body.supportedArchetypes).toEqual(expect.arrayContaining(['PABSON', 'GENERIC']));
    }
  });

  it('throws NotFoundException for empty/null archetype', () => {
    expect(() => service.getDefaults('')).toThrow(NotFoundException);
    expect(() => service.getDefaults(null as unknown as string)).toThrow(NotFoundException);
    expect(() => service.getDefaults(undefined as unknown as string)).toThrow(NotFoundException);
  });

  it('caches lookups (repeat call returns same instance)', () => {
    const first = service.getDefaults('PABSON');
    const second = service.getDefaults('PABSON');
    expect(first).toBe(second); // reference equality proves cache
  });

  it('listArchetypes returns the supported set', () => {
    const list = service.listArchetypes();
    expect(list).toEqual(expect.arrayContaining(['PABSON', 'GENERIC']));
  });

  it('onModuleInit does not throw', () => {
    expect(() => service.onModuleInit()).not.toThrow();
  });
});
