"use client";

/**
 * EdForge EMIS - Students Table
 * 
 * Client component for displaying students in a table with sorting and actions.
 * Handles client-side interactions and URL-based sorting.
 */

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { StudentProfile } from "@/types/student";
import {
	ArrowUpDown,
	Eye,
	MoreHorizontal,
	GraduationCap,
	Calendar,
	Award,
	Mail,
	Phone,
	Users,
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

interface StudentsTableProps {
	students: StudentProfile[];
}

type SortBy = "name" | "gpa" | "grade" | "enrollmentDate";
type SortOrder = "asc" | "desc";

export function StudentsTable({ students }: StudentsTableProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	
	const [sortBy, setSortBy] = useState<SortBy>(
		(searchParams.get("sortBy") as SortBy) || "name"
	);
	const [sortOrder, setSortOrder] = useState<SortOrder>(
		(searchParams.get("sortOrder") as SortOrder) || "asc"
	);

	// Filter and sort students
	const filteredAndSortedStudents = useMemo(() => {
		const search = searchParams.get("search")?.toLowerCase() || "";
		const grade = searchParams.get("grade") || "";
		const status = searchParams.get("status") || "";

		let filtered = students.filter((student) => {
			const matchesSearch = !search || 
				student.firstName.toLowerCase().includes(search) ||
				student.lastName.toLowerCase().includes(search) ||
				student.studentId.toLowerCase().includes(search);
			
			const matchesGrade = !grade || student.grade === grade;
			const matchesStatus = !status || student.status === status;
			
			return matchesSearch && matchesGrade && matchesStatus;
		});

		// Sort students
		filtered.sort((a, b) => {
			let aValue: string | number;
			let bValue: string | number;

			switch (sortBy) {
				case "name":
					aValue = `${a.firstName} ${a.lastName}`;
					bValue = `${b.firstName} ${b.lastName}`;
					break;
				case "gpa":
					aValue = a.overallGPA;
					bValue = b.overallGPA;
					break;
				case "grade":
					aValue = a.grade;
					bValue = b.grade;
					break;
				case "enrollmentDate":
					aValue = new Date(a.enrollmentDate).getTime();
					bValue = new Date(b.enrollmentDate).getTime();
					break;
				default:
					aValue = `${a.firstName} ${a.lastName}`;
					bValue = `${b.firstName} ${b.lastName}`;
			}

			if (sortOrder === "asc") {
				return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
			} else {
				return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
			}
		});

		return filtered;
	}, [students, searchParams, sortBy, sortOrder]);

	const handleSort = (column: SortBy) => {
		const params = new URLSearchParams(searchParams.toString());
		
		if (sortBy === column) {
			const newOrder = sortOrder === "asc" ? "desc" : "asc";
			setSortOrder(newOrder);
			params.set("sortOrder", newOrder);
		} else {
			setSortBy(column);
			setSortOrder("asc");
			params.set("sortBy", column);
			params.set("sortOrder", "asc");
		}
		
		router.push(`/dashboard/students?${params.toString()}`, { scroll: false });
	};

	const getGradeColor = (grade: string) => {
		if (grade.includes("9th")) return "text-blue-600";
		if (grade.includes("10th")) return "text-green-600";
		if (grade.includes("11th")) return "text-orange-600";
		if (grade.includes("12th")) return "text-purple-600";
		return "text-muted-foreground";
	};

	const getStatusColor = (status: string) => {
		switch (status) {
			case "active":
				return "bg-success text-success-foreground";
			case "graduated":
				return "bg-secondary text-secondary-foreground";
			case "transferred":
				return "bg-warning text-warning-foreground";
			case "suspended":
				return "bg-error text-error-foreground";
			default:
				return "bg-muted text-muted-foreground";
		}
	};

	const getGPAColor = (gpa: number) => {
		if (gpa >= 3.7) return "text-success font-semibold";
		if (gpa >= 3.0) return "text-primary font-semibold";
		if (gpa >= 2.0) return "text-warning font-semibold";
		return "text-error font-semibold";
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Student Directory</CardTitle>
				<CardDescription>
					Comprehensive list of all students with academic and contact information.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => handleSort("name")}
										className="h-auto p-0 font-semibold"
									>
										Student
										<ArrowUpDown className="ml-2 h-4 w-4" />
									</Button>
								</TableHead>
								<TableHead>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => handleSort("grade")}
										className="h-auto p-0 font-semibold"
									>
										Grade
										<ArrowUpDown className="ml-2 h-4 w-4" />
									</Button>
								</TableHead>
								<TableHead>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => handleSort("gpa")}
										className="h-auto p-0 font-semibold"
									>
										GPA
										<ArrowUpDown className="ml-2 h-4 w-4" />
									</Button>
								</TableHead>
								<TableHead>Contact</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => handleSort("enrollmentDate")}
										className="h-auto p-0 font-semibold"
									>
										Enrolled
										<ArrowUpDown className="ml-2 h-4 w-4" />
									</Button>
								</TableHead>
								<TableHead className="w-[50px]">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{filteredAndSortedStudents.map((student) => (
								<TableRow key={student.studentId}>
									<TableCell>
										<div className="space-y-1">
											<div className="font-medium">
												{student.firstName} {student.lastName}
											</div>
											<div className="text-sm text-muted-foreground font-mono">
												{student.studentId}
											</div>
										</div>
									</TableCell>
									<TableCell>
										<span className={`font-medium ${getGradeColor(student.grade)}`}>
											{student.grade}
										</span>
										{student.section && (
											<span className="text-muted-foreground"> • {student.section}</span>
										)}
									</TableCell>
									<TableCell>
										<span className={getGPAColor(student.overallGPA)}>
											{student.overallGPA.toFixed(2)}
										</span>
									</TableCell>
									<TableCell>
										<div className="space-y-1">
											<div className="flex items-center gap-2 text-sm">
												<Mail className="h-3 w-3 text-muted-foreground" />
												<span className="text-muted-foreground">
													{student.contacts[0]?.email || "No email"}
												</span>
											</div>
											<div className="flex items-center gap-2 text-sm">
												<Phone className="h-3 w-3 text-muted-foreground" />
												<span className="text-muted-foreground">
													{student.contacts[0]?.phone || "No phone"}
												</span>
											</div>
										</div>
									</TableCell>
									<TableCell>
										<Badge className={getStatusColor(student.status)}>
											{student.status.charAt(0).toUpperCase() + student.status.slice(1)}
										</Badge>
									</TableCell>
									<TableCell>
										<div className="text-sm">
											{new Date(student.enrollmentDate).toLocaleDateString()}
										</div>
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
												<DropdownMenuItem asChild>
													<Link
														href={`/dashboard/students/${student.studentId}`}
														className="flex items-center gap-2"
													>
														<Eye className="h-4 w-4" />
														View Profile
													</Link>
												</DropdownMenuItem>
												<DropdownMenuItem>
													<Mail className="h-4 w-4 mr-2" />
													Send Message
												</DropdownMenuItem>
												<DropdownMenuItem>
													<Calendar className="h-4 w-4 mr-2" />
													Schedule Meeting
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
				{filteredAndSortedStudents.length === 0 && (
					<div className="text-center py-8">
						<Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
						<h3 className="text-lg font-semibold mb-2">No students found</h3>
						<p className="text-muted-foreground">
							Try adjusting your search criteria or filters.
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
