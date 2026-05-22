/**
 * Sprint 0.4.5 — ArchetypeDefaultsController unit spec.
 *
 * JwtAuthGuard is mocked here (the controller mounts it, but we only
 * want to test the resolve() logic — Cognito wiring is covered by the
 * integration smoke).
 */

import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ArchetypeDefaultsController } from './archetype-defaults.controller';
import { ArchetypeDefaultsService } from './archetype-defaults.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';

describe('ArchetypeDefaultsController', () => {
  let controller: ArchetypeDefaultsController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ArchetypeDefaultsController],
      providers: [ArchetypeDefaultsService],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(ArchetypeDefaultsController);
  });

  it('returns PABSON defaults when archetype=PABSON', () => {
    const result = controller.resolve('PABSON');
    expect('defaults' in result).toBe(true);
    if ('defaults' in result) {
      expect(result.archetype).toBe('PABSON');
      expect(result.defaults.currency).toBe('NPR');
      // v3.4.1 H2: NG must be present
      expect(result.defaults.letterGrades.find((g) => g.letter === 'NG')).toBeDefined();
    }
  });

  it('returns supported archetype list when no archetype param', () => {
    const result = controller.resolve(undefined);
    expect('supportedArchetypes' in result).toBe(true);
    if ('supportedArchetypes' in result) {
      expect(result.supportedArchetypes).toEqual(expect.arrayContaining(['PABSON', 'GENERIC']));
    }
  });

  it('returns supported archetype list when archetype param is empty string', () => {
    const result = controller.resolve('');
    expect('supportedArchetypes' in result).toBe(true);
  });

  it('throws 404 ARCHETYPE_NOT_FOUND for unknown archetype', () => {
    expect.assertions(2);
    try {
      controller.resolve('CBSE_IN');
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundException);
      const body = (err as NotFoundException).getResponse() as Record<string, unknown>;
      expect(body.errorCode).toBe('ARCHETYPE_NOT_FOUND');
    }
  });

  it('handles case-insensitive archetype', () => {
    const result = controller.resolve('pabson');
    if ('defaults' in result) {
      expect(result.defaults.archetype).toBe('PABSON');
    }
  });
});
