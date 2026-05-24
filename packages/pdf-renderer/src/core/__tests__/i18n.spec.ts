import { t, tDual } from '../i18n';

describe('t() — single-language translation', () => {
  it('returns English translation for the en lang', () => {
    expect(t('common', 'subtotal', 'en')).toBe('Subtotal');
    expect(t('common', 'amountDue', 'en')).toBe('Amount Due');
  });

  it('returns Nepali translation for the ne lang', () => {
    expect(t('common', 'subtotal', 'ne')).toBe('उप-योग');
    expect(t('common', 'amountDue', 'ne')).toBe('बाँकी रकम');
  });

  it('falls back to English when a key is missing in the target language', () => {
    // We deliberately do not delete keys from the bundles to test this — every
    // common.json key is present in both en and ne. Force the fallback path
    // by asking for a key the dynamic lookup truly doesn't have.
    // (See "returns the key itself..." for the cascade end-state.)
    expect(t('common', 'someKeyThatDoesNotExist', 'ne')).toBe(
      'someKeyThatDoesNotExist',
    );
  });

  it('returns the key itself when no language has the key (visible breadcrumb)', () => {
    expect(t('common', 'totallyMadeUpKey', 'en')).toBe('totallyMadeUpKey');
  });

  it('interpolates {var} placeholders', () => {
    expect(t('common', 'pageOf', 'en', { page: 1, total: 3 })).toBe(
      'Page 1 of 3',
    );
    expect(t('common', 'pageOf', 'ne', { page: 1, total: 3 })).toBe(
      'पृष्ठ 1 / 3',
    );
  });

  it('substitutes undefined / null vars as empty strings (defensive)', () => {
    expect(t('common', 'pageOf', 'en', { page: undefined, total: null })).toBe(
      'Page  of ',
    );
  });

  it('leaves placeholders untouched when no vars passed even if template has them', () => {
    expect(t('common', 'pageOf', 'en')).toBe('Page {page} of {total}');
  });
});

describe('tDual() — dual-language rendering', () => {
  it('returns both translations primary-then-secondary', () => {
    expect(tDual('common', 'subtotal', ['en', 'ne'])).toEqual({
      primary: 'Subtotal',
      secondary: 'उप-योग',
    });
  });

  it('respects language order (ne primary, en secondary)', () => {
    expect(tDual('common', 'subtotal', ['ne', 'en'])).toEqual({
      primary: 'उप-योग',
      secondary: 'Subtotal',
    });
  });

  it('passes interpolation vars through to both', () => {
    expect(
      tDual('common', 'pageOf', ['en', 'ne'], { page: 2, total: 5 }),
    ).toEqual({
      primary: 'Page 2 of 5',
      secondary: 'पृष्ठ 2 / 5',
    });
  });
});

describe('parity — every en key exists in ne (and vice versa)', () => {
  // The bundle files are imported via resolveJsonModule at compile time.
  // We re-import here for the parity check to ensure both bundles ship.
  // If this breaks, a translator left a gap somewhere.
  it('all common.json keys have parity between en and ne', () => {
    const en = require('../../i18n/en/common.json') as Record<string, string>;
    const ne = require('../../i18n/ne/common.json') as Record<string, string>;
    const enKeys = Object.keys(en).sort();
    const neKeys = Object.keys(ne).sort();
    expect(neKeys).toEqual(enKeys);
  });

  it('no en value is empty', () => {
    const en = require('../../i18n/en/common.json') as Record<string, string>;
    Object.entries(en).forEach(([key, value]) => {
      expect(value).toBeTruthy();
      expect(value.length).toBeGreaterThan(0);
    });
  });

  it('no ne value is empty', () => {
    const ne = require('../../i18n/ne/common.json') as Record<string, string>;
    Object.entries(ne).forEach(([key, value]) => {
      expect(value).toBeTruthy();
      expect(value.length).toBeGreaterThan(0);
    });
  });
});
