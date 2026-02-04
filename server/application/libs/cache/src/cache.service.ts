/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Cache Service Interface
 * Phase 5: Advanced Features - In-Memory Caching Layer (Cost-Efficient)
 * 
 * DESIGN RATIONALE:
 * - Interface abstraction allows easy swap from in-memory to Redis later
 * - In-memory for MVP: $0 infrastructure cost
 * - Redis-ready design for production migration
 */

export interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(pattern: string): Promise<void>;
}

