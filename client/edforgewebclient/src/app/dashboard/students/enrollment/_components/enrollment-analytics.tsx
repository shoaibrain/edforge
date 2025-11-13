"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Clock, TrendingUp, Calendar } from "lucide-react"
import { EnrollmentTrendsChart } from "./charts/enrollment-trends-chart"
import { GradeDistributionChart } from "./charts/grade-distribution-chart"
import { CompletionFunnelChart } from "./charts/completion-funnel-chart"
import { StatusBreakdownChart } from "./charts/status-breakdown-chart"
import type { EnrollmentDashboardAnalytics } from "@/lib/schemas"

interface EnrollmentAnalyticsProps {
  analytics: EnrollmentDashboardAnalytics
}

export function EnrollmentAnalytics({ analytics }: EnrollmentAnalyticsProps) {
  return (
    <div className="space-y-6">
      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <EnrollmentTrendsChart data={analytics.trends} />
        <StatusBreakdownChart data={analytics.statusBreakdown} />
        <GradeDistributionChart data={analytics.gradeDistribution} />
        <CompletionFunnelChart data={analytics.completionFunnel} />
      </div>
    </div>
  )
}

