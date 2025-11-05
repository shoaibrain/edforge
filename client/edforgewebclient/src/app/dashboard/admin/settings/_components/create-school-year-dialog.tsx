"use client";

/**
 * EdForge EMIS - Create School Year Dialog Component
 * 
 * Dialog for creating new academic years.
 * Uses real API integration matching CreateAcademicYearDto structure.
 */

import { useState, useEffect } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { createAcademicYearAction } from "@/actions/school-actions";
import type { CreateAcademicYearRequest } from "@edforge/shared-types";
import { getUserFriendlyMessage } from "@/lib/api-errors";

interface CreateSchoolYearDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	schoolId: string;
	onSuccess?: () => void;
}

export function CreateSchoolYearDialog({ open, onOpenChange, schoolId, onSuccess }: CreateSchoolYearDialogProps) {
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [formData, setFormData] = useState({
		yearName: "",
		yearCode: "",
		startDate: "",
		endDate: "",
		gradingPeriodCount: "4",
		isCurrent: false,
	});

	// Auto-generate yearCode from yearName when yearName changes
	useEffect(() => {
		if (formData.yearName && !formData.yearCode) {
			// Extract years from format like "2025-2026" or "2025-26"
			const match = formData.yearName.match(/(\d{4})/);
			if (match) {
				const year = match[1];
				const shortYear = year.slice(-2);
				setFormData(prev => ({ ...prev, yearCode: `AY${shortYear}` }));
			}
		}
	}, [formData.yearName, formData.yearCode]);

	// Reset form when dialog closes
	useEffect(() => {
		if (!open) {
			setFormData({
				yearName: "",
				yearCode: "",
				startDate: "",
				endDate: "",
				gradingPeriodCount: "4",
				isCurrent: false,
			});
			setError(null);
		}
	}, [open]);

	const handleCreate = async () => {
		if (!formData.yearName || !formData.yearCode || !formData.startDate || !formData.endDate) {
			setError("Please fill in all required fields");
			return;
		}

		setIsCreating(true);
		setError(null);

		try {
			const yearData: CreateAcademicYearRequest = {
				yearName: formData.yearName,
				yearCode: formData.yearCode,
				startDate: formData.startDate, // ISO format from date input
				endDate: formData.endDate, // ISO format from date input
				isCurrent: formData.isCurrent,
				structure: {
					semesterCount: parseInt(formData.gradingPeriodCount) >= 4 ? 2 : parseInt(formData.gradingPeriodCount) === 3 ? 3 : 2,
					gradingPeriodCount: parseInt(formData.gradingPeriodCount),
					instructionalDays: 0, // Will be calculated by backend
					schoolDays: 0, // Will be calculated by backend
				},
			};

			await createAcademicYearAction(schoolId, yearData);
			
			// Success - close dialog and refresh
			onOpenChange(false);
			if (onSuccess) {
				onSuccess();
			}
		} catch (err: any) {
			console.error("[CreateSchoolYearDialog] Error creating academic year:", err);
			// Use improved error message extraction to show detailed backend validation errors
			const errorMessage = getUserFriendlyMessage(err);
			setError(errorMessage || "Failed to create academic year. Please try again.");
		} finally {
			setIsCreating(false);
		}
	};

	const handleInputChange = (field: string, value: string | boolean) => {
		if (field === "yearName" && typeof value === "string") {
			// Auto-generate yearCode if not manually set
			const match = value.match(/(\d{4})/);
			if (match && !formData.yearCode) {
				const year = match[1];
				const shortYear = year.slice(-2);
				setFormData(prev => ({ ...prev, [field]: value, yearCode: `AY${shortYear}` }));
				return;
			}
		}
		setFormData(prev => ({ ...prev, [field]: value }));
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="bg-card border-border sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle className="text-foreground">Create School Year</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						Set up a new academic year with start and end dates
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{error && (
						<div className="rounded-md bg-destructive/15 border border-destructive/50 p-3 flex items-center gap-2">
							<AlertCircle className="h-4 w-4 text-destructive" />
							<p className="text-sm text-destructive">{error}</p>
						</div>
					)}

					<div>
						<Label htmlFor="year-name">School Year Name *</Label>
						<Input 
							id="year-name" 
							placeholder="e.g., 2025-2026" 
							value={formData.yearName}
							onChange={(e) => handleInputChange("yearName", e.target.value)}
							className="mt-1.5 bg-input border-border" 
							required
						/>
						<p className="text-xs text-muted-foreground mt-1">
							Display name for the academic year
						</p>
					</div>

					<div>
						<Label htmlFor="year-code">Year Code *</Label>
						<Input 
							id="year-code" 
							placeholder="e.g., AY25" 
							value={formData.yearCode}
							onChange={(e) => handleInputChange("yearCode", e.target.value)}
							className="mt-1.5 bg-input border-border" 
							required
							maxLength={20}
						/>
						<p className="text-xs text-muted-foreground mt-1">
							Short code for the academic year (2-20 characters)
						</p>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div>
							<Label htmlFor="start-date">Start Date *</Label>
							<Input 
								id="start-date" 
								type="date" 
								value={formData.startDate}
								onChange={(e) => handleInputChange("startDate", e.target.value)}
								className="mt-1.5 bg-input border-border" 
								required
							/>
						</div>
						<div>
							<Label htmlFor="end-date">End Date *</Label>
							<Input 
								id="end-date" 
								type="date" 
								value={formData.endDate}
								onChange={(e) => handleInputChange("endDate", e.target.value)}
								className="mt-1.5 bg-input border-border" 
								required
							/>
						</div>
					</div>

					<div>
						<Label htmlFor="grading-period-count">Number of Grading Periods</Label>
						<select
							id="grading-period-count"
							value={formData.gradingPeriodCount}
							onChange={(e) => handleInputChange("gradingPeriodCount", e.target.value)}
							className="mt-1.5 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
						>
							<option value="2">2 (Semesters)</option>
							<option value="3">3 (Trimesters)</option>
							<option value="4">4 (Quarters)</option>
							<option value="6">6 (Six Periods)</option>
						</select>
						<p className="text-xs text-muted-foreground mt-1">
							Number of grading periods in this academic year
						</p>
					</div>

					<div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3">
						<input 
							type="checkbox" 
							id="is-current" 
							checked={formData.isCurrent}
							onChange={(e) => handleInputChange("isCurrent", e.target.checked)}
							className="rounded" 
						/>
						<Label htmlFor="is-current" className="text-sm font-normal cursor-pointer">
							Set as active school year immediately
						</Label>
					</div>
				</div>

				<DialogFooter>
					<Button 
						variant="outline" 
						onClick={() => onOpenChange(false)}
						disabled={isCreating}
					>
						Cancel
					</Button>
					<Button 
						onClick={handleCreate} 
						disabled={isCreating || !formData.yearName || !formData.yearCode || !formData.startDate || !formData.endDate} 
						className="bg-primary hover:bg-primary/90"
					>
						{isCreating ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								Creating...
							</>
						) : (
							<>
								<CheckCircle className="h-4 w-4 mr-2" />
								Create School Year
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
