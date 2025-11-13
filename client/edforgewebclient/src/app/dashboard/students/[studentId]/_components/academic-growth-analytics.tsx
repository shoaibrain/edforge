"use client"

import { useEffect, useState } from "react"
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getChartColors } from "@/lib/chart-colors"
import { TrendingUp, BookOpen, Target, Award } from "lucide-react"

interface AcademicGrowthAnalyticsProps {
  data: {
    academicGrowthTrends: Array<{
      period: string
      gpa: number
      averageGrade: number
      improvement: number
      trend: 'up' | 'down' | 'stable'
    }>
    gradeTrendsBySubject: Array<{
      subject: string
      trends: Array<{
        period: string
        grade: number
      }>
    }>
    classPerformanceBreakdown: Array<{
      classId: string
      className: string
      subject: string
      averageGrade: number
      gradeTrend: number[]
      attendanceRate: number
      studentGrowth: number
      currentGrade: string
    }>
    attendanceCorrelation: number
    interventionHistory: Array<{
      date: string
      type: string
      effectiveness: number
      description: string
    }>
  }
}

export function AcademicGrowthAnalytics({ data }: AcademicGrowthAnalyticsProps) {
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

  const formatPeriod = (period: string) => {
    if (period.includes('-')) {
      const [year, month] = period.split('-')
      const date = new Date(parseInt(year), parseInt(month) - 1)
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    }
    return period
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
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
                {entry.name}: <span className="font-medium text-foreground">{entry.value.toFixed(2)}{entry.name.includes('GPA') ? '' : entry.name.includes('Grade') || entry.name.includes('Improvement') ? '%' : ''}</span>
              </p>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary green-500" />
          Academic Growth & Performance Trends
        </CardTitle>
        <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
          Comprehensive view of academic growth over time, including GPA trends, grade improvements, and subject performance.
          <span className="text-muted-foreground/60"> SABER:</span> Critical for tracking student progress and identifying intervention needs.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        {/* Academic Growth Trends */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Target className="h-4 w-4 text-success" /> Academic Growth Trends (Last 12 Months)
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data.academicGrowthTrends} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="gpaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.chart3} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={colors.chart3} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="gradeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.chart2} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={colors.chart2} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="improvementGradient" x1="0" y1="0" x2="0" y2="1">
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
                yAxisId="left"
                domain={[0, 4]}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke={textColor}
                style={{ fontSize: "10px" }}
                tick={{ fill: textColor }}
                domain={[0, 100]}
              />
              <Tooltip cursor={{ fill: isDark ? '#374151' : '#F3F4F6' }} content={<CustomTooltip />} />
              <Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="gpa"
                stroke={colors.chart3}
                fill="url(#gpaGradient)"
                name="GPA"
                strokeWidth={2}
                dot={{ r: 3, fill: colors.chart3, stroke: bgColor, strokeWidth: 1 }}
                activeDot={{ r: 5, fill: colors.chart3, stroke: bgColor, strokeWidth: 2 }}
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="averageGrade"
                stroke={colors.chart2}
                fill="url(#gradeGradient)"
                name="Avg Grade (%)"
                strokeWidth={2}
                dot={{ r: 3, fill: colors.chart2, stroke: bgColor, strokeWidth: 1 }}
                activeDot={{ r: 5, fill: colors.chart2, stroke: bgColor, strokeWidth: 2 }}
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="improvement"
                stroke={colors.chart5}
                fill="url(#improvementGradient)"
                name="Improvement (%)"
                strokeWidth={2}
                dot={{ r: 3, fill: colors.chart5, stroke: bgColor, strokeWidth: 1 }}
                activeDot={{ r: 5, fill: colors.chart5, stroke: bgColor, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-muted-foreground/70 mt-2.5 px-1 leading-relaxed">
            <span className="font-medium text-muted-foreground">Insight:</span>{" "}
            GPA improved from {data.academicGrowthTrends[0]?.gpa.toFixed(2)} to {data.academicGrowthTrends[data.academicGrowthTrends.length - 1]?.gpa.toFixed(2)} 
            over 12 months, showing consistent academic growth.{" "}
            <span className="text-muted-foreground/60">EMIS:</span> Growth tracking enables early identification 
            of performance patterns and timely intervention.
          </p>
        </div>

        {/* Class Performance Breakdown */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-secondary" /> Class Performance Breakdown
          </h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.classPerformanceBreakdown.map((cls) => (
              <div key={cls.classId} className="p-4 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-foreground text-sm">{cls.className}</h4>
                  <Badge
                    variant={
                      cls.currentGrade.startsWith("A") ? "default" :
                      cls.currentGrade.startsWith("B") ? "secondary" :
                      cls.currentGrade.startsWith("C") ? "outline" : "destructive"
                    }
                    className="text-xs"
                  >
                    {cls.currentGrade}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{cls.subject}</p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Avg Grade</span>
                    <span className="font-semibold text-foreground">{cls.averageGrade.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Attendance</span>
                    <span className="font-semibold text-foreground">{cls.attendanceRate.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Growth</span>
                    <span className="font-semibold text-success">+{cls.studentGrowth.toFixed(1)}%</span>
                  </div>
                </div>
                {cls.gradeTrend && cls.gradeTrend.length > 0 && (
                  <div className="mt-3">
                    <ResponsiveContainer width="100%" height={40}>
                      <LineChart data={cls.gradeTrend.map((g, i) => ({ name: `Q${i+1}`, grade: g }))}>
                        <Line
                          type="monotone"
                          dataKey="grade"
                          stroke={colors.chart3}
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Attendance Correlation & Intervention History */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="p-4 rounded-lg border border-border bg-primary/5">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> Attendance Correlation
            </h3>
            <p className="text-2xl font-bold text-primary mb-2">
              {(data.attendanceCorrelation * 100).toFixed(0)}%
            </p>
            <p className="text-xs text-muted-foreground">
              Strong correlation between attendance and academic performance. Higher attendance leads to better grades.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Award className="h-4 w-4 text-success" /> Recent Interventions
            </h3>
            <div className="space-y-2">
              {data.interventionHistory.slice(0, 3).map((intervention, index) => (
                <div key={index} className="p-3 rounded-lg border border-border bg-success/5">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-foreground">{intervention.type}</p>
                    <Badge variant="outline" className="text-[10px]">
                      {new Date(intervention.date).toLocaleDateString()}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{intervention.description}</p>
                  <p className="text-[10px] text-success mt-1">
                    Effectiveness: {intervention.effectiveness}%
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

