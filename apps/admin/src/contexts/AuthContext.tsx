import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';
import type { UserRole } from '../types';

interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  roles: UserRole[];
  loading: boolean;
}

interface AuthUser {
  id: string;
  name: string;
  collegeEmail: string;
  staffCode?: string;
  roles?: UserRole[];
  role?: UserRole;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signup: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  registerStaffRequest: (data: {
    name: string;
    email: string;
    password: string;
    staffCode?: string;
    department?: string;
  }) => Promise<{ success: boolean; message?: string; error?: string }>;
  logout: () => Promise<void>;
  hasRole: (role: UserRole) => boolean;
  hasAnyRole: (roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isUserRole(role: string): role is UserRole {
  return ['ADMIN', 'HOD', 'DEPUTY_HOD', 'CLASS_COUNSELOR', 'STAFF', 'FACULTY', 'STUDENT'].includes(role);
}

function extractRoles(user: AuthUser | undefined): UserRole[] {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length > 0) return user.roles.filter(isUserRole);
  return user.role ? [user.role] : [];
}

function canUseStaffPortal(roles: UserRole[]): boolean {
  return roles.some((role) => ['ADMIN', 'HOD', 'DEPUTY_HOD', 'CLASS_COUNSELOR', 'STAFF', 'FACULTY'].includes(role));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    roles: [],
    loading: true,
  });

  const checkAuth = useCallback(async () => {
    try {
      const response = await api.get<{ success: boolean; user?: AuthUser }>('/auth/me');
      const roles = extractRoles(response.user);
      if (response.success && response.user && canUseStaffPortal(roles)) {
        setState({ isAuthenticated: true, user: { ...response.user, roles }, roles, loading: false });
        return;
      }
    } catch {
      // A missing or expired server session is the normal signed-out state.
    }
    setState({ isAuthenticated: false, user: null, roles: [], loading: false });
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await api.post<{ success: boolean; user?: AuthUser; token?: string; error?: { message?: string } }>(
        '/auth/login',
        { email, password },
      );
      const roles = extractRoles(response.user);
      if (!response.success || !response.user || !canUseStaffPortal(roles)) {
        return { success: false, error: response.error?.message || 'Sign-in failed.' };
      }
      if (response.token && typeof window !== 'undefined') {
        localStorage.setItem('admin_token', response.token);
      }
      setState({ isAuthenticated: true, user: { ...response.user, roles }, roles, loading: false });
      return { success: true };
    } catch (error: unknown) {
      return {
        success: false,
        error: error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
          ? error.message
          : 'Unable to sign in. Please try again.',
      };
    }
  };

  const signup = async (name: string, email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await api.post<{ success: boolean; user?: AuthUser; error?: { message?: string } }>(
        '/auth/signup',
        { name, email, password },
      );
      const roles = extractRoles(response.user);
      if (!response.success || !response.user || !canUseStaffPortal(roles)) {
        return { success: false, error: response.error?.message || 'Sign-up failed.' };
      }
      setState({ isAuthenticated: true, user: { ...response.user, roles }, roles, loading: false });
      return { success: true };
    } catch (error: unknown) {
      return {
        success: false,
        error: error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
          ? error.message
          : 'Unable to create the account. Please try again.',
      };
    }
  };

  const registerStaffRequest = async (data: {
    name: string;
    email: string;
    password: string;
    staffCode?: string;
    department?: string;
  }): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
      const response = await api.post<{ success: boolean; message?: string; error?: { message?: string } }>(
        '/auth/staff-register',
        data,
      );
      if (!response.success) {
        return { success: false, error: response.error?.message || 'Registration request failed.' };
      }
      return { success: true, message: response.message || 'Registration request submitted for HOD authorization.' };
    } catch (error: unknown) {
      return {
        success: false,
        error: error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
          ? error.message
          : 'Unable to submit staff access request. Please try again.',
      };
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Ignore network errors on logout
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem('admin_token');
    }
    setState({ isAuthenticated: false, user: null, roles: [], loading: false });
  };

  const hasRole = (role: UserRole) => state.roles.includes(role);
  const hasAnyRole = (rolesToCheck: UserRole[]) => rolesToCheck.some((role) => state.roles.includes(role));

  return (
    <AuthContext.Provider value={{ ...state, login, signup, registerStaffRequest, logout, hasRole, hasAnyRole }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}


