"use client";

/**
 * EdForge EMIS - Users Filters
 * 
 * Client component for filtering and searching users.
 * Handles URL search params and client-side filtering logic.
 */

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface UsersFiltersProps {
	roles: string[];
	statuses: string[];
}

export function UsersFilters({ roles, statuses }: UsersFiltersProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	
	const [searchTerm, setSearchTerm] = useState(searchParams.get("search") || "");
	const [selectedRole, setSelectedRole] = useState(searchParams.get("role") || "");
	const [selectedStatus, setSelectedStatus] = useState(searchParams.get("status") || "");

	// Update URL when filters change
	useEffect(() => {
		const params = new URLSearchParams();
		
		if (searchTerm) params.set("search", searchTerm);
		if (selectedRole) params.set("role", selectedRole);
		if (selectedStatus) params.set("status", selectedStatus);
		
		const queryString = params.toString();
		const newUrl = queryString ? `/dashboard/admin/users?${queryString}` : "/dashboard/admin/users";
		
		router.push(newUrl, { scroll: false });
	}, [searchTerm, selectedRole, selectedStatus, router]);

	const clearFilters = () => {
		setSearchTerm("");
		setSelectedRole("");
		setSelectedStatus("");
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Filter className="h-5 w-5" />
					Filters & Search
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="flex flex-col gap-4 md:flex-row">
					<div className="flex-1">
						<div className="relative">
							<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Search users by name, email, or username..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								className="pl-10"
							/>
						</div>
					</div>
					<div className="flex gap-2">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" size="sm">
									Role: {selectedRole || "All"}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								<DropdownMenuLabel>Filter by Role</DropdownMenuLabel>
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={() => setSelectedRole("")}>
									All Roles
								</DropdownMenuItem>
								{roles.map((role) => (
									<DropdownMenuItem
										key={role}
										onClick={() => setSelectedRole(role)}
									>
										{role}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" size="sm">
									Status: {selectedStatus || "All"}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								<DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={() => setSelectedStatus("")}>
									All Statuses
								</DropdownMenuItem>
								{statuses.map((status) => (
									<DropdownMenuItem
										key={status}
										onClick={() => setSelectedStatus(status)}
									>
										{status.charAt(0).toUpperCase() + status.slice(1)}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
						{(searchTerm || selectedRole || selectedStatus) && (
							<Button variant="outline" size="sm" onClick={clearFilters}>
								Clear
							</Button>
						)}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

