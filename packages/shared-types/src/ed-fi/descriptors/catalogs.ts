/**
 * Ed-Fi descriptor catalog registry — Sprint 2.
 *
 * Single import surface for every catalog defined in this directory. Catalogs
 * are validated against `descriptorCatalogSchema` at module load time so
 * authoring errors (bad URI, duplicate alias, etc.) fail the process on boot
 * instead of shipping silently. `validateCatalog()` is also exported for
 * test-time / CI assertion.
 */

import { descriptorCatalogSchema, type DescriptorCatalog, type DescriptorTypeName } from './descriptor-types';
import { LANGUAGE_DESCRIPTOR_CATALOG } from './language-descriptor';
import { DISABILITY_DESCRIPTOR_CATALOG } from './disability-descriptor';
import { SEX_DESCRIPTOR_CATALOG } from './sex-descriptor';
import { GRADE_LEVEL_DESCRIPTOR_CATALOG } from './grade-level-descriptor';
import { EXIT_WITHDRAW_TYPE_DESCRIPTOR_CATALOG } from './exit-withdraw-type-descriptor';

export type DescriptorType = DescriptorTypeName;

/** Registry of all catalogs keyed by their DescriptorType name. */
export const DESCRIPTOR_CATALOGS: Record<DescriptorType, DescriptorCatalog> = {
  LanguageDescriptor: LANGUAGE_DESCRIPTOR_CATALOG,
  DisabilityDescriptor: DISABILITY_DESCRIPTOR_CATALOG,
  SexDescriptor: SEX_DESCRIPTOR_CATALOG,
  GradeLevelDescriptor: GRADE_LEVEL_DESCRIPTOR_CATALOG,
  ExitWithdrawTypeDescriptor: EXIT_WITHDRAW_TYPE_DESCRIPTOR_CATALOG,
};

/**
 * Throw-on-invalid validation. Called at module load (below) AND exposed for
 * CI use ("lint rule" from S2.2) so a new catalog entry with a malformed URI
 * cannot land without the unit suite catching it.
 */
export function validateCatalog(catalog: DescriptorCatalog): DescriptorCatalog {
  return descriptorCatalogSchema.parse(catalog);
}

// Validate every seeded catalog at load time. Any authoring error here
// (bad URI, duplicate code, code/URI mismatch, etc.) throws on import and
// the failing catalog name is in the stack trace.
for (const [typeName, catalog] of Object.entries(DESCRIPTOR_CATALOGS)) {
  try {
    validateCatalog(catalog);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Descriptor catalog "${typeName}" failed validation: ${reason}`);
  }
}
