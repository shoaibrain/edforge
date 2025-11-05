"use client";

/**
 * EdForge EMIS - Single School Selector Component
 * 
 * Displays school name with gradient avatar and a "Create School" button.
 * Used when tenant has only one school.
 * Features elegant design matching enterprise-grade aesthetic.
 */

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import type { School } from "@edforge/shared-types";
import { getSchoolInitial, getSchoolAvatarGradientStyle } from "@/lib/school-avatar";

interface SchoolSelectorSingleProps {
  /**
   * Current school
   */
  school: School;
}

export function SchoolSelectorSingle({ school }: SchoolSelectorSingleProps) {
  const router = useRouter();

  const handleCreateSchool = () => {
    router.push("/dashboard/admin/schools/create");
  };

  const schoolInitial = getSchoolInitial(school.schoolName);

  return (
    <div className="flex items-center gap-3 w-full">
      {/* Gradient Avatar */}
      <div
        className="flex aspect-square size-8 items-center justify-center rounded-lg text-white flex-shrink-0 font-semibold text-sm"
        style={getSchoolAvatarGradientStyle(school.schoolId)}
      >
        {schoolInitial}
      </div>
      {/* School Info */}
      <div className="grid flex-1 text-left text-sm leading-tight min-w-0">
        <span className="truncate font-semibold text-foreground">
          {school.schoolName}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {school.schoolCode}
        </span>
      </div>
      {/* Create Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCreateSchool}
        className="flex-shrink-0 h-8 px-2 text-xs"
        title="Create another school"
      >
        <Plus className="size-3 mr-1" />
        Create
      </Button>
    </div>
  );
}

