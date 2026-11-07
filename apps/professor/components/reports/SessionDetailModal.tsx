import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import Colors from '../../constants/Colors';
import {
  SessionReportItem,
  LiveAttendanceStudent,
  AttendanceCorrectionItem,
} from '@smart-attendance/shared';
import { attendanceService } from '../../services/api/attendanceService';

interface SessionDetailModalProps {
  visible: boolean;
  session: SessionReportItem | null;
  onClose: () => void;
  onCorrectionSuccess?: () => void;
}

export default function SessionDetailModal({
  visible,
  session,
  onClose,
  onCorrectionSuccess,
}: SessionDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'ROSTER' | 'AUDIT'>('ROSTER');

  // Roster state
  const [rosterLoading, setRosterLoading] = useState<boolean>(true);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [students, setStudents] = useState<LiveAttendanceStudent[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PRESENT' | 'ABSENT'>('ALL');

  // Audit state
  const [auditLoading, setAuditLoading] = useState<boolean>(true);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<AttendanceCorrectionItem[]>([]);

  // Manual correction sub-modal
  const [selectedStudent, setSelectedStudent] = useState<LiveAttendanceStudent | null>(null);
  const [newStatus, setNewStatus] = useState<'PRESENT' | 'ABSENT' | 'LATE' | 'MANUAL'>('PRESENT');
  const [correctionReason, setCorrectionReason] = useState<string>('Physical presence verified in classroom');
  const [submittingCorrection, setSubmittingCorrection] = useState<boolean>(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState<boolean>(false);

  const fetchSessionData = useCallback(async () => {
    if (!session) return;

    // Load Roster
    setRosterLoading(true);
    setRosterError(null);
    try {
      const live = await attendanceService.getLiveAttendance(session.id);
      setStudents(live.students || []);
    } catch (err: any) {
      console.error('Error fetching session roster:', err);
      setRosterError(err?.message || 'Failed to load student roster.');
    } finally {
      setRosterLoading(false);
    }

    // Load Audit History
    setAuditLoading(true);
    setAuditError(null);
    try {
      const history = await attendanceService.getCorrections({ sessionId: session.id });
      setCorrections(history);
    } catch (err: any) {
      console.error('Error fetching correction history:', err);
      setAuditError(err?.message || 'Failed to load correction history.');
    } finally {
      setAuditLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (visible && session) {
      setActiveTab('ROSTER');
      fetchSessionData();
    }
  }, [visible, session, fetchSessionData]);

  const handleOpenCorrection = (student: LiveAttendanceStudent) => {
    setSelectedStudent(student);
    setNewStatus(student.status === 'PRESENT' ? 'ABSENT' : 'PRESENT');
    setCorrectionReason('Physical presence verified in classroom');
    setShowConfirmDialog(false);
  };

  const handleValidateAndPromptConfirm = () => {
    if (!correctionReason.trim() || correctionReason.trim().length < 5) {
      if (Platform.OS === 'web') {
        window.alert('Please enter a meaningful correction reason (at least 5 characters).');
      } else {
        Alert.alert('Reason Required', 'Please enter a meaningful correction reason (at least 5 characters).');
      }
      return;
    }
    setShowConfirmDialog(true);
  };

  const handleConfirmCorrection = async () => {
    if (!session || !selectedStudent) return;

    setSubmittingCorrection(true);
    try {
      await attendanceService.manualMark({
        sessionId: session.id,
        studentId: selectedStudent.studentId,
        status: newStatus,
        reason: correctionReason.trim(),
      });

      setSelectedStudent(null);
      setShowConfirmDialog(false);
      // Refresh both roster and audit history
      await fetchSessionData();
      if (onCorrectionSuccess) {
        onCorrectionSuccess();
      }
    } catch (err: any) {
      console.error('Correction failed:', err);
      const msg = err?.message || 'Failed to record manual correction.';
      if (Platform.OS === 'web') {
        window.alert(`Correction Error: ${msg}`);
      } else {
        Alert.alert('Correction Error', msg);
      }
    } finally {
      setSubmittingCorrection(false);
    }
  };

  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const matchesSearch =
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.registerNumber.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (statusFilter === 'PRESENT') {
        return s.status === 'PRESENT' || s.status === 'LATE' || s.status === 'MANUAL';
      }
      if (statusFilter === 'ABSENT') {
        return s.status === 'ABSENT' || s.status === 'NOT DETECTED';
      }
      return true;
    });
  }, [students, searchQuery, statusFilter]);

  if (!session) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <Text style={styles.sessionDate}>{session.sessionDate}</Text>
              <Text style={styles.subjectTitle}>
                {session.subjectName || 'Attendance Session'}
              </Text>
              <Text style={styles.periodSubtitle}>
                {session.periodName || 'Class Period'} • {session.periodStartTime?.slice(0, 5)} - {session.periodEndTime?.slice(0, 5)}
              </Text>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Quick Stats Bar */}
          <View style={styles.quickStatsRow}>
            <View style={styles.statChip}>
              <Text style={styles.statChipLabel}>Status</Text>
              <Text style={[styles.statChipValue, session.status === 'COMPLETED' ? styles.statusGreen : session.status === 'CANCELLED' ? styles.statusRed : styles.statusBlue]}>
                {session.status}
              </Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statChipLabel}>Present</Text>
              <Text style={[styles.statChipValue, styles.statusGreen]}>
                {session.presentCount}
              </Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statChipLabel}>Absent</Text>
              <Text style={[styles.statChipValue, styles.statusRed]}>
                {session.absentCount}
              </Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statChipLabel}>Rate</Text>
              <Text style={styles.statChipValue}>
                {session.percentage !== null ? `${session.percentage}%` : 'N/A'}
              </Text>
            </View>
          </View>

          {/* Tab Selector */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'ROSTER' && styles.tabButtonActive]}
              onPress={() => setActiveTab('ROSTER')}
            >
              <Text style={[styles.tabButtonText, activeTab === 'ROSTER' && styles.tabButtonTextActive]}>
                Student Roster ({students.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'AUDIT' && styles.tabButtonActive]}
              onPress={() => setActiveTab('AUDIT')}
            >
              <Text style={[styles.tabButtonText, activeTab === 'AUDIT' && styles.tabButtonTextActive]}>
                Audit History ({corrections.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Tab Content: Student Roster */}
          {activeTab === 'ROSTER' ? (
            <View style={styles.tabContentContainer}>
              {/* Search & Filter */}
              <View style={styles.filterBar}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search student or register no..."
                  placeholderTextColor={Colors.textSecondary}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                <View style={styles.filterPills}>
                  {(['ALL', 'PRESENT', 'ABSENT'] as const).map((f) => (
                    <TouchableOpacity
                      key={f}
                      style={[styles.pill, statusFilter === f && styles.pillActive]}
                      onPress={() => setStatusFilter(f)}
                    >
                      <Text style={[styles.pillText, statusFilter === f && styles.pillTextActive]}>
                        {f === 'ALL' ? 'All' : f === 'PRESENT' ? 'Present' : 'Absent'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {rosterLoading ? (
                <View style={styles.centerBox}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <Text style={styles.loadingText}>Loading student roster...</Text>
                </View>
              ) : rosterError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{rosterError}</Text>
                  <TouchableOpacity style={styles.retryBtn} onPress={fetchSessionData}>
                    <Text style={styles.retryBtnText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : filteredStudents.length === 0 ? (
                <View style={styles.centerBox}>
                  <Text style={styles.emptyText}>No students matched the filter.</Text>
                </View>
              ) : (
                <ScrollView style={styles.listScroll}>
                  {filteredStudents.map((st) => {
                    const isPresent = st.status === 'PRESENT' || st.status === 'LATE' || st.status === 'MANUAL';
                    return (
                      <View key={st.studentId} style={styles.studentCard}>
                        <View style={styles.studentInfo}>
                          <Text style={styles.studentName}>{st.name}</Text>
                          <Text style={styles.studentRegNo}>{st.registerNumber}</Text>
                          {st.source ? (
                            <Text style={styles.sourceTag}>
                              Source: {st.source} • Detections: {st.detectionCount || 0}
                            </Text>
                          ) : null}
                        </View>

                        <View style={styles.studentActionCol}>
                          <View
                            style={[
                              styles.statusBadge,
                              isPresent ? styles.statusBadgePresent : styles.statusBadgeAbsent,
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusBadgeText,
                                isPresent ? styles.statusTextPresent : styles.statusTextAbsent,
                              ]}
                            >
                              {st.status}
                            </Text>
                          </View>

                          <TouchableOpacity
                            style={styles.correctActionBtn}
                            onPress={() => handleOpenCorrection(st)}
                          >
                            <Text style={styles.correctActionBtnText}>Edit Status</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          ) : (
            /* Tab Content: Audit History */
            <View style={styles.tabContentContainer}>
              {auditLoading ? (
                <View style={styles.centerBox}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <Text style={styles.loadingText}>Loading correction audit log...</Text>
                </View>
              ) : auditError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{auditError}</Text>
                  <TouchableOpacity style={styles.retryBtn} onPress={fetchSessionData}>
                    <Text style={styles.retryBtnText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : corrections.length === 0 ? (
                <View style={styles.centerBox}>
                  <Text style={styles.emptyTitle}>No Manual Corrections</Text>
                  <Text style={styles.emptyText}>
                    No corrections have been recorded for this attendance session yet.
                  </Text>
                </View>
              ) : (
                <ScrollView style={styles.listScroll}>
                  {corrections.map((corr) => (
                    <View key={corr.id} style={styles.auditCard}>
                      <View style={styles.auditHeader}>
                        <Text style={styles.auditStudentName}>{corr.studentName}</Text>
                        <Text style={styles.auditRegNo}>{corr.registerNumber}</Text>
                      </View>

                      <View style={styles.statusTransitionRow}>
                        <View style={styles.statusOldPill}>
                          <Text style={styles.statusOldText}>{corr.previousStatus}</Text>
                        </View>
                        <Text style={styles.arrowText}>→</Text>
                        <View style={styles.statusNewPill}>
                          <Text style={styles.statusNewText}>{corr.newStatus}</Text>
                        </View>
                      </View>

                      <View style={styles.reasonBox}>
                        <Text style={styles.reasonLabel}>Reason:</Text>
                        <Text style={styles.reasonText}>{corr.reason}</Text>
                      </View>

                      <View style={styles.auditFooter}>
                        <Text style={styles.auditBy}>
                          By: {corr.correctedByName || 'Faculty Member'}
                        </Text>
                        <Text style={styles.auditTimestamp}>
                          {corr.createdAt ? new Date(corr.createdAt).toLocaleString() : ''}
                        </Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          )}

          {/* Sub-Modal: Manual Correction Dialog with Confirmation */}
          {selectedStudent ? (
            <Modal
              visible={true}
              animationType="fade"
              transparent
              onRequestClose={() => setSelectedStudent(null)}
            >
              <View style={styles.subModalOverlay}>
                <View style={styles.subModalCard}>
                  {!showConfirmDialog ? (
                    <>
                      <Text style={styles.subModalTitle}>Manual Correction</Text>
                      <Text style={styles.subModalSubtitle}>
                        Update attendance for {selectedStudent.name} ({selectedStudent.registerNumber})
                      </Text>

                      <Text style={styles.inputLabel}>Current Status: {selectedStudent.status}</Text>
                      <Text style={styles.inputLabel}>Select New Status:</Text>
                      <View style={styles.statusSelectRow}>
                        {(['PRESENT', 'ABSENT', 'LATE', 'MANUAL'] as const).map((st) => (
                          <TouchableOpacity
                            key={st}
                            style={[styles.statusSelectBtn, newStatus === st && styles.statusSelectBtnActive]}
                            onPress={() => setNewStatus(st)}
                          >
                            <Text
                              style={[
                                styles.statusSelectBtnText,
                                newStatus === st && styles.statusSelectBtnTextActive,
                              ]}
                            >
                              {st}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      <Text style={styles.inputLabel}>Audit Reason (Required):</Text>
                      <TextInput
                        style={styles.reasonInput}
                        value={correctionReason}
                        onChangeText={setCorrectionReason}
                        placeholder="State reason for manual correction..."
                        placeholderTextColor={Colors.textSecondary}
                        multiline
                        numberOfLines={3}
                      />

                      <View style={styles.modalBtnRow}>
                        <TouchableOpacity
                          style={styles.cancelBtn}
                          onPress={() => setSelectedStudent(null)}
                        >
                          <Text style={styles.cancelBtnText}>Cancel</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.proceedBtn}
                          onPress={handleValidateAndPromptConfirm}
                        >
                          <Text style={styles.proceedBtnText}>Next: Review</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    /* Step 2: Confirmation Dialog */
                    <>
                      <Text style={styles.subModalTitle}>Confirm Correction</Text>
                      <Text style={styles.confirmNotice}>
                        Please verify the details below. This action will be permanently recorded in the institutional audit log.
                      </Text>

                      <View style={styles.confirmBox}>
                        <Text style={styles.confirmItem}>
                          <Text style={styles.confirmItemBold}>Student: </Text>
                          {selectedStudent.name} ({selectedStudent.registerNumber})
                        </Text>
                        <Text style={styles.confirmItem}>
                          <Text style={styles.confirmItemBold}>Change: </Text>
                          {selectedStudent.status} → {newStatus}
                        </Text>
                        <Text style={styles.confirmItem}>
                          <Text style={styles.confirmItemBold}>Reason: </Text>
                          "{correctionReason.trim()}"
                        </Text>
                      </View>

                      <View style={styles.modalBtnRow}>
                        <TouchableOpacity
                          style={styles.cancelBtn}
                          disabled={submittingCorrection}
                          onPress={() => setShowConfirmDialog(false)}
                        >
                          <Text style={styles.cancelBtnText}>Back</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.submitConfirmBtn, submittingCorrection && { opacity: 0.7 }]}
                          disabled={submittingCorrection}
                          onPress={handleConfirmCorrection}
                        >
                          {submittingCorrection ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <Text style={styles.submitConfirmBtnText}>Confirm & Save</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              </View>
            </Modal>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    width: '100%',
    maxWidth: 680,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  headerTitleContainer: {
    flex: 1,
  },
  sessionDate: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  subjectTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.text,
    marginTop: 2,
  },
  periodSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  closeBtnText: {
    fontSize: 16,
    color: Colors.text,
    fontWeight: 'bold',
  },
  quickStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statChip: {
    alignItems: 'center',
    flex: 1,
  },
  statChipLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  statChipValue: {
    fontSize: 15,
    fontWeight: 'bold',
    color: Colors.text,
    marginTop: 2,
  },
  statusGreen: {
    color: Colors.primary,
  },
  statusRed: {
    color: Colors.error,
  },
  statusBlue: {
    color: '#3B82F6',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 14,
  },
  tabButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginRight: 8,
  },
  tabButtonActive: {
    borderBottomColor: Colors.primary,
  },
  tabButtonText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  tabButtonTextActive: {
    color: Colors.primary,
  },
  tabContentContainer: {
    flex: 1,
    minHeight: 280,
  },
  filterBar: {
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: Colors.text,
    fontSize: 14,
    marginBottom: 8,
  },
  filterPills: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  pillText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#000000',
  },
  listScroll: {
    flex: 1,
  },
  studentCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.background,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  studentInfo: {
    flex: 1,
    marginRight: 10,
  },
  studentName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  studentRegNo: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  sourceTag: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 4,
    fontStyle: 'italic',
  },
  studentActionCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgePresent: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  statusBadgeAbsent: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: Colors.error,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  statusTextPresent: {
    color: Colors.primary,
  },
  statusTextAbsent: {
    color: Colors.error,
  },
  correctActionBtn: {
    backgroundColor: Colors.surface,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  correctActionBtnText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  auditCard: {
    backgroundColor: Colors.background,
    padding: 14,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  auditHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  auditStudentName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: Colors.text,
  },
  auditRegNo: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  statusTransitionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
    gap: 8,
  },
  statusOldPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  statusOldText: {
    fontSize: 11,
    color: Colors.error,
    fontWeight: 'bold',
  },
  arrowText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  statusNewPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  statusNewText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: 'bold',
  },
  reasonBox: {
    backgroundColor: Colors.surface,
    padding: 8,
    borderRadius: 6,
    marginVertical: 6,
  },
  reasonLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  reasonText: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },
  auditFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  auditBy: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  auditTimestamp: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  loadingText: {
    color: Colors.textSecondary,
    marginTop: 8,
    fontSize: 13,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 4,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  errorBox: {
    padding: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    alignItems: 'center',
    margin: 10,
  },
  errorText: {
    color: Colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },
  retryBtn: {
    backgroundColor: Colors.error,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  // Sub-modal styles
  subModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  subModalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 20,
    width: '100%',
    maxWidth: 480,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  subModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 4,
  },
  subModalSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: Colors.textSecondary,
    marginTop: 10,
    marginBottom: 6,
  },
  statusSelectRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  statusSelectBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  statusSelectBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  statusSelectBtnText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: 'bold',
  },
  statusSelectBtnTextActive: {
    color: Colors.primary,
  },
  reasonInput: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 10,
    color: Colors.text,
    fontSize: 13,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: 'bold',
  },
  proceedBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  proceedBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
  confirmNotice: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 14,
    lineHeight: 18,
  },
  confirmBox: {
    backgroundColor: Colors.background,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  confirmItem: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },
  confirmItemBold: {
    fontWeight: 'bold',
    color: Colors.textSecondary,
  },
  submitConfirmBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  submitConfirmBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
