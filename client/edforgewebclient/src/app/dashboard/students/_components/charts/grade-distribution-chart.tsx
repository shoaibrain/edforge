"use client"

import { useEffect, useState } from "react"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { getChartColors } from "@/lib/chart-colors"
import { Award } from "lucide-react"

interface GradeDistributionChartProps {
  data: Array<{
    grade: string
    count: number
    percentage: number
  }>
}

const RADIAN = Math.PI / 180

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

  const borderColor = isDark ? '#4B5563' : '#E5E7EB'
  const bgColor = isDark ? '#1F2937' : '#FFFFFF'
  const textColorDark = isDark ? '#F9FAFB' : '#111827'
  const textColor = isDark ? '#9CA3AF' : '#6B7280'

  const gradeColors = {
    A: colors.chart2, // Green
    B: colors.chart3, // Blue
    C: colors.chart4, // Amber
    D: colors.chart1, // Red
    F: colors.chart1, // Red
  }

  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + radius * Math.cos(-midAngle * RADIAN)
    const y = cy + radius * Math.sin(-midAngle * RADIAN)

    return (
      <text
        x={x}
        y={y}
        fill={textColorDark}
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize={11}
        fontWeight={600}
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    )
  }

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
          <Award className="h-4 w-4 text-primary" />
          Grade Distribution
        </CardTitle>
        <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
          Overall grade distribution across all active students. Higher concentration in A-B range indicates strong academic performance.
          <span className="text-muted-foreground/60"> EMIS:</span> Critical for identifying academic trends and intervention needs.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <defs>
              {data.map((entry, index) => (
                <linearGradient key={`gradeGradient-${index}`} id={`gradeGradient-${index}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={gradeColors[entry.grade as keyof typeof gradeColors] || colors.chart1} stopOpacity={0.9} />
                  <stop offset="95%" stopColor={gradeColors[entry.grade as keyof typeof gradeColors] || colors.chart1} stopOpacity={0.5} />
                </linearGradient>
              ))}
            </defs>
            <Pie
              data={data as any}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={renderCustomLabel}
              outerRadius={90}
              innerRadius={40}
              fill="#8884d8"
              dataKey="count"
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={`url(#gradeGradient-${index})`}
                  stroke={bgColor}
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
              formatter={(value: any, name: any, props: any) => [
                `${value} students (${props.payload.percentage.toFixed(1)}%)`,
                `Grade ${props.payload.grade}`,
              ]}
            />
            <Legend
              wrapperStyle={{ paddingTop: "10px" }}
              formatter={(value, entry: any) => (
                <span style={{ color: textColorDark }}>Grade {value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="mt-2.5 px-1">
          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            <span className="font-medium text-muted-foreground">Insight:</span>{" "}
            {data.find((g) => g.grade === 'A')?.percentage.toFixed(1) || 0}% of students achieve A grades, 
            indicating strong academic performance across the school.{" "}
            <span className="text-muted-foreground/60">SABER:</span> Grade distribution data enables 
            identification of curriculum effectiveness and areas needing instructional support.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

