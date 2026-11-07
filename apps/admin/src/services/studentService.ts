import api from './api';
import type { Student, StudentFaceProfile, FaceProfileStatus } from '../types';

export interface StudentImportRow {
  rowNumber: number;
  registerNumber: string;
  name: string;
  collegeEmail: string;
  className: string;
  classId: string | null;
  isValid: boolean;
  errors: Array<{ code: string; message: string }>;
}

export interface StudentImportPreview {
  totalRows: number;
  valid: number;
  errors: number;
  data: StudentImportRow[];
}

export interface StudentImportResult {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  rows: Array<{ rowNumber: number; status: 'created' | 'skipped'; errors: Array<{ code: string; message: string }> }>;
}

export const studentService = {
  async getStudents(params: {
    search?: string;
    classId?: string;
    departmentId?: string;
    batchId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, String(value));
    }
    const response = await api.get<{ data: { students: Student[]; pagination: { page: number; limit: number; total: number; totalPages: number } } }>(
      `/api/students?${query.toString()}`,
    );
    return response.data;
  },

  async createStudent(data: Pick<Student, 'registerNumber' | 'name' | 'collegeEmail' | 'classId'>) {
    const response = await api.post<{ data: Student }>('/api/students', data);
    return response.data;
  },

  async updateStudent(id: string, data: Partial<Pick<Student, 'registerNumber' | 'name' | 'collegeEmail' | 'classId'>>) {
    const response = await api.put<{ data: Student }>(`/api/students/${id}`, data);
    return response.data;
  },

  async deleteStudent(id: string) {
    const response = await api.delete<{ success: boolean; message?: string }>(`/api/students/${id}`);
    return response;
  },

  async updateStudentStatus(id: string, status: Student['status']) {
    const response = await api.patch<{ data: Student }>(`/api/students/${id}/status`, { status });
    return response.data;
  },

  async previewImport(file: File) {
    const form = new FormData();
    form.append('file', file);
    const response = await api.postForm<{ data: StudentImportPreview }>('/api/students/import/preview', form);
    return response.data;
  },

  async confirmImport(file: File) {
    const form = new FormData();
    form.append('file', file);
    const response = await api.postForm<{ data: StudentImportResult }>('/api/students/import/confirm', form);
    return response.data;
  },

  downloadTemplate: (format: 'csv' | 'xlsx' = 'csv') => api.download(`/api/students/import/template?format=${format}`),

  async getFaceProfile(studentId: string) {
    const response = await api.get<{ data: StudentFaceProfile }>(`/api/students/${studentId}/face-profile`);
    return response.data;
  },

  async updateFaceProfileStatus(studentId: string, status: FaceProfileStatus, reason?: string) {
    const response = await api.patch<{ data: StudentFaceProfile }>(`/api/students/${studentId}/face-profile/status`, {
      status,
      reason,
    });
    return response.data;
  },

  async uploadReferencePhoto(studentId: string, file: File, reason?: string) {
    const form = new FormData();
    form.append('photo', file);
    if (reason) form.append('reason', reason);
    const response = await api.postForm<{ success: boolean; data: StudentFaceProfile; message: string }>(
      `/api/students/${studentId}/face-profile/reference-photo`,
      form
    );
    return response.data;
  },

  async getReferencePhotoBlob(studentId: string): Promise<Blob> {
    return api.download(`/api/students/${studentId}/face-profile/reference-photo`);
  },

  async revokeReferencePhoto(studentId: string, reason?: string) {
    const response = await api.delete<{ success: boolean; data: StudentFaceProfile; message: string }>(
      `/api/students/${studentId}/face-profile/reference-photo`,
      reason ? { reason } : undefined
    );
    return response.data;
  },
};
