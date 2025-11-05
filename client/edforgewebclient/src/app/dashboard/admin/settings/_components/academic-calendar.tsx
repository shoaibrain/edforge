"use client";

/**
 * EdForge EMIS - Academic Calendar Component
 * 
 * Manages holidays, breaks, and important academic dates.
 * Uses real data from API and supports creating/editing holidays.
 */

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, CalendarIcon, Edit, AlertCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { getHolidaysAction } from "@/actions/school-actions";
import type { School, AcademicYear, Holiday } from "@edforge/shared-types";
import { CreateHolidayDialog } from "./create-holiday-dialog";
import { useRouter } from "next/navigation";

interface AcademicCalendarProps {
	school: School;
	academicYears: AcademicYear[];
}

const holidayTypeColors: Record<Holiday["holidayType"], string> = {
	national: "bg-orange-50 text-orange-700 border-orange-200",
	regional: "bg-blue-50 text-blue-700 border-blue-200",
	school: "bg-purple-50 text-purple-700 border-purple-200",
	religious: "bg-green-50 text-green-700 border-green-200",
	cultural: "bg-yellow-50 text-yellow-700 border-yellow-200",
};

const holidayTypeLabels: Record<Holiday["holidayType"], string> = {
	national: "National Holiday",
	regional: "Regional Holiday",
	school: "School Break",
	religious: "Religious Holiday",
	cultural: "Cultural Holiday",
};

export function AcademicCalendar({ school, academicYears }: AcademicCalendarProps) {
	const router = useRouter();
	const [selectedYearId, setSelectedYearId] = useState<string | null>(null);
	const [holidays, setHolidays] = useState<Holiday[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showCreateDialog, setShowCreateDialog] = useState(false);

	// Set default to current academic year or first year
	useEffect(() => {
		if (academicYears.length > 0 && !selectedYearId) {
			const currentYear = academicYears.find(y => y.isCurrent) || academicYears[0];
			setSelectedYearId(currentYear.academicYearId);
		}
	}, [academicYears, selectedYearId]);

	// Fetch holidays when year changes
	useEffect(() => {
		if (selectedYearId && school.schoolId) {
			fetchHolidays();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedYearId, school.schoolId]);

	const fetchHolidays = async () => {
		if (!selectedYearId || !school.schoolId) return;

		setIsLoading(true);
		setError(null);
		try {
			const fetchedHolidays = await getHolidaysAction(school.schoolId, selectedYearId);
			// Sort by start date
			fetchedHolidays.sort((a, b) => {
				return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
			});
			setHolidays(fetchedHolidays);
		} catch (err: any) {
			console.error("[AcademicCalendar] Error fetching holidays:", err);
			setError(err.message || "Failed to load holidays");
		} finally {
			setIsLoading(false);
		}
	};

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

	const formatDateRange = (startDate: string, endDate: string): string => {
		try {
			const start = new Date(startDate);
			const end = new Date(endDate);
			
			// Same day
			if (start.toDateString() === end.toDateString()) {
				return formatDate(startDate);
			}
			
			// Same month
			if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
				return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { day: "numeric", year: "numeric" })}`;
			}
			
			// Different months
			return `${formatDate(startDate)} - ${formatDate(endDate)}`;
		} catch {
			return `${startDate} - ${endDate}`;
		}
	};

	const selectedYear = academicYears.find(y => y.academicYearId === selectedYearId);
	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-2xl font-semibold text-foreground">Academic Calendar</h2>
					<p className="text-sm text-muted-foreground mt-1">
						Manage holidays, breaks, and important dates
					</p>
				</div>
				<Button 
					className="bg-primary hover:bg-primary/90"
					disabled={!selectedYearId}
					onClick={() => setShowCreateDialog(true)}
				>
					<Plus className="h-4 w-4 mr-2" />
					Add Event
				</Button>
			</div>

			{error && (
				<div className="rounded-md bg-destructive/15 border border-destructive/50 p-4 flex items-center gap-2">
					<AlertCircle className="h-5 w-5 text-destructive" />
					<p className="text-sm text-destructive">{error}</p>
				</div>
			)}

			<Card className="p-4 bg-card border-border">
				<div className="flex items-center gap-2">
					<span className="text-sm text-muted-foreground">School Year:</span>
					<Select
						value={selectedYearId || ""}
						onValueChange={(value) => setSelectedYearId(value)}
					>
						<SelectTrigger className="w-[200px]">
							<SelectValue placeholder="Select academic year" />
						</SelectTrigger>
						<SelectContent>
							{academicYears.map((year) => (
								<SelectItem key={year.academicYearId} value={year.academicYearId}>
									{year.yearName} {year.isCurrent && "(Current)"}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</Card>

			{isLoading ? (
				<div className="flex items-center justify-center p-12">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			) : holidays.length === 0 ? (
				<Card className="p-12 text-center border-2 border-dashed">
					<div className="flex flex-col items-center gap-2">
						<CalendarIcon className="h-12 w-12 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							No holidays found for {selectedYear?.yearName || "selected year"}
						</p>
						<Button 
							variant="outline" 
							size="sm" 
							className="mt-4"
							onClick={() => setShowCreateDialog(true)}
						>
							<Plus className="h-4 w-4 mr-2" />
							Add First Holiday
						</Button>
					</div>
				</Card>
			) : (
				<div className="grid gap-3">
					{holidays.map((holiday) => (
						<Card 
							key={holiday.holidayId} 
							className="p-4 bg-card border-border hover:bg-accent/50 transition-colors"
						>
							<div className="flex items-start gap-4">
								<div className="mt-1">
									<CalendarIcon className="h-5 w-5 text-primary" />
								</div>

								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 mb-1 flex-wrap">
										<h3 className="font-medium text-foreground">{holiday.holidayName}</h3>
										<Badge 
											variant="outline" 
											className={holidayTypeColors[holiday.holidayType]}
										>
											{holidayTypeLabels[holiday.holidayType]}
										</Badge>
										{holiday.isRecurring && (
											<Badge variant="outline" className="text-xs">
												Recurring
											</Badge>
										)}
									</div>
									<p className="text-sm text-muted-foreground mb-1">
										{formatDateRange(holiday.startDate, holiday.endDate)}
									</p>
									{holiday.appliesToGradeLevels && holiday.appliesToGradeLevels.length > 0 && (
										<p className="text-xs text-muted-foreground mb-1">
											Applies to: Grades {holiday.appliesToGradeLevels.join(", ")}
										</p>
									)}
								</div>

								<Button 
									variant="ghost" 
									size="sm" 
									className="shrink-0"
									onClick={() => {
										// TODO: Open edit dialog in Phase 5
										console.log("Edit holiday - coming soon");
									}}
								>
									<Edit className="h-4 w-4 mr-1" />
									Edit
								</Button>
							</div>
						</Card>
					))}
				</div>
			)}

			<CreateHolidayDialog
				open={showCreateDialog}
				onOpenChange={setShowCreateDialog}
				schoolId={school.schoolId}
				academicYearId={selectedYearId!}
				academicYear={selectedYear}
				onSuccess={() => {
					fetchHolidays();
					setShowCreateDialog(false);
					router.refresh();
				}}
			/>
		</div>
	);
}
