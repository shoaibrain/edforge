"use client";

/**
 * EdForge EMIS - Student Profile Actions
 * 
 * Client component for interactive actions on student profile page.
 * Handles dropdown menu interactions and client-side actions.
 */

import { useState } from "react";
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
	Edit,
	Download,
	Share,
	MoreHorizontal,
} from "lucide-react";

interface StudentProfileActionsProps {
	studentId: string;
}

export function StudentProfileActions({ studentId }: StudentProfileActionsProps) {
	const [isLoading, setIsLoading] = useState(false);

	const handleEditProfile = async () => {
		setIsLoading(true);
		try {
			// Client-side action for editing profile
			console.log("Edit profile for student:", studentId);
			// Add navigation or modal logic here
		} catch (error) {
			console.error("Error editing profile:", error);
		} finally {
			setIsLoading(false);
		}
	};

	const handleExportReport = async () => {
		setIsLoading(true);
		try {
			// Client-side action for exporting report
			console.log("Export report for student:", studentId);
			// Add export logic here
		} catch (error) {
			console.error("Error exporting report:", error);
		} finally {
			setIsLoading(false);
		}
	};

	const handleShareProfile = async () => {
		setIsLoading(true);
		try {
			// Client-side action for sharing profile
			console.log("Share profile for student:", studentId);
			// Add sharing logic here
		} catch (error) {
			console.error("Error sharing profile:", error);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="sm" disabled={isLoading}>
					<MoreHorizontal className="h-4 w-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>Actions</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={handleEditProfile} disabled={isLoading}>
					<Edit className="h-4 w-4 mr-2" />
					Edit Profile
				</DropdownMenuItem>
				<DropdownMenuItem onClick={handleExportReport} disabled={isLoading}>
					<Download className="h-4 w-4 mr-2" />
					Export Report
				</DropdownMenuItem>
				<DropdownMenuItem onClick={handleShareProfile} disabled={isLoading}>
					<Share className="h-4 w-4 mr-2" />
					Share Profile
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
