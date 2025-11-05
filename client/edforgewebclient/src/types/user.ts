/**
 * EdForge EMIS - User Type Definitions
 * 
 * Type definitions for user management service API
 */

export interface User {
  userId: string;
  email: string;
  username?: string;
  name?: string;
  role?: string;
  userRole?: string;
  enabled?: boolean;
  status?: string;
  verified?: boolean;
  created?: string;
  modified?: string;
  tenantId?: string;
}

export interface CreateUserRequest {
  userName: string;
  userEmail: string;
  userRole: string;
}

/**
 * Update User Request
 * Matches UpdateUserDto from backend (extends PartialType(UserDto))
 */
export interface UpdateUserRequest {
  userName?: string;
  userEmail?: string;
  userRole?: string;
}

export interface UserListResponse {
  users: User[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
}

