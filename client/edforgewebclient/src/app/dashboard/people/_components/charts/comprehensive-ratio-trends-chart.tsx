"use client"

import { useEffect, useState, useMemo } from "react"
import {
  LineChart,
  Line,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getChartColors } from "@/lib/chart-colors"
import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2 } from "lucide-react"
import type { ComprehensiveRatioTrend } from "@/lib/schemas"

interface ComprehensiveRatioTrendsChartProps {
  data: ComprehensiveRatioTrend[]
  optimalRatio?: number
  acceptableRange?: { min: number; max: number }
  warningThreshold?: number
  criticalThreshold?: number
}

const getGradientId = (prefix: string) => `${prefix}Gradient`

export function ComprehensiveRatioTrendsChart({
  data,
  optimalRatio = 15,
  acceptableRange = { min: 15, max: 20 },
  warningThreshold = 20,
  criticalThreshold = 25,
}: ComprehensiveRatioTrendsChartProps) {
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

  // Prepare chart data
  const chartData = useMemo(() => {
    return data.map((item) => ({
      month: new Date(item.month + '-01').toLocaleDateString('en-US', { month: 'short' }),
      monthRaw: item.month,
      studentToTeacherRatio: item.studentToTeacherRatio,
      teacherToStudentRatio: item.teacherToStudentRatio,
      studentCount: item.studentCount,
      teacherCount: item.teacherCount,
      averageStudentGrade: item.averageStudentGrade ?? null,
      passRate: item.passRate ?? null,
      status: item.status,
      trend: item.trend,
    }))
  }, [data])

  // Current metrics
  const currentData = useMemo(() => chartData[chartData.length - 1], [chartData])
  const previousData = useMemo(() => chartData[chartData.length - 2], [chartData])

  // Calculate trend direction
  const ratioTrend = useMemo(() => {
    if (!currentData || !previousData) return 'stable'
    if (currentData.studentToTeacherRatio < previousData.studentToTeacherRatio) return 'improving'
    if (currentData.studentToTeacherRatio > previousData.studentToTeacherRatio) return 'declining'
    return 'stable'
  }, [currentData, previousData])

  const borderColor = isDark ? '#4B5563' : '#E5E7EB'
  const textColor = isDark ? '#9CA3AF' : '#6B7280'
  const bgColor = isDark ? '#1F2937' : '#FFFFFF'
  const textColorDark = isDark ? '#F9FAFB' : '#111827'

  // Status color mapping
  const statusColors = {
    optimal: colors.chart2, // Green
    acceptable: colors.chart4, // Amber
    concerning: colors.chart1, // Red
    critical: '#DC2626', // Dark red
  }

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = chartData.find((d) => d.month === label)
      if (!dataPoint) return null

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
              <span style={{ color: textColor }}>Student-to-Teacher: </span>
              <span style={{ color: textColorDark, fontWeight: 600 }}>
                {dataPoint.studentToTeacherRatio.toFixed(1)}:1
              </span>
            </div>
            <div style={{ marginBottom: "6px", fontSize: "12px" }}>
              <span style={{ color: textColor }}>Teacher-to-Student: </span>
              <span style={{ color: textColorDark, fontWeight: 600 }}>
                {dataPoint.teacherToStudentRatio.toFixed(3)}:1
              </span>
            </div>
            <div style={{ marginBottom: "6px", fontSize: "12px" }}>
              <span style={{ color: textColor }}>Students: </span>
              <span style={{ color: textColorDark, fontWeight: 600 }}>
                {dataPoint.studentCount.toLocaleString()}
              </span>
            </div>
            <div style={{ marginBottom: "6px", fontSize: "12px" }}>
              <span style={{ color: textColor }}>Teachers: </span>
              <span style={{ color: textColorDark, fontWeight: 600 }}>
                {dataPoint.teacherCount.toLocaleString()}
              </span>
            </div>
            {dataPoint.averageStudentGrade !== null && (
              <div style={{ marginBottom: "6px", fontSize: "12px" }}>
                <span style={{ color: textColor }}>Avg Grade: </span>
                <span style={{ color: textColorDark, fontWeight: 600 }}>
                  {dataPoint.averageStudentGrade.toFixed(1)}%
                </span>
              </div>
            )}
            {dataPoint.passRate !== null && (
              <div style={{ marginBottom: "6px", fontSize: "12px" }}>
                <span style={{ color: textColor }}>Pass Rate: </span>
                <span style={{ color: textColorDark, fontWeight: 600 }}>
                  {dataPoint.passRate.toFixed(1)}%
                </span>
              </div>
            )}
            {dataPoint.status && (
              <div style={{ marginBottom: "6px", fontSize: "12px" }}>
                <span style={{ color: textColor }}>Status: </span>
                <span style={{ 
                  color: statusColors[dataPoint.status as keyof typeof statusColors] || textColorDark,
                  fontWeight: 600 
                }}>
                  {dataPoint.status.charAt(0).toUpperCase() + dataPoint.status.slice(1)}
                </span>
              </div>
            )}
            {dataPoint.trend && (
              <div style={{ fontSize: "12px" }}>
                <span style={{ color: textColor }}>Trend: </span>
                <span style={{ 
                  color: dataPoint.trend === 'improving' ? colors.chart2 : 
                         dataPoint.trend === 'declining' ? colors.chart1 : textColorDark,
                  fontWeight: 600 
                }}>
                  {dataPoint.trend.charAt(0).toUpperCase() + dataPoint.trend.slice(1)}
                </span>
              </div>
            )}
          </div>
        </div>
      )
    }
    return null
  }

  // Trend icon
  const TrendIcon = ({ trend }: { trend: string }) => {
    switch (trend) {
      case 'improving':
        return <TrendingUp className="h-4 w-4 text-success" />
      case 'declining':
        return <TrendingDown className="h-4 w-4 text-error" />
      default:
        return <Minus className="h-4 w-4 text-muted-foreground" />
    }
  }

  // Status icon
  const StatusIcon = ({ status }: { status?: string }) => {
    switch (status) {
      case 'optimal':
        return <CheckCircle2 className="h-4 w-4 text-success" />
      case 'acceptable':
        return <Minus className="h-4 w-4 text-warning" />
      case 'concerning':
      case 'critical':
        return <AlertTriangle className="h-4 w-4 text-error" />
      default:
        return null
    }
  }

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Ratio Trends & Outcomes
            </CardTitle>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
              Tracks student-to-teacher ratios with outcome correlations over time.{" "}
              <span className="text-muted-foreground/60">SABER:</span> Critical metric for 
              resource allocation decisions. Lower ratios (fewer students per teacher) typically 
              correlate with improved student performance and outcomes.
            </p>
          </div>
          {currentData && (
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <StatusIcon status={currentData.status} />
                <span className="text-muted-foreground capitalize">
                  {currentData.status || 'N/A'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <TrendIcon trend={ratioTrend} />
                <span className="text-muted-foreground capitalize">
                  {ratioTrend}
                </span>
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart
            data={chartData}
            margin={{ top: 5, right: 30, left: 0, bottom: 40 }}
          >
            <defs>
              <linearGradient id={getGradientId("student")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.chart3} stopOpacity={0.3} />
                <stop offset="95%" stopColor={colors.chart3} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id={getGradientId("teacher")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.chart2} stopOpacity={0.3} />
                <stop offset="95%" stopColor={colors.chart2} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={borderColor} opacity={0.3} />
            <XAxis
              dataKey="month"
              stroke={textColor}
              style={{ fontSize: "10px" }}
              tick={{ fill: textColor }}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis
              yAxisId="ratio"
              stroke={textColor}
              style={{ fontSize: "12px" }}
              tick={{ fill: textColor }}
              label={{ value: 'Ratio', angle: -90, position: 'insideLeft', style: { fill: textColor } }}
              domain={[0, 'dataMax + 5']}
            />
            <YAxis
              yAxisId="outcome"
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
              wrapperStyle={{ paddingBottom: "10px" }}
              formatter={(value) => (
                <span style={{ color: textColorDark, fontSize: "12px" }}>{value}</span>
              )}
            />
            {/* Reference lines for benchmarks */}
            <ReferenceLine
              yAxisId="ratio"
              y={optimalRatio}
              stroke={colors.chart2}
              strokeDasharray="5 5"
              label={{ value: "Optimal", position: "top", style: { fill: colors.chart2, fontSize: "10px" } }}
            />
            <ReferenceLine
              yAxisId="ratio"
              y={acceptableRange.max}
              stroke={colors.chart4}
              strokeDasharray="3 3"
              label={{ value: "Acceptable Max", position: "top", style: { fill: colors.chart4, fontSize: "10px" } }}
            />
            <ReferenceLine
              yAxisId="ratio"
              y={warningThreshold}
              stroke={colors.chart1}
              strokeDasharray="3 3"
              label={{ value: "Warning", position: "top", style: { fill: colors.chart1, fontSize: "10px" } }}
            />
            {/* Background areas for student/teacher counts */}
            <Area
              yAxisId="ratio"
              type="monotone"
              dataKey="studentCount"
              stroke="none"
              fill={`url(#${getGradientId("student")})`}
              name="Student Count (scaled)"
              opacity={0.3}
            />
            <Area
              yAxisId="ratio"
              type="monotone"
              dataKey="teacherCount"
              stroke="none"
              fill={`url(#${getGradientId("teacher")})`}
              name="Teacher Count (scaled)"
              opacity={0.3}
            />
            {/* Main ratio lines */}
            <Line
              yAxisId="ratio"
              type="monotone"
              dataKey="studentToTeacherRatio"
              stroke={colors.chart3}
              strokeWidth={3}
              dot={{ fill: colors.chart3, r: 5, strokeWidth: 2, stroke: bgColor }}
              activeDot={{ r: 7, fill: colors.chart3 }}
              name="Student-to-Teacher Ratio"
            />
            <Line
              yAxisId="ratio"
              type="monotone"
              dataKey="teacherToStudentRatio"
              stroke={colors.chart2}
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ fill: colors.chart2, r: 4, strokeWidth: 2, stroke: bgColor }}
              activeDot={{ r: 6, fill: colors.chart2 }}
              name="Teacher-to-Student Ratio (inverse)"
            />
            {/* Outcome correlation lines */}
            {chartData.some((d) => d.averageStudentGrade !== null) && (
              <Line
                yAxisId="outcome"
                type="monotone"
                dataKey="averageStudentGrade"
                stroke={colors.chart5}
                strokeWidth={2}
                dot={false}
                name="Avg Student Grade (%)"
                opacity={0.8}
              />
            )}
            {chartData.some((d) => d.passRate !== null) && (
              <Line
                yAxisId="outcome"
                type="monotone"
                dataKey="passRate"
                stroke={colors.chart4}
                strokeWidth={2}
                dot={false}
                name="Pass Rate (%)"
                opacity={0.8}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
        {currentData && (
          <div className="mt-3 flex items-center justify-between gap-3 px-1">
            {/* Current Ratio */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div 
                className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                style={{ 
                  backgroundColor: currentData.status === "optimal" ? colors.chart2 :
                                 currentData.status === "acceptable" ? colors.chart4 :
                                 currentData.status === "concerning" ? colors.chart1 : '#DC2626'
                }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground leading-tight">
                  {currentData.studentToTeacherRatio.toFixed(1)}:1
                </p>
                <p className="text-[10px] text-muted-foreground/80 mt-0.5 capitalize">
                  Current • {currentData.status || 'N/A'}
                </p>
              </div>
            </div>

            {/* Target Ratio */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div 
                className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: colors.chart3 }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground leading-tight">
                  {optimalRatio}:1
                </p>
                <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                  Target • SABER
                </p>
              </div>
            </div>

            {/* Average Grade */}
            {currentData.averageStudentGrade !== null && (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div 
                  className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: colors.chart5 }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground leading-tight">
                    {currentData.averageStudentGrade.toFixed(1)}%
                  </p>
                  <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                    Avg Grade • Outcome
                  </p>
                </div>
              </div>
            )}

            {/* Pass Rate */}
            {currentData.passRate !== null && (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div 
                  className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: colors.chart4 }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground leading-tight">
                    {currentData.passRate.toFixed(1)}%
                  </p>
                  <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                    Pass Rate • Success
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="mt-2.5 px-1">
          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            <span className="font-medium text-muted-foreground">Decision Support:</span>{" "}
            Lower ratios correlate with improved outcomes. Use for hiring, resource allocation, 
            and class size decisions.{" "}
            <span className="text-muted-foreground/60">SABER:</span> Critical metric for 
            assessing resource efficiency and educational effectiveness in EMIS systems.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

