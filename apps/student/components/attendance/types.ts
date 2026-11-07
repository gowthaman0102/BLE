import { AttendanceSession, BleVerificationState, StudentAttendanceRecordStatus } from '@smart-attendance/shared';

export type AttendanceScreenState =
  | 'LOADING'
  | 'NO_SESSION'
  | 'ACTIVE_SESSION'
  | 'ERROR';

export type { BleVerificationState, StudentAttendanceRecordStatus };
