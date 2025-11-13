"use client";

/**
 * EdForge EMIS - Create School Form
 * 
 * Enterprise-grade form for creating schools using react-hook-form and Zod.
 * Provides robust validation matching backend DTO requirements exactly.
 * 
 * Features:
 * - Field-level validation with inline error messages
 * - Nested form validation (contactInfo, address, gradeRange)
 * - Auto-formatting for phone numbers
 * - Server Actions for secure submission
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Save,
	Loader2,
	ArrowLeft,
	Building2,
	AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { createSchoolAction } from "@/actions/school-actions";
import { getUserFriendlyMessage } from "@/lib/api-errors";
import {
	createSchoolSchema,
	defaultSchoolFormValues,
	SCHOOL_TYPES,
	TIMEZONES,
	GRADE_LEVELS,
	type CreateSchoolFormData,
} from "@/lib/forms/school-form-schema";
import type { CreateSchoolRequest } from "@edforge/shared-types";

/**
 * Auto-format phone number to E.164 format
 * Adds +1 prefix if user starts typing without it
 */
function autoFormatPhone(value: string): string {
	if (value && !value.startsWith('+') && /^\d/.test(value)) {
		return '+1-' + value;
	}
	return value;
}

export function CreateSchoolForm() {
	const router = useRouter();
	const [submitError, setSubmitError] = React.useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = React.useState(false);

	const {
		register,
		handleSubmit,
		formState: { errors },
		watch,
		setValue,
	} = useForm<CreateSchoolFormData>({
		resolver: zodResolver(createSchoolSchema),
		defaultValues: defaultSchoolFormValues,
		mode: "onBlur",
	});

	// Watch for phone number changes to apply auto-formatting
	const primaryPhone = watch("contactInfo.primaryPhone");
	const secondaryPhone = watch("contactInfo.secondaryPhone");

	React.useEffect(() => {
		if (primaryPhone && !primaryPhone.startsWith('+') && /^\d/.test(primaryPhone)) {
			setValue("contactInfo.primaryPhone", autoFormatPhone(primaryPhone));
		}
	}, [primaryPhone, setValue]);

	React.useEffect(() => {
		if (secondaryPhone && !secondaryPhone.startsWith('+') && /^\d/.test(secondaryPhone)) {
			setValue("contactInfo.secondaryPhone", autoFormatPhone(secondaryPhone));
		}
	}, [secondaryPhone, setValue]);

	const onSubmit = async (data: CreateSchoolFormData) => {
		setSubmitError(null);
		setIsSubmitting(true);

		try {
			console.log("[CreateSchoolForm] Creating school with data:", data);

			// Transform to CreateSchoolRequest format (matching backend DTO)
			const schoolData: CreateSchoolRequest = {
				schoolName: data.schoolName,
				schoolCode: data.schoolCode.toUpperCase(), // Backend expects uppercase
				schoolType: data.schoolType,
				contactInfo: {
					primaryEmail: data.contactInfo.primaryEmail,
					primaryPhone: data.contactInfo.primaryPhone,
					secondaryPhone: data.contactInfo.secondaryPhone?.trim() || undefined,
					website: data.contactInfo.website?.trim() || undefined,
					fax: data.contactInfo.fax?.trim() || undefined,
				},
				address: {
					street: data.address.street,
					city: data.address.city,
					state: data.address.state,
					country: data.address.country,
					postalCode: data.address.postalCode,
					timezone: data.address.timezone,
					latitude: data.address.latitude,
					longitude: data.address.longitude,
				},
				gradeRange: {
					lowestGrade: data.gradeRange.lowestGrade,
					highestGrade: data.gradeRange.highestGrade,
				},
				maxStudentCapacity: data.maxStudentCapacity,
				description: data.description?.trim() || undefined,
				motto: data.motto?.trim() || undefined,
				logoUrl: data.logoUrl?.trim() || undefined,
				foundedDate: data.foundedDate?.trim() || undefined,
				principalUserId: data.principalUserId?.trim() || undefined,
				vicePrincipalUserIds: data.vicePrincipalUserIds && data.vicePrincipalUserIds.length > 0
					? data.vicePrincipalUserIds
					: undefined,
			};

			const result = await createSchoolAction(schoolData);
			console.log("[CreateSchoolForm] School created successfully:", result);

			// Redirect to schools list with success
			router.push("/dashboard/admin/schools");
		} catch (err: any) {
			console.error("[CreateSchoolForm] Error creating school:", err);
			const errorMessage = getUserFriendlyMessage(err);
			setSubmitError(errorMessage || "Failed to create school. Please check the form and try again.");
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="flex flex-1 flex-col gap-6">
			<div className="flex items-center gap-4">
				<Button variant="outline" size="sm" asChild>
					<Link href="/dashboard/admin/schools">
						<ArrowLeft className="mr-2 h-4 w-4" />
						Back to Schools
					</Link>
				</Button>
			</div>

			<form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
				{/* Root Error Display */}
				{submitError && (
					<Card className="border-destructive">
						<CardContent className="pt-6">
							<div className="rounded-md bg-destructive/15 border border-destructive/50 p-4 flex items-center gap-2">
								<AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
								<p className="text-sm text-destructive">{submitError}</p>
							</div>
						</CardContent>
					</Card>
				)}

				{/* Basic Information */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Building2 className="h-5 w-5" />
							Basic Information
						</CardTitle>
						<CardDescription>
							Enter the basic details for your school
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="schoolName">
									School Name <span className="text-destructive">*</span>
								</Label>
								<Input
									id="schoolName"
									placeholder="e.g., Lincoln High School"
									{...register("schoolName")}
									className={errors.schoolName ? "border-destructive" : ""}
								/>
								{errors.schoolName && (
									<p className="text-sm text-destructive">{errors.schoolName.message}</p>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="schoolCode">
									School Code <span className="text-destructive">*</span>
								</Label>
								<Input
									id="schoolCode"
									placeholder="e.g., LHS-001"
									{...register("schoolCode")}
									className={errors.schoolCode ? "border-destructive" : ""}
								/>
								{errors.schoolCode && (
									<p className="text-sm text-destructive">{errors.schoolCode.message}</p>
								)}
								<p className="text-xs text-muted-foreground">Will be automatically converted to uppercase</p>
							</div>
						</div>

						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="schoolType">
									School Type <span className="text-destructive">*</span>
								</Label>
								<Select
								// @ts-ignore
									onValueChange={(value) => setValue("schoolType", value as CreateSchoolFormData["schoolType"])}
									defaultValue={defaultSchoolFormValues.schoolType}
								>
									<SelectTrigger className={errors.schoolType ? "border-destructive" : ""}>
										<SelectValue placeholder="Select school type" />
									</SelectTrigger>
									<SelectContent>
										{SCHOOL_TYPES.map((type) => (
											<SelectItem key={type.value} value={type.value}>
												{type.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{errors.schoolType && (
									<p className="text-sm text-destructive">{errors.schoolType.message}</p>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="maxStudentCapacity">
									Maximum Student Capacity <span className="text-destructive">*</span>
								</Label>
								<Input
									id="maxStudentCapacity"
									type="number"
									min="1"
									max="50000"
									{...register("maxStudentCapacity", { valueAsNumber: true })}
									className={errors.maxStudentCapacity ? "border-destructive" : ""}
								/>
								{errors.maxStudentCapacity && (
									<p className="text-sm text-destructive">{errors.maxStudentCapacity.message}</p>
								)}
							</div>
						</div>

						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="lowestGrade">
									Lowest Grade <span className="text-destructive">*</span>
								</Label>
								<Select
								// @ts-ignore
									onValueChange={(value) => setValue("gradeRange.lowestGrade", value as CreateSchoolFormData["gradeRange"]["lowestGrade"])}
									defaultValue={defaultSchoolFormValues.gradeRange.lowestGrade}
								>
									<SelectTrigger className={errors.gradeRange?.lowestGrade ? "border-destructive" : ""}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{GRADE_LEVELS.map((grade) => (
											<SelectItem key={grade} value={grade}>
												{grade}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{errors.gradeRange?.lowestGrade && (
									<p className="text-sm text-destructive">{errors.gradeRange.lowestGrade.message}</p>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="highestGrade">
									Highest Grade <span className="text-destructive">*</span>
								</Label>
								<Select
								// @ts-ignore
									onValueChange={(value) => setValue("gradeRange.highestGrade", value as CreateSchoolFormData["gradeRange"]["highestGrade"])}
									defaultValue={defaultSchoolFormValues.gradeRange.highestGrade}
								>
									<SelectTrigger className={errors.gradeRange?.highestGrade ? "border-destructive" : ""}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{GRADE_LEVELS.map((grade) => (
											<SelectItem key={grade} value={grade}>
												{grade}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{errors.gradeRange?.highestGrade && (
									<p className="text-sm text-destructive">{errors.gradeRange.highestGrade.message}</p>
								)}
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								placeholder="Brief description of the school"
								{...register("description")}
								className={errors.description ? "border-destructive" : ""}
								rows={3}
							/>
							{errors.description && (
								<p className="text-sm text-destructive">{errors.description.message}</p>
							)}
						</div>
					</CardContent>
				</Card>

				{/* Contact Information */}
				<Card>
					<CardHeader>
						<CardTitle>Contact Information</CardTitle>
						<CardDescription>
							Primary contact details for the school
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="primaryEmail">
									Primary Email <span className="text-destructive">*</span>
								</Label>
								<Input
									id="primaryEmail"
									type="email"
									placeholder="e.g., info@school.edu"
									{...register("contactInfo.primaryEmail")}
									className={errors.contactInfo?.primaryEmail ? "border-destructive" : ""}
								/>
								{errors.contactInfo?.primaryEmail && (
									<p className="text-sm text-destructive">{errors.contactInfo.primaryEmail.message}</p>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="primaryPhone">
									Primary Phone <span className="text-destructive">*</span>
								</Label>
								<Input
									id="primaryPhone"
									type="tel"
									placeholder="+1-555-0123"
									{...register("contactInfo.primaryPhone")}
									className={errors.contactInfo?.primaryPhone ? "border-destructive" : ""}
								/>
								{errors.contactInfo?.primaryPhone && (
									<p className="text-sm text-destructive">{errors.contactInfo.primaryPhone.message}</p>
								)}
								<p className="text-xs text-muted-foreground">
									Format: E.164 international format (e.g., +1-555-0123, +44-20-7946-0958)
								</p>
							</div>
						</div>

						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="secondaryPhone">Secondary Phone</Label>
								<Input
									id="secondaryPhone"
									type="tel"
									placeholder="+1-555-0124"
									{...register("contactInfo.secondaryPhone")}
									className={errors.contactInfo?.secondaryPhone ? "border-destructive" : ""}
								/>
								{errors.contactInfo?.secondaryPhone && (
									<p className="text-sm text-destructive">{errors.contactInfo.secondaryPhone.message}</p>
								)}
								<p className="text-xs text-muted-foreground">
									Optional: E.164 format (e.g., +1-555-0124)
								</p>
							</div>

							<div className="space-y-2">
								<Label htmlFor="website">Website</Label>
								<Input
									id="website"
									type="url"
									placeholder="e.g., https://school.edu"
									{...register("contactInfo.website")}
									className={errors.contactInfo?.website ? "border-destructive" : ""}
								/>
								{errors.contactInfo?.website && (
									<p className="text-sm text-destructive">{errors.contactInfo.website.message}</p>
								)}
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Address */}
				<Card>
					<CardHeader>
						<CardTitle>Address</CardTitle>
						<CardDescription>
							Physical address of the school
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="street">
								Street Address <span className="text-destructive">*</span>
							</Label>
							<Input
								id="street"
								placeholder="e.g., 123 Main Street"
								{...register("address.street")}
								className={errors.address?.street ? "border-destructive" : ""}
							/>
							{errors.address?.street && (
								<p className="text-sm text-destructive">{errors.address.street.message}</p>
							)}
						</div>

						<div className="grid gap-4 md:grid-cols-3">
							<div className="space-y-2">
								<Label htmlFor="city">
									City <span className="text-destructive">*</span>
								</Label>
								<Input
									id="city"
									placeholder="e.g., New York"
									{...register("address.city")}
									className={errors.address?.city ? "border-destructive" : ""}
								/>
								{errors.address?.city && (
									<p className="text-sm text-destructive">{errors.address.city.message}</p>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="state">
									State/Province <span className="text-destructive">*</span>
								</Label>
								<Input
									id="state"
									placeholder="e.g., NY"
									{...register("address.state")}
									className={errors.address?.state ? "border-destructive" : ""}
								/>
								{errors.address?.state && (
									<p className="text-sm text-destructive">{errors.address.state.message}</p>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="postalCode">
									Postal Code <span className="text-destructive">*</span>
								</Label>
								<Input
									id="postalCode"
									placeholder="e.g., 10001"
									{...register("address.postalCode")}
									className={errors.address?.postalCode ? "border-destructive" : ""}
								/>
								{errors.address?.postalCode && (
									<p className="text-sm text-destructive">{errors.address.postalCode.message}</p>
								)}
							</div>
						</div>

						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="country">
									Country <span className="text-destructive">*</span>
								</Label>
								<Input
									id="country"
									placeholder="US"
									{...register("address.country")}
									className={errors.address?.country ? "border-destructive" : ""}
									onChange={(e) => {
										const value = e.target.value.toUpperCase().slice(0, 2);
										setValue("address.country", value);
									}}
								/>
								{errors.address?.country && (
									<p className="text-sm text-destructive">{errors.address.country.message}</p>
								)}
								<p className="text-xs text-muted-foreground">2-letter ISO code (e.g., US, CA, GB)</p>
							</div>

							<div className="space-y-2">
								<Label htmlFor="timezone">
									Timezone <span className="text-destructive">*</span>
								</Label>
								<Select
								// @ts-ignore
									onValueChange={(value) => setValue("address.timezone", value)}
									defaultValue={defaultSchoolFormValues.address.timezone}
								>
									<SelectTrigger className={errors.address?.timezone ? "border-destructive" : ""}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{TIMEZONES.map((tz) => (
											<SelectItem key={tz.value} value={tz.value}>
												{tz.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{errors.address?.timezone && (
									<p className="text-sm text-destructive">{errors.address.timezone.message}</p>
								)}
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Actions */}
				<div className="flex items-center justify-end gap-4 pt-6 border-t">
					<Button variant="outline" type="button" asChild>
						<Link href="/dashboard/admin/schools">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Cancel
						</Link>
					</Button>
					<Button type="submit" disabled={isSubmitting}>
						{isSubmitting ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Creating...
							</>
						) : (
							<>
								<Save className="mr-2 h-4 w-4" />
								Create School
							</>
						)}
					</Button>
				</div>
			</form>
		</div>
	);
}
