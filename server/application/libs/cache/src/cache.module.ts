import { Module } from '@nestjs/common';
import { InMemoryCacheService } from './in-memory-cache.service';
import { ICacheService } from './cache.service';

@Module({
  providers: [
    {
      provide: 'ICacheService',
      useClass: InMemoryCacheService
    },
    InMemoryCacheService
  ],
  exports: ['ICacheService', InMemoryCacheService],
})
export class CacheModule {}

