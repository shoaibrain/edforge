"use client"

import { useEffect, useState } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getChartColors } from "@/lib/chart-colors"
import { AlertTriangle, TrendingUp } from "lucide-react"

interface RiskIndicatorsChartProps {
  data: Array<{
    category: string
    count: number
    percentage: number
    riskLevel: 'low' | 'medium' | 'high'
  }>
}

export function RiskIndicatorsChart({ data }: RiskIndicatorsChartProps) {
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

  const getRiskColor = (riskLevel: string) => {
    switch (riskLevel) {
      case 'high':
        return colors.chart1 // Red
      case 'medium':
        return colors.chart4 // Amber
      case 'low':
        return colors.chart2 // Green
      default:
        return colors.chart3
    }
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = data.find((d) => d.category === label)
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
            Students at Risk: <span className="font-medium text-foreground">{payload[0].value}</span>
          </p>
          {dataPoint && (
            <>
              <p className="text-xs text-muted-foreground">
                Percentage: <span className="font-medium text-foreground">{dataPoint.percentage.toFixed(1)}%</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Risk Level: <Badge variant={dataPoint.riskLevel === 'high' ? 'destructive' : dataPoint.riskLevel === 'medium' ? 'default' : 'secondary'} className="ml-1 text-[10px]">{dataPoint.riskLevel}</Badge>
              </p>
            </>
          )}
        </div>
      )
    }
    return null
  }

  const totalAtRisk = data.reduce((sum, d) => sum + d.count, 0)

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" />
              Risk Indicators
            </CardTitle>
            <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
              Students requiring attention across different risk categories. Enables early intervention and support.
              <span className="text-muted-foreground/60"> SABER:</span> Critical for identifying at-risk populations.
            </CardDescription>
          </div>
          {totalAtRisk > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3 text-warning" />
              <span>{totalAtRisk} at risk</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={borderColor} opacity={0.3} />
            <XAxis
              dataKey="category"
              stroke={textColor}
              style={{ fontSize: "10px" }}
              tick={{ fill: textColor }}
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
            <Bar dataKey="count" name="Students at Risk" radius={[4, 4, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getRiskColor(entry.riskLevel)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-2.5 px-1">
          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            <span className="font-medium text-muted-foreground">Action Required:</span>{" "}
            {totalAtRisk} students identified across {data.length} risk categories. Prioritize interventions 
            for high-risk students to improve outcomes.{" "}
            <span className="text-muted-foreground/60">EMIS:</span> Early identification enables proactive 
            support and improves student success rates.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

