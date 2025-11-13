"use client"

import { RoleDistributionOutcomesChart } from "./charts/role-distribution-outcomes-chart"
import { ComprehensiveRatioTrendsChart } from "./charts/comprehensive-ratio-trends-chart"
import type { PeopleDashboardData } from "@/lib/schemas"

interface StaffAnalyticsProps {
  analytics: PeopleDashboardData
}

export function StaffAnalytics({ analytics }: StaffAnalyticsProps) {
  // Use roleDistributionWithOutcomes if available, otherwise fall back to roleDistribution
  const roleDistributionData = analytics.roleDistributionWithOutcomes ?? 
    analytics.roleDistribution.map((role) => ({
      role: role.role,
      count: role.count,
      percentage: role.percentage,
      outcomeMetrics: undefined,
    }))

  // Use comprehensiveRatioTrends if available, otherwise convert ratioTrends
  const ratioTrendsData = analytics.comprehensiveRatioTrends ?? 
    analytics.ratioTrends.map((trend) => ({
      month: trend.month,
      studentToTeacherRatio: trend.ratio,
      teacherToStudentRatio: 1 / trend.ratio,
      studentCount: trend.studentCount,
      teacherCount: trend.teacherCount,
      averageStudentGrade: undefined,
      passRate: undefined,
      status: trend.ratio <= 15 ? "optimal" as const : 
              trend.ratio <= 20 ? "acceptable" as const :
              trend.ratio <= 25 ? "concerning" as const : "critical" as const,
      trend: undefined,
    }))

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Role Distribution with Outcomes */}
      <RoleDistributionOutcomesChart data={roleDistributionData} />

      {/* Comprehensive Ratio Trends */}
      <ComprehensiveRatioTrendsChart 
        data={ratioTrendsData}
        optimalRatio={15}
        acceptableRange={{ min: 15, max: 20 }}
        warningThreshold={20}
        criticalThreshold={25}
      />
    </div>
  )
}

