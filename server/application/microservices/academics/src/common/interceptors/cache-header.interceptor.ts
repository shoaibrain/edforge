import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { CACHE_TTL_KEY } from '../decorators/cache-ttl.decorator';

/**
 * Reads @CacheTTL(seconds) metadata and sets
 * Cache-Control: private, max-age=<seconds> on GET responses.
 *
 * Uses `private` to prevent shared caches/CDNs from serving
 * cross-tenant data (TVM architecture).
 */
@Injectable()
export class CacheHeaderInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ttl = this.reflector.getAllAndOverride<number | undefined>(
      CACHE_TTL_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (ttl == null) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    if (request.method !== 'GET') {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        response.setHeader('Cache-Control', `private, max-age=${ttl}`);
      }),
    );
  }
}
