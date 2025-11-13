"use client"

import { useEffect, useState, useMemo } from "react"
import {
	BarChart,
	Bar,
	PieChart,
	Pie,
	Cell,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	Legend,
	ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getChartColors } from "@/lib/chart-colors"
import { DollarSign, TrendingUp } from "lucide-react"

interface CollectionByFeeTypesChartProps {
	data: Record<string, {
		totalDue: number
		totalCollected: number
		totalOutstanding: number
		collectionRate: number
	}>
}

const RADIAN = Math.PI / 180

export function CollectionByFeeTypesChart({ data }: CollectionByFeeTypesChartProps) {
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

	const formatFeeType = (feeType: string) => {
		return feeType.split('_').map(word => 
			word.charAt(0).toUpperCase() + word.slice(1)
		).join(' ')
	}

	// Prepare bar chart data
	const barData = useMemo(() => {
		return Object.entries(data).map(([feeType, values]) => ({
			feeType: formatFeeType(feeType),
			collected: values.totalCollected / 1000, // Convert to thousands
			outstanding: values.totalOutstanding / 1000,
			collectionRate: values.collectionRate,
		}))
	}, [data])

	// Prepare pie chart data for collection rate
	const pieData = useMemo(() => {
		return Object.entries(data).map(([feeType, values]) => ({
			name: formatFeeType(feeType),
			value: values.totalCollected,
			collectionRate: values.collectionRate,
			totalDue: values.totalDue,
		}))
	}, [data])

	const getCollectionRateColor = (rate: number) => {
		if (rate >= 90) return colors.chart2 // Green
		if (rate >= 75) return colors.chart4 // Amber
		return colors.chart1 // Red
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
				fontSize={10}
				fontWeight={600}
			>
				{`${(percent * 100).toFixed(0)}%`}
			</text>
		)
	}

	const CustomTooltip = ({ active, payload }: any) => {
		if (active && payload && payload.length) {
			const data = payload[0].payload
			return (
				<div
					className="p-3 rounded-lg shadow-lg"
					style={{
						backgroundColor: bgColor,
						border: `1px solid ${borderColor}`,
					}}
				>
					<p className="text-sm font-semibold text-foreground mb-2">{data.name || data.feeType}</p>
					{data.collectionRate !== undefined && (
						<p className="text-xs text-muted-foreground">
							Collection Rate: <span className="font-medium text-foreground">{data.collectionRate.toFixed(1)}%</span>
						</p>
					)}
					{data.value !== undefined && (
						<p className="text-xs text-muted-foreground">
							Collected: <span className="font-medium text-foreground">{formatCurrency(data.value)}</span>
						</p>
					)}
					{data.collected !== undefined && (
						<>
							<p className="text-xs text-muted-foreground">
								Collected: <span className="font-medium text-foreground">{formatCurrency(data.collected * 1000)}</span>
							</p>
							<p className="text-xs text-muted-foreground">
								Outstanding: <span className="font-medium text-foreground">{formatCurrency(data.outstanding * 1000)}</span>
							</p>
						</>
					)}
				</div>
			)
		}
		return null
	}

	return (
		<Card className="border-border bg-card shadow-md">
			<CardHeader className="pb-3 border-b border-border/50">
				<CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
					<DollarSign className="h-4 w-4 text-primary" />
					Collection by Fee Types
				</CardTitle>
				<CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
					Collection performance breakdown by fee type. Identifies which fee types have highest/lowest collection rates.
					<span className="text-muted-foreground/60"> EMIS:</span> Enables targeted collection strategies.
				</CardDescription>
			</CardHeader>
			<CardContent className="pt-4 space-y-6">
				{/* Bar Chart */}
				<div>
					<ResponsiveContainer width="100%" height={200}>
						<BarChart data={barData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
							<CartesianGrid strokeDasharray="3 3" stroke={borderColor} opacity={0.3} />
							<XAxis
								dataKey="feeType"
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
								label={{ value: 'Amount (thousands)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: textColor, fontSize: '10px' } }}
							/>
							<Tooltip cursor={{ fill: isDark ? '#374151' : '#F3F4F6' }} content={<CustomTooltip />} />
							<Legend wrapperStyle={{ paddingTop: "10px" }} iconType="circle" />
							<Bar dataKey="collected" name="Collected (thousands)" fill={colors.chart2} radius={[4, 4, 0, 0]} />
							<Bar dataKey="outstanding" name="Outstanding (thousands)" fill={colors.chart1} radius={[4, 4, 0, 0]} />
						</BarChart>
					</ResponsiveContainer>
				</div>

				{/* Fee Type Breakdown List */}
				<div className="space-y-3">
					{barData.map((item, index) => {
						const feeData = Object.values(data)[index]
						return (
							<div key={index} className="p-3 rounded-lg border border-border bg-muted/5">
								<div className="flex items-center justify-between mb-2">
									<p className="text-sm font-semibold text-foreground">{item.feeType}</p>
									<Badge
										variant={item.collectionRate >= 90 ? 'default' : item.collectionRate >= 75 ? 'secondary' : 'destructive'}
										className="text-xs"
									>
										{item.collectionRate.toFixed(1)}% collected
									</Badge>
								</div>
								<div className="grid gap-2 md:grid-cols-3 text-xs">
									<div>
										<p className="text-muted-foreground">Total Due</p>
										<p className="font-semibold text-foreground">{formatCurrency(feeData.totalDue)}</p>
									</div>
									<div>
										<p className="text-muted-foreground">Collected</p>
										<p className="font-semibold text-success">{formatCurrency(feeData.totalCollected)}</p>
									</div>
									<div>
										<p className="text-muted-foreground">Outstanding</p>
										<p className="font-semibold text-error">{formatCurrency(feeData.totalOutstanding)}</p>
									</div>
								</div>
							</div>
						)
					})}
				</div>

				<div className="mt-2.5 px-1">
					<p className="text-[10px] text-muted-foreground/70 leading-relaxed">
						<span className="font-medium text-muted-foreground">Insight:</span>{" "}
						Tuition fees show highest collection rate ({Object.entries(data).find(([k]) => k === 'tuition')?.[1].collectionRate.toFixed(1)}%), 
						while activity fees need attention ({Object.entries(data).find(([k]) => k === 'activity')?.[1].collectionRate.toFixed(1)}%).{" "}
						<span className="text-muted-foreground/60">SABER:</span> Fee type analysis enables 
						targeted collection strategies and policy adjustments.
					</p>
				</div>
			</CardContent>
		</Card>
	)
}

