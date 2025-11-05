/**
 * EdForge EMIS - Navigation Utilities
 * 
 * Helper functions for URL-based navigation with school context
 */

/**
 * Switch to a different school
 * Navigates to dashboard with schoolId query parameter
 * Updates localStorage for UX optimization
 */
export function switchSchool(schoolId: string, tenantId: string, currentPath?: string, currentSearchParams?: URLSearchParams): string {
  // Update localStorage
  const storageKey = `edforge-selected-school-${tenantId}`;
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, schoolId);
    }
  } catch (error) {
    console.error('[Navigation] Failed to save to localStorage:', error);
  }

  // Build new URL with schoolId
  const params = new URLSearchParams(currentSearchParams?.toString() || '');
  params.set('schoolId', schoolId);
  
  // Determine base path (preserve current path if it's a dashboard route)
  const basePath = currentPath?.startsWith('/dashboard') ? currentPath : '/dashboard';
  const newUrl = `${basePath}?${params.toString()}`;
  
  return newUrl;
}

/**
 * Get most recently accessed school from localStorage
 */
export function getStoredSchoolId(tenantId: string): string | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const storageKey = `edforge-selected-school-${tenantId}`;
    return localStorage.getItem(storageKey);
  } catch (error) {
    console.error('[Navigation] Failed to read from localStorage:', error);
    return null;
  }
}

/**
 * Clear stored school ID
 */
export function clearStoredSchoolId(tenantId: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    const storageKey = `edforge-selected-school-${tenantId}`;
    localStorage.removeItem(storageKey);
  } catch (error) {
    console.error('[Navigation] Failed to clear localStorage:', error);
  }
}

