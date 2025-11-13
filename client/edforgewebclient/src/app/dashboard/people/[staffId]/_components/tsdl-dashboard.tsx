"use client"

import { useEffect, useState, useMemo } from "react"
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getChartColors } from "@/lib/chart-colors"
import { TrendingUp, TrendingDown, AlertTriangle, Award, Users, Target, BarChart3 } from "lucide-react"
import { ClassGradePerformanceChart } from "./charts/class-grade-performance-chart"

interface TSDLDashboardProps {
  data: {
    averageStudentGrowth: number
    gradeDistribution: Array<{ grade: string; count: number; percentage: number }>
    performanceTrends: Array<{
      period: string
      average: number
      passRate?: number
      engagement?: number
      improvement?: number
      trend: 'up' | 'down' | 'stable'
    }>
    classPerformanceComparison?: Array<{
      className: string
      averageGrade: number
      passRate: number
      studentCount: number
      growthRate: number
      gradeDistribution: {
        A: number
        B: number
        C: number
        D: number
        F: number
      }
    }>
    strugglingStudents: Array<{ studentId: string; studentName: string; currentAverage: number; riskLevel: 'low' | 'medium' | 'high'; lastIntervention?: string }>
    excellingStudents: Array<{ studentId: string; studentName: string; currentAverage: number; strengths: string[] }>
    interventionEffectiveness?: Array<{
      type: string
      successRate: number
      studentsHelped: number
      averageImprovement: number
    }>
    attendanceCorrelation?: number
    engagementMetrics?: {
      classParticipation: number
      assignmentCompletion: number
      homeworkSubmission: number
      activeDiscussion: number
    }
  }
}

const RADIAN = Math.PI / 180

