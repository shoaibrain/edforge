import { SetMetadata } from '@nestjs/common';

export const CACHE_TTL_KEY = 'cache_ttl_seconds';

/**
 * Sets Cache-Control: private, max-age=<seconds> on GET responses.
 * Must be used with CacheHeaderInterceptor.
 */
export const CacheTTL = (seconds: number) =>
  SetMetadata(CACHE_TTL_KEY, seconds);
