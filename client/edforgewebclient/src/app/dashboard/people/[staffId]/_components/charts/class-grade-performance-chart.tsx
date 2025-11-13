"use client"

import { useEffect, useState, useMemo } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  ComposedChart,
  ReferenceLine,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getChartColors } from "@/lib/chart-colors"
import { Award, Users } from "lucide-react"

interface ClassGradePerformanceChartProps {
  data: Array<{
    className: string
    averageGrade: number
    passRate: number
    studentCount: number
    growthRate: number
    gradeDistribution: {
      A: number
      B: number
      C: number
      D: number
      F: number
    }
  }>
}

export function ClassGradePerformanceChart({ data }: ClassGradePerformanceChartProps) {
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

  const gradeColors = {
    A: colors.chart2, // Green
    B: colors.chart3, // Blue
    C: colors.chart4, // Amber
    D: colors.chart1, // Red
    F: colors.chart1, // Red
  }

  // Prepare chart data - combine grade distribution with performance metrics
  const chartData = useMemo(() => {
    return data.map((classData) => {
      const total = classData.gradeDistribution.A + 
                   classData.gradeDistribution.B + 
                   classData.gradeDistribution.C + 
                   classData.gradeDistribution.D + 
                   classData.gradeDistribution.F

      return {
        className: classData.className,
        // Grade distribution (stacked)
        gradeA: classData.gradeDistribution.A,
        gradeB: classData.gradeDistribution.B,
        gradeC: classData.gradeDistribution.C,
        gradeD: classData.gradeDistribution.D,
        gradeF: classData.gradeDistribution.F,
        totalStudents: total,
        // Performance metrics (actual values for tooltip and reference)
        averageGrade: classData.averageGrade,
        passRate: classData.passRate,
        growthRate: classData.growthRate,
        // Percentages for tooltip
        percentA: ((classData.gradeDistribution.A / total) * 100).toFixed(1),
        percentB: ((classData.gradeDistribution.B / total) * 100).toFixed(1),
        percentC: ((classData.gradeDistribution.C / total) * 100).toFixed(1),
        percentD: ((classData.gradeDistribution.D / total) * 100).toFixed(1),
        percentF: ((classData.gradeDistribution.F / total) * 100).toFixed(1),
      }
    })
  }, [data])

  // Best performing class
  const bestPerformingClass = useMemo(() => {
    return data.reduce((prev, current) => 
      current.averageGrade > prev.averageGrade ? current : prev
    )
  }, [data])

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const classData = chartData.find((d) => d.className === label)
      if (!classData) return null

      // Calculate grade distribution from payload
      const gradeA = payload.find((p: any) => p.dataKey === 'gradeA')?.value || 0
      const gradeB = payload.find((p: any) => p.dataKey === 'gradeB')?.value || 0
      const gradeC = payload.find((p: any) => p.dataKey === 'gradeC')?.value || 0
      const gradeD = payload.find((p: any) => p.dataKey === 'gradeD')?.value || 0
      const gradeF = payload.find((p: any) => p.dataKey === 'gradeF')?.value || 0

      return (
        <div
          className="p-3 rounded-lg shadow-lg"
          style={{
            backgroundColor: bgColor,
            border: `1px solid ${borderColor}`,
          }}
        >
          <p className="text-sm font-semibold text-foreground mb-2">{label}</p>
          <div className="space-y-1.5">
            <div className="border-b border-border/50 pb-1.5 mb-1.5">
              <p className="text-xs font-medium text-muted-foreground mb-1">Grade Distribution</p>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: gradeColors.A }} />
                  Grade A: <span className="font-medium text-foreground">{gradeA} ({classData.percentA}%)</span>
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: gradeColors.B }} />
                  Grade B: <span className="font-medium text-foreground">{gradeB} ({classData.percentB}%)</span>
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: gradeColors.C }} />
                  Grade C: <span className="font-medium text-foreground">{gradeC} ({classData.percentC}%)</span>
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: gradeColors.D }} />
                  Grade D: <span className="font-medium text-foreground">{gradeD} ({classData.percentD}%)</span>
                </p>
                {gradeF > 0 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: gradeColors.F }} />
                    Grade F: <span className="font-medium text-foreground">{gradeF} ({classData.percentF}%)</span>
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Avg Grade: <span className="font-medium text-foreground">{classData.averageGrade.toFixed(1)}%</span></p>
              <p className="text-xs text-muted-foreground">Pass Rate: <span className="font-medium text-foreground">{classData.passRate.toFixed(1)}%</span></p>
              <p className="text-xs text-muted-foreground">Growth: <span className="font-medium text-success">+{classData.growthRate.toFixed(1)}%</span></p>
              <p className="text-xs text-muted-foreground">Students: <span className="font-medium text-foreground">{classData.totalStudents}</span></p>
            </div>
          </div>
        </div>
      )
    }
    return null
  }

  // Calculate max for domain - add space for performance indicators
  const maxStudents = Math.max(...chartData.map(d => d.totalStudents))
  const performanceBarScale = maxStudents * 0.3
  const maxDomain = Math.ceil(maxStudents * 1.5) // Space for stacked bars + performance bars

  // Prepare data with performance bars positioned after stacked bars
  const chartDataWithPerformance = useMemo(() => {
    const performanceStart = maxStudents * 1.05
    return chartData.map((entry) => {
      // Calculate bar lengths (scaled percentages)
      const avgGradeLength = (entry.averageGrade / 100) * performanceBarScale
      const passRateLength = (entry.passRate / 100) * performanceBarScale
      
      return {
        ...entry,
        // Performance bars: just the length (they'll be positioned using base)
        avgGradeBar: avgGradeLength,
        passRateBar: passRateLength,
        // Base positions for reference (used in tooltip)
        performanceStart: performanceStart,
      }
    })
  }, [chartData, maxStudents, performanceBarScale])

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Class Performance & Grade Distribution
            </CardTitle>
            <CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
              Combined view showing grade distribution (stacked bars) and performance metrics (right bars) for each class. 
              <span className="text-muted-foreground/60"> SABER:</span> Enables identification of classes needing 
              attention and best practices to replicate across all classes.
            </CardDescription>
          </div>
          {bestPerformingClass && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Award className="h-3 w-3 text-warning" />
              <span>Top: {bestPerformingClass.className}</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart
            data={chartDataWithPerformance}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={borderColor} opacity={0.3} />
            <XAxis
              type="number"
              stroke={textColor}
              style={{ fontSize: "10px" }}
              tick={{ fill: textColor }}
              domain={[0, maxDomain]}
            />
            <YAxis
              dataKey="className"
              type="category"
              stroke={textColor}
              style={{ fontSize: "10px" }}
              tick={{ fill: textColor }}
              width={100}
            />
            <Tooltip cursor={{ fill: isDark ? '#374151' : '#F3F4F6' }} content={<CustomTooltip />} />
            <Legend 
              wrapperStyle={{ paddingTop: "10px" }} 
              iconType="circle"
              formatter={(value) => {
                const legendMap: { [key: string]: string } = {
                  'gradeA': 'Grade A',
                  'gradeB': 'Grade B',
                  'gradeC': 'Grade C',
                  'gradeD': 'Grade D',
                  'gradeF': 'Grade F',
                  'avgGradeBar': 'Avg Grade',
                  'passRateBar': 'Pass Rate',
                }
                return legendMap[value] || value
              }}
            />
            
            {/* Stacked bars for grade distribution */}
            <Bar dataKey="gradeA" stackId="grades" name="gradeA" fill={gradeColors.A} radius={[0, 0, 0, 0]} />
            <Bar dataKey="gradeB" stackId="grades" name="gradeB" fill={gradeColors.B} radius={[0, 0, 0, 0]} />
            <Bar dataKey="gradeC" stackId="grades" name="gradeC" fill={gradeColors.C} radius={[0, 0, 0, 0]} />
            <Bar dataKey="gradeD" stackId="grades" name="gradeD" fill={gradeColors.D} radius={[0, 0, 0, 0]} />
            <Bar dataKey="gradeF" stackId="grades" name="gradeF" fill={gradeColors.F} radius={[0, 4, 4, 0]} />
            
            {/* Performance metrics as separate bars positioned after stacked bars */}
            {/* These bars will appear after the stacked bars, scaled to show performance */}
            <Bar
              dataKey="avgGradeBar"
              fill={colors.chart5}
              name="avgGradeBar"
              radius={[0, 2, 2, 0]}
              opacity={0.85}
            />
            <Bar
              dataKey="passRateBar"
              fill={colors.chart2}
              name="passRateBar"
              radius={[0, 2, 2, 0]}
              opacity={0.85}
            />
          </ComposedChart>
        </ResponsiveContainer>
        
        {/* Performance metrics legend */}
        <div className="mt-3 flex items-center justify-center gap-4 text-xs flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-8 rounded" style={{ backgroundColor: gradeColors.A }} />
            <span className="text-muted-foreground">Grade A</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-8 rounded" style={{ backgroundColor: gradeColors.B }} />
            <span className="text-muted-foreground">Grade B</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-8 rounded" style={{ backgroundColor: gradeColors.C }} />
            <span className="text-muted-foreground">Grade C</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-8 rounded" style={{ backgroundColor: gradeColors.D }} />
            <span className="text-muted-foreground">Grade D/F</span>
          </div>
          <div className="flex items-center gap-1.5 ml-4">
            <div className="h-3 w-8 rounded" style={{ backgroundColor: colors.chart5, opacity: 0.85 }} />
            <span className="text-muted-foreground">Avg Grade</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-8 rounded" style={{ backgroundColor: colors.chart2, opacity: 0.85 }} />
            <span className="text-muted-foreground">Pass Rate</span>
          </div>
        </div>
        
        <div className="mt-2.5 px-1">
          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            <span className="font-medium text-muted-foreground">Insight:</span>{" "}
            {bestPerformingClass.className} shows strongest performance with {bestPerformingClass.averageGrade.toFixed(1)}% average 
            and {bestPerformingClass.passRate.toFixed(1)}% pass rate. Grade distribution patterns reveal which classes 
            need targeted interventions.{" "}
            <span className="text-muted-foreground/60">SABER:</span> This combined view enables data-driven class-level 
            resource allocation and instructional strategy adjustments.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
