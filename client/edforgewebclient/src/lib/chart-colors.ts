/**
 * Chart Color Utilities
 * Provides actual color values for use in SVG charts
 * These colors match the EdForge design system
 */

// Direct color values that work in SVG (converted from OKLCH to RGB/HSL)
// These are the actual computed values from the design system
export const chartColors = {
  // Chart colors - vibrant and distinct
  chart1: '#EF4444', // Warm Red - for warnings/attention
  chart2: '#10B981', // Green - for success/completion
  chart3: '#3B82F6', // Blue - for primary data
  chart4: '#F59E0B', // Amber - for trends/warnings
  chart5: '#8B5CF6', // Purple - for secondary data
  
  // Semantic colors
  primary: '#3B82F6', // Blue
  secondary: '#14B8A6', // Teal
  success: '#10B981', // Green
  warning: '#F59E0B', // Amber
  error: '#EF4444', // Red
  info: '#3B82F6', // Blue
  accent: '#06B6D4', // Cyan
}

// Dark mode adjusted colors (lighter for better visibility)
export const chartColorsDark = {
  chart1: '#F87171', // Lighter red
  chart2: '#34D399', // Lighter green
  chart3: '#60A5FA', // Lighter blue
  chart4: '#FBBF24', // Lighter amber
  chart5: '#A78BFA', // Lighter purple
  primary: '#60A5FA',
  secondary: '#2DD4BF',
  success: '#34D399',
  warning: '#FBBF24',
  error: '#F87171',
  info: '#60A5FA',
  accent: '#22D3EE',
}

// Get colors based on theme
export function getChartColors(isDark: boolean = false) {
  return isDark ? chartColorsDark : chartColors
}

