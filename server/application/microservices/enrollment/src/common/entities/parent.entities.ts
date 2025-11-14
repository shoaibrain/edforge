/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Parent Entity Definition
 * 
 * Uses shared types from @edforge/shared-types for consistency
 */

import type { Parent, BaseEntity } from '@edforge/shared-types';

// Re-export for convenience
export type { Parent, BaseEntity } from '@edforge/shared-types';

// Extended entity with GSI keys (internal use only)
export interface ParentWithGSI extends Parent {
  gsi7pk?: string;
  gsi7sk?: string;
  gsi9pk: string;
  gsi9sk: string;
  gsi12pk?: string;
  gsi12sk?: string;
}

