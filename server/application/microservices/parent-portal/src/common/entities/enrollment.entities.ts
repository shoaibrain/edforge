/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Enrollment Service - Entity Definitions
 * 
 * Entities: Student, Enrollment
 * 
 * Uses shared types from @edforge/shared-types for consistency
 */

import type { Student, Enrollment, BaseEntity } from '@edforge/shared-types';

// Re-export for convenience
export type { Student, Enrollment, BaseEntity } from '@edforge/shared-types';

// Extended entities with GSI keys (internal use only - not exposed via API)
// These are used internally for DynamoDB operations but not returned in API responses
export interface StudentWithGSI extends Student {
  gsi1pk: string;
  gsi1sk: string;
  gsi7pk: string;
  gsi7sk: string;
}

export interface EnrollmentWithGSI extends Enrollment {
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  gsi7pk: string;
  gsi7sk: string;
}

