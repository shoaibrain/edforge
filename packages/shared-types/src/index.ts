/**
 * @aibrains/shared-types
 * 
 * Shared Zod schemas, TypeScript types, and validators for EdForge monorepo.
 * 
 * This package is the SINGLE SOURCE OF TRUTH for data validation and types
 * used by both frontend and backend.
 * 
 * ## Usage
 * 
 * ```typescript
 * // Import schemas for validation
 * import { 
 *   updateUserSchema, 
 *   passwordSchema,
 *   loginSchema 
 * } from '@aibrains/shared-types';
 * 
 * // Import inferred types
 * import type { 
 *   UpdateUserDto,
 *   LoginDto,
 *   UserResponseDto 
 * } from '@aibrains/shared-types';
 * 
 * // Validate data
 * const result = updateUserSchema.safeParse(userData);
 * if (!result.success) {
 *   console.log(result.error.flatten());
 * }
 * ```
 * 
 * ## Backend (NestJS) Usage
 * 
 * ```typescript
 * import { createZodDto } from 'nestjs-zod';
 * import { updateUserSchema } from '@aibrains/shared-types';
 * 
 * class UpdateUserDtoClass extends createZodDto(updateUserSchema) {}
 * ```
 */

// Re-export Zod for convenience
export { z } from 'zod';
export type { ZodSchema, ZodType, ZodError } from 'zod';

// ============================================
// Validators
// ============================================

export * from './validators';

// ============================================
// All Schemas and Types
// ============================================

export * from './schemas';

// ============================================
// Ed-Fi Mappers (for compliance export)
// ============================================

export * from './mappers';

// ============================================
// Utility Functions
// ============================================

export { formatNPR } from './utils/currency';

// ============================================
// Legacy Common Types (for backwards compatibility)
// ============================================

// These are now re-exported from schemas/common.ts
// Keeping explicit exports here for any code that imports directly
export type { 
  BaseEntity,
  RequestContext,
  Address,
  EntityStatus,
  PaginationQuery,
  ErrorResponse,
} from './schemas/common';
