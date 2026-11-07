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

export const ApiError = class extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
};

let authToken: string | null = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
};

export const apiClient = {
  async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${getBaseUrl()}${endpoint}`;
    
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

    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      let errorMessage = 'Network response was not ok';
      try {
        const errData = await response.json();
        errorMessage = errData.error?.message || errData.message || errorMessage;
      } catch (e) {
        // ignore
      }
      throw new ApiError(response.status, errorMessage);
    }
    
    return response.json() as Promise<T>;
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
  }
};
