// ============================================
// Smart Attendance — Shared Types
// ============================================

// --- Roles ---
export type UserRole = 'ADMIN' | 'HOD' | 'DEPUTY_HOD' | 'CLASS_COUNSELOR' | 'STAFF' | 'FACULTY' | 'STUDENT';

// --- Academic ---
export interface Department {
  id: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface Batch {
  id: string;
  name: string;
  startYear: number;
  endYear: number;
  departmentId?: string;
  department?: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface Regulation {
  id: string;
  name: string;
  year: number;
  description?: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface ClassSection {
  id: string;
  name: string;
  yearNumber: number;
  section: string;
  departmentId?: string;
  academicYearId?: string;
  batchId?: string;
  regulationId?: string;
  department?: string;
  academicYear?: string;
  batch?: string;
  regulation?: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

// --- People ---
export interface Student {
  id: string;
  registerNumber: string;
  name: string;
  collegeEmail: string;
  classId: string;
  className?: string;
  batchName?: string;
  departmentCode?: string;
  academicYearName?: string;
  regulationName?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'GRADUATED' | 'SUSPENDED';
  createdAt: string;
  updatedAt: string;
}

export interface StudentImportError {
  code: string;
  message: string;
}

export interface StudentImportRow {
  rowNumber: number;
  registerNumber: string;
  name: string;
  collegeEmail: string;
  className: string;
  classId: string | null;
  isValid: boolean;
  errors: StudentImportError[];
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
  failed: number;
}

export interface Staff {
  id: string;
  staffCode: string;
  staffId?: string;        // college staff ID
  name: string;
  email?: string;
  collegeEmail: string;
  role?: UserRole;
  roles?: string[];
  department?: string;
  isActive?: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  updatedAt?: string;
}

// --- Subjects ---
export interface Subject {
  id: string;
  code: string;           // e.g. "CS3401"
  name: string;           // e.g. "Database Management Systems"
  shortName: string;      // e.g. "DBMS"
  credits: number;
  type: 'THEORY' | 'LAB' | 'ELECTIVE';
  regulationId: string;
  semester: number;
  department: string;
  createdAt: string;
  updatedAt: string;
}

// --- Timetable ---
export type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';

export interface Period {
  id: string;
  number: number;         // 1–8
  startTime: string;      // "09:00"
  endTime: string;        // "09:50"
  type: 'REGULAR' | 'BREAK' | 'LUNCH';
}

export interface TimetableEntry {
  id: string;
  classId: string;
  day: DayOfWeek;
  periodId: string;
  subjectId: string;
  staffId: string;
  academicYearId: string;
  createdAt: string;
  updatedAt: string;
}


export interface TimetableOverride {
  id: string;
  timetableId?: string;
  originalEntryId?: string;
  date?: string;
  overrideDate?: string;
  subjectId?: string;
  staffId?: string;
  replacementStaffId?: string;
  replacementSubjectId?: string;
  reason?: string;
  createdBy?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  
  className?: string;
  periodName?: string;
  originalSubjectName?: string;
  replacementStaffName?: string;
}

// --- Attendance ---
export type AttendanceSessionStatus = 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export interface AttendanceSession {
  id: string;
  timetableId: string;
  sessionDate: string;
  startedAt?: string;
  endedAt?: string;
  status: AttendanceSessionStatus;
  startedByStaffId?: string;
  cancellationReason?: string;
  createdAt: string;
  updatedAt: string;

  // Joined fields
  className?: string;
  subjectName?: string;
  staffName?: string;
  periodName?: string;
  periodStartTime?: string;
  periodEndTime?: string;
}

export interface SessionStats {
  totalToday: number;
  scheduledToday: number;
  activeToday: number;
  completedToday: number;
  cancelledToday: number;
  expiredToday: number;
}



export interface AttendanceRecord {
  id: string;
  sessionId: string;
  studentId: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'ON_DUTY';
  markedAt: string;
  method: 'MANUAL' | 'BLE' | 'FACE';
}

export interface AttendanceCorrection {
  id: string;
  recordId: string;
  previousStatus: AttendanceRecord['status'];
  newStatus: AttendanceRecord['status'];
  reason: string;
  correctedBy: string;
  correctedAt: string;
}

// --- Audit ---
export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  userId: string;
  userName: string;
  details: string;
  timestamp: string;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
  success?: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  error: string;
  message?: string;
  statusCode: number;
}

// --- UI ---
export interface NavItem {
  label: string;
  path: string;
  icon: string;
  children?: NavItem[];
}

export interface BreadcrumbItem {
  label: string;
  path?: string;
}

export interface TableColumn<T> {
  key: keyof T | string;
  label: string;
  sortable?: boolean;
  width?: string;
  render?: (value: unknown, row: T) => React.ReactNode;
}

export interface SelectOption {
  value: string;
  label: string;
}


export interface Role {
  id: string;
  name: string;
  description: string | null;
}

export interface StaffRole {
  id: string;
  roleId: string;
  roleName: string;
  description: string | null;
}

export interface ClassCounselor {
  id: string;
  classId: string;
  className: string;
  staffId: string;
  staffName: string;
  academicYearId: string;
  academicYearName: string;
  status: 'ACTIVE' | 'INACTIVE';
  assignedAt: string;
}

export interface StaffListResponse {
  staff: Staff[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type SubjectType = 'THEORY' | 'LAB' | 'ELECTIVE' | 'PROJECT' | 'SEMINAR';
export type SubjectStatus = 'ACTIVE' | 'INACTIVE';

export interface Subject {
  id: string;
  code: string;
  name: string;
  description: string | null;
  subjectType: SubjectType;
  yearNumber: number;
  regulationId: string;
  regulationName?: string;
  status: SubjectStatus;
  dataSource: 'MANUALLY_ENTERED' | 'LEGACY_UNVERIFIED';
  createdAt: string;
  updatedAt: string;
}

export interface ClassSubject {
  id: string;
  classId: string;
  subjectId: string;
  academicYearId: string;
  status: SubjectStatus;
  
  // Joins
  subjectCode?: string;
  subjectName?: string;
  subjectType?: SubjectType;
  yearNumber?: number;
  regulationName?: string;
  className?: string;
  academicYearName?: string;
}

export interface SubjectListResponse {
  subjects: Subject[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SubjectStats {
  total: number;
  active: number;
  theory: number;
  lab: number;
}

// --- Timetable ---
export interface Period {
  id: string;
  periodNumber: number;
  name: string;
  startTime: string;
  endTime: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface TimetableEntry {
  id: string;
  academicYearId: string;
  classId: string;
  dayOfWeek: string;
  periodId: string;
  subjectId: string;
  staffId: string;
  status: 'ACTIVE' | 'INACTIVE';
  
  subjectName?: string;
  subjectCode?: string;
  staffName?: string;
  periodName?: string;
  periodEndTime?: string;
  className?: string;
}

export interface LiveAttendanceStudent {
  studentId: string;
  registerNumber: string;
  name: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'MANUAL' | 'NOT DETECTED';
  source?: 'BLE' | 'MANUAL';
  firstDetectedAt?: string;
  lastDetectedAt?: string;
  detectionCount: number;
  faceVerificationStatus?: RosterFaceStatus;
  fallbackRequest?: AttendanceFallbackRequestSummary | null;
}

export interface LiveAttendanceData {
  sessionId: string;
  totalStudents: number;
  detectedStudents: number;
  notDetectedStudents: number;
  percentage: number;
  students: LiveAttendanceStudent[];
}

// ============================================
// Face Verification Contracts (Milestone F2)
// ============================================

export type FaceProfileStatus = 'NOT_ENROLLED' | 'PENDING' | 'ACTIVE' | 'REVOKED';

export type FaceVerificationStatus =
  | 'PENDING'
  | 'VERIFIED'
  | 'FAILED'
  | 'NOT_CONFIGURED'
  | 'EXPIRED'
  | 'BLOCKED';

export type FaceVerificationFailureReason =
  | 'BLE_NOT_DETECTED'
  | 'SESSION_NOT_ACTIVE'
  | 'STUDENT_NOT_ENROLLED'
  | 'PROFILE_NOT_ACTIVE'
  | 'MAX_ATTEMPTS_EXCEEDED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'FACE_MISMATCH'
  | 'LIVENESS_FAILED'
  | 'POOR_IMAGE_QUALITY'
  | 'NO_FACE_DETECTED'
  | 'MULTIPLE_FACES'
  | 'INTERNAL_ERROR';

export interface StudentFaceProfile {
  studentId: string;
  status: FaceProfileStatus;
  enrolledAt?: string | null;
  enrolledByStaffId?: string | null;
  referencePhotoKey?: string | null;
  referencePhotoSha256?: string | null;
  imageVersion?: number;
  mimeType?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  revokedAt?: string | null;
  revokedByStaffId?: string | null;
  revocationReason?: string | null;
  modelVersion?: string;
  updatedAt: string;
  faceDetectionAvailable?: boolean;
}

export interface ReferencePhotoEnrollmentResult {
  profile: StudentFaceProfile;
  message: string;
}

export interface FaceVerificationRequest {
  sessionId: string;
  selfieBase64?: string;
  clientTimestamp?: string;
}

export interface FaceVerificationResponse {
  success: boolean;
  status: FaceVerificationStatus;
  failureReason?: FaceVerificationFailureReason;
  message: string;
  attemptNumber: number;
  remainingAttempts: number;
  verifiedAt?: string | null;
}

export interface StudentFaceVerificationStatus {
  sessionId: string;
  bleDetected: boolean;
  profileStatus: FaceProfileStatus;
  verificationStatus: FaceVerificationStatus;
  attemptCount: number;
  remainingAttempts: number;
  isEligibleForVerification: boolean;
  verifiedAt?: string | null;
}

export type RosterFaceStatus =
  | 'NOT_REQUIRED'
  | 'BLE_DETECTED'
  | 'PENDING'
  | 'VERIFIED'
  | 'FAILED'
  | 'NOT_ENROLLED'
  | 'MANUAL_CORRECTION'
  | 'FALLBACK_PENDING';

// ============================================
// Milestone F7 - Audited Fallback Contracts
// ============================================

export type AttendanceFallbackReason =
  | 'CAMERA_PERMISSION_DENIED'
  | 'CAMERA_UNAVAILABLE'
  | 'LIVENESS_FAILED'
  | 'LIVENESS_EXPIRED'
  | 'FACE_MISMATCH'
  | 'BLE_UNAVAILABLE'
  | 'TECHNICAL_ISSUE';

export type AttendanceFallbackStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AttendanceFallbackRequestSummary {
  id: string;
  reasonCategory: AttendanceFallbackReason;
  explanation?: string | null;
  status: AttendanceFallbackStatus;
  createdAt: string;
}

export interface AttendanceFallbackRequest {
  id: string;
  sessionId: string;
  studentId: string;
  studentName?: string;
  registerNumber?: string;
  reasonCategory: AttendanceFallbackReason;
  explanation?: string | null;
  status: AttendanceFallbackStatus;
  reviewedByStaffId?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResolveFallbackRequestInput {
  resolution: 'APPROVED' | 'REJECTED';
  notes?: string;
  newStatus?: 'PRESENT' | 'ABSENT' | 'LATE' | 'MANUAL';
}

