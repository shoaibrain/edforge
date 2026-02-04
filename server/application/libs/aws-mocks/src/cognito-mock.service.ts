/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Cognito Mock Service - Mock authentication for testing
 */

import { Injectable } from '@nestjs/common';

export interface MockUser {
  username: string;
  email: string;
  tenantId: string;
  roles: string[];
  attributes: Record<string, string>;
}

/**
 * In-memory Cognito mock for unit and integration testing
 * Simulates Cognito user pool operations
 */
@Injectable()
export class MockCognitoService {
  private users = new Map<string, MockUser>();
  private tokens = new Map<string, { user: MockUser; expiresAt: number }>();

  /**
   * Register a mock user
   */
  registerUser(user: MockUser): void {
    this.users.set(user.username, user);
  }

  /**
   * Generate a mock JWT token for a user
   */
  generateToken(username: string, expiresInSeconds: number = 3600): string {
    const user = this.users.get(username);
    if (!user) {
      throw new Error(`User not found: ${username}`);
    }

    const token = `mock-jwt-${username}-${Date.now()}`;
    this.tokens.set(token, {
      user,
      expiresAt: Date.now() + expiresInSeconds * 1000
    });

    return token;
  }

  /**
   * Validate a token and return user info
   */
  validateToken(token: string): MockUser | null {
    const tokenData = this.tokens.get(token);
    if (!tokenData) {
      return null;
    }

    if (Date.now() > tokenData.expiresAt) {
      this.tokens.delete(token);
      return null;
    }

    return tokenData.user;
  }

  /**
   * Get user by username
   */
  getUser(username: string): MockUser | undefined {
    return this.users.get(username);
  }

  /**
   * Clear all users and tokens
   */
  clear(): void {
    this.users.clear();
    this.tokens.clear();
  }

  /**
   * List all users
   */
  listUsers(): MockUser[] {
    return Array.from(this.users.values());
  }
}

