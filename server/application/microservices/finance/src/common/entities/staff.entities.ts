/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Staff Entity Definition
 * 
 * Uses shared types from @edforge/shared-types for consistency
 */

import type { Staff, BaseEntity } from '@edforge/shared-types';

// Re-export for convenience
export type { Staff, BaseEntity } from '@edforge/shared-types';

// Extended entity with GSI keys (internal use only)
export interface StaffWithGSI extends Staff {
  gsi1pk: string;
  gsi1sk: string;
  gsi8pk: string;
  gsi8sk: string;
  gsi11pk?: string;
  gsi11sk?: string;
}

