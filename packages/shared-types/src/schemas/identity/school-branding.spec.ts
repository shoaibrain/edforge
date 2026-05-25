import {
  schoolBrandingSchema,
  colorPaletteSchema,
  hexColorSchema,
} from './school-branding.schema';

describe('hexColorSchema', () => {
  it.each(['#000000', '#FFFFFF', '#0D9488', '#abcdef', '#A1B2C3'])(
    'accepts valid 6-digit hex %s',
    (input) => {
      expect(() => hexColorSchema.parse(input)).not.toThrow();
    },
  );

  it.each([
    ['', 'empty'],
    ['0D9488', 'missing #'],
    ['#0D948', '5 digits'],
    ['#0D94888', '7 digits'],
    ['#GGGGGG', 'non-hex chars'],
    ['#fff', 'shorthand 3-digit'],
    ['#0D9488AA', 'alpha channel'],
    ['rgb(13,148,136)', 'rgb() function'],
    ['teal', 'named color'],
  ])('rejects invalid hex %s (%s)', (input) => {
    expect(() => hexColorSchema.parse(input)).toThrow();
  });
});

describe('colorPaletteSchema', () => {
  it('accepts {primary, accent} both valid', () => {
    expect(() =>
      colorPaletteSchema.parse({ primary: '#0D9488', accent: '#0F766E' }),
    ).not.toThrow();
  });

  it('rejects missing accent', () => {
    expect(() =>
      colorPaletteSchema.parse({ primary: '#0D9488' } as never),
    ).toThrow();
  });

  it('rejects invalid hex in either slot', () => {
    expect(() =>
      colorPaletteSchema.parse({ primary: 'teal', accent: '#0F766E' }),
    ).toThrow();
    expect(() =>
      colorPaletteSchema.parse({ primary: '#0D9488', accent: '#FFF' }),
    ).toThrow();
  });
});

