"use client";

/**
 * EdForge EMIS - School Context Provider Server Wrapper
 * 
 * Client component that reads schoolId from URL and provides it to server components.
 * This bridges the gap between URL-based navigation and server-side data fetching.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { SchoolProvider } from "@/contexts/school-context";
import type { School } from "@edforge/shared-types";

interface SchoolContextProviderServerProps {
  children: React.ReactNode;
  /**
   * Initial school data from server component
   */
  initialSchool?: School | null;
  /**
   * Initial schools list from server component
   */
  initialSchools?: School[];
}

export function SchoolContextProviderServer({ 
  children,
  initialSchool,
  initialSchools = []
}: SchoolContextProviderServerProps) {
  const searchParams = useSearchParams();
  const schoolIdFromUrl = searchParams.get('schoolId');

  // The SchoolProvider will handle syncing with URL and localStorage
  return (
    <SchoolProvider
      initialSchool={initialSchool}
      initialSchools={initialSchools}
    >
      {children}
    </SchoolProvider>
  );
}

