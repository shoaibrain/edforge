"use client";

/**
 * EdForge EMIS - Create Holiday Dialog Component
 * 
 * Dialog for creating new holidays/events within an academic year.
 * Uses real API integration matching CreateHolidayDto structure.
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
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { createHolidayAction } from "@/actions/school-actions";
import type { CreateHolidayRequest, AcademicYear } from "@edforge/shared-types";
import { getUserFriendlyMessage } from "@/lib/api-errors";

interface CreateHolidayDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	schoolId: string;
	academicYearId: string;
	academicYear?: AcademicYear;
	onSuccess?: () => void;
}

const holidayTypeOptions = [
	{ value: 'holiday', label: 'Holiday' },
	{ value: 'professional_day', label: 'Professional Day' },
	{ value: 'weather_closure', label: 'Weather Closure' },
	{ value: 'emergency', label: 'Emergency Closure' },
] as const;

export function CreateHolidayDialog({ 
	open, 
	onOpenChange, 
	schoolId, 
	academicYearId,
	academicYear,
	onSuccess 
}: CreateHolidayDialogProps) {
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [formData, setFormData] = useState({
		name: "",
		type: "holiday" as "holiday" | "professional_day" | "weather_closure" | "emergency",
		startDate: "",
		endDate: "",
		allDay: true,
		description: "",
		isRecurring: false,
		affectsAttendance: true,
		affectsPayroll: true,
	});

	// Reset form when dialog closes
	useEffect(() => {
		if (!open) {
			setFormData({
				name: "",
				type: "holiday",
				startDate: "",
				endDate: "",
				allDay: true,
				description: "",
				isRecurring: false,
				affectsAttendance: true,
				affectsPayroll: true,
			});
			setError(null);
		}
	}, [open]);

	// Set default dates based on academic year if available
	useEffect(() => {
		if (academicYear && open && !formData.startDate) {
			// Set start date to academic year start date
			setFormData(prev => ({ ...prev, startDate: academicYear.startDate.split('T')[0] }));
		}
	}, [academicYear, open]);

	const handleCreate = async () => {
		if (!formData.name || !formData.startDate || !formData.endDate) {
			setError("Please fill in all required fields");
			return;
		}

		// Validate dates are within academic year boundaries
		if (academicYear) {
			const yearStart = new Date(academicYear.startDate);
			const yearEnd = new Date(academicYear.endDate);
			const holidayStart = new Date(formData.startDate);
			const holidayEnd = new Date(formData.endDate);

			if (holidayStart < yearStart || holidayEnd > yearEnd) {
				setError(`Holiday dates must be within academic year: ${academicYear.startDate.split('T')[0]} to ${academicYear.endDate.split('T')[0]}`);
				return;
			}
		}

		setIsCreating(true);
		setError(null);

		try {
			const holidayData: CreateHolidayRequest = {
				name: formData.name,
				type: formData.type,
				startDate: formData.startDate,
				endDate: formData.endDate,
				allDay: formData.allDay || undefined,
				description: formData.description || undefined,
				isRecurring: formData.isRecurring || undefined,
				affectsAttendance: formData.affectsAttendance !== undefined ? formData.affectsAttendance : undefined,
				affectsPayroll: formData.affectsPayroll !== undefined ? formData.affectsPayroll : undefined,
			};

			await createHolidayAction(schoolId, academicYearId, holidayData);
			
			// Success - close dialog and refresh
			onOpenChange(false);
			if (onSuccess) {
				onSuccess();
			}
		} catch (err: any) {
			console.error("[CreateHolidayDialog] Error creating holiday:", err);
			// Use improved error message extraction to show detailed backend validation errors
			const errorMessage = getUserFriendlyMessage(err);
			setError(errorMessage || "Failed to create holiday. Please try again.");
		} finally {
			setIsCreating(false);
		}
	};

	const handleInputChange = (field: string, value: string | boolean) => {
		setFormData(prev => ({ ...prev, [field]: value }));
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="bg-card border-border sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="text-foreground">Create Holiday / Event</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						Add a holiday, break, or important date to the academic calendar
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
						<Label htmlFor="holiday-name">Holiday Name *</Label>
						<Input 
							id="holiday-name" 
							placeholder="e.g., Thanksgiving Break, Winter Holiday" 
							value={formData.name}
							onChange={(e) => handleInputChange("name", e.target.value)}
							className="mt-1.5 bg-input border-border" 
							required
						/>
						<p className="text-xs text-muted-foreground mt-1">
							Display name for this holiday or event
						</p>
					</div>

					<div>
						<Label htmlFor="holiday-type">Event Type *</Label>
						<select
							id="holiday-type"
							value={formData.type}
							onChange={(e) => handleInputChange("type", e.target.value)}
							className="mt-1.5 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
							required
						>
							{holidayTypeOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
						<p className="text-xs text-muted-foreground mt-1">
							Category of this event
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
								min={academicYear?.startDate.split('T')[0]}
								max={academicYear?.endDate.split('T')[0]}
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
								min={formData.startDate || academicYear?.startDate.split('T')[0]}
								max={academicYear?.endDate.split('T')[0]}
								className="mt-1.5 bg-input border-border" 
								required
							/>
						</div>
					</div>

					<div>
						<Label htmlFor="description">Description</Label>
						<Textarea 
							id="description" 
							placeholder="Additional details about this holiday or event"
							value={formData.description}
							onChange={(e) => handleInputChange("description", e.target.value)}
							className="mt-1.5 bg-input border-border min-h-[80px]"
							rows={3}
						/>
					</div>

					<div className="space-y-3">
						<div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3">
							<input 
								type="checkbox" 
								id="all-day" 
								checked={formData.allDay}
								onChange={(e) => handleInputChange("allDay", e.target.checked)}
								className="rounded" 
							/>
							<Label htmlFor="all-day" className="text-sm font-normal cursor-pointer">
								All-day event
							</Label>
						</div>

						<div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3">
							<input 
								type="checkbox" 
								id="is-recurring" 
								checked={formData.isRecurring}
								onChange={(e) => handleInputChange("isRecurring", e.target.checked)}
								className="rounded" 
							/>
							<Label htmlFor="is-recurring" className="text-sm font-normal cursor-pointer">
								Recurring event (e.g., weekly holidays)
							</Label>
						</div>

						<div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3">
							<input 
								type="checkbox" 
								id="affects-attendance" 
								checked={formData.affectsAttendance}
								onChange={(e) => handleInputChange("affectsAttendance", e.target.checked)}
								className="rounded" 
							/>
							<Label htmlFor="affects-attendance" className="text-sm font-normal cursor-pointer">
								Affects attendance calculations
							</Label>
						</div>

						<div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/30 p-3">
							<input 
								type="checkbox" 
								id="affects-payroll" 
								checked={formData.affectsPayroll}
								onChange={(e) => handleInputChange("affectsPayroll", e.target.checked)}
								className="rounded" 
							/>
							<Label htmlFor="affects-payroll" className="text-sm font-normal cursor-pointer">
								Affects payroll calculations
							</Label>
						</div>
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
						disabled={isCreating || !formData.name || !formData.startDate || !formData.endDate} 
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
								Create Holiday
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

