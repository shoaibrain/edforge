"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { Mail, Phone, AlertTriangle } from "lucide-react"

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

interface OutstandingFeesTableProps {
	fees: OutstandingFee[]
	search?: string
}

export function OutstandingFeesTable({ fees, search }: OutstandingFeesTableProps) {
	const [sortBy, setSortBy] = useState<"daysPastDue" | "balance" | "studentName">("daysPastDue")
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")

	const formatCurrency = (amount: number) => {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(amount)
	}

	const formatDate = (dateString: string | null) => {
		if (!dateString) return "Never"
		const date = new Date(dateString)
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
	}

	const getDaysPastDueColor = (days: number) => {
		if (days >= 60) return "bg-error text-error-foreground"
		if (days >= 30) return "bg-warning text-warning-foreground"
		return "bg-muted text-muted-foreground"
	}

	const sortedFees = useMemo(() => {
		let sorted = [...fees]

		// Filter by search
		if (search) {
			sorted = sorted.filter(fee =>
				fee.studentName.toLowerCase().includes(search.toLowerCase()) ||
				fee.studentId.toLowerCase().includes(search.toLowerCase())
			)
		}

		// Sort
		sorted.sort((a, b) => {
			let aValue: number | string
			let bValue: number | string

			switch (sortBy) {
				case "daysPastDue":
					aValue = a.daysPastDue
					bValue = b.daysPastDue
					break
				case "balance":
					aValue = a.balance
					bValue = b.balance
					break
				case "studentName":
					aValue = a.studentName
					bValue = b.studentName
					break
				default:
					return 0
			}

			if (typeof aValue === 'string' && typeof bValue === 'string') {
				return sortOrder === "asc" 
					? aValue.localeCompare(bValue)
					: bValue.localeCompare(aValue)
			}

			return sortOrder === "asc" 
				? (aValue as number) - (bValue as number)
				: (bValue as number) - (aValue as number)
		})

		return sorted
	}, [fees, search, sortBy, sortOrder])

	const handleSort = (column: typeof sortBy) => {
		if (sortBy === column) {
			setSortOrder(sortOrder === "asc" ? "desc" : "asc")
		} else {
			setSortBy(column)
			setSortOrder("desc")
		}
	}

	return (
		<Card className="border-border bg-card shadow-md">
			<CardHeader className="pb-3 border-b border-border/50">
				<CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
					<AlertTriangle className="h-4 w-4 text-primary" />
					Outstanding Fees
				</CardTitle>
				<CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
					Students with unpaid balances. Prioritize follow-up for high-value and long-overdue accounts.
					<span className="text-muted-foreground/60"> EMIS:</span> Critical for revenue management and cash flow.
				</CardDescription>
			</CardHeader>
			<CardContent className="pt-4">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("studentName")}>
								Student {sortBy === "studentName" && (sortOrder === "asc" ? "↑" : "↓")}
							</TableHead>
							<TableHead>Grade</TableHead>
							<TableHead className="text-right">Total Due</TableHead>
							<TableHead className="text-right">Paid</TableHead>
							<TableHead className="cursor-pointer hover:bg-muted/50 text-right" onClick={() => handleSort("balance")}>
								Balance {sortBy === "balance" && (sortOrder === "asc" ? "↑" : "↓")}
							</TableHead>
							<TableHead className="cursor-pointer hover:bg-muted/50 text-right" onClick={() => handleSort("daysPastDue")}>
								Days Past Due {sortBy === "daysPastDue" && (sortOrder === "asc" ? "↑" : "↓")}
							</TableHead>
							<TableHead>Last Payment</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{sortedFees.map((fee) => (
							<TableRow key={fee.studentId}>
								<TableCell>
									<div>
										<p className="font-medium text-foreground">{fee.studentName}</p>
										<p className="text-xs text-muted-foreground">{fee.studentId}</p>
									</div>
								</TableCell>
								<TableCell>{fee.grade}</TableCell>
								<TableCell className="text-right font-medium">{formatCurrency(fee.totalDue)}</TableCell>
								<TableCell className="text-right text-success">{formatCurrency(fee.paid)}</TableCell>
								<TableCell className="text-right font-semibold text-error">{formatCurrency(fee.balance)}</TableCell>
								<TableCell className="text-right">
									<Badge className={getDaysPastDueColor(fee.daysPastDue)}>
										{fee.daysPastDue} days
									</Badge>
								</TableCell>
								<TableCell className="text-muted-foreground">{formatDate(fee.lastPayment)}</TableCell>
								<TableCell>
									<div className="flex items-center justify-end gap-2">
										<Button variant="ghost" size="icon" className="h-8 w-8">
											<Mail className="h-4 w-4" />
										</Button>
										<Button variant="ghost" size="icon" className="h-8 w-8">
											<Phone className="h-4 w-4" />
										</Button>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				{sortedFees.length === 0 && (
					<div className="text-center py-8">
						<p className="text-sm text-muted-foreground">No outstanding fees found</p>
					</div>
				)}
			</CardContent>
		</Card>
	)
}

