"use client";

/**
 * EdForge EMIS - Users Table
 * 
 * Client component for displaying users in a table with sorting and actions.
 * Handles client-side interactions and URL-based sorting.
 */

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { User } from "@/types/user";
import {
	ArrowUpDown,
	MoreHorizontal,
	Mail,
	CheckCircle2,
	XCircle,
	User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface UsersTableProps {
	users: User[];
}

type SortBy = "name" | "email" | "role" | "status" | "created";
type SortOrder = "asc" | "desc";

export function UsersTable({ users }: UsersTableProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	
	const [sortBy, setSortBy] = useState<SortBy>(
		(searchParams.get("sortBy") as SortBy) || "name"
	);
	const [sortOrder, setSortOrder] = useState<SortOrder>(
		(searchParams.get("sortOrder") as SortOrder) || "asc"
	);

	// Filter and sort users
	const filteredAndSortedUsers = useMemo(() => {
		const search = searchParams.get("search")?.toLowerCase() || "";
		const role = searchParams.get("role") || "";
		const status = searchParams.get("status") || "";

		let filtered = users.filter((user) => {
			const matchesSearch = !search || 
				(user.name || "").toLowerCase().includes(search) ||
				user.email.toLowerCase().includes(search) ||
				(user.username || "").toLowerCase().includes(search);
			
			const userRole = user.role || user.userRole || "";
			const matchesRole = !role || userRole.toLowerCase() === role.toLowerCase();
			
			const userStatus = user.status || (user.enabled !== false ? "active" : "inactive");
			const matchesStatus = !status || userStatus.toLowerCase() === status.toLowerCase();
			
			return matchesSearch && matchesRole && matchesStatus;
		});

		// Sort users
		filtered.sort((a, b) => {
			let aValue: string | number;
			let bValue: string | number;

			switch (sortBy) {
				case "name":
					aValue = (a.name || a.email || "").toLowerCase();
					bValue = (b.name || b.email || "").toLowerCase();
					break;
				case "email":
					aValue = a.email.toLowerCase();
					bValue = b.email.toLowerCase();
					break;
				case "role":
					aValue = (a.role || a.userRole || "").toLowerCase();
					bValue = (b.role || b.userRole || "").toLowerCase();
					break;
				case "status":
					aValue = (a.status || (a.enabled !== false ? "active" : "inactive")).toLowerCase();
					bValue = (b.status || (b.enabled !== false ? "active" : "inactive")).toLowerCase();
					break;
				case "created":
					aValue = a.created ? new Date(a.created).getTime() : 0;
					bValue = b.created ? new Date(b.created).getTime() : 0;
					break;
				default:
					aValue = (a.name || a.email || "").toLowerCase();
					bValue = (b.name || b.email || "").toLowerCase();
			}

			if (sortOrder === "asc") {
				return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
			} else {
				return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
			}
		});

		return filtered;
	}, [users, searchParams, sortBy, sortOrder]);

	const handleSort = (column: SortBy) => {
		if (sortBy === column) {
			setSortOrder(sortOrder === "asc" ? "desc" : "asc");
		} else {
			setSortBy(column);
			setSortOrder("asc");
		}

		// Update URL
		const params = new URLSearchParams(searchParams.toString());
		params.set("sortBy", column);
		params.set("sortOrder", sortBy === column && sortOrder === "asc" ? "desc" : "asc");
		router.push(`/dashboard/admin/users?${params.toString()}`, { scroll: false });
	};

	const getStatusBadge = (user: User) => {
		const status = user.status || (user.enabled !== false ? "active" : "inactive");
		const isActive = status === "active" || user.enabled !== false;
		
		return (
			<Badge variant={isActive ? "default" : "secondary"}>
				{isActive ? (
					<>
						<CheckCircle2 className="h-3 w-3 mr-1" />
						Active
					</>
				) : (
					<>
						<XCircle className="h-3 w-3 mr-1" />
						Inactive
					</>
				)}
			</Badge>
		);
	};

	const getInitials = (user: User) => {
		if (user.name) {
			return user.name
				.split(" ")
				.map((n) => n[0])
				.join("")
				.toUpperCase()
				.slice(0, 2);
		}
		if (user.email) {
			return user.email[0].toUpperCase();
		}
		return "U";
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Users</CardTitle>
				<CardDescription>
					Manage user accounts, roles, and permissions for your organization
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-[300px]">
									<Button
										variant="ghost"
										size="sm"
										className="h-8 -ml-3"
										onClick={() => handleSort("name")}
									>
										User
										<ArrowUpDown className="ml-2 h-4 w-4" />
									</Button>
								</TableHead>
								<TableHead>
									<Button
										variant="ghost"
										size="sm"
										className="h-8 -ml-3"
										onClick={() => handleSort("email")}
									>
										Email
										<ArrowUpDown className="ml-2 h-4 w-4" />
									</Button>
								</TableHead>
								<TableHead>
									<Button
										variant="ghost"
										size="sm"
										className="h-8 -ml-3"
										onClick={() => handleSort("role")}
									>
										Role
										<ArrowUpDown className="ml-2 h-4 w-4" />
									</Button>
								</TableHead>
								<TableHead>
									<Button
										variant="ghost"
										size="sm"
										className="h-8 -ml-3"
										onClick={() => handleSort("status")}
									>
										Status
										<ArrowUpDown className="ml-2 h-4 w-4" />
									</Button>
								</TableHead>
								<TableHead>
									<Button
										variant="ghost"
										size="sm"
										className="h-8 -ml-3"
										onClick={() => handleSort("created")}
									>
										Created
										<ArrowUpDown className="ml-2 h-4 w-4" />
									</Button>
								</TableHead>
								<TableHead className="w-[70px]">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{filteredAndSortedUsers.map((user) => (
								<TableRow key={user.userId || user.email}>
									<TableCell>
										<div className="flex items-center gap-3">
											<Avatar>
												<AvatarFallback>{getInitials(user)}</AvatarFallback>
											</Avatar>
											<div>
												<div className="font-medium">
													{user.name || user.username || user.email}
												</div>
												{user.username && user.name && (
													<div className="text-sm text-muted-foreground">
														@{user.username}
													</div>
												)}
											</div>
										</div>
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<Mail className="h-4 w-4 text-muted-foreground" />
											{user.email}
										</div>
										{user.verified !== false && (
											<Badge variant="outline" className="mt-1">
												Verified
											</Badge>
										)}
									</TableCell>
									<TableCell>
										<Badge variant="secondary">
											{(user.role || user.userRole || "User").toUpperCase()}
										</Badge>
									</TableCell>
									<TableCell>{getStatusBadge(user)}</TableCell>
									<TableCell>
										{user.created
											? new Date(user.created).toLocaleDateString()
											: "N/A"}
									</TableCell>
									<TableCell>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" size="sm">
													<MoreHorizontal className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuLabel>Actions</DropdownMenuLabel>
												<DropdownMenuSeparator />
												{/* View Details and Edit User actions removed - these endpoints 
													are not available in the API Gateway contract (tenant-api-prod.json).
													Only GET /users and POST /users are currently supported. */}
												<DropdownMenuItem disabled>
													<Mail className="h-4 w-4 mr-2" />
													Send Email
												</DropdownMenuItem>
												{/* Delete User action removed - DELETE /users/{userId} endpoint not available */}
											</DropdownMenuContent>
										</DropdownMenu>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
				{filteredAndSortedUsers.length === 0 && (
					<div className="text-center py-8">
						<UserIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
						<h3 className="text-lg font-semibold mb-2">No users found</h3>
						<p className="text-muted-foreground">
							Try adjusting your search criteria or filters.
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

