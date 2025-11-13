"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Package, Plus } from "lucide-react"

interface LowStockItem {
	itemId: string
	itemName: string
	quantityOnHand: number
	reorderLevel: number
	status: "low_stock" | "out_of_stock"
}

interface LowStockItemsProps {
	items: LowStockItem[]
}

export function LowStockItems({ items }: LowStockItemsProps) {
	const getStatusBadge = (status: string) => {
		switch (status) {
			case "out_of_stock":
				return <Badge variant="destructive">Out of Stock</Badge>
			case "low_stock":
				return <Badge variant="default" className="bg-warning text-warning-foreground">Low Stock</Badge>
			default:
				return <Badge variant="outline">{status}</Badge>
		}
	}

	const getStatusColor = (status: string) => {
		switch (status) {
			case "out_of_stock":
				return "bg-error/10 border-error/20"
			case "low_stock":
				return "bg-warning/10 border-warning/20"
			default:
				return "bg-muted/10 border-border"
		}
	}

	return (
		<Card className="border-border bg-card shadow-md">
			<CardHeader className="pb-3 border-b border-border/50">
				<CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
					<AlertTriangle className="h-4 w-4 text-primary" />
					Low Stock Items
				</CardTitle>
				<CardDescription className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
					Items below reorder level requiring immediate attention. Create requisitions to restock.
					<span className="text-muted-foreground/60"> EMIS:</span> Critical for maintaining adequate inventory levels.
				</CardDescription>
			</CardHeader>
			<CardContent className="pt-4">
				<div className="space-y-3">
					{items.map((item) => (
						<div
							key={item.itemId}
							className={`p-4 rounded-lg border ${getStatusColor(item.status)}`}
						>
							<div className="flex items-center justify-between mb-3">
								<div className="flex items-center gap-3">
									<Package className="h-5 w-5 text-muted-foreground" />
									<div>
										<p className="text-sm font-semibold text-foreground">{item.itemName}</p>
										<p className="text-xs text-muted-foreground">Item ID: {item.itemId}</p>
									</div>
								</div>
								{getStatusBadge(item.status)}
							</div>
							<div className="grid gap-4 md:grid-cols-3 mb-3">
								<div>
									<p className="text-xs text-muted-foreground mb-1">Quantity on Hand</p>
									<p className="text-sm font-semibold text-foreground">{item.quantityOnHand}</p>
								</div>
								<div>
									<p className="text-xs text-muted-foreground mb-1">Reorder Level</p>
									<p className="text-sm font-semibold text-foreground">{item.reorderLevel}</p>
								</div>
								<div>
									<p className="text-xs text-muted-foreground mb-1">Shortfall</p>
									<p className="text-sm font-semibold text-error">
										{item.reorderLevel - item.quantityOnHand}
									</p>
								</div>
							</div>
							<Button size="sm" className="w-full bg-success hover:bg-success/90">
								<Plus className="h-4 w-4 mr-2" />
								Create Requisition
							</Button>
						</div>
					))}
				</div>
				{items.length === 0 && (
					<div className="text-center py-8">
						<p className="text-sm text-muted-foreground">No low stock items</p>
					</div>
				)}
			</CardContent>
		</Card>
	)
}

