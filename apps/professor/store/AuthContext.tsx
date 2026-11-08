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
    let isMounted = true;

    async function restoreSession() {
      try {
        const [token, savedUser] = await Promise.all([
          authStorage.getToken(),
          authStorage.getUser(),
        ]);

        if (!isMounted) return;

        if (token && savedUser) {
          setAuthToken(token);
          setUser(savedUser);
          setAuthState('AUTHENTICATED');

          // Validate token with backend /api/auth/me to check revocation or expiration
          try {
            const meResp = await apiClient.get<{ success: boolean; user?: AuthPrincipal }>('/api/auth/me');
            if (meResp.success && meResp.user) {
              if (isMounted) {
                setUser(meResp.user);
                await authStorage.setUser(meResp.user);
              }
            } else if (isMounted) {
              await authStorage.clear();
              setAuthToken(null);
              setUser(null);
              setAuthState('UNAUTHENTICATED');
            }
          } catch (validateErr: any) {
            if (validateErr?.statusCode === 401 || validateErr?.statusCode === 403) {
              if (isMounted) {
                await authStorage.clear();
                setAuthToken(null);
                setUser(null);
                setAuthState('UNAUTHENTICATED');
              }
            }
            // If offline/network failure, keep cached session for offline viewing
          }
        } else {
          setAuthState('UNAUTHENTICATED');
        }
      } catch (err) {
        if (isMounted) {
          setAuthState('UNAUTHENTICATED');
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
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
        await Promise.all([
          authStorage.setToken(response.token),
          authStorage.setUser(response.user),
        ]);
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
