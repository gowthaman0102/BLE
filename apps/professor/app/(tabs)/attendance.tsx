import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  TextInput,
  Modal,
  Alert,
  Platform,
} from 'react-native';
import Colors from '../../constants/Colors';
import {
  AttendanceSession,
  TimetableEntry,
  LiveAttendanceData,
  LiveAttendanceStudent,
} from '@smart-attendance/shared';
import { attendanceService } from '../../services/api/attendanceService';
import { timetableService } from '../../services/api/timetableService';

function getTodayDateString(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
}

function formatDetectionTime(isoStr?: string): string {
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

function getFaceBadgeInfo(status?: string, isPresent?: boolean, source?: string) {
  if (source === 'MANUAL') {
    return { label: 'Manual Correction', bg: Colors.successBackground, text: Colors.success, border: Colors.successBorder };
  }
  switch (status) {
    case 'VERIFIED':
      return { label: 'Face Verified', bg: Colors.successBackground, text: Colors.success, border: Colors.successBorder };
    case 'FALLBACK_PENDING':
      return { label: 'Fallback Requested', bg: Colors.warningBackground, text: Colors.warning, border: Colors.warningBorder };
    case 'FAILED':
      return { label: 'Face Failed', bg: Colors.errorBackground, text: Colors.error, border: Colors.errorBorder };
    case 'PENDING':
      return { label: 'Face Pending', bg: Colors.warningBackground, text: Colors.warning, border: Colors.warningBorder };
    case 'BLE_DETECTED':
      return { label: 'BLE Detected', bg: Colors.tealLight, text: Colors.tealDark, border: Colors.teal + '40' };
    default:
      return isPresent
        ? { label: 'BLE Detected', bg: Colors.tealLight, text: Colors.tealDark, border: Colors.teal + '40' }
        : { label: 'Awaiting Beacon', bg: Colors.surfaceSubtle, text: Colors.textMuted, border: Colors.border };
  }
}

export default function AttendanceScreen() {
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Active session and live data
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  const [liveData, setLiveData] = useState<LiveAttendanceData | null>(null);
  const [todaySchedule, setTodaySchedule] = useState<TimetableEntry[]>([]);

  // Starting session state
  const [selectedTimetableId, setSelectedTimetableId] = useState<string>('');
  const [startingSession, setStartingSession] = useState<boolean>(false);
  const [sessionActionLoading, setSessionActionLoading] = useState<boolean>(false);

  // Filter roster
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PRESENT' | 'NOT_DETECTED'>('ALL');

  // Manual correction modal state
  const [selectedStudent, setSelectedStudent] = useState<LiveAttendanceStudent | null>(null);
  const [correctionStatus, setCorrectionStatus] = useState<'PRESENT' | 'ABSENT' | 'LATE' | 'MANUAL'>('PRESENT');
  const [correctionReason, setCorrectionReason] = useState<string>('Physical presence verified in classroom');
  const [correcting, setCorrecting] = useState<boolean>(false);
  const [confirmStep, setConfirmStep] = useState<boolean>(false);

  // Polling ref
  const pollIntervalRef = useRef<any>(null);

  const fetchSessionData = useCallback(async () => {
    try {
      setError(null);
      const today = getTodayDateString();

      // Check for active sessions
      const sessions = await attendanceService.getSessions({ date: today });
      const currentActive = sessions.find((s) => s.status === 'ACTIVE') || null;

      setActiveSession(currentActive);

      if (currentActive) {
        const live = await attendanceService.getLiveAttendance(currentActive.id);
        setLiveData(live);
      } else {
        setLiveData(null);
        // Load today's classes so professor can start a session
        const todayClasses = await timetableService.getTodayTimetable();
        setTodaySchedule(todayClasses);
        if (todayClasses.length > 0 && !selectedTimetableId) {
          setSelectedTimetableId(todayClasses[0].id);
        }
      }
    } catch (err: any) {
      console.error('Error fetching attendance session data:', err);
      setError(err?.message || 'Unable to load attendance session.');
    } finally {
      setLoading(false);
    }
  }, [selectedTimetableId]);

  useEffect(() => {
    fetchSessionData();
  }, [fetchSessionData]);

  // Live polling every 3 seconds while session is active
  useEffect(() => {
    if (activeSession) {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const live = await attendanceService.getLiveAttendance(activeSession.id);
          setLiveData(live);
        } catch (e) {
          console.warn('Live poll error:', e);
        }
      }, 3000);
    } else if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [activeSession]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSessionData();
    setRefreshing(false);
  }, [fetchSessionData]);

  // Start Session Workflow
  const handleStartSession = async (timetableIdToStart?: string) => {
    const targetId = timetableIdToStart || selectedTimetableId;
    if (!targetId) {
      setError('Please select a scheduled class period to start attendance.');
      return;
    }

    setStartingSession(true);
    setError(null);
    try {
      const today = getTodayDateString();
      const session = await attendanceService.startSession(targetId, today);

      // Automatically activate student BLE tokens for this session
      try {
        await attendanceService.startBle(session.id);
      } catch (bleErr) {
        console.warn('BLE start notice:', bleErr);
      }

      setActiveSession(session);
      const live = await attendanceService.getLiveAttendance(session.id);
      setLiveData(live);
    } catch (e: any) {
      console.error('Failed to start session:', e);
      setError(e?.message || 'Failed to start session. Check timetable and date window.');
    } finally {
      setStartingSession(false);
    }
  };

  // Close / End Session
  const handleEndSession = async () => {
    if (!activeSession) return;

    const confirmEnd = () => {
      executeEndSession();
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to finalize and end this attendance session?')) {
        confirmEnd();
      }
    } else {
      Alert.alert(
        'End Attendance Session',
        'Finalize and close this attendance session? Unrecorded students will be counted absent.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'End Session', style: 'destructive', onPress: confirmEnd },
        ]
      );
    }
  };

  const executeEndSession = async () => {
    if (!activeSession) return;
    setSessionActionLoading(true);
    try {
      await attendanceService.stopBle(activeSession.id).catch(() => {});
      await attendanceService.endSession(activeSession.id);
      setActiveSession(null);
      setLiveData(null);
      await fetchSessionData();
    } catch (e: any) {
      setError(e?.message || 'Failed to end attendance session.');
    } finally {
      setSessionActionLoading(false);
    }
  };

  // Cancel Session
  const handleCancelSession = async () => {
    if (!activeSession) return;

    const reason = Platform.OS === 'web'
      ? window.prompt('Enter reason for cancelling this attendance session:', 'Class cancelled')
      : 'Class cancelled';

    if (!reason) return;

    setSessionActionLoading(true);
    try {
      await attendanceService.stopBle(activeSession.id).catch(() => {});
      await attendanceService.cancelSession(activeSession.id, reason);
      setActiveSession(null);
      setLiveData(null);
      await fetchSessionData();
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel attendance session.');
    } finally {
      setSessionActionLoading(false);
    }
  };

  // Validate & Proceed to Confirmation Step
  const handleValidateCorrection = () => {
    if (!correctionReason.trim() || correctionReason.trim().length < 5) {
      if (Platform.OS === 'web') {
        window.alert('Please enter a meaningful correction reason (at least 5 characters).');
      } else {
        Alert.alert('Reason Required', 'Please enter a meaningful correction reason (at least 5 characters).');
      }
      return;
    }
    setConfirmStep(true);
  };

  // Submit Confirmed Manual Correction / Resolve Fallback
  const handleApplyCorrection = async () => {
    if (!activeSession || !selectedStudent) return;

    setCorrecting(true);
    try {
      if (selectedStudent.fallbackRequest && selectedStudent.fallbackRequest.status === 'PENDING') {
        await attendanceService.resolveFallbackRequest(
          activeSession.id,
          selectedStudent.fallbackRequest.id,
          {
            resolution: correctionStatus === 'ABSENT' ? 'REJECTED' : 'APPROVED',
            notes: correctionReason.trim(),
            newStatus: correctionStatus,
          }
        );
      } else {
        await attendanceService.manualMark({
          sessionId: activeSession.id,
          studentId: selectedStudent.studentId,
          status: correctionStatus,
          reason: correctionReason.trim(),
        });
      }

      setSelectedStudent(null);
      setConfirmStep(false);
      // Immediately refresh live attendance
      const live = await attendanceService.getLiveAttendance(activeSession.id);
      setLiveData(live);
    } catch (e: any) {
      console.error('Failed to apply manual correction:', e);
      Alert.alert('Correction Failed', e?.message || 'Unable to update attendance record.');
    } finally {
      setCorrecting(false);
    }
  };

  // Filter students
  const filteredStudents = (liveData?.students || []).filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.registerNumber.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (statusFilter === 'PRESENT') return s.status === 'PRESENT';
    if (statusFilter === 'NOT_DETECTED') return s.status === 'NOT DETECTED';
    return true;
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        <Text style={styles.screenTitle}>Attendance Management</Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={fetchSessionData}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centerSection}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading attendance data...</Text>
          </View>
        ) : activeSession ? (
          /* ================= ACTIVE SESSION VIEW ================= */
          <View>
            {/* Active Session Header Card */}
            <View style={styles.activeCard}>
              <View style={styles.activeHeader}>
                <View style={styles.liveBadge}>
                  <View style={styles.pulsingDot} />
                  <Text style={styles.liveBadgeText}>SESSION ACTIVE</Text>
                </View>
                <Text style={styles.dateText}>{activeSession.sessionDate}</Text>
              </View>

              <Text style={styles.subjectTitle}>{activeSession.subjectName || 'Class Session'}</Text>
              <Text style={styles.classSubtitle}>
                {activeSession.className || 'Assigned Class'} • {activeSession.roomName ? `Room ${activeSession.roomName}` : 'Room not assigned'}
              </Text>
              <Text style={styles.timeDetail}>
                {activeSession.periodStartTime && activeSession.periodEndTime
                  ? `${activeSession.periodStartTime} – ${activeSession.periodEndTime}`
                  : ''}
              </Text>

              {/* Web BLE Scanner status notice */}
              <View style={styles.scannerNotice}>
                <View style={styles.scannerDot} />
                <Text style={styles.scannerNoticeText}>
                  BLE Scanner Active • Real-time detection polling enabled
                </Text>
              </View>

              {/* Session Controls */}
              <View style={styles.sessionControlsRow}>
                <TouchableOpacity
                  style={[styles.endButton, sessionActionLoading && styles.buttonDisabled]}
                  onPress={handleEndSession}
                  disabled={sessionActionLoading}
                >
                  <Text style={styles.endButtonText}>End & Finalize Session</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.cancelButton, sessionActionLoading && styles.buttonDisabled]}
                  onPress={handleCancelSession}
                  disabled={sessionActionLoading}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Live Statistics Cards */}
            <View style={styles.statsCard}>
              <Text style={styles.statsCardTitle}>Live Verification Statistics</Text>

              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statNumber}>{liveData?.totalStudents || 0}</Text>
                  <Text style={styles.statLabel}>Enrolled</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={[styles.statNumber, styles.greenNumber]}>
                    {liveData?.detectedStudents || 0}
                  </Text>
                  <Text style={styles.statLabel}>Present</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={[styles.statNumber, styles.yellowNumber]}>
                    {liveData?.notDetectedStudents || 0}
                  </Text>
                  <Text style={styles.statLabel}>Pending</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={[styles.statNumber, styles.cyanNumber]}>
                    {liveData?.percentage || 0}%
                  </Text>
                  <Text style={styles.statLabel}>Attendance</Text>
                </View>
              </View>

              {/* Progress bar */}
              <View style={styles.progressBarBackground}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.min(100, liveData?.percentage || 0)}%` },
                  ]}
                />
              </View>
            </View>

            {/* Attendance Roster Section */}
            <View style={styles.rosterHeaderRow}>
              <Text style={styles.sectionTitle}>Class Roster</Text>
              <Text style={styles.countBadge}>{filteredStudents.length} Students</Text>
            </View>

            {/* Search and Filters */}
            <View style={styles.filterSection}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by student name or register number..."
                placeholderTextColor={Colors.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />

              <View style={styles.filterPillsRow}>
                <TouchableOpacity
                  style={[styles.filterPill, statusFilter === 'ALL' && styles.filterPillActive]}
                  onPress={() => setStatusFilter('ALL')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      statusFilter === 'ALL' && styles.filterPillTextActive,
                    ]}
                  >
                    All ({liveData?.students?.length || 0})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.filterPill, statusFilter === 'PRESENT' && styles.filterPillActive]}
                  onPress={() => setStatusFilter('PRESENT')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      statusFilter === 'PRESENT' && styles.filterPillTextActive,
                    ]}
                  >
                    Present ({liveData?.detectedStudents || 0})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    statusFilter === 'NOT_DETECTED' && styles.filterPillActive,
                  ]}
                  onPress={() => setStatusFilter('NOT_DETECTED')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      statusFilter === 'NOT_DETECTED' && styles.filterPillTextActive,
                    ]}
                  >
                    Pending ({liveData?.notDetectedStudents || 0})
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Student List */}
            {filteredStudents.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No matching students found</Text>
              </View>
            ) : (
              filteredStudents.map((student) => {
                const isPresent = student.status === 'PRESENT';
                const faceBadge = getFaceBadgeInfo(student.faceVerificationStatus, isPresent, student.source);
                return (
                  <View key={student.studentId} style={styles.studentCard}>
                    <View style={styles.studentInfoRow}>
                      <View style={styles.studentTextCol}>
                        <Text style={styles.studentName}>{student.name}</Text>
                        <Text style={styles.studentReg}>{student.registerNumber}</Text>
                      </View>

                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                        <View
                          style={[
                            styles.faceBadge,
                            { backgroundColor: faceBadge.bg, borderColor: faceBadge.text }
                          ]}
                        >
                          <Text style={[styles.faceBadgeText, { color: faceBadge.text }]}>
                            {faceBadge.label}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.statusBadge,
                            isPresent ? styles.presentBadge : styles.pendingBadge,
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusBadgeText,
                              isPresent ? styles.presentBadgeText : styles.pendingBadgeText,
                            ]}
                          >
                            {student.status}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {student.fallbackRequest && student.fallbackRequest.status === 'PENDING' && (
                      <View style={styles.fallbackAlertRow}>
                        <Text style={styles.fallbackAlertText}>
                          ⚠️ Fallback: {student.fallbackRequest.reasonCategory.replace(/_/g, ' ')}
                          {student.fallbackRequest.explanation ? ` — "${student.fallbackRequest.explanation}"` : ''}
                        </Text>
                      </View>
                    )}

                    <View style={styles.studentMetaRow}>
                      <Text style={styles.detectionMetaText}>
                        {isPresent
                          ? `Verified ${student.source ? `via ${student.source}` : 'via BLE'}${
                              student.firstDetectedAt
                                ? ` at ${formatDetectionTime(student.firstDetectedAt)}`
                                : ''
                            } (Signals: ${student.detectionCount})`
                          : 'Awaiting beacon signal...'}
                      </Text>

                      <TouchableOpacity
                        style={[
                          styles.correctButton,
                          student.fallbackRequest?.status === 'PENDING' && styles.fallbackReviewButton,
                        ]}
                        onPress={() => {
                          setSelectedStudent(student);
                          setCorrectionStatus(isPresent ? 'ABSENT' : 'PRESENT');
                          setCorrectionReason(
                            student.fallbackRequest?.explanation
                              ? `[Fallback Resolved] ${student.fallbackRequest.explanation}`
                              : 'Physical presence verified in classroom'
                          );
                          setConfirmStep(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.correctButtonText,
                            student.fallbackRequest?.status === 'PENDING' && styles.fallbackReviewButtonText,
                          ]}
                        >
                          {student.fallbackRequest?.status === 'PENDING' ? 'Review Fallback' : 'Manual Mark'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        ) : (
          /* ================= NO ACTIVE SESSION: START SESSION VIEW ================= */
          <View>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Start Attendance Session</Text>
              <Text style={styles.sectionSubtitle}>
                Select a class period from today's timetable to start the Bluetooth attendance session.
              </Text>

              {todaySchedule.length === 0 ? (
                <View style={styles.emptyScheduleBox}>
                  <Text style={styles.emptyTitle}>No classes scheduled for today.</Text>
                  <Text style={styles.emptySubtitle}>
                    You have no timetable periods assigned for today. Go to the Timetable tab to review your schedule.
                  </Text>
                </View>
              ) : (
                <View style={styles.timetableList}>
                  {todaySchedule.map((entry) => {
                    const isSelected = selectedTimetableId === entry.id;
                    return (
                      <TouchableOpacity
                        key={entry.id}
                        style={[styles.selectClassCard, isSelected && styles.selectClassCardActive]}
                        onPress={() => setSelectedTimetableId(entry.id)}
                      >
                        <View style={styles.selectHeader}>
                          <Text style={styles.selectPeriod}>{entry.periodName || 'Period'}</Text>
                          <Text style={styles.selectTime}>
                            {entry.periodStartTime && entry.periodEndTime
                              ? `${entry.periodStartTime} – ${entry.periodEndTime}`
                              : entry.periodStartTime || ''}
                          </Text>
                        </View>
                        <Text style={styles.selectSubject}>{entry.subjectName}</Text>
                        <Text style={styles.selectClassDetail}>
                          Class: {entry.className || 'Assigned Class'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  <TouchableOpacity
                    style={[styles.startSessionButton, startingSession && styles.buttonDisabled]}
                    onPress={() => handleStartSession()}
                    disabled={startingSession}
                  >
                    {startingSession ? (
                      <ActivityIndicator color={Colors.background} size="small" />
                    ) : (
                      <Text style={styles.startSessionButtonText}>
                        Start Attendance Session & BLE Scanner
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Manual Attendance Correction Modal with Confirmation */}
        <Modal
          visible={!!selectedStudent}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedStudent(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              {!confirmStep ? (
                <>
                  <Text style={styles.modalTitle}>
                    {selectedStudent?.fallbackRequest?.status === 'PENDING'
                      ? 'Review Student Fallback Request'
                      : 'Manual Attendance Correction'}
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    {selectedStudent?.name} ({selectedStudent?.registerNumber})
                  </Text>

                  {selectedStudent?.fallbackRequest && selectedStudent.fallbackRequest.status === 'PENDING' && (
                    <View style={styles.fallbackModalCallout}>
                      <Text style={styles.fallbackModalCalloutTitle}>
                        Reason: {selectedStudent.fallbackRequest.reasonCategory.replace(/_/g, ' ')}
                      </Text>
                      {selectedStudent.fallbackRequest.explanation ? (
                        <Text style={styles.fallbackModalCalloutExplanation}>
                          "{selectedStudent.fallbackRequest.explanation}"
                        </Text>
                      ) : null}
                    </View>
                  )}

                  <Text style={styles.modalInputLabel}>Select Status</Text>
                  <View style={styles.statusOptionsRow}>
                    {(['PRESENT', 'LATE', 'ABSENT', 'MANUAL'] as const).map((st) => (
                      <TouchableOpacity
                        key={st}
                        style={[
                          styles.statusOptionPill,
                          correctionStatus === st && styles.statusOptionPillActive,
                        ]}
                        onPress={() => setCorrectionStatus(st)}
                      >
                        <Text
                          style={[
                            styles.statusOptionText,
                            correctionStatus === st && styles.statusOptionTextActive,
                          ]}
                        >
                          {st}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.modalInputLabel}>Reason / Audit Note (Required)</Text>
                  <TextInput
                    style={styles.modalTextInput}
                    placeholder="Enter audit reason (min 5 chars)..."
                    placeholderTextColor={Colors.textSecondary}
                    value={correctionReason}
                    onChangeText={setCorrectionReason}
                  />

                  <View style={styles.modalActionsRow}>
                    <TouchableOpacity
                      style={styles.modalCancelButton}
                      onPress={() => setSelectedStudent(null)}
                    >
                      <Text style={styles.modalCancelButtonText}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.modalSaveButton}
                      onPress={handleValidateCorrection}
                    >
                      <Text style={styles.modalSaveButtonText}>Next: Review</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.modalTitle}>Confirm Correction</Text>
                  <Text style={styles.modalSubtitle}>
                    This correction will be permanently recorded in the institutional audit log.
                  </Text>

                  <View style={{ backgroundColor: Colors.surface, padding: 12, borderRadius: 8, marginVertical: 12, borderWidth: 1, borderColor: Colors.border }}>
                    <Text style={{ color: Colors.text, fontSize: 13, marginBottom: 4 }}>
                      <Text style={{ fontWeight: 'bold', color: Colors.textSecondary }}>Student: </Text>
                      {selectedStudent?.name} ({selectedStudent?.registerNumber})
                    </Text>
                    <Text style={{ color: Colors.text, fontSize: 13, marginBottom: 4 }}>
                      <Text style={{ fontWeight: 'bold', color: Colors.textSecondary }}>Change: </Text>
                      {selectedStudent?.status} → {correctionStatus}
                    </Text>
                    <Text style={{ color: Colors.text, fontSize: 13 }}>
                      <Text style={{ fontWeight: 'bold', color: Colors.textSecondary }}>Reason: </Text>
                      "{correctionReason.trim()}"
                    </Text>
                  </View>

                  <View style={styles.modalActionsRow}>
                    <TouchableOpacity
                      style={styles.modalCancelButton}
                      disabled={correcting}
                      onPress={() => setConfirmStep(false)}
                    >
                      <Text style={styles.modalCancelButtonText}>Back</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.modalSaveButton, correcting && styles.buttonDisabled]}
                      onPress={handleApplyCorrection}
                      disabled={correcting}
                    >
                      {correcting ? (
                        <ActivityIndicator size="small" color={Colors.background} />
                      ) : (
                        <Text style={styles.modalSaveButtonText}>Confirm & Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 16,
  },
  card: {
    backgroundColor: Colors.surface,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
  activeCard: {
    backgroundColor: Colors.card,
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  activeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.tealLight,
    borderWidth: 1,
    borderColor: Colors.teal + '40',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.teal,
    marginRight: 6,
  },
  liveBadgeText: {
    color: Colors.tealDark,
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  dateText: {
    color: Colors.textSecondary,
    fontSize: 13,
  },
  subjectTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.primary,
    marginBottom: 4,
  },
  classSubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  timeDetail: {
    fontSize: 14,
    color: Colors.teal,
    fontWeight: '600',
    marginBottom: 12,
  },
  scannerNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.tealSubtle,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.teal + '30',
    marginBottom: 16,
  },
  scannerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.teal,
    marginRight: 8,
  },
  scannerNoticeText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  sessionControlsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  endButton: {
    flex: 1,
    backgroundColor: Colors.error,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  endButtonText: {
    color: Colors.text,
    fontWeight: 'bold',
    fontSize: 14,
  },
  cancelButton: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: Colors.textSecondary,
    fontWeight: 'bold',
    fontSize: 14,
  },
  statsCard: {
    backgroundColor: Colors.surface,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  statsCardTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 14,
  },
  statBox: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.text,
  },
  greenNumber: {
    color: Colors.success,
  },
  yellowNumber: {
    color: Colors.warning,
  },
  cyanNumber: {
    color: Colors.teal,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: Colors.surfaceSubtle,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.teal,
  },
  rosterHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  countBadge: {
    fontSize: 12,
    color: Colors.textSecondary,
    backgroundColor: Colors.card,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterSection: {
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: Colors.card,
    color: Colors.text,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: 14,
    marginBottom: 10,
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterPill: {
    backgroundColor: Colors.card,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterPillActive: {
    borderColor: Colors.teal,
    backgroundColor: Colors.tealLight,
  },
  filterPillText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  filterPillTextActive: {
    color: Colors.tealDark,
    fontWeight: 'bold',
  },
  studentCard: {
    backgroundColor: Colors.card,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  studentInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  studentTextCol: {
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.primary,
  },
  studentReg: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  faceBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  faceBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  presentBadge: {
    backgroundColor: Colors.primary + '22',
    borderColor: Colors.primary,
  },
  pendingBadge: {
    backgroundColor: Colors.warning + '22',
    borderColor: Colors.warning,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  presentBadgeText: {
    color: Colors.primary,
  },
  pendingBadgeText: {
    color: Colors.warning,
  },
  studentMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border + '55',
    paddingTop: 8,
    marginTop: 4,
  },
  detectionMetaText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
  },
  correctButton: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    marginLeft: 8,
  },
  correctButtonText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  timetableList: {
    gap: 10,
  },
  selectClassCard: {
    backgroundColor: Colors.background,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  selectClassCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '11',
  },
  selectHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  selectPeriod: {
    color: Colors.primary,
    fontWeight: 'bold',
    fontSize: 12,
  },
  selectTime: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  selectSubject: {
    fontSize: 17,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 4,
  },
  selectClassDetail: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  startSessionButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  startSessionButtonText: {
    color: Colors.background,
    fontWeight: 'bold',
    fontSize: 15,
  },
  emptyScheduleBox: {
    padding: 24,
    alignItems: 'center',
  },
  emptyCard: {
    backgroundColor: Colors.surface,
    padding: 24,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  emptyTitle: {
    color: Colors.text,
    fontWeight: 'bold',
    fontSize: 15,
    marginBottom: 4,
  },
  emptySubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  centerSection: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.textSecondary,
    marginTop: 12,
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  errorBox: {
    backgroundColor: Colors.error + '18',
    borderWidth: 1,
    borderColor: Colors.error,
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
    alignItems: 'center',
  },
  errorText: {
    color: Colors.error,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  retryButton: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  retryText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: Colors.primary,
    marginBottom: 16,
  },
  modalInputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  statusOptionsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 16,
  },
  statusOptionPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  statusOptionPillActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '22',
  },
  statusOptionText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: Colors.textSecondary,
  },
  statusOptionTextActive: {
    color: Colors.primary,
  },
  modalTextInput: {
    backgroundColor: Colors.background,
    color: Colors.text,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: 14,
    marginBottom: 20,
  },
  modalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalCancelButtonText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  modalSaveButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 6,
  },
  modalSaveButtonText: {
    color: Colors.background,
    fontWeight: 'bold',
    fontSize: 14,
  },
  fallbackAlertRow: {
    backgroundColor: '#FF91001A',
    borderWidth: 1,
    borderColor: '#FF9100',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  fallbackAlertText: {
    color: '#FF9100',
    fontSize: 11,
    fontWeight: '600',
  },
  fallbackReviewButton: {
    borderColor: '#FF9100',
    backgroundColor: '#FF91001A',
  },
  fallbackReviewButtonText: {
    color: '#FF9100',
    fontWeight: '700',
  },
  fallbackModalCallout: {
    backgroundColor: '#FF91001A',
    borderWidth: 1,
    borderColor: '#FF9100',
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
  },
  fallbackModalCalloutTitle: {
    color: '#FF9100',
    fontSize: 12,
    fontWeight: '700',
  },
  fallbackModalCalloutExplanation: {
    color: Colors.text,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 3,
  },
});
