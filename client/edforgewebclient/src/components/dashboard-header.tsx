"use client";

/**
 * EdForge EMIS - Dashboard Header
 * 
 * Persistent header component that appears on all dashboard pages.
 * Contains the sidebar trigger, page title, and user controls.
 * 
 * This is a Client Component for interactivity (sidebar trigger, user switcher).
 */

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { User } from "@/types/rbac";
import { DashboardUserSwitcher } from "@/components/dashboard-user-switcher";
import { usePathname } from "next/navigation";

// Helper function to get page title from pathname
function getPageTitle(pathname: string): { title: string; description?: string } {
	const segments = pathname.split('/').filter(Boolean);
	
	// Remove 'dashboard' from segments
	const pageSegments = segments.slice(1);
	
	if (pageSegments.length === 0) {
		return { title: "Dashboard", description: "Overview and quick access to key features" };
	}
	
	const lastSegment = pageSegments[pageSegments.length - 1];
	
	// Handle specific page mappings
	const pageMap: Record<string, { title: string; description?: string }> = {
		'students': { title: "Students", description: "Manage student records and information" },
		'teachers': { title: "Teachers", description: "Manage teacher profiles and assignments" },
		'classes': { title: "Classroom Management", description: "Create, manage, and organize classrooms across all grade levels and subjects" },
		'create': { title: "Create Classroom", description: "Set up a new classroom with students and assignments" },
		'curriculum': { title: "Curriculum", description: "Manage courses, classes, and academic schedules" },
		'grades': { title: "Grades", description: "Track and manage student grades and academic performance" },
		'attendance': { title: "Attendance", description: "Monitor and record student attendance" },
		'announcements': { title: "Announcements", description: "Create and manage school-wide announcements" },
		'reports': { title: "Reports", description: "Generate and view academic and administrative reports" },
		'administration': { title: "Administration", description: "System administration and configuration" },
		'analytics': { title: "Analytics", description: "View detailed analytics and insights" },
	};
	
	// Check for exact matches first
	if (pageMap[lastSegment]) {
		return pageMap[lastSegment];
	}
	
	// Handle nested routes (e.g., /students/[studentId])
	if (pageSegments.length > 1) {
		const parentSegment = pageSegments[0];
		if (pageMap[parentSegment]) {
			return {
				title: pageMap[parentSegment].title,
				description: `${pageMap[parentSegment].description} - ${lastSegment}`
			};
		}
	}
	
	// Fallback: capitalize and format the segment
	const formattedTitle = lastSegment
		.split('-')
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
	
	return { title: formattedTitle };
}

interface DashboardHeaderProps {
	user: User;
}

export function DashboardHeader({ user }: DashboardHeaderProps) {
	const pathname = usePathname();
	
	const { title, description } = getPageTitle(pathname);
	
	if (!user) {
		return null;
	}
	
	return (
		<header className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
			<div className="flex items-center gap-2 px-4 w-full">
				<SidebarTrigger className="-ml-1" />
				<Separator orientation="vertical" className="mr-2 h-4" />
				
				<div className="flex-1">
					<h1 className="text-lg font-semibold text-foreground">{title}</h1>
					{description && (
						<p className="text-sm text-muted-foreground">{description}</p>
					)}
				</div>
				
				{/* User Controls */}
				<div className="flex items-center gap-3">
					<DashboardUserSwitcher user={user} />
				</div>
			</div>
		</header>
	);
}
