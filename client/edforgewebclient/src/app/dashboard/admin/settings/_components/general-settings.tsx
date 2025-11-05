"use client";

/**
 * EdForge EMIS - General Settings Component
 * 
 * Handles basic institution information, contact details, and mission statement.
 * Uses real school data from API and supports updates via Server Actions.
 */

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Save, CheckCircle, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { updateSchoolAction, getSchoolAction } from "@/actions/school-actions";
import type { School } from "@edforge/shared-types";
import { useRouter } from "next/navigation";
import axios from "axios";
import { HttpStatus } from "@/types/api";

const SCHOOL_TYPES = [
	{ value: "elementary", label: "Elementary" },
	{ value: "middle", label: "Middle School" },
	{ value: "high", label: "High School" },
	{ value: "k12", label: "K-12" },
	{ value: "alternative", label: "Alternative" },
	{ value: "special", label: "Special Education" },
];

interface GeneralSettingsProps {
	school: School;
	onSchoolUpdate?: (updatedSchool: School) => void;
}

export function GeneralSettings({ school, onSchoolUpdate }: GeneralSettingsProps) {
	const router = useRouter();
	const [isSaving, setIsSaving] = useState(false);
	const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const [error, setError] = useState<string | null>(null);
	const [currentSchool, setCurrentSchool] = useState<School>(school);

	// Form state
	const [formData, setFormData] = useState({
		schoolName: school.schoolName || "",
		schoolCode: school.schoolCode || "",
		schoolType: school.schoolType || "elementary",
		description: school.description || "",
		motto: school.motto || "",
		logoUrl: school.logoUrl || "",
		accreditation: school.accreditationInfo?.accreditedBy?.join(", ") || "",
		// Contact Info
		primaryEmail: school.contactInfo?.primaryEmail || "",
		primaryPhone: school.contactInfo?.primaryPhone || "",
		secondaryPhone: school.contactInfo?.secondaryPhone || "",
		website: school.contactInfo?.website || "",
		// Address
		street: school.address?.street || "",
		city: school.address?.city || "",
		state: school.address?.state || "",
		country: school.address?.country || "US",
		postalCode: school.address?.postalCode || "",
	});

	// Update currentSchool when school prop changes
	useEffect(() => {
		setCurrentSchool(school);
	}, [school]);

	// Update form when school data changes
	useEffect(() => {
		setFormData({
			schoolName: currentSchool.schoolName || "",
			schoolCode: currentSchool.schoolCode || "",
			schoolType: currentSchool.schoolType || "elementary",
			description: currentSchool.description || "",
			motto: currentSchool.motto || "",
			logoUrl: currentSchool.logoUrl || "",
			accreditation: currentSchool.accreditationInfo?.accreditedBy?.join(", ") || "",
			primaryEmail: currentSchool.contactInfo?.primaryEmail || "",
			primaryPhone: currentSchool.contactInfo?.primaryPhone || "",
			secondaryPhone: currentSchool.contactInfo?.secondaryPhone || "",
			website: currentSchool.contactInfo?.website || "",
			street: currentSchool.address?.street || "",
			city: currentSchool.address?.city || "",
			state: currentSchool.address?.state || "",
			country: currentSchool.address?.country || "US",
			postalCode: currentSchool.address?.postalCode || "",
		});
	}, [currentSchool]);

	const handleSave = async (retryCount = 0) => {
		setIsSaving(true);
		setSaveStatus("saving");
		setError(null);

		try {
			// Prepare update data matching UpdateSchoolDto structure
			const updateData: any = {
				schoolName: formData.schoolName,
				contactInfo: {
					primaryEmail: formData.primaryEmail,
					primaryPhone: formData.primaryPhone,
					secondaryPhone: formData.secondaryPhone || undefined,
					website: formData.website || undefined,
				},
				address: {
					street: formData.street,
					city: formData.city,
					state: formData.state,
					country: formData.country,
					postalCode: formData.postalCode,
					timezone: currentSchool.address?.timezone || "America/New_York", // Preserve existing timezone
				},
				description: formData.description || undefined,
				version: currentSchool.version, // Required for optimistic locking - use current school version
			};

			// Only include accreditation if provided
			if (formData.accreditation) {
				updateData.accreditationInfo = {
					accreditedBy: formData.accreditation.split(",").map((s) => s.trim()).filter(Boolean),
				};
			}

			const updatedSchool = await updateSchoolAction(currentSchool.schoolId, updateData);
			
			// Immediately update local state with returned school data (including new version)
			setCurrentSchool(updatedSchool);
			if (onSchoolUpdate) {
				onSchoolUpdate(updatedSchool);
			}
			
			setSaveStatus("saved");
			setTimeout(() => setSaveStatus("idle"), 3000);
			
			// Refresh the page data (async, but state is already updated)
			router.refresh();
		} catch (err: any) {
			console.error("[GeneralSettings] Error updating school:", err);
			
			// Check if it's a conflict error (409) and retry with fresh data
			const isConflict = axios.isAxiosError(err) && err.response?.status === HttpStatus.CONFLICT;
			
			if (isConflict && retryCount < 2) {
				// Fetch fresh school data and retry
				try {
					console.log(`[GeneralSettings] Conflict detected (attempt ${retryCount + 1}), fetching fresh data...`);
					const freshSchool = await getSchoolAction(currentSchool.schoolId);
					setCurrentSchool(freshSchool);
					if (onSchoolUpdate) {
						onSchoolUpdate(freshSchool);
					}
					// Retry with fresh version
					return handleSave(retryCount + 1);
				} catch (fetchErr) {
					console.error("[GeneralSettings] Error fetching fresh school data:", fetchErr);
					setError("Failed to refresh data. Please refresh the page and try again.");
					setSaveStatus("error");
				}
			} else {
				// Show error message
				const errorMessage = err.response?.data?.message || err.message || "Failed to save changes. Please try again.";
				setError(errorMessage);
				setSaveStatus("error");
			}
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div className="space-y-6">
			{error && (
				<div className="rounded-md bg-destructive/15 border border-destructive/50 p-4 flex items-center gap-2">
					<AlertCircle className="h-5 w-5 text-destructive" />
					<p className="text-sm text-destructive">{error}</p>
				</div>
			)}

			{/* Institution Identity */}
			<Card className="p-6 bg-card border-border">
				<div className="mb-6">
					<h2 className="text-xl font-semibold text-foreground">Institution Identity</h2>
					<p className="text-sm text-muted-foreground mt-1">
						Basic information about your educational institution
					</p>
				</div>

				<div className="space-y-6">
					<div className="flex items-start gap-6">
						<div className="shrink-0">
							{currentSchool.logoUrl ? (
								<img
									src={currentSchool.logoUrl}
									alt={`${currentSchool.schoolName} logo`}
									className="h-24 w-24 rounded-lg object-cover border-2 border-border"
								/>
							) : (
								<div className="h-24 w-24 rounded-lg bg-primary/10 border-2 border-dashed border-primary/30 flex items-center justify-center">
									<Upload className="h-8 w-8 text-primary" />
								</div>
							)}
							<Button variant="outline" size="sm" className="mt-2 w-24 bg-transparent" disabled>
								Upload
							</Button>
							<p className="text-xs text-muted-foreground mt-1">Logo upload coming soon</p>
						</div>

						<div className="flex-1 space-y-4">
							<div>
								<Label htmlFor="institution-name">Institution Name</Label>
								<Input
									id="institution-name"
									value={formData.schoolName}
									onChange={(e) => setFormData({ ...formData, schoolName: e.target.value })}
									className="mt-1.5 bg-input border-border"
								/>
							</div>

							<div>
								<Label htmlFor="institution-code">Institution Code</Label>
								<Input 
									id="institution-code" 
									value={formData.schoolCode}
									onChange={(e) => setFormData({ ...formData, schoolCode: e.target.value })}
									className="mt-1.5 bg-input border-border" 
									disabled
								/>
								<p className="text-xs text-muted-foreground mt-1.5">
									Unique identifier used in reports and integrations (cannot be changed)
								</p>
							</div>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<Label htmlFor="institution-type">Institution Type</Label>
							<Select
								value={formData.schoolType}
								onValueChange={(value: any) => setFormData({ ...formData, schoolType: value })}
							>
								<SelectTrigger className="mt-1.5">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{SCHOOL_TYPES.map((type) => (
										<SelectItem key={type.value} value={type.value}>
											{type.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div>
							<Label htmlFor="accreditation">Accreditation</Label>
							<Input
								id="accreditation"
								value={formData.accreditation}
								onChange={(e) => setFormData({ ...formData, accreditation: e.target.value })}
								placeholder="e.g., Regional Accreditation Board"
								className="mt-1.5 bg-input border-border"
							/>
							<p className="text-xs text-muted-foreground mt-1.5">
								Separate multiple accrediting bodies with commas
							</p>
						</div>
					</div>
				</div>
			</Card>

			{/* Contact Information */}
			<Card className="p-6 bg-card border-border">
				<div className="mb-6">
					<h2 className="text-xl font-semibold text-foreground">Contact Information</h2>
					<p className="text-sm text-muted-foreground mt-1">
						Primary contact details for your institution
					</p>
				</div>

				<div className="space-y-4">
					<div>
						<Label htmlFor="address">Street Address</Label>
						<Input 
							id="address" 
							value={formData.street}
							onChange={(e) => setFormData({ ...formData, street: e.target.value })}
							className="mt-1.5 bg-input border-border" 
						/>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
						<div>
							<Label htmlFor="city">City</Label>
							<Input 
								id="city" 
								value={formData.city}
								onChange={(e) => setFormData({ ...formData, city: e.target.value })}
								className="mt-1.5 bg-input border-border" 
							/>
						</div>
						<div>
							<Label htmlFor="state">State/Province</Label>
							<Input 
								id="state" 
								value={formData.state}
								onChange={(e) => setFormData({ ...formData, state: e.target.value })}
								className="mt-1.5 bg-input border-border" 
							/>
						</div>
						<div>
							<Label htmlFor="zip">ZIP/Postal Code</Label>
							<Input 
								id="zip" 
								value={formData.postalCode}
								onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
								className="mt-1.5 bg-input border-border" 
							/>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<Label htmlFor="phone">Phone Number</Label>
							<Input 
								id="phone" 
								value={formData.primaryPhone}
								onChange={(e) => setFormData({ ...formData, primaryPhone: e.target.value })}
								className="mt-1.5 bg-input border-border" 
							/>
						</div>
						<div>
							<Label htmlFor="email">Email Address</Label>
							<Input
								id="email"
								type="email"
								value={formData.primaryEmail}
								onChange={(e) => setFormData({ ...formData, primaryEmail: e.target.value })}
								className="mt-1.5 bg-input border-border"
							/>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<Label htmlFor="secondary-phone">Secondary Phone (Optional)</Label>
							<Input 
								id="secondary-phone" 
								value={formData.secondaryPhone}
								onChange={(e) => setFormData({ ...formData, secondaryPhone: e.target.value })}
								className="mt-1.5 bg-input border-border" 
							/>
						</div>
						<div>
							<Label htmlFor="website">Website</Label>
							<Input 
								id="website" 
								type="url"
								value={formData.website}
								onChange={(e) => setFormData({ ...formData, website: e.target.value })}
								className="mt-1.5 bg-input border-border" 
							/>
						</div>
					</div>
				</div>
			</Card>

			{/* Mission & Description */}
			<Card className="p-6 bg-card border-border">
				<div className="mb-6">
					<h2 className="text-xl font-semibold text-foreground">Mission & Description</h2>
					<p className="text-sm text-muted-foreground mt-1">
						Share your institution's mission and values
					</p>
				</div>

				<div className="space-y-4">
					<div>
						<Label htmlFor="motto">Mission Statement / Motto</Label>
						<Textarea
							id="motto"
							rows={4}
							value={formData.motto}
							onChange={(e) => setFormData({ ...formData, motto: e.target.value })}
							placeholder="Enter your institution's mission statement or motto..."
							className="mt-1.5 bg-input border-border resize-none"
						/>
					</div>

					<div>
						<Label htmlFor="description">Institution Description</Label>
						<Textarea
							id="description"
							rows={3}
							value={formData.description}
							onChange={(e) => setFormData({ ...formData, description: e.target.value })}
							placeholder="Brief description of your institution..."
							className="mt-1.5 bg-input border-border resize-none"
						/>
					</div>
				</div>
			</Card>

			{/* Save Actions */}
			<div className="flex justify-between items-center">
				<div className="flex items-center gap-2">
					{saveStatus === "saved" && (
						<Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
							<CheckCircle className="h-3 w-3 mr-1" />
							Changes saved successfully
						</Badge>
					)}
					{saveStatus === "error" && (
						<Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
							<AlertCircle className="h-3 w-3 mr-1" />
							Failed to save
						</Badge>
					)}
				</div>
				
				<Button 
					onClick={() => handleSave()} 
					disabled={isSaving} 
					className="bg-primary hover:bg-primary/90"
				>
					<Save className="h-4 w-4 mr-2" />
					{isSaving ? "Saving..." : "Save Changes"}
				</Button>
			</div>
		</div>
	);
}
