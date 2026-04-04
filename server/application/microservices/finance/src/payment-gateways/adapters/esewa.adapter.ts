/**
 * eSewa ePay v2 Adapter
 *
 * Implements the eSewa payment gateway using their ePay v2 API.
 * eSewa uses an HTML form POST — the frontend auto-submits a hidden form.
 *
 * Test environment:
 *   Form URL: https://rc-epay.esewa.com.np/api/epay/main/v2/form
 *   Verify URL: https://uat.esewa.com.np/api/epay/transaction/status/
 *   Credentials: configured via GatewayConfig entity (never hardcoded)
 *
 * Production environment:
 *   Form URL: https://epay.esewa.com.np/api/epay/main/v2/form
 *   Verify URL: https://epay.esewa.com.np/api/epay/transaction/status/
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { HttpClientService } from '@app/http-client';
import type {
  GatewayAdapter,
  GatewayInitiateInput,
  GatewayInitiateResult,
  GatewayVerifyInput,
  GatewayVerifyResult,
} from './gateway-adapter.interface';
import type { GatewayConfigEntity } from '../../common/entities/gateway-config.entity';

const ESEWA_URLS = {
  test: {
    form: 'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
    verify: 'https://uat.esewa.com.np/api/epay/transaction/status/',
  },
  production: {
    form: 'https://epay.esewa.com.np/api/epay/main/v2/form',
    verify: 'https://epay.esewa.com.np/api/epay/transaction/status/',
  },
};

@Injectable()
export class EsewaAdapter implements GatewayAdapter {
  readonly gatewayName = 'esewa';
  private readonly logger = new Logger(EsewaAdapter.name);

  constructor(private readonly httpClient: HttpClientService) {}

  async initiatePayment(
    input: GatewayInitiateInput,
    config: GatewayConfigEntity,
  ): Promise<GatewayInitiateResult> {
    const urls = config.isTestMode ? ESEWA_URLS.test : ESEWA_URLS.production;
    const secretKey = config.credentials.secretKey;
    const productCode = config.credentials.merchantCode;

    const totalAmount = input.amount + input.taxAmount;

    // Generate HMAC-SHA256 signature
    // Signed message format: "total_amount=X,transaction_uuid=Y,product_code=Z"
    const signedFieldNames = 'total_amount,transaction_uuid,product_code';
    const signedMessage = `total_amount=${totalAmount},transaction_uuid=${input.transactionId},product_code=${productCode}`;
    const signature = createHmac('sha256', secretKey)
      .update(signedMessage)
      .digest('base64');

    const formData: Record<string, string> = {
      amount: String(input.amount),
      tax_amount: String(input.taxAmount),
      total_amount: String(totalAmount),
      transaction_uuid: input.transactionId,
      product_code: productCode,
      product_service_charge: '0',
      product_delivery_charge: '0',
      success_url: input.successUrl,
      failure_url: input.failureUrl,
      signed_field_names: signedFieldNames,
      signature,
    };

    this.logger.log(
      `eSewa payment initiated: txn=${input.transactionId}, amount=${totalAmount}, ` +
      `mode=${config.isTestMode ? 'test' : 'production'}`,
    );

    return {
      redirectUrl: urls.form,
      formData,
      method: 'form_post',
      gatewaySessionId: input.transactionId, // eSewa uses our transaction_uuid
    };
  }

  async verifyPayment(
    input: GatewayVerifyInput,
    config: GatewayConfigEntity,
  ): Promise<GatewayVerifyResult> {
    const urls = config.isTestMode ? ESEWA_URLS.test : ESEWA_URLS.production;
    const productCode = config.credentials.merchantCode;
    const secretKey = config.credentials.secretKey;

    try {
      // Step 1: Verify the callback signature if callback data has base64-encoded response
      if (input.callbackData.data) {
        const decoded = JSON.parse(
          Buffer.from(input.callbackData.data, 'base64').toString('utf-8'),
        );

        // Verify signature from callback
        const signedFieldNames = decoded.signed_field_names;
        if (signedFieldNames) {
          const fields = signedFieldNames.split(',');
          const signedMessage = fields.map((f: string) => `${f}=${decoded[f]}`).join(',');
          const expectedSig = createHmac('sha256', secretKey)
            .update(signedMessage)
            .digest('base64');

          if (expectedSig !== decoded.signature) {
            this.logger.warn(`eSewa signature mismatch for ${input.transactionId}`);
            return {
              success: false,
              status: 'failed',
              failureReason: 'Signature verification failed',
              rawResponse: decoded,
            };
          }
        }
      }

      // Step 2: Server-side verification via eSewa transaction status API
      const response = await this.httpClient.get<{
        status: string;
        transaction_code?: string;
        total_amount: number;
        ref_id?: string;
      }>(
        urls.verify,
        {
          params: {
            product_code: productCode,
            total_amount: input.amount,
            transaction_uuid: input.transactionId,
          },
        },
      );

      const data = response.data;
      const esewaStatus = (data.status || '').toUpperCase();

      if (esewaStatus === 'COMPLETE') {
        // Verify amount matches what we sent
        if (data.total_amount != null && data.total_amount !== input.amount) {
          this.logger.warn(
            `eSewa amount mismatch for ${input.transactionId}: ` +
            `expected ${input.amount}, got ${data.total_amount}`,
          );
          return {
            success: false,
            status: 'failed',
            failureReason: `Amount mismatch: expected ${input.amount}, got ${data.total_amount}`,
            rawResponse: data as unknown as Record<string, unknown>,
          };
        }

        this.logger.log(
          `eSewa payment verified: txn=${input.transactionId}, ref=${data.ref_id || data.transaction_code}`,
        );
        return {
          success: true,
          status: 'completed',
          gatewayTransactionId: data.ref_id || data.transaction_code,
          rawResponse: data as unknown as Record<string, unknown>,
        };
      }

      const statusMap: Record<string, GatewayVerifyResult['status']> = {
        PENDING: 'pending',
        CANCELED: 'cancelled',
        AMBIGUOUS: 'pending',
        NOT_FOUND: 'failed',
        FULL_REFUND: 'failed',
        PARTIAL_REFUND: 'failed',
      };

      this.logger.warn(`eSewa payment not complete: txn=${input.transactionId}, status=${esewaStatus}`);
      return {
        success: false,
        status: statusMap[esewaStatus] || 'failed',
        failureReason: `eSewa status: ${esewaStatus}`,
        rawResponse: data as unknown as Record<string, unknown>,
      };
    } catch (error: any) {
      this.logger.error(`eSewa verification failed for ${input.transactionId}: ${error.message}`);
      return {
        success: false,
        status: 'failed',
        failureReason: `eSewa API error: ${error.message}`,
      };
    }
  }
}