export function TSDLDashboard({ data }: TSDLDashboardProps) {
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

  const borderColor = isDark ? '#4B5563' : '#E5E7EB'
  const textColor = isDark ? '#9CA3AF' : '#6B7280'
  const bgColor = isDark ? '#1F2937' : '#FFFFFF'
  const textColorDark = isDark ? '#F9FAFB' : '#111827'

  const gradeColors = {
    A: colors.chart2, // Green
    B: colors.chart3, // Blue
    C: colors.chart4, // Amber
    D: colors.chart1, // Red
    F: colors.chart1, // Red
  }

  // Format period for display
  const formatPeriod = (period: string) => {
    if (period.includes('-')) {
      const [year, month] = period.split('-')
      const date = new Date(parseInt(year), parseInt(month) - 1)
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    }
    return period
  }

  // Custom tooltip for performance trends
  const PerformanceTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = data.performanceTrends.find((d) => d.period === label)
      if (!dataPoint) return null

      return (
        <div
          className="p-3 rounded-lg shadow-lg"
          style={{
            backgroundColor: bgColor,
            border: `1px solid ${borderColor}`,
          }}
        >
          <p className="text-sm font-semibold text-foreground mb-2">{formatPeriod(label)}</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => (
              <p key={index} className="text-xs text-muted-foreground flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                {entry.name}: <span className="font-medium text-foreground">{entry.value.toFixed(1)}%</span>
              </p>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  // Custom tooltip for class comparison
  const ClassComparisonTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const classData = data.classPerformanceComparison?.find((c) => c.className === label)
      if (!classData) return null

      return (
        <div
          className="p-3 rounded-lg shadow-lg"
          style={{
            backgroundColor: bgColor,
            border: `1px solid ${borderColor}`,
          }}
        >
          <p className="text-sm font-semibold text-foreground mb-2">{label}</p>
          <p className="text-xs text-muted-foreground mb-1">Avg Grade: <span className="font-medium text-foreground">{classData.averageGrade.toFixed(1)}%</span></p>
          <p className="text-xs text-muted-foreground mb-1">Pass Rate: <span className="font-medium text-foreground">{classData.passRate.toFixed(1)}%</span></p>
          <p className="text-xs text-muted-foreground mb-1">Students: <span className="font-medium text-foreground">{classData.studentCount}</span></p>
          <p className="text-xs text-muted-foreground">Growth: <span className="font-medium text-foreground">+{classData.growthRate.toFixed(1)}%</span></p>
        </div>
      )
    }
    return null
  }

  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + radius * Math.cos(-midAngle * RADIAN)
    const y = cy + radius * Math.sin(-midAngle * RADIAN)

    return (
      <text
        x={x}
        y={y}
        fill={isDark ? '#F9FAFB' : '#111827'}
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize={11}
        fontWeight={600}
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    )
  }

  // Best performing class
  const bestPerformingClass = useMemo(() => {
    if (!data.classPerformanceComparison || data.classPerformanceComparison.length === 0) return null
    return data.classPerformanceComparison.reduce((prev, current) => 
      current.averageGrade > prev.averageGrade ? current : prev
    )
  }, [data.classPerformanceComparison])

  return (
    <div className="space-y-6">
      {/* Row 1: Performance Trends and Combined Chart Side-by-Side */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Comprehensive Performance Trends */}
        <Card className="border-border bg-card shadow-md">
          <CardHeader className="pb-3 border-b border-border/50">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Comprehensive Performance Trends
                </CardTitle>
                <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
                  Multi-metric view showing average grade, pass rate, engagement, and improvement over 12 months. 
                  <span className="text-muted-foreground/60"> SABER:</span> Critical for tracking teacher effectiveness 
                  and identifying trends that correlate with student outcomes.
                </CardDescription>
              </div>
              {data.averageStudentGrowth && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <TrendingUp className="h-3 w-3 text-success" />
                  <span>Avg Growth: +{data.averageStudentGrowth.toFixed(1)}%</span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.performanceTrends} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="averageGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={colors.chart3} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={colors.chart3} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="passRateGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={colors.chart2} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={colors.chart2} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="engagementGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={colors.chart5} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={colors.chart5} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={borderColor} opacity={0.3} />
                <XAxis
                  dataKey="period"
                  stroke={textColor}
                  style={{ fontSize: "10px" }}
                  tick={{ fill: textColor }}
                  tickFormatter={formatPeriod}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  stroke={textColor}
                  style={{ fontSize: "10px" }}
                  tick={{ fill: textColor }}
                  domain={[0, 100]}
                />
                <Tooltip cursor={{ fill: isDark ? '#374151' : '#F3F4F6' }} content={<PerformanceTooltip />} />
                <Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" />
                <Area
                  type="monotone"
                  dataKey="average"
                  stroke={colors.chart3}
                  fill="url(#averageGradient)"
                  name="Average Grade (%)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: colors.chart3, stroke: bgColor, strokeWidth: 1 }}
                  activeDot={{ r: 5, fill: colors.chart3, stroke: bgColor, strokeWidth: 2 }}
                />
                {data.performanceTrends[0]?.passRate !== undefined && (
                  <Area
                    type="monotone"
                    dataKey="passRate"
                    stroke={colors.chart2}
                    fill="url(#passRateGradient)"
                    name="Pass Rate (%)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: colors.chart2, stroke: bgColor, strokeWidth: 1 }}
                    activeDot={{ r: 5, fill: colors.chart2, stroke: bgColor, strokeWidth: 2 }}
                  />
                )}
                {data.performanceTrends[0]?.engagement !== undefined && (
                  <Area
                    type="monotone"
                    dataKey="engagement"
                    stroke={colors.chart5}
                    fill="url(#engagementGradient)"
                    name="Engagement (%)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: colors.chart5, stroke: bgColor, strokeWidth: 1 }}
                    activeDot={{ r: 5, fill: colors.chart5, stroke: bgColor, strokeWidth: 2 }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
            <div className="mt-2.5 px-1">
              <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                <span className="font-medium text-muted-foreground">Insight:</span>{" "}
                Consistent upward trends across all metrics demonstrate strong teaching effectiveness. 
                Average grade improved from {data.performanceTrends[0]?.average.toFixed(1)}% to {data.performanceTrends[data.performanceTrends.length - 1]?.average.toFixed(1)}% 
                over 12 months.{" "}
                <span className="text-muted-foreground/60">SABER:</span> This multi-metric view enables 
                data-driven decisions about resource allocation and professional development needs.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Combined Class Performance & Grade Distribution Chart */}
        {data.classPerformanceComparison && data.classPerformanceComparison.length > 0 && (
          <ClassGradePerformanceChart data={data.classPerformanceComparison} />
        )}
      </div>

      {/* Correlation Analysis Panel */}
      {/* {(data.attendanceCorrelation || data.engagementMetrics) && (
        <Card className="border-border bg-card shadow-md">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Correlation Analysis
            </CardTitle>
            <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
              Key correlations between teacher actions and student outcomes. Strong correlations indicate 
              effective teaching practices that drive student success.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {data.attendanceCorrelation && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-foreground">Teacher → Student Attendance</p>
                    <TrendingUp className="h-3 w-3 text-primary" />
                  </div>
                  <p className="text-lg font-bold text-primary">{(data.attendanceCorrelation * 100).toFixed(0)}%</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    Strong positive correlation
                  </p>
                </div>
              )}
              {data.engagementMetrics && (
                <>
                  <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-foreground">Class Participation</p>
                      <Users className="h-3 w-3 text-success" />
                    </div>
                    <p className="text-lg font-bold text-success">{data.engagementMetrics.classParticipation.toFixed(1)}%</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      Active student engagement
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-info/5 border border-info/20">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-foreground">Assignment Completion</p>
                      <Target className="h-3 w-3 text-info" />
                    </div>
                    <p className="text-lg font-bold text-info">{data.engagementMetrics.assignmentCompletion.toFixed(1)}%</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      High completion rate
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-warning/5 border border-warning/20">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-foreground">Homework Submission</p>
                      <Award className="h-3 w-3 text-warning" />
                    </div>
                    <p className="text-lg font-bold text-warning">{data.engagementMetrics.homeworkSubmission.toFixed(1)}%</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      Excellent submission rate
                    </p>
                  </div>
                </>
              )}
            </div>
            <div className="mt-2.5 px-1">
              <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                <span className="font-medium text-muted-foreground">Insight:</span>{" "}
                {data.attendanceCorrelation && `Strong correlation (${(data.attendanceCorrelation * 100).toFixed(0)}%) between teacher and student attendance demonstrates the importance of consistent presence. `}
                High engagement metrics across all categories indicate effective teaching strategies.{" "}
                <span className="text-muted-foreground/60">SABER:</span> These correlations support 
                data-driven decisions about professional development and resource allocation.
              </p>
            </div>
          </CardContent>
        </Card>
      )} */}
    </div>
  )
}
