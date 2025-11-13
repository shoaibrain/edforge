"use client"

import { useEffect, useState } from "react"
import {
	AreaChart,
	Area,
	LineChart,
	Line,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	Legend,
	ResponsiveContainer,
	ComposedChart,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { getChartColors } from "@/lib/chart-colors"
import { TrendingUp, DollarSign } from "lucide-react"

interface CollectionTrendsChartProps {
	data: Array<{
		period: string
		totalDue: number
		totalCollected: number
		collectionRate: number
	}>
}

export function CollectionTrendsChart({ data }: CollectionTrendsChartProps) {
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

	// Convert amounts to thousands for better readability
	const chartData = data.map(item => ({
		period: item.period,
		totalDue: item.totalDue / 1000,
		totalCollected: item.totalCollected / 1000,
		outstanding: (item.totalDue - item.totalCollected) / 1000,
		collectionRate: item.collectionRate,
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
									{entry.dataKey === 'collectionRate' 
										? `${entry.value.toFixed(1)}%`
										: formatCurrency(entry.value * 1000)}
								</span>
							</p>
						))}
						{dataPoint && (
							<p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
								Collection Rate: <span className="font-medium text-foreground">{dataPoint.collectionRate.toFixed(1)}%</span>
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
					<TrendingUp className="h-4 w-4 text-primary" />
					Collection Trends
				</CardTitle>
				<CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
					Fee collection trends over time showing total due, collected, and outstanding amounts.
					<span className="text-muted-foreground/60"> EMIS:</span> Critical for cash flow management and revenue planning.
				</CardDescription>
			</CardHeader>
			<CardContent className="pt-4">
				<ResponsiveContainer width="100%" height={300}>
					<ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
						<defs>
							<linearGradient id="dueGradient" x1="0" y1="0" x2="0" y2="1">
								<stop offset="5%" stopColor={colors.chart3} stopOpacity={0.3} />
								<stop offset="95%" stopColor={colors.chart3} stopOpacity={0.05} />
							</linearGradient>
							<linearGradient id="collectedGradient" x1="0" y1="0" x2="0" y2="1">
								<stop offset="5%" stopColor={colors.chart2} stopOpacity={0.3} />
								<stop offset="95%" stopColor={colors.chart2} stopOpacity={0.05} />
							</linearGradient>
							<linearGradient id="outstandingGradient" x1="0" y1="0" x2="0" y2="1">
								<stop offset="5%" stopColor={colors.chart1} stopOpacity={0.3} />
								<stop offset="95%" stopColor={colors.chart1} stopOpacity={0.05} />
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
							yAxisId="left"
							stroke={textColor}
							style={{ fontSize: "10px" }}
							tick={{ fill: textColor }}
							label={{ value: 'Amount (thousands)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: textColor, fontSize: '10px' } }}
						/>
						<YAxis
							yAxisId="right"
							orientation="right"
							stroke={textColor}
							style={{ fontSize: "10px" }}
							tick={{ fill: textColor }}
							domain={[0, 100]}
							label={{ value: 'Collection Rate (%)', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: textColor, fontSize: '10px' } }}
						/>
						<Tooltip cursor={{ fill: isDark ? '#374151' : '#F3F4F6' }} content={<CustomTooltip />} />
						<Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" />
						<Area
							yAxisId="left"
							type="monotone"
							dataKey="totalDue"
							stroke={colors.chart3}
							fill="url(#dueGradient)"
							name="Total Due (thousands)"
							strokeWidth={2}
							dot={{ r: 3, fill: colors.chart3, stroke: bgColor, strokeWidth: 1 }}
							activeDot={{ r: 5, fill: colors.chart3, stroke: bgColor, strokeWidth: 2 }}
						/>
						<Area
							yAxisId="left"
							type="monotone"
							dataKey="totalCollected"
							stroke={colors.chart2}
							fill="url(#collectedGradient)"
							name="Collected (thousands)"
							strokeWidth={2}
							dot={{ r: 3, fill: colors.chart2, stroke: bgColor, strokeWidth: 1 }}
							activeDot={{ r: 5, fill: colors.chart2, stroke: bgColor, strokeWidth: 2 }}
						/>
						<Area
							yAxisId="left"
							type="monotone"
							dataKey="outstanding"
							stroke={colors.chart1}
							fill="url(#outstandingGradient)"
							name="Outstanding (thousands)"
							strokeWidth={2}
							dot={{ r: 3, fill: colors.chart1, stroke: bgColor, strokeWidth: 1 }}
							activeDot={{ r: 5, fill: colors.chart1, stroke: bgColor, strokeWidth: 2 }}
						/>
						<Line
							yAxisId="right"
							type="monotone"
							dataKey="collectionRate"
							stroke={colors.chart5}
							strokeWidth={2}
							name="Collection Rate (%)"
							dot={{ r: 3, fill: colors.chart5, stroke: bgColor, strokeWidth: 1 }}
							activeDot={{ r: 5, fill: colors.chart5, stroke: bgColor, strokeWidth: 2 }}
						/>
					</ComposedChart>
				</ResponsiveContainer>
				<div className="mt-2.5 px-1">
					<p className="text-[10px] text-muted-foreground/70 leading-relaxed">
						<span className="font-medium text-muted-foreground">Insight:</span>{" "}
						Collection rate improved from {data[0]?.collectionRate.toFixed(1)}% to {data[data.length - 1]?.collectionRate.toFixed(1)}% 
						over 12 months, indicating effective collection strategies.{" "}
						<span className="text-muted-foreground/60">SABER:</span> Collection trends enable 
						identification of payment patterns and optimization of collection processes.
					</p>
				</div>
			</CardContent>
		</Card>
	)
}

