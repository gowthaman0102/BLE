import type { ApiError } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const defaultHeaders: Record<string, string> = {};
    if (!isFormData) {
      defaultHeaders['Content-Type'] = 'application/json';
    }
    const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
    if (token) {
      defaultHeaders['Authorization'] = `Bearer ${token}`;
    }
    const config: RequestInit = {
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
      credentials: 'include',
      ...options,
    };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const apiMessage =
          typeof errorBody?.error === 'string'
            ? errorBody.error
            : typeof errorBody?.error?.message === 'string'
              ? errorBody.error.message
              : typeof errorBody?.message === 'string'
                ? errorBody.message
                : response.statusText;
        const apiError: ApiError = {
          error:
            typeof errorBody?.error?.code === 'string'
              ? errorBody.error.code
              : response.statusText,
          message: apiMessage,
          statusCode: response.status,
        };
        throw apiError;
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      return response.json();
    } catch (error) {
      if ((error as ApiError).statusCode) {
        throw error;
      }
      throw {
        error: 'Network Error',
        message: 'Unable to connect to the server. Please check your connection.',
        statusCode: 0,
      } as ApiError;
    }
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async postForm<T>(endpoint: string, body: FormData): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body });
  }

  async download(endpoint: string): Promise<Blob> {
    try {
      const headers: Record<string, string> = {};
      const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`${this.baseUrl}${endpoint}`, { headers, credentials: 'include' });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw {
          error: errorBody?.error?.code || response.statusText,
          message: errorBody?.error?.message || response.statusText,
          statusCode: response.status,
        } as ApiError;
      }
      return await response.blob();
    } catch (error) {
      if ((error as ApiError).statusCode) throw error;
      throw {
        error: 'Network Error',
        message: 'Unable to connect to the server. Please check your connection.',
        statusCode: 0,
      } as ApiError;
    }
  }

  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async patch<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    });
  }
}

export const api = new ApiClient(BASE_URL);
export default api;
