import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiClient, setAuthToken } from '../services/api/client';
import { authService } from '../services/api/authService';
import { authStorage } from '../services/storage/authStorage';
import { Student } from '@smart-attendance/shared';

type AuthState = 'INITIALIZING' | 'UNAUTHENTICATED' | 'AUTHENTICATING' | 'AUTHENTICATED';

interface AuthContextData {
  authState: AuthState;
  user: Student | null;
  login: (registerNumber: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>('INITIALIZING');
  const [user, setUser] = useState<Student | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const [savedToken, savedUser] = await Promise.all([
          authStorage.getToken(),
          authStorage.getUser(),
        ]);

        if (!isMounted) return;

        if (savedToken && savedUser) {
          setAuthToken(savedToken);
          setUser(savedUser);
          setAuthState('AUTHENTICATED');

          // Validate token with backend /api/auth/me to ensure it hasn't expired or been revoked
          try {
            const meResp = await apiClient.get<{ success: boolean; user?: any }>('/api/auth/me');
            if (!meResp.success && isMounted) {
              await authStorage.clear();
              setAuthToken(null);
              setUser(null);
              setAuthState('UNAUTHENTICATED');
            }
          } catch (validateErr: any) {
            // If explicit 401/403, session has expired
            if (validateErr?.statusCode === 401 || validateErr?.statusCode === 403) {
              if (isMounted) {
                await authStorage.clear();
                setAuthToken(null);
                setUser(null);
                setAuthState('UNAUTHENTICATED');
              }
            }
            // If network/offline, keep savedUser cached for offline viewing
          }
        } else {
          setAuthToken(null);
          setUser(null);
          setAuthState('UNAUTHENTICATED');
        }
      } catch (e) {
        if (isMounted) {
          setAuthToken(null);
          setUser(null);
          setAuthState('UNAUTHENTICATED');
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = async (registerNumberInput: string) => {
    setAuthState('AUTHENTICATING');
    try {
      const regNo = registerNumberInput.trim();
      if (!regNo) {
        throw new Error('Please enter your Register Number.');
      }
      
      // Pass the validated register number to both username and register_number to satisfy backend contract
      const { student, token } = await authService.studentLogin(regNo, regNo);
      
      if (student && token) {
        await Promise.all([
          authStorage.setToken(token),
          authStorage.setUser(student),
        ]);
        setAuthToken(token);
        setUser(student);
        setAuthState('AUTHENTICATED');
      } else {
        throw new Error('Authentication succeeded but received invalid data.');
      }
    } catch (e) {
      setAuthState('UNAUTHENTICATED');
      throw e;
    }
  };

  const logout = async () => {
    try {
      await authStorage.clear();
    } finally {
      setUser(null);
      setAuthToken(null);
      setAuthState('UNAUTHENTICATED');
    }
  };

  const refreshProfile = async () => {
    try {
      if (user?.registerNumber) {
        // Can reload user if needed
      }
    } catch {
      // ignore
    }
  };

  return (
    <AuthContext.Provider value={{ authState, user, login, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
