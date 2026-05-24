import * as React from 'react';
import {
  registerDescriptor,
  getDescriptor,
  getRegisteredDocTypes,
  hasDescriptor,
  _clearRegistryForTest,
} from '../registry';
import type { TemplateDescriptor, PdfTemplateConfig, DocType } from '../types';

// ----- Test fixtures --------------------------------------------------------

interface FakeData {
  invoiceNumber: string;
  total: number;
}

interface FakeConfig extends PdfTemplateConfig {
  extra: boolean;
}

const FAKE_CONFIG_DEFAULTS: FakeConfig = {
  pageSize: 'A4',
  orientation: 'portrait',
  margins: { top: 15, right: 15, bottom: 15, left: 15 },
  header: {
    showLogo: true,
    showSchoolName: true,
    showSchoolAddress: true,
    showContact: true,
  },
  footer: { showPageNumbers: true },
  dateFormat: 'gregorian',
  numberFormat: 'auto-from-workspace',
  currencyDisplay: 'symbol',
  labelLanguages: ['en'],
  extra: false,
};

function buildFakeDescriptor(
  docType: DocType,
): TemplateDescriptor<FakeData, FakeConfig> {
  return {
    docType,
    i18nNamespace: docType.toLowerCase(),
    Component: () => null,
    defaults: () => FAKE_CONFIG_DEFAULTS,
    sampleData: () => ({ invoiceNumber: 'SAMPLE-1', total: 0 }),
    configurableFields: [
      {
        path: 'pageSize',
        type: 'select',
        labelKey: 'editor.pageSize',
        options: ['A4', 'A5', 'LETTER'],
      },
    ],
  };
}

// ----- Specs ---------------------------------------------------------------

describe('descriptor registry', () => {
  beforeEach(() => {
    _clearRegistryForTest();
  });

  describe('registerDescriptor + getDescriptor', () => {
    it('registers and retrieves a descriptor by docType', () => {
      const descriptor = buildFakeDescriptor('INVOICE');
      registerDescriptor(descriptor);
      expect(getDescriptor('INVOICE')).toBe(descriptor);
    });

    it('preserves the descriptor reference (not a copy)', () => {
      const descriptor = buildFakeDescriptor('RECEIPT');
      registerDescriptor(descriptor);
      const retrieved = getDescriptor('RECEIPT');
      expect(retrieved.Component).toBe(descriptor.Component);
      expect(retrieved.configurableFields).toBe(descriptor.configurableFields);
    });

    it('supports multiple docType registrations independently', () => {
      const invoice = buildFakeDescriptor('INVOICE');
      const receipt = buildFakeDescriptor('RECEIPT');
      const reportCard = buildFakeDescriptor('REPORT_CARD');
      registerDescriptor(invoice);
      registerDescriptor(receipt);
      registerDescriptor(reportCard);
      expect(getDescriptor('INVOICE')).toBe(invoice);
      expect(getDescriptor('RECEIPT')).toBe(receipt);
      expect(getDescriptor('REPORT_CARD')).toBe(reportCard);
    });
  });

  describe('duplicate registration', () => {
    it('throws when the same docType is registered twice', () => {
      const first = buildFakeDescriptor('INVOICE');
      const second = buildFakeDescriptor('INVOICE');
      registerDescriptor(first);
      expect(() => registerDescriptor(second)).toThrow(/Duplicate descriptor registration/);
      expect(() => registerDescriptor(second)).toThrow(/INVOICE/);
    });

    it('rejection leaves the first registration intact', () => {
      const first = buildFakeDescriptor('INVOICE');
      const second = buildFakeDescriptor('INVOICE');
      registerDescriptor(first);
      try {
        registerDescriptor(second);
      } catch {
        /* expected */
      }
      expect(getDescriptor('INVOICE')).toBe(first);
    });
  });

  describe('getDescriptor on unknown docType', () => {
    it('throws with a helpful message listing known docTypes', () => {
      registerDescriptor(buildFakeDescriptor('INVOICE'));
      registerDescriptor(buildFakeDescriptor('RECEIPT'));
      expect(() => getDescriptor('REPORT_CARD')).toThrow(/No descriptor registered/);
      expect(() => getDescriptor('REPORT_CARD')).toThrow(/REPORT_CARD/);
      expect(() => getDescriptor('REPORT_CARD')).toThrow(/INVOICE, RECEIPT/);
    });

    it('throws with "(none)" when registry is empty', () => {
      expect(() => getDescriptor('INVOICE')).toThrow(/\(none\)/);
    });
  });

  describe('getRegisteredDocTypes + hasDescriptor', () => {
    it('getRegisteredDocTypes returns empty array on an empty registry', () => {
      expect(getRegisteredDocTypes()).toEqual([]);
    });

    it('getRegisteredDocTypes returns docTypes in registration order', () => {
      registerDescriptor(buildFakeDescriptor('RECEIPT'));
      registerDescriptor(buildFakeDescriptor('INVOICE'));
      registerDescriptor(buildFakeDescriptor('REPORT_CARD'));
      expect(getRegisteredDocTypes()).toEqual(['RECEIPT', 'INVOICE', 'REPORT_CARD']);
    });

    it('getRegisteredDocTypes returns a snapshot — mutating the result does not affect the registry', () => {
      registerDescriptor(buildFakeDescriptor('INVOICE'));
      const snapshot = getRegisteredDocTypes() as DocType[];
      snapshot.push('REPORT_CARD');
      expect(getRegisteredDocTypes()).toEqual(['INVOICE']);
    });

    it('hasDescriptor returns true only for registered docTypes', () => {
      expect(hasDescriptor('INVOICE')).toBe(false);
      registerDescriptor(buildFakeDescriptor('INVOICE'));
      expect(hasDescriptor('INVOICE')).toBe(true);
      expect(hasDescriptor('RECEIPT')).toBe(false);
    });
  });

  describe('descriptor contract — defaults() + sampleData() callable', () => {
    it('calls defaults(archetype, locale) to produce config', () => {
      const descriptor = buildFakeDescriptor('INVOICE');
      registerDescriptor(descriptor);
      const config = getDescriptor('INVOICE').defaults('PABSON', 'ne-NP');
      expect(config.pageSize).toBe('A4');
      expect(config.labelLanguages).toEqual(['en']);
    });

    it('calls sampleData(archetype, locale) to produce mock data', () => {
      const descriptor = buildFakeDescriptor('INVOICE');
      registerDescriptor(descriptor);
      const data = getDescriptor<FakeData, FakeConfig>('INVOICE').sampleData('PABSON', 'ne-NP');
      expect(data.invoiceNumber).toBe('SAMPLE-1');
    });
  });

  describe('configurableFields metadata is preserved', () => {
    it('exposes configurableFields exactly as declared', () => {
      const descriptor = buildFakeDescriptor('INVOICE');
      registerDescriptor(descriptor);
      const fields = getDescriptor('INVOICE').configurableFields;
      expect(fields).toHaveLength(1);
      expect(fields[0]).toMatchObject({
        path: 'pageSize',
        type: 'select',
        labelKey: 'editor.pageSize',
        options: ['A4', 'A5', 'LETTER'],
      });
    });
  });
});
