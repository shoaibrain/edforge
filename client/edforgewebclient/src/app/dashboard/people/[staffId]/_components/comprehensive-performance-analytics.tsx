"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { BarChart3, TrendingUp, Target, Users, Award, CheckCircle2, AlertCircle, BarChart, Radar } from "lucide-react"
import { useMemo } from "react"
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar as RechartsRadar, ResponsiveContainer, BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts"
import { getChartColors } from "@/lib/chart-colors"
import { useEffect, useState } from "react"

interface ComprehensivePerformanceAnalyticsProps {
  performanceMetrics: {
    teachingEffectiveness: number
    effectivenessBreakdown?: {
      studentOutcomes: number
      engagement: number
      growth: number
      retention: number
    }
    averageStudentGrade: number
    gradeTrend?: 'improving' | 'declining' | 'stable'
    improvementRate: number
    improvementHistory?: number[]
    passRate: number
    passRateBenchmark?: number
    engagementScore: number
    engagementBreakdown?: {
      participation: number
      assignmentCompletion: number
      homeworkSubmission: number
      activeDiscussion: number
    }
    retentionRate?: number
    collegeReadinessScore?: number
    standardizedTestScores?: {
      average: number
      aboveProficient: number
      proficient: number
      belowProficient: number
    }
    peerComparison?: {
      departmentAverage: number
      schoolAverage: number
      districtAverage?: number
      percentile: number
    }
    actionableInsights?: {
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
      professionalDevelopmentRecommendations: Array<{
        title: string
        priority: string
        rationale: string
        expectedImpact: string
      }>
      predictiveIndicators: {
        effectivenessTrend: string
        projectedEffectiveness: number
        timeframe: string
        confidence: string
        onTrack: boolean
      }
    }
  }
  resultsMetrics?: {
    studentAchievement: {
      passRate: number
      gradeImprovement: number
      collegeReadiness: number
    }
    engagement: {
      classParticipation: number
      assignmentCompletion: number
      attendanceCorrelation: number
    }
    interventionSuccess: {
      successRate: number
      studentsHelped: number
      averageImprovement: number
    }
  }
}

