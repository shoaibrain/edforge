/**
 * Gateway Adapter Registry
 *
 * Maps gateway names to their concrete adapter implementations.
 * Adapters are registered at construction time via DI.
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { GatewayAdapter } from './gateway-adapter.interface';
import { EsewaAdapter } from './esewa.adapter';
import { KhaltiAdapter } from './khalti.adapter';

@Injectable()
export class GatewayAdapterRegistryService {
  private readonly logger = new Logger(GatewayAdapterRegistryService.name);
  private readonly adapters = new Map<string, GatewayAdapter>();

  constructor(
    private readonly esewaAdapter: EsewaAdapter,
    private readonly khaltiAdapter: KhaltiAdapter,
  ) {
    this.register(esewaAdapter);
    this.register(khaltiAdapter);
    this.logger.log(`Registered gateway adapters: ${[...this.adapters.keys()].join(', ')}`);
  }

  private register(adapter: GatewayAdapter): void {
    this.adapters.set(adapter.gatewayName, adapter);
  }

  getAdapter(gatewayName: string): GatewayAdapter {
    const adapter = this.adapters.get(gatewayName);
    if (!adapter) {
      throw new BadRequestException(
        `No adapter registered for gateway '${gatewayName}'. ` +
        `Supported: ${[...this.adapters.keys()].join(', ')}`,
      );
    }
    return adapter;
  }

  hasAdapter(gatewayName: string): boolean {
    return this.adapters.has(gatewayName);
  }
}
