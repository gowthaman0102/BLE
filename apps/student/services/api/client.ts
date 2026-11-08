import { authStorage } from '../storage/authStorage';

declare const __DEV__: boolean | undefined;

function getBaseUrl(): string {
  const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL;

  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, '');
  }

  // Web browser development fallback
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:3000';
    }
    return `http://${window.location.hostname}:3000`;
  }

  // Mobile development fallback
  if (isDev) {
    return 'http://localhost:3000';
  }

  // In production builds (standalone APK / production bundle), missing EXPO_PUBLIC_API_URL is fatal
  throw new Error(
    'EXPO_PUBLIC_API_URL environment variable is required for production builds. ' +
    'Please set EXPO_PUBLIC_API_URL in your environment or .env file before building.'
  );
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public isNetworkError = false,
    public isTimeout = false
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
};

export const getAuthToken = () => authToken;

export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  unauthorizedHandler = handler;
};

export const apiClient = {
  async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${getBaseUrl()}${endpoint}`;
    
    // Automatically restore persisted token if memory cache is unset
    if (!authToken) {
      try {
        const saved = await authStorage.getToken();
        if (saved) authToken = saved;
      } catch {
        // Continue unauthenticated if storage read fails
      }
    }

    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (!isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    // Standard 15-second timeout controller
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: options.signal || controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `Server responded with status ${response.status}`;
        let errorCode: string | undefined;

        try {
          const errData = await response.json();
          errorMessage = errData.error?.message || errData.message || errorMessage;
          errorCode = errData.error?.code || errData.code;
        } catch {
          // Response body was not JSON (e.g. gateway timeout 504 / HTML 502)
        }

        if (response.status === 401 && unauthorizedHandler) {
          unauthorizedHandler();
        }

        throw new ApiError(response.status, errorMessage, errorCode);
      }

      try {
        return (await response.json()) as T;
      } catch {
        throw new ApiError(response.status, 'Invalid JSON received from server.', 'PARSE_ERROR');
      }
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err instanceof ApiError) {
        throw err;
      }

      if (err?.name === 'AbortError' || controller.signal.aborted) {
        throw new ApiError(0, 'Request timed out. Please check your network connection.', 'TIMEOUT', false, true);
      }

      throw new ApiError(0, 'Unable to connect to server. Please check your network connection.', 'NETWORK_ERROR', true, false);
    }
  },
  
  get<T>(endpoint: string, options?: RequestInit) {
    return this.fetch<T>(endpoint, { ...options, method: 'GET' });
  },
  
  post<T>(endpoint: string, data?: any, options?: RequestInit) {
    return this.fetch<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  postForm<T>(endpoint: string, formData: FormData, options?: RequestInit) {
    return this.fetch<T>(endpoint, {
      ...options,
      method: 'POST',
      body: formData,
    });
  },

  patch<T>(endpoint: string, data?: any, options?: RequestInit) {
    return this.fetch<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  delete<T>(endpoint: string, options?: RequestInit) {
    return this.fetch<T>(endpoint, { ...options, method: 'DELETE' });
  }
};
