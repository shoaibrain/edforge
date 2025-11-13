"use client"

import { useState } from "react"
import {
  Users,
  GraduationCap,
  TrendingUp,
  Award,
  UserPlus,
  Shield,
  BookOpen,
  BarChart3,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { PeopleDashboardData, StaffProfileSummary } from "@/lib/schemas"
import { StaffTable } from "./staff-table"
import { StaffFilters } from "./staff-filters"
import { StaffAnalytics } from "./staff-analytics"

interface PeopleDashboardProps {
  data: PeopleDashboardData
}

export function PeopleDashboard({ data }: PeopleDashboardProps) {
  const [showAddStaff, setShowAddStaff] = useState(false)

  const { stats, staff } = data

  return (
    <div className="space-y-6">

      {/* Analytics Section */}
      <StaffAnalytics analytics={data} />

      {/* Filters and Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Staff Directory</h2>
            <p className="text-sm text-muted-foreground">Manage and view all school staff members</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              Export
            </Button>
            <Button variant="outline" size="sm">
              Generate Report
            </Button>
            <Button onClick={() => setShowAddStaff(true)} size="sm">
              <UserPlus className="h-4 w-4 mr-2" />
              Add Staff
            </Button>
          </div>
        </div>

        <StaffFilters
          departments={Array.from(new Set(staff.map((s: StaffProfileSummary) => s.department)))}
          roles={Array.from(new Set(staff.flatMap((s: StaffProfileSummary) => s.roles)))}
          statuses={Array.from(new Set(staff.map((s: StaffProfileSummary) => s.status)))}
        />

        <StaffTable staff={staff} />
      </div>
    </div>
  )
}

