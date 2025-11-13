"use client"

import { useEffect, useState, useMemo } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getChartColors } from "@/lib/chart-colors"
import { Users, TrendingUp, Award, Target } from "lucide-react"

interface RoleOutcomeData {
  role: string
  count: number
  percentage: number
  outcomeMetrics?: {
    averageStudentGrade?: number
    passRate?: number
    improvementRate?: number
    studentEngagementScore?: number
    interventionSuccessRate?: number
    totalStudentsImpacted?: number
  }
}

interface RoleDistributionOutcomesChartProps {
  data: RoleOutcomeData[]
}

const getGradientId = (prefix: string, index: number) => `${prefix}Gradient${index}`

export function RoleDistributionOutcomesChart({ data }: RoleDistributionOutcomesChartProps) {
  const [colors, setColors] = useState(getChartColors(false))
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const checkDarkMode = () => {
      const darkMode = document.documentElement.classList.contains('dark')
      setIsDark(darkMode)
      setColors(getChartColors(darkMode))
    }
    
    checkDarkMode()
    const observer = new MutationObserver(checkDarkMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    
    return () => observer.disconnect()
  }, [])

  // Prepare chart data with both count and outcome metrics
  const chartData = useMemo(() => {
    return data.map((item) => ({
      role: item.role,
      count: item.count,
      percentage: item.percentage,
      avgGrade: item.outcomeMetrics?.averageStudentGrade ?? null,
      passRate: item.outcomeMetrics?.passRate ?? null,
      improvementRate: item.outcomeMetrics?.improvementRate ?? null,
      engagementScore: item.outcomeMetrics?.studentEngagementScore ?? null,
      studentsImpacted: item.outcomeMetrics?.totalStudentsImpacted ?? item.count * 20, // Estimate if not provided
    }))
  }, [data])

  // Find highest performing role by average grade
  const highestPerformingRole = useMemo(() => {
    const rolesWithGrades = data.filter((d) => d.outcomeMetrics?.averageStudentGrade)
    if (rolesWithGrades.length === 0) return null
    return rolesWithGrades.reduce((max, role) => 
      (role.outcomeMetrics?.averageStudentGrade ?? 0) > (max.outcomeMetrics?.averageStudentGrade ?? 0) ? role : max
    )
  }, [data])

  // Find most impactful role by student count
  const mostImpactfulRole = useMemo(() => {
    return data.reduce((max, role) => 
      (role.outcomeMetrics?.totalStudentsImpacted ?? 0) > (max.outcomeMetrics?.totalStudentsImpacted ?? 0) ? role : max
    )
  }, [data])

  const borderColor = isDark ? '#4B5563' : '#E5E7EB'
  const textColor = isDark ? '#9CA3AF' : '#6B7280'
  const bgColor = isDark ? '#1F2937' : '#FFFFFF'
  const textColorDark = isDark ? '#F9FAFB' : '#111827'

  // Calculate summary metrics
  const totalRoles = data.length
  const totalStaff = data.reduce((sum, item) => sum + item.count, 0)
  const totalStudentsImpacted = data.reduce((sum, item) => 
    sum + (item.outcomeMetrics?.totalStudentsImpacted ?? 0), 0
  )

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const roleData = data.find((d) => d.role === label)
      if (!roleData) return null

      return (
        <div
          style={{
            backgroundColor: bgColor,
            border: `1px solid ${borderColor}`,
            borderRadius: "0.5rem",
            padding: "12px",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
          }}
        >
          <p style={{ color: textColorDark, fontWeight: 600, marginBottom: "8px", fontSize: "14px" }}>
            {label}
          </p>
          <div style={{ borderTop: `1px solid ${borderColor}`, paddingTop: "8px", marginTop: "8px" }}>
            <div style={{ marginBottom: "6px", fontSize: "12px" }}>
              <span style={{ color: textColor }}>Staff Count: </span>
              <span style={{ color: textColorDark, fontWeight: 600 }}>{roleData.count}</span>
              <span style={{ color: textColor }}> ({roleData.percentage}%)</span>
            </div>
            {roleData.outcomeMetrics && (
              <>
                {roleData.outcomeMetrics.averageStudentGrade !== undefined && (
                  <div style={{ marginBottom: "4px", fontSize: "12px" }}>
                    <span style={{ color: textColor }}>Avg Student Grade: </span>
                    <span style={{ color: textColorDark, fontWeight: 600 }}>
                      {roleData.outcomeMetrics.averageStudentGrade.toFixed(1)}%
                    </span>
                  </div>
                )}
                {roleData.outcomeMetrics.passRate !== undefined && (
                  <div style={{ marginBottom: "4px", fontSize: "12px" }}>
                    <span style={{ color: textColor }}>Pass Rate: </span>
                    <span style={{ color: textColorDark, fontWeight: 600 }}>
                      {roleData.outcomeMetrics.passRate.toFixed(1)}%
                    </span>
                  </div>
                )}
                {roleData.outcomeMetrics.improvementRate !== undefined && (
                  <div style={{ marginBottom: "4px", fontSize: "12px" }}>
                    <span style={{ color: textColor }}>Improvement Rate: </span>
                    <span style={{ 
                      color: roleData.outcomeMetrics.improvementRate >= 0 ? colors.chart2 : colors.chart1,
                      fontWeight: 600 
                    }}>
                      {roleData.outcomeMetrics.improvementRate >= 0 ? '+' : ''}
                      {roleData.outcomeMetrics.improvementRate.toFixed(1)}%
                    </span>
                  </div>
                )}
                {roleData.outcomeMetrics.studentEngagementScore !== undefined && (
                  <div style={{ marginBottom: "4px", fontSize: "12px" }}>
                    <span style={{ color: textColor }}>Engagement Score: </span>
                    <span style={{ color: textColorDark, fontWeight: 600 }}>
                      {roleData.outcomeMetrics.studentEngagementScore.toFixed(1)}%
                    </span>
                  </div>
                )}
                {roleData.outcomeMetrics.totalStudentsImpacted !== undefined && (
                  <div style={{ marginBottom: "4px", fontSize: "12px" }}>
                    <span style={{ color: textColor }}>Students Impacted: </span>
                    <span style={{ color: textColorDark, fontWeight: 600 }}>
                      {roleData.outcomeMetrics.totalStudentsImpacted.toLocaleString()}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )
    }
    return null
  }

  // Color assignment for roles
  const roleColors = useMemo(() => {
    const CHART_COLORS = [
      colors.chart3, // Blue
      colors.chart2, // Green
      colors.chart1, // Warm Red
      colors.chart4, // Amber
      colors.chart5, // Purple
    ]
    const colorMap: Record<string, string> = {}
    data.forEach((item, index) => {
      colorMap[item.role] = CHART_COLORS[index % CHART_COLORS.length]
    })
    return colorMap
  }, [data, colors])

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Role Distribution & Outcomes
            </CardTitle>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
              Visualizes staff count by role alongside student outcome metrics (average grades, pass rates). 
              Enables identification of roles with highest impact on educational outcomes for strategic 
              staffing and resource allocation decisions.
            </p>
          </div>
          {highestPerformingRole && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Award className="h-3 w-3 text-warning" />
              <span>Top: {highestPerformingRole.role}</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={chartData}
            margin={{ top: 5, right: 30, left: 0, bottom: 60 }}
          >
            <defs>
              {data.map((item, index) => {
                const color = roleColors[item.role]
                return (
                  <linearGradient
                    key={getGradientId("role", index)}
                    id={getGradientId("role", index)}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={color} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.5} />
                  </linearGradient>
                )
              })}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={borderColor} opacity={0.3} />
            <XAxis
              dataKey="role"
              stroke={textColor}
              style={{ fontSize: "12px" }}
              tick={{ fill: textColor }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              yAxisId="left"
              stroke={textColor}
              style={{ fontSize: "12px" }}
              tick={{ fill: textColor }}
              label={{ value: 'Staff Count', angle: -90, position: 'insideLeft', style: { fill: textColor } }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke={textColor}
              style={{ fontSize: "12px" }}
              tick={{ fill: textColor }}
              label={{ value: 'Outcome %', angle: 90, position: 'insideRight', style: { fill: textColor } }}
              domain={[0, 100]}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              height={60}
              iconType="square"
              wrapperStyle={{ paddingBottom: "10px" }}
              formatter={(value) => (
                <span style={{ color: textColorDark, fontSize: "12px" }}>{value}</span>
              )}
            />
            <Bar
              yAxisId="left"
              dataKey="count"
              name="Staff Count"
              radius={[6, 6, 0, 0]}
            >
              {data.map((item, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={`url(#${getGradientId("role", index)})`}
                />
              ))}
            </Bar>
            {data.some((d) => d.outcomeMetrics?.averageStudentGrade !== undefined) && (
              <Bar
                yAxisId="right"
                dataKey="avgGrade"
                name="Avg Student Grade (%)"
                fill={colors.chart2}
                opacity={0.7}
                radius={[6, 6, 0, 0]}
              />
            )}
            {data.some((d) => d.outcomeMetrics?.passRate !== undefined) && (
              <Bar
                yAxisId="right"
                dataKey="passRate"
                name="Pass Rate (%)"
                fill={colors.chart3}
                opacity={0.7}
                radius={[6, 6, 0, 0]}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
        {highestPerformingRole && (
          <div className="mt-2.5 px-1">
            <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
              <span className="font-medium text-muted-foreground">Insight:</span>{" "}
              {highestPerformingRole.role} role demonstrates highest student outcomes
              {highestPerformingRole.outcomeMetrics?.averageStudentGrade && (
                <> ({highestPerformingRole.outcomeMetrics.averageStudentGrade.toFixed(1)}% avg grade, 
                {highestPerformingRole.outcomeMetrics.passRate && ` ${highestPerformingRole.outcomeMetrics.passRate.toFixed(1)}% pass rate`})</>
              )}
              . <span className="text-muted-foreground/60">SABER:</span> Understanding role-outcome 
              correlations enables data-driven staffing decisions, strategic resource allocation, and 
              targeted professional development to maximize student success and educational effectiveness.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

