import {
  DEFAULT_COLORS,
  DEFAULT_SPACING,
  DEFAULT_FONT_SIZE,
  DEFAULT_MARGINS_MM,
} from '../theme';

describe('theme tokens are well-formed', () => {
  it('DEFAULT_COLORS exposes hex strings for all required slots', () => {
    expect(DEFAULT_COLORS.primary).toMatch(/^#[0-9A-F]{6}$/i);
    expect(DEFAULT_COLORS.accent).toMatch(/^#[0-9A-F]{6}$/i);
    expect(DEFAULT_COLORS.text).toMatch(/^#[0-9A-F]{6}$/i);
    expect(DEFAULT_COLORS.textMuted).toMatch(/^#[0-9A-F]{6}$/i);
    expect(DEFAULT_COLORS.border).toMatch(/^#[0-9A-F]{6}$/i);
    expect(DEFAULT_COLORS.background).toMatch(/^#[0-9A-F]{6}$/i);
    expect(DEFAULT_COLORS.danger).toMatch(/^#[0-9A-F]{6}$/i);
    expect(DEFAULT_COLORS.success).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('DEFAULT_SPACING values are monotonically increasing', () => {
    expect(DEFAULT_SPACING.xs).toBeLessThan(DEFAULT_SPACING.sm);
    expect(DEFAULT_SPACING.sm).toBeLessThan(DEFAULT_SPACING.md);
    expect(DEFAULT_SPACING.md).toBeLessThan(DEFAULT_SPACING.lg);
    expect(DEFAULT_SPACING.lg).toBeLessThan(DEFAULT_SPACING.xl);
  });

  it('DEFAULT_FONT_SIZE values are monotonically increasing', () => {
    expect(DEFAULT_FONT_SIZE.xs).toBeLessThan(DEFAULT_FONT_SIZE.sm);
    expect(DEFAULT_FONT_SIZE.sm).toBeLessThan(DEFAULT_FONT_SIZE.md);
    expect(DEFAULT_FONT_SIZE.md).toBeLessThan(DEFAULT_FONT_SIZE.lg);
    expect(DEFAULT_FONT_SIZE.lg).toBeLessThan(DEFAULT_FONT_SIZE.xl);
  });

  it('DEFAULT_MARGINS_MM all sides are positive', () => {
    expect(DEFAULT_MARGINS_MM.top).toBeGreaterThan(0);
    expect(DEFAULT_MARGINS_MM.right).toBeGreaterThan(0);
    expect(DEFAULT_MARGINS_MM.bottom).toBeGreaterThan(0);
    expect(DEFAULT_MARGINS_MM.left).toBeGreaterThan(0);
  });
});
