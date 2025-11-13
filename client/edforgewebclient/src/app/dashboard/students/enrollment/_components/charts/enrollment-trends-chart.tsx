"use client"

import { useEffect, useState } from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { EnrollmentTrendData } from "@/lib/schemas"
import { getChartColors } from "@/lib/chart-colors"

interface EnrollmentTrendsChartProps {
  data: EnrollmentTrendData[]
}

export function EnrollmentTrendsChart({ data }: EnrollmentTrendsChartProps) {
  const [colors, setColors] = useState(getChartColors(false))
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    // Detect dark mode
    const checkDarkMode = () => {
      const darkMode = document.documentElement.classList.contains('dark')
      setIsDark(darkMode)
      setColors(getChartColors(darkMode))
    }
    
    checkDarkMode()
    
    // Watch for theme changes
    const observer = new MutationObserver(checkDarkMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    
    return () => observer.disconnect()
  }, [])

  const borderColor = isDark ? '#4B5563' : '#E5E7EB'
  const textColor = isDark ? '#9CA3AF' : '#6B7280'

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-4 border-b border-border/50">
        <CardTitle className="text-lg font-semibold text-foreground">Enrollment Trends</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorEnrollments" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.chart3} stopOpacity={0.8} />
                <stop offset="95%" stopColor={colors.chart3} stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.chart2} stopOpacity={0.8} />
                <stop offset="95%" stopColor={colors.chart2} stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="colorPending" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.chart4} stopOpacity={0.8} />
                <stop offset="95%" stopColor={colors.chart4} stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={borderColor} opacity={0.3} />
            <XAxis
              dataKey="date"
              stroke={textColor}
              style={{ fontSize: "12px" }}
              tick={{ fill: textColor }}
            />
            <YAxis
              stroke={textColor}
              style={{ fontSize: "12px" }}
              tick={{ fill: textColor }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
                border: `1px solid ${borderColor}`,
                borderRadius: "0.5rem",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
              }}
              labelStyle={{ color: isDark ? '#F9FAFB' : '#111827', fontWeight: 600 }}
            />
            <Legend
              wrapperStyle={{ paddingTop: "20px" }}
              iconType="line"
            />
            <Line
              type="monotone"
              dataKey="enrollments"
              stroke={colors.chart3}
              strokeWidth={3}
              name="Total Enrollments"
              dot={{ fill: colors.chart3, r: 5, strokeWidth: 2, stroke: isDark ? '#1F2937' : '#FFFFFF' }}
              activeDot={{ r: 7, fill: colors.chart3 }}
            />
            <Line
              type="monotone"
              dataKey="completed"
              stroke={colors.chart2}
              strokeWidth={3}
              name="Completed"
              dot={{ fill: colors.chart2, r: 5, strokeWidth: 2, stroke: isDark ? '#1F2937' : '#FFFFFF' }}
              activeDot={{ r: 7, fill: colors.chart2 }}
            />
            <Line
              type="monotone"
              dataKey="pending"
              stroke={colors.chart4}
              strokeWidth={3}
              name="Pending"
              dot={{ fill: colors.chart4, r: 5, strokeWidth: 2, stroke: isDark ? '#1F2937' : '#FFFFFF' }}
              activeDot={{ r: 7, fill: colors.chart4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

