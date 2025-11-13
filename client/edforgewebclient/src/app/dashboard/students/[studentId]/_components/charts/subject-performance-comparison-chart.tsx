"use client"

import { useEffect, useState } from "react"
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { getChartColors } from "@/lib/chart-colors"
import { Award } from "lucide-react"

interface SubjectPerformanceComparisonChartProps {
  data: Array<{
    subject: string
    currentScore: number
    averageScore?: number
    trend: 'up' | 'down' | 'stable'
  }>
}

export function SubjectPerformanceComparisonChart({ data }: SubjectPerformanceComparisonChartProps) {
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

  const radarData = data.map(item => ({
    subject: item.subject.length > 10 ? item.subject.substring(0, 10) : item.subject,
    fullSubject: item.subject,
    score: item.currentScore,
    average: item.averageScore || 0,
    fullMark: 100,
  }))

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = data.find((d) => d.subject.includes(label) || label.includes(d.subject.substring(0, 10)))
      return (
        <div
          className="p-3 rounded-lg shadow-lg"
          style={{
            backgroundColor: bgColor,
            border: `1px solid ${borderColor}`,
          }}
        >
          <p className="text-sm font-semibold text-foreground mb-2">{dataPoint?.subject || label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-xs text-muted-foreground flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}: <span className="font-medium text-foreground">{entry.value.toFixed(1)}%</span>
            </p>
          ))}
        </div>
      )
    }
    return null
  }

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
          <Award className="h-4 w-4 text-primary" />
          Subject Performance Comparison
        </CardTitle>
        <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
          Multi-dimensional view of performance across all subjects. Identifies strengths and areas for improvement.
          <span className="text-muted-foreground/60"> SABER:</span> Enables targeted intervention strategies.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={300}>
          <RadarChart outerRadius={90} data={radarData}>
            <PolarGrid stroke={borderColor} strokeOpacity={0.3} />
            <PolarAngleAxis
              dataKey="subject"
              tick={{ fill: textColor, fontSize: 10 }}
            />
            <PolarRadiusAxis
              angle={30}
              domain={[0, 100]}
              stroke={borderColor}
              tick={{ fill: textColor, fontSize: 10 }}
            />
            <Radar
              name="Student Score"
              dataKey="score"
              stroke={colors.chart3}
              fill={colors.chart3}
              fillOpacity={0.6}
            />
            {data[0]?.averageScore !== undefined && (
              <Radar
                name="Class Average"
                dataKey="average"
                stroke={colors.chart2}
                fill={colors.chart2}
                fillOpacity={0.3}
              />
            )}
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" />
          </RadarChart>
        </ResponsiveContainer>
        <div className="mt-2.5 px-1">
          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            <span className="font-medium text-muted-foreground">Insight:</span>{" "}
            Performance varies across subjects, with strongest performance in {data.reduce((prev, current) => 
              current.currentScore > prev.currentScore ? current : prev
            ).subject}.{" "}
            <span className="text-muted-foreground/60">EMIS:</span> Subject-level analysis enables 
            personalized learning strategies and resource allocation.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

