"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Home, ArrowLeft, AlertCircle } from "lucide-react";

export default function NotFound() {
	return (
		<div className="min-h-screen bg-background flex items-center justify-center p-6">
			<div className="w-full max-w-md">
				<Card className="bg-card border-border">
					<CardContent className="p-8 text-center">
						{/* 404 Icon */}
						<div className="mb-6">
							<div className="mx-auto w-20 h-20 bg-muted/20 rounded-full flex items-center justify-center mb-4">
								<AlertCircle className="h-10 w-10 text-muted-foreground" />
							</div>
							<h1 className="text-6xl font-bold text-foreground mb-2">404</h1>
							<h2 className="text-xl font-semibold text-foreground mb-2">
								Page Not Found
							</h2>
							<p className="text-muted-foreground">
								The page you're looking for doesn't exist or has been moved.
							</p>
						</div>

						{/* Action Buttons */}
						<div className="space-y-3">
							<Button asChild className="w-full">
								<Link href="/dashboard">
									<Home className="mr-2 h-4 w-4" />
									Go to Dashboard
								</Link>
							</Button>
							<Button variant="outline" onClick={() => window.history.back()} className="w-full">
								<ArrowLeft className="mr-2 h-4 w-4" />
								Go Back
							</Button>
						</div>

						{/* Help Text */}
						<div className="mt-6 pt-6 border-t border-border">
							<p className="text-sm text-muted-foreground">
								If you believe this is an error, please contact support.
							</p>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
