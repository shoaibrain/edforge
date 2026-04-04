/**
 * Internal API Key Guard
 *
 * Validates service-to-service requests using a shared secret.
 * Used on internal webhook endpoints that should not be callable
 * from the public API Gateway.
 */

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalApiKeyGuard.name);
  private readonly apiKey: string;

  constructor() {
    this.apiKey = process.env.INTERNAL_API_KEY || '';
    this.logger.log({ action: 'internal_api_key_guard.init', internalApiKeyConfigured: !!this.apiKey });
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.apiKey) {
      throw new UnauthorizedException('Internal API key not configured');
    }

    const request = context.switchToHttp().getRequest();
    const providedKey = request.headers['x-internal-api-key'];

    if (
      !providedKey ||
      providedKey.length !== this.apiKey.length ||
      !timingSafeEqual(new Uint8Array(Buffer.from(providedKey)), new Uint8Array(Buffer.from(this.apiKey)))
    ) {
      throw new UnauthorizedException('Invalid internal API key');
    }

    return true;
  }
}
