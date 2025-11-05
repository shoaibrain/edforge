"use client";

/**
 * EdForge EMIS - School Empty State Component
 * 
 * Displays when tenant has no schools.
 * Shows "Create School" button with friendly messaging.
 */

import * as React from "react";
import { Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function SchoolEmptyState() {
  const router = useRouter();

  const handleCreateSchool = () => {
    router.push("/dashboard/admin/schools/create");
  };

  return (
    <div className="flex flex-col items-center gap-3 w-full p-3">
      <div className="flex aspect-square size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Building2 className="size-6" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          No schools yet
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          Create your first school to get started
        </p>
      </div>
      <Button
        onClick={handleCreateSchool}
        size="sm"
        className="w-full"
      >
        <Plus className="size-4 mr-2" />
        Create School
      </Button>
    </div>
  );
}

