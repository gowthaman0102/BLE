import React, { createContext, useContext, useState, useEffect } from 'react';
import { setAuthToken } from '../services/api/client';
import { authService } from '../services/api/authService';
import { authStorage } from '../services/storage/authStorage';
import { Student } from '@smart-attendance/shared';

type AuthState = 'INITIALIZING' | 'UNAUTHENTICATED' | 'AUTHENTICATING' | 'AUTHENTICATED';

interface AuthContextData {
  authState: AuthState;
  user: Student | null;
  login: (username: string, registerNumber: string) => Promise<void>;
  logout: () => Promise<void>;
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
        } else {
          setAuthToken(null);
          setUser(null);
          setAuthState('UNAUTHENTICATED');
        }
      } catch (e) {
        console.warn('Session restoration failed:', e);
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

  const login = async (username: string, registerNumber: string) => {
    setAuthState('AUTHENTICATING');
    try {
      if (!username || !registerNumber || username !== registerNumber) {
        throw new Error('Username and Register Number must match.');
      }
      
      const { student, token } = await authService.studentLogin(username, registerNumber);
      
      if (student && token) {
        await Promise.all([
          authStorage.setToken(token),
          authStorage.setUser(student),
        ]);
        setAuthToken(token); // Use the signed JWT returned by the server
        setUser(student);
        setAuthState('AUTHENTICATED');
      } else {
        throw new Error('Login failed.');
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

  return (
    <AuthContext.Provider value={{ authState, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
