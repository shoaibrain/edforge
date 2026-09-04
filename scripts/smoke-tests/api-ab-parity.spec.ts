import { canonical, firstDifference } from './api-ab-parity';

describe('api-ab-parity — canonical form', () => {
  it('sorts keys at every level and drops the volatile ones', () => {
    const a = canonical({ b: 1, a: { z: [{ y: 2, x: 1 }], requestId: 'r1' }, generatedAt: 'now' });
    const b = canonical({ a: { z: [{ x: 1, y: 2 }], requestId: 'r2' }, b: 1, generatedAt: 'later' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe('{"a":{"z":[{"x":1,"y":2}]},"b":1}');
  });

  it('leaves scalars and arrays of scalars alone', () => {
    expect(canonical([3, 'x', null, true])).toEqual([3, 'x', null, true]);
    expect(canonical('s')).toBe('s');
  });
});

describe('api-ab-parity — first difference', () => {
  it('reports null for equal values', () => {
    expect(firstDifference({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBeNull();
  });

  it('names the path of the first differing scalar, array length or key set', () => {
    expect(firstDifference({ a: [1, { b: 'x' }] }, { a: [1, { b: 'y' }] })).toBe('$.a[1].b: "x" vs "y"');
    expect(firstDifference({ items: [1, 2] }, { items: [1] })).toBe('$.items.length 2 vs 1');
    expect(firstDifference({ a: 1 }, { a: 1, extra: true })).toBe('$ keys differ: extra');
    expect(firstDifference(1, '1')).toBe('$: 1 vs "1"');
  });
});
