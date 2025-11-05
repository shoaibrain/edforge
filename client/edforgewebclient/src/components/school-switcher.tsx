"use client";

/**
 * EdForge EMIS - School Switcher Component
 * 
 * Elegant dropdown component for switching between schools.
 * Features gradient avatars, clean design, and enterprise-grade UX.
 * Used when tenant has multiple schools.
 */

import * as React from "react";
import { ChevronDown, Check, Plus, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSchool } from "@/contexts/school-context";
import { useRouter } from "next/navigation";
import type { School } from "@edforge/shared-types";
import { getSchoolInitial, getSchoolAvatarGradientStyle } from "@/lib/school-avatar";

interface SchoolSwitcherProps {
  /**
   * Current school (from props if available)
   */
  currentSchool?: School | null;
  /**
   * List of all schools (from props if available)
   */
  schools?: School[];
}

export function SchoolSwitcher({ currentSchool, schools: propSchools }: SchoolSwitcherProps) {
  const router = useRouter();
  const { currentSchool: contextSchool, schools: contextSchools, switchSchool } = useSchool();
  const [searchTerm, setSearchTerm] = React.useState("");

  // Use props if available, otherwise use context
  const schools = propSchools || contextSchools;
  const activeSchool = currentSchool || contextSchool;

  // Filter schools based on search
  const filteredSchools = React.useMemo(() => {
    if (!searchTerm) return schools;
    const term = searchTerm.toLowerCase();
    return schools.filter(
      (school) =>
        school.schoolName.toLowerCase().includes(term) ||
        school.schoolCode.toLowerCase().includes(term) ||
        school.schoolType.toLowerCase().includes(term)
    );
  }, [schools, searchTerm]);

  const handleSchoolSelect = (schoolId: string) => {
    switchSchool(schoolId);
  };

  const handleCreateSchool = () => {
    router.push("/dashboard/admin/schools/create");
  };

  if (schools.length === 0) {
    return null; // Empty state handled by parent
  }

  const activeSchoolId = activeSchool?.schoolId || '';
  const activeInitial = activeSchool ? getSchoolInitial(activeSchool.schoolName) : '?';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between h-auto p-2 hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent rounded-lg"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Gradient Avatar */}
            <div
              className="flex aspect-square size-8 items-center justify-center rounded-lg text-white flex-shrink-0 font-semibold text-sm"
              style={activeSchool ? getSchoolAvatarGradientStyle(activeSchool.schoolId) : undefined}
            >
              {activeInitial}
            </div>
            {/* School Info */}
            <div className="grid flex-1 text-left text-sm leading-tight min-w-0">
              <span className="truncate font-semibold text-foreground">
                {activeSchool?.schoolName || "Select School"}
              </span>
              {activeSchool?.schoolCode && (
                <span className="truncate text-xs text-muted-foreground">
                  {activeSchool.schoolCode}
                </span>
              )}
            </div>
            {/* Chevron */}
            <ChevronDown className="size-4 text-muted-foreground flex-shrink-0" />
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[280px] max-h-[400px] p-2"
      >
        {/* Search */}
        <div className="px-2 py-1.5 mb-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search schools..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>
        
        {/* Schools Section */}
        <div className="rounded-lg border border-border/50 bg-muted/30 p-1.5 mt-2">
          <div className="px-2 py-1.5 mb-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Schools
            </span>
          </div>
          <div className="max-h-[240px] overflow-y-auto space-y-0.5">
            {filteredSchools.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                No schools found
              </div>
            ) : (
              filteredSchools.map((school) => {
                const isActive = activeSchool?.schoolId === school.schoolId;
                const schoolInitial = getSchoolInitial(school.schoolName);
                return (
                  <DropdownMenuItem
                    key={school.schoolId}
                    onClick={() => handleSchoolSelect(school.schoolId)}
                    className={`flex items-center gap-3 cursor-pointer rounded-md px-2 py-2 h-auto ${
                      isActive ? 'bg-sidebar-accent/50' : ''
                    }`}
                  >
                    {/* Gradient Avatar */}
                    <div
                      className="flex aspect-square size-8 items-center justify-center rounded-lg text-white flex-shrink-0 font-semibold text-sm"
                      style={getSchoolAvatarGradientStyle(school.schoolId)}
                    >
                      {schoolInitial}
                    </div>
                    {/* School Info */}
                    <div className="grid flex-1 text-left text-sm leading-tight min-w-0">
                      <span className="truncate font-medium text-foreground">
                        {school.schoolName}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {school.schoolCode} • {school.schoolType}
                      </span>
                    </div>
                    {/* Checkmark for active */}
                    {isActive && (
                      <Check className="size-4 text-primary flex-shrink-0" />
                    )}
                  </DropdownMenuItem>
                );
              })
            )}
          </div>
        </div>

        {/* Create School Option */}
        <DropdownMenuSeparator className="my-2" />
        <DropdownMenuItem
          onClick={handleCreateSchool}
          className="flex items-center gap-2 cursor-pointer text-primary hover:text-primary focus:text-primary rounded-md px-2 py-2"
        >
          <Plus className="size-4" />
          <span className="font-medium">Create School</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

