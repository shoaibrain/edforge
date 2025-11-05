"use client";

/**
 * EdForge EMIS - Classes Page Content
 * 
 * Client component for interactive classroom management features.
 * Handles filtering, sorting, and search functionality.
 */

import { useState, useMemo } from "react";
import { mockClassrooms } from "@/data/mock-classrooms";
import { Classroom } from "@/types/classroom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
	Select, 
	SelectContent, 
	SelectItem, 
	SelectTrigger, 
	SelectValue 
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { 
	BookOpen, 
	Users, 
	Calendar, 
	Search, 
	Filter,
	Plus,
	Eye,
	Edit,
	MoreHorizontal,
	BarChart3,
	GraduationCap,
	Clock,
	MapPin,
	ArrowUpDown,
	CheckCircle,
	AlertCircle,
	Settings,
	Copy,
	Archive,
	Trash2
} from "lucide-react";
import Link from "next/link";

interface ClassesPageContentProps {
	initialClassrooms: Classroom[];
}

export function ClassesPageContent({ initialClassrooms }: ClassesPageContentProps) {
	const [classrooms] = useState<Classroom[]>(initialClassrooms);
	const [searchQuery, setSearchQuery] = useState("");
	const [filterGrade, setFilterGrade] = useState<string>("all");
	const [filterStatus, setFilterStatus] = useState<string>("all");

	// Filter and search classrooms
	const filteredClassrooms = useMemo(() => {
		return classrooms.filter((classroom) => {
			const matchesSearch = classroom.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
								classroom.subject.toLowerCase().includes(searchQuery.toLowerCase());
			const matchesGrade = filterGrade === "all" || classroom.grade === filterGrade;
			const matchesStatus = filterStatus === "all" || classroom.status === filterStatus;
			
			return matchesSearch && matchesGrade && matchesStatus;
		});
	}, [classrooms, searchQuery, filterGrade, filterStatus]);

	// Get unique values for filters
	const grades = Array.from(new Set(classrooms.map(c => c.grade)));
	const statuses = Array.from(new Set(classrooms.map(c => c.status)));

	return (
		<div className="flex flex-1 flex-col gap-6 p-6">
			{/* Header Section */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">Classroom Management</h1>
					<p className="text-muted-foreground">
						Create, manage, and organize classrooms across all grade levels and subjects.
					</p>
				</div>
				<Button asChild>
					<Link href="/dashboard/curriculum/classes/create">
						<Plus className="mr-2 h-4 w-4" />
						Create Classroom
					</Link>
				</Button>
			</div>

			{/* Statistics Cards */}
			<div className="grid gap-4 md:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Total Classrooms</CardTitle>
						<BookOpen className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{classrooms.length}</div>
						<p className="text-xs text-muted-foreground">
							{classrooms.filter(c => c.status === 'active').length} active this semester
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Total Students</CardTitle>
						<Users className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{classrooms.reduce((sum, c) => sum + c.enrolled, 0)}
						</div>
						<p className="text-xs text-muted-foreground">Currently enrolled</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Avg. Capacity</CardTitle>
						<Users className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold text-primary">
							{Math.round((classrooms.reduce((sum, c) => sum + (c.enrolled / c.capacity * 100), 0) / classrooms.length))}%
						</div>
						<p className="text-xs text-muted-foreground">Utilization rate</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Active Teachers</CardTitle>
						<Users className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{Array.from(new Set(classrooms.map(c => c.primaryTeacher.id))).length}
						</div>
						<p className="text-xs text-muted-foreground">Teaching this year</p>
					</CardContent>
				</Card>
			</div>

			{/* Filters & Search */}
			<Card>
				<CardHeader>
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Filter className="h-4 w-4" />
						<span className="font-medium">Filters & Search</span>
					</div>
				</CardHeader>
				<CardContent>
					<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
						<div className="relative flex-1">
							<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Search classrooms by name, code, or teacher..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-10"
							/>
						</div>
						<div className="flex gap-2">
							<Select value={filterGrade} onValueChange={setFilterGrade}>
								<SelectTrigger className="w-[140px]">
									<SelectValue placeholder="Grade: All" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">Grade: All</SelectItem>
									{grades.map((grade) => (
										<SelectItem key={grade} value={grade}>
											{grade}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select value="all">
								<SelectTrigger className="w-[140px]">
									<SelectValue placeholder="Subject: All" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">Subject: All</SelectItem>
									<SelectItem value="Mathematics">Mathematics</SelectItem>
									<SelectItem value="English">English</SelectItem>
									<SelectItem value="Science">Science</SelectItem>
									<SelectItem value="History">History</SelectItem>
									<SelectItem value="Arts">Arts</SelectItem>
									<SelectItem value="Physical Education">Physical Education</SelectItem>
								</SelectContent>
							</Select>
							<Select value={filterStatus} onValueChange={setFilterStatus}>
								<SelectTrigger className="w-[140px]">
									<SelectValue placeholder="Status: All" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">Status: All</SelectItem>
									{statuses.map((status) => (
										<SelectItem key={status} value={status}>
											{status}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Classroom Directory Table */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle className="text-lg">Classroom Directory</CardTitle>
							<CardDescription>
								Comprehensive list of all classrooms with enrollment and scheduling information.
							</CardDescription>
						</div>
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<span>{filteredClassrooms.length} classrooms</span>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="cursor-pointer hover:bg-muted/50">
										<div className="flex items-center gap-2">
											Classroom
											<ArrowUpDown className="h-3 w-3 opacity-50" />
										</div>
									</TableHead>
									<TableHead className="cursor-pointer hover:bg-muted/50">
										<div className="flex items-center gap-2">
											Grade
											<ArrowUpDown className="h-3 w-3 opacity-50" />
										</div>
									</TableHead>
									<TableHead>Subject</TableHead>
									<TableHead>Teacher</TableHead>
									<TableHead className="cursor-pointer hover:bg-muted/50">
										<div className="flex items-center gap-2">
											Enrollment
											<ArrowUpDown className="h-3 w-3 opacity-50" />
										</div>
									</TableHead>
									<TableHead>Schedule</TableHead>
									<TableHead className="cursor-pointer hover:bg-muted/50">
										<div className="flex items-center gap-2">
											Status
											<ArrowUpDown className="h-3 w-3 opacity-50" />
										</div>
									</TableHead>
									<TableHead className="w-[50px]">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filteredClassrooms.map((classroom) => (
									<TableRow key={classroom.id} className="hover:bg-muted/50">
										<TableCell>
											<div className="space-y-1">
												<div className="flex items-center gap-2">
													<div 
														className="h-3 w-3 rounded-full"
														style={{ backgroundColor: classroom.themeColor || "#3B82F6" }}
													/>
													<Link 
														href={`/dashboard/curriculum/classes/${classroom.id}`}
														className="font-medium hover:text-primary transition-colors"
													>
														{classroom.name}
													</Link>
												</div>
												<p className="text-sm text-muted-foreground">{classroom.code}</p>
											</div>
										</TableCell>
										<TableCell>
											<Badge variant="outline" className="text-xs">
												{classroom.grade}
											</Badge>
										</TableCell>
										<TableCell>
											<span className="text-sm">{classroom.subject}</span>
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												<Avatar className="h-6 w-6">
													<AvatarFallback className="text-xs">
														{classroom.primaryTeacher.teacherName.split(' ').map(n => n[0]).join('')}
													</AvatarFallback>
												</Avatar>
												<span className="text-sm">{classroom.primaryTeacher.teacherName}</span>
											</div>
										</TableCell>
										<TableCell>
											<div className="space-y-1">
												<div className="flex items-center gap-2">
													<span className="text-sm font-medium text-primary">
														{classroom.enrolled}/{classroom.capacity}
													</span>
													<span className="text-xs text-muted-foreground">
														({Math.round((classroom.enrolled / classroom.capacity) * 100)}%)
													</span>
												</div>
												<div className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
													<div
														className="h-full bg-primary transition-all duration-300"
														style={{
															width: `${(classroom.enrolled / classroom.capacity) * 100}%`,
														}}
													/>
												</div>
											</div>
										</TableCell>
										<TableCell>
											<div className="space-y-1">
												<div className="flex items-center gap-1 text-sm text-muted-foreground">
													<Clock className="h-3 w-3" />
													<span>Mon, Wed, Fri 09:00 - 10:30</span>
												</div>
												<div className="text-xs text-muted-foreground">
													Room 301
												</div>
											</div>
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												{classroom.status === 'active' ? (
													<CheckCircle className="h-4 w-4 text-green-600" />
												) : (
													<AlertCircle className="h-4 w-4 text-gray-600" />
												)}
												<Badge 
													variant="outline" 
													className={classroom.status === 'active' ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-700 border-gray-200"}
												>
													{classroom.status}
												</Badge>
											</div>
										</TableCell>
										<TableCell>
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" size="icon" className="h-8 w-8">
														<MoreHorizontal className="h-4 w-4" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuLabel>Actions</DropdownMenuLabel>
													<DropdownMenuSeparator />
													<DropdownMenuItem asChild>
														<Link href={`/dashboard/curriculum/classes/${classroom.id}`}>
															<Eye className="mr-2 h-4 w-4" />
															View Details
														</Link>
													</DropdownMenuItem>
													<DropdownMenuItem asChild>
														<Link href={`/dashboard/curriculum/classes/${classroom.id}/edit`}>
															<Edit className="mr-2 h-4 w-4" />
															Edit Classroom
														</Link>
													</DropdownMenuItem>
													<DropdownMenuItem>
														<Users className="mr-2 h-4 w-4" />
														Manage Students
													</DropdownMenuItem>
													<DropdownMenuItem>
														<Calendar className="mr-2 h-4 w-4" />
														View Schedule
													</DropdownMenuItem>
													<DropdownMenuItem>
														<BarChart3 className="mr-2 h-4 w-4" />
														View Analytics
													</DropdownMenuItem>
													<DropdownMenuItem>
														<Copy className="mr-2 h-4 w-4" />
														Duplicate
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem className="text-destructive">
														<Archive className="mr-2 h-4 w-4" />
														Archive
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
					
					{filteredClassrooms.length === 0 && (
						<div className="text-center py-8">
							<BookOpen className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
							<p className="text-sm text-muted-foreground">No classrooms found matching your criteria.</p>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
