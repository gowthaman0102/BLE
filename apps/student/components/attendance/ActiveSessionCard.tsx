import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { AttendanceSession, BleVerificationState, StudentAttendanceRecordStatus } from '@smart-attendance/shared';
import Colors from '../../constants/Colors';
import { bleService } from '../../services/ble/bleService';
import { attendanceService } from '../../services/api/attendanceService';
import FaceVerificationSection from './FaceVerificationSection';

interface ActiveSessionCardProps {
  session: AttendanceSession;
  initialRecord?: StudentAttendanceRecordStatus | null;
  onAttendanceConfirmed?: () => void;
}

function formatMarkedTime(isoStr?: string | null): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

export default function ActiveSessionCard({
  session,
  initialRecord,
  onAttendanceConfirmed,
}: ActiveSessionCardProps) {
  const [state, setState] = useState<BleVerificationState>(
    initialRecord ? 'VERIFIED' : 'READY'
  );
  const [record, setRecord] = useState<StudentAttendanceRecordStatus | null>(
    initialRecord || null
  );
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [simulating, setSimulating] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(35);

  const pollIntervalRef = useRef<any>(null);
  const timeoutRef = useRef<any>(null);
  const countdownIntervalRef = useRef<any>(null);

  const stopPollingAndAdvertising = useCallback(async () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    await bleService.stopAdvertising();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPollingAndAdvertising();
    };
  }, [stopPollingAndAdvertising]);

  const checkBle = useCallback(async () => {
    const bleStatus = await bleService.checkAvailability();
    if (!bleStatus.hasPermissions) {
      setState('PERMISSION_REQUIRED');
      setStatusMessage(bleStatus.message || 'Bluetooth scanning and nearby device permissions are required.');
    } else if (bleStatus.state === 'BLUETOOTH_DISABLED') {
      setState('BLE_UNAVAILABLE');
      setStatusMessage(bleStatus.message || 'Bluetooth is turned off. Please enable Bluetooth in system settings.');
    } else if (bleStatus.state === 'ADVERTISING_UNSUPPORTED') {
      setState('BLE_UNAVAILABLE');
      setStatusMessage(bleStatus.message || 'This device hardware does not support BLE peripheral advertising.');
    } else if (bleStatus.state === 'UNSUPPORTED_ON_WEB') {
      setState('BLE_UNAVAILABLE');
      setStatusMessage(bleStatus.message || 'BLE advertising is not supported on web browsers. Native BLE broadcasting requires an Android device.');
    } else if (!bleStatus.available) {
      setState('BLE_UNAVAILABLE');
      setStatusMessage(bleStatus.message || 'Bluetooth is unavailable.');
    } else {
      setState('READY');
      setStatusMessage('');
    }
  }, []);

  // Initial check of BLE capability if not already verified
  useEffect(() => {
    if (initialRecord) {
      setState('VERIFIED');
      setRecord(initialRecord);
      return;
    }

    checkBle();
  }, [initialRecord, checkBle]);

  const handleStartVerification = useCallback(async () => {
    try {
      setStatusMessage('');
      setState('VERIFYING');
      setCountdown(35);

      // 1. Request session-specific token
      const token = await attendanceService.getBleToken();
      if (!token) {
        setState('EXPIRED');
        return;
      }

      // 2. Start advertising token (token is never logged or exposed in UI)
      await bleService.startAdvertising(token);

      // 3. Start countdown timer
      countdownIntervalRef.current = setInterval(() => {
        setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);

      // 4. Start polling server for attendance confirmation
      pollIntervalRef.current = setInterval(async () => {
        try {
          const currentStatus = await attendanceService.getCurrentStatus();
          if (!currentStatus.active) {
            await stopPollingAndAdvertising();
            setState('EXPIRED');
            return;
          }

          if (currentStatus.isMarked && currentStatus.record) {
            await stopPollingAndAdvertising();
            setRecord(currentStatus.record);
            setState('VERIFIED');
            onAttendanceConfirmed?.();
          }
        } catch (err) {
          console.error('Error during status check polling:', err);
        }
      }, 2500);

      // 5. Timeout after 35 seconds of no detection
      timeoutRef.current = setTimeout(async () => {
        await stopPollingAndAdvertising();
        setState('FAILED');
      }, 35000);
    } catch (error: any) {
      console.error('Failed to initiate verification:', error);
      await stopPollingAndAdvertising();
      setState('FAILED');
    }
  }, [onAttendanceConfirmed, stopPollingAndAdvertising]);

  const handleCancel = useCallback(async () => {
    await stopPollingAndAdvertising();
    if (Platform.OS === 'web') {
      setState('BLE_UNAVAILABLE');
    } else {
      setState('READY');
    }
  }, [stopPollingAndAdvertising]);

  const handleRequestPermissions = useCallback(async () => {
    const granted = await bleService.requestPermissions();
    if (granted) {
      await checkBle();
    } else {
      setState('PERMISSION_REQUIRED');
      setStatusMessage('Bluetooth permissions were denied. Please enable them in device App Settings to verify attendance.');
    }
  }, [checkBle]);

  // Developer simulation in Web preview
  const handleSimulateDetection = useCallback(async () => {
    setSimulating(true);
    try {
      const res = await attendanceService.simulateDetection();
      if (res.success && res.data?.record) {
        await stopPollingAndAdvertising();
        setRecord(res.data.record);
        setState('VERIFIED');
        onAttendanceConfirmed?.();
      }
    } catch (err) {
      console.error('Simulation error:', err);
    } finally {
      setSimulating(false);
    }
  }, [onAttendanceConfirmed, stopPollingAndAdvertising]);

  const renderStateContent = () => {
    switch (state) {
      case 'READY':
        return (
          <View style={styles.actionSection}>
            <Text style={styles.statusTitle}>Attendance Active</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleStartVerification}>
              <Text style={styles.primaryButtonText}>Verify Attendance</Text>
            </TouchableOpacity>
            <Text style={styles.hintText}>
              Tap to broadcast your attendance beacon to the professor's scanner.
            </Text>
          </View>
        );

      case 'VERIFYING':
        return (
          <View style={styles.actionSection}>
            <ActivityIndicator size="large" color={Colors.primary} style={styles.spinner} />
            <Text style={styles.verifyingTitle}>Broadcasting Beacon...</Text>
            <Text style={styles.verifyingSubtitle}>
              Hold your phone near the classroom scanner. Waiting for professor's confirmation ({countdown}s)...
            </Text>

            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelButtonText}>Cancel Verification</Text>
            </TouchableOpacity>

            {process.env.EXPO_PUBLIC_DEV_LOGIN_MODE === 'true' && (
              <View style={styles.simBox}>
                <Text style={styles.simTitle}>Web Preview Test Helper</Text>
                <TouchableOpacity
                  style={[styles.simButton, simulating && styles.buttonDisabled]}
                  disabled={simulating}
                  onPress={handleSimulateDetection}
                >
                  <Text style={styles.simButtonText}>
                    {simulating ? 'Simulating Scanner...' : 'Simulate Scanner Detection'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );

      case 'VERIFIED':
        return (
          <View style={styles.verifiedSection}>
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedCheck}>✓</Text>
              <Text style={styles.verifiedBadgeText}>ATTENDANCE CONFIRMED</Text>
            </View>

            <Text style={styles.verifiedDetail}>
              Status: <Text style={styles.boldText}>{record?.status || 'PRESENT'}</Text>
            </Text>
            {record?.markedAt ? (
              <Text style={styles.verifiedSubDetail}>
                Marked at {formatMarkedTime(record.markedAt)}
                {record.source ? ` • Via ${record.source}` : ' • Via BLE Beacon'}
              </Text>
            ) : null}

            <View style={[styles.primaryButton, styles.verifiedButton]}>
              <Text style={styles.verifiedButtonText}>Verified</Text>
            </View>
          </View>
        );

      case 'PERMISSION_REQUIRED':
        return (
          <View style={styles.alertSection}>
            <View style={styles.warningBox}>
              <Text style={styles.warningTitle}>Bluetooth Permission Required</Text>
              <Text style={styles.warningSubtitle}>
                Bluetooth scanning and nearby device permissions are required to broadcast your attendance beacon.
              </Text>
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={handleRequestPermissions}>
              <Text style={styles.primaryButtonText}>Grant Permission</Text>
            </TouchableOpacity>
          </View>
        );

      case 'BLE_UNAVAILABLE':
        return (
          <View style={styles.alertSection}>
            <View style={styles.warningBox}>
              <Text style={styles.warningTitle}>Bluetooth Unavailable</Text>
              <Text style={styles.warningSubtitle}>
                {statusMessage ||
                  'Bluetooth is disabled or BLE peripheral advertising is unsupported on this device.'}
              </Text>
            </View>

            <TouchableOpacity style={styles.cancelButton} onPress={checkBle}>
              <Text style={styles.cancelButtonText}>Retry Bluetooth Check</Text>
            </TouchableOpacity>

            {process.env.EXPO_PUBLIC_DEV_LOGIN_MODE === 'true' && (
              <TouchableOpacity style={[styles.primaryButton, { marginTop: 12 }]} onPress={handleStartVerification}>
                <Text style={styles.primaryButtonText}>Test Verification Flow (Web Preview)</Text>
              </TouchableOpacity>
            )}
          </View>
        );

      case 'FAILED':
        return (
          <View style={styles.alertSection}>
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Verification Timeout</Text>
              <Text style={styles.errorSubtitle}>
                Your device was not detected by the professor's scanner. Make sure you are inside the classroom and retry.
              </Text>
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={handleStartVerification}>
              <Text style={styles.primaryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        );

      case 'EXPIRED':
        return (
          <View style={styles.alertSection}>
            <View style={styles.warningBox}>
              <Text style={styles.warningTitle}>Session Concluded</Text>
              <Text style={styles.warningSubtitle}>
                This attendance session is no longer active.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => {
                onAttendanceConfirmed?.();
              }}
            >
              <Text style={styles.cancelButtonText}>Refresh Attendance</Text>
            </TouchableOpacity>
          </View>
        );

      case 'NO_SESSION':
      default:
        return null;
    }
  };

  return (
    <View style={styles.card}>
      {/* Card Header with Active Badge */}
      <View style={styles.header}>
        <View style={styles.badge}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>ACTIVE SESSION</Text>
        </View>
      </View>

      {/* Session Details */}
      <Text style={styles.subject}>{session.subjectName}</Text>
      <Text style={styles.detail}>{session.className}</Text>
      <Text style={styles.detail}>
        {session.periodStartTime && session.periodEndTime
          ? `${session.periodStartTime} – ${session.periodEndTime}`
          : session.periodStartTime || ''}
      </Text>

      <View style={styles.divider} />

      <View style={styles.row}>
        <View style={styles.column}>
          <Text style={styles.label}>Faculty</Text>
          <Text style={styles.value}>{session.staffName || 'Faculty'}</Text>
        </View>
        <View style={styles.columnRight}>
          <Text style={styles.label}>Room</Text>
          <Text style={styles.value}>{session.roomName || 'Classroom'}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/* Dynamic State Section */}
      {renderStateContent()}

      {/* Two-Factor Face Verification Section (Milestone F2) */}
      <FaceVerificationSection
        session={session}
        isBleVerified={state === 'VERIFIED'}
        onVerificationComplete={onAttendanceConfirmed}
      />

      {/* Dev UI State Switcher in preview */}
      {process.env.EXPO_PUBLIC_DEV_LOGIN_MODE === 'true' && (
        <View style={styles.devControls}>
          <Text style={styles.devControlsTitle}>PREVIEW UI STATES</Text>
          <View style={styles.devPillRow}>
            {(['READY', 'VERIFYING', 'VERIFIED', 'FAILED', 'PERMISSION_REQUIRED', 'BLE_UNAVAILABLE', 'EXPIRED'] as BleVerificationState[]).map(
              (s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.devPill, state === s && styles.devPillActive]}
                  onPress={() => setState(s)}
                >
                  <Text style={[styles.devPillText, state === s && styles.devPillTextActive]}>
                    {s}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginVertical: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary + '22',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '55',
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
    marginRight: 6,
  },
  badgeText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: 'bold',
  },
  subject: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 4,
  },
  detail: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginBottom: 3,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  column: {
    flex: 1,
  },
  columnRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  label: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 15,
    color: Colors.text,
    fontWeight: '600',
  },
  actionSection: {
    alignItems: 'center',
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.primary,
    textAlign: 'center',
    marginBottom: 14,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    width: '100%',
    marginBottom: 10,
  },
  primaryButtonText: {
    color: Colors.background,
    fontWeight: 'bold',
    fontSize: 16,
  },
  hintText: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  verifyingTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.primary,
    marginTop: 12,
    marginBottom: 6,
  },
  verifyingSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  spinner: {
    marginVertical: 8,
  },
  cancelButton: {
    backgroundColor: 'transparent',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    width: '100%',
    marginBottom: 8,
  },
  cancelButtonText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  verifiedSection: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary + '22',
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 12,
  },
  verifiedCheck: {
    color: Colors.primary,
    fontWeight: 'bold',
    fontSize: 16,
    marginRight: 6,
  },
  verifiedBadgeText: {
    color: Colors.primary,
    fontWeight: 'bold',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  verifiedDetail: {
    fontSize: 16,
    color: Colors.text,
    marginBottom: 4,
  },
  boldText: {
    fontWeight: 'bold',
    color: Colors.primary,
  },
  verifiedSubDetail: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 16,
  },
  verifiedButton: {
    backgroundColor: Colors.primary + '33',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  verifiedButtonText: {
    color: Colors.primary,
    fontWeight: 'bold',
    fontSize: 15,
  },
  alertSection: {
    alignItems: 'center',
  },
  warningBox: {
    backgroundColor: Colors.warning + '18',
    borderWidth: 1,
    borderColor: Colors.warning + '66',
    borderRadius: 8,
    padding: 14,
    width: '100%',
    marginBottom: 14,
  },
  warningTitle: {
    color: Colors.warning,
    fontWeight: 'bold',
    fontSize: 15,
    marginBottom: 6,
  },
  warningSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  errorBox: {
    backgroundColor: Colors.error + '18',
    borderWidth: 1,
    borderColor: Colors.error + '66',
    borderRadius: 8,
    padding: 14,
    width: '100%',
    marginBottom: 14,
  },
  errorTitle: {
    color: Colors.error,
    fontWeight: 'bold',
    fontSize: 15,
    marginBottom: 6,
  },
  errorSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  simBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    width: '100%',
    alignItems: 'center',
  },
  simTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: Colors.warning,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  simButton: {
    backgroundColor: Colors.border,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.primary + '55',
    width: '100%',
    alignItems: 'center',
  },
  simButtonText: {
    color: Colors.primary,
    fontWeight: 'bold',
    fontSize: 13,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  devControls: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border + '55',
  },
  devControlsTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: Colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  devPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  devPill: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  devPillActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '22',
  },
  devPillText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
  },
  devPillTextActive: {
    color: Colors.primary,
  },
});
