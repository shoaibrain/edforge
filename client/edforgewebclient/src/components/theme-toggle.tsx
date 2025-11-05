"use client";

import * as React from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle() {
	const { theme, setTheme } = useTheme();
	const [mounted, setMounted] = React.useState(false);

	React.useEffect(() => {
		setMounted(true);
	}, []);

	if (!mounted) {
		return (
			<div className="h-10 w-10 rounded-lg bg-muted animate-pulse" />
		);
	}

	return (
		<div className="flex items-center gap-1 rounded-lg bg-muted p-1">
			<button
				type="button"
				onClick={() => setTheme("light")}
				className={`flex items-center justify-center h-8 w-8 rounded-md transition-colors ${
					theme === "light"
						? "bg-background text-foreground shadow-sm"
						: "text-muted-foreground hover:text-foreground"
				}`}
				title="Light mode"
			>
				<Sun className="h-4 w-4" />
			</button>
			<button
				type="button"
				onClick={() => setTheme("system")}
				className={`flex items-center justify-center h-8 w-8 rounded-md transition-colors ${
					theme === "system"
						? "bg-background text-foreground shadow-sm"
						: "text-muted-foreground hover:text-foreground"
				}`}
				title="System theme"
			>
				<Monitor className="h-4 w-4" />
			</button>
			<button
				type="button"
				onClick={() => setTheme("dark")}
				className={`flex items-center justify-center h-8 w-8 rounded-md transition-colors ${
					theme === "dark"
						? "bg-background text-foreground shadow-sm"
						: "text-muted-foreground hover:text-foreground"
				}`}
				title="Dark mode"
			>
				<Moon className="h-4 w-4" />
			</button>
		</div>
	);
}

