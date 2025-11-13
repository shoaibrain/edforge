"use client"

import { useEffect, useState } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { getChartColors } from "@/lib/chart-colors"
import { GraduationCap, Award } from "lucide-react"

interface GradeLevelPerformanceChartProps {
  data: Array<{
    grade: string
    averageGPA: number
    studentCount: number
    passRate?: number
  }>
}

export function GradeLevelPerformanceChart({ data }: GradeLevelPerformanceChartProps) {
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
      const dataPoint = data.find((d) => d.grade === label)
      return (
        <div
          className="p-3 rounded-lg shadow-lg"
          style={{
            backgroundColor: bgColor,
            border: `1px solid ${borderColor}`,
          }}
        >
          <p className="text-sm font-semibold text-foreground mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-xs text-muted-foreground flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}: <span className="font-medium text-foreground">{entry.value.toFixed(2)}</span>
            </p>
          ))}
          {dataPoint && (
            <p className="text-xs text-muted-foreground mt-1">
              Students: <span className="font-medium text-foreground">{dataPoint.studentCount}</span>
            </p>
          )}
        </div>
      )
    }
    return null
  }

  const bestPerformingGrade = data.reduce((prev, current) => 
    current.averageGPA > prev.averageGPA ? current : prev
  )

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-primary" />
              Grade-Level Performance
            </CardTitle>
            <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
              Average GPA comparison across grade levels. Identifies performance patterns and curriculum effectiveness.
              <span className="text-muted-foreground/60"> SABER:</span> Enables grade-specific intervention strategies.
            </CardDescription>
          </div>
          {bestPerformingGrade && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Award className="h-3 w-3 text-warning" />
              <span>Top: {bestPerformingGrade.grade}</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={borderColor} opacity={0.3} />
            <XAxis
              dataKey="grade"
              stroke={textColor}
              style={{ fontSize: "10px" }}
              tick={{ fill: textColor }}
            />
            <YAxis
              stroke={textColor}
              style={{ fontSize: "10px" }}
              tick={{ fill: textColor }}
              domain={[0, 4]}
            />
            <Tooltip cursor={{ fill: isDark ? '#374151' : '#F3F4F6' }} content={<CustomTooltip />} />
            <Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" />
            <Bar
              dataKey="averageGPA"
              name="Average GPA"
              fill={colors.chart3}
              radius={[4, 4, 0, 0]}
            />
            {data[0]?.passRate !== undefined && (
              <Bar
                dataKey="passRate"
                name="Pass Rate (%)"
                fill={colors.chart2}
                radius={[4, 4, 0, 0]}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-2.5 px-1">
          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            <span className="font-medium text-muted-foreground">Insight:</span>{" "}
            {bestPerformingGrade.grade} shows highest average GPA ({bestPerformingGrade.averageGPA.toFixed(2)}), 
            indicating strong academic performance at this level.{" "}
            <span className="text-muted-foreground/60">EMIS:</span> Grade-level analysis enables targeted 
            curriculum adjustments and resource allocation.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

