"use client"

import { useState } from "react"
import {
  Users,
  TrendingUp,
  CheckCircle2,
  Clock,
  UserPlus,
  Upload,
  AlertCircle,
  FileText,
  Calendar,
  GraduationCap,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StudentEnrollmentForm } from "./student-enrollment-form"
import { BulkImportDialog } from "./bulk-import-dialog"
import { cn } from "@/lib/utils"
import type { EnrollmentDashboardData } from "@/lib/schemas"
import { EnrollmentAnalytics } from "./enrollment-analytics"
interface EnrollmentDashboardProps {
  data: EnrollmentDashboardData
}

export function EnrollmentDashboard({ data }: EnrollmentDashboardProps) {
  const [showEnrollmentForm, setShowEnrollmentForm] = useState(false)
  const [showBulkImport, setShowBulkImport] = useState(false)

  const { stats, recentActivities, alerts = [] } = data

  if (showEnrollmentForm) {
    return (
      <div>
        <StudentEnrollmentForm onClose={() => setShowEnrollmentForm(false)} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats Grid - Enhanced with Colors and Gradients */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">

        <Card className="bg-card border-l-4 border-l-success shadow-md hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-success/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardContent className="p-4 relative">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">Enrolled This Month</p>
                <p className="text-2xl font-bold text-success mb-1">{stats.monthlyIncrease}</p>
                <p className="text-xs text-success flex items-center gap-1 font-medium">
                  <TrendingUp className="h-3 w-3" />
                  +12% vs last month
                </p>
              </div>
              <div className="h-12 w-12 rounded-lg bg-success/10 flex items-center justify-center flex-shrink-0 group-hover:bg-success/20 transition-colors">
                <TrendingUp className="h-6 w-6 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-l-4 border-l-warning shadow-md hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-warning/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardContent className="p-4 relative">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">Pending Review</p>
                <p className="text-2xl font-bold text-warning mb-1">{stats.pendingReviews}</p>
                <p className="text-xs text-muted-foreground/70">Awaiting approval</p>
              </div>
              <div className="h-12 w-12 rounded-lg bg-warning/10 flex items-center justify-center flex-shrink-0 group-hover:bg-warning/20 transition-colors">
                <Clock className="h-6 w-6 text-warning" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Analytics Section */}
      <EnrollmentAnalytics analytics={data.analytics} />

      {/* Recent Activities and Quick Actions */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Activities */}
        <Card className="lg:col-span-2 border-border bg-card shadow-md">
          <CardHeader className="border-b border-border/50">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <FileText className="h-5 w-5 text-primary" />
              Recent Activities
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentActivities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div
                  className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0",
                    activity.type === "enrollment" && "bg-primary/10",
                    activity.type === "review" && "bg-warning/10",
                    activity.type === "completed" && "bg-success/10",
                  )}
                >
                  {activity.type === "enrollment" && <UserPlus className="h-5 w-5 text-primary" />}
                  {activity.type === "review" && <Clock className="h-5 w-5 text-warning" />}
                  {activity.type === "completed" && <CheckCircle2 className="h-5 w-5 text-success" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{activity.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{activity.description}</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">{activity.time}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>


        {/* Quick Actions */}
        <Card className="border-border bg-card shadow-md">
          <CardHeader className="border-b border-border/50">
            <CardTitle className="text-lg font-semibold text-foreground">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3 bg-transparent hover:bg-muted/50"
              onClick={() => setShowEnrollmentForm(true)}
            >
              <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                <UserPlus className="h-4 w-4 text-primary" />
              </div>
              <div className="text-left flex-1 min-w-0">
                <div className="font-medium text-sm text-foreground">Add New Student</div>
                <div className="text-xs text-muted-foreground">Single enrollment form</div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3 bg-transparent hover:bg-muted/50"
              onClick={() => setShowBulkImport(true)}
            >
              <div className="h-8 w-8 rounded bg-secondary/10 flex items-center justify-center flex-shrink-0">
                <Upload className="h-4 w-4 text-secondary" />
              </div>
              <div className="text-left flex-1 min-w-0">
                <div className="font-medium text-sm text-foreground">Import Students</div>
                <div className="text-xs text-muted-foreground">Bulk upload via CSV/Excel</div>
              </div>
            </Button>

            <Button 
            variant="outline" className="w-full justify-start gap-3 h-auto py-3 bg-transparent hover:bg-muted/50">
              <div className="h-8 w-8 rounded bg-success/10 flex items-center justify-center flex-shrink-0">
                <GraduationCap className="h-4 w-4 text-success" />
              </div>
              <div className="text-left flex-1 min-w-0">
                <div className="font-medium text-sm text-foreground">View All Students</div>
                <div className="text-xs text-muted-foreground">Manage student records</div>
              </div>
            </Button>

            <Button variant="outline" className="w-full justify-start gap-3 h-auto py-3 bg-transparent hover:bg-muted/50">
              <div className="h-8 w-8 rounded bg-warning/10 flex items-center justify-center flex-shrink-0">
                <Calendar className="h-4 w-4 text-warning" />
              </div>
              <div className="text-left flex-1 min-w-0">
                <div className="font-medium text-sm text-foreground">Enrollment Calendar</div>
                <div className="text-xs text-muted-foreground">View deadlines & events</div>
              </div>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Bulk Import Dialog */}
      {showBulkImport && <BulkImportDialog onClose={() => setShowBulkImport(false)} />}
    </div>
  )
}
