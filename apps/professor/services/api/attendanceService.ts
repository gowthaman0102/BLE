import { apiClient } from './client';
import {
  AttendanceSession,
  LiveAttendanceData,
  ClassAttendanceSummaryReport,
  AttendanceCorrectionItem,
  AttendanceFallbackRequest,
} from '@smart-attendance/shared';

export const attendanceService = {
  async getSessions(query: { date?: string; status?: string } = {}): Promise<AttendanceSession[]> {
    try {
      const params = new URLSearchParams();
      if (query.date) params.append('date', query.date);
      if (query.status) params.append('status', query.status);

      const qs = params.toString() ? `?${params.toString()}` : '';
      const response = await apiClient.get<{ success: boolean; data: AttendanceSession[] }>(
        `/api/attendance/sessions${qs}`
      );
      return response.data || [];
    } catch (e) {
      console.error('Error fetching sessions:', e);
      throw e;
    }
  },

  async startSession(timetableId: string, date: string): Promise<AttendanceSession> {
    try {
      const response = await apiClient.post<{ success: boolean; data: AttendanceSession }>(
        '/api/attendance/sessions/start',
        { timetableId, date }
      );
      return response.data;
    } catch (e) {
      console.error('Error starting attendance session:', e);
      throw e;
    }
  },

  async startBle(sessionId: string): Promise<void> {
    try {
      await apiClient.post(`/api/attendance/sessions/${sessionId}/ble/start`, {});
    } catch (e) {
      console.error('Error starting BLE for session:', e);
      throw e;
    }
  },

  async stopBle(sessionId: string): Promise<void> {
    try {
      await apiClient.post(`/api/attendance/sessions/${sessionId}/ble/stop`, {});
    } catch (e) {
      console.error('Error stopping BLE for session:', e);
      throw e;
    }
  },

  async getLiveAttendance(sessionId: string): Promise<LiveAttendanceData> {
    try {
      const response = await apiClient.get<{ success: boolean; data: LiveAttendanceData }>(
        `/api/attendance/sessions/${sessionId}/live`
      );
      return response.data;
    } catch (e) {
      console.error('Error fetching live attendance:', e);
      throw e;
    }
  },

  async endSession(sessionId: string): Promise<AttendanceSession> {
    try {
      const response = await apiClient.post<{ success: boolean; data: AttendanceSession }>(
        `/api/attendance/sessions/${sessionId}/end`,
        {}
      );
      return response.data;
    } catch (e) {
      console.error('Error ending attendance session:', e);
      throw e;
    }
  },

  async cancelSession(sessionId: string, reason: string): Promise<AttendanceSession> {
    try {
      const response = await apiClient.post<{ success: boolean; data: AttendanceSession }>(
        `/api/attendance/sessions/${sessionId}/cancel`,
        { reason }
      );
      return response.data;
    } catch (e) {
      console.error('Error cancelling attendance session:', e);
      throw e;
    }
  },

  async manualMark(params: {
    sessionId: string;
    studentId: string;
    status: 'PRESENT' | 'ABSENT' | 'LATE' | 'MANUAL';
    reason?: string;
  }): Promise<any> {
    try {
      const response = await apiClient.post<{ success: boolean; data: any }>(
        '/api/attendance/records/manual',
        params
      );
      return response.data;
    } catch (e) {
      console.error('Error manual marking attendance:', e);
      throw e;
    }
  },

  async correctAttendance(params: {
    recordId: string;
    newStatus: 'PRESENT' | 'ABSENT' | 'LATE' | 'MANUAL';
    reason: string;
  }): Promise<any> {
    try {
      const response = await apiClient.post<{ success: boolean; data: any }>(
        '/api/attendance/corrections',
        params
      );
      return response.data;
    } catch (e) {
      console.error('Error correcting attendance:', e);
      throw e;
    }
  },

  async getClassAttendanceSummary(
    classId: string,
    startDate?: string,
    endDate?: string
  ): Promise<ClassAttendanceSummaryReport> {
    try {
      const params = new URLSearchParams();
      params.append('classId', classId);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await apiClient.get<{ success: boolean; data: ClassAttendanceSummaryReport }>(
        `/api/attendance/reports/class-summary?${params.toString()}`
      );
      return response.data;
    } catch (e) {
      console.error('Error fetching class attendance summary:', e);
      throw e;
    }
  },

  async getCorrections(params: {
    sessionId?: string;
    classId?: string;
    recordId?: string;
    limit?: number;
    offset?: number;
  }): Promise<AttendanceCorrectionItem[]> {
    try {
      const qs = new URLSearchParams();
      if (params.sessionId) qs.append('sessionId', params.sessionId);
      if (params.classId) qs.append('classId', params.classId);
      if (params.recordId) qs.append('recordId', params.recordId);
      if (params.limit) qs.append('limit', String(params.limit));
      if (params.offset) qs.append('offset', String(params.offset));

      const response = await apiClient.get<{ success: boolean; data: AttendanceCorrectionItem[] }>(
        `/api/attendance/corrections?${qs.toString()}`
      );
      return response.data || [];
    } catch (e) {
      console.error('Error fetching attendance corrections:', e);
      throw e;
    }
  },

  async getFallbackRequests(sessionId: string): Promise<AttendanceFallbackRequest[]> {
    try {
      const response = await apiClient.get<{ success: boolean; data: AttendanceFallbackRequest[] }>(
        `/api/attendance/sessions/${sessionId}/fallback-requests`
      );
      return response.data || [];
    } catch (e) {
      console.error('Error fetching fallback requests:', e);
      throw e;
    }
  },

  async resolveFallbackRequest(
    sessionId: string,
    requestId: string,
    params: {
      resolution: 'APPROVED' | 'REJECTED';
      notes?: string;
      newStatus?: 'PRESENT' | 'ABSENT' | 'LATE' | 'MANUAL';
    }
  ): Promise<AttendanceFallbackRequest> {
    try {
      const response = await apiClient.post<{ success: boolean; data: AttendanceFallbackRequest }>(
        `/api/attendance/sessions/${sessionId}/fallback-requests/${requestId}/resolve`,
        params
      );
      return response.data;
    } catch (e) {
      console.error('Error resolving fallback request:', e);
      throw e;
    }
  },
};
