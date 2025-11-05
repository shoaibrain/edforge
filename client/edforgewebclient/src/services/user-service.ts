/**
 * EdForge EMIS - User Service
 * 
 * Service for user management operations
 * API Endpoints: /users
 */

import { BaseService } from './base-service';
import type { 
  User, 
  CreateUserRequest, 
  UserListResponse 
} from '@/types/user';

export class UserService extends BaseService {
  constructor() {
    super('/users');
  }

  /**
   * Fetch all users for the tenant
   * API: GET /users
   */
  async fetch(params?: { page?: number; limit?: number }): Promise<User[]> {
    const response = await this.get('', params);
    
    // Handle both array and paginated response formats
    if (Array.isArray(response)) {
      return response as User[];
    }
    
    const typedResponse = response as UserListResponse;
    return typedResponse.users || [];
  }

  /**
   * Create a new user
   * API: POST /users
   */
  async create(userData: CreateUserRequest): Promise<User> {
    const response = await this.post('', userData);
    return response as User;
  }

  /**
   * Get a user by ID
   * API: GET /users/{id}
   */
  async getUserById(id: string): Promise<User> {
    const response = await this.get(`/${id}`);
    return response as User;
  }

  /**
   * Update a user
   * API: PUT /users/{id}
   */
  async update(id: string, userData: import('@/types/user').UpdateUserRequest): Promise<User> {
    const response = await this.put(`/${id}`, userData);
    return response as User;
  }

  /**
   * Delete a user
   * API: DELETE /users/{id}
   */
  async deleteUser(id: string): Promise<void> {
    await this.delete<void>(`/${id}`);
  }
}

// Export singleton instance for client-side use
export const userService = new UserService();

// Server-side service is in a separate file to prevent Turbopack from analyzing
// server-only imports when bundling client components
// Import it only in server components: import { serverUserService } from '@/services/user-service-server'

