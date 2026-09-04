import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Font } from '@react-pdf/renderer';
import {
  registerFonts,
  resolveFontDir,
  FONT_DIR_ENV,
  _resetFontsForTest,
  pickFontFamily,
  FONT_FAMILY_LATIN,
  FONT_FAMILY_DEVANAGARI,
} from '../fonts';

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..');
const FONT_DIR = path.join(PACKAGE_ROOT, 'fonts');

describe('font directory override (single-file bundles such as Lambda)', () => {
  it('defaults to the package fonts directory and ignores a blank override', () => {
    expect(resolveFontDir({})).toBe(FONT_DIR);
    expect(resolveFontDir({ [FONT_DIR_ENV]: '   ' })).toBe(FONT_DIR);
  });

  it('honours PDF_FONT_DIR', () => {
    expect(resolveFontDir({ [FONT_DIR_ENV]: '/var/task/fonts' })).toBe(path.resolve('/var/task/fonts'));
  });

  it('registers all four fonts from the override directory, read at registration time', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-renderer-fonts-'));
    for (const f of fs.readdirSync(FONT_DIR)) fs.copyFileSync(path.join(FONT_DIR, f), path.join(dir, f));
    const spy = jest.spyOn(Font, 'register');
    const previous = process.env[FONT_DIR_ENV];
    process.env[FONT_DIR_ENV] = dir;
    try {
      _resetFontsForTest();
      registerFonts();
    } finally {
      if (previous === undefined) delete process.env[FONT_DIR_ENV];
      else process.env[FONT_DIR_ENV] = previous;
    }
    const sources = spy.mock.calls.flatMap(([cfg]) => (cfg as { fonts: { src: string }[] }).fonts.map((f) => f.src));
    expect(sources).toHaveLength(4);
    for (const src of sources) {
      expect(path.dirname(src)).toBe(dir);
      expect(fs.existsSync(src)).toBe(true);
    }
    spy.mockRestore();
    _resetFontsForTest();
    registerFonts();
  });
});

describe('font infrastructure', () => {
  it('all four bundled font files exist on disk after `npm run build`', () => {
    expect(fs.existsSync(path.join(FONT_DIR, 'NotoSans-Regular.woff'))).toBe(true);
    expect(fs.existsSync(path.join(FONT_DIR, 'NotoSans-Bold.woff'))).toBe(true);
    expect(fs.existsSync(path.join(FONT_DIR, 'NotoSansDevanagari-Regular.woff'))).toBe(true);
    expect(fs.existsSync(path.join(FONT_DIR, 'NotoSansDevanagari-Bold.woff'))).toBe(true);
  });

  it('exposes the expected family names', () => {
    expect(FONT_FAMILY_LATIN).toBe('Noto Sans');
    expect(FONT_FAMILY_DEVANAGARI).toBe('Noto Sans Devanagari');
  });

  it('registerFonts() does not throw and is idempotent', () => {
    _resetFontsForTest();
    expect(() => registerFonts()).not.toThrow();
    expect(() => registerFonts()).not.toThrow();
    expect(() => registerFonts()).not.toThrow();
  });
});

describe('pickFontFamily — script detection for per-Text font switching', () => {
  it('returns Latin for ASCII strings', () => {
    expect(pickFontFamily('Invoice')).toBe(FONT_FAMILY_LATIN);
    expect(pickFontFamily('Subtotal: 1,234.00')).toBe(FONT_FAMILY_LATIN);
    expect(pickFontFamily('PAN: 123456789')).toBe(FONT_FAMILY_LATIN);
  });

  it('returns Devanagari for Nepali strings', () => {
    expect(pickFontFamily('बिल')).toBe(FONT_FAMILY_DEVANAGARI);
    expect(pickFontFamily('उप-योग')).toBe(FONT_FAMILY_DEVANAGARI);
    expect(pickFontFamily('विद्यार्थीको नाम')).toBe(FONT_FAMILY_DEVANAGARI);
  });

  it('uses any-Devanagari-wins for mixed strings (Devanagari anywhere → Devanagari font)', () => {
    // pickFontFamily uses DEVANAGARI_RANGE.test(str) which returns true if ANY
    // codepoint in the string is in the Devanagari block — regardless of
    // position. Both of these return Devanagari:
    expect(pickFontFamily('बिल / Invoice')).toBe(FONT_FAMILY_DEVANAGARI);
    expect(pickFontFamily('Invoice / बिल')).toBe(FONT_FAMILY_DEVANAGARI);
  });

  it('defaults to Latin for empty / null / undefined', () => {
    expect(pickFontFamily('')).toBe(FONT_FAMILY_LATIN);
    expect(pickFontFamily(null)).toBe(FONT_FAMILY_LATIN);
    expect(pickFontFamily(undefined)).toBe(FONT_FAMILY_LATIN);
  });

  it('handles numeric input via String coercion', () => {
    expect(pickFontFamily(1234)).toBe(FONT_FAMILY_LATIN);
    expect(pickFontFamily(0)).toBe(FONT_FAMILY_LATIN);
  });
});
