"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import {
	DollarSign,
	CheckCircle2,
	AlertTriangle,
	Users,
	Download,
	Plus,
	Filter,
	Search,
	Mail,
	Phone,
} from "lucide-react"
import { CollectionTrendsChart } from "./charts/collection-trends-chart"
import { CollectionByFeeTypesChart } from "./charts/collection-by-fee-types-chart"
import { OutstandingFeesTable } from "./outstanding-fees-table"
import { PaymentHistory } from "./payment-history"
import type { FeeCollectionAnalytics } from "@/lib/schemas/financial"

interface OutstandingFee {
	studentId: string
	studentName: string
	grade: string
	totalDue: number
	paid: number
	balance: number
	daysPastDue: number
	lastPayment: string | null
}

interface PaymentRecord {
	paymentId: string
	studentId: string
	studentName: string
	feeType: string
	amount: number
	paymentDate: string
	paymentMethod: string
	status: string
}

interface FeesDashboardProps {
	analytics: FeeCollectionAnalytics
	outstandingFees: OutstandingFee[]
	paymentHistory: PaymentRecord[]
	grade?: string
	academicYear: string
	search?: string
}

export function FeesDashboard({ 
	analytics, 
	outstandingFees, 
	paymentHistory,
	grade,
	academicYear,
	search: initialSearch 
}: FeesDashboardProps) {
	const [activeTab, setActiveTab] = useState("overview")
	const [search, setSearch] = useState(initialSearch || "")

	const formatCurrency = (amount: number) => {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(amount)
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">School Fees Management</h1>
					<p className="text-muted-foreground mt-1">
						Monitor fee collections and outstanding payments.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Input
						placeholder="Search students..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-[250px]"
					/>
					<Select defaultValue={grade || "all"}>
						<SelectTrigger className="w-[140px]">
							<SelectValue placeholder="All Grades" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All Grades</SelectItem>
							<SelectItem value="grade1">Grade 1</SelectItem>
							<SelectItem value="grade2">Grade 2</SelectItem>
							<SelectItem value="grade3">Grade 3</SelectItem>
							<SelectItem value="grade4">Grade 4</SelectItem>
							<SelectItem value="grade5">Grade 5</SelectItem>
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
						Record Payment
					</Button>
					<Button variant="outline">
						<Download className="h-4 w-4 mr-2" />
						Export Report
					</Button>
				</div>
			</div>

			{/* Key Metrics Cards */}
			<div className="grid gap-4 md:grid-cols-4">
				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Total Fees Due</p>
								<p className="text-xl font-semibold text-foreground">{formatCurrency(analytics.totalFeesDue)}</p>
								<p className="text-xs text-muted-foreground/70">Expected fee revenue</p>
							</div>
							<DollarSign className="h-5 w-5 text-success flex-shrink-0" />
						</div>
					</CardContent>
				</Card>

				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Fees Collected</p>
								<p className="text-xl font-semibold text-success">{formatCurrency(analytics.totalFeesCollected)}</p>
								<p className="text-xs text-success">{analytics.collectionRate.toFixed(1)}% collected</p>
							</div>
							<CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
						</div>
					</CardContent>
				</Card>

				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Outstanding Fees</p>
								<p className="text-xl font-semibold text-error">{formatCurrency(analytics.totalFeesOutstanding)}</p>
								<p className="text-xs text-error">{(100 - analytics.collectionRate).toFixed(1)}% pending</p>
							</div>
							<AlertTriangle className="h-5 w-5 text-error flex-shrink-0" />
						</div>
					</CardContent>
				</Card>

				<Card className="bg-card border-border hover:bg-muted/50 transition-colors">
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium text-muted-foreground mb-0.5">Total Payments</p>
								<p className="text-xl font-semibold text-foreground">{analytics.totalPayments}</p>
								<p className="text-xs text-muted-foreground/70">Avg: {formatCurrency(analytics.averagePaymentAmount)}</p>
							</div>
							<Users className="h-5 w-5 text-muted-foreground/60 flex-shrink-0" />
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Tab Navigation */}
			<Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
				<TabsList>
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="outstanding">Outstanding Fees</TabsTrigger>
					<TabsTrigger value="history">Payment History</TabsTrigger>
					<TabsTrigger value="types">Fee Types</TabsTrigger>
				</TabsList>

				{/* Overview Tab */}
				<TabsContent value="overview" className="space-y-6 mt-6">
					<div className="grid gap-6 lg:grid-cols-2">
						<CollectionTrendsChart data={analytics.trends} />
						<CollectionByFeeTypesChart data={analytics.feeTypeBreakdown} />
					</div>
				</TabsContent>

				{/* Outstanding Fees Tab */}
				<TabsContent value="outstanding" className="space-y-6 mt-6">
					<OutstandingFeesTable fees={outstandingFees} search={search} />
				</TabsContent>

				{/* Payment History Tab */}
				<TabsContent value="history" className="space-y-6 mt-6">
					<PaymentHistory payments={paymentHistory} />
				</TabsContent>

				{/* Fee Types Tab */}
				<TabsContent value="types" className="space-y-6 mt-6">
					<Card>
						<CardHeader>
							<CardTitle>Fee Types Breakdown</CardTitle>
							<CardDescription>Detailed breakdown by fee type</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="space-y-4">
								{Object.entries(analytics.feeTypeBreakdown).map(([feeType, data]) => (
									<div key={feeType} className="p-4 rounded-lg border border-border">
										<div className="flex items-center justify-between mb-2">
											<p className="text-sm font-semibold text-foreground capitalize">
												{feeType.replace('_', ' ')}
											</p>
											<Badge variant={data.collectionRate >= 90 ? 'default' : data.collectionRate >= 75 ? 'secondary' : 'destructive'}>
												{data.collectionRate.toFixed(1)}% collected
											</Badge>
										</div>
										<div className="grid gap-4 md:grid-cols-3 text-xs">
											<div>
												<p className="text-muted-foreground">Total Due</p>
												<p className="font-semibold text-foreground">{formatCurrency(data.totalDue)}</p>
											</div>
											<div>
												<p className="text-muted-foreground">Collected</p>
												<p className="font-semibold text-success">{formatCurrency(data.totalCollected)}</p>
											</div>
											<div>
												<p className="text-muted-foreground">Outstanding</p>
												<p className="font-semibold text-error">{formatCurrency(data.totalOutstanding)}</p>
											</div>
										</div>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	)
}

