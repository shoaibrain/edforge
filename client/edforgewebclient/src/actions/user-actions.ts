"use server";

/**
 * EdForge EMIS - User Server Actions
 * 
 * Server Actions for user management operations.
 * These actions run exclusively on the server and use api-server.ts for API calls.
 * 
 * Enterprise Architecture:
 * - Tokens fetched server-side from JWT (no client-side exposure)
 * - Uses serverApiClient which calls token-service internally
 * - No tokens cached in browser memory
 * - Works identically in localhost and production
 */

import serverApiClient from '@/lib/api-server';
import type { User, CreateUserRequest, UpdateUserRequest, UserListResponse } from '@/types/user';
import { getUserFriendlyMessage } from '@/lib/api-errors';

/**
 * Fetch all users for the tenant
 * Server Action: GET /users
 * 
 * @param params - Optional pagination parameters
 * @returns Array of User objects
 */
export async function fetchUsersAction(
  params?: { page?: number; limit?: number }
): Promise<User[]> {
  try {
    // Build query string if params provided
    let url = '/users';
    if (params && (params.page || params.limit)) {
      const searchParams = new URLSearchParams();
      if (params.page) searchParams.append('page', String(params.page));
      if (params.limit) searchParams.append('limit', String(params.limit));
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const response = await serverApiClient.get<User[] | UserListResponse>(url);

    // Handle both array and paginated response formats
    if (Array.isArray(response)) {
      return response as User[];
    }

    const typedResponse = response as UserListResponse;
    return typedResponse.users || [];
  } catch (error) {
    console.error('[User Actions] Error fetching users:', error);
    throw error;
  }
}

/**
 * Create a new user
 * Server Action: POST /users
 * 
 * @param userData - User creation data
 * @returns Created User object
 */
export async function createUserAction(
  userData: CreateUserRequest
): Promise<User> {
  try {
    const response = await serverApiClient.post<User>('/users', userData);
    return response as User;
  } catch (error) {
    console.error('[User Actions] Error creating user:', error);
    throw error;
  }
}

/**
 * Get a user by ID
 * Server Action: GET /users/{id}
 * 
 * @param id - User ID (username)
 * @returns User object
 */
export async function getUserAction(id: string): Promise<User> {
  try {
    const response = await serverApiClient.get<User>(`/users/${id}`);
    return response as User;
  } catch (error) {
    console.error('[User Actions] Error fetching user:', error);
    throw error;
  }
}

/**
 * Update a user
 * Server Action: PUT /users/{id}
 * 
 * @param id - User ID (username)
 * @param userData - User update data
 * @returns Updated User object
 */
export async function updateUserAction(
  id: string,
  userData: UpdateUserRequest
): Promise<User> {
  try {
    const response = await serverApiClient.put<User>(`/users/${id}`, userData);
    return response as User;
  } catch (error) {
    console.error('[User Actions] Error updating user:', error);
    throw error;
  }
}

/**
 * Delete a user
 * Server Action: DELETE /users/{id}
 * 
 * @param id - User ID (username)
 */
export async function deleteUserAction(id: string): Promise<void> {
  try {
    await serverApiClient.delete<void>(`/users/${id}`);
  } catch (error) {
    console.error('[User Actions] Error deleting user:', error);
    throw error;
  }
}

