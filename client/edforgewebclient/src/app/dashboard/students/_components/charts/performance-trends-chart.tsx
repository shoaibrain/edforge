"use client"

import { useEffect, useState } from "react"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { getChartColors } from "@/lib/chart-colors"
import { TrendingUp, BarChart3 } from "lucide-react"

interface PerformanceTrendsChartProps {
  data: Array<{
    period: string
    averageGPA: number
    averageScore?: number
    improvement?: number
  }>
}

export function PerformanceTrendsChart({ data }: PerformanceTrendsChartProps) {
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
                {entry.name}: <span className="font-medium text-foreground">{entry.value.toFixed(2)}</span>
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
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Performance Trends
            </CardTitle>
            <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
              Average GPA trends over the last 12 months. Tracks overall academic performance trajectory.
              <span className="text-muted-foreground/60"> SABER:</span> Enables identification of systemic improvements or declines.
            </CardDescription>
          </div>
          {data.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3 text-success" />
              <span>
                {data[data.length - 1]?.averageGPA > data[0]?.averageGPA ? '+' : ''}
                {(data[data.length - 1]?.averageGPA - data[0]?.averageGPA).toFixed(2)} GPA
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="gpaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.chart3} stopOpacity={0.3} />
                <stop offset="95%" stopColor={colors.chart3} stopOpacity={0.05} />
              </linearGradient>
              {data[0]?.averageScore !== undefined && (
                <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.chart2} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={colors.chart2} stopOpacity={0.05} />
                </linearGradient>
              )}
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
              domain={[0, 4]}
            />
            <Tooltip cursor={{ fill: isDark ? '#374151' : '#F3F4F6' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" />
            <Area
              type="monotone"
              dataKey="averageGPA"
              stroke={colors.chart3}
              fill="url(#gpaGradient)"
              name="Average GPA"
              strokeWidth={2}
              dot={{ r: 3, fill: colors.chart3, stroke: bgColor, strokeWidth: 1 }}
              activeDot={{ r: 5, fill: colors.chart3, stroke: bgColor, strokeWidth: 2 }}
            />
            {data[0]?.averageScore !== undefined && (
              <Area
                type="monotone"
                dataKey="averageScore"
                stroke={colors.chart2}
                fill="url(#scoreGradient)"
                name="Average Score (%)"
                strokeWidth={2}
                dot={{ r: 3, fill: colors.chart2, stroke: bgColor, strokeWidth: 1 }}
                activeDot={{ r: 5, fill: colors.chart2, stroke: bgColor, strokeWidth: 2 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
        <div className="mt-2.5 px-1">
          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            <span className="font-medium text-muted-foreground">Insight:</span>{" "}
            Average GPA improved from {data[0]?.averageGPA.toFixed(2)} to {data[data.length - 1]?.averageGPA.toFixed(2)} 
            over 12 months, indicating positive academic trajectory.{" "}
            <span className="text-muted-foreground/60">EMIS:</span> Trend analysis enables proactive 
            identification of performance patterns and intervention timing.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

