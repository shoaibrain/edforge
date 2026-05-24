import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  registerFonts,
  _resetFontsForTest,
  pickFontFamily,
  FONT_FAMILY_LATIN,
  FONT_FAMILY_DEVANAGARI,
} from '../fonts';

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..');
const FONT_DIR = path.join(PACKAGE_ROOT, 'fonts');

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
    // First-script-wins for mixed strings — Devanagari leads here.
    expect(pickFontFamily('बिल / Invoice')).toBe(FONT_FAMILY_DEVANAGARI);
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
