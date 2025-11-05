/**
 * Server-Only API Server Loader
 * 
 * This file is ONLY imported on the server side when useServerSide=true.
 * It handles the dynamic import of api-server to avoid pulling server-only
 * dependencies into client bundles.
 * 
 * CRITICAL: This file imports token-service.ts which uses next/headers.
 * It must NEVER be imported by client components.
 */

import serverApiClient from '@/lib/api-server';

/**
 * Get server API client instance
 * 
 * This is a simple wrapper that returns the server API client.
 * The actual serverApiClient import happens at module load time,
 * but since this file is only ever imported server-side, it's safe.
 */
export function getServerApiClient() {
  return serverApiClient;
}

