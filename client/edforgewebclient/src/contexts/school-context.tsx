"use client";

/**
 * EdForge EMIS - School Context Provider
 * 
 * Client-side context for managing current school state.
 * 
 * Architecture:
 * - URL as source of truth: Reads `?schoolId={id}` from URL search params
 * - localStorage backup: Stores `edforge-selected-school-{tenantId}` for UX
 * - Server-side data: School data passed from server components via props
 * - Navigation: switchSchool() navigates to new URL with schoolId param
 * 
 * Data Flow:
 * 1. Server component reads schoolId from URL
 * 2. Server component fetches school data
 * 3. Server component passes school data to client components
 * 4. Client context syncs with URL and localStorage
 * 5. switchSchool() updates URL → triggers server refresh
 */

import * as React from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import type { School } from "@edforge/shared-types";

interface SchoolContextValue {
  currentSchool: School | null;
  schools: School[];
  switchSchool: (schoolId: string) => void;
  refreshSchools: () => Promise<void>;
}

const SchoolContext = React.createContext<SchoolContextValue | undefined>(undefined);

export function useSchool() {
  const context = React.useContext(SchoolContext);
  if (context === undefined) {
    throw new Error("useSchool must be used within a SchoolProvider");
  }
  return context;
}

interface SchoolProviderProps {
  children: React.ReactNode;
  /**
   * Initial school data from server component
   * This is the source of truth for server-side rendering
   */
  initialSchool?: School | null;
  /**
   * Initial schools list from server component
   */
  initialSchools?: School[];
}

export function SchoolProvider({ 
  children, 
  initialSchool = null,
  initialSchools = []
}: SchoolProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  
  const [currentSchool, setCurrentSchool] = React.useState<School | null>(initialSchool);
  const [schools, setSchools] = React.useState<School[]>(initialSchools);

  // Get tenantId from session
  const tenantId = (session?.user as any)?.tenantId;

  // Sync schools with initialSchools prop (from server)
  React.useEffect(() => {
    if (initialSchools.length > 0) {
      setSchools(initialSchools);
    }
  }, [initialSchools]);

  // Sync currentSchool with initialSchool prop (from server)
  // Server components handle fetching based on URL schoolId
  React.useEffect(() => {
    if (initialSchool) {
      setCurrentSchool(initialSchool);
    }
  }, [initialSchool]);

  // Get schoolId from URL search params
  const schoolIdFromUrl = searchParams.get('schoolId');

  // Sync with localStorage and URL
  // Note: We don't fetch school data here - server components handle that
  // This effect only syncs localStorage and handles navigation when needed
  React.useEffect(() => {
    if (!tenantId) return;

    const storageKey = `edforge-selected-school-${tenantId}`;
    
    // If URL has schoolId, save it to localStorage
    if (schoolIdFromUrl) {
      try {
        localStorage.setItem(storageKey, schoolIdFromUrl);
      } catch (error) {
        console.error('[SchoolContext] Failed to save to localStorage:', error);
      }

      // Try to find school in current schools list (from server props)
      // If not found, server components will handle fetching on next render
      const foundSchool = schools.find(s => s.schoolId === schoolIdFromUrl);
      if (foundSchool && foundSchool.schoolId !== currentSchool?.schoolId) {
        setCurrentSchool(foundSchool);
      }
    } else {
      // No schoolId in URL - use initial school or redirect to stored school
      if (initialSchool) {
        setCurrentSchool(initialSchool);
      } else {
        // Try to get from localStorage and redirect
        try {
          const storedSchoolId = localStorage.getItem(storageKey);
          if (storedSchoolId) {
            // Navigate to dashboard with stored schoolId (triggers server-side fetch)
            router.push(`/dashboard?schoolId=${storedSchoolId}`);
          }
        } catch (error) {
          console.error('[SchoolContext] Failed to read from localStorage:', error);
        }
      }
    }
  }, [schoolIdFromUrl, tenantId, schools, initialSchool, currentSchool?.schoolId, router]);

  /**
   * Switch to a different school
   * Updates URL which triggers server-side refresh
   */
  const switchSchool = React.useCallback((schoolId: string) => {
    if (!tenantId) return;

    // Update localStorage
    const storageKey = `edforge-selected-school-${tenantId}`;
    try {
      localStorage.setItem(storageKey, schoolId);
    } catch (error) {
      console.error('[SchoolContext] Failed to save to localStorage:', error);
    }

    // Navigate to dashboard with new schoolId
    // Preserve other query params if they exist
    const params = new URLSearchParams(searchParams.toString());
    params.set('schoolId', schoolId);
    
    // Determine base path (dashboard or current path)
    const basePath = pathname.startsWith('/dashboard') ? pathname : '/dashboard';
    const newUrl = `${basePath}?${params.toString()}`;
    
    router.push(newUrl);
  }, [router, pathname, searchParams, tenantId]);

  /**
   * Refresh schools list
   * This would typically trigger a server action or API call
   * For now, it's a placeholder for future implementation
   */
  const refreshSchools = React.useCallback(async () => {
    // This would call a server action to refresh schools
    // For now, we rely on server components to pass updated data
    console.log('[SchoolContext] Refresh schools requested');
  }, []);

  const value = React.useMemo(
    () => ({
      currentSchool,
      schools,
      switchSchool,
      refreshSchools,
    }),
    [currentSchool, schools, switchSchool, refreshSchools]
  );

  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
}

