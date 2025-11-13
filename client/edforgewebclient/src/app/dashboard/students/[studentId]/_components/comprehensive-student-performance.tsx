"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { BarChart3, TrendingUp, Target, Users, Award, CheckCircle2, AlertCircle, Gauge } from "lucide-react"
import { useEffect, useState, useMemo } from "react"
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip, Legend } from "recharts"
import { getChartColors } from "@/lib/chart-colors"

interface ComprehensiveStudentPerformanceProps {
  data: {
    overallPerformanceScore: number
    performanceBreakdown: {
      academics: number
      behavior: number
      attendance: number
      engagement: number
    }
    keyMetrics: {
      gpa: number
      attendance: number
      engagement: number
      growthRate: number
    }
    benchmarking: {
      gradeAverage: number
      schoolAverage: number
      districtAverage?: number
      percentile: number
    }
    predictiveIndicators: {
      projectedGPA: number
      graduationReadiness: number
      collegeReadiness: number
      timeframe: string
      confidence: string
      onTrack: boolean
    }
    actionableInsights: {
      strengths: Array<{
        area: string
        evidence: string
        impact: string
      }>
      improvementAreas: Array<{
        area: string
        current: number
        target: number
        recommendation: string
        expectedImpact: string
      }>
      recommendations: Array<{
        title: string
        priority: string
        rationale: string
        expectedImpact: string
      }>
    }
  }
}

