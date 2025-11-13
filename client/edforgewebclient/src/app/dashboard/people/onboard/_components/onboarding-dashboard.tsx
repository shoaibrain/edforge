"use client"

import {
  Users,
  TrendingUp,
  CheckCircle2,
  Clock,
  UserPlus,
  FileText,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { OnboardingDashboardData } from "@/lib/schemas"
import { DepartmentRoleBreakdownChart } from "./charts/department-role-breakdown-chart"

interface OnboardingDashboardProps {
  data: OnboardingDashboardData
}


export function OnboardingDashboard({ data }: OnboardingDashboardProps) {

  return (
    <div className="space-y-6">
      {/* Stats Grid - Enhanced with Colors and Gradients */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card border-l-4 border-l-primary shadow-md hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardContent className="p-4 relative">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">Total Onboarded</p>
                <p className="text-2xl font-bold text-primary mb-1">{data.stats.totalOnboarded.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground/70">+{data.stats.monthlyIncrease} this month</p>
              </div>
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                <Users className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-l-4 border-l-success shadow-md hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-success/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardContent className="p-4 relative">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">Completion Rate</p>
                <p className="text-2xl font-bold text-success mb-1">{data.stats.completionRate}%</p>
                <p className="text-xs text-success flex items-center gap-1 font-medium">
                  <TrendingUp className="h-3 w-3" />
                  +5% vs last month
                </p>
              </div>
              <div className="h-12 w-12 rounded-lg bg-success/10 flex items-center justify-center flex-shrink-0 group-hover:bg-success/20 transition-colors">
                <CheckCircle2 className="h-6 w-6 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-l-4 border-l-info shadow-md hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-info/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardContent className="p-4 relative">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">Avg. Onboarding Time</p>
                <p className="text-2xl font-bold text-info mb-1">{data.stats.averageTime} days</p>
                <p className="text-xs text-muted-foreground/70">Time to complete</p>
              </div>
              <div className="h-12 w-12 rounded-lg bg-info/10 flex items-center justify-center flex-shrink-0 group-hover:bg-info/20 transition-colors">
                <Clock className="h-6 w-6 text-info" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-l-4 border-l-warning shadow-md hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-warning/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardContent className="p-4 relative">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">In Progress</p>
                <p className="text-2xl font-bold text-warning mb-1">{data.stats.inProgress}</p>
                <p className="text-xs text-muted-foreground/70">Currently onboarding</p>
              </div>
              <div className="h-12 w-12 rounded-lg bg-warning/10 flex items-center justify-center flex-shrink-0 group-hover:bg-warning/20 transition-colors">
                <Clock className="h-6 w-6 text-warning" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Area - Chart and Recent Activities Side by Side */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Department-Role Breakdown Chart - Takes 2/3 width */}
        <div className="lg:col-span-2">
          <DepartmentRoleBreakdownChart data={data.departmentRoleBreakdown} />
        </div>

        {/* Recent Activities - Compact Sidebar - Takes 1/3 width */}
        <Card className="border-border bg-card shadow-md h-fit lg:sticky lg:top-6">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
              <FileText className="h-4 w-4 text-primary" />
              Recent Activities
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
              {data.recentActivities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-muted/50 transition-colors group"
                >
                  <div
                    className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors",
                      activity.type === "completed" && "bg-success/10 group-hover:bg-success/20",
                      activity.type === "in_progress" && "bg-warning/10 group-hover:bg-warning/20",
                      activity.type === "started" && "bg-primary/10 group-hover:bg-primary/20",
                    )}
                  >
                    {activity.type === "completed" && <CheckCircle2 className="h-4 w-4 text-success" />}
                    {activity.type === "in_progress" && <Clock className="h-4 w-4 text-warning" />}
                    {activity.type === "started" && <UserPlus className="h-4 w-4 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground leading-tight">{activity.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{activity.description}</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