export function ComprehensivePerformanceAnalytics({
  performanceMetrics,
  resultsMetrics,
}: ComprehensivePerformanceAnalyticsProps) {
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

  // Prepare effectiveness breakdown data for radar chart
  const effectivenessData = useMemo(() => {
    if (!performanceMetrics.effectivenessBreakdown) return null
    return [
      {
        subject: 'Student\nOutcomes',
        value: performanceMetrics.effectivenessBreakdown.studentOutcomes,
        fullMark: 100,
      },
      {
        subject: 'Engagement',
        value: performanceMetrics.effectivenessBreakdown.engagement,
        fullMark: 100,
      },
      {
        subject: 'Growth',
        value: performanceMetrics.effectivenessBreakdown.growth,
        fullMark: 100,
      },
      {
        subject: 'Retention',
        value: performanceMetrics.effectivenessBreakdown.retention,
        fullMark: 100,
      },
    ]
  }, [performanceMetrics.effectivenessBreakdown])

  // Prepare improvement history data
  const improvementHistoryData = useMemo(() => {
    if (!performanceMetrics.improvementHistory || performanceMetrics.improvementHistory.length === 0) return null
    return performanceMetrics.improvementHistory.map((value, index) => ({
      year: `Year ${index + 1}`,
      improvement: value,
    }))
  }, [performanceMetrics.improvementHistory])

  const borderColor = isDark ? '#4B5563' : '#E5E7EB'
  const textColor = isDark ? '#9CA3AF' : '#6B7280'
  const bgColor = isDark ? '#1F2937' : '#FFFFFF'
  const textColorDark = isDark ? '#F9FAFB' : '#111827'

  return (
    <div className="space-y-6">
      {/* Teaching Effectiveness Overview */}
      <Card className="border-border bg-card shadow-md">
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Teaching Effectiveness
              </CardTitle>
              <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
                Comprehensive assessment of teaching effectiveness with component breakdown. 
                <span className="text-muted-foreground/60"> SABER:</span> Critical metric for 
                evaluating teacher performance and identifying areas for professional development.
              </CardDescription>
            </div>
            {performanceMetrics.peerComparison && (
              <Badge variant="outline" className="text-xs">
                Top {100 - performanceMetrics.peerComparison.percentile}%
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Overall Effectiveness */}
            <div className={`p-4 rounded-lg border ${getScoreBgColor(performanceMetrics.teachingEffectiveness)}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-foreground">Overall Effectiveness</p>
                <Target className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className={`text-3xl font-bold mb-2 ${getScoreColor(performanceMetrics.teachingEffectiveness)}`}>
                {performanceMetrics.teachingEffectiveness.toFixed(1)}%
              </p>
              <Progress value={performanceMetrics.teachingEffectiveness} className="h-2" />
              <p className="text-xs text-muted-foreground mt-2">
                Based on student outcomes, engagement, growth, and retention
              </p>
              {performanceMetrics.peerComparison && (
                <div className="mt-3 pt-3 border-t border-border/50">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">vs. Department</p>
                      <p className="font-semibold text-foreground">
                        +{(performanceMetrics.teachingEffectiveness - performanceMetrics.peerComparison.departmentAverage).toFixed(1)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">vs. School</p>
                      <p className="font-semibold text-foreground">
                        +{(performanceMetrics.teachingEffectiveness - performanceMetrics.peerComparison.schoolAverage).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Effectiveness Breakdown - Radar Chart */}
            {effectivenessData && (
              <div className="p-4 rounded-lg border border-border bg-muted/5">
                <p className="text-sm font-medium text-foreground mb-4">Component Breakdown</p>
                <ResponsiveContainer width="100%" height={200}>
                  <RadarChart data={effectivenessData}>
                    <PolarGrid stroke={borderColor} />
                    <PolarAngleAxis
                      dataKey="subject"
                      tick={{ fill: textColor, fontSize: 10 }}
                    />
                    <PolarRadiusAxis
                      angle={90}
                      domain={[0, 100]}
                      tick={{ fill: textColor, fontSize: 10 }}
                    />
                    <RechartsRadar
                      name="Effectiveness"
                      dataKey="value"
                      stroke={colors.chart3}
                      fill={colors.chart3}
                      fillOpacity={0.3}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: bgColor,
                        border: `1px solid ${borderColor}`,
                        borderRadius: "0.5rem",
                      }}
                      labelStyle={{ color: textColorDark, fontWeight: 600 }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  {effectivenessData.map((item, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{item.subject.replace('\n', ' ')}</span>
                      <span className="font-semibold text-foreground">{item.value.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Key Performance Indicators Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className={`p-4 rounded-lg border ${getScoreBgColor(performanceMetrics.passRate)}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-foreground">Pass Rate</p>
            <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className={`text-xl font-bold mb-1 ${getScoreColor(performanceMetrics.passRate)}`}>
            {performanceMetrics.passRate.toFixed(1)}%
          </p>
          {performanceMetrics.passRateBenchmark && (
            <p className="text-[10px] text-muted-foreground/70">
              vs. School: +{(performanceMetrics.passRate - performanceMetrics.passRateBenchmark).toFixed(1)}%
            </p>
          )}
        </div>

        <div className={`p-4 rounded-lg border ${getScoreBgColor(performanceMetrics.averageStudentGrade)}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-foreground">Avg Grade</p>
            <BarChart className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className={`text-xl font-bold mb-1 ${getScoreColor(performanceMetrics.averageStudentGrade)}`}>
            {performanceMetrics.averageStudentGrade.toFixed(1)}%
          </p>
          {performanceMetrics.gradeTrend && (
            <div className="flex items-center gap-1">
              {performanceMetrics.gradeTrend === 'improving' ? (
                <TrendingUp className="h-2.5 w-2.5 text-success" />
              ) : null}
              <p className="text-[10px] text-muted-foreground/70 capitalize">{performanceMetrics.gradeTrend}</p>
            </div>
          )}
        </div>

        <div className="p-4 rounded-lg border bg-success/10 border-success/20">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-foreground">Improvement</p>
            <TrendingUp className="h-3.5 w-3.5 text-success" />
          </div>
          <p className="text-xl font-bold text-success mb-1">
            +{performanceMetrics.improvementRate.toFixed(1)}%
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            Year-over-year growth
          </p>
        </div>

        <div className={`p-4 rounded-lg border ${getScoreBgColor(performanceMetrics.engagementScore)}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-foreground">Engagement</p>
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className={`text-xl font-bold mb-1 ${getScoreColor(performanceMetrics.engagementScore)}`}>
            {performanceMetrics.engagementScore.toFixed(1)}%
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            Student participation
          </p>
        </div>
      </div>

      {/* Actionable Insights & Benchmarking */}
      {performanceMetrics.actionableInsights && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Strengths & Improvement Areas */}
          <Card className="border-border bg-card shadow-md">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                Actionable Insights
              </CardTitle>
              <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
                Data-driven recommendations for continuous improvement and professional development.
                <span className="text-muted-foreground/60"> SABER:</span> Supports systematic teacher development.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              {/* Strengths */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Award className="h-4 w-4 text-success" /> Key Strengths
                </h3>
                <div className="space-y-2">
                  {performanceMetrics.actionableInsights.strengths.map((strength, index) => (
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
                  {performanceMetrics.actionableInsights.improvementAreas.map((area, index) => (
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

              {/* Professional Development Recommendations */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-info" /> Professional Development
                </h3>
                <div className="space-y-2">
                  {performanceMetrics.actionableInsights.professionalDevelopmentRecommendations.map((pd, index) => (
                    <div key={index} className="p-3 rounded-lg bg-info/5 border border-info/20">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-foreground">{pd.title}</p>
                        <Badge 
                          variant={pd.priority === 'High' ? 'destructive' : 'secondary'}
                          className="text-[10px]"
                        >
                          {pd.priority}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{pd.rationale}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-1">{pd.expectedImpact}</p>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Benchmarking & Predictive Indicators */}
          <Card className="border-border bg-card shadow-md">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Benchmarking & Projections
              </CardTitle>
              <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
                Peer comparison and predictive analytics for strategic planning.
                <span className="text-muted-foreground/60"> EMIS:</span> Enables data-driven decision-making.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              {/* Peer Comparison */}
              {performanceMetrics.peerComparison && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" /> Peer Comparison
                  </h3>
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-medium text-foreground">vs. Department</p>
                        <p className="text-lg font-bold text-primary">
                          +{(performanceMetrics.teachingEffectiveness - performanceMetrics.peerComparison.departmentAverage).toFixed(1)}%
                        </p>
                      </div>
                      <p className="text-[10px] text-muted-foreground/70">
                        Department avg: {performanceMetrics.peerComparison.departmentAverage.toFixed(1)}%
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-info/5 border border-info/20">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-medium text-foreground">vs. School</p>
                        <p className="text-lg font-bold text-info">
                          +{(performanceMetrics.teachingEffectiveness - performanceMetrics.peerComparison.schoolAverage).toFixed(1)}%
                        </p>
                      </div>
                      <p className="text-[10px] text-muted-foreground/70">
                        School avg: {performanceMetrics.peerComparison.schoolAverage.toFixed(1)}%
                      </p>
                    </div>
                    {performanceMetrics.peerComparison.districtAverage && (
                      <div className="p-3 rounded-lg bg-accent/5 border border-accent/20">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-medium text-foreground">vs. District</p>
                          <p className="text-lg font-bold text-accent">
                            +{(performanceMetrics.teachingEffectiveness - performanceMetrics.peerComparison.districtAverage).toFixed(1)}%
                          </p>
                        </div>
                        <p className="text-[10px] text-muted-foreground/70">
                          District avg: {performanceMetrics.peerComparison.districtAverage.toFixed(1)}%
                        </p>
                      </div>
                    )}
                    <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-medium text-foreground">Percentile Rank</p>
                        <p className="text-lg font-bold text-success">
                          Top {100 - performanceMetrics.peerComparison.percentile}%
                        </p>
                      </div>
                      <p className="text-[10px] text-muted-foreground/70">
                        Among all teachers
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Predictive Indicators */}
              {performanceMetrics.actionableInsights.predictiveIndicators && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-success" /> Predictive Indicators
                  </h3>
                  <div className="p-4 rounded-lg bg-success/5 border border-success/20">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-foreground">Projected Effectiveness</p>
                      {performanceMetrics.actionableInsights.predictiveIndicators.onTrack && (
                        <Badge variant="default" className="text-[10px] bg-success text-success-foreground">On Track</Badge>
                      )}
                    </div>
                    <p className="text-2xl font-bold text-success mb-1">
                      {performanceMetrics.actionableInsights.predictiveIndicators.projectedEffectiveness.toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      In {performanceMetrics.actionableInsights.predictiveIndicators.timeframe} 
                      ({performanceMetrics.actionableInsights.predictiveIndicators.confidence} confidence)
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 mt-2">
                      Trend: {performanceMetrics.actionableInsights.predictiveIndicators.effectivenessTrend}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

