"use client";

/**
 * EdForge EMIS - Dashboard Client Wrapper
 * 
 * Client component that handles:
 * - Sidebar state management (collapsed/expanded)
 * - Sidebar provider context
 * - Client-side interactivity
 * 
 * All user data and authentication is handled server-side.
 */

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { useState, useEffect } from "react";

interface DashboardClientWrapperProps {
	sidebar: React.ReactNode;
	header: React.ReactNode;
	content: React.ReactNode;
}

export function DashboardClientWrapper({ sidebar, header, content }: DashboardClientWrapperProps) {
	const [isClient, setIsClient] = useState(false);

	useEffect(() => {
		setIsClient(true);
	}, []);

	// Prevent hydration mismatch by only rendering interactive components after client mount
	if (!isClient) {
		return (
			<div className="min-h-screen bg-background flex w-full">
				<div className="w-64 bg-sidebar">
					{/* Static sidebar placeholder */}
				</div>
				<div className="flex-1 w-full">
					{/* Static header placeholder */}
					<div className="h-14 border-b bg-background" />
					{/* Static content placeholder */}
					<div className="p-6">
						<div className="animate-pulse space-y-4">
							<div className="h-4 bg-muted rounded w-1/4"></div>
							<div className="h-4 bg-muted rounded w-1/2"></div>
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<SidebarProvider>
			<div className="min-h-screen bg-background flex w-full">
				{sidebar}
				<SidebarInset className="flex-1 w-full">
					{header}
					{content}
				</SidebarInset>
			</div>
		</SidebarProvider>
	);
}
