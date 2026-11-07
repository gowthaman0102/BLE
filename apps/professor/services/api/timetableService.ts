import { apiClient } from './client';
import { TimetableEntry } from '@smart-attendance/shared';

function getTodayWeekdayInKolkata(): string {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
  }).toUpperCase();
}

export const timetableService = {
  async getMyTimetable(staffId?: string): Promise<TimetableEntry[]> {
    try {
      const url = staffId ? `/api/timetable?staffId=${staffId}` : '/api/timetable';
      const response = await apiClient.get<{ success: boolean; data: TimetableEntry[] }>(url);
      return response.data || [];
    } catch (e) {
      console.error('Failed to load professor timetable:', e);
      throw e;
    }
  },

  async getTodayTimetable(staffId?: string): Promise<TimetableEntry[]> {
    const all = await this.getMyTimetable(staffId);
    const today = getTodayWeekdayInKolkata();
    return all
      .filter((entry) => entry.dayOfWeek === today)
      .sort((a, b) => {
        if (a.periodStartTime && b.periodStartTime) {
          return a.periodStartTime.localeCompare(b.periodStartTime);
        }
        return (a.periodNumber || 0) - (b.periodNumber || 0);
      });
  },
};
