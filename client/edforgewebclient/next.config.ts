import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

// Get absolute path to monorepo root
// This file is in client/edforgewebclient/, so we go up 2 levels to reach monorepo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const monorepoRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  // Configure Turbopack root directory to fix monorepo workspace detection
  // This silences the warning about multiple lockfiles and ensures correct workspace root
  // Using absolute path to monorepo root, calculated at runtime
  // This works in both local development and Vercel deployment environments
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