describe('schoolBrandingSchema', () => {
  describe('shape — every field optional', () => {
    it('accepts an empty object (every field optional; backward-compat for existing schools)', () => {
      expect(() => schoolBrandingSchema.parse({})).not.toThrow();
    });

    it('accepts a partial branding object (just logo + colors)', () => {
      expect(() =>
        schoolBrandingSchema.parse({
          logoS3Key: 'tenants/abc/schools/xyz/branding/logo/uuid.png',
          colorPalette: { primary: '#0D9488', accent: '#0F766E' },
        }),
      ).not.toThrow();
    });
  });

  describe('addressLines', () => {
    it('accepts up to 4 lines', () => {
      expect(() =>
        schoolBrandingSchema.parse({
          addressLines: ['Line 1', 'Line 2', 'Line 3', 'Line 4'],
        }),
      ).not.toThrow();
    });

    it('rejects a 5th line', () => {
      expect(() =>
        schoolBrandingSchema.parse({
          addressLines: ['1', '2', '3', '4', '5'],
        }),
      ).toThrow();
    });

    it('rejects an empty string in the array', () => {
      expect(() =>
        schoolBrandingSchema.parse({ addressLines: ['', 'OK'] }),
      ).toThrow();
    });

    it('rejects a line longer than 120 characters', () => {
      const tooLong = 'x'.repeat(121);
      expect(() => schoolBrandingSchema.parse({ addressLines: [tooLong] })).toThrow();
    });

    it('accepts a line exactly 120 characters', () => {
      const justRight = 'x'.repeat(120);
      expect(() =>
        schoolBrandingSchema.parse({ addressLines: [justRight] }),
      ).not.toThrow();
    });
  });

  describe('email + phone + tagline', () => {
    it('accepts a valid email', () => {
      expect(() =>
        schoolBrandingSchema.parse({ email: 'info@saraswati.edu.np' }),
      ).not.toThrow();
    });

    it('rejects malformed email', () => {
      expect(() => schoolBrandingSchema.parse({ email: 'not-an-email' })).toThrow();
    });

    it('accepts phone string up to 50 chars (international varies)', () => {
      expect(() =>
        schoolBrandingSchema.parse({ phone: '+977 1 4444444 ext 12' }),
      ).not.toThrow();
    });

    it('rejects tagline longer than 100 chars', () => {
      expect(() =>
        schoolBrandingSchema.parse({ tagline: 'x'.repeat(101) }),
      ).toThrow();
    });
  });

  describe('S3 key fields (logo / signature / letterhead)', () => {
    it('accepts a plausible per-tenant key path', () => {
      expect(() =>
        schoolBrandingSchema.parse({
          logoS3Key: 'tenants/abc-uuid/schools/xyz-uuid/branding/logo/img.png',
          principalSignatureS3Key:
            'tenants/abc-uuid/schools/xyz-uuid/branding/signature/sig.png',
          letterheadBackgroundS3Key:
            'tenants/abc-uuid/schools/xyz-uuid/branding/letterhead/bg.png',
        }),
      ).not.toThrow();
    });

    it('rejects empty string for any key', () => {
      expect(() => schoolBrandingSchema.parse({ logoS3Key: '' })).toThrow();
    });

    it('rejects keys longer than 500 chars', () => {
      expect(() =>
        schoolBrandingSchema.parse({ logoS3Key: 'a'.repeat(501) }),
      ).toThrow();
    });
  });

  describe('panNumber + vatNumber (tax registration)', () => {
    it.each([
      '123456789', // Nepal PAN (9 digits)
      'AAAAA0000A', // India PAN format
      'GB123456789', // EU VAT format
    ])('accepts plausible registration %s', (input) => {
      expect(() =>
        schoolBrandingSchema.parse({ panNumber: input }),
      ).not.toThrow();
      expect(() =>
        schoolBrandingSchema.parse({ vatNumber: input }),
      ).not.toThrow();
    });

    it('rejects too-long values (>32 chars)', () => {
      expect(() =>
        schoolBrandingSchema.parse({ panNumber: 'x'.repeat(33) }),
      ).toThrow();
    });

    it('rejects empty string', () => {
      expect(() => schoolBrandingSchema.parse({ panNumber: '' })).toThrow();
    });
  });

  describe('brandingVersionId', () => {
    it('accepts a valid UUID', () => {
      expect(() =>
        schoolBrandingSchema.parse({
          brandingVersionId: '12345678-1234-4234-8234-123456789012',
        }),
      ).not.toThrow();
    });

    it('rejects non-UUID strings', () => {
      expect(() =>
        schoolBrandingSchema.parse({ brandingVersionId: 'not-a-uuid' }),
      ).toThrow();
    });
  });

  describe('formalName', () => {
    it('accepts long formal names up to 200 chars', () => {
      expect(() =>
        schoolBrandingSchema.parse({
          formalName: 'Saraswati Higher Secondary School, Lalitpur, Bagmati Province, Nepal',
        }),
      ).not.toThrow();
    });

    it('rejects formalName longer than 200 chars', () => {
      expect(() =>
        schoolBrandingSchema.parse({ formalName: 'x'.repeat(201) }),
      ).toThrow();
    });
  });

  describe('full realistic PABSON branding', () => {
    it('accepts a fully-populated PABSON-style branding object', () => {
      expect(() =>
        schoolBrandingSchema.parse({
          formalName: 'सरस्वती माध्यमिक विद्यालय, ललितपुर',
          addressLines: [
            'Ward 5, Lalitpur',
            'Bagmati Province',
            'Nepal',
          ],
          phone: '+977 1 5550123',
          email: 'info@saraswati.edu.np',
          logoS3Key: 'tenants/abc/schools/xyz/branding/logo/abc123.png',
          principalSignatureS3Key:
            'tenants/abc/schools/xyz/branding/signature/sig.png',
          colorPalette: { primary: '#0D9488', accent: '#0F766E' },
          panNumber: '123456789',
          vatNumber: '987654321',
          tagline: 'Knowledge · Discipline · Service',
          brandingVersionId: '12345678-1234-4234-8234-123456789012',
        }),
      ).not.toThrow();
    });
  });
});
