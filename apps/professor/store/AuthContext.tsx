import React, { createContext, useContext, useState, useEffect } from 'react';
import { AuthPrincipal } from '@smart-attendance/shared';
import { apiClient, setAuthToken } from '../services/api/client';
import { authStorage } from '../services/storage/authStorage';

type AuthState = 'INITIALIZING' | 'UNAUTHENTICATED' | 'AUTHENTICATING' | 'AUTHENTICATED';

interface AuthContextData {
  authState: AuthState;
  user: AuthPrincipal | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>('INITIALIZING');
  const [user, setUser] = useState<AuthPrincipal | null>(null);

  useEffect(() => {
    async function restoreSession() {
      try {
        const token = await authStorage.getToken();
        const savedUser = await authStorage.getUser();

        if (token && savedUser) {
          setAuthToken(token);
          setUser(savedUser);
          setAuthState('AUTHENTICATED');
        } else {
          setAuthState('UNAUTHENTICATED');
        }
      } catch (err) {
        console.warn('Error restoring professor session:', err);
        setAuthState('UNAUTHENTICATED');
      }
    }

    restoreSession();
  }, []);

  const login = async (email: string, password: string) => {
    setAuthState('AUTHENTICATING');
    try {
      const response = await apiClient.post<{
        success: boolean;
        user: AuthPrincipal;
        token: string;
      }>('/api/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });

      if (response.success && response.user && response.token) {
        setAuthToken(response.token);
        setUser(response.user);
        await authStorage.setToken(response.token);
        await authStorage.setUser(response.user);
        setAuthState('AUTHENTICATED');
      } else {
        throw new Error('Authentication succeeded but failed to receive session token.');
      }
    } catch (e: any) {
      setAuthState('UNAUTHENTICATED');
      throw e;
    }
  };

  const logout = async () => {
    try {
      await apiClient.post('/api/auth/logout', {}).catch(() => {});
    } finally {
      setAuthToken(null);
      setUser(null);
      await authStorage.clear();
      setAuthState('UNAUTHENTICATED');
    }
  };

  return (
    <AuthContext.Provider value={{ authState, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
