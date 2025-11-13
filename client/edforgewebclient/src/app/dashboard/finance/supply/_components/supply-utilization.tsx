"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, Package } from "lucide-react"
import type { SupplyAnalytics } from "@/lib/schemas/financial"

interface SupplyUtilizationProps {
	analytics: SupplyAnalytics
}

export function SupplyUtilization({ analytics }: SupplyUtilizationProps) {
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

	const getUtilizationColor = (utilization: number) => {
		if (utilization >= 90) return "text-success"
		if (utilization >= 75) return "text-warning"
		return "text-error"
	}

	const averageUtilization = Object.values(analytics.categoryBreakdown).reduce(
		(sum, cat) => sum + cat.averageUtilization, 
		0
	) / Object.keys(analytics.categoryBreakdown).length

	return (
		<Card className="border-border bg-card shadow-md">
			<CardHeader className="pb-3 border-b border-border/50">
				<CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
					<TrendingUp className="h-4 w-4 text-primary" />
					Supply Utilization
				</CardTitle>
				<CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
					Utilization metrics by category. Shows how effectively supplies are being used across different categories.
					<span className="text-muted-foreground/60"> EMIS:</span> Enables optimization of inventory levels and procurement decisions.
				</CardDescription>
			</CardHeader>
			<CardContent className="pt-4">
				{/* Summary */}
				<div className="mb-6 p-4 rounded-lg border border-border bg-muted/5">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-xs font-medium text-muted-foreground mb-1">Average Utilization</p>
							<p className={`text-2xl font-bold ${getUtilizationColor(averageUtilization)}`}>
								{averageUtilization.toFixed(1)}%
							</p>
						</div>
						<div className="text-right">
							<p className="text-xs font-medium text-muted-foreground mb-1">Total Items</p>
							<p className="text-2xl font-bold text-foreground">{analytics.totalItems.toLocaleString()}</p>
						</div>
						<div className="text-right">
							<p className="text-xs font-medium text-muted-foreground mb-1">Total Value</p>
							<p className="text-2xl font-bold text-foreground">{formatCurrency(analytics.totalValue)}</p>
						</div>
					</div>
				</div>

				{/* Category Breakdown */}
				<div className="space-y-3">
					{Object.entries(analytics.categoryBreakdown).map(([category, data]) => (
						<div key={category} className="p-4 rounded-lg border border-border">
							<div className="flex items-center justify-between mb-2">
								<p className="text-sm font-semibold text-foreground">{formatCategoryName(category)}</p>
								<Badge className={getUtilizationColor(data.averageUtilization)}>
									{data.averageUtilization.toFixed(1)}% utilization
								</Badge>
							</div>
							<div className="grid gap-4 md:grid-cols-3 text-xs">
								<div>
									<p className="text-muted-foreground">Item Count</p>
									<p className="font-semibold text-foreground">{data.itemCount}</p>
								</div>
								<div>
									<p className="text-muted-foreground">Total Value</p>
									<p className="font-semibold text-foreground">{formatCurrency(data.totalValue)}</p>
								</div>
								<div>
									<p className="text-muted-foreground">Utilization Rate</p>
									<p className={`font-semibold ${getUtilizationColor(data.averageUtilization)}`}>
										{data.averageUtilization.toFixed(1)}%
									</p>
								</div>
							</div>
							<div className="mt-3 w-full bg-muted rounded-full h-2">
								<div
									className={`h-2 rounded-full ${
										data.averageUtilization >= 90 ? 'bg-success' :
										data.averageUtilization >= 75 ? 'bg-warning' : 'bg-error'
									}`}
									style={{ width: `${data.averageUtilization}%` }}
								/>
							</div>
						</div>
					))}
				</div>

				<div className="mt-4 px-1">
					<p className="text-[10px] text-muted-foreground/70 leading-relaxed">
						<span className="font-medium text-muted-foreground">Recommendation:</span>{" "}
						Categories with utilization below 75% may indicate overstocking, while those above 95% may need 
						additional inventory to prevent shortages.{" "}
						<span className="text-muted-foreground/60">SABER:</span> Utilization analysis enables 
						data-driven inventory optimization and cost reduction.
					</p>
				</div>
			</CardContent>
		</Card>
	)
}

