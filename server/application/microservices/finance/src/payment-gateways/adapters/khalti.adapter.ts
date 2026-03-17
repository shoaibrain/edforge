/**
 * Khalti ePay Adapter
 *
 * Implements the Khalti payment gateway using their ePay v2 API.
 * Khalti uses a server-to-server REST call — the backend gets a redirect URL.
 *
 * Test environment:
 *   Initiate: https://dev.khalti.com/api/v2/epayment/initiate/
 *   Lookup:   https://dev.khalti.com/api/v2/epayment/lookup/
 *   Auth: Authorization: Key <live_secret_key>
 *   Test credentials: see Khalti developer docs
 *
 * Production environment:
 *   Initiate: https://khalti.com/api/v2/epayment/initiate/
 *   Lookup:   https://khalti.com/api/v2/epayment/lookup/
 *
 * Important: Khalti amounts are in PAISA (1 NPR = 100 paisa)
 */

import { Injectable, Logger } from '@nestjs/common';
import { HttpClientService } from '@app/http-client';
import type {
  GatewayAdapter,
  GatewayInitiateInput,
  GatewayInitiateResult,
  GatewayVerifyInput,
  GatewayVerifyResult,
} from './gateway-adapter.interface';
import type { GatewayConfigEntity } from '../../common/entities/gateway-config.entity';

const KHALTI_URLS = {
  test: {
    initiate: 'https://dev.khalti.com/api/v2/epayment/initiate/',
    lookup: 'https://dev.khalti.com/api/v2/epayment/lookup/',
  },
  production: {
    initiate: 'https://khalti.com/api/v2/epayment/initiate/',
    lookup: 'https://khalti.com/api/v2/epayment/lookup/',
  },
};

@Injectable()
export class KhaltiAdapter implements GatewayAdapter {
  readonly gatewayName = 'khalti';
  private readonly logger = new Logger(KhaltiAdapter.name);

  constructor(private readonly httpClient: HttpClientService) {}

  async initiatePayment(
    input: GatewayInitiateInput,
    config: GatewayConfigEntity,
  ): Promise<GatewayInitiateResult> {
    const urls = config.isTestMode ? KHALTI_URLS.test : KHALTI_URLS.production;
    const secretKey = config.credentials.secretKey;

    // Khalti amount is in paisa (1 NPR = 100 paisa)
    const amountInPaisa = Math.round(input.amount * 100);

    try {
      const response = await this.httpClient.post<{
        pidx: string;
        payment_url: string;
        expires_at: string;
        expires_in: number;
      }>(
        urls.initiate,
        {
          return_url: input.successUrl,
          website_url: process.env.FRONTEND_URL || 'https://edforge.app',
          amount: amountInPaisa,
          purchase_order_id: input.transactionId,
          purchase_order_name: input.productName,
        },
        {
          headers: {
            Authorization: `Key ${secretKey}`,
          },
        },
      );

      const data = response.data;

      this.logger.log(
        `Khalti payment initiated: txn=${input.transactionId}, pidx=${data.pidx}, ` +
        `amount=${amountInPaisa} paisa, mode=${config.isTestMode ? 'test' : 'production'}`,
      );

      return {
        redirectUrl: data.payment_url,
        method: 'redirect',
        gatewaySessionId: data.pidx,
        expiresAt: data.expires_at,
      };
    } catch (error: any) {
      this.logger.error(
        `Khalti initiation failed for ${input.transactionId}: ${error.message}`,
        error.response?.data,
      );
      throw new Error(
        `Khalti payment initiation failed: ${error.response?.data?.detail || error.message}`,
      );
    }
  }

  async verifyPayment(
    input: GatewayVerifyInput,
    config: GatewayConfigEntity,
  ): Promise<GatewayVerifyResult> {
    const urls = config.isTestMode ? KHALTI_URLS.test : KHALTI_URLS.production;
    const secretKey = config.credentials.secretKey;

    // Khalti sends pidx in the callback URL as a query param
    const pidx = input.callbackData.pidx;

    if (!pidx) {
      return {
        success: false,
        status: 'failed',
        failureReason: 'Missing pidx in callback data',
      };
    }

    try {
      const response = await this.httpClient.post<{
        pidx: string;
        total_amount: number;
        status: string;
        transaction_id: string | null;
        fee: number;
        refunded: boolean;
      }>(
        urls.lookup,
        { pidx },
        {
          headers: {
            Authorization: `Key ${secretKey}`,
          },
        },
      );

      const data = response.data;
      const khaltiStatus = (data.status || '').toLowerCase();

      if (khaltiStatus === 'completed') {
        // Verify amount matches (Khalti returns amount in paisa)
        const expectedPaisa = Math.round(input.amount * 100);
        if (data.total_amount !== expectedPaisa) {
          this.logger.warn(
            `Khalti amount mismatch for ${input.transactionId}: ` +
            `expected ${expectedPaisa}, got ${data.total_amount}`,
          );
          return {
            success: false,
            status: 'failed',
            failureReason: `Amount mismatch: expected ${expectedPaisa} paisa, got ${data.total_amount} paisa`,
            rawResponse: data as unknown as Record<string, unknown>,
          };
        }

        this.logger.log(
          `Khalti payment verified: txn=${input.transactionId}, khalti_txn=${data.transaction_id}`,
        );
        return {
          success: true,
          status: 'completed',
          gatewayTransactionId: data.transaction_id || data.pidx,
          rawResponse: data as unknown as Record<string, unknown>,
        };
      }

      const statusMap: Record<string, GatewayVerifyResult['status']> = {
        pending: 'pending',
        initiated: 'pending',
        expired: 'failed',
        'user canceled': 'cancelled',
        refunded: 'failed',
      };

      this.logger.warn(`Khalti payment not complete: txn=${input.transactionId}, status=${data.status}`);
      return {
        success: false,
        status: statusMap[khaltiStatus] || 'failed',
        failureReason: `Khalti status: ${data.status}`,
        rawResponse: data as unknown as Record<string, unknown>,
      };
    } catch (error: any) {
      this.logger.error(`Khalti verification failed for ${input.transactionId}: ${error.message}`);
      return {
        success: false,
        status: 'failed',
        failureReason: `Khalti API error: ${error.message}`,
      };
    }
  }
}
