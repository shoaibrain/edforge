/**
 * Password Validation - Aligned with AWS Cognito Password Policy
 * 
 * This is the single source of truth for password validation in EdForge.
 * The validation rules here MUST match the Cognito User Pool password policy
 * defined in server/lib/tenant-template/identity-provider.ts:
 * 
 *   passwordPolicy: {
 *     minLength: 8,
 *     requireLowercase: true,
 *     requireUppercase: true,
 *     requireDigits: true,
 *     requireSymbols: true
 *   }
 * 
 * Cognito's default special characters when requireSymbols=true:
 *   ^ $ * . [ ] { } ( ) ? " ! @ # % & / \ , > < ' : ; | _ ~ ` + = -
 * 
 * @see https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-policies.html
 */

import { z } from 'zod';

/**
 * Cognito password requirements configuration
 * Use this for displaying requirements to users
 */
export const COGNITO_PASSWORD_REQUIREMENTS = {
  minLength: 8,
  maxLength: 128,
  requireLowercase: true,
  requireUppercase: true,
  requireDigits: true,
  requireSymbols: true,
  allowedSymbols: `^ $ * . [ ] { } ( ) ? " ! @ # % & / \\ , > < ' : ; | _ ~ \` + = -`,
} as const;

/**
 * Regex pattern for Cognito's allowed special characters
 * Characters: ^ $ * . [ ] { } ( ) ? " ! @ # % & / \ , > < ' : ; | _ ~ ` + = -
 */
const COGNITO_SPECIAL_CHARS_REGEX = /[\^$*.[\]{}()?"!@#%&/\\,><':;|_~`+=-]/;

/**
 * Password schema that validates against Cognito's password policy
 * 
 * Use this schema for:
 * - New password validation in registration
 * - Password change validation
 * - Password reset validation
 */
export const passwordSchema = z
  .string()
  .min(
    COGNITO_PASSWORD_REQUIREMENTS.minLength,
    `Password must be at least ${COGNITO_PASSWORD_REQUIREMENTS.minLength} characters`
  )
  .max(
    COGNITO_PASSWORD_REQUIREMENTS.maxLength,
    `Password must be at most ${COGNITO_PASSWORD_REQUIREMENTS.maxLength} characters`
  )
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit')
  .regex(
    COGNITO_SPECIAL_CHARS_REGEX,
    `Password must contain at least one special character (${COGNITO_PASSWORD_REQUIREMENTS.allowedSymbols})`
  );

/**
 * Validate a password string against Cognito requirements
 * Returns true if valid, false otherwise
 */
export function isValidPassword(password: string): boolean {
  return passwordSchema.safeParse(password).success;
}

/**
 * Validate a password and return detailed error messages
 */
export function validatePassword(password: string): {
  valid: boolean;
  errors: string[];
} {
  const result = passwordSchema.safeParse(password);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.errors.map((e) => e.message),
  };
}

/**
 * Type for a valid password (branded type)
 */
export type ValidPassword = z.infer<typeof passwordSchema>;

