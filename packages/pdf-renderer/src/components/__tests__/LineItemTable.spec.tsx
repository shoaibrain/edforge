/**
 * Unit specs for LineItemTable — focused on the deterministic-column-ordering
 * contract documented in COLUMN_RENDER_ORDER + REQUIRED_COLUMNS.
 *
 * The render-smoke specs cover end-to-end PDF emission; these specs assert
 * the table-construction contract (required columns are never dropped, order
 * is stable) without bringing up the whole renderer.
 */

import * as React from 'react';
import * as renderer from 'react-test-renderer';
import { LineItemTable, type LineItemColumns } from '../LineItemTable';
import { formatNumber } from '../../core/format';

const HEADERS = {
  description: 'Description',
  quantity: 'Qty',
  amount: 'Amount',
  discount: 'Discount',
  taxRate: 'Tax %',
  taxAmount: 'Tax',
  total: 'Total',
};

const SAMPLE_ITEM = {
  description: 'Tuition',
  quantity: 1,
  amount: 1000,
  discount: 0,
  taxRate: 0,
  taxAmount: 0,
  total: 1000,
};

function getHeaderTexts(tree: renderer.ReactTestRendererJSON): string[] {
  // The table emits header cells inside the FIRST row. Each cell is a <Text>
  // whose children prop is the header label string. We walk the tree at one
  // level of nesting to collect them.
  const headers: string[] = [];
  const findHeaders = (node: renderer.ReactTestRendererJSON | string): void => {
    if (typeof node === 'string') return;
    // Header row is the first child View of the table container.
    if (node.type === 'TEXT' && typeof node.children?.[0] === 'string') {
      // Skip non-header text — header collector is invoked only for header row.
      headers.push(node.children[0]);
      return;
    }
    (node.children ?? []).forEach((child) => {
      if (typeof child !== 'string') findHeaders(child);
    });
  };
  // The table is structured: TABLE_VIEW > HEADER_VIEW > N x TEXT_HEADERS, BODY_ROWS...
  // We walk only the first child (the header row) to collect labels.
  const tableChildren = tree.children ?? [];
  if (tableChildren.length > 0 && typeof tableChildren[0] !== 'string') {
    findHeaders(tableChildren[0] as renderer.ReactTestRendererJSON);
  }
  return headers;
}

describe('LineItemTable column ordering and required-column enforcement', () => {
  it('renders ALL columns in COLUMN_RENDER_ORDER when all toggles are true', () => {
    const allOn: LineItemColumns = {
      description: true,
      quantity: true,
      amount: true,
      discount: true,
      taxRate: true,
      taxAmount: true,
      total: true,
    };
    const tree = renderer
      .create(
        <LineItemTable
          items={[SAMPLE_ITEM]}
          columns={allOn}
          headers={HEADERS}
          renderNumber={(v) => (v === undefined ? '' : formatNumber(v, 'south-asian'))}
        />,
      )
      .toJSON() as renderer.ReactTestRendererJSON;

    expect(getHeaderTexts(tree)).toEqual([
      'Description',
      'Qty',
      'Amount',
      'Discount',
      'Tax %',
      'Tax',
      'Total',
    ]);
  });

  it('omits optional columns whose toggle is false (quantity, discount, tax)', () => {
    const minimal: LineItemColumns = {
      description: true,
      quantity: false,
      amount: true,
      discount: false,
      taxRate: false,
      taxAmount: false,
      total: true,
    };
    const tree = renderer
      .create(
        <LineItemTable
          items={[SAMPLE_ITEM]}
          columns={minimal}
          headers={HEADERS}
          renderNumber={(v) => (v === undefined ? '' : formatNumber(v, 'south-asian'))}
        />,
      )
      .toJSON() as renderer.ReactTestRendererJSON;

    expect(getHeaderTexts(tree)).toEqual(['Description', 'Amount', 'Total']);
  });

  it('FORCES description/amount/total to render even when toggles are false', () => {
    // This is the invariant CodeRabbit caught: required columns must NEVER
    // disappear, regardless of what the caller passes for their toggle.
    const malformed: LineItemColumns = {
      description: false, // attempted hide
      quantity: false,
      amount: false, // attempted hide
      discount: false,
      taxRate: false,
      taxAmount: false,
      total: false, // attempted hide
    };
    const tree = renderer
      .create(
        <LineItemTable
          items={[SAMPLE_ITEM]}
          columns={malformed}
          headers={HEADERS}
          renderNumber={(v) => (v === undefined ? '' : formatNumber(v, 'south-asian'))}
        />,
      )
      .toJSON() as renderer.ReactTestRendererJSON;

    expect(getHeaderTexts(tree)).toEqual(['Description', 'Amount', 'Total']);
  });

  it('column order matches COLUMN_RENDER_ORDER regardless of LineItemColumns key insertion order', () => {
    // Even if the caller constructs the columns object with keys in a different
    // order (e.g., taxAmount first), the render order stays canonical.
    const shuffled = {
      taxAmount: true,
      discount: true,
      description: true,
      total: true,
      quantity: true,
      taxRate: true,
      amount: true,
    } as unknown as LineItemColumns;

    const tree = renderer
      .create(
        <LineItemTable
          items={[SAMPLE_ITEM]}
          columns={shuffled}
          headers={HEADERS}
          renderNumber={(v) => (v === undefined ? '' : formatNumber(v, 'south-asian'))}
        />,
      )
      .toJSON() as renderer.ReactTestRendererJSON;

    expect(getHeaderTexts(tree)).toEqual([
      'Description',
      'Qty',
      'Amount',
      'Discount',
      'Tax %',
      'Tax',
      'Total',
    ]);
  });
});
