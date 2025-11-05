"use client";

/**
 * EdForge EMIS - Application Sidebar with RBAC
 * 
 * This sidebar component dynamically renders navigation items based on the 
 * current user's role and permissions. Different users see different menu items.
 * 
 * Features:
 * - School switcher in header (multiple schools)
 * - Single school display with create button (one school)
 * - Empty state with create button (no schools)
 */

import * as React from "react";
import { GraduationCap } from "lucide-react";
import { NavRBAC } from "@/components/nav-rbac";
import { NavUser } from "@/components/nav-user";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarRail,
	SidebarMenu,
	SidebarMenuItem,
	SidebarMenuButton,
} from "@/components/ui/sidebar";
import type { User } from "@/types/rbac";
import type { School } from "@edforge/shared-types";
import { DASHBOARD_NAVIGATION } from "@/config/navigation";
import { getRoleDisplayName } from "@/types/rbac";
import { SchoolSwitcher } from "@/components/school-switcher";
import { SchoolSelectorSingle } from "@/components/school-selector-single";
import { SchoolEmptyState } from "@/components/school-empty-state";
import { useSchool } from "@/contexts/school-context";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
	user: User;
	/**
	 * List of all schools for the tenant (from server, used as fallback)
	 */
	schools?: School[];
	/**
	 * Currently selected school (from server, used as fallback)
	 */
	currentSchool?: School | null;
}

export function AppSidebar({ user, schools: propSchools = [], currentSchool: propCurrentSchool = null, ...props }: AppSidebarProps) {
	// Use SchoolContext as primary source, props as fallback
	// This ensures sidebar updates when school changes via URL
	const { currentSchool: contextSchool, schools: contextSchools } = useSchool();
	
	// Prioritize context over props (context is updated from URL)
	const currentSchool = contextSchool || propCurrentSchool;
	const schools = contextSchools.length > 0 ? contextSchools : propSchools;

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				{/* School Switcher / Selector */}
				<SidebarMenu>
					<SidebarMenuItem>
						{/* Multiple Schools: Show switcher */}
						{schools.length > 1 ? (
							<SchoolSwitcher 
								currentSchool={currentSchool}
								schools={schools}
							/>
						) : /* Single School: Show name + create button */
						schools.length === 1 && currentSchool ? (
							<SchoolSelectorSingle school={currentSchool} />
						) : /* No Schools: Show empty state */
						(
							<SchoolEmptyState />
						)}
					</SidebarMenuItem>
					{/* User Role Display */}
					<SidebarMenuItem>
						<div className="px-2 py-1.5">
							<div className="text-xs text-muted-foreground">
								{getRoleDisplayName(user.role)}
							</div>
						</div>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent className="sidebar-scroll">
				{/* Main Navigation - Filtered by RBAC */}
				<NavRBAC items={DASHBOARD_NAVIGATION} user={user} label="Menu" />
			</SidebarContent>

			<SidebarFooter>
				{/* User Info - Display tenant details at bottom */}
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" className="h-auto">
							<div className="flex items-center gap-2 w-full">
								<div className="flex flex-col min-w-0 flex-1 text-left sidebar-transition">
									<div className="text-xs text-muted-foreground mt-1 pt-1 border-t">
										<div className="font-mono text-[10px]">Tenant: {user.tenantId}</div>
									</div>
								</div>
							</div>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	);
}
