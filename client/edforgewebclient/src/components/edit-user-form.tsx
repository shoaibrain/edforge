"use client";

/**
 * EdForge EMIS - Edit User Form
 * 
 * Client component for editing user information with interactive form.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { 
	Save, 
	Loader2,
	ArrowLeft,
	Edit,
	AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { updateUserAction } from "@/actions/user-actions";
import { getUserFriendlyMessage } from "@/lib/api-errors";
import type { User, UpdateUserRequest } from "@/types/user";

// Available user roles for selection
// NOTE: Only TenantAdmin and TenantUser are currently supported by the backend
const USER_ROLES = [
	{ value: "TenantAdmin", label: "Tenant Administrator" },
	{ value: "TenantUser", label: "User" },
];

interface EditUserFormProps {
	user: User;
}

export function EditUserForm({ user }: EditUserFormProps) {
	const router = useRouter();
	const [isUpdating, setIsUpdating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [formData, setFormData] = useState<UpdateUserRequest>({
		userName: user.name || user.username || "",
		userEmail: user.email || "",
		userRole: user.role || user.userRole || "TenantUser",
	});

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsUpdating(true);

		try {
			const userId = user.userId || user.username || user.email;
			if (!userId) {
				setError("User ID is required to update user.");
				setIsUpdating(false);
				return;
			}

			await updateUserAction(userId, formData);
			router.push(`/dashboard/admin/users/${userId}`);
			router.refresh();
		} catch (err: any) {
			console.error("[EditUserForm] Error updating user:", err);
			const errorMessage = getUserFriendlyMessage(err);
			setError(errorMessage || "Failed to update user. Please try again.");
		} finally {
			setIsUpdating(false);
		}
	};

	const isFormValid = formData.userEmail && formData.userRole;

	return (
		<div className="flex flex-1 flex-col gap-6">
			<form onSubmit={handleSubmit}>
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Edit className="h-5 w-5" />
							User Information
						</CardTitle>
						<CardDescription>
							Update user account details and settings
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{error && (
							<div className="rounded-md bg-destructive/15 border border-destructive/50 p-4 flex items-center gap-2">
								<AlertCircle className="h-5 w-5 text-destructive" />
								<p className="text-sm text-destructive">{error}</p>
							</div>
						)}

						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="userName">
									User Name
								</Label>
								<Input
									id="userName"
									placeholder="e.g., johndoe"
									value={formData.userName || ""}
									onChange={(e) => setFormData({ ...formData, userName: e.target.value })}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="userEmail">
									Email Address <span className="text-destructive">*</span>
								</Label>
								<Input
									id="userEmail"
									type="email"
									placeholder="e.g., john.doe@school.edu"
									value={formData.userEmail || ""}
									onChange={(e) => setFormData({ ...formData, userEmail: e.target.value })}
									required
								/>
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="userRole">
								Role <span className="text-destructive">*</span>
							</Label>
							<Select
								value={formData.userRole}
								onValueChange={(value) => setFormData({ ...formData, userRole: value })}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select a role" />
								</SelectTrigger>
								<SelectContent>
									{USER_ROLES.map((role) => (
										<SelectItem key={role.value} value={role.value}>
											{role.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</CardContent>
				</Card>

				{/* Actions */}
				<div className="flex items-center justify-end gap-4 pt-6 border-t">
					<Button variant="outline" type="button" asChild>
						<Link href={`/dashboard/admin/users/${user.userId || user.email}`}>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Cancel
						</Link>
					</Button>
					<Button 
						type="submit"
						disabled={!isFormValid || isUpdating}
					>
						{isUpdating ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Updating...
							</>
						) : (
							<>
								<Save className="mr-2 h-4 w-4" />
								Update User
							</>
						)}
					</Button>
				</div>
			</form>
		</div>
	);
}

