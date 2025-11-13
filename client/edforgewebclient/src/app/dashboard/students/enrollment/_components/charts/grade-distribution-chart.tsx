"use client"

import { useEffect, useState } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { GradeDistributionData } from "@/lib/schemas"
import { getChartColors } from "@/lib/chart-colors"

interface GradeDistributionChartProps {
  data: GradeDistributionData[]
}

const getGradientId = (index: number) => `colorGrade${index}`

export function GradeDistributionChart({ data }: GradeDistributionChartProps) {
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

  const CHART_COLORS = [
    colors.chart3, // Blue
    colors.chart2, // Green
    colors.chart1, // Warm Red
    colors.chart4, // Amber
    colors.chart5, // Purple
  ]

  const borderColor = isDark ? '#4B5563' : '#E5E7EB'
  const textColor = isDark ? '#9CA3AF' : '#6B7280'
  const bgColor = isDark ? '#1F2937' : '#FFFFFF'
  const textColorDark = isDark ? '#F9FAFB' : '#111827'

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-4 border-b border-border/50">
        <CardTitle className="text-lg font-semibold text-foreground">Grade Distribution</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              {CHART_COLORS.map((color, index) => (
                <linearGradient key={index} id={getGradientId(index)} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={color} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.6} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={borderColor} opacity={0.3} />
            <XAxis
              type="number"
              stroke={textColor}
              style={{ fontSize: "12px" }}
              tick={{ fill: textColor }}
            />
            <YAxis
              dataKey="grade"
              type="category"
              stroke={textColor}
              style={{ fontSize: "12px" }}
              width={100}
              tick={{ fill: textColor }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: bgColor,
                border: `1px solid ${borderColor}`,
                borderRadius: "0.5rem",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
              }}
              labelStyle={{ color: textColorDark, fontWeight: 600 }}
              formatter={(value: number) => [value, "Students"]}
            />
            <Bar dataKey="count" radius={[0, 6, 6, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={`url(#${getGradientId(index % CHART_COLORS.length)})`}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

