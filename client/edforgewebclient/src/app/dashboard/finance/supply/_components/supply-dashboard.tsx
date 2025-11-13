"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import {
	Package,
	DollarSign,
	AlertTriangle,
	TrendingUp,
	Download,
	Plus,
	Filter,
	Search,
} from "lucide-react"
import { SupplyOrderTrendsChart } from "./charts/supply-order-trends-chart"
import { InventoryByCategoryChart } from "./charts/inventory-by-category-chart"
import { LowStockItems } from "./low-stock-items"
import { SupplyUtilization } from "./supply-utilization"
import type { SupplyAnalytics } from "@/lib/schemas/financial"

interface SupplyDashboardProps {
	analytics: SupplyAnalytics
	category?: string
	academicYear: string
	search?: string
}

export function SupplyDashboard({ 
	analytics, 
	category,
	academicYear,
	search: initialSearch 
}: SupplyDashboardProps) {
	const [activeTab, setActiveTab] = useState("overview")
	const [search, setSearch] = useState(initialSearch || "")

	const formatCurrency = (amount: number) => {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0,
		}).format(amount)
	}

	const outOfStockCount = analytics.lowStockItems.filter(item => item.status === "out_of_stock").length
	const lowStockCount = analytics.lowStockItems.filter(item => item.status === "low_stock").length

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">School Supply Management</h1>
					<p className="text-muted-foreground mt-1">
						Track inventory and manage supply requisitions.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Input
						placeholder="Search supplies..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-[250px]"
					/>
					<Select defaultValue={category || "all"}>
						<SelectTrigger className="w-[160px]">
							<SelectValue placeholder="All Categories" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All Categories</SelectItem>
							<SelectItem value="textbooks">Textbooks</SelectItem>
							<SelectItem value="teaching_materials">Teaching Materials</SelectItem>
							<SelectItem value="desks">Desks</SelectItem>
							<SelectItem value="chairs">Chairs</SelectItem>
							<SelectItem value="paper">Paper</SelectItem>
							<SelectItem value="writing_instruments">Writing Instruments</SelectItem>
						</SelectContent>
					</Select>
					<Select defaultValue={academicYear}>
						<SelectTrigger className="w-[140px]">
							<SelectValue placeholder="Academic Year" />
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
						New Requisition
					</Button>
					<Button variant="outline">
						<Download className="h-4 w-4 mr-2" />
						Export Report
					</Button>
				</div>
			</div>

			{/* Inventory Alert */}
			{(outOfStockCount > 0 || lowStockCount > 0) && (
				<Alert className="border-error bg-error/5">
					<AlertTriangle className="h-4 w-4 text-error" />
					<AlertTitle className="flex items-center justify-between">
						<span>Inventory Alert</span>
					</AlertTitle>
					<AlertDescription>
						{outOfStockCount} item{outOfStockCount !== 1 ? 's' : ''} out of stock. {lowStockCount} item{lowStockCount !== 1 ? 's' : ''} running low. 
						Create requisitions to restock critical items.
						<Button variant="outline" size="sm" className="ml-4">
							View Items
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
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Total Items</p>
								<p className="text-xl font-semibold text-foreground">{analytics.totalItems.toLocaleString()}</p>
								<p className="text-xs text-muted-foreground/70">Items in inventory</p>
							</div>
							<Package className="h-5 w-5 text-success flex-shrink-0" />
						</div>
					</CardContent>
				</Card>

				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Total Value</p>
								<p className="text-xl font-semibold text-foreground">{formatCurrency(analytics.totalValue)}</p>
								<p className="text-xs text-muted-foreground/70">Current inventory value</p>
							</div>
							<DollarSign className="h-5 w-5 text-success flex-shrink-0" />
						</div>
					</CardContent>
				</Card>

				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Low Stock Items</p>
								<p className="text-xl font-semibold text-error">{lowStockCount + outOfStockCount}</p>
								<p className="text-xs text-error">{outOfStockCount} out of stock</p>
							</div>
							<AlertTriangle className="h-5 w-5 text-error flex-shrink-0" />
						</div>
					</CardContent>
				</Card>

				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Avg Utilization</p>
								<p className="text-xl font-semibold text-foreground">
									{Object.values(analytics.categoryBreakdown).reduce((sum, cat) => sum + cat.averageUtilization, 0) / Object.keys(analytics.categoryBreakdown).length}%
								</p>
								<p className="text-xs text-muted-foreground/70">Across all categories</p>
							</div>
							<TrendingUp className="h-5 w-5 text-success flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Tab Navigation */}
			<Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
				<TabsList>
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="low-stock">Low Stock Items</TabsTrigger>
					<TabsTrigger value="requisitions">Requisitions</TabsTrigger>
					<TabsTrigger value="suppliers">Suppliers</TabsTrigger>
				</TabsList>

				{/* Overview Tab */}
				<TabsContent value="overview" className="space-y-6 mt-6">
					<div className="grid gap-6 lg:grid-cols-2">
						<SupplyOrderTrendsChart data={analytics.trends} />
						<InventoryByCategoryChart data={analytics.categoryBreakdown} />
					</div>
					<SupplyUtilization analytics={analytics} />
				</TabsContent>

				{/* Low Stock Items Tab */}
				<TabsContent value="low-stock" className="space-y-6 mt-6">
					<LowStockItems items={analytics.lowStockItems} />
				</TabsContent>

				{/* Requisitions Tab */}
				<TabsContent value="requisitions" className="space-y-6 mt-6">
					<Card>
						<CardHeader>
							<CardTitle>Supply Requisitions</CardTitle>
							<CardDescription>Recent and pending supply requisitions</CardDescription>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-muted-foreground">Requisition management will be displayed here.</p>
						</CardContent>
					</Card>
				</TabsContent>

				{/* Suppliers Tab */}
				<TabsContent value="suppliers" className="space-y-6 mt-6">
					<Card>
						<CardHeader>
							<CardTitle>Suppliers</CardTitle>
							<CardDescription>Supplier information and contact details</CardDescription>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-muted-foreground">Supplier management will be displayed here.</p>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	)
}

