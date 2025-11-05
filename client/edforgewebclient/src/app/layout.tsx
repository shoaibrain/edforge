import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeScript } from "@/components/theme-script";
import { AuthSessionProvider } from "@/providers/session-provider";
import { TenantProvider } from "@/contexts/tenant-context";
import { UserProvider } from "@/contexts/user-context";

export const metadata: Metadata = {
	title: {
		default: "EdForge - Enterprise Education Management System",
		template: "%s | EdForge EMIS",
	},
	description:
		"Modern, enterprise-grade Education Management Information System (EMIS) for multi-tenant SaaS. Manage students, staff, curriculum, and institutional operations with world-class UI/UX.",
	keywords: [
		"Education Management",
		"EMIS",
		"EdTech",
		"School Management System",
		"Student Information System",
		"SaaS",
		"Multi-tenant",
		"Enterprise Software",
	],
	authors: [{ name: "EdForge Team" }],
	creator: "EdForge",
	publisher: "EdForge",
	openGraph: {
		type: "website",
		locale: "en_US",
		url: "https://edforge.net",
		title: "EdForge - Enterprise Education Management System",
		description:
			"Modern, enterprise-grade EMIS for educational institutions",
		siteName: "EdForge",
	},
	twitter: {
		card: "summary_large_image",
		title: "EdForge - Enterprise Education Management System",
		description:
			"Modern, enterprise-grade EMIS for educational institutions",
	},
	robots: {
		index: true,
		follow: true,
	},
};

export const viewport = {
	width: "device-width",
	initialScale: 1,
	maximumScale: 5,
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning className="dark">
			<head>
				<ThemeScript />
			</head>
		<body className="font-sans antialiased bg-background text-foreground">
			<AuthSessionProvider>
				<ThemeProvider defaultTheme="system" storageKey="edforge-ui-theme">
					<TenantProvider>
						<UserProvider>
							{children}
						</UserProvider>
					</TenantProvider>
				</ThemeProvider>
			</AuthSessionProvider>
		</body>
		</html>
	);
}
