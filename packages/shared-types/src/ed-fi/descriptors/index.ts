/**
 * Ed-Fi descriptor catalog + resolver — Sprint 2 public surface.
 *
 * Import from `@aibrains/shared-types` (top-level re-export) in consumers.
 */

export {
  ED_FI_URI_REGEX,
  descriptorLocaleSchema,
  descriptorDisplayNameSchema,
  edFiDescriptorEntrySchema,
  descriptorCatalogSchema,
  type DescriptorLocale,
  type EdFiDescriptorEntry,
  type DescriptorCatalog,
  type DescriptorContext,
  type DescriptorTypeName,
} from './descriptor-types';

export { DESCRIPTOR_CATALOGS, validateCatalog, type DescriptorType } from './catalogs';

export {
  resolveDescriptor,
  resolveDescriptorEntry,
  getDisplayName,
  getDescriptorDisplayNames,
  listDescriptorUris,
} from './resolve-descriptor';

export {
  sexDescriptorUriSchema,
  languageDescriptorUriSchema,
  disabilityDescriptorUriSchema,
  gradeLevelDescriptorUriSchema,
  exitWithdrawTypeDescriptorUriSchema,
  anyEdFiDescriptorUriSchema,
} from './descriptor-uri-schema';

export { LANGUAGE_DESCRIPTOR_CATALOG } from './language-descriptor';
export { DISABILITY_DESCRIPTOR_CATALOG } from './disability-descriptor';
export { SEX_DESCRIPTOR_CATALOG } from './sex-descriptor';
export { GRADE_LEVEL_DESCRIPTOR_CATALOG } from './grade-level-descriptor';
export { EXIT_WITHDRAW_TYPE_DESCRIPTOR_CATALOG } from './exit-withdraw-type-descriptor';
