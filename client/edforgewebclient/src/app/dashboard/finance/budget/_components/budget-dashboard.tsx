"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
	DollarSign, 
	TrendingUp, 
	TrendingDown, 
	AlertTriangle, 
	Info,
	Download,
	Plus,
	X,
	Filter,
} from "lucide-react"
import { SpendingTrendsChart } from "./charts/spending-trends-chart"
import { CategorySpendingChart } from "./charts/category-spending-chart"
import { BudgetVarianceAnalysis } from "./budget-variance-analysis"
import { ForecastPlanning } from "./forecast-planning"
import type { BudgetAnalytics } from "@/lib/schemas/financial"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"

interface BudgetAlert {
	id: string
	type: "warning" | "info"
	category: string
	message: string
	spendingRate: number
	remainingMonths: number
}

interface BudgetDashboardProps {
	analytics: BudgetAnalytics
	alerts: BudgetAlert[]
	department?: string
	fiscalYear: string
}

export function BudgetDashboard({ analytics, alerts, department, fiscalYear }: BudgetDashboardProps) {
	const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set())
	const [activeTab, setActiveTab] = useState("overview")

	const formatCurrency = (amount: number) => {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0,
		}).format(amount)
	}

	const getSpendingRateColor = (rate: number) => {
		if (rate >= 90) return "text-error"
		if (rate >= 80) return "text-warning"
		return "text-success"
	}

	const getSpendingRateBgColor = (rate: number) => {
		if (rate >= 90) return "bg-error/10 border-error/20"
		if (rate >= 80) return "bg-warning/10 border-warning/20"
		return "bg-success/10 border-success/20"
	}

	const visibleAlerts = alerts.filter(alert => !dismissedAlerts.has(alert.id))

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">Budget Management</h1>
					<p className="text-muted-foreground mt-1">
						Track expenditures and manage financial resources.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Select defaultValue={department || "all"}>
						<SelectTrigger className="w-[180px]">
							<SelectValue placeholder="All Departments" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All Departments</SelectItem>
							<SelectItem value="elementary">Elementary</SelectItem>
							<SelectItem value="middle">Middle School</SelectItem>
							<SelectItem value="high">High School</SelectItem>
						</SelectContent>
					</Select>
					<Select defaultValue={fiscalYear}>
						<SelectTrigger className="w-[140px]">
							<SelectValue placeholder="Fiscal Year" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="2024-2025">2024-2025</SelectItem>
							<SelectItem value="2023-2024">2023-2024</SelectItem>
							<SelectItem value="2022-2023">2022-2023</SelectItem>
						</SelectContent>
					</Select>
					<Button variant="outline" size="icon">
						<Filter className="h-4 w-4" />
					</Button>
					<Button className="bg-success hover:bg-success/90">
						<Plus className="h-4 w-4 mr-2" />
						Allocate Budget
					</Button>
					<Button variant="outline">
						<Download className="h-4 w-4 mr-2" />
						Export Report
					</Button>
				</div>
			</div>

			{/* Budget Alerts */}
			{visibleAlerts.length > 0 && (
				<Alert className={`border-warning bg-warning/5`}>
					<AlertTriangle className="h-4 w-4 text-warning" />
					<AlertTitle className="flex items-center justify-between">
						<span>{visibleAlerts[0].message}</span>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setDismissedAlerts(prev => new Set(prev).add(visibleAlerts[0].id))}
							className="h-6 w-6 p-0"
						>
							<X className="h-4 w-4" />
						</Button>
					</AlertTitle>
					<AlertDescription className="mt-2">
						<Button variant="outline" size="sm">
							Review Allocation
						</Button>
					</AlertDescription>
				</Alert>
			)}

			{/* Key Metrics Cards */}
			<div className="grid gap-4 md:grid-cols-4">
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Total Allocated</p>
								<p className="text-xl font-semibold text-foreground">{formatCurrency(analytics.totalAllocated)}</p>
								<p className="text-xs text-muted-foreground/70">Total budget for fiscal year</p>
							</div>
							<DollarSign className="h-5 w-5 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>

				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Total Spent</p>
								<p className="text-xl font-semibold text-foreground">{formatCurrency(analytics.totalSpent)}</p>
								<p className="text-xs text-muted-foreground/70">{analytics.spendingRate.toFixed(1)}% of budget</p>
							</div>
							<TrendingUp className="h-5 w-5 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>

				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Remaining Budget</p>
								<p className="text-xl font-semibold text-foreground">{formatCurrency(analytics.totalRemaining)}</p>
								<p className="text-xs text-muted-foreground/70">{(100 - analytics.spendingRate).toFixed(1)}% remaining</p>
							</div>
							<TrendingDown className="h-5 w-5 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>

				<Card className={`bg-card border-border hover:bg-muted/50 transition-colors ${getSpendingRateBgColor(analytics.spendingRate)}`}>
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Spending Rate</p>
								<p className={`text-xl font-semibold ${getSpendingRateColor(analytics.spendingRate)}`}>
									{analytics.spendingRate.toFixed(1)}%
								</p>
								<p className="text-xs text-muted-foreground/70">On track for year-end</p>
							</div>
							<Info className="h-5 w-5 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Tab Navigation */}
			<Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
				<TabsList>
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="categories">Categories</TabsTrigger>
					<TabsTrigger value="transactions">Transactions</TabsTrigger>
					<TabsTrigger value="forecast">Forecast & Planning</TabsTrigger>
				</TabsList>

				{/* Overview Tab */}
				<TabsContent value="overview" className="space-y-6 mt-6">
					<div className="grid gap-6 lg:grid-cols-2">
						<SpendingTrendsChart data={analytics.trends} />
						<CategorySpendingChart data={analytics.categoryBreakdown} />
					</div>
				</TabsContent>

				{/* Categories Tab */}
				<TabsContent value="categories" className="space-y-6 mt-6">
					<BudgetVarianceAnalysis 
						variances={analytics.variances}
						categoryBreakdown={analytics.categoryBreakdown}
					/>
				</TabsContent>

				{/* Transactions Tab */}
				<TabsContent value="transactions" className="space-y-6 mt-6">
					<Card>
						<CardHeader>
							<CardTitle>Recent Transactions</CardTitle>
							<CardDescription>Budget transactions and expenditures</CardDescription>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-muted-foreground">Transaction history will be displayed here.</p>
						</CardContent>
					</Card>
				</TabsContent>

				{/* Forecast & Planning Tab */}
				<TabsContent value="forecast" className="space-y-6 mt-6">
					<ForecastPlanning 
						analytics={analytics}
						fiscalYear={fiscalYear}
					/>
				</TabsContent>
			</Tabs>
		</div>
	)
}

