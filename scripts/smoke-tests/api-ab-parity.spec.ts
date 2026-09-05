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

  it('treats the error envelope timestamp as volatile', () => {
    expect(canonical({ statusCode: 404, timestamp: '2026-09-04T23:12:48.663Z' })).toEqual({ statusCode: 404 });
  });

  it('compares a presigned URL by object, not by signature', () => {
    const a = 'https://b.s3.ap-south-1.amazonaws.com/t/x.png?X-Amz-Credential=A&X-Amz-Signature=111';
    const b = 'https://b.s3.ap-south-1.amazonaws.com/t/x.png?X-Amz-Credential=B&X-Amz-Signature=222';
    expect(canonical({ urls: { logo: a } })).toEqual(canonical({ urls: { logo: b } }));
    expect(canonical('https://example.com/?q=1')).toBe('https://example.com/?q=1');
  });

  it('compares a pagination cursor by its decoded key, whatever the attribute order', () => {
    const one = Buffer.from(JSON.stringify({ entityKey: 'STUDENT#1', tenantId: 't', gsi1sk: 'S#A' })).toString('base64');
    const two = Buffer.from(JSON.stringify({ tenantId: 't', gsi1sk: 'S#A', entityKey: 'STUDENT#1' })).toString('base64');
    expect(canonical({ lastEvaluatedKey: one })).toEqual(canonical({ lastEvaluatedKey: two }));
    const other = Buffer.from(JSON.stringify({ entityKey: 'STUDENT#2', tenantId: 't' })).toString('base64');
    expect(canonical({ lastEvaluatedKey: one })).not.toEqual(canonical({ lastEvaluatedKey: other }));
    expect(canonical({ cursor: 'not-base64-json' })).toEqual({ cursor: 'not-base64-json' });
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
