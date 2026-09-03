/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * In-Memory Cache Service Implementation
 * Phase 5: Advanced Features - Cost-Efficient Caching
 * 
 * DESIGN RATIONALE:
 * - Zero infrastructure cost for MVP
 * - Configurable max size prevents memory leaks
 * - Auto-cleanup of expired entries
 * - Thread-safe operations
 * - Easy migration to Redis (same interface)
 */

import { Injectable, Logger } from '@nestjs/common';
import { ICacheService } from './cache.service';
import { isLambdaRuntime } from '@app/common-utils';

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

@Injectable()
export class InMemoryCacheService implements ICacheService {
  private readonly logger = new Logger(InMemoryCacheService.name);
  private readonly cache = new Map<string, CacheEntry<any>>();
  private readonly maxSize: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
    // Start periodic cleanup of expired entries
    this.startCleanup();
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set value in cache with TTL
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    // Enforce max size
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // Remove oldest entry (simple FIFO strategy)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    const expiry = Date.now() + (ttlSeconds * 1000);
    this.cache.set(key, { data: value, expiry });
  }

  /**
   * Delete key from cache
   */
  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  /**
   * Clear cache entries matching pattern
   * Pattern matching: supports * wildcard
   */
  async clear(pattern: string): Promise<void> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    let cleared = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        cleared++;
      }
    }

    this.logger.debug(`Cleared ${cleared} cache entries matching pattern: ${pattern}`);
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanup(): void {
    // No periodic work in Lambda: entries are checked for expiry on read and
    // the environment is recycled by the platform.
    if (isLambdaRuntime()) return;
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired cache entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }

  /**
   * Clear all cache entries
   */
  clearAll(): void {
    this.cache.clear();
    this.logger.debug('All cache entries cleared');
  }
}

