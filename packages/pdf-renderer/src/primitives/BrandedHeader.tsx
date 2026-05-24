/**
 * BrandedHeader — page header with logo, school name, and address.
 *
 * Used by Invoice, Receipt, Report Card, Admit Card. Per template config:
 *   - `header.showLogo` — toggle the logo (if branding.logoS3Key present)
 *   - `header.showSchoolName` — toggle the school name
 *   - `header.showSchoolAddress` — toggle the address lines
 *   - `header.tagline` — optional tagline below the school name
 *
 * Logo source: callers must pre-resolve the S3 key to a URL or Buffer and
 * pass it as the `logoSrc` prop. The header doesn't fetch anything.
 */

import * as React from 'react';
import { View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { DEFAULT_COLORS, DEFAULT_FONT_SIZE, DEFAULT_SPACING } from '../core/theme';
import { pickFontFamily, type ImageSource } from '../core/fonts';

export interface BrandedHeaderBranding {
  /**
   * Pre-resolved logo source. Accepts URL string, Buffer, or react-pdf
   * SourceObject literal — see `ImageSource` in `core/fonts.ts`. Pass
   * `undefined` to skip.
   */
  logoSrc?: ImageSource;
  schoolName?: string;
  addressLines?: string[];
  phone?: string;
  email?: string;
}

export interface BrandedHeaderConfig {
  showLogo?: boolean;
  showSchoolName?: boolean;
  showSchoolAddress?: boolean;
  showContact?: boolean;
  tagline?: string;
  /** Primary brand color — applied to the school name. Defaults to theme primary. */
  primaryColor?: string;
}

export interface BrandedHeaderProps {
  branding: BrandedHeaderBranding;
  config?: BrandedHeaderConfig;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: DEFAULT_SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: DEFAULT_COLORS.border,
    marginBottom: DEFAULT_SPACING.lg,
  },
  logo: {
    width: 64,
    height: 64,
    objectFit: 'contain',
  },
  textBlock: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    flex: 1,
  },
  schoolName: {
    fontSize: DEFAULT_FONT_SIZE.lg,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  tagline: {
    // No italic variant registered in V1 — keep style upright.
    fontSize: DEFAULT_FONT_SIZE.xs,
    color: DEFAULT_COLORS.textMuted,
    marginBottom: 4,
  },
  address: {
    fontSize: DEFAULT_FONT_SIZE.xs,
    color: DEFAULT_COLORS.textMuted,
    lineHeight: 1.3,
  },
});

export const BrandedHeader: React.FC<BrandedHeaderProps> = ({
  branding,
  config = {},
}) => {
  const {
    showLogo = true,
    showSchoolName = true,
    showSchoolAddress = true,
    showContact = true,
    tagline,
    primaryColor,
  } = config;

  const hasLogo = showLogo && branding.logoSrc;
  const schoolColor = primaryColor ?? DEFAULT_COLORS.primary;

  return (
    <View style={styles.container}>
      {hasLogo && <Image style={styles.logo} src={branding.logoSrc} />}
      <View style={styles.textBlock}>
        {showSchoolName && branding.schoolName && (
          <Text style={[styles.schoolName, { color: schoolColor, fontFamily: pickFontFamily(branding.schoolName) }]}>
            {branding.schoolName}
          </Text>
        )}
        {tagline && (
          <Text style={[styles.tagline, { fontFamily: pickFontFamily(tagline) }]}>{tagline}</Text>
        )}
        {showSchoolAddress && branding.addressLines && branding.addressLines.length > 0 && (
          <View>
            {branding.addressLines.map((line, idx) => (
              <Text key={idx} style={[styles.address, { fontFamily: pickFontFamily(line) }]}>{line}</Text>
            ))}
          </View>
        )}
        {showContact && (branding.phone || branding.email) && (
          <Text style={styles.address}>
            {[branding.phone, branding.email].filter(Boolean).join(' · ')}
          </Text>
        )}
      </View>
    </View>
  );
};
