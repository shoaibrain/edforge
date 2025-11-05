/**
 * EdForge EMIS - Theme Script
 * 
 * This script runs before React hydration to prevent FOUC (Flash of Unstyled Content).
 * It detects the user's theme preference and applies the appropriate class to the HTML element
 * before the page renders, eliminating the white flash.
 */

export function ThemeScript() {
	const themeScript = `
		(function() {
			try {
				// Get the stored theme preference
				const stored = localStorage.getItem('edforge-ui-theme');
				const theme = stored || 'system';
				
				// Function to apply theme class
				function applyTheme(themeClass) {
					document.documentElement.classList.remove('light', 'dark');
					document.documentElement.classList.add(themeClass);
				}
				
				// Apply theme based on preference
				if (theme === 'system') {
					// Check system preference
					const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
					applyTheme(prefersDark ? 'dark' : 'light');
					
					// Listen for system theme changes
					window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
						applyTheme(e.matches ? 'dark' : 'light');
					});
				} else {
					applyTheme(theme);
				}
			} catch (e) {
				// Fallback to system preference if localStorage is not available
				const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
				document.documentElement.classList.remove('light', 'dark');
				document.documentElement.classList.add(prefersDark ? 'dark' : 'light');
			}
		})();
	`;

	return (
		<script
			dangerouslySetInnerHTML={{
				__html: themeScript,
			}}
		/>
	);
}
