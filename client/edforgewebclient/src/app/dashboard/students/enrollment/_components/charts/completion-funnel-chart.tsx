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
import type { CompletionFunnelData } from "@/lib/schemas"
import { getChartColors } from "@/lib/chart-colors"

interface CompletionFunnelChartProps {
  data: CompletionFunnelData[]
}

export function CompletionFunnelChart({ data }: CompletionFunnelChartProps) {
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

  const FUNNEL_COLORS = [
    { color: colors.primary, id: "funnelPrimary" },
    { color: colors.secondary, id: "funnelSecondary" },
    { color: colors.chart2, id: "funnelSuccess" },
    { color: colors.accent, id: "funnelAccent" },
  ]

  const borderColor = isDark ? '#4B5563' : '#E5E7EB'
  const textColor = isDark ? '#9CA3AF' : '#6B7280'
  const bgColor = isDark ? '#1F2937' : '#FFFFFF'
  const textColorDark = isDark ? '#F9FAFB' : '#111827'

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-4 border-b border-border/50">
        <CardTitle className="text-lg font-semibold text-foreground">Completion Funnel</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              {FUNNEL_COLORS.map((item, index) => (
                <linearGradient key={index} id={item.id} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={item.color} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={item.color} stopOpacity={0.5} />
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
              dataKey="step"
              type="category"
              stroke={textColor}
              style={{ fontSize: "12px" }}
              width={140}
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
              formatter={(value: number, name: string, props: any) => [
                `${value} (${props.payload.percentage}%)`,
                "Count",
              ]}
            />
            <Bar dataKey="count" radius={[0, 6, 6, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={`url(#${FUNNEL_COLORS[index % FUNNEL_COLORS.length].id})`}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

