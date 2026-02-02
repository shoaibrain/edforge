/**
 * Permission Matcher Utility
 *
 * Matches permission patterns like 'resource:action1,action2' against
 * a specific resource and action pair. Supports wildcards and multi-action patterns.
 *
 * Pattern formats:
 * - 'resource:action'           → exact match
 * - 'resource:action1,action2'  → multi-action match
 * - 'resource:*'                → wildcard action
 * - '*:*'                       → full wildcard
 */

/**
 * Check if a permission pattern matches a given resource and action.
 *
 * @param pattern - Permission pattern (e.g., 'students:view,edit')
 * @param resource - Resource to check (e.g., 'students')
 * @param action - Action to check (e.g., 'view')
 * @returns true if the pattern grants access
 */
export function matchesPermission(pattern: string, resource: string, action: string): boolean {
  if (pattern === '*:*') return true;

  const colonIndex = pattern.indexOf(':');
  if (colonIndex === -1) return false;

  const patternResource = pattern.substring(0, colonIndex);
  const patternActions = pattern.substring(colonIndex + 1);

  if (patternResource !== resource && patternResource !== '*') return false;
  if (patternActions === '*') return true;

  return patternActions.split(',').includes(action);
}
