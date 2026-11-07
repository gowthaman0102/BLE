import { apiClient } from './client';
import { Student } from '@smart-attendance/shared';

export const authService = {
  async studentLogin(username: string, registerNumber: string): Promise<{ success: boolean, student?: Student, token?: string, error?: any }> {
    try {
      const response = await apiClient.post<{ success: boolean; student: Student; token: string }>('/api/auth/student/login', {
        username,
        register_number: registerNumber
      });
      return { success: response.success, student: response.student, token: response.token };
    } catch (e: any) {
      console.error('Login error:', e);
      let message = 'Unable to connect to the server. Please try again.';
      
      if (e.message) {
        if (e.message.includes('Student not found')) message = 'Student not found.';
        else if (e.message.includes('inactive')) message = 'Your student account is inactive. Please contact the administrator.';
        else if (e.message.includes('must match')) message = 'Username and Register Number must match.';
        else message = e.message; // Let specific api errors pass through if they are clean
      }
      
      throw new Error(message);
    }
  }
};
