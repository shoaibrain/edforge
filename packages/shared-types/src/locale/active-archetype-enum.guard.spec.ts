/**
 * GB0.0 — single-canonical-source guard for the active-archetype enum.
 *
 * `activeArchetypeSchema` (zod, schemas/identity/tenant.schema.ts) is the one
 * source of truth; `ACTIVE_ARCHETYPES` is derived from its `.options`. These
 * tests lock that invariant: if anyone re-hardcodes `ACTIVE_ARCHETYPES` and it
 * drifts from the validator, or adds an active value without the schema (or
 * vice-versa), CI fails here. They also assert active ⊆ full and that the
 * runtime guard agrees with the schema.
 */

import { activeArchetypeSchema, archetypeSchema } from '../schemas/identity/tenant.schema';
import { ACTIVE_ARCHETYPES, isActiveArchetype } from './tenant-locale-defaults';

describe('GB0.0 active-archetype enum — single canonical source', () => {
  it('ACTIVE_ARCHETYPES deep-equals activeArchetypeSchema.options', () => {
    expect([...ACTIVE_ARCHETYPES]).toEqual([...activeArchetypeSchema.options]);
  });

  it('every active archetype is a member of the full archetype enum (active ⊆ full)', () => {
    for (const a of activeArchetypeSchema.options) {
      expect(archetypeSchema.options).toContain(a);
    }
  });

  it('the full enum carries the reserved (not-yet-active) values without making them active', () => {
    for (const reserved of ['CBSE_IN', 'NAIS_US', 'GEMS_UAE'] as const) {
      expect(archetypeSchema.options).toContain(reserved);
      expect(activeArchetypeSchema.options as readonly string[]).not.toContain(reserved);
    }
  });

  it('isActiveArchetype agrees with the schema (incl. case-insensitivity) and rejects reserved/invalid', () => {
    for (const a of activeArchetypeSchema.options) {
      expect(isActiveArchetype(a)).toBe(true);
      expect(isActiveArchetype(a.toLowerCase())).toBe(true); // impl upper-cases before checking
    }
    for (const notActive of ['CBSE_IN', 'NAIS_US', 'GEMS_UAE', 'UNKNOWN', '', null, undefined, 42]) {
      expect(isActiveArchetype(notActive)).toBe(false);
    }
  });
});
