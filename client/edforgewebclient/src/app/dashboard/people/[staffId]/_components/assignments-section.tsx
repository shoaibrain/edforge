"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BookOpen, Users, Eye, TrendingUp, AlertTriangle, Award, Calendar, Clock, BarChart3 } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useMemo } from "react"
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts"
import { getChartColors } from "@/lib/chart-colors"
import { useEffect, useState } from "react"

interface AssignmentsSectionProps {
  assignments: Array<{
    classId: string
    className: string
    subject: string
    grade: string
    studentCount: number
    capacity?: number
    averageGrade?: number
    passRate?: number
    attendanceRate?: number
    room?: string
    schedule?: string
    themeColor?: string
    recentActivity?: string
    studentGrowth?: number
    strugglingStudentsCount?: number
    excellingStudentsCount?: number
    gradeTrend?: number[]
  }>
}

export function AssignmentsSection({ assignments }: AssignmentsSectionProps) {
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

  const getPerformanceStatus = (averageGrade?: number, passRate?: number) => {
    if (!averageGrade) return { status: "unknown", color: "muted", label: "N/A" }
    if (averageGrade >= 90 && (passRate ?? 0) >= 95) return { status: "excellent", color: "success", label: "Excellent" }
    if (averageGrade >= 85 && (passRate ?? 0) >= 90) return { status: "good", color: "info", label: "Good" }
    if (averageGrade >= 80 && (passRate ?? 0) >= 85) return { status: "acceptable", color: "warning", label: "Acceptable" }
    return { status: "needs_attention", color: "error", label: "Needs Attention" }
  }

  const getThemeGradient = (themeColor: string) => {
    // Convert hex to RGB for gradient
    const hex = themeColor.replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)
    return `linear-gradient(135deg, rgba(${r}, ${g}, ${b}, 0.2) 0%, rgba(${r}, ${g}, ${b}, 0.4) 100%)`
  }

  // Mini sparkline chart for grade trend
  const MiniTrendChart = ({ data, color }: { data: number[], color: string }) => {
    if (!data || data.length === 0) return null

    const chartData = data.map((value, index) => ({ period: `Q${index + 1}`, value }))
    const borderColor = isDark ? '#4B5563' : '#E5E7EB'
    const textColor = isDark ? '#9CA3AF' : '#6B7280'

    return (
      <ResponsiveContainer width="100%" height={40}>
        <LineChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={false}
          />
          <XAxis dataKey="period" hide />
          <YAxis hide />
          <Tooltip content={() => null} />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Teaching Assignments
          </CardTitle>
          <Button variant="outline" size="sm">
            View All Classes
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {assignments.map((assignment) => {
            const performance = getPerformanceStatus(assignment.averageGrade, assignment.passRate)
            const themeColor = assignment.themeColor || "#3B82F6"
            const capacity = assignment.capacity || assignment.studentCount
            const enrollmentPercent = (assignment.studentCount / capacity) * 100

            return (
              <div
                key={assignment.classId}
                className="rounded-lg border border-border bg-card hover:shadow-lg transition-all duration-200 overflow-hidden group"
              >
                {/* Banner Section */}
                <div
                  className="relative h-32 overflow-hidden"
                  style={{
                    background: getThemeGradient(themeColor),
                  }}
                >
                  {/* Decorative Pattern Overlay */}
                  <div className="absolute inset-0 opacity-10">
                    <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                      <defs>
                        <pattern id={`grid-${assignment.classId}`} width="40" height="40" patternUnits="userSpaceOnUse">
                          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill={`url(#grid-${assignment.classId})`} />
                    </svg>
                  </div>

                  {/* Class Icon/Initial */}
                  <div
                    className="absolute top-4 left-4 h-12 w-12 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-lg"
                    style={{ backgroundColor: themeColor }}
                  >
                    {assignment.className.charAt(0)}
                  </div>

                  {/* Class Title Overlay */}
                  <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/60 to-transparent">
                    <h3 className="text-lg font-bold text-white">{assignment.className}</h3>
                    <p className="text-sm text-white/80 mt-0.5">
                      {assignment.subject} • Grade {assignment.grade}
                    </p>
                  </div>

                  {/* Performance Badge */}
                  {assignment.averageGrade && (
                    <div className="absolute top-4 right-4">
                      <Badge
                        variant="secondary"
                        className={`bg-white/90 text-foreground border-0 shadow-md ${
                          performance.status === "excellent" ? "text-success" :
                          performance.status === "good" ? "text-info" :
                          performance.status === "acceptable" ? "text-warning" : "text-error"
                        }`}
                      >
                        {assignment.averageGrade.toFixed(1)}%
                      </Badge>
                    </div>
                  )}
                </div>

                {/* Card Content */}
                <div className="p-4 space-y-4">

                  {/* Student Alerts */}
                  <div className="flex items-center gap-3 text-xs">
                    {assignment.strugglingStudentsCount !== undefined && assignment.strugglingStudentsCount > 0 && (
                      <div className="flex items-center gap-1 text-error">
                        <AlertTriangle className="h-3 w-3" />
                        <span>{assignment.strugglingStudentsCount} struggling</span>
                      </div>
                    )}
                    {assignment.excellingStudentsCount !== undefined && assignment.excellingStudentsCount > 0 && (
                      <div className="flex items-center gap-1 text-success">
                        <Award className="h-3 w-3" />
                        <span>{assignment.excellingStudentsCount} excelling</span>
                      </div>
                    )}
                  </div>

                  {/* Room & Schedule */}
                  {(assignment.room || assignment.schedule) && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border">
                      {assignment.room && (
                        <div className="flex items-center gap-1">
                          <BookOpen className="h-3 w-3" />
                          <span>{assignment.room}</span>
                        </div>
                      )}
                      {assignment.schedule && (
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span className="truncate">{assignment.schedule}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Recent Activity */}
                  {assignment.recentActivity && (
                    <p className="text-xs text-muted-foreground italic">
                      {assignment.recentActivity}
                    </p>
                  )}

                  {/* Status Badge */}
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <Badge
                      variant="outline"
                      className={
                        performance.status === "excellent" ? "bg-success/10 text-success border-success/20" :
                        performance.status === "good" ? "bg-info/10 text-info border-info/20" :
                        performance.status === "acceptable" ? "bg-warning/10 text-warning border-warning/20" :
                        "bg-error/10 text-error border-error/20"
                      }
                    >
                      {performance.label}
                    </Badge>
                    <Link href={`/dashboard/classes/${assignment.classId}`}>
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {assignments.length === 0 && (
          <div className="text-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-semibold text-foreground mb-2">No assignments</p>
            <p className="text-sm text-muted-foreground">
              This staff member is not currently assigned to any classes
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
