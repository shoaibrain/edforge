import {
  NEPAL_ADMIN_DIVISIONS_CATALOG_VERSION,
  NEPAL_PROVINCES,
  NEPAL_DISTRICTS,
  NEPAL_MUNICIPALITY_TYPES,
  findNepalProvince,
  findNepalDistrict,
  nepalDistrictsForProvince,
  type NepalProvinceCode,
} from './nepal-administrative-divisions';

describe('Nepal administrative divisions catalog', () => {
  describe('Catalog metadata', () => {
    it('exposes a catalog version (semver string)', () => {
      expect(NEPAL_ADMIN_DIVISIONS_CATALOG_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('Provinces', () => {
    it('has exactly 7 provinces (post-2017 federalism)', () => {
      expect(NEPAL_PROVINCES).toHaveLength(7);
    });

    it('province codes are 1..7 and contiguous', () => {
      const codes = NEPAL_PROVINCES.map((p) => p.provinceCode).sort((a, b) => a - b);
      expect(codes).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('province codes are unique', () => {
      const codes = NEPAL_PROVINCES.map((p) => p.provinceCode);
      expect(new Set(codes).size).toBe(NEPAL_PROVINCES.length);
    });

    it('every province has a non-empty English name', () => {
      for (const p of NEPAL_PROVINCES) {
        expect(p.nameEn).toBeTruthy();
        expect(p.nameEn.length).toBeGreaterThan(0);
      }
    });

    it('every province has a non-empty Devanagari (Nepali) name', () => {
      for (const p of NEPAL_PROVINCES) {
        expect(p.nameNe).toBeTruthy();
        expect(p.nameNe.length).toBeGreaterThan(0);
      }
    });

    it('English names match the post-2017 official ordinance', () => {
      const namesByCode = Object.fromEntries(
        NEPAL_PROVINCES.map((p) => [p.provinceCode, p.nameEn]),
      );
      expect(namesByCode).toEqual({
        1: 'Koshi',
        2: 'Madhesh',
        3: 'Bagmati',
        4: 'Gandaki',
        5: 'Lumbini',
        6: 'Karnali',
        7: 'Sudurpashchim',
      });
    });
  });

  describe('Districts', () => {
    it('has exactly 77 districts (post-2017 federalism — Nawalparasi & Rukum splits)', () => {
      expect(NEPAL_DISTRICTS).toHaveLength(77);
    });

    it('every district provinceCode is in {1..7}', () => {
      for (const d of NEPAL_DISTRICTS) {
        expect(d.provinceCode).toBeGreaterThanOrEqual(1);
        expect(d.provinceCode).toBeLessThanOrEqual(7);
      }
    });

    it('every district CEHRD code is a 2-digit zero-padded string', () => {
      for (const d of NEPAL_DISTRICTS) {
        expect(d.cehrdCode).toMatch(/^\d{2}$/);
      }
    });

    it('every district CEHRD code is unique', () => {
      const codes = NEPAL_DISTRICTS.map((d) => d.cehrdCode);
      expect(new Set(codes).size).toBe(NEPAL_DISTRICTS.length);
    });

    it('CEHRD codes form the contiguous range 01..77', () => {
      const codes = NEPAL_DISTRICTS.map((d) => d.cehrdCode).sort();
      const expected = Array.from({ length: 77 }, (_, i) =>
        String(i + 1).padStart(2, '0'),
      );
      expect(codes).toEqual(expected);
    });

    it('every district English name is non-empty', () => {
      for (const d of NEPAL_DISTRICTS) {
        expect(d.nameEn).toBeTruthy();
        expect(d.nameEn.length).toBeGreaterThan(0);
      }
    });

    it('province district counts match the canonical CEHRD distribution', () => {
      const countsByProvince = NEPAL_DISTRICTS.reduce<Record<number, number>>(
        (acc, d) => {
          acc[d.provinceCode] = (acc[d.provinceCode] ?? 0) + 1;
          return acc;
        },
        {},
      );
      expect(countsByProvince).toEqual({
        1: 14, // Koshi
        2: 8, // Madhesh
        3: 13, // Bagmati
        4: 11, // Gandaki
        5: 12, // Lumbini
        6: 10, // Karnali
        7: 9, // Sudurpashchim
      });
    });

    it('spot-check: 7 anchor districts (one per province) resolve correctly', () => {
      const lookup = (code: string) => NEPAL_DISTRICTS.find((d) => d.cehrdCode === code);
      expect(lookup('01')).toMatchObject({ provinceCode: 1, nameEn: 'Taplejung' });
      expect(lookup('15')).toMatchObject({ provinceCode: 2, nameEn: 'Saptari' });
      expect(lookup('30')).toMatchObject({ provinceCode: 3, nameEn: 'Kathmandu' });
      expect(lookup('40')).toMatchObject({ provinceCode: 4, nameEn: 'Kaski' });
      expect(lookup('48')).toMatchObject({ provinceCode: 5, nameEn: 'Rupandehi' });
      expect(lookup('61')).toMatchObject({ provinceCode: 6, nameEn: 'Surkhet' });
      expect(lookup('73')).toMatchObject({ provinceCode: 7, nameEn: 'Kailali' });
    });

    it('post-2017 splits: Nawalparasi East/West present (Nawalpur in P4, Parasi in P5)', () => {
      const nawalpur = NEPAL_DISTRICTS.find((d) => d.nameEn === 'Nawalpur');
      const parasi = NEPAL_DISTRICTS.find((d) => d.nameEn === 'Parasi');
      expect(nawalpur?.provinceCode).toBe(4);
      expect(parasi?.provinceCode).toBe(5);
    });

    it('post-2017 splits: Rukum East/West present (Rukum East in P5, Rukum West in P6)', () => {
      const rukumEast = NEPAL_DISTRICTS.find((d) => d.nameEn === 'Rukum East');
      const rukumWest = NEPAL_DISTRICTS.find((d) => d.nameEn === 'Rukum West');
      expect(rukumEast?.provinceCode).toBe(5);
      expect(rukumWest?.provinceCode).toBe(6);
    });
  });

  describe('Municipality types', () => {
    it('has exactly 4 types (post-2017 federalism tiers)', () => {
      expect(NEPAL_MUNICIPALITY_TYPES).toHaveLength(4);
    });

    it('contains the canonical 4 tiers', () => {
      expect([...NEPAL_MUNICIPALITY_TYPES].sort()).toEqual(
        ['metropolitan', 'municipality', 'rural_municipality', 'sub_metropolitan'].sort(),
      );
    });
  });

  describe('Helper: findNepalProvince', () => {
    it('returns the province for a valid code', () => {
      expect(findNepalProvince(3)?.nameEn).toBe('Bagmati');
    });

    it('returns undefined for an invalid code', () => {
      expect(findNepalProvince(99 as unknown as NepalProvinceCode)).toBeUndefined();
    });
  });

  describe('Helper: findNepalDistrict', () => {
    it('returns the district for a valid CEHRD code', () => {
      const k = findNepalDistrict('30');
      expect(k?.nameEn).toBe('Kathmandu');
      expect(k?.provinceCode).toBe(3);
    });

    it('returns undefined for an unknown code', () => {
      expect(findNepalDistrict('99')).toBeUndefined();
    });

    it('does not match unpadded codes (must be zero-padded)', () => {
      // CEHRD format is always 2-digit zero-padded; '1' is not a valid input.
      expect(findNepalDistrict('1')).toBeUndefined();
    });
  });

  describe('Helper: nepalDistrictsForProvince', () => {
    it('returns 14 districts for Koshi (P1)', () => {
      expect(nepalDistrictsForProvince(1)).toHaveLength(14);
    });

    it('returns 13 districts for Bagmati (P3) including Kathmandu', () => {
      const ds = nepalDistrictsForProvince(3);
      expect(ds).toHaveLength(13);
      expect(ds.some((d) => d.nameEn === 'Kathmandu')).toBe(true);
    });

    it('returns 9 districts for Sudurpashchim (P7)', () => {
      expect(nepalDistrictsForProvince(7)).toHaveLength(9);
    });

    it('returns empty array for an invalid province code', () => {
      expect(nepalDistrictsForProvince(99 as unknown as NepalProvinceCode)).toEqual([]);
    });

    it('preserves CEHRD canonical East-to-West ordering within a province', () => {
      // Koshi 01..14 in declared order; first should be Taplejung, last Udayapur.
      const koshi = nepalDistrictsForProvince(1);
      expect(koshi[0]?.nameEn).toBe('Taplejung');
      expect(koshi[koshi.length - 1]?.nameEn).toBe('Udayapur');
    });
  });
});
