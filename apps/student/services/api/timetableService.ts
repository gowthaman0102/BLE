import { apiClient } from './client';
import { TimetableEntry } from '@smart-attendance/shared';

export const timetableService = {
  /**
   * Fetches the weekly timetable for the authenticated student's class.
   */
  async getMyTimetable(): Promise<TimetableEntry[]> {
    try {
      const response = await apiClient.get<{ success: boolean; data: TimetableEntry[] }>('/api/students/me/timetable');
      return response.data || [];
    } catch (e) {
      console.error('Error fetching student timetable:', e);
      throw e;
    }
  }
};
