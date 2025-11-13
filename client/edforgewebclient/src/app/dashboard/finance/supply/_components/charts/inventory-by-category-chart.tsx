"use client"

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Package } from "lucide-react"

interface InventoryByCategoryChartProps {
	data: Record<string, {
		itemCount: number
		totalValue: number
		averageUtilization: number
	}>
}

export function InventoryByCategoryChart({ data }: InventoryByCategoryChartProps) {
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
		if (utilization >= 90) return "bg-success text-success-foreground"
		if (utilization >= 75) return "bg-warning text-warning-foreground"
		return "bg-error text-error-foreground"
	}

	const categoryData = useMemo(() => {
		return Object.entries(data).map(([category, values]) => ({
			category: formatCategoryName(category),
			...values,
		}))
	}, [data])

	return (
		<Card className="border-border bg-card shadow-md">
			<CardHeader className="pb-3 border-b border-border/50">
				<CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
					<Package className="h-4 w-4 text-primary" />
					Inventory by Category
				</CardTitle>
				<CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
					Items and value by category. Shows inventory distribution and utilization rates.
					<span className="text-muted-foreground/60"> EMIS:</span> Enables resource allocation and inventory optimization.
				</CardDescription>
			</CardHeader>
			<CardContent className="pt-4">
				<div className="space-y-4">
					{categoryData.map((item, index) => (
						<div key={index} className="p-4 rounded-lg border border-border bg-muted/5">
							<div className="flex items-center justify-between mb-3">
								<div className="flex-1">
									<p className="text-sm font-semibold text-foreground">{item.category}</p>
									<p className="text-xs text-muted-foreground mt-0.5">
										{item.itemCount} items • {formatCurrency(item.totalValue)}
									</p>
								</div>
								<Badge className={getUtilizationColor(item.averageUtilization)}>
									{item.averageUtilization.toFixed(1)}% util.
								</Badge>
							</div>
							<div className="w-full bg-muted rounded-full h-2">
								<div
									className={`h-2 rounded-full ${
										item.averageUtilization >= 90 ? 'bg-success' :
										item.averageUtilization >= 75 ? 'bg-warning' : 'bg-error'
									}`}
									style={{ width: `${item.averageUtilization}%` }}
								/>
							</div>
						</div>
					))}
				</div>
				<div className="mt-4 px-1">
					<p className="text-[10px] text-muted-foreground/70 leading-relaxed">
						<span className="font-medium text-muted-foreground">Insight:</span>{" "}
						Textbooks show highest utilization ({categoryData.find(c => c.category === 'Textbooks')?.averageUtilization.toFixed(1)}%), 
						indicating effective resource allocation.{" "}
						<span className="text-muted-foreground/60">SABER:</span> Category analysis enables 
						strategic inventory management and procurement planning.
					</p>
				</div>
			</CardContent>
		</Card>
	)
}

