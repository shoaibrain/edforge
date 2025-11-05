"use client";

/**
 * EdForge EMIS - Dashboard Skeleton
 * 
 * An elegant loading skeleton that matches our design philosophy
 * and works seamlessly with both light and dark themes.
 */

import { Separator } from "@/components/ui/separator";

// Custom Skeleton component to avoid build issues
function Skeleton({ className = "", ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={`bg-muted animate-pulse rounded-md ${className}`}
			{...props}
		/>
	);
}

export function DashboardSkeleton() {
	return (
		<>
			{/* Header Skeleton */}
			<header className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background">
				<div className="flex items-center gap-2 px-4 w-full">
					{/* Sidebar Trigger Skeleton */}
					<Skeleton className="h-9 w-9 rounded-lg" />
					<Separator orientation="vertical" className="mr-2 h-4" />
					
					{/* Title and Welcome Message Skeleton */}
					<div className="flex-1">
						<Skeleton className="h-6 w-32 mb-2" />
						<Skeleton className="h-4 w-48" />
					</div>
					
					{/* User Info Skeleton */}
					<div className="text-right">
						<Skeleton className="h-4 w-32 mb-1 ml-auto" />
						<Skeleton className="h-3 w-24 ml-auto" />
					</div>
				</div>
			</header>

			{/* Main Content Skeleton */}
			<div className="flex flex-1 flex-col gap-6 p-6">
				{/* Metrics Grid Skeleton */}
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					{Array.from({ length: 4 }).map((_, i) => (
						<MetricCardSkeleton key={i} />
					))}
				</div>

				{/* Content Grid Skeleton */}
				<div className="grid gap-4 md:grid-cols-2">
					<ActivitySectionSkeleton />
					<QuickActionsSkeleton />
				</div>
			</div>
		</>
	);
}

function MetricCardSkeleton() {
	return (
		<div className="p-6 rounded-lg border border-border bg-card">
			<div className="flex items-center justify-between mb-2">
				<Skeleton className="h-4 w-24" />
				<Skeleton className="h-5 w-5 rounded" />
			</div>
			<div className="flex items-baseline gap-2">
				<Skeleton className="h-8 w-16" />
				<Skeleton className="h-4 w-12" />
			</div>
		</div>
	);
}

function ActivitySectionSkeleton() {
	return (
		<div className="p-6 rounded-lg border border-border bg-card">
			<div className="flex items-center justify-between mb-4">
				<Skeleton className="h-6 w-32" />
				<Skeleton className="h-5 w-5 rounded" />
			</div>
			<div className="space-y-4">
				{Array.from({ length: 3 }).map((_, i) => (
					<ActivityItemSkeleton key={i} />
				))}
			</div>
		</div>
	);
}

function ActivityItemSkeleton() {
	return (
		<div className="flex items-start gap-3 p-3 rounded-lg">
			<Skeleton className="h-8 w-8 rounded-lg" />
			<div className="flex-1 space-y-2">
				<Skeleton className="h-4 w-32" />
				<Skeleton className="h-3 w-48" />
				<Skeleton className="h-3 w-16" />
			</div>
		</div>
	);
}

function QuickActionsSkeleton() {
	return (
		<div className="p-6 rounded-lg border border-border bg-card">
			<div className="flex items-center justify-between mb-4">
				<Skeleton className="h-6 w-28" />
				<Skeleton className="h-5 w-5 rounded" />
			</div>
			<div className="space-y-2">
				{Array.from({ length: 4 }).map((_, i) => (
					<QuickActionSkeleton key={i} />
				))}
			</div>
		</div>
	);
}

function QuickActionSkeleton() {
	return (
		<div className="flex items-center gap-3 p-3 rounded-lg border border-border">
			<Skeleton className="h-5 w-5 rounded" />
			<Skeleton className="h-4 w-32" />
		</div>
	);
}
