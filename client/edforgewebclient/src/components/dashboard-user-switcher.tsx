"use client";

/**
 * EdForge EMIS - Dashboard User Switcher
 * 
 * Displays current authenticated user in header with sign-out option.
 * Removed mock user switching functionality - only shows current user.
 */

import { signOut } from "next-auth/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut } from "lucide-react";
import type { User } from "@/types/rbac";

interface DashboardUserSwitcherProps {
	user: User;
}

export function DashboardUserSwitcher({ user }: DashboardUserSwitcherProps) {
	const handleSignOut = () => {
		signOut({ callbackUrl: "/" });
	};
	
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" className="flex items-center gap-2 h-auto">
					<Avatar className="h-8 w-8">
						<AvatarFallback className="text-xs">{user.avatar}</AvatarFallback>
					</Avatar>
					<span className="text-sm font-medium hidden md:inline">{user.name}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuLabel>
					<div className="flex flex-col space-y-1">
						<p className="text-sm font-medium">{user.name}</p>
						<p className="text-xs text-muted-foreground">{user.email}</p>
						<p className="text-xs text-muted-foreground">{user.tenantName}</p>
					</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={handleSignOut}>
					<LogOut className="mr-2 h-4 w-4" />
					Sign Out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}