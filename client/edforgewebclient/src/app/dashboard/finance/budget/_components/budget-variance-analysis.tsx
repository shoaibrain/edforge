"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Target } from "lucide-react"
import type { BudgetVariance } from "@/lib/schemas/financial"

interface BudgetVarianceAnalysisProps {
	variances: BudgetVariance[]
	categoryBreakdown: Record<string, {
		allocated: number
		spent: number
		remaining: number
		spendingRate: number
	}>
}

export function BudgetVarianceAnalysis({ variances, categoryBreakdown }: BudgetVarianceAnalysisProps) {
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

	const getVarianceIcon = (status: string) => {
		switch (status) {
			case 'under_budget':
				return <TrendingDown className="h-4 w-4 text-success" />
			case 'over_budget':
				return <TrendingUp className="h-4 w-4 text-error" />
			default:
				return <Minus className="h-4 w-4 text-muted-foreground" />
		}
	}

	const getVarianceColor = (status: string) => {
		switch (status) {
			case 'under_budget':
				return "bg-success/10 border-success/20"
			case 'over_budget':
				return "bg-error/10 border-error/20"
			default:
				return "bg-muted/10 border-border"
		}
	}

	// Calculate total variance
	const totalVariance = variances.reduce((sum, v) => sum + v.variance, 0)
	const totalAllocated = variances.reduce((sum, v) => sum + v.allocatedAmount, 0)
	const totalSpent = variances.reduce((sum, v) => sum + v.spentAmount, 0)
	const overallVariancePercentage = totalAllocated > 0 ? ((totalSpent - totalAllocated) / totalAllocated) * 100 : 0

	return (
		<div className="space-y-6">
			{/* Summary Card */}
			<Card className="border-border bg-card shadow-md">
				<CardHeader className="pb-3 border-b border-border/50">
					<CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
						<Target className="h-4 w-4 text-primary" />
						Budget Variance Summary
					</CardTitle>
					<CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
						Overall budget performance showing variance between allocated and actual spending.
						<span className="text-muted-foreground/60"> EMIS:</span> Critical for accountability and budget control.
					</CardDescription>
				</CardHeader>
				<CardContent className="pt-4">
					<div className="grid gap-4 md:grid-cols-3">
						<div className="p-4 rounded-lg border border-border bg-muted/5">
							<p className="text-xs font-medium text-muted-foreground mb-1">Total Allocated</p>
							<p className="text-2xl font-bold text-foreground">{formatCurrency(totalAllocated)}</p>
						</div>
						<div className="p-4 rounded-lg border border-border bg-muted/5">
							<p className="text-xs font-medium text-muted-foreground mb-1">Total Spent</p>
							<p className="text-2xl font-bold text-foreground">{formatCurrency(totalSpent)}</p>
						</div>
						<div className={`p-4 rounded-lg border ${getVarianceColor(overallVariancePercentage < 0 ? 'under_budget' : overallVariancePercentage > 0 ? 'over_budget' : 'on_budget')}`}>
							<div className="flex items-center gap-2 mb-1">
								<p className="text-xs font-medium text-muted-foreground">Total Variance</p>
								{getVarianceIcon(overallVariancePercentage < 0 ? 'under_budget' : overallVariancePercentage > 0 ? 'over_budget' : 'on_budget')}
							</div>
							<p className={`text-2xl font-bold ${overallVariancePercentage < 0 ? 'text-success' : overallVariancePercentage > 0 ? 'text-error' : 'text-foreground'}`}>
								{formatCurrency(totalVariance)}
							</p>
							<p className="text-xs text-muted-foreground mt-1">
								{overallVariancePercentage > 0 ? '+' : ''}{overallVariancePercentage.toFixed(1)}%
							</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Variance by Category */}
			<Card className="border-border bg-card shadow-md">
				<CardHeader className="pb-3 border-b border-border/50">
					<CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
						<AlertTriangle className="h-4 w-4 text-primary" />
						Variance by Category
					</CardTitle>
					<CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
						Detailed variance analysis by budget category. Identifies areas of over/under spending.
					</CardDescription>
				</CardHeader>
				<CardContent className="pt-4">
					<div className="space-y-3">
						{variances.map((variance, index) => {
							const categoryData = categoryBreakdown[variance.category]
							return (
								<div
									key={index}
									className={`p-4 rounded-lg border ${getVarianceColor(variance.status)}`}
								>
									<div className="flex items-center justify-between mb-2">
										<div className="flex items-center gap-2">
											{getVarianceIcon(variance.status)}
											<p className="text-sm font-semibold text-foreground">
												{formatCategoryName(variance.category)}
											</p>
										</div>
										<Badge
											variant={variance.status === 'over_budget' ? 'destructive' : variance.status === 'under_budget' ? 'secondary' : 'outline'}
											className="text-xs"
										>
											{variance.status === 'over_budget' ? 'Over Budget' : variance.status === 'under_budget' ? 'Under Budget' : 'On Budget'}
										</Badge>
									</div>
									<div className="grid gap-4 md:grid-cols-4 mt-3">
										<div>
											<p className="text-xs text-muted-foreground mb-1">Allocated</p>
											<p className="text-sm font-semibold text-foreground">{formatCurrency(variance.allocatedAmount)}</p>
										</div>
										<div>
											<p className="text-xs text-muted-foreground mb-1">Spent</p>
											<p className="text-sm font-semibold text-foreground">{formatCurrency(variance.spentAmount)}</p>
										</div>
										<div>
											<p className="text-xs text-muted-foreground mb-1">Variance</p>
											<p className={`text-sm font-semibold ${variance.variance < 0 ? 'text-success' : variance.variance > 0 ? 'text-error' : 'text-foreground'}`}>
												{formatCurrency(variance.variance)}
											</p>
										</div>
										<div>
											<p className="text-xs text-muted-foreground mb-1">Variance %</p>
											<p className={`text-sm font-semibold ${variance.variancePercentage < 0 ? 'text-success' : variance.variancePercentage > 0 ? 'text-error' : 'text-foreground'}`}>
												{variance.variancePercentage > 0 ? '+' : ''}{variance.variancePercentage.toFixed(1)}%
											</p>
										</div>
									</div>
									{categoryData && (
										<div className="mt-3 pt-3 border-t border-border/50">
											<p className="text-xs text-muted-foreground">
												Spending Rate: <span className="font-medium text-foreground">{categoryData.spendingRate.toFixed(1)}%</span> • 
												Remaining: <span className="font-medium text-foreground">{formatCurrency(categoryData.remaining)}</span>
											</p>
										</div>
									)}
								</div>
							)
						})}
					</div>
				</CardContent>
			</Card>
		</div>
	)
}

