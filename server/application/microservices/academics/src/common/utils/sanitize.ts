/**
 * HTML Sanitization Utilities
 *
 * Strips HTML tags from free-text PII fields to prevent stored XSS.
 * Applied at the DTO-to-entity boundary before persisting to DynamoDB.
 */

/**
 * Strip all HTML tags from a string, preserving text content.
 * Also normalizes common HTML entities.
 */
export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')      // Remove HTML tags
    .replace(/&lt;/g, '<')        // Decode common entities
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .trim();
}

/**
 * Sanitize a string field if it's defined and non-empty.
 */
export function sanitizeField(value: string | undefined): string | undefined {
  if (value === undefined || value === null || value === '') return value;
  return stripHtml(value);
}

/**
 * Sanitize an array of string values.
 */
export function sanitizeStringArray(values: string[] | undefined): string[] | undefined {
  if (!values) return values;
  return values.map(v => stripHtml(v)).filter(v => v.length > 0);
}
