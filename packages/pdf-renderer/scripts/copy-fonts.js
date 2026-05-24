/**
 * Copy bundled font files from @fontsource/* node_modules into ./fonts/.
 *
 * Why we copy at build/publish time:
 *   - @fontsource is a devDependency, so consumers installing
 *     @aibrains/pdf-renderer from npm don't have it on disk
 *   - we ship the .woff files in our own tarball (via `files: [..., "fonts"]`)
 *   - the fonts/ directory at package root is path-resolvable identically
 *     from src/core/fonts.ts and dist/core/fonts.js (both ../../fonts/)
 *
 * Run via `npm run build` (chains after tsc) and `npm run prepare`.
 * Idempotent — overwrites existing files.
 */

const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const FONTS_DIR = path.join(PACKAGE_ROOT, 'fonts');

const COPIES = [
  {
    from: 'node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff',
    to: 'NotoSans-Regular.woff',
  },
  {
    from: 'node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff',
    to: 'NotoSans-Bold.woff',
  },
  {
    from: 'node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff',
    to: 'NotoSansDevanagari-Regular.woff',
  },
  {
    from: 'node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff',
    to: 'NotoSansDevanagari-Bold.woff',
  },
];

// @fontsource lives at the monorepo root, not inside this package's node_modules.
// Resolve from the workspace root.
const WORKSPACE_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');

fs.mkdirSync(FONTS_DIR, { recursive: true });

let copied = 0;
for (const { from, to } of COPIES) {
  const src = path.join(WORKSPACE_ROOT, from);
  const dest = path.join(FONTS_DIR, to);
  if (!fs.existsSync(src)) {
    // Fall back to per-package node_modules in case dev installed locally.
    const localSrc = path.join(PACKAGE_ROOT, from);
    if (fs.existsSync(localSrc)) {
      fs.copyFileSync(localSrc, dest);
      copied++;
      continue;
    }
    console.error(`[copy-fonts] missing source: ${from}`);
    console.error('  Ran `npm install` at repo root?');
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  copied++;
}

console.log(`[copy-fonts] copied ${copied} font file(s) to ${path.relative(PACKAGE_ROOT, FONTS_DIR)}/`);
