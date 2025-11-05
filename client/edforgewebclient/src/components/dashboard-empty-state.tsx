/**
 * EdForge EMIS - Dashboard Empty State Component
 * 
 * Displays when tenant has no schools.
 * Shows a prominent callout to create the first school.
 */

"use client";

import { Building2, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "next/navigation";

export function DashboardEmptyState() {
  const router = useRouter();

  const handleCreateSchool = () => {
    router.push("/dashboard/admin/schools/create");
  };

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-2xl border-2 border-dashed">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-10 w-10 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Get Started with EdForge</CardTitle>
          <CardDescription className="text-base mt-2">
            Create your first school to begin managing your educational institution
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              Schools are the foundation of your EdForge system. Each school can have:
            </p>
            <ul className="text-left max-w-md mx-auto space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <ArrowRight className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <span>Academic years and grading periods</span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <span>Departments and staff management</span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <span>Student enrollment and records</span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <span>Customized settings and configurations</span>
              </li>
            </ul>
          </div>
          
          <div className="flex justify-center pt-4">
            <Button
              onClick={handleCreateSchool}
              size="lg"
              className="min-w-[200px]"
            >
              <Plus className="mr-2 h-5 w-5" />
              Create Your First School
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

