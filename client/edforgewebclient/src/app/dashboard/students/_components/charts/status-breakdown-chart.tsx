"use client"

import { useEffect, useState } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { getChartColors } from "@/lib/chart-colors"
import { Users } from "lucide-react"

interface StatusBreakdownChartProps {
  data: Array<{
    status: string
    count: number
    percentage: number
    color: string
  }>
}

export function StatusBreakdownChart({ data }: StatusBreakdownChartProps) {
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

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = data.find((d) => d.status === label)
      return (
        <div
          className="p-3 rounded-lg shadow-lg"
          style={{
            backgroundColor: bgColor,
            border: `1px solid ${borderColor}`,
          }}
        >
          <p className="text-sm font-semibold text-foreground mb-2">{label}</p>
          <p className="text-xs text-muted-foreground">
            Count: <span className="font-medium text-foreground">{payload[0].value}</span>
          </p>
          {dataPoint && (
            <p className="text-xs text-muted-foreground">
              Percentage: <span className="font-medium text-foreground">{dataPoint.percentage.toFixed(1)}%</span>
            </p>
          )}
        </div>
      )
    }
    return null
  }

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Status Breakdown
        </CardTitle>
        <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
          Distribution of students by enrollment status. Provides overview of student population composition.
          <span className="text-muted-foreground/60"> EMIS:</span> Essential for tracking student lifecycle and retention.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={borderColor} opacity={0.3} />
            <XAxis
              dataKey="status"
              stroke={textColor}
              style={{ fontSize: "10px" }}
              tick={{ fill: textColor }}
            />
            <YAxis
              stroke={textColor}
              style={{ fontSize: "10px" }}
              tick={{ fill: textColor }}
            />
            <Tooltip cursor={{ fill: isDark ? '#374151' : '#F3F4F6' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" />
            <Bar dataKey="count" name="Student Count" radius={[4, 4, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-2.5 px-1">
          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            <span className="font-medium text-muted-foreground">Insight:</span>{" "}
            {data.find((s) => s.status === 'active')?.percentage.toFixed(1) || 0}% of students are active, 
            indicating healthy enrollment retention.{" "}
            <span className="text-muted-foreground/60">SABER:</span> Status tracking enables identification 
            of retention challenges and success factors.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

