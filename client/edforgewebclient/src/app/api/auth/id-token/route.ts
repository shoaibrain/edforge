/**
 * EdForge EMIS - ID Token Endpoint
 * 
 * Server-side endpoint to fetch ID token for client-side API calls.
 * This allows client components to get fresh ID tokens without storing them in cookies.
 * 
 * Enterprise Architecture:
 * - No tokens stored in cookies (prevents chunking)
 * - ID token fetched on-demand server-side using refreshToken
 * - Returned to client for in-memory caching
 * - Secure: Only accessible to authenticated users
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../[...nextauth]/route";
import { getIdTokenForApiCall } from "@/lib/token-service";

export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Fetch fresh ID token using token-service (server-side only)
    const idToken = await getIdTokenForApiCall();

    if (!idToken) {
      return NextResponse.json(
        { error: "Failed to fetch ID token" },
        { status: 500 }
      );
    }

    // Return ID token to client (safe - it's the user's own token)
    // Client will cache this in memory, not in cookies
    return NextResponse.json({
      idToken,
      expiresIn: 3600, // Typical Cognito token expiration (1 hour)
    });
  } catch (error) {
    console.error("[ID Token API] Error fetching ID token:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

