"use client";

/**
 * EdForge EMIS - Create User Form
 * 
 * Client component for creating new users with interactive form.
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
	UserPlus,
	AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { createUserAction } from "@/actions/user-actions";
import type { CreateUserRequest } from "@/types/user";

// Available user roles for selection
// NOTE: Only TenantAdmin and TenantUser are currently supported by the backend
const USER_ROLES = [
	{ value: "TenantAdmin", label: "Tenant Administrator" },
	{ value: "TenantUser", label: "User" },
];

export function CreateUserForm() {
	const router = useRouter();
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [formData, setFormData] = useState<CreateUserRequest>({
		userName: "",
		userEmail: "",
		userRole: "TenantUser",
	});

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsCreating(true);

		try {
			console.log("[CreateUserForm] Creating user with data:", formData);
			// Call Server Action (runs server-side, uses api-server.ts)
			const result = await createUserAction(formData);
			console.log("[CreateUserForm] User created successfully:", result);
			// Redirect to users list on success
			router.push("/dashboard/admin/users");
		} catch (err: any) {
			console.error("[CreateUserForm] Error creating user:", err);
			console.error("[CreateUserForm] Error details:", {
				message: err.message,
				errorCode: err.errorCode,
				statusCode: err.statusCode,
				details: err.details,
				stack: err.stack
			});
			
			// Server Action handles errors and re-throws them
			// Check if it's a network error or CORS issue
			if (err.message === "Network Error" || err.message?.includes("Network Error") || err.message?.includes("CORS")) {
				setError("Network error: Unable to connect to the API. Please check your connection and ensure the API Gateway URL is correct.");
			} else {
				setError(err.message || "Failed to create user. Please try again.");
			}
		} finally {
			setIsCreating(false);
		}
	};

	const isFormValid = formData.userName && formData.userEmail && formData.userRole;

	return (
		<div className="flex flex-1 flex-col gap-6">
			<form onSubmit={handleSubmit}>
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<UserPlus className="h-5 w-5" />
							User Information
						</CardTitle>
						<CardDescription>
							Enter the details for the new user account
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
									Username <span className="text-destructive">*</span>
								</Label>
								<Input
									id="userName"
									placeholder="e.g., johndoe"
									value={formData.userName}
									onChange={(e) => setFormData({ ...formData, userName: e.target.value })}
									required
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
									value={formData.userEmail}
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
								onValueChange={(value: string) => setFormData({ ...formData, userRole: value })}
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
						<Link href="/dashboard/admin/users">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Cancel
						</Link>
					</Button>
					<Button 
						type="submit"
						disabled={!isFormValid || isCreating}
					>
						{isCreating ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Creating...
							</>
						) : (
							<>
								<Save className="mr-2 h-4 w-4" />
								Create User
							</>
						)}
					</Button>
				</div>
			</form>
		</div>
	);
}

