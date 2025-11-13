"use client"

import { useEffect, useState } from "react"
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
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
import { Calendar, AlertTriangle, TrendingUp, Users, Target } from "lucide-react"

interface BehavioralAnalyticsProps {
  data: {
    attendanceTrends: Array<{
      period: string
      present: number
      absent: number
      tardy: number
      attendanceRate: number
    }>
    behavioralTrends: Array<{
      period: string
      positiveBehaviors: number
      incidents: number
      improvement: number
    }>
    riskAssessment: {
      riskLevel: 'low' | 'medium' | 'high'
      factors: Array<{
        factor: string
        severity: 'low' | 'medium' | 'high'
        description: string
      }>
      overallRisk: number
    }
    interventionHistory: Array<{
      date: string
      type: string
      effectiveness: number
      description: string
      outcome: string
    }>
    engagementMetrics: {
      participation: number
      collaboration: number
      leadership: number
      overall: number
    }
  }
}

export function BehavioralAnalytics({ data }: BehavioralAnalyticsProps) {
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

  const getRiskColor = (riskLevel: string) => {
    switch (riskLevel) {
      case 'high':
        return 'text-error bg-error/10 border-error/20'
      case 'medium':
        return 'text-warning bg-warning/10 border-warning/20'
      case 'low':
        return 'text-success bg-success/10 border-success/20'
      default:
        return 'text-muted-foreground bg-muted/10 border-border'
    }
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
                {entry.name}: <span className="font-medium text-foreground">{entry.value}{entry.name.includes('Rate') || entry.name.includes('Improvement') ? '%' : ''}</span>
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
          <Users className="h-4 w-4 text-primary" />
          Behavioral Analytics
        </CardTitle>
        <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
          Comprehensive behavioral analysis including attendance patterns, behavioral trends, and risk assessment.
          <span className="text-muted-foreground/60"> SABER:</span> Critical for identifying at-risk students and intervention needs.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        {/* Attendance Trends */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" /> Attendance Trends
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data.attendanceTrends} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="attendanceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.chart2} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={colors.chart2} stopOpacity={0.05} />
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
              <Tooltip cursor={{ fill: isDark ? '#374151' : '#F3F4F6' }} content={<CustomTooltip />} />
              <Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" />
              <Area
                type="monotone"
                dataKey="attendanceRate"
                stroke={colors.chart2}
                fill="url(#attendanceGradient)"
                name="Attendance Rate (%)"
                strokeWidth={2}
                dot={{ r: 3, fill: colors.chart2, stroke: bgColor, strokeWidth: 1 }}
                activeDot={{ r: 5, fill: colors.chart2, stroke: bgColor, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Risk Assessment & Engagement Metrics */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Risk Assessment */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" /> Risk Assessment
            </h3>
            <div className={`p-4 rounded-lg border ${getRiskColor(data.riskAssessment.riskLevel)}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-foreground">Overall Risk Level</p>
                <Badge
                  variant={data.riskAssessment.riskLevel === 'high' ? 'destructive' : data.riskAssessment.riskLevel === 'medium' ? 'default' : 'secondary'}
                  className="text-[10px]"
                >
                  {data.riskAssessment.riskLevel.toUpperCase()}
                </Badge>
              </div>
              <p className="text-2xl font-bold mb-3">{data.riskAssessment.overallRisk}%</p>
              <div className="space-y-2">
                {data.riskAssessment.factors.map((factor, index) => (
                  <div key={index} className="p-2 rounded bg-muted/30 border border-border/50">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-foreground">{factor.factor}</p>
                      <Badge
                        variant={factor.severity === 'high' ? 'destructive' : factor.severity === 'medium' ? 'default' : 'secondary'}
                        className="text-[10px]"
                      >
                        {factor.severity}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground/70">{factor.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Engagement Metrics */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Target className="h-4 w-4 text-success" /> Engagement Metrics
            </h3>
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-foreground">Participation</p>
                  <p className="text-lg font-bold text-primary">{data.engagementMetrics.participation}%</p>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-foreground">Collaboration</p>
                  <p className="text-lg font-bold text-success">{data.engagementMetrics.collaboration}%</p>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-info/5 border border-info/20">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-foreground">Leadership</p>
                  <p className="text-lg font-bold text-info">{data.engagementMetrics.leadership}%</p>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-warning/5 border border-warning/20">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-foreground">Overall Engagement</p>
                  <p className="text-lg font-bold text-warning">{data.engagementMetrics.overall}%</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Intervention History */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-success" /> Intervention History
          </h3>
          <div className="space-y-2">
            {data.interventionHistory.map((intervention, index) => (
              <div key={index} className="p-3 rounded-lg border border-border bg-muted/30">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{intervention.type}</p>
                    <Badge variant="outline" className="text-[10px]">
                      {new Date(intervention.date).toLocaleDateString()}
                    </Badge>
                  </div>
                  <Badge
                    variant={intervention.effectiveness >= 70 ? 'default' : intervention.effectiveness >= 50 ? 'secondary' : 'destructive'}
                    className={intervention.effectiveness >= 70 ? 'text-[10px] bg-success text-success-foreground' : 'text-[10px]'}
                  >
                    {intervention.effectiveness}% effective
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{intervention.description}</p>
                <p className="text-[10px] text-success mt-1">Outcome: {intervention.outcome}</p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

