/**
 * Public surface of the descriptor system.
 *
 * Sprint C.0.4 ships the registry + the contract. Concrete descriptors land
 * with their document components in subsequent sprints:
 *   - C.1.1 — invoice descriptor
 *   - C.1.2 — receipt descriptor
 *   - C.3.1 — report-card descriptor
 *   - C.5.1 — admit-card descriptor
 *   - (and so on for the V1.5 doc types)
 */

export {
  registerDescriptor,
  getDescriptor,
  getRegisteredDocTypes,
  hasDescriptor,
} from './registry';

// Note: `Lang` is exported by `core/i18n` (the canonical location); we don't
// re-export it from descriptors to avoid a duplicate-export collision at the
// package root.
export type {
  DocType,
  Archetype,
  PdfBranding,
  PdfLocaleSettings,
  PdfTemplateConfig,
  ConfigurableField,
  DocumentComponentProps,
  TemplateDescriptor,
} from './types';
