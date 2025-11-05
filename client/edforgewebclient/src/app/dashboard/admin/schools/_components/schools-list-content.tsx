"use client";

/**
 * EdForge EMIS - Schools List Content
 * 
 * Client component that displays a list of schools in a card layout.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Building2, MapPin, Phone, Mail, ExternalLink, Settings } from "lucide-react";
import type { School } from "@edforge/shared-types";

interface SchoolsListContentProps {
	schools: School[];
}

export function SchoolsListContent({ schools }: SchoolsListContentProps) {
	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{schools.map((school) => (
				<Card key={school.schoolId} className="hover:shadow-md transition-shadow">
					<CardHeader>
						<div className="flex items-start justify-between">
							<div className="flex items-center gap-3">
								<div className="p-2 rounded-lg bg-primary/10">
									<Building2 className="h-5 w-5 text-primary" />
								</div>
								<div className="flex-1">
									<CardTitle className="text-lg">{school.schoolName}</CardTitle>
									<CardDescription className="mt-1">
										{school.schoolCode}
									</CardDescription>
								</div>
							</div>
							<Badge
								variant={
									school.status === 'active' ? 'default' :
									school.status === 'inactive' ? 'secondary' :
									school.status === 'closed' ? 'destructive' : 'outline'
								}
							>
								{school.status}
							</Badge>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						{/* School Type */}
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<span className="font-medium capitalize">{school.schoolType}</span>
							<span>•</span>
							<span>
								Grades {school.gradeRange.lowestGrade} - {school.gradeRange.highestGrade}
							</span>
						</div>

						{/* Contact Information */}
						<div className="space-y-2 text-sm">
							{school.address && (
								<div className="flex items-start gap-2 text-muted-foreground">
									<MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
									<span className="line-clamp-2">
										{school.address.street}, {school.address.city}, {school.address.state} {school.address.postalCode}
									</span>
								</div>
							)}
							{school.contactInfo?.primaryPhone && (
								<div className="flex items-center gap-2 text-muted-foreground">
									<Phone className="h-4 w-4 flex-shrink-0" />
									<span>{school.contactInfo.primaryPhone}</span>
								</div>
							)}
							{school.contactInfo?.primaryEmail && (
								<div className="flex items-center gap-2 text-muted-foreground">
									<Mail className="h-4 w-4 flex-shrink-0" />
									<span className="truncate">{school.contactInfo.primaryEmail}</span>
								</div>
							)}
						</div>

						{/* Capacity */}
						{school.maxStudentCapacity && (
							<div className="text-sm text-muted-foreground">
								Capacity: {school.currentEnrollment || 0} / {school.maxStudentCapacity} students
							</div>
						)}

						{/* Actions */}
						<div className="flex items-center gap-2 pt-2 border-t">
							<Button variant="outline" size="sm" className="flex-1" asChild>
								<Link href={`/dashboard/admin/settings`}>
									<Settings className="mr-2 h-4 w-4" />
									Settings
								</Link>
							</Button>
							{school.contactInfo?.website && (
								<Button variant="ghost" size="sm" asChild>
									<a href={school.contactInfo.website} target="_blank" rel="noopener noreferrer">
										<ExternalLink className="h-4 w-4" />
									</a>
								</Button>
							)}
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

