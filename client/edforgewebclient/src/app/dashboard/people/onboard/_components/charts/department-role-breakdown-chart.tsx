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
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DepartmentRoleBreakdown } from "@/lib/schemas"
import { getChartColors } from "@/lib/chart-colors"
import { Building2, Users } from "lucide-react"

interface DepartmentRoleBreakdownChartProps {
  data: DepartmentRoleBreakdown[]
}

const getGradientId = (prefix: string, index: number) => `${prefix}Gradient${index}`

export function DepartmentRoleBreakdownChart({ data }: DepartmentRoleBreakdownChartProps) {
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

  // Get all unique roles across all departments
  const allRoles = useMemo(() => {
    const roleSet = new Set<string>()
    data.forEach((dept) => {
      dept.roles.forEach((role) => roleSet.add(role.role))
    })
    return Array.from(roleSet)
  }, [data])

  // Assign colors to roles consistently
  const roleColors = useMemo(() => {
    const CHART_COLORS = [
      colors.chart3, // Blue
      colors.chart2, // Green
      colors.chart1, // Warm Red
      colors.chart4, // Amber
      colors.chart5, // Purple
    ]
    const colorMap: Record<string, string> = {}
    allRoles.forEach((role, index) => {
      colorMap[role] = CHART_COLORS[index % CHART_COLORS.length]
    })
    return colorMap
  }, [allRoles, colors])

  // Transform data for stacked bar chart
  const chartData = useMemo(() => {
    return data.map((dept) => {
      const dataPoint: Record<string, string | number> = {
        department: dept.department,
        totalCount: dept.totalCount,
      }
      
      // Add each role as a property
      allRoles.forEach((role) => {
        const roleData = dept.roles.find((r) => r.role === role)
        dataPoint[role] = roleData?.count || 0
      })
      
      return dataPoint
    })
  }, [data, allRoles])

  const borderColor = isDark ? '#4B5563' : '#E5E7EB'
  const textColor = isDark ? '#9CA3AF' : '#6B7280'
  const bgColor = isDark ? '#1F2937' : '#FFFFFF'
  const textColorDark = isDark ? '#F9FAFB' : '#111827'

  // Calculate summary metrics
  const totalDepartments = data.length
  const totalRoles = allRoles.length
  const totalStaff = data.reduce((sum, dept) => sum + dept.totalCount, 0)
  const avgRolesPerDept = (totalRoles / totalDepartments).toFixed(1)

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const departmentData = data.find((d) => d.department === label)
      if (!departmentData) return null

      return (
        <div
          style={{
            backgroundColor: bgColor,
            border: `1px solid ${borderColor}`,
            borderRadius: "0.5rem",
            padding: "12px",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
          }}
        >
          <p style={{ color: textColorDark, fontWeight: 600, marginBottom: "8px", fontSize: "14px" }}>
            {label}
          </p>
          <p style={{ color: textColor, fontSize: "12px", marginBottom: "8px" }}>
            Total: {departmentData.totalCount} staff
          </p>
          <div style={{ borderTop: `1px solid ${borderColor}`, paddingTop: "8px", marginTop: "8px" }}>
            {departmentData.roles.map((role) => {
              const rolePayload = payload.find((p: any) => p.dataKey === role.role)
              if (!rolePayload || rolePayload.value === 0) return null
              
              return (
                <div
                  key={role.role}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "4px",
                    fontSize: "12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <div
                      style={{
                        width: "10px",
                        height: "10px",
                        backgroundColor: roleColors[role.role],
                        borderRadius: "2px",
                      }}
                    />
                    <span style={{ color: textColorDark }}>{role.role}:</span>
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span style={{ color: textColorDark, fontWeight: 600 }}>{role.count}</span>
                    <span style={{ color: textColor }}>({role.percentage}%)</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <Card className="border-border bg-card shadow-md">
      <CardHeader className="pb-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Department & Role Breakdown
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Staffing composition and resource allocation by department
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              <span>{totalStaff} total</span>
            </div>
            <div>
              <span>{totalDepartments} depts</span>
            </div>
            <div>
              <span>{avgRolesPerDept} roles/dept avg</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
          >
            <defs>
              {allRoles.map((role, index) => {
                const color = roleColors[role]
                return (
                  <linearGradient
                    key={getGradientId("role", index)}
                    id={getGradientId("role", index)}
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="0"
                  >
                    <stop offset="0%" stopColor={color} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.6} />
                  </linearGradient>
                )
              })}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={borderColor} opacity={0.3} />
            <XAxis
              type="number"
              stroke={textColor}
              style={{ fontSize: "12px" }}
              tick={{ fill: textColor }}
            />
            <YAxis
              dataKey="department"
              type="category"
              stroke={textColor}
              style={{ fontSize: "12px" }}
              width={90}
              tick={{ fill: textColor }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              height={36}
              iconType="square"
              wrapperStyle={{ paddingBottom: "20px" }}
              formatter={(value) => (
                <span style={{ color: textColorDark, fontSize: "12px" }}>{value}</span>
              )}
            />
            {allRoles.map((role, index) => (
              <Bar
                key={role}
                dataKey={role}
                stackId="a"
                fill={`url(#${getGradientId("role", index)})`}
                name={role}
                radius={index === allRoles.length - 1 ? [0, 6, 6, 0] : [0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

