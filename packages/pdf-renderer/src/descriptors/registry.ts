/**
 * Singleton registry of template descriptors, keyed by `DocType`.
 *
 * Each `descriptors/{doc-type}.ts` file performs a side-effect at module load:
 *
 *   import { registerDescriptor } from '../descriptors/registry';
 *   registerDescriptor(myDescriptor);
 *
 * The editor UI and render endpoints look up descriptors by `getDescriptor`.
 * Adding a new doc type = adding a new file that calls `registerDescriptor`;
 * NO change to the editor, the registry, or any consumer is needed.
 *
 * The registry deliberately uses module-singleton state. Tests can reset it
 * via `_clearRegistryForTest`.
 */

import type {
  DocType,
  PdfTemplateConfig,
  TemplateDescriptor,
} from './types';

// We store as `TemplateDescriptor<unknown, PdfTemplateConfig>` internally
// because the registry can't preserve each entry's specific generics across
// the lookup boundary. `getDescriptor<TData, TConfig>(...)` casts back at the
// retrieval site — callers that know their concrete types pass the generics.
type UnknownDescriptor = TemplateDescriptor<unknown, PdfTemplateConfig>;

const REGISTRY = new Map<DocType, UnknownDescriptor>();

/**
 * Register a descriptor. Throws on duplicate `docType` — each doc type
 * registers exactly once. Catching the duplicate at registration time
 * surfaces accidental double-imports (e.g., two paths both importing
 * `descriptors/invoice.ts`) as a loud error rather than silent override.
 */
export function registerDescriptor<TData, TConfig extends PdfTemplateConfig>(
  descriptor: TemplateDescriptor<TData, TConfig>,
): void {
  if (REGISTRY.has(descriptor.docType)) {
    throw new Error(
      `[pdf-renderer] Duplicate descriptor registration for docType '${descriptor.docType}'. ` +
        `Each docType must register exactly once. Check for duplicate imports of the same descriptor file.`,
    );
  }
  // Double-cast through `unknown` is required because TS can't directly relate
  // `TemplateDescriptor<TData, TConfig>` to `TemplateDescriptor<unknown, PdfTemplateConfig>`
  // — the generic param positions are invariant. The store-as-unknown /
  // cast-back-at-retrieval pattern is intentional; getDescriptor does the
  // matching reverse cast.
  REGISTRY.set(descriptor.docType, descriptor as unknown as UnknownDescriptor);
}

/**
 * Look up a descriptor by `docType`. Throws with a helpful message listing
 * the known docTypes if the requested one isn't registered — guards against
 * typos at endpoint wire-up time.
 *
 * Generics: callers that know the concrete `TData` + `TConfig` for the docType
 * can supply them to get a typed descriptor back. Callers that don't (e.g.,
 * the editor UI iterating over all doc types) get the default
 * `unknown / PdfTemplateConfig` shape and access only the descriptor-level
 * metadata (configurableFields, defaults, sampleData).
 */
export function getDescriptor<
  TData = unknown,
  TConfig extends PdfTemplateConfig = PdfTemplateConfig,
>(docType: DocType): TemplateDescriptor<TData, TConfig> {
  const descriptor = REGISTRY.get(docType);
  if (!descriptor) {
    const known = [...REGISTRY.keys()];
    throw new Error(
      `[pdf-renderer] No descriptor registered for docType '${docType}'. ` +
        `Known: ${known.length > 0 ? known.join(', ') : '(none)'}.`,
    );
  }
  // See registerDescriptor — this is the matching cast on the retrieval side.
  return descriptor as unknown as TemplateDescriptor<TData, TConfig>;
}

/**
 * Return the list of currently-registered doc types. Used by the editor's
 * settings page to enumerate template cards.
 */
export function getRegisteredDocTypes(): readonly DocType[] {
  return [...REGISTRY.keys()];
}

/**
 * Check whether a descriptor is registered without throwing. Useful for the
 * editor when it wants to render disabled cards for not-yet-shipped doc
 * types.
 */
export function hasDescriptor(docType: DocType): boolean {
  return REGISTRY.has(docType);
}

/**
 * Test-only escape hatch. Clears the registry so each spec file starts
 * clean. Not exported from the public package surface.
 */
export function _clearRegistryForTest(): void {
  REGISTRY.clear();
}
