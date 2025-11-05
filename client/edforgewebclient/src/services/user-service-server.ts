/**
 * EdForge EMIS - User Service (Server-Side)
 * 
 * Server-side user service implementation.
 * CRITICAL: This file imports BaseServerService which imports api-server (token-service with next/headers).
 * Only import this in server components, never in client components.
 */

import { BaseServerService } from './base-server-service';
import type { 
  User, 
  CreateUserRequest, 
  UserListResponse 
} from '@/types/user';

class ServerUserService extends BaseServerService {
  constructor() {
    super('/users');
  }

  /**
   * Fetch all users for the tenant
   * API: GET /users
   */
  async fetch(params?: { page?: number; limit?: number }): Promise<User[]> {
    const response = await this.get('', params);
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

  // NOTE: getUserById, update, and deleteUser methods removed
  // These endpoints are not available in the API Gateway contract (tenant-api-prod.json)
  // Only GET /users and POST /users are supported
  // If needed in the future, these endpoints must be added to the API Gateway first
}

export const serverUserService = new ServerUserService();

