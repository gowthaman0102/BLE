import { apiClient } from './client';
import {
  AttendanceSession,
  StudentAttendanceSummary,
  StudentAttendanceHistoryItem,
  StudentCurrentAttendanceStatus,
  StudentAttendanceRecordStatus,
  StudentFaceVerificationStatus,
  FaceVerificationResponse,
  LivenessChallengeResponse,
  LivenessVerificationResponse,
  AttendanceFallbackReason,
  AttendanceFallbackRequest,
} from '@smart-attendance/shared';

export interface CurrentSessionResponse {
  session: AttendanceSession | null;
  record: StudentAttendanceRecordStatus | null;
}

export const attendanceService = {
  async getCurrentSession(): Promise<CurrentSessionResponse> {
    try {
      const response = await apiClient.get<{
        success: boolean;
        session: AttendanceSession | null;
        record: StudentAttendanceRecordStatus | null;
      }>('/api/students/me/attendance/current');
      return {
        session: response.session,
        record: response.record || null,
      };
    } catch (e) {
      console.error('Error fetching current session:', e);
      throw e;
    }
  },

  async getBleToken(): Promise<string | null> {
    try {
      const response = await apiClient.get<{
        success: boolean;
        token: string | null;
      }>('/api/students/me/attendance/ble-token');
      return response.token;
    } catch (e) {
      console.error('Error requesting BLE attendance token:', e);
      throw e;
    }
  },

  async getCurrentStatus(): Promise<StudentCurrentAttendanceStatus> {
    try {
      const response = await apiClient.get<StudentCurrentAttendanceStatus & { success: boolean }>(
        '/api/students/me/attendance/status'
      );
      return {
        active: response.active,
        session: response.session,
        isMarked: response.isMarked,
        record: response.record,
      };
    } catch (e) {
      console.error('Error fetching attendance status:', e);
      throw e;
    }
  },

  async simulateDetection(): Promise<{ success: boolean; data?: any }> {
    try {
      const response = await apiClient.post<{ success: boolean; data: any }>(
        '/api/students/me/attendance/simulate-detection',
        {}
      );
      return response;
    } catch (e) {
      console.error('Error simulating attendance detection:', e);
      throw e;
    }
  },

  async getSummary(): Promise<StudentAttendanceSummary> {
    try {
      const response = await apiClient.get<{ success: boolean; data: StudentAttendanceSummary }>(
        '/api/students/me/attendance/summary'
      );
      return response.data;
    } catch (e) {
      console.error('Error fetching attendance summary:', e);
      throw e;
    }
  },

  async getHistory(): Promise<StudentAttendanceHistoryItem[]> {
    try {
      const response = await apiClient.get<{ success: boolean; data: StudentAttendanceHistoryItem[] }>(
        '/api/students/me/attendance/history'
      );
      return response.data || [];
    } catch (e) {
      console.error('Error fetching attendance history:', e);
      throw e;
    }
  },

  async getFaceVerificationStatus(sessionId?: string): Promise<StudentFaceVerificationStatus | null> {
    try {
      const url = sessionId
        ? `/api/students/me/attendance/face-verification/status?sessionId=${sessionId}`
        : '/api/students/me/attendance/face-verification/status';
      const response = await apiClient.get<{ success: boolean; data: StudentFaceVerificationStatus }>(url);
      return response.data;
    } catch (e) {
      console.error('Error fetching face verification status:', e);
      return null;
    }
  },

  async verifyFace(
    sessionId: string,
    selfieInput?: {
      uri?: string;
      base64?: string;
      name?: string;
      type?: string;
      file?: File | Blob;
    } | string
  ): Promise<FaceVerificationResponse> {
    try {
      // If a multipart object input is provided:
      if (typeof selfieInput === 'object') {
        const formData = new FormData();
        formData.append('sessionId', sessionId);

        if (selfieInput.file) {
          formData.append('selfie', selfieInput.file as any, selfieInput.name || 'selfie.jpg');
        } else if (selfieInput.uri) {
          formData.append('selfie', {
            uri: selfieInput.uri,
            name: selfieInput.name || 'selfie.jpg',
            type: selfieInput.type || 'image/jpeg',
          } as any);
        } else if (selfieInput.base64) {
          formData.append('selfieBase64', selfieInput.base64);
        }

        formData.append(
          'clientMetadata',
          JSON.stringify({
            clientTimestamp: new Date().toISOString(),
            platform: 'student-mobile',
          })
        );

        const response = await apiClient.postForm<{ success: boolean; data: FaceVerificationResponse }>(
          '/api/students/me/attendance/face-verification/verify',
          formData
        );
        return response.data;
      }

      // Backward compatible json payload
      const response = await apiClient.post<{ success: boolean; data: FaceVerificationResponse }>(
        '/api/students/me/attendance/face-verification/verify',
        {
          sessionId,
          selfieBase64: typeof selfieInput === 'string' ? selfieInput : undefined,
          clientTimestamp: new Date().toISOString(),
        }
      );
      return response.data;
    } catch (e: any) {
      console.error('Error verifying face:', e);
      return {
        success: false,
        status: 'FAILED',
        message: e?.message || 'Face verification request failed.',
        attemptNumber: 1,
        remainingAttempts: 0,
        verifiedAt: null,
      };
    }
  },

  async requestLivenessChallenge(sessionId: string): Promise<LivenessChallengeResponse> {
    try {
      const response = await apiClient.post<{ success: boolean; data: LivenessChallengeResponse }>(
        '/api/students/me/attendance/face-verification/liveness/challenge',
        { sessionId }
      );
      return response.data;
    } catch (e) {
      console.error('Error requesting liveness challenge:', e);
      throw e;
    }
  },

  async verifyLiveness(params: {
    sessionId: string;
    challengeId: string;
    basePhoto: {
      uri?: string;
      base64?: string;
      name?: string;
      type?: string;
      file?: File | Blob;
    };
    actionPhoto: {
      uri?: string;
      base64?: string;
      name?: string;
      type?: string;
      file?: File | Blob;
    };
  }): Promise<LivenessVerificationResponse> {
    try {
      const formData = new FormData();
      formData.append('sessionId', params.sessionId);
      formData.append('challengeId', params.challengeId);

      if (params.basePhoto.file) {
        formData.append('baseSelfie', params.basePhoto.file as any, params.basePhoto.name || 'base.jpg');
      } else if (params.basePhoto.uri) {
        formData.append('baseSelfie', {
          uri: params.basePhoto.uri,
          name: params.basePhoto.name || 'base.jpg',
          type: params.basePhoto.type || 'image/jpeg',
        } as any);
      } else if (params.basePhoto.base64) {
        formData.append('baseBase64', params.basePhoto.base64);
      }

      if (params.actionPhoto.file) {
        formData.append('actionSelfie', params.actionPhoto.file as any, params.actionPhoto.name || 'action.jpg');
      } else if (params.actionPhoto.uri) {
        formData.append('actionSelfie', {
          uri: params.actionPhoto.uri,
          name: params.actionPhoto.name || 'action.jpg',
          type: params.actionPhoto.type || 'image/jpeg',
        } as any);
      } else if (params.actionPhoto.base64) {
        formData.append('actionBase64', params.actionPhoto.base64);
      }

      formData.append(
        'clientMetadata',
        JSON.stringify({
          clientTimestamp: new Date().toISOString(),
          platform: 'student-mobile',
        })
      );

      const response = await apiClient.postForm<{ success: boolean; data: LivenessVerificationResponse }>(
        '/api/students/me/attendance/face-verification/liveness/verify',
        formData
      );
      return response.data;
    } catch (e: any) {
      console.error('Error verifying liveness:', e);
      return {
        success: false,
        status: 'FAILED',
        livenessResult: 'SPOOF',
        message: e?.message || 'Liveness verification request failed.',
        attemptNumber: 1,
        remainingAttempts: 0,
        verifiedAt: null,
      };
    }
  },

  async submitFallbackRequest(params: {
    sessionId: string;
    reasonCategory: AttendanceFallbackReason;
    explanation?: string;
  }): Promise<AttendanceFallbackRequest> {
    try {
      const response = await apiClient.post<{ success: boolean; data: AttendanceFallbackRequest }>(
        '/api/students/me/attendance/fallback-request',
        params
      );
      return response.data;
    } catch (e) {
      console.error('Error submitting fallback request:', e);
      throw e;
    }
  },

  async getFallbackRequest(sessionId: string): Promise<AttendanceFallbackRequest | null> {
    try {
      const response = await apiClient.get<{ success: boolean; data: AttendanceFallbackRequest | null }>(
        `/api/students/me/attendance/fallback-request?sessionId=${sessionId}`
      );
      return response.data || null;
    } catch (e) {
      console.error('Error fetching fallback request:', e);
      return null;
    }
  },
};
