"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { Search, CheckCircle2, XCircle, Clock } from "lucide-react"

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

interface PaymentHistoryProps {
	payments: PaymentRecord[]
}

export function PaymentHistory({ payments }: PaymentHistoryProps) {
	const [search, setSearch] = useState("")

	const formatCurrency = (amount: number) => {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(amount)
	}

	const formatDate = (dateString: string) => {
		const date = new Date(dateString)
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
	}

	const formatFeeType = (feeType: string) => {
		return feeType.split('_').map(word => 
			word.charAt(0).toUpperCase() + word.slice(1)
		).join(' ')
	}

	const formatPaymentMethod = (method: string) => {
		return method.split('_').map(word => 
			word.charAt(0).toUpperCase() + word.slice(1)
		).join(' ')
	}

	const getStatusIcon = (status: string) => {
		switch (status) {
			case "completed":
				return <CheckCircle2 className="h-4 w-4 text-success" />
			case "failed":
				return <XCircle className="h-4 w-4 text-error" />
			case "pending":
				return <Clock className="h-4 w-4 text-warning" />
			default:
				return <Clock className="h-4 w-4 text-muted-foreground" />
		}
	}

	const getStatusBadge = (status: string) => {
		switch (status) {
			case "completed":
				return <Badge variant="default" className="bg-success text-success-foreground">Completed</Badge>
			case "failed":
				return <Badge variant="destructive">Failed</Badge>
			case "pending":
				return <Badge variant="default" className="bg-warning text-warning-foreground">Pending</Badge>
			default:
				return <Badge variant="outline">{status}</Badge>
		}
	}

	const filteredPayments = useMemo(() => {
		if (!search) return payments
		return payments.filter(payment =>
			payment.studentName.toLowerCase().includes(search.toLowerCase()) ||
			payment.studentId.toLowerCase().includes(search.toLowerCase()) ||
			payment.paymentId.toLowerCase().includes(search.toLowerCase())
		)
	}, [payments, search])

	// Calculate summary statistics
	const totalPayments = filteredPayments.length
	const totalAmount = filteredPayments.reduce((sum, p) => sum + p.amount, 0)
	const completedPayments = filteredPayments.filter(p => p.status === "completed").length
	const successRate = totalPayments > 0 ? (completedPayments / totalPayments) * 100 : 0

	return (
		<div className="space-y-6">
			{/* Summary Cards */}
			<div className="grid gap-4 md:grid-cols-4">
				<Card>
					<CardContent className="p-4">
						<p className="text-xs font-medium text-muted-foreground mb-1">Total Payments</p>
						<p className="text-xl font-semibold text-foreground">{totalPayments}</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4">
						<p className="text-xs font-medium text-muted-foreground mb-1">Total Amount</p>
						<p className="text-xl font-semibold text-foreground">{formatCurrency(totalAmount)}</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4">
						<p className="text-xs font-medium text-muted-foreground mb-1">Success Rate</p>
						<p className="text-xl font-semibold text-success">{successRate.toFixed(1)}%</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-4">
						<p className="text-xs font-medium text-muted-foreground mb-1">Avg Payment</p>
						<p className="text-xl font-semibold text-foreground">
							{formatCurrency(totalPayments > 0 ? totalAmount / totalPayments : 0)}
						</p>
					</CardContent>
				</Card>
			</div>

			{/* Payment History Table */}
			<Card className="border-border bg-card shadow-md">
				<CardHeader className="pb-3 border-b border-border/50">
					<div className="flex items-center justify-between">
						<div>
							<CardTitle className="text-base font-semibold text-foreground">Payment History</CardTitle>
							<CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
								Recent payment transactions and their status.
							</CardDescription>
						</div>
						<div className="relative w-[250px]">
							<Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="Search payments..."
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="pl-8"
							/>
						</div>
					</div>
				</CardHeader>
				<CardContent className="pt-4">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Payment ID</TableHead>
								<TableHead>Student</TableHead>
								<TableHead>Fee Type</TableHead>
								<TableHead className="text-right">Amount</TableHead>
								<TableHead>Payment Method</TableHead>
								<TableHead>Date</TableHead>
								<TableHead>Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{filteredPayments.map((payment) => (
								<TableRow key={payment.paymentId}>
									<TableCell className="font-mono text-xs">{payment.paymentId}</TableCell>
									<TableCell>
										<div>
											<p className="font-medium text-foreground">{payment.studentName}</p>
											<p className="text-xs text-muted-foreground">{payment.studentId}</p>
										</div>
									</TableCell>
									<TableCell className="capitalize">{formatFeeType(payment.feeType)}</TableCell>
									<TableCell className="text-right font-semibold">{formatCurrency(payment.amount)}</TableCell>
									<TableCell className="capitalize">{formatPaymentMethod(payment.paymentMethod)}</TableCell>
									<TableCell className="text-muted-foreground">{formatDate(payment.paymentDate)}</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											{getStatusIcon(payment.status)}
											{getStatusBadge(payment.status)}
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					{filteredPayments.length === 0 && (
						<div className="text-center py-8">
							<p className="text-sm text-muted-foreground">No payments found</p>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

