"use client";

/**
 * EdForge EMIS - Students Filters
 * 
 * Client component for filtering and searching students.
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

interface StudentsFiltersProps {
	grades: string[];
	statuses: string[];
}

export function StudentsFilters({ grades, statuses }: StudentsFiltersProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	
	const [searchTerm, setSearchTerm] = useState(searchParams.get("search") || "");
	const [selectedGrade, setSelectedGrade] = useState(searchParams.get("grade") || "");
	const [selectedStatus, setSelectedStatus] = useState(searchParams.get("status") || "");

	// Update URL when filters change
	useEffect(() => {
		const params = new URLSearchParams();
		
		if (searchTerm) params.set("search", searchTerm);
		if (selectedGrade) params.set("grade", selectedGrade);
		if (selectedStatus) params.set("status", selectedStatus);
		
		const queryString = params.toString();
		const newUrl = queryString ? `/dashboard/students?${queryString}` : "/dashboard/students";
		
		router.push(newUrl, { scroll: false });
	}, [searchTerm, selectedGrade, selectedStatus, router]);

	const clearFilters = () => {
		setSearchTerm("");
		setSelectedGrade("");
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
								placeholder="Search students by name or ID..."
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
									Grade: {selectedGrade || "All"}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								<DropdownMenuLabel>Filter by Grade</DropdownMenuLabel>
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={() => setSelectedGrade("")}>
									All Grades
								</DropdownMenuItem>
								{grades.map((grade) => (
									<DropdownMenuItem
										key={grade}
										onClick={() => setSelectedGrade(grade)}
									>
										{grade}
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
						{(searchTerm || selectedGrade || selectedStatus) && (
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
