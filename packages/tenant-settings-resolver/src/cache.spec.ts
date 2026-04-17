import { LruTtlCache } from './cache';

describe('LruTtlCache', () => {
  it('returns undefined for missing keys', () => {
    const c = new LruTtlCache<string>();
    expect(c.get('missing')).toBeUndefined();
  });

  it('stores and retrieves values', () => {
    const c = new LruTtlCache<string>();
    c.set('a', 'value-a');
    expect(c.get('a')).toBe('value-a');
  });

  it('expires entries after TTL', () => {
    let now = 1000;
    const c = new LruTtlCache<string>({ ttlMs: 100, now: () => now });
    c.set('a', 'value-a');
    now = 1099;
    expect(c.get('a')).toBe('value-a');
    now = 1100; // boundary: expiresAt <= now → expired
    expect(c.get('a')).toBeUndefined();
  });

  it('refreshes LRU recency on get', () => {
    const c = new LruTtlCache<string>({ maxEntries: 2 });
    c.set('a', '1');
    c.set('b', '2');
    c.get('a'); // a is now most recent
    c.set('c', '3'); // should evict b, not a
    expect(c.get('a')).toBe('1');
    expect(c.get('b')).toBeUndefined();
    expect(c.get('c')).toBe('3');
  });

  it('evicts oldest when full', () => {
    const c = new LruTtlCache<string>({ maxEntries: 2 });
    c.set('a', '1');
    c.set('b', '2');
    c.set('c', '3');
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe('2');
    expect(c.get('c')).toBe('3');
  });

  it('re-inserting an existing key resets TTL + recency', () => {
    let now = 0;
    const c = new LruTtlCache<string>({ ttlMs: 100, now: () => now });
    c.set('a', 'first');
    now = 50;
    c.set('a', 'second'); // reset
    now = 149;
    expect(c.get('a')).toBe('second');
    now = 150;
    expect(c.get('a')).toBeUndefined();
  });

  it('delete drops a single entry', () => {
    const c = new LruTtlCache<string>();
    c.set('a', '1');
    c.delete('a');
    expect(c.get('a')).toBeUndefined();
  });

  it('clear drops all entries', () => {
    const c = new LruTtlCache<string>();
    c.set('a', '1');
    c.set('b', '2');
    c.clear();
    expect(c.size).toBe(0);
  });
});
