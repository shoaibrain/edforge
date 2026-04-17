/**
 * Tiny LRU + TTL cache for workspace settings.
 *
 * Sized for V1 reality: a single Lambda warm container handles ~50–500
 * tenants per cold-start window. 200-entry LRU + 5-min TTL means:
 *   - Steady-state: each tenant fetched once per 5 minutes per warm container
 *   - Aggregator at 100 events/sec for 50 tenants: <1 DDB GetItem per second total
 *
 * No external dependency (lru-cache would add ~30KB to the Lambda bundle for
 * features we don't need at this scale).
 */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface LruTtlCacheOptions {
  /** Max entries before LRU eviction. Default 200. */
  maxEntries?: number;
  /** TTL in milliseconds. Default 5 minutes. */
  ttlMs?: number;
  /** Injectable clock — tests pass a mockable now(). Default Date.now. */
  now?: () => number;
}

export class LruTtlCache<V> {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly map = new Map<string, Entry<V>>();

  constructor(opts: LruTtlCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 200;
    this.ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
    this.now = opts.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh LRU recency.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      // Re-insert to update LRU position + reset TTL.
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      // Evict oldest (first in insertion order).
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  /** Visibility for diagnostics; not part of the public contract. */
  get size(): number {
    return this.map.size;
  }
}
