"use client"

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { TrendingUp, AlertTriangle, Target, BarChart3 } from "lucide-react"
import {
	LineChart,
	Line,
	AreaChart,
	Area,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	Legend,
	ResponsiveContainer,
} from "recharts"
import { useEffect, useState } from "react"
import { getChartColors } from "@/lib/chart-colors"
import type { BudgetAnalytics } from "@/lib/schemas/financial"

interface ForecastPlanningProps {
	analytics: BudgetAnalytics
	fiscalYear: string
}

export function ForecastPlanning({ analytics, fiscalYear }: ForecastPlanningProps) {
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

	const formatCurrency = (amount: number) => {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0,
		}).format(amount)
	}

	// Calculate forecast based on current spending rate
	const monthsRemaining = 4 // Assuming 4 months remaining in fiscal year
	const averageMonthlySpending = analytics.totalSpent / (12 - monthsRemaining)
	const projectedSpending = analytics.totalSpent + (averageMonthlySpending * monthsRemaining)
	const projectedOverspend = projectedSpending - analytics.totalAllocated
	const projectedSpendingRate = (projectedSpending / analytics.totalAllocated) * 100

	// Forecast data for chart
	const forecastData = useMemo(() => {
		const currentMonth = analytics.trends.length
		const forecastMonths = []
		
		for (let i = 0; i < monthsRemaining; i++) {
			const monthIndex = currentMonth + i
			const projectedSpent = analytics.totalSpent + (averageMonthlySpending * (i + 1))
			forecastMonths.push({
				period: `2025-${String(monthIndex + 1).padStart(2, '0')}`,
				allocated: analytics.totalAllocated / 12,
				projectedSpent: projectedSpent / 12,
				spendingRate: (projectedSpent / analytics.totalAllocated) * 100,
			})
		}
		
		return [
			...analytics.trends.slice(-3).map(t => ({
				period: t.period,
				allocated: t.allocated,
				actualSpent: t.spent,
				spendingRate: t.spendingRate,
			})),
			...forecastMonths,
		]
	}, [analytics, monthsRemaining, averageMonthlySpending])

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
								{entry.name}: <span className="font-medium text-foreground">
									{formatCurrency(entry.value * 1000)}
								</span>
							</p>
						))}
					</div>
				</div>
			)
		}
		return null
	}

	// Risk indicators
	const riskIndicators = useMemo(() => {
		const risks = []
		if (projectedSpendingRate > 100) {
			risks.push({
				type: 'critical' as const,
				message: `Projected overspend of ${formatCurrency(projectedOverspend)} by end of fiscal year`,
			})
		}
		if (projectedSpendingRate > 95) {
			risks.push({
				type: 'warning' as const,
				message: 'Approaching budget limit - consider cost reduction measures',
			})
		}
		return risks
	}, [projectedSpendingRate, projectedOverspend])

	return (
		<div className="space-y-6">
			{/* Projected Spending Summary */}
			<Card className="border-border bg-card shadow-md">
				<CardHeader className="pb-3 border-b border-border/50">
					<CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
						<Target className="h-4 w-4 text-primary" />
						Budget Forecast
					</CardTitle>
					<CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
						Projected spending based on current trends for remaining fiscal year.
						<span className="text-muted-foreground/60"> EMIS:</span> Enables proactive budget management and planning.
					</CardDescription>
				</CardHeader>
				<CardContent className="pt-4">
					<div className="grid gap-4 md:grid-cols-4">
						<div className="p-4 rounded-lg border border-border bg-muted/5">
							<p className="text-xs font-medium text-muted-foreground mb-1">Current Spending</p>
							<p className="text-2xl font-bold text-foreground">{formatCurrency(analytics.totalSpent)}</p>
							<p className="text-xs text-muted-foreground mt-1">{analytics.spendingRate.toFixed(1)}% of budget</p>
						</div>
						<div className="p-4 rounded-lg border border-border bg-muted/5">
							<p className="text-xs font-medium text-muted-foreground mb-1">Projected Spending</p>
							<p className={`text-2xl font-bold ${projectedSpendingRate > 100 ? 'text-error' : 'text-foreground'}`}>
								{formatCurrency(projectedSpending)}
							</p>
							<p className={`text-xs mt-1 ${projectedSpendingRate > 100 ? 'text-error' : 'text-muted-foreground'}`}>
								{projectedSpendingRate.toFixed(1)}% of budget
							</p>
						</div>
						<div className={`p-4 rounded-lg border ${projectedOverspend > 0 ? 'bg-error/10 border-error/20' : 'bg-success/10 border-success/20'}`}>
							<p className="text-xs font-medium text-muted-foreground mb-1">Projected Variance</p>
							<p className={`text-2xl font-bold ${projectedOverspend > 0 ? 'text-error' : 'text-success'}`}>
								{projectedOverspend > 0 ? '+' : ''}{formatCurrency(projectedOverspend)}
							</p>
							<p className="text-xs text-muted-foreground mt-1">{monthsRemaining} months remaining</p>
						</div>
						<div className="p-4 rounded-lg border border-border bg-muted/5">
							<p className="text-xs font-medium text-muted-foreground mb-1">Avg Monthly Spending</p>
							<p className="text-2xl font-bold text-foreground">{formatCurrency(averageMonthlySpending)}</p>
							<p className="text-xs text-muted-foreground mt-1">Based on current trend</p>
						</div>
					</div>

					{/* Risk Indicators */}
					{riskIndicators.length > 0 && (
						<div className="mt-4 space-y-2">
							{riskIndicators.map((risk, index) => (
								<div
									key={index}
									className={`p-3 rounded-lg border flex items-start gap-2 ${
										risk.type === 'critical' ? 'bg-error/10 border-error/20' : 'bg-warning/10 border-warning/20'
									}`}
								>
									<AlertTriangle className={`h-4 w-4 mt-0.5 ${risk.type === 'critical' ? 'text-error' : 'text-warning'}`} />
									<p className={`text-sm ${risk.type === 'critical' ? 'text-error' : 'text-warning'}`}>
										{risk.message}
									</p>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Forecast Chart */}
			<Card className="border-border bg-card shadow-md">
				<CardHeader className="pb-3 border-b border-border/50">
					<CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
						<BarChart3 className="h-4 w-4 text-primary" />
						Spending Forecast
					</CardTitle>
					<CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
						Projected spending trajectory based on current trends. Historical data (solid) and forecast (dashed).
					</CardDescription>
				</CardHeader>
				<CardContent className="pt-4">
					<ResponsiveContainer width="100%" height={300}>
						<AreaChart data={forecastData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
							<defs>
								<linearGradient id="allocatedGradient" x1="0" y1="0" x2="0" y2="1">
									<stop offset="5%" stopColor={colors.chart3} stopOpacity={0.3} />
									<stop offset="95%" stopColor={colors.chart3} stopOpacity={0.05} />
								</linearGradient>
								<linearGradient id="spentGradient" x1="0" y1="0" x2="0" y2="1">
									<stop offset="5%" stopColor={colors.chart2} stopOpacity={0.3} />
									<stop offset="95%" stopColor={colors.chart2} stopOpacity={0.05} />
								</linearGradient>
								<linearGradient id="projectedGradient" x1="0" y1="0" x2="0" y2="1">
									<stop offset="5%" stopColor={colors.chart5} stopOpacity={0.2} />
									<stop offset="95%" stopColor={colors.chart5} stopOpacity={0.05} />
								</linearGradient>
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
								domain={[0, 'dataMax']}
							/>
							<Tooltip cursor={{ fill: isDark ? '#374151' : '#F3F4F6' }} content={<CustomTooltip />} />
							<Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" />
							<Area
								type="monotone"
								dataKey="allocated"
								stroke={colors.chart3}
								fill="url(#allocatedGradient)"
								name="Allocated (thousands)"
								strokeWidth={2}
								dot={{ r: 3 }}
							/>
							<Area
								type="monotone"
								dataKey="actualSpent"
								stroke={colors.chart2}
								fill="url(#spentGradient)"
								name="Actual Spent (thousands)"
								strokeWidth={2}
								dot={{ r: 3 }}
							/>
							<Area
								type="monotone"
								dataKey="projectedSpent"
								stroke={colors.chart5}
								fill="url(#projectedGradient)"
								name="Projected (thousands)"
								strokeWidth={2}
								strokeDasharray="5 5"
								dot={{ r: 3 }}
							/>
						</AreaChart>
					</ResponsiveContainer>
					<div className="mt-2.5 px-1">
						<p className="text-[10px] text-muted-foreground/70 leading-relaxed">
							<span className="font-medium text-muted-foreground">Recommendation:</span>{" "}
							{projectedSpendingRate > 100 
								? `Immediate action required. Projected overspend of ${formatCurrency(projectedOverspend)}. Consider budget reallocation or cost reduction measures.`
								: `Budget is on track. Current spending rate suggests ${projectedSpendingRate < 95 ? 'healthy' : 'tight'} budget management.`}{" "}
							<span className="text-muted-foreground/60">SABER:</span> Forecast enables proactive decision-making 
							and prevents budget overruns.
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}

