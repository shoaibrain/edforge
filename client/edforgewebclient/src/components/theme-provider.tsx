"use client";

import * as React from "react";

type Theme = "light" | "dark" | "system";

type ThemeProviderProps = {
	children: React.ReactNode;
	defaultTheme?: Theme;
	storageKey?: string;
};

type ThemeProviderState = {
	theme: Theme;
	setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
	theme: "system",
	setTheme: () => null,
};

const ThemeProviderContext =
	React.createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
	children,
	defaultTheme = "system",
	storageKey = "edforge-ui-theme",
	...props
}: ThemeProviderProps) {
	const [theme, setTheme] = React.useState<Theme>(
		() => (typeof window !== "undefined" ? (localStorage.getItem(storageKey) as Theme) : defaultTheme) || defaultTheme
	);

	React.useEffect(() => {
		const root = window.document.documentElement;

		// Only apply theme if it hasn't been applied by the script already
		// This prevents unnecessary class changes during hydration
		const currentTheme = theme === "system" 
			? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
			: theme;

		// Check if the theme is already applied
		if (!root.classList.contains(currentTheme)) {
			root.classList.remove("light", "dark");
			root.classList.add(currentTheme);
		}
	}, [theme]);

	const value = {
		theme,
		setTheme: (theme: Theme) => {
			localStorage.setItem(storageKey, theme);
			setTheme(theme);
		},
	};

	return (
		<ThemeProviderContext.Provider {...props} value={value}>
			{children}
		</ThemeProviderContext.Provider>
	);
}

export const useTheme = () => {
	const context = React.useContext(ThemeProviderContext);

	if (context === undefined)
		throw new Error("useTheme must be used within a ThemeProvider");

	return context;
};

