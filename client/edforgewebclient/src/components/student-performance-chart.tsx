"use client";

/**
 * EdForge EMIS - Student Performance Chart
 * 
 * Client component for rendering student performance radar chart.
 * Uses Recharts library which requires client-side rendering.
 */

import {
	Radar,
	RadarChart,
	PolarGrid,
	PolarAngleAxis,
	PolarRadiusAxis,
	ResponsiveContainer,
	Legend,
	Tooltip,
} from "recharts";

interface PerformanceDataPoint {
	subject: string;
	score: number;
	fullMark: number;
}

interface StudentPerformanceChartProps {
	data: PerformanceDataPoint[];
}

export function StudentPerformanceChart({ data }: StudentPerformanceChartProps) {
	return (
		<ResponsiveContainer width="100%" height={300}>
			<RadarChart data={data}>
				<PolarGrid strokeDasharray="3 3" className="stroke-muted" />
				<PolarAngleAxis
					dataKey="subject"
					className="text-xs fill-muted-foreground"
					tick={{ fill: "hsl(var(--muted-foreground))" }}
				/>
				<PolarRadiusAxis
					angle={90}
					domain={[0, 100]}
					className="text-xs fill-muted-foreground"
				/>
				<Radar
					name="Performance"
					dataKey="score"
					stroke="hsl(var(--primary))"
					fill="hsl(var(--primary))"
					fillOpacity={0.6}
				/>
				<Legend
					wrapperStyle={{
						paddingTop: "20px",
					}}
				/>
				<Tooltip
					contentStyle={{
						backgroundColor: "hsl(var(--popover))",
						border: "1px solid hsl(var(--border))",
						borderRadius: "var(--radius)",
					}}
					labelStyle={{ color: "hsl(var(--popover-foreground))" }}
				/>
			</RadarChart>
		</ResponsiveContainer>
	);
}
