/**
 * EdForge EMIS - School Supply Management Page
 * 
 * Comprehensive supply management with inventory tracking, order trends,
 * utilization analytics, and low stock alerts.
 * 
 * This is a Server Component for security and performance.
 */

export const dynamic = 'force-dynamic'

import { getCurrentUser } from "@/lib/auth";
import { AlertCircle } from "lucide-react";
import { SupplyDashboard } from "./_components/supply-dashboard";
import type { SupplyAnalytics } from "@/lib/schemas/financial";

interface SupplyPageProps {
	searchParams: Promise<{
		category?: string;
		academicYear?: string;
		search?: string;
	}>;
}

export default async function SupplyPage({ searchParams }: SupplyPageProps) {
	// Server-side authentication and authorization
	const user = await getCurrentUser();
	
	if (!user) {
		return (
			<div className="flex h-screen items-center justify-center">
				<div className="text-center">
					<AlertCircle className="h-12 w-12 text-error mx-auto mb-4" />
					<p className="text-muted-foreground">Authentication required</p>
				</div>
			</div>
		);
	}

	const params = await searchParams;

	// Comprehensive supply analytics data aligned with supplyAnalyticsSchema
	// This data demonstrates realistic supply management scenarios for policy makers
	const supplyAnalytics: SupplyAnalytics = {
		schoolId: "school-001",
		academicYearId: "academic-year-2024-2025",
		totalItems: 1248,
		totalValue: 385000, // $385,000
		categoryBreakdown: {
			textbooks: {
				itemCount: 420,
				totalValue: 125000, // $125,000
				averageUtilization: 92.0, // 92%
			},
			teaching_materials: {
				itemCount: 285,
				totalValue: 85000, // $85,000
				averageUtilization: 87.0, // 87%
			},
			desks: {
				itemCount: 150,
				totalValue: 45000, // $45,000
				averageUtilization: 95.0, // 95%
			},
			chairs: {
				itemCount: 180,
				totalValue: 36000, // $36,000
				averageUtilization: 94.0, // 94%
			},
			paper: {
				itemCount: 120,
				totalValue: 24000, // $24,000
				averageUtilization: 89.2, // 89.2%
			},
			writing_instruments: {
				itemCount: 93,
				totalValue: 70000, // $70,000
				averageUtilization: 88.5, // 88.5%
			},
		},
		lowStockItems: [
			{
				itemId: "item-001",
				itemName: "Graph Paper (A4)",
				quantityOnHand: 0,
				reorderLevel: 50,
				status: "out_of_stock" as const,
			},
			{
				itemId: "item-002",
				itemName: "Scientific Calculators",
				quantityOnHand: 12,
				reorderLevel: 30,
				status: "low_stock" as const,
			},
			{
				itemId: "item-003",
				itemName: "Lab Safety Goggles",
				quantityOnHand: 8,
				reorderLevel: 25,
				status: "low_stock" as const,
			},
		],
		trends: [
			{ period: "2024-09", totalOrders: 15, totalCost: 45000, averageOrderValue: 3000 },
			{ period: "2024-10", totalOrders: 12, totalCost: 38000, averageOrderValue: 3167 },
			{ period: "2024-11", totalOrders: 18, totalCost: 52000, averageOrderValue: 2889 },
			{ period: "2024-12", totalOrders: 10, totalCost: 35000, averageOrderValue: 3500 },
			{ period: "2025-01", totalOrders: 20, totalCost: 60000, averageOrderValue: 3000 },
			{ period: "2025-02", totalOrders: 14, totalCost: 42000, averageOrderValue: 3000 },
			{ period: "2025-03", totalOrders: 16, totalCost: 48000, averageOrderValue: 3000 },
			{ period: "2025-04", totalOrders: 13, totalCost: 39000, averageOrderValue: 3000 },
			{ period: "2025-05", totalOrders: 17, totalCost: 51000, averageOrderValue: 3000 },
			{ period: "2025-06", totalOrders: 11, totalCost: 33000, averageOrderValue: 3000 },
			{ period: "2025-07", totalOrders: 19, totalCost: 57000, averageOrderValue: 3000 },
			{ period: "2025-08", totalOrders: 15, totalCost: 45000, averageOrderValue: 3000 },
		],
	};

	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			<SupplyDashboard 
				analytics={supplyAnalytics}
				category={params.category}
				academicYear={params.academicYear || "2024-2025"}
				search={params.search}
			/>
		</div>
	);
}

