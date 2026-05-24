/**
 * Font registration for @aibrains/pdf-renderer.
 *
 * Two font families ship with the package:
 *   - `Noto Sans` — Latin script (Regular + Bold)
 *   - `Noto Sans Devanagari` — Devanagari script for Nepali (Regular + Bold)
 *
 * Both are sourced from @fontsource/* at build time and copied to ./fonts/ at the
 * package root (see scripts/copy-fonts.js). At runtime, paths resolve identically
 * from `src/core/fonts.ts` and `dist/core/fonts.js` because both live two
 * directories below the package root (../../fonts/).
 *
 * Devanagari rendering uses Yoga + Fontkit + Harfbuzz inside @react-pdf/renderer v4
 * to handle complex script shaping (conjuncts, vowel marks). This is the canary for
 * Risk R45 (Devanagari shaping defects in production); snapshot tests in the
 * primitives + components directories exercise the pipeline.
 *
 * Call `registerFonts()` exactly once per process before the first render. The
 * `Document` primitive (in `primitives/Document.tsx`) does this automatically.
 *
 * For browser consumers (Shell live-preview via `<PDFViewer>`), the same fonts
 * are bundled in the published tarball; consumers' bundlers (Rsbuild, Webpack)
 * pick them up via the relative path. URL-based registration for CDN deployments
 * is a Sprint C.2 concern.
 */

import * as path from 'node:path';
import { Font } from '@react-pdf/renderer';

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const FONT_DIR = path.join(PACKAGE_ROOT, 'fonts');

/** Latin font family registered by `registerFonts()`. */
export const FONT_FAMILY_LATIN = 'Noto Sans' as const;
/** Devanagari (Nepali) font family registered by `registerFonts()`. */
export const FONT_FAMILY_DEVANAGARI = 'Noto Sans Devanagari' as const;

// Unicode range U+0900..U+097F covers the full Devanagari block. Any codepoint
// in that range means the run contains Devanagari script and needs the
// Devanagari font. Latin (Basic Latin + Latin-1 Supplement) lives outside
// this range — we route it to the default Latin family. Mixed runs are split
// into multiple <Text> elements by the component layer.
const DEVANAGARI_RANGE = /[ऀ-ॿ]/;

/**
 * Pick the correct font family for a text run.
 *
 * `@react-pdf/renderer` does NOT support CSS-style font-fallback chains —
 * each text run uses exactly one font family. For mixed-script content
 * (e.g., dual-language labels "Invoice / बिल"), components must split into
 * separate `<Text>` elements and call this helper per segment.
 *
 * Detection rule: **any-Devanagari-wins**. The implementation tests
 * `DEVANAGARI_RANGE.test(str)`, which returns true if ANY codepoint in the
 * string falls in the Devanagari block — regardless of position. So
 * `pickFontFamily('Invoice / बिल')` returns `FONT_FAMILY_DEVANAGARI` even
 * though Latin appears first. This is intentional for V1: when a Devanagari
 * character is present, we always need its font to render correctly; the
 * Latin characters in `Noto Sans Devanagari` render acceptably (the font
 * includes Basic Latin glyphs). If first-script-wins semantics are ever
 * needed, change `DEVANAGARI_RANGE.test(str)` to scan only the first script
 * cluster.
 *
 * @example
 *   pickFontFamily('Subtotal')        // 'Noto Sans'
 *   pickFontFamily('उप-योग')          // 'Noto Sans Devanagari'
 *   pickFontFamily('Invoice / बिल')   // 'Noto Sans Devanagari' (any-Devanagari-wins)
 *   pickFontFamily('बिल / Invoice')   // 'Noto Sans Devanagari'
 *   pickFontFamily('')                // 'Noto Sans' (default for empty / null / undefined)
 */
export function pickFontFamily(
  text: string | number | null | undefined,
): typeof FONT_FAMILY_LATIN | typeof FONT_FAMILY_DEVANAGARI {
  if (text === null || text === undefined || text === '') return FONT_FAMILY_LATIN;
  const str = String(text);
  return DEVANAGARI_RANGE.test(str) ? FONT_FAMILY_DEVANAGARI : FONT_FAMILY_LATIN;
}

/**
 * Image source type accepted by `<Image>` components in this library.
 *
 * Narrowed subset of `@react-pdf/renderer`'s `SourceObject`:
 *   - `string` — URL (absolute http(s)) or absolute filesystem path
 *   - `Buffer` — Node Buffer (Lambda / server-side use)
 *
 * V1 deliberately excludes:
 *   - `SourceURLObject` literal (`{uri, method, body, headers}`) — the
 *     `method` field is typed as a narrow `HTTPMethod` enum upstream and
 *     callers rarely need request-shaping; if a future use case demands
 *     authenticated HTTP fetches, callers can cast at the site.
 *   - Factory + async variants — generating PDFs from dynamic factories
 *     isn't a V1 use case.
 *
 * Compatible at the value level with everything react-pdf's Image accepts
 * for these two forms.
 */
export type ImageSource = string | Buffer;

let registered = false;

/**
 * Register the bundled fonts with `@react-pdf/renderer`. Idempotent — safe to
 * call multiple times; subsequent calls short-circuit.
 *
 * Throws if the font files are not on disk (which means `npm run build` was
 * never run after installation). Surfaces a clear error rather than silently
 * rendering with the default font.
 */
export function registerFonts(): void {
  if (registered) return;

  // @react-pdf/renderer uses NUMERIC fontWeight internally (400 for normal,
  // 700 for bold). Passing the string 'normal'/'bold' to Font.register stores
  // them as strings but the resolver looks up numerics, so the registration
  // doesn't match at render time. Use numeric weights at registration to match.
  Font.register({
    family: FONT_FAMILY_LATIN,
    fonts: [
      {
        src: path.join(FONT_DIR, 'NotoSans-Regular.woff'),
        fontWeight: 400,
      },
      {
        src: path.join(FONT_DIR, 'NotoSans-Bold.woff'),
        fontWeight: 700,
      },
    ],
  });

  Font.register({
    family: FONT_FAMILY_DEVANAGARI,
    fonts: [
      {
        src: path.join(FONT_DIR, 'NotoSansDevanagari-Regular.woff'),
        fontWeight: 400,
      },
      {
        src: path.join(FONT_DIR, 'NotoSansDevanagari-Bold.woff'),
        fontWeight: 700,
      },
    ],
  });

  registered = true;
}

/** Test-only escape hatch — resets the registration guard so a test can re-register. */
export function _resetFontsForTest(): void {
  registered = false;
}
