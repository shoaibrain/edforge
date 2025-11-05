"use client";

/**
 * EdForge EMIS - Grading Settings Component
 * 
 * Configures grade scales, passing marks, and grading policies.
 * 
 * NOTE: The grading configuration API is not yet available.
 * This feature will be enabled once the `/schools/{schoolId}/configuration` endpoint is implemented.
 */

import { Card } from "@/components/ui/card";
import { Info } from "lucide-react";
import type { School } from "@edforge/shared-types";

interface GradingSettingsProps {
	school: School;
}

export function GradingSettings({ school }: GradingSettingsProps) {

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-2xl font-semibold text-foreground">Grading System</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Configure grade scales, passing marks, and grading policies
				</p>
			</div>

			<Card className="p-8 bg-card border-border">
				<div className="flex flex-col items-center justify-center gap-4 text-center">
					<div className="p-4 rounded-full bg-blue-50 border border-blue-200">
						<Info className="h-8 w-8 text-blue-600" />
					</div>
					<div>
						<h3 className="text-lg font-semibold text-foreground mb-2">
							Grading Configuration Not Available
						</h3>
						<p className="text-sm text-muted-foreground max-w-md">
							The grading configuration API is not yet implemented. This feature will be enabled once the{" "}
							<code className="text-xs bg-muted px-1.5 py-0.5 rounded">/schools/{"{schoolId}"}/configuration</code>{" "}
							endpoint is available in the API Gateway.
						</p>
						<p className="text-xs text-muted-foreground mt-3">
							Once implemented, you'll be able to configure grade scales, passing marks, and grading policies for your institution.
						</p>
					</div>
				</div>
			</Card>
		</div>
	);
}
