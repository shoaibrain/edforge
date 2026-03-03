/**
 * Internal API Key Guard
 *
 * Validates service-to-service requests using a shared secret.
 * Used on internal webhook endpoints that should not be callable
 * from the public API Gateway.
 */

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  private readonly apiKey: string;

  constructor() {
    this.apiKey = process.env.INTERNAL_API_KEY || '';
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.apiKey) {
      throw new UnauthorizedException('Internal API key not configured');
    }

    const request = context.switchToHttp().getRequest();
    const providedKey = request.headers['x-internal-api-key'];

    if (!providedKey || providedKey !== this.apiKey) {
      throw new UnauthorizedException('Invalid internal API key');
    }

    return true;
  }
}
