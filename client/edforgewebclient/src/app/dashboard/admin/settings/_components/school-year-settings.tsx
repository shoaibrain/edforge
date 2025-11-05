"use client";

/**
 * EdForge EMIS - School Year Settings Component
 * 
 * Manages academic years and their configurations.
 * Uses real data from API and supports creating/editing academic years.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, MoreVertical, Calendar, CheckCircle2, Circle, Edit, Archive, Loader2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { CreateSchoolYearDialog } from "./create-school-year-dialog";
import { updateAcademicYearAction } from "@/actions/school-actions";
import type { School, AcademicYear } from "@edforge/shared-types";
import { useRouter } from "next/navigation";

interface SchoolYearSettingsProps {
	school: School;
	academicYears: AcademicYear[];
}

export function SchoolYearSettings({ school, academicYears }: SchoolYearSettingsProps) {
	const router = useRouter();
	const [showCreateDialog, setShowCreateDialog] = useState(false);
	const [isUpdating, setIsUpdating] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const formatDate = (dateString: string): string => {
		try {
			const date = new Date(dateString);
			return date.toLocaleDateString("en-US", { 
				month: "short", 
				day: "numeric", 
				year: "numeric" 
			});
		} catch {
			return dateString;
		}
	};

	const getStatusLabel = (year: AcademicYear): "active" | "upcoming" | "archived" => {
		if (year.isCurrent || year.status === "active") {
			return "active";
		}
		if (year.status === "planned") {
			return "upcoming";
		}
		return "archived";
	};

	const getStatusColor = (status: "active" | "upcoming" | "archived") => {
		switch (status) {
			case "active":
				return "bg-green-50 text-green-700 border-green-200";
			case "upcoming":
				return "bg-blue-50 text-blue-700 border-blue-200";
			case "archived":
				return "bg-gray-50 text-gray-700 border-gray-200";
			default:
				return "bg-gray-50 text-gray-700 border-gray-200";
		}
	};

	const getTermCount = (year: AcademicYear): number => {
		// Use structure.gradingPeriodCount if available, otherwise default to 0
		return year.structure?.gradingPeriodCount || 0;
	};

	const handleSetAsActive = async (yearId: string) => {
		setIsUpdating(yearId);
		setError(null);
		try {
			// First, set all other years to not current
			// Then set this year as current
			await updateAcademicYearAction(school.schoolId, yearId, {
				isCurrent: true,
			});
			router.refresh();
		} catch (err: any) {
			console.error("[SchoolYearSettings] Error setting as active:", err);
			setError(err.message || "Failed to set year as active");
		} finally {
			setIsUpdating(null);
		}
	};

	const handleArchive = async (yearId: string) => {
		setIsUpdating(yearId);
		setError(null);
		try {
			await updateAcademicYearAction(school.schoolId, yearId, {
				status: "archived",
			});
			router.refresh();
		} catch (err: any) {
			console.error("[SchoolYearSettings] Error archiving year:", err);
			setError(err.message || "Failed to archive year");
		} finally {
			setIsUpdating(null);
		}
	};

	// Sort academic years: current first, then by start date descending
	const sortedYears = [...academicYears].sort((a, b) => {
		if (a.isCurrent && !b.isCurrent) return -1;
		if (!a.isCurrent && b.isCurrent) return 1;
		return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
	});

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-2xl font-semibold text-foreground">School Years</h2>
					<p className="text-sm text-muted-foreground mt-1">
						Manage academic years and their configurations
					</p>
				</div>
				<Button 
					onClick={() => setShowCreateDialog(true)} 
					className="bg-primary hover:bg-primary/90"
				>
					<Plus className="h-4 w-4 mr-2" />
					Create School Year
				</Button>
			</div>

			{error && (
				<div className="rounded-md bg-destructive/15 border border-destructive/50 p-4 flex items-center gap-2">
					<AlertCircle className="h-5 w-5 text-destructive" />
					<p className="text-sm text-destructive">{error}</p>
				</div>
			)}

			{academicYears.length === 0 ? (
				<Card className="p-12 text-center border-2 border-dashed">
					<div className="flex flex-col items-center gap-2">
						<Calendar className="h-12 w-12 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							No academic years found
						</p>
						<Button 
							variant="outline" 
							size="sm" 
							className="mt-4"
							onClick={() => setShowCreateDialog(true)}
						>
							<Plus className="h-4 w-4 mr-2" />
							Create First School Year
						</Button>
					</div>
				</Card>
			) : (
				<Card className="bg-card border-border overflow-hidden">
					<div className="divide-y divide-border">
						{sortedYears.map((year) => {
							const status = getStatusLabel(year);
							const termCount = getTermCount(year);
							const isUpdatingThis = isUpdating === year.academicYearId;

							return (
								<div key={year.academicYearId} className="p-6 hover:bg-accent/50 transition-colors">
									<div className="flex items-start justify-between">
										<div className="flex items-start gap-4">
											<div className="mt-1">
												{status === "active" ? (
													<CheckCircle2 className="h-5 w-5 text-green-600" />
												) : (
													<Circle className="h-5 w-5 text-muted-foreground" />
												)}
											</div>

											<div className="space-y-3">
												<div>
													<div className="flex items-center gap-3">
														<h3 className="text-lg font-semibold text-foreground">{year.yearName}</h3>
														<Badge variant="outline" className={getStatusColor(status)}>
															{status.charAt(0).toUpperCase() + status.slice(1)}
														</Badge>
														{year.yearCode && (
															<Badge variant="outline" className="text-xs">
																{year.yearCode}
															</Badge>
														)}
													</div>
													<p className="text-sm text-muted-foreground mt-1">
														Academic year configuration and term management
													</p>
												</div>

												<div className="flex items-center gap-6 text-sm">
													<div className="flex items-center gap-2 text-muted-foreground">
														<Calendar className="h-4 w-4" />
														<span>
															{formatDate(year.startDate)} - {formatDate(year.endDate)}
														</span>
													</div>
													{termCount > 0 && (
														<div className="text-muted-foreground">{termCount} Terms</div>
													)}
												</div>
											</div>
										</div>

										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" size="sm" disabled={isUpdatingThis}>
													{isUpdatingThis ? (
														<Loader2 className="h-4 w-4 animate-spin" />
													) : (
														<MoreVertical className="h-4 w-4" />
													)}
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem 
													onClick={() => {
														// TODO: Open edit dialog in Phase 5
														console.log("Edit academic year - coming soon");
													}}
												>
													<Edit className="h-4 w-4 mr-2" />
													Edit Details
												</DropdownMenuItem>
												<DropdownMenuItem 
													onClick={() => {
														// TODO: Navigate to terms management
														console.log("Manage terms - coming soon");
													}}
												>
													<Calendar className="h-4 w-4 mr-2" />
													Manage Terms
												</DropdownMenuItem>
												{status !== "active" && (
													<DropdownMenuItem 
														onClick={() => handleSetAsActive(year.academicYearId)}
													>
														<CheckCircle2 className="h-4 w-4 mr-2" />
														Set as Active
													</DropdownMenuItem>
												)}
												<DropdownMenuSeparator />
												<DropdownMenuItem 
													className="text-destructive"
													onClick={() => handleArchive(year.academicYearId)}
												>
													<Archive className="h-4 w-4 mr-2" />
													Archive Year
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</div>
							);
						})}
					</div>
				</Card>
			)}

			<CreateSchoolYearDialog 
				open={showCreateDialog} 
				onOpenChange={setShowCreateDialog}
				schoolId={school.schoolId}
				onSuccess={() => {
					router.refresh();
				}}
			/>
		</div>
	);
}
