import { ThemeToggle } from "@/components/theme-toggle";
import {
	CheckCircle2,
	AlertCircle,
	AlertTriangle,
	Info,
	GraduationCap,
	Users,
	BookOpen,
	BarChart3,
} from "lucide-react";

export default function Home() {
  return (
		<div className="min-h-screen bg-background">
			{/* Header */}
			<header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="flex h-16 items-center justify-between">
						<div className="flex items-center gap-3">
							<GraduationCap className="h-8 w-8 text-primary" />
							<div>
								<h1 className="text-xl font-bold tracking-tight text-foreground">
									EdForge
								</h1>
								<p className="text-xs text-muted-foreground">
									Enterprise EMIS
								</p>
							</div>
						</div>
						<ThemeToggle />
					</div>
				</div>
			</header>

			<main className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
				{/* Hero Section */}
				<section className="mb-16 text-center">
					<h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
						Welcome to{" "}
						<span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
							EdForge
						</span>
					</h1>
					<p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
						Enterprise-grade Education Management Information System
						with world-class UI/UX design
					</p>
					<div className="flex gap-4 justify-center flex-wrap">
						<button
							type="button"
							className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
						>
							Get Started
						</button>
						<button
							type="button"
							className="px-6 py-3 bg-secondary text-secondary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
						>
							Learn More
						</button>
						<button
							type="button"
							className="px-6 py-3 bg-accent text-accent-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
						>
							View Demo
						</button>
					</div>
				</section>

				{/* Features Grid */}
				<section className="mb-16">
					<h2 className="text-3xl font-bold mb-8">Core Features</h2>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
						{[
							{
								icon: Users,
								title: "Student Management",
								description:
									"Comprehensive student profiles and records",
								color: "text-primary",
							},
							{
								icon: BookOpen,
								title: "Curriculum Planning",
								description:
									"Design and manage educational programs",
								color: "text-secondary",
							},
							{
								icon: BarChart3,
								title: "Analytics & Reports",
								description:
									"Data-driven insights for better decisions",
								color: "text-accent",
							},
							{
								icon: GraduationCap,
								title: "Academic Excellence",
								description:
									"Track performance and achievements",
								color: "text-primary",
							},
						].map((feature, i) => (
							<div
								key={i}
								className="p-6 rounded-lg border border-border bg-card hover:shadow-lg transition-shadow"
							>
								<feature.icon
									className={`h-12 w-12 mb-4 ${feature.color}`}
								/>
								<h3 className="text-lg font-semibold mb-2">
									{feature.title}
								</h3>
								<p className="text-muted-foreground text-sm">
									{feature.description}
								</p>
							</div>
						))}
					</div>
				</section>

				{/* Color System Showcase */}
				<section className="mb-16">
					<h2 className="text-3xl font-bold mb-8">
						Design System - Color Palette
					</h2>

					{/* Brand Colors */}
					<div className="mb-8">
						<h3 className="text-xl font-semibold mb-4">
							Brand Colors
						</h3>
						<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
							<ColorSwatch
								name="Primary"
								description="Trust & Stability"
								className="bg-primary text-primary-foreground"
							/>
							<ColorSwatch
								name="Secondary"
								description="Growth & Balance"
								className="bg-secondary text-secondary-foreground"
							/>
							<ColorSwatch
								name="Accent"
								description="Action & Focus"
								className="bg-accent text-accent-foreground"
							/>
							<ColorSwatch
								name="Muted"
								description="Subtle UI"
								className="bg-muted text-muted-foreground"
							/>
							<ColorSwatch
								name="Card"
								description="Surface"
								className="bg-card text-card-foreground border border-border"
							/>
							<ColorSwatch
								name="Background"
								description="Base Layer"
								className="bg-background text-foreground border border-border"
							/>
						</div>
					</div>

					{/* Semantic Colors */}
					<div className="mb-8">
						<h3 className="text-xl font-semibold mb-4">
							Semantic Colors (WCAG AA Compliant)
						</h3>
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
							<div className="p-6 rounded-lg bg-success text-success-foreground">
								<CheckCircle2 className="h-8 w-8 mb-2" />
								<h4 className="font-semibold mb-1">Success</h4>
								<p className="text-sm opacity-90">
									Positive actions completed
								</p>
							</div>
							<div className="p-6 rounded-lg bg-warning text-warning-foreground">
								<AlertTriangle className="h-8 w-8 mb-2" />
								<h4 className="font-semibold mb-1">Warning</h4>
								<p className="text-sm opacity-90">
									Caution required
								</p>
							</div>
							<div className="p-6 rounded-lg bg-error text-error-foreground">
								<AlertCircle className="h-8 w-8 mb-2" />
								<h4 className="font-semibold mb-1">Error</h4>
								<p className="text-sm opacity-90">
									Critical issue detected
								</p>
							</div>
							<div className="p-6 rounded-lg bg-info text-info-foreground">
								<Info className="h-8 w-8 mb-2" />
								<h4 className="font-semibold mb-1">Info</h4>
								<p className="text-sm opacity-90">
									Helpful information
								</p>
							</div>
						</div>
					</div>
				</section>

				{/* Typography Showcase */}
				<section className="mb-16">
					<h2 className="text-3xl font-bold mb-8">Typography System</h2>
					<div className="space-y-6 p-8 rounded-lg border border-border bg-card">
						<div>
							<h1 className="text-5xl mb-2">
								Heading 1 - Display
							</h1>
							<p className="text-muted-foreground text-sm">
								56px / 3.5rem - Bold, Tracking Tight
							</p>
						</div>
						<div>
							<h2 className="text-4xl mb-2">
								Heading 2 - Section
							</h2>
							<p className="text-muted-foreground text-sm">
								48px / 3rem - Bold, Tracking Tight
							</p>
						</div>
						<div>
							<h3 className="text-3xl mb-2">
								Heading 3 - Subsection
							</h3>
							<p className="text-muted-foreground text-sm">
								32px / 2rem - Semibold, Tracking Tight
							</p>
						</div>
						<div>
							<h4 className="text-2xl mb-2">Heading 4 - Card</h4>
							<p className="text-muted-foreground text-sm">
								24px / 1.5rem - Semibold
							</p>
						</div>
						<div>
							<p className="text-lg mb-2">
								Body Large - Primary content and important text
							</p>
							<p className="text-muted-foreground text-sm">
								18px / 1.125rem - Regular
							</p>
						</div>
						<div>
							<p className="text-base mb-2">
								Body - Default text for most content and UI
								elements
							</p>
							<p className="text-muted-foreground text-sm">
								16px / 1rem - Regular
							</p>
						</div>
						<div>
							<p className="text-sm mb-2">
								Small - Secondary information and metadata
							</p>
							<p className="text-muted-foreground text-sm">
								14px / 0.875rem - Regular
							</p>
						</div>
						<div>
							<code className="font-mono text-sm bg-muted px-2 py-1 rounded">
								Monospace - Code and technical content
            </code>
							<p className="text-muted-foreground text-sm mt-2">
								JetBrains Mono - 14px / 0.875rem
							</p>
						</div>
					</div>
				</section>

				{/* UI Components Preview */}
				<section className="mb-16">
					<h2 className="text-3xl font-bold mb-8">
						UI Components Preview
					</h2>
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
						{/* Buttons */}
						<div className="p-6 rounded-lg border border-border bg-card">
							<h3 className="text-xl font-semibold mb-4">
								Buttons
							</h3>
							<div className="space-y-4">
								<div className="flex gap-3 flex-wrap">
									<button
										type="button"
										className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
									>
										Primary
									</button>
									<button
										type="button"
										className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
									>
										Secondary
									</button>
									<button
										type="button"
										className="px-4 py-2 bg-accent text-accent-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
									>
										Accent
									</button>
								</div>
								<div className="flex gap-3 flex-wrap">
									<button
										type="button"
										className="px-4 py-2 border border-border rounded-lg font-medium hover:bg-muted transition-colors"
									>
										Outline
									</button>
									<button
										type="button"
										className="px-4 py-2 bg-muted text-muted-foreground rounded-lg font-medium hover:bg-muted/80 transition-colors"
									>
										Muted
									</button>
									<button
										type="button"
										className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
									>
										Destructive
									</button>
								</div>
							</div>
        </div>

						{/* Inputs */}
						<div className="p-6 rounded-lg border border-border bg-card">
							<h3 className="text-xl font-semibold mb-4">
								Form Inputs
							</h3>
							<div className="space-y-4">
								<div>
									<label
										htmlFor="input1"
										className="block text-sm font-medium mb-2"
									>
										Text Input
									</label>
									<input
										id="input1"
										type="text"
										placeholder="Enter text..."
										className="w-full px-3 py-2 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
									/>
								</div>
								<div>
									<label
										htmlFor="select1"
										className="block text-sm font-medium mb-2"
									>
										Select
									</label>
									<select
										id="select1"
										className="w-full px-3 py-2 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
									>
										<option>Option 1</option>
										<option>Option 2</option>
										<option>Option 3</option>
									</select>
								</div>
							</div>
						</div>

						{/* Cards */}
						<div className="p-6 rounded-lg border border-border bg-card">
							<h3 className="text-xl font-semibold mb-4">Cards</h3>
							<div className="space-y-4">
								<div className="p-4 rounded-lg border border-border bg-background">
									<h4 className="font-semibold mb-2">
										Default Card
									</h4>
									<p className="text-sm text-muted-foreground">
										Cards provide elevated surfaces for
										content grouping.
									</p>
								</div>
								<div className="p-4 rounded-lg bg-muted">
									<h4 className="font-semibold mb-2">
										Muted Card
									</h4>
									<p className="text-sm text-muted-foreground">
										Subtle background for secondary content.
									</p>
								</div>
							</div>
						</div>

						{/* Alerts */}
						<div className="p-6 rounded-lg border border-border bg-card">
							<h3 className="text-xl font-semibold mb-4">
								Alerts & Notifications
							</h3>
							<div className="space-y-3">
								<div className="p-3 rounded-lg border-l-4 border-success bg-success/10 text-success-foreground flex items-start gap-2">
									<CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-0.5" />
									<span className="text-sm">
										Success message
									</span>
								</div>
								<div className="p-3 rounded-lg border-l-4 border-warning bg-warning/10 text-warning-foreground flex items-start gap-2">
									<AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
									<span className="text-sm">
										Warning message
									</span>
								</div>
								<div className="p-3 rounded-lg border-l-4 border-error bg-error/10 text-error-foreground flex items-start gap-2">
									<AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
									<span className="text-sm">
										Error message
									</span>
								</div>
								<div className="p-3 rounded-lg border-l-4 border-info bg-info/10 text-info-foreground flex items-start gap-2">
									<Info className="h-5 w-5 flex-shrink-0 mt-0.5" />
									<span className="text-sm">
										Info message
									</span>
								</div>
							</div>
						</div>
					</div>
				</section>

				{/* Design Principles */}
				<section className="mb-16">
					<h2 className="text-3xl font-bold mb-8">
						Design Principles
					</h2>
					<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
						<div className="p-6 rounded-lg border border-border bg-card">
							<h3 className="text-lg font-semibold mb-3">
								60-30-10 Rule
							</h3>
							<ul className="space-y-2 text-sm text-muted-foreground">
								<li>
									• 60% Neutrals (Off-white, Light Gray)
								</li>
								<li>• 30% Primary (Navy Blue)</li>
								<li>• 10% Secondary/Accent (Teal, Cyan)</li>
							</ul>
						</div>
						<div className="p-6 rounded-lg border border-border bg-card">
							<h3 className="text-lg font-semibold mb-3">
								WCAG AA Compliance
							</h3>
							<p className="text-sm text-muted-foreground">
								All color combinations meet minimum 4.5:1
								contrast ratio for accessibility and readability
								in enterprise environments.
							</p>
						</div>
						<div className="p-6 rounded-lg border border-border bg-card">
							<h3 className="text-lg font-semibold mb-3">
								Modern OKLCH
							</h3>
							<p className="text-sm text-muted-foreground">
								Using OKLCH color space for perceptual
								uniformity, better dark mode, and future-proof
								color management.
							</p>
						</div>
					</div>
				</section>
			</main>

			{/* Footer */}
			<footer className="border-t border-border bg-muted/50">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
					<div className="flex flex-col md:flex-row justify-between items-center gap-4">
						<div className="flex items-center gap-2">
							<GraduationCap className="h-6 w-6 text-primary" />
							<span className="font-semibold">EdForge EMIS</span>
						</div>
						<p className="text-sm text-muted-foreground">
							Enterprise-grade Education Management System • Built
							with Next.js & shadcn/ui
						</p>
					</div>
				</div>
      </footer>
    </div>
  );
}

function ColorSwatch({
	name,
	description,
	className,
}: {
	name: string;
	description: string;
	className: string;
}) {
	return (
		<div
			className={`p-6 rounded-lg flex flex-col justify-between min-h-[120px] ${className}`}
		>
			<div>
				<h4 className="font-semibold mb-1">{name}</h4>
				<p className="text-xs opacity-90">{description}</p>
			</div>
		</div>
	);
}
