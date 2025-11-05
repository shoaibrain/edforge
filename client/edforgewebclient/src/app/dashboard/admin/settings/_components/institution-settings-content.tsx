"use client";

/**
 * EdForge EMIS - Institution/School Settings Content
 * 
 * Client component for institution settings with interactive features.
 */

import { useState, useEffect } from "react";
import { Building2, Calendar, CalendarDays, GraduationCap, ClipboardCheck, Award } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { GeneralSettings } from "./general-settings";
import { SchoolYearSettings } from "./school-year-settings";
import { TermsSettings } from "./terms-settings";
import { AcademicCalendar } from "./academic-calendar";
import { GradingSettings } from "./grading-settings";
import { AttendanceSettings } from "./attendance-settings";
import { cn } from "@/lib/utils";
import type { User } from "@/types/rbac";
import type { School, AcademicYear } from "@edforge/shared-types";

type SettingsSection = "general" | "school-years" | "terms" | "calendar" | "grading" | "attendance";

const settingsTabs = [
	{ id: "general" as const, label: "General", icon: Building2, description: "Basic institution information and preferences" },
	{ id: "school-years" as const, label: "School Years", icon: Calendar, description: "Manage academic years and periods" },
	{ id: "terms" as const, label: "Terms", icon: CalendarDays, description: "Configure academic terms and semesters" },
	{ id: "calendar" as const, label: "Calendar", icon: GraduationCap, description: "Academic calendar and important dates" },
	{ id: "grading" as const, label: "Grading", icon: Award, description: "Grading scales and assessment criteria" },
	{ id: "attendance" as const, label: "Attendance", icon: ClipboardCheck, description: "Attendance policies and tracking settings" },
];

interface InstitutionSettingsContentProps {
	user: User;
	school: School;
	academicYears: AcademicYear[];
	initialActiveTab?: string;
}

// Map URL-friendly tab names to internal section IDs
const tabIdMap: Record<string, SettingsSection> = {
	"general": "general",
	"school-years": "school-years",
	"terms": "terms",
	"calendar": "calendar",
	"grading": "grading",
	"attendance": "attendance",
};

// Validate and normalize tab ID
function getValidTabId(tabId: string | undefined): SettingsSection {
	if (tabId && tabId in tabIdMap) {
		return tabIdMap[tabId];
	}
	return "general"; // Default to general
}

export function InstitutionSettingsContent({ user, school, academicYears, initialActiveTab }: InstitutionSettingsContentProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [activeSection, setActiveSection] = useState<SettingsSection>(() => 
		getValidTabId(initialActiveTab)
	);
	const [currentSchool, setCurrentSchool] = useState<School>(school);

	// Update currentSchool when school prop changes
	useEffect(() => {
		setCurrentSchool(school);
	}, [school]);

	// Sync activeSection with URL when URL changes (browser back/forward navigation)
	// This handles cases where the user navigates using browser buttons
	useEffect(() => {
		const activeTabFromUrl = searchParams.get("activeTab");
		const validTab = getValidTabId(activeTabFromUrl || undefined);
		// Only update if different - this prevents loops when handleTabChange updates URL
		setActiveSection(prev => {
			if (prev !== validTab) {
				return validTab;
			}
			return prev;
		});
	}, [searchParams]);

	// Callback to handle school updates
	const handleSchoolUpdate = (updatedSchool: School) => {
		setCurrentSchool(updatedSchool);
	};

	// Handle tab change and update URL
	const handleTabChange = (tabId: SettingsSection) => {
		setActiveSection(tabId);
		const params = new URLSearchParams(searchParams.toString());
		params.set("activeTab", tabId);
		router.replace(`/dashboard/admin/settings?${params.toString()}`, { scroll: false });
	};

	const activeTab = settingsTabs.find(tab => tab.id === activeSection);

	return (
		<div className="space-y-6">
			{/* Settings Navigation */}
			<div className="border-b border-border">
				<nav className="flex gap-6 overflow-x-auto" aria-label="Settings sections">
					{settingsTabs.map((tab) => {
						const Icon = tab.icon;
						return (
						<button
							key={tab.id}
							onClick={() => handleTabChange(tab.id)}
							className={cn(
								"flex items-center gap-2 border-b-2 px-1 pb-4 text-sm font-medium transition-colors whitespace-nowrap",
								activeSection === tab.id
									? "border-primary text-primary"
									: "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
							)}
						>
							<Icon className="h-4 w-4" />
							{tab.label}
						</button>
						);
					})}
				</nav>
			</div>

			{/* Settings Content */}
			<div className="min-h-[600px]">
				{activeSection === "general" && <GeneralSettings school={currentSchool} onSchoolUpdate={handleSchoolUpdate} />}
				{activeSection === "school-years" && <SchoolYearSettings school={currentSchool} academicYears={academicYears} />}
				{activeSection === "terms" && <TermsSettings school={currentSchool} academicYears={academicYears} />}
				{activeSection === "calendar" && <AcademicCalendar school={currentSchool} academicYears={academicYears} />}
				{activeSection === "grading" && <GradingSettings school={currentSchool} />}
				{activeSection === "attendance" && <AttendanceSettings school={currentSchool} />}
			</div>
		</div>
	);
}
