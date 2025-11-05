"use client";

/**
 * EdForge EMIS - RBAC-Aware Navigation Component
 * 
 * This component renders navigation items based on the current user's role and permissions.
 * 
 * TODO: RBAC filtering is temporarily disabled to allow all authenticated users 
 * access to all POC functionality. This will be re-enabled in a future phase.
 */

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useHydrationSafeState } from "@/hooks/use-hydration-safe-state";
import { useSchool } from "@/contexts/school-context";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarMenuBadge,
} from "@/components/ui/sidebar";
// import { filterNavItemsByPermissions } from "@/types/rbac"; // TODO: Re-enable in future phase
import type { NavItem, User } from "@/types/rbac";

interface NavRBACProps {
	items: NavItem[];
	user: User;
	label?: string;
}

export function NavRBAC({ items, user, label = "Navigation" }: NavRBACProps) {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { currentSchool } = useSchool();
	
	if (!user) {
		return null;
	}

	// TODO: Re-enable RBAC filtering in future phase
	// For now, show all navigation items to all authenticated users
	// const filteredItems = filterNavItemsByPermissions(items, user);
	const filteredItems = items; // Temporary: Show all items

	if (filteredItems.length === 0) {
		return null;
	}

	// Use hydration-safe state for pathname to prevent server/client mismatch
	const safePathname = useHydrationSafeState("", pathname);

	// Helper function to build URL with schoolId for settings pages
	const buildUrl = (url: string): string => {
		if (url === "/dashboard/admin/settings" && currentSchool) {
			const params = new URLSearchParams();
			params.set("schoolId", currentSchool.schoolId);
			// Preserve activeTab if it exists in current URL
			const currentActiveTab = searchParams?.get("activeTab");
			if (currentActiveTab) {
				params.set("activeTab", currentActiveTab);
			}
			return `${url}?${params.toString()}`;
		}
		return url;
	};

	return (
		<SidebarGroup>
			<SidebarGroupLabel>{label}</SidebarGroupLabel>
			<SidebarMenu>
				{filteredItems.map((item) => {
					const Icon = item.icon
						? (LucideIcons[
								item.icon as keyof typeof LucideIcons
							] as React.ComponentType<{ className?: string }>)
						: null;
					// Use safe pathname to prevent server/client mismatch
					const isActive = safePathname === item.url || safePathname?.startsWith(`${item.url}/`);

					// Item with sub-items
					if (item.items && item.items.length > 0) {
						return (
							<Collapsible
								key={item.title}
								asChild
								defaultOpen={false}
								className="group/collapsible"
								suppressHydrationWarning
							>
								<SidebarMenuItem>
									<CollapsibleTrigger asChild>
										<SidebarMenuButton
											tooltip={item.title}
											isActive={isActive}
										>
											{Icon && <Icon className="h-4 w-4" />}
											<span>{item.title}</span>
											{item.badge && (
												<SidebarMenuBadge>
													{item.badge}
												</SidebarMenuBadge>
											)}
											<ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
										</SidebarMenuButton>
									</CollapsibleTrigger>
									<CollapsibleContent>
										<SidebarMenuSub>
											{item.items.map((subItem) => {
												const subIsActive = safePathname === subItem.url || safePathname?.startsWith(`${subItem.url}?`);
												const subItemUrl = buildUrl(subItem.url);
												return (
													<SidebarMenuSubItem key={subItem.title}>
														<SidebarMenuSubButton
															asChild
															isActive={subIsActive}
														>
															<Link href={subItemUrl}>
																<span>{subItem.title}</span>
															</Link>
														</SidebarMenuSubButton>
													</SidebarMenuSubItem>
												);
											})}
										</SidebarMenuSub>
									</CollapsibleContent>
								</SidebarMenuItem>
							</Collapsible>
						);
					}

					// Simple item without sub-items
					return (
						<SidebarMenuItem key={item.title}>
							<SidebarMenuButton
								asChild
								tooltip={item.title}
								isActive={isActive}
							>
								<Link href={item.url}>
									{Icon && <Icon className="h-4 w-4" />}
									<span>{item.title}</span>
									{item.badge && (
										<SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
									)}
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					);
				})}
			</SidebarMenu>
		</SidebarGroup>
	);
}

