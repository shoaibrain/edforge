"use client"

import { useEffect, useState, useMemo } from "react"
import {
	PieChart,
	Pie,
	Cell,
	ResponsiveContainer,
	Tooltip,
	Legend,
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { getChartColors } from "@/lib/chart-colors"
import { DollarSign, TrendingUp } from "lucide-react"

interface CategorySpendingChartProps {
	data: Record<string, {
		allocated: number
		spent: number
		remaining: number
		spendingRate: number
	}>
}

const RADIAN = Math.PI / 180

export function CategorySpendingChart({ data }: CategorySpendingChartProps) {
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

	const formatCategoryName = (category: string) => {
		return category.split('_').map(word => 
			word.charAt(0).toUpperCase() + word.slice(1)
		).join(' ')
	}

	// Prepare pie chart data
	const pieData = useMemo(() => {
		return Object.entries(data).map(([category, values]) => ({
			name: formatCategoryName(category),
			value: values.spent,
			allocated: values.allocated,
			spendingRate: values.spendingRate,
			category,
		}))
	}, [data])

	// Prepare bar chart data for detailed view
	const barData = useMemo(() => {
		return Object.entries(data).map(([category, values]) => ({
			category: formatCategoryName(category),
			allocated: values.allocated / 1000, // Convert to thousands
			spent: values.spent / 1000,
			remaining: values.remaining / 1000,
			spendingRate: values.spendingRate,
		}))
	}, [data])

	const getSpendingRateColor = (rate: number) => {
		if (rate >= 90) return colors.chart1 // Red
		if (rate >= 80) return colors.chart4 // Amber
		return colors.chart2 // Green
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
					<p className="text-sm font-semibold text-foreground mb-2">{data.name}</p>
					<p className="text-xs text-muted-foreground">
						Spent: <span className="font-medium text-foreground">{formatCurrency(data.value)}</span>
					</p>
					<p className="text-xs text-muted-foreground">
						Allocated: <span className="font-medium text-foreground">{formatCurrency(data.allocated)}</span>
					</p>
					<p className="text-xs text-muted-foreground">
						Spending Rate: <span className="font-medium text-foreground">{data.spendingRate.toFixed(1)}%</span>
					</p>
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
					Category Spending
				</CardTitle>
				<CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
					Spending breakdown by budget category. Visual representation of resource allocation and utilization.
					<span className="text-muted-foreground/60"> EMIS:</span> Enables identification of spending patterns and optimization opportunities.
				</CardDescription>
			</CardHeader>
			<CardContent className="pt-4 space-y-6">
				{/* Pie Chart */}
				<div>
					<ResponsiveContainer width="100%" height={200}>
						<PieChart>
							<defs>
								{pieData.map((entry, index) => (
									<linearGradient key={`gradient-${index}`} id={`gradient-${index}`} x1="0" y1="0" x2="0" y2="1">
										<stop offset="5%" stopColor={getSpendingRateColor(entry.spendingRate)} stopOpacity={0.9} />
										<stop offset="95%" stopColor={getSpendingRateColor(entry.spendingRate)} stopOpacity={0.5} />
									</linearGradient>
								))}
							</defs>
							<Pie
								data={pieData}
								cx="50%"
								cy="50%"
								labelLine={false}
								label={renderCustomLabel}
								outerRadius={80}
								innerRadius={30}
								fill="#8884d8"
								dataKey="value"
							>
								{pieData.map((entry, index) => (
									<Cell
										key={`cell-${index}`}
										fill={`url(#gradient-${index})`}
										stroke={bgColor}
										strokeWidth={2}
									/>
								))}
							</Pie>
							<Tooltip content={<CustomTooltip />} />
							<Legend
								wrapperStyle={{ paddingTop: "10px" }}
								formatter={(value) => <span style={{ color: textColorDark, fontSize: '10px' }}>{value}</span>}
							/>
						</PieChart>
					</ResponsiveContainer>
				</div>

				{/* Category Breakdown List */}
				<div className="space-y-3">
					{barData.map((item, index) => (
						<div key={index} className="space-y-2">
							<div className="flex items-center justify-between">
								<div className="flex-1">
									<p className="text-sm font-medium text-foreground">{item.category}</p>
									<p className="text-xs text-muted-foreground">
										{formatCurrency(item.spent * 1000)} / {formatCurrency(item.allocated * 1000)}
									</p>
								</div>
								<Badge
									variant={item.spendingRate >= 90 ? 'destructive' : item.spendingRate >= 80 ? 'default' : 'secondary'}
									className="text-xs"
								>
									{item.spendingRate.toFixed(1)}%
								</Badge>
							</div>
							<Progress 
								value={item.spendingRate} 
								className="h-2"
							/>
						</div>
					))}
				</div>

				<div className="mt-2.5 px-1">
					<p className="text-[10px] text-muted-foreground/70 leading-relaxed">
						<span className="font-medium text-muted-foreground">Insight:</span>{" "}
						Personnel accounts for the largest spending category.{" "}
						<span className="text-muted-foreground/60">SABER:</span> Category analysis enables strategic resource 
						reallocation and budget optimization.
					</p>
				</div>
			</CardContent>
		</Card>
	)
}

