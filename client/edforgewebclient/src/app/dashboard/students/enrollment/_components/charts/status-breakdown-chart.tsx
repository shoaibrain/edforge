"use client"

import { useEffect, useState } from "react"
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { StatusBreakdownData } from "@/lib/schemas"
import { getChartColors } from "@/lib/chart-colors"

interface StatusBreakdownChartProps {
  data: StatusBreakdownData[]
}

const RADIAN = Math.PI / 90

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

  const getColor = (colorName: string) => {
    const colorMap: Record<string, string> = {
      success: colors.chart2,
      warning: colors.chart4,
      error: colors.chart1,
      info: colors.chart3,
      primary: colors.chart3,
    }
    return colorMap[colorName] || colors.chart3
  }

  const renderCustomLabel = ({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    percent,
  }: any) => {
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + radius * Math.cos(-midAngle * RADIAN)
    const y = cy + radius * Math.sin(-midAngle * RADIAN)

    // Use white text for dark backgrounds, dark text for light backgrounds
    const labelColor = isDark ? '#F9FAFB' : '#111827'

    return (
      <text
        x={x}
        y={y}
        fill={labelColor}
        textAnchor={x > cx ? "start" : "end"}
        dominantBaseline="central"
        fontSize={12}
        fontWeight={600}
      >
        {`${(percent * 100).toFixed(1)}%`}
      </text>
    )
  }

  const borderColor = isDark ? '#4B5563' : '#E5E7EB'
  const bgColor = isDark ? '#1F2937' : '#FFFFFF'
  const textColorDark = isDark ? '#F9FAFB' : '#111827'
  const strokeColor = isDark ? '#1F2937' : '#FFFFFF'

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-4 border-b border-border/50">
        <CardTitle className="text-lg font-semibold text-foreground">Status Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data as any}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={renderCustomLabel}
              outerRadius={100}
              innerRadius={40}
              fill="#8884d8"
              dataKey="count"
              paddingAngle={2}
            >
              {data.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={getColor(entry.color)} 
                  stroke={strokeColor} 
                  strokeWidth={2} 
                />
              ))}
            </Pie>
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
                props.payload.status,
              ]}
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              iconType="circle"
              wrapperStyle={{ paddingTop: "20px" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

