"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { BarChart3, TrendingUp, Target, Users } from "lucide-react"

interface PerformanceAnalyticsProps {
  metrics: {
    teachingEffectiveness: number
    averageStudentGrade: number
    improvementRate: number
    passRate: number
    engagementScore: number
  }
}

export function PerformanceAnalytics({ metrics }: PerformanceAnalyticsProps) {
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

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-4 border-b border-border/50">
        <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Performance Analytics
        </CardTitle>
        <CardDescription>
          Comprehensive assessment of teaching effectiveness and student outcomes
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Teaching Effectiveness */}
          <div className={`p-4 rounded-lg border ${getScoreBgColor(metrics.teachingEffectiveness)}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">Teaching Effectiveness</p>
              <Target className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className={`text-2xl font-bold mb-2 ${getScoreColor(metrics.teachingEffectiveness)}`}>
              {metrics.teachingEffectiveness.toFixed(1)}%
            </p>
            <Progress value={metrics.teachingEffectiveness} />
            <p className="text-xs text-muted-foreground mt-2">
              Based on student outcomes, engagement, and growth
            </p>
          </div>

          {/* Average Student Grade */}
          <div className={`p-4 rounded-lg border ${getScoreBgColor(metrics.averageStudentGrade)}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">Average Student Grade</p>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className={`text-2xl font-bold mb-2 ${getScoreColor(metrics.averageStudentGrade)}`}>
              {metrics.averageStudentGrade.toFixed(1)}%
            </p>
            <div className="h-2">
              <Progress value={metrics.averageStudentGrade} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              School average: 85.2%
            </p>
          </div>

          {/* Improvement Rate */}
          <div className="p-4 rounded-lg border bg-success/10 border-success/20">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">Improvement Rate</p>
              <TrendingUp className="h-4 w-4 text-success" />
            </div>
            <p className="text-2xl font-bold text-success mb-2">
              +{metrics.improvementRate.toFixed(1)}%
            </p>
            <div className="h-2">
              <Progress value={metrics.improvementRate} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Average grade improvement this year
            </p>
          </div>

          {/* Pass Rate */}
          <div className={`p-4 rounded-lg border ${getScoreBgColor(metrics.passRate)}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">Pass Rate</p>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className={`text-2xl font-bold mb-2 ${getScoreColor(metrics.passRate)}`}>
              {metrics.passRate.toFixed(1)}%
            </p>
            <div className="h-2">
              <Progress value={metrics.passRate} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Students passing with C or better
            </p>
          </div>

          {/* Engagement Score */}
          <div className={`p-4 rounded-lg border ${getScoreBgColor(metrics.engagementScore)}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">Engagement Score</p>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className={`text-2xl font-bold mb-2 ${getScoreColor(metrics.engagementScore)}`}>
              {metrics.engagementScore.toFixed(1)}%
            </p>
            <div className="h-2">
              <Progress value={metrics.engagementScore} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Class participation and interaction
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

