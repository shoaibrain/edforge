/**
 * EdForge EMIS - Budget Management Page
 * 
 * Comprehensive budget management with spending trends, category breakdown,
 * variance analysis, and forecasting capabilities.
 * 
 * This is a Server Component for security and performance.
 */

export const dynamic = 'force-dynamic'

import { getCurrentUser } from "@/lib/auth";
import { AlertCircle } from "lucide-react";
import { BudgetDashboard } from "./_components/budget-dashboard";
import type { BudgetAnalytics } from "@/lib/schemas/financial";

interface BudgetPageProps {
	searchParams: Promise<{
		department?: string;
		fiscalYear?: string;
	}>;
}

export default async function BudgetPage({ searchParams }: BudgetPageProps) {
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

	// Comprehensive budget analytics data aligned with budgetAnalyticsSchema
	// This data demonstrates realistic budget management scenarios for policy makers
	const budgetAnalytics: BudgetAnalytics = {
		schoolId: "school-001",
		academicYearId: "academic-year-2024-2025",
		totalAllocated: 2500000, // $2,500,000
		totalSpent: 1875000, // $1,875,000
		totalRemaining: 625000, // $625,000
		spendingRate: 75.0, // 75% of budget spent
		categoryBreakdown: {
			personnel: {
				allocated: 1250000, // $1,250,000
				spent: 950000, // $950,000
				remaining: 300000, // $300,000
				spendingRate: 76.0, // 76%
			},
			instructional_materials: {
				allocated: 350000, // $350,000
				spent: 280000, // $280,000
				remaining: 70000, // $70,000
				spendingRate: 80.0, // 80% - Alert threshold
			},
			facilities: {
				allocated: 400000, // $400,000
				spent: 290000, // $290,000
				remaining: 110000, // $110,000
				spendingRate: 72.5, // 72.5%
			},
			technology: {
				allocated: 200000, // $200,000
				spent: 145000, // $145,000
				remaining: 55000, // $55,000
				spendingRate: 72.5, // 72.5%
			},
			transportation: {
				allocated: 150000, // $150,000
				spent: 112500, // $112,500
				remaining: 37500, // $37,500
				spendingRate: 75.0, // 75%
			},
			utilities: {
				allocated: 80000, // $80,000
				spent: 60000, // $60,000
				remaining: 20000, // $20,000
				spendingRate: 75.0, // 75%
			},
			maintenance: {
				allocated: 50000, // $50,000
				spent: 37500, // $37,500
				remaining: 12500, // $12,500
				spendingRate: 75.0, // 75%
			},
			professional_development: {
				allocated: 70000, // $70,000
				spent: 42000, // $42,000
				remaining: 28000, // $28,000
				spendingRate: 60.0, // 60% - Under budget
			},
			student_services: {
				allocated: 60000, // $60,000
				spent: 45000, // $45,000
				remaining: 15000, // $15,000
				spendingRate: 75.0, // 75%
			},
			administrative: {
				allocated: 40000, // $40,000
				spent: 30000, // $30,000
				remaining: 10000, // $10,000
				spendingRate: 75.0, // 75%
			},
		},
		trends: [
			{ period: "2024-09", allocated: 208333, spent: 125000, spendingRate: 60.0 },
			{ period: "2024-10", allocated: 208333, spent: 145000, spendingRate: 69.6 },
			{ period: "2024-11", allocated: 208333, spent: 165000, spendingRate: 79.2 },
			{ period: "2024-12", allocated: 208333, spent: 185000, spendingRate: 88.8 },
			{ period: "2025-01", allocated: 208333, spent: 205000, spendingRate: 98.4 },
			{ period: "2025-02", allocated: 208333, spent: 225000, spendingRate: 108.0 }, // Over budget
			{ period: "2025-03", allocated: 208333, spent: 240000, spendingRate: 115.2 }, // Over budget
			{ period: "2025-04", allocated: 208333, spent: 250000, spendingRate: 120.0 }, // Over budget
			{ period: "2025-05", allocated: 208333, spent: 260000, spendingRate: 124.8 }, // Over budget
			{ period: "2025-06", allocated: 208333, spent: 270000, spendingRate: 129.6 }, // Over budget
			{ period: "2025-07", allocated: 208333, spent: 280000, spendingRate: 134.4 }, // Over budget
			{ period: "2025-08", allocated: 208333, spent: 312500, spendingRate: 150.0 }, // Over budget
		],
		variances: [
			{
				budgetId: "budget-001",
				category: "instructional_materials",
				allocatedAmount: 350000,
				spentAmount: 280000,
				variance: -70000, // Under budget (negative = good)
				variancePercentage: -20.0,
				status: "under_budget",
			},
			{
				budgetId: "budget-001",
				category: "personnel",
				allocatedAmount: 1250000,
				spentAmount: 950000,
				variance: -300000,
				variancePercentage: -24.0,
				status: "under_budget",
			},
			{
				budgetId: "budget-001",
				category: "professional_development",
				allocatedAmount: 70000,
				spentAmount: 42000,
				variance: -28000,
				variancePercentage: -40.0,
				status: "under_budget",
			},
			{
				budgetId: "budget-001",
				category: "facilities",
				allocatedAmount: 400000,
				spentAmount: 290000,
				variance: -110000,
				variancePercentage: -27.5,
				status: "under_budget",
			},
		],
	};

	// Budget alerts for categories approaching/exceeding budget
	const budgetAlerts = [
		{
			id: "alert-001",
			type: "warning" as const,
			category: "instructional_materials",
			message: "Instructional materials category has reached 80% of allocated budget with 4 months remaining in fiscal year.",
			spendingRate: 80.0,
			remainingMonths: 4,
		},
	];

	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			<BudgetDashboard 
				analytics={budgetAnalytics}
				alerts={budgetAlerts}
				department={params.department}
				fiscalYear={params.fiscalYear || "2024-2025"}
			/>
		</div>
	);
}

