"use client"

import { useEffect, useState } from "react"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { getChartColors } from "@/lib/chart-colors"
import { Users, TrendingUp } from "lucide-react"

interface EnrollmentTrendsChartProps {
  data: Array<{
    period: string
    total: number
    active: number
    graduated?: number
    transferred?: number
  }>
}

export function EnrollmentTrendsChart({ data }: EnrollmentTrendsChartProps) {
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
                {entry.name}: <span className="font-medium text-foreground">{entry.value}</span>
              </p>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  const totalGrowth = data.length > 0 ? data[data.length - 1].total - data[0].total : 0

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Enrollment Trends
            </CardTitle>
            <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
              Enrollment patterns over time showing total, active, and graduated students.
              <span className="text-muted-foreground/60"> EMIS:</span> Critical for capacity planning and resource allocation.
            </CardDescription>
          </div>
          {totalGrowth > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3 text-success" />
              <span>+{totalGrowth} students</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.chart3} stopOpacity={0.3} />
                <stop offset="95%" stopColor={colors.chart3} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="activeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.chart2} stopOpacity={0.3} />
                <stop offset="95%" stopColor={colors.chart2} stopOpacity={0.05} />
              </linearGradient>
              {data[0]?.graduated !== undefined && (
                <linearGradient id="graduatedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.chart5} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={colors.chart5} stopOpacity={0.05} />
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
            />
            <Tooltip cursor={{ fill: isDark ? '#374151' : '#F3F4F6' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" />
            <Area
              type="monotone"
              dataKey="total"
              stroke={colors.chart3}
              fill="url(#totalGradient)"
              name="Total Students"
              strokeWidth={2}
              dot={{ r: 3, fill: colors.chart3, stroke: bgColor, strokeWidth: 1 }}
              activeDot={{ r: 5, fill: colors.chart3, stroke: bgColor, strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="active"
              stroke={colors.chart2}
              fill="url(#activeGradient)"
              name="Active Students"
              strokeWidth={2}
              dot={{ r: 3, fill: colors.chart2, stroke: bgColor, strokeWidth: 1 }}
              activeDot={{ r: 5, fill: colors.chart2, stroke: bgColor, strokeWidth: 2 }}
            />
            {data[0]?.graduated !== undefined && (
              <Area
                type="monotone"
                dataKey="graduated"
                stroke={colors.chart5}
                fill="url(#graduatedGradient)"
                name="Graduated"
                strokeWidth={2}
                dot={{ r: 3, fill: colors.chart5, stroke: bgColor, strokeWidth: 1 }}
                activeDot={{ r: 5, fill: colors.chart5, stroke: bgColor, strokeWidth: 2 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
        <div className="mt-2.5 px-1">
          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            <span className="font-medium text-muted-foreground">Insight:</span>{" "}
            Total enrollment shows {totalGrowth > 0 ? 'growth' : 'stability'} with {data[data.length - 1]?.active} active students. 
            Enrollment trends inform capacity planning and resource allocation decisions.{" "}
            <span className="text-muted-foreground/60">SABER:</span> Enrollment data quality ensures accurate 
            system-wide planning and policy decisions.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