export function ComprehensiveStudentPerformance({ data }: ComprehensiveStudentPerformanceProps) {
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

  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-success"
    if (score >= 80) return "text-info"
    if (score >= 70) return "text-warning"
    return "text-error"
  }

  const getScoreBgColor = (score: number) => {
    if (score >= 90) return "bg-success/10 border-success/20"
    if (score >= 80) return "bg-info/10 border-info/20"
    if (score >= 70) return "bg-warning/10 border-warning/20"
    return "bg-error/10 border-error/20"
  }

  const radarData = useMemo(() => [
    { subject: 'Academics', value: data.performanceBreakdown.academics, fullMark: 100 },
    { subject: 'Behavior', value: data.performanceBreakdown.behavior, fullMark: 100 },
    { subject: 'Attendance', value: data.performanceBreakdown.attendance, fullMark: 100 },
    { subject: 'Engagement', value: data.performanceBreakdown.engagement, fullMark: 100 },
  ], [data.performanceBreakdown])

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
          <p className="text-sm font-semibold text-foreground mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={`item-${index}`} className="text-xs text-muted-foreground flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}: <span className="font-medium text-foreground">{entry.value.toFixed(1)}%</span>
            </p>
          ))}
        </div>
      )
    }
    return null
  }

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          Comprehensive Performance Dashboard
        </CardTitle>
        <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
          Holistic assessment of student performance across academics, behavior, attendance, and engagement.
          <span className="text-muted-foreground/60"> EMIS:</span> Provides actionable insights for data-driven decision-making.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        {/* Overall Performance Score */}
        <div className={`p-4 rounded-lg border ${getScoreBgColor(data.overallPerformanceScore)}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-foreground">Overall Performance Score</p>
            <Gauge className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className={`text-3xl font-bold mb-2 ${getScoreColor(data.overallPerformanceScore)}`}>
            {data.overallPerformanceScore.toFixed(1)}%
          </p>
          <Progress value={data.overallPerformanceScore} className="h-2" />
          <p className="text-xs text-muted-foreground mt-2">
            Based on academics, behavior, attendance, and engagement
          </p>
        </div>

        {/* Key Performance Indicators */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className={`p-4 rounded-lg border ${getScoreBgColor(data.keyMetrics.gpa * 25)}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-foreground">GPA</p>
              <Award className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className={`text-xl font-bold mb-1 ${getScoreColor(data.keyMetrics.gpa * 25)}`}>
              {data.keyMetrics.gpa.toFixed(2)}
            </p>
            <p className="text-[10px] text-muted-foreground/70">
              Out of 4.0 scale
            </p>
          </div>

          <div className={`p-4 rounded-lg border ${getScoreBgColor(data.keyMetrics.attendance)}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-foreground">Attendance</p>
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className={`text-xl font-bold mb-1 ${getScoreColor(data.keyMetrics.attendance)}`}>
              {data.keyMetrics.attendance.toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted-foreground/70">
              Overall attendance rate
            </p>
          </div>

          <div className={`p-4 rounded-lg border ${getScoreBgColor(data.keyMetrics.engagement)}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-foreground">Engagement</p>
              <Target className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className={`text-xl font-bold mb-1 ${getScoreColor(data.keyMetrics.engagement)}`}>
              {data.keyMetrics.engagement.toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted-foreground/70">
              Class participation
            </p>
          </div>

          <div className="p-4 rounded-lg border bg-success/10 border-success/20">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-foreground">Growth Rate</p>
              <TrendingUp className="h-3.5 w-3.5 text-success" />
            </div>
            <p className="text-xl font-bold text-success mb-1">
              +{data.keyMetrics.growthRate.toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted-foreground/70">
              Year-over-year improvement
            </p>
          </div>
        </div>

        {/* Performance Breakdown & Benchmarking */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Performance Breakdown Radar Chart */}
          <div className="p-4 rounded-lg border border-border bg-muted/5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Performance Breakdown</h3>
            <ResponsiveContainer width="100%" height={250}>
              <RadarChart data={radarData}>
                <PolarGrid stroke={borderColor} strokeOpacity={0.3} />
                <PolarAngleAxis
                  dataKey="subject"
                  tick={{ fill: textColor, fontSize: 10 }}
                />
                <PolarRadiusAxis
                  angle={30}
                  domain={[0, 100]}
                  stroke={borderColor}
                  tick={{ fill: textColor, fontSize: 10 }}
                />
                <Radar
                  name="Performance"
                  dataKey="value"
                  stroke={colors.chart3}
                  fill={colors.chart3}
                  fillOpacity={0.6}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Benchmarking */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Benchmarking</h3>
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-foreground">vs. Grade Average</p>
                <p className="text-lg font-bold text-primary">
                  +{(data.keyMetrics.gpa - data.benchmarking.gradeAverage).toFixed(2)}
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground/70">
                Grade avg: {data.benchmarking.gradeAverage.toFixed(2)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-info/5 border border-info/20">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-foreground">vs. School Average</p>
                <p className="text-lg font-bold text-info">
                  +{(data.keyMetrics.gpa - data.benchmarking.schoolAverage).toFixed(2)}
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground/70">
                School avg: {data.benchmarking.schoolAverage.toFixed(2)}
              </p>
            </div>
            {data.benchmarking.districtAverage && (
              <div className="p-3 rounded-lg bg-accent/5 border border-accent/20">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-foreground">vs. District Average</p>
                  <p className="text-lg font-bold text-accent">
                    +{(data.keyMetrics.gpa - data.benchmarking.districtAverage).toFixed(2)}
                  </p>
                </div>
                <p className="text-[10px] text-muted-foreground/70">
                  District avg: {data.benchmarking.districtAverage.toFixed(2)}
                </p>
              </div>
            )}
            <div className="p-3 rounded-lg bg-success/5 border border-success/20">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-foreground">Percentile Rank</p>
                <p className="text-lg font-bold text-success">
                  Top {100 - data.benchmarking.percentile}%
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground/70">
                Among all students
              </p>
            </div>
          </div>
        </div>

        {/* Predictive Indicators */}
        <div className="p-4 rounded-lg border border-border bg-success/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-success" /> Predictive Indicators
            </h3>
            {data.predictiveIndicators.onTrack && (
              <Badge variant="default" className="text-[10px] bg-success text-success-foreground">On Track</Badge>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Projected GPA</p>
              <p className="text-xl font-bold text-success">
                {data.predictiveIndicators.projectedGPA.toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                In {data.predictiveIndicators.timeframe}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Graduation Readiness</p>
              <p className="text-xl font-bold text-success">
                {data.predictiveIndicators.graduationReadiness.toFixed(0)}%
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                Likelihood of success
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">College Readiness</p>
              <p className="text-xl font-bold text-success">
                {data.predictiveIndicators.collegeReadiness.toFixed(0)}%
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                Preparedness score
              </p>
            </div>
          </div>
        </div>

        {/* Actionable Insights */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Strengths */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Award className="h-4 w-4 text-success" /> Key Strengths
            </h3>
            <div className="space-y-2">
              {data.actionableInsights.strengths.map((strength, index) => (
                <div key={index} className="p-3 rounded-lg bg-success/5 border border-success/20">
                  <p className="text-sm font-medium text-foreground">{strength.area}</p>
                  <p className="text-xs text-muted-foreground mt-1">{strength.evidence}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">{strength.impact}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Improvement Areas */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-warning" /> Areas for Improvement
            </h3>
            <div className="space-y-2">
              {data.actionableInsights.improvementAreas.map((area, index) => (
                <div key={index} className="p-3 rounded-lg bg-warning/5 border border-warning/20">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-foreground">{area.area}</p>
                    <Badge variant="outline" className="text-[10px]">
                      {area.current.toFixed(1)}% → {area.target.toFixed(1)}%
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{area.recommendation}</p>
                  <p className="text-[10px] text-success mt-1">{area.expectedImpact}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recommendations */}
        {data.actionableInsights.recommendations.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> Recommendations
            </h3>
            <div className="space-y-2">
              {data.actionableInsights.recommendations.map((rec, index) => (
                <div key={index} className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-foreground">{rec.title}</p>
                    <Badge
                      variant={rec.priority === 'High' ? 'destructive' : 'secondary'}
                      className="text-[10px]"
                    >
                      {rec.priority}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{rec.rationale}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">{rec.expectedImpact}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

