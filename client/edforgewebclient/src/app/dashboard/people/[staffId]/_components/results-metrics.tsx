"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Target, TrendingUp, Users, CheckCircle2, AlertCircle } from "lucide-react"

interface ResultsMetricsProps {
  metrics: {
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

export function ResultsMetrics({ metrics }: ResultsMetricsProps) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {/* Student Achievement */}
      <Card className="border-border bg-card shadow-md">
        <CardHeader className="pb-4 border-b border-border/50">
          <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Target className="h-5 w-5 text-success" />
            Student Achievement
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-success/5 border border-success/20">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-foreground">Pass Rate</p>
                <CheckCircle2 className="h-4 w-4 text-success" />
              </div>
              <p className="text-2xl font-bold text-success">{metrics.studentAchievement.passRate}%</p>
            </div>

            <div className="p-3 rounded-lg bg-info/5 border border-info/20">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-foreground">Grade Improvement</p>
                <TrendingUp className="h-4 w-4 text-info" />
              </div>
              <p className="text-2xl font-bold text-info">+{metrics.studentAchievement.gradeImprovement}%</p>
            </div>

            <div className="p-3 rounded-lg bg-accent/5 border border-accent/20">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-foreground">College Readiness</p>
                <Target className="h-4 w-4 text-accent" />
              </div>
              <p className="text-2xl font-bold text-accent">{metrics.studentAchievement.collegeReadiness}%</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Engagement Metrics */}
      <Card className="border-border bg-card shadow-md">
        <CardHeader className="pb-4 border-b border-border/50">
          <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Engagement Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-foreground">Class Participation</p>
                <Users className="h-4 w-4 text-primary" />
              </div>
              <p className="text-2xl font-bold text-primary">{metrics.engagement.classParticipation}%</p>
            </div>

            <div className="p-3 rounded-lg bg-success/5 border border-success/20">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-foreground">Assignment Completion</p>
                <CheckCircle2 className="h-4 w-4 text-success" />
              </div>
              <p className="text-2xl font-bold text-success">{metrics.engagement.assignmentCompletion}%</p>
            </div>

            <div className="p-3 rounded-lg bg-info/5 border border-info/20">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-foreground">Attendance Correlation</p>
                <TrendingUp className="h-4 w-4 text-info" />
              </div>
              <p className="text-2xl font-bold text-info">{(metrics.engagement.attendanceCorrelation * 100).toFixed(0)}%</p>
              <p className="text-xs text-muted-foreground mt-1">
                Teacher attendance impact on student attendance
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Intervention Success */}
      <Card className="border-border bg-card shadow-md">
        <CardHeader className="pb-4 border-b border-border/50">
          <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-warning" />
            Intervention Success
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-warning/5 border border-warning/20">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-foreground">Success Rate</p>
                <CheckCircle2 className="h-4 w-4 text-warning" />
              </div>
              <p className="text-2xl font-bold text-warning">{metrics.interventionSuccess.successRate}%</p>
              <p className="text-xs text-muted-foreground mt-1">
                Successful student interventions
              </p>
            </div>

            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-foreground">Students Helped</p>
                <Users className="h-4 w-4 text-primary" />
              </div>
              <p className="text-2xl font-bold text-primary">{metrics.interventionSuccess.studentsHelped}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Students receiving targeted support
              </p>
            </div>

            <div className="p-3 rounded-lg bg-success/5 border border-success/20">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-foreground">Average Improvement</p>
                <TrendingUp className="h-4 w-4 text-success" />
              </div>
              <p className="text-2xl font-bold text-success">+{metrics.interventionSuccess.averageImprovement}%</p>
              <p className="text-xs text-muted-foreground mt-1">
                Average grade improvement after intervention
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

