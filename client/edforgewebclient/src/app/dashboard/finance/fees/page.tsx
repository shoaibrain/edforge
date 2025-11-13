/**
 * EdForge EMIS - School Fees Management Page
 * 
 * Comprehensive fee collection management with analytics, outstanding fees tracking,
 * payment history, and collection trends.
 * 
 * This is a Server Component for security and performance.
 */

export const dynamic = 'force-dynamic'

import { getCurrentUser } from "@/lib/auth";
import { AlertCircle } from "lucide-react";
import { FeesDashboard } from "./_components/fees-dashboard";
import type { FeeCollectionAnalytics } from "@/lib/schemas/financial";

interface FeesPageProps {
	searchParams: Promise<{
		grade?: string;
		academicYear?: string;
		search?: string;
	}>;
}

export default async function FeesPage({ searchParams }: FeesPageProps) {
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

	// Comprehensive fee collection analytics data aligned with feeCollectionAnalyticsSchema
	// This data demonstrates realistic fee collection scenarios for policy makers
	const feeAnalytics: FeeCollectionAnalytics = {
		schoolId: "school-001",
		academicYearId: "academic-year-2024-2025",
		totalFeesDue: 1500000, // $1,500,000
		totalFeesCollected: 1275000, // $1,275,000
		totalFeesOutstanding: 225000, // $225,000
		collectionRate: 85.0, // 85%
		totalWaivers: 50000, // $50,000
		totalPayments: 1248,
		averagePaymentAmount: 1022, // $1,022
		feeTypeBreakdown: {
			tuition: {
				totalDue: 1200000, // $1,200,000
				totalCollected: 1050000, // $1,050,000
				totalOutstanding: 150000, // $150,000
				collectionRate: 87.5, // 87.5%
			},
			registration: {
				totalDue: 150000, // $150,000
				totalCollected: 142500, // $142,500
				totalOutstanding: 7500, // $7,500
				collectionRate: 95.0, // 95%
			},
			activity: {
				totalDue: 80000, // $80,000
				totalCollected: 60000, // $60,000
				totalOutstanding: 20000, // $20,000
				collectionRate: 75.0, // 75%
			},
			technology: {
				totalDue: 50000, // $50,000
				totalCollected: 45000, // $45,000
				totalOutstanding: 5000, // $5,000
				collectionRate: 90.0, // 90%
			},
			textbook: {
				totalDue: 20000, // $20,000
				totalCollected: 17500, // $17,500
				totalOutstanding: 2500, // $2,500
				collectionRate: 87.5, // 87.5%
			},
		},
		trends: [
			{ period: "2024-09", totalDue: 125000, totalCollected: 100000, collectionRate: 80.0 },
			{ period: "2024-10", totalDue: 125000, totalCollected: 110000, collectionRate: 88.0 },
			{ period: "2024-11", totalDue: 125000, totalCollected: 115000, collectionRate: 92.0 },
			{ period: "2024-12", totalDue: 125000, totalCollected: 120000, collectionRate: 96.0 },
			{ period: "2025-01", totalDue: 125000, totalCollected: 118000, collectionRate: 94.4 },
			{ period: "2025-02", totalDue: 125000, totalCollected: 122000, collectionRate: 97.6 },
			{ period: "2025-03", totalDue: 125000, totalCollected: 120000, collectionRate: 96.0 },
			{ period: "2025-04", totalDue: 125000, totalCollected: 123000, collectionRate: 98.4 },
			{ period: "2025-05", totalDue: 125000, totalCollected: 121000, collectionRate: 96.8 },
			{ period: "2025-06", totalDue: 125000, totalCollected: 124000, collectionRate: 99.2 },
			{ period: "2025-07", totalDue: 125000, totalCollected: 122500, collectionRate: 98.0 },
			{ period: "2025-08", totalDue: 125000, totalCollected: 123500, collectionRate: 98.8 },
		],
	};

	// Outstanding fees data
	const outstandingFees = [
		{
			studentId: "STU-2024-010",
			studentName: "Frank Anderson",
			grade: "Grade 3",
			totalDue: 5000.00,
			paid: 2000.00,
			balance: 3000.00,
			daysPastDue: 45,
			lastPayment: "2024-06-30",
		},
		{
			studentId: "STU-2024-011",
			studentName: "Grace Lee",
			grade: "Grade 4",
			totalDue: 5000.00,
			paid: 3000.00,
			balance: 2000.00,
			daysPastDue: 30,
			lastPayment: "2024-07-14",
		},
		{
			studentId: "STU-2024-012",
			studentName: "Henry Chen",
			grade: "Grade 5",
			totalDue: 5500.00,
			paid: 4000.00,
			balance: 1500.00,
			daysPastDue: 15,
			lastPayment: "2024-07-29",
		},
		{
			studentId: "STU-2024-013",
			studentName: "Iris Patel",
			grade: "Grade 2",
			totalDue: 4500.00,
			paid: 1500.00,
			balance: 3000.00,
			daysPastDue: 60,
			lastPayment: "2024-06-14",
		},
		{
			studentId: "STU-2024-014",
			studentName: "Jack Robinson",
			grade: "Grade 1",
			totalDue: 4200.00,
			paid: 0.00,
			balance: 4200.00,
			daysPastDue: 90,
			lastPayment: null,
		},
		{
			studentId: "STU-2024-015",
			studentName: "Katherine White",
			grade: "Grade 6",
			totalDue: 6000.00,
			paid: 4500.00,
			balance: 1500.00,
			daysPastDue: 20,
			lastPayment: "2024-08-10",
		},
		{
			studentId: "STU-2024-016",
			studentName: "Liam Brown",
			grade: "Grade 7",
			totalDue: 6500.00,
			paid: 5000.00,
			balance: 1500.00,
			daysPastDue: 10,
			lastPayment: "2024-08-20",
		},
		{
			studentId: "STU-2024-017",
			studentName: "Mia Garcia",
			grade: "Grade 8",
			totalDue: 7000.00,
			paid: 6000.00,
			balance: 1000.00,
			daysPastDue: 5,
			lastPayment: "2024-08-25",
		},
	];

	// Payment history data
	const paymentHistory = [
		{
			paymentId: "PAY-001",
			studentId: "STU-2024-001",
			studentName: "Emma Rodriguez",
			feeType: "tuition",
			amount: 5000.00,
			paymentDate: "2024-08-15",
			paymentMethod: "online_payment",
			status: "completed",
		},
		{
			paymentId: "PAY-002",
			studentId: "STU-2024-002",
			studentName: "Alex Thompson",
			feeType: "registration",
			amount: 500.00,
			paymentDate: "2024-08-14",
			paymentMethod: "bank_transfer",
			status: "completed",
		},
		{
			paymentId: "PAY-003",
			studentId: "STU-2024-003",
			studentName: "Marcus Johnson",
			feeType: "activity",
			amount: 200.00,
			paymentDate: "2024-08-13",
			paymentMethod: "credit_card",
			status: "completed",
		},
		{
			paymentId: "PAY-004",
			studentId: "STU-2024-004",
			studentName: "Sofia Martinez",
			feeType: "technology",
			amount: 300.00,
			paymentDate: "2024-08-12",
			paymentMethod: "online_payment",
			status: "completed",
		},
		{
			paymentId: "PAY-005",
			studentId: "STU-2024-005",
			studentName: "Zara Ahmed",
			feeType: "textbook",
			amount: 150.00,
			paymentDate: "2024-08-11",
			paymentMethod: "cash",
			status: "completed",
		},
	];

	return (
		<div className="flex flex-1 flex-col gap-6 p-6 w-full">
			<FeesDashboard 
				analytics={feeAnalytics}
				outstandingFees={outstandingFees}
				paymentHistory={paymentHistory}
				grade={params.grade}
				academicYear={params.academicYear || "2024-2025"}
				search={params.search}
			/>
		</div>
	);
}

