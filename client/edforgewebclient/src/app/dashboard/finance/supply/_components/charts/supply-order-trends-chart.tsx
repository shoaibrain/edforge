"use client"

import { useEffect, useState } from "react"
import {
	BarChart,
	Bar,
	LineChart,
	Line,
	ComposedChart,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	Legend,
	ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { getChartColors } from "@/lib/chart-colors"
import { TrendingUp, Package } from "lucide-react"

interface SupplyOrderTrendsChartProps {
	data: Array<{
		period: string
		totalOrders: number
		totalCost: number
		averageOrderValue: number
	}>
}

export function SupplyOrderTrendsChart({ data }: SupplyOrderTrendsChartProps) {
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

	const formatPeriod = (period: string) => {
		if (period.includes('-')) {
			const [year, month] = period.split('-')
			const date = new Date(parseInt(year), parseInt(month) - 1)
			return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
		}
		return period
	}

	// Convert costs to thousands for better readability
	const chartData = data.map(item => ({
		period: item.period,
		totalOrders: item.totalOrders,
		totalCost: item.totalCost / 1000, // Convert to thousands
		averageOrderValue: item.averageOrderValue / 1000,
	}))

	const CustomTooltip = ({ active, payload, label }: any) => {
		if (active && payload && payload.length) {
			const dataPoint = data.find((d) => d.period === label)
			if (!dataPoint) return null

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
									{entry.dataKey === 'totalOrders' 
										? entry.value
										: formatCurrency(entry.value * 1000)}
								</span>
							</p>
						))}
						{dataPoint && (
							<p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
								Avg Order Value: <span className="font-medium text-foreground">{formatCurrency(dataPoint.averageOrderValue)}</span>
							</p>
						)}
					</div>
				</div>
			)
		}
		return null
	}

	return (
		<Card className="border-border bg-card shadow-md">
			<CardHeader className="pb-3 border-b border-border/50">
				<CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
					<Package className="h-4 w-4 text-primary" />
					Supply Order Trends
				</CardTitle>
				<CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
					Monthly supply orders and costs. Tracks ordering patterns and expenditure trends.
					<span className="text-muted-foreground/60"> EMIS:</span> Enables inventory planning and budget forecasting.
				</CardDescription>
			</CardHeader>
			<CardContent className="pt-4">
				<ResponsiveContainer width="100%" height={300}>
					<ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
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
							yAxisId="left"
							stroke={textColor}
							style={{ fontSize: "10px" }}
							tick={{ fill: textColor }}
							label={{ value: 'Cost (thousands)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: textColor, fontSize: '10px' } }}
						/>
						<YAxis
							yAxisId="right"
							orientation="right"
							stroke={textColor}
							style={{ fontSize: "10px" }}
							tick={{ fill: textColor }}
							label={{ value: 'Orders', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: textColor, fontSize: '10px' } }}
						/>
						<Tooltip cursor={{ fill: isDark ? '#374151' : '#F3F4F6' }} content={<CustomTooltip />} />
						<Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" />
						<Bar
							yAxisId="left"
							dataKey="totalCost"
							name="Total Cost (thousands)"
							fill={colors.chart2}
							radius={[4, 4, 0, 0]}
						/>
						<Line
							yAxisId="right"
							type="monotone"
							dataKey="totalOrders"
							stroke={colors.chart5}
							strokeWidth={2}
							name="Total Orders"
							dot={{ r: 3, fill: colors.chart5, stroke: bgColor, strokeWidth: 1 }}
							activeDot={{ r: 5, fill: colors.chart5, stroke: bgColor, strokeWidth: 2 }}
						/>
					</ComposedChart>
				</ResponsiveContainer>
				<div className="mt-2.5 px-1">
					<p className="text-[10px] text-muted-foreground/70 leading-relaxed">
						<span className="font-medium text-muted-foreground">Insight:</span>{" "}
						Average monthly order value is {formatCurrency(data.reduce((sum, d) => sum + d.averageOrderValue, 0) / data.length)} 
						with {data.reduce((sum, d) => sum + d.totalOrders, 0) / data.length} orders per month on average.{" "}
						<span className="text-muted-foreground/60">SABER:</span> Order trends enable 
						optimization of procurement processes and inventory management.
					</p>
				</div>
			</CardContent>
		</Card>
	)
}

