/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Finance Entity Definitions
 * 
 * Entities: TuitionConfiguration, StudentBillingAccount, Invoice, Payment
 * 
 * Uses shared types from @edforge/shared-types for consistency
 */

import type {
  TuitionConfiguration,
  StudentBillingAccount,
  Invoice,
  Payment,
  BaseEntity
} from '@edforge/shared-types';

// Re-export for convenience
export type {
  TuitionConfiguration,
  StudentBillingAccount,
  Invoice,
  Payment,
  BaseEntity
} from '@edforge/shared-types';

// Extended entities with GSI keys (internal use only)
export interface TuitionConfigurationWithGSI extends TuitionConfiguration {
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
}

export interface StudentBillingAccountWithGSI extends StudentBillingAccount {
  gsi2pk: string;
  gsi2sk: string;
  gsi7pk: string;
  gsi7sk: string;
}

export interface InvoiceWithGSI extends Invoice {
  gsi2pk: string;
  gsi2sk: string;
  gsi7pk: string;
  gsi7sk: string;
  gsi10pk?: string;
  gsi10sk?: string;
}

export interface PaymentWithGSI extends Payment {
  gsi7pk: string;
  gsi7sk: string;
}

