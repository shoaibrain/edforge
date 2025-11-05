"use client";

/**
 * EdForge EMIS - User Context Provider
 * 
 * Integrates with NextAuth v4 for session management.
 * Maps NextAuth session to internal User type for application use.
 */

import * as React from "react";
import { useSession } from "next-auth/react";
import type { User } from "@/types/rbac";
import { UserRole } from "@/types/rbac";
import { useTenant } from "./tenant-context";

interface UserContextValue {
	user: User | null;
	setUser: (user: User | null) => void;
	isLoading: boolean;
}

const UserContext = React.createContext<UserContextValue | undefined>(undefined);

interface UserProviderProps {
	children: React.ReactNode;
}

// Map Cognito userRole to internal UserRole enum
function mapCognitoRoleToUserRole(cognitoRole?: string): UserRole {
	switch (cognitoRole) {
		case "TenantAdmin":
			return UserRole.TENANT_ADMIN;
		case "Principal":
			return UserRole.PRINCIPAL;
		case "Teacher":
			return UserRole.TEACHER;
		case "Student":
			return UserRole.STUDENT;
		case "Parent":
			return UserRole.PARENT;
		default:
			return UserRole.TENANT_ADMIN;
	}
}

function UserProviderInner({ children }: UserProviderProps) {
	const { data: session, status } = useSession();
	const [user, setUserState] = React.useState<User | null>(null);
	const { tenant } = useTenant(); // Get tenant from TenantContext

	// Convert NextAuth session to User type
	React.useEffect(() => {
		if (session?.user) {
			const authUser: User = {
				id: session.user.id,
				name: session.user.name || session.user.email || "Unknown",
				email: session.user.email || "",
				role: mapCognitoRoleToUserRole(session.user.userRole),
				avatar: session.user.name?.charAt(0).toUpperCase() || "U",
				tenantId: session.user.tenantId || tenant?.id || "unknown-tenant",
				tenantName: tenant?.name || session.user.tenantId || "Unknown Tenant",
				metadata: {
					department: "Administration",
				},
			};
			setUserState(authUser);
		} else {
			setUserState(null);
		}
	}, [session, tenant]);

	const setUser = React.useCallback(() => {
		// User state managed by NextAuth - this is a no-op
		console.log("[UserContext] User state managed by NextAuth");
	}, []);

	const value = React.useMemo(
		() => ({
			user,
			setUser,
			isLoading: status === "loading",
		}),
		[user, setUser, status],
	);

	return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function UserProvider({ children }: UserProviderProps) {
	return <UserProviderInner>{children}</UserProviderInner>;
}

export function useUser() {
	const context = React.useContext(UserContext);
	if (!context) {
		throw new Error("useUser must be used within UserProvider");
	}
	return context;
}

export function useRequireUser() {
	const { user, isLoading } = useUser();
	if (!isLoading && !user) {
		throw new Error("User must be authenticated");
	}
	return { user, isLoading };
}