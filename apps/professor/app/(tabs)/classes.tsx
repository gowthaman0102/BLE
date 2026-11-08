import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
} from 'react-native';
import Colors from '../../constants/Colors';
import {
  TimetableEntry,
  ClassAttendanceSummaryReport,
  SessionReportItem,
} from '@smart-attendance/shared';
import { timetableService } from '../../services/api/timetableService';
import { attendanceService } from '../../services/api/attendanceService';
import SessionDetailModal from '../../components/reports/SessionDetailModal';
import { router } from 'expo-router';

interface AssignedClassSummary {
  classId: string;
  className: string;
  subjects: { subjectName: string; subjectCode?: string }[];
  totalPeriods: number;
}

type DateRangeFilter = 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS';

function getTodayDateString(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
}

export default function ClassesScreen() {
  const [activeScreenTab, setActiveScreenTab] = useState<'REPORTS' | 'ASSIGNMENTS'>('REPORTS');

  // Timetable and assigned classes
  const [loadingClasses, setLoadingClasses] = useState<boolean>(true);
  const [classesError, setClassesError] = useState<string | null>(null);
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');

  // Reporting state
  const [dateRange, setDateRange] = useState<DateRangeFilter>('LAST_7_DAYS');
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [summaryReport, setSummaryReport] = useState<ClassAttendanceSummaryReport | null>(null);

  // Drill-down session detail modal
  const [selectedSession, setSelectedSession] = useState<SessionReportItem | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState<boolean>(false);

  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Fetch Professor's Timetable / Classes
  const fetchClasses = useCallback(async () => {
    try {
      setClassesError(null);
      const data = await timetableService.getMyTimetable();
      setEntries(data);

      // Auto-select first class if not already selected
      if (data.length > 0) {
        const firstWithClass = data.find((e) => e.classId);
        if (firstWithClass && firstWithClass.classId) {
          setSelectedClassId((prev) => prev || firstWithClass.classId);
        }
      }
    } catch (err: any) {
      console.error('Failed to load professor classes:', err);
      setClassesError(err?.message || 'Unable to load assigned classes.');
    } finally {
      setLoadingClasses(false);
    }
  }, []);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  // Derive unique classes assigned to professor
  const classSummaries = useMemo<AssignedClassSummary[]>(() => {
    const map = new Map<string, AssignedClassSummary>();

    for (const entry of entries) {
      if (!entry.classId) continue;
      const existing = map.get(entry.classId) || {
        classId: entry.classId,
        className: entry.className || 'Class',
        subjects: [],
        totalPeriods: 0,
      };

      existing.totalPeriods += 1;

      if (
        entry.subjectName &&
        !existing.subjects.some((s) => s.subjectName === entry.subjectName)
      ) {
        existing.subjects.push({
          subjectName: entry.subjectName,
          subjectCode: entry.subjectCode,
        });
      }

      map.set(entry.classId, existing);
    }

    return Array.from(map.values());
  }, [entries]);

  // Set default selectedClassId once classSummaries are loaded
  useEffect(() => {
    if (classSummaries.length > 0 && !selectedClassId) {
      setSelectedClassId(classSummaries[0].classId);
    }
  }, [classSummaries, selectedClassId]);

  // Compute startDate & endDate strings based on dateRange filter
  const { startDate, endDate } = useMemo(() => {
    const today = getTodayDateString();
    if (dateRange === 'TODAY') {
      return { startDate: today, endDate: today };
    }
    if (dateRange === 'LAST_7_DAYS') {
      // 7 calendar days inclusive: today-6 through today
      return { startDate: getDateDaysAgo(6), endDate: today };
    }
    if (dateRange === 'LAST_30_DAYS') {
      // 30 calendar days inclusive: today-29 through today
      return { startDate: getDateDaysAgo(29), endDate: today };
    }
    return { startDate: undefined, endDate: undefined };
  }, [dateRange]);

  // Fetch Class Attendance Summary Report
  const fetchReport = useCallback(async () => {
    if (!selectedClassId) return;

    setReportLoading(true);
    setReportError(null);
    try {
      const data = await attendanceService.getClassAttendanceSummary(
        selectedClassId,
        startDate,
        endDate
      );
      setSummaryReport(data);
    } catch (err: any) {
      console.error('Error fetching class summary report:', err);
      setReportError(err?.message || 'Failed to load class attendance summary.');
    } finally {
      setReportLoading(false);
    }
  }, [selectedClassId, startDate, endDate]);

  useEffect(() => {
    if (selectedClassId) {
      fetchReport();
    }
  }, [selectedClassId, fetchReport]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchClasses();
    if (selectedClassId) {
      await fetchReport();
    }
    setRefreshing(false);
  }, [fetchClasses, fetchReport, selectedClassId]);

  const handleOpenSessionDetail = (session: SessionReportItem) => {
    setSelectedSession(session);
    setDetailModalVisible(true);
  };

  const handleCloseSessionDetail = () => {
    setDetailModalVisible(false);
    setSelectedSession(null);
  };

  const handleCorrectionSuccess = () => {
    // Refresh report metrics after a correction is saved
    fetchReport();
  };

  const selectedClassName =
    classSummaries.find((c) => c.classId === selectedClassId)?.className ||
    summaryReport?.className ||
    'Selected Class';

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
        <Text style={styles.screenTitle}>Reports & Classes</Text>
        <Text style={styles.screenSubtitle}>
          Class-wise attendance summaries, date-filtered metrics, and audit records.
        </Text>

        {classesError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{classesError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={fetchClasses}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* View Switcher: Reports vs Assignments */}
        <View style={styles.viewModeToggleRow}>
          <TouchableOpacity
            style={[styles.modeToggleBtn, activeScreenTab === 'REPORTS' && styles.modeToggleBtnActive]}
            onPress={() => setActiveScreenTab('REPORTS')}
          >
            <Text style={[styles.modeToggleText, activeScreenTab === 'REPORTS' && styles.modeToggleTextActive]}>
              📊 Attendance Reports
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modeToggleBtn, activeScreenTab === 'ASSIGNMENTS' && styles.modeToggleBtnActive]}
            onPress={() => setActiveScreenTab('ASSIGNMENTS')}
          >
            <Text style={[styles.modeToggleText, activeScreenTab === 'ASSIGNMENTS' && styles.modeToggleTextActive]}>
              📋 Assigned Classes ({classSummaries.length})
            </Text>
          </TouchableOpacity>
        </View>

        {activeScreenTab === 'REPORTS' ? (
          /* ======================================================== */
          /* TAB 1: ATTENDANCE REPORTS & SUMMARIES                   */
          /* ======================================================== */
          <View style={styles.reportsSection}>
            {loadingClasses ? (
              <View style={styles.centerSection}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.loadingText}>Loading assigned classes...</Text>
              </View>
            ) : classSummaries.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No Classes Assigned</Text>
                <Text style={styles.emptySubtitle}>
                  You do not have any timetable classes assigned to generate attendance reports.
                </Text>
              </View>
            ) : (
              <>
                {/* 1. Class Selection Chips */}
                <Text style={styles.sectionHeading}>Select Class</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.classChipsScroll}>
                  {classSummaries.map((c) => {
                    const isSelected = c.classId === selectedClassId;
                    return (
                      <TouchableOpacity
                        key={c.classId}
                        style={[styles.classChip, isSelected && styles.classChipActive]}
                        onPress={() => setSelectedClassId(c.classId)}
                      >
                        <Text style={[styles.classChipText, isSelected && styles.classChipTextActive]}>
                          {c.className}
                        </Text>
                        <Text style={[styles.classChipSub, isSelected && styles.classChipSubActive]}>
                          {c.totalPeriods} weekly slots
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {/* 2. Date Range Filter Pills */}
                <Text style={styles.sectionHeading}>Date Range</Text>
                <View style={styles.dateFilterRow}>
                  <TouchableOpacity
                    style={[styles.dateFilterPill, dateRange === 'TODAY' && styles.dateFilterPillActive]}
                    onPress={() => setDateRange('TODAY')}
                  >
                    <Text style={[styles.dateFilterPillText, dateRange === 'TODAY' && styles.dateFilterPillTextActive]}>
                      Today
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.dateFilterPill, dateRange === 'LAST_7_DAYS' && styles.dateFilterPillActive]}
                    onPress={() => setDateRange('LAST_7_DAYS')}
                  >
                    <Text style={[styles.dateFilterPillText, dateRange === 'LAST_7_DAYS' && styles.dateFilterPillTextActive]}>
                      Last 7 Days
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.dateFilterPill, dateRange === 'LAST_30_DAYS' && styles.dateFilterPillActive]}
                    onPress={() => setDateRange('LAST_30_DAYS')}
                  >
                    <Text style={[styles.dateFilterPillText, dateRange === 'LAST_30_DAYS' && styles.dateFilterPillTextActive]}>
                      Last 30 Days
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Date range subtitle */}
                <Text style={styles.dateRangeSubtitle}>
                  Filtered: {startDate} to {endDate}
                </Text>

                {/* 3. Summary Metrics Card */}
                {reportLoading ? (
                  <View style={styles.cardLoadingBox}>
                    <ActivityIndicator size="small" color={Colors.primary} />
                    <Text style={styles.loadingText}>Calculating attendance metrics...</Text>
                  </View>
                ) : reportError ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{reportError}</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={fetchReport}>
                      <Text style={styles.retryText}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : summaryReport ? (
                  <>
                    <View style={styles.metricsCard}>
                      <View style={styles.metricsHeader}>
                        <View>
                          <Text style={styles.metricsClassTitle}>{summaryReport.className}</Text>
                          <Text style={styles.metricsClassSub}>
                            Total Enrolled Students: {summaryReport.metrics.totalStudents}
                          </Text>
                        </View>

                        <View style={styles.percentageBadgeContainer}>
                          <Text style={styles.percentageBadgeLabel}>Attendance</Text>
                          <Text style={styles.percentageBadgeVal}>
                            {summaryReport.metrics.attendancePercentage !== null
                              ? `${summaryReport.metrics.attendancePercentage}%`
                              : 'N/A'}
                          </Text>
                        </View>
                      </View>

                      {/* Explicit No-Data Banner if no sessions conducted */}
                      {!summaryReport.metrics.hasData ? (
                        <View style={styles.noDataWarningBox}>
                          <Text style={styles.noDataWarningTitle}>No Sessions Conducted</Text>
                          <Text style={styles.noDataWarningText}>
                            No attendance sessions were completed for {selectedClassName} between {startDate} and {endDate}. Percentage is marked N/A rather than 0%.
                          </Text>
                        </View>
                      ) : null}

                      {/* Numerical Metrics Grid */}
                      <View style={styles.metricsGrid}>
                        <View style={styles.metricGridItem}>
                          <Text style={styles.metricGridVal}>
                            {summaryReport.metrics.conductedSessions}
                          </Text>
                          <Text style={styles.metricGridLabel}>Conducted</Text>
                        </View>

                        <View style={styles.metricGridItem}>
                          <Text style={styles.metricGridVal}>
                            {summaryReport.metrics.eligibleSessions}
                          </Text>
                          <Text style={styles.metricGridLabel}>Eligible</Text>
                        </View>

                        <View style={styles.metricGridItem}>
                          <Text style={[styles.metricGridVal, { color: Colors.primary }]}>
                            {summaryReport.metrics.totalPresent}
                          </Text>
                          <Text style={styles.metricGridLabel}>Presences</Text>
                        </View>

                        <View style={styles.metricGridItem}>
                          <Text style={[styles.metricGridVal, { color: Colors.error }]}>
                            {summaryReport.metrics.totalAbsent}
                          </Text>
                          <Text style={styles.metricGridLabel}>Absences</Text>
                        </View>

                        <View style={styles.metricGridItem}>
                          <Text style={[styles.metricGridVal, { color: '#F59E0B' }]}>
                            {summaryReport.metrics.cancelledSessions}
                          </Text>
                          <Text style={styles.metricGridLabel}>Cancelled</Text>
                        </View>
                      </View>
                    </View>

                    {/* 4. Session Breakdown List */}
                    <View style={styles.sessionsSectionHeader}>
                      <Text style={styles.sectionHeading}>
                        Session Breakdown ({summaryReport.sessions.length})
                      </Text>
                      <Text style={styles.sessionCountSub}>
                        Tap a session to inspect student roster or audit corrections
                      </Text>
                    </View>

                    {summaryReport.sessions.length === 0 ? (
                      <View style={styles.emptySessionsCard}>
                        <Text style={styles.emptySessionsTitle}>No Sessions Found</Text>
                        <Text style={styles.emptySessionsSubtitle}>
                          No attendance sessions exist for this class within the selected date range.
                        </Text>
                      </View>
                    ) : (
                      summaryReport.sessions.map((session) => {
                        const isCancelled = session.status === 'CANCELLED';
                        const isCompleted = session.status === 'COMPLETED';
                        const isActive = session.status === 'ACTIVE';

                        return (
                          <TouchableOpacity
                            key={session.id}
                            style={[styles.sessionCard, isCancelled && styles.sessionCardCancelled]}
                            activeOpacity={0.8}
                            onPress={() => handleOpenSessionDetail(session)}
                          >
                            <View style={styles.sessionCardHeader}>
                              <View style={styles.sessionHeaderLeft}>
                                <Text style={styles.sessionCardDate}>{session.sessionDate}</Text>
                                <Text style={styles.sessionCardSubject}>
                                  {session.subjectName || 'Course Period'}
                                </Text>
                                <Text style={styles.sessionCardPeriod}>
                                  {session.periodName || 'Period'} • {session.periodStartTime?.slice(0, 5)} - {session.periodEndTime?.slice(0, 5)}
                                </Text>
                              </View>

                              <View style={styles.sessionHeaderRight}>
                                <View
                                  style={[
                                    styles.sessionStatusBadge,
                                    isCompleted
                                      ? styles.sessionBadgeCompleted
                                      : isCancelled
                                      ? styles.sessionBadgeCancelled
                                      : styles.sessionBadgeActive,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.sessionStatusText,
                                      isCompleted
                                        ? styles.statusTextGreen
                                        : isCancelled
                                        ? styles.statusTextRed
                                        : styles.statusTextBlue,
                                    ]}
                                  >
                                    {session.status}
                                  </Text>
                                </View>

                                {!isCancelled ? (
                                  <Text style={styles.sessionPercentageText}>
                                    {session.percentage !== null ? `${session.percentage}%` : 'N/A'}
                                  </Text>
                                ) : null}
                              </View>
                            </View>

                            {isCancelled ? (
                              <View style={styles.cancellationBanner}>
                                <Text style={styles.cancellationText}>
                                  Reason: {session.cancellationReason || 'Class cancelled'} (Excluded from rate)
                                </Text>
                              </View>
                            ) : (
                              <View style={styles.sessionStatsBar}>
                                <Text style={styles.sessionStatItem}>
                                  <Text style={styles.sessionStatBold}>Present: </Text>
                                  {session.presentCount}
                                </Text>
                                <Text style={styles.statDivider}>|</Text>
                                <Text style={styles.sessionStatItem}>
                                  <Text style={styles.sessionStatBold}>Absent: </Text>
                                  {session.absentCount}
                                </Text>
                                <Text style={styles.statDivider}>|</Text>
                                <Text style={styles.sessionStatItem}>
                                  <Text style={styles.sessionStatBold}>Total: </Text>
                                  {session.totalStudents}
                                </Text>

                                <View style={styles.openDetailPill}>
                                  <Text style={styles.openDetailPillText}>Roster & Audit →</Text>
                                </View>
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </>
                ) : null}
              </>
            )}
          </View>
        ) : (
          /* ======================================================== */
          /* TAB 2: ASSIGNED CLASSES OVERVIEW                         */
          /* ======================================================== */
          <View style={styles.assignmentsSection}>
            {loadingClasses ? (
              <View style={styles.centerSection}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.loadingText}>Loading assigned classes...</Text>
              </View>
            ) : classSummaries.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No classes assigned</Text>
                <Text style={styles.emptySubtitle}>
                  You do not have any timetable assignments registered yet.
                </Text>
              </View>
            ) : (
              classSummaries.map((c) => (
                <View key={c.classId} style={styles.classCard}>
                  <View style={styles.classHeader}>
                    <Text style={styles.className}>{c.className}</Text>
                    <View style={styles.periodsBadge}>
                      <Text style={styles.periodsBadgeText}>{c.totalPeriods} weekly slots</Text>
                    </View>
                  </View>

                  <Text style={styles.subjectsLabel}>Subjects Taught:</Text>
                  {c.subjects.map((sub, idx) => (
                    <View key={idx} style={styles.subjectItem}>
                      <Text style={styles.bullet}>•</Text>
                      <Text style={styles.subjectName}>{sub.subjectName}</Text>
                      {sub.subjectCode ? (
                        <View style={styles.codePill}>
                          <Text style={styles.codePillText}>{sub.subjectCode}</Text>
                        </View>
                      ) : null}
                    </View>
                  ))}

                  <View style={styles.classCardActionRow}>
                    <TouchableOpacity
                      style={styles.viewReportBtn}
                      onPress={() => {
                        setSelectedClassId(c.classId);
                        setActiveScreenTab('REPORTS');
                      }}
                    >
                      <Text style={styles.viewReportBtnText}>View Attendance Report</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.openAttendanceBtn}
                      onPress={() => router.push('/(tabs)/attendance')}
                    >
                      <Text style={styles.openAttendanceBtnText}>Live Session</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Drill-down modal for student roster and audit corrections */}
      <SessionDetailModal
        visible={detailModalVisible}
        session={selectedSession}
        onClose={handleCloseSessionDetail}
        onCorrectionSuccess={handleCorrectionSuccess}
      />
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
    fontWeight: '800',
    color: Colors.primary,
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  screenSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
  viewModeToggleRow: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modeToggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  modeToggleBtnActive: {
    backgroundColor: Colors.tealLight,
    borderWidth: 1,
    borderColor: Colors.teal + '40',
  },
  modeToggleText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  modeToggleTextActive: {
    color: Colors.tealDark,
    fontWeight: '700',
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Colors.text,
    marginTop: 10,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  classChipsScroll: {
    flexDirection: 'row',
    marginBottom: 14,
  },
  classChip: {
    backgroundColor: Colors.card,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 10,
    minWidth: 110,
  },
  classChipActive: {
    backgroundColor: Colors.tealLight,
    borderColor: Colors.teal,
  },
  classChipText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: Colors.primary,
  },
  classChipTextActive: {
    color: Colors.tealDark,
  },
  classChipSub: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  classChipSubActive: {
    color: Colors.tealDark,
  },
  dateFilterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  dateFilterPill: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  dateFilterPillActive: {
    backgroundColor: Colors.teal,
    borderColor: Colors.teal,
  },
  dateFilterPillText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  dateFilterPillTextActive: {
    color: Colors.textInverse,
    fontWeight: 'bold',
  },
  dateRangeSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 14,
    fontStyle: 'italic',
  },
  metricsCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1.5,
  },
  metricsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  metricsClassTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.primary,
  },
  metricsClassSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  percentageBadgeContainer: {
    alignItems: 'center',
    backgroundColor: Colors.background,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  percentageBadgeLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  percentageBadgeVal: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.primary,
  },
  noDataWarningBox: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  noDataWarningTitle: {
    color: '#F59E0B',
    fontWeight: 'bold',
    fontSize: 13,
    marginBottom: 2,
  },
  noDataWarningText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 12,
  },
  metricGridItem: {
    alignItems: 'center',
    flex: 1,
  },
  metricGridVal: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.text,
  },
  metricGridLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  sessionsSectionHeader: {
    marginTop: 6,
    marginBottom: 10,
  },
  sessionCountSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  sessionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
  },
  sessionCardCancelled: {
    opacity: 0.85,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  sessionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  sessionHeaderLeft: {
    flex: 1,
    marginRight: 10,
  },
  sessionCardDate: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  sessionCardSubject: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.text,
    marginTop: 2,
  },
  sessionCardPeriod: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  sessionHeaderRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  sessionStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sessionBadgeCompleted: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  sessionBadgeCancelled: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: Colors.error,
  },
  sessionBadgeActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  sessionStatusText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  statusTextGreen: {
    color: Colors.primary,
  },
  statusTextRed: {
    color: Colors.error,
  },
  statusTextBlue: {
    color: '#3B82F6',
  },
  sessionPercentageText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Colors.text,
  },
  cancellationBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    padding: 8,
    borderRadius: 6,
    marginTop: 4,
  },
  cancellationText: {
    fontSize: 12,
    color: Colors.error,
    fontStyle: 'italic',
  },
  sessionStatsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginTop: 4,
  },
  sessionStatItem: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  sessionStatBold: {
    fontWeight: 'bold',
    color: Colors.text,
  },
  statDivider: {
    marginHorizontal: 8,
    color: Colors.border,
  },
  openDetailPill: {
    marginLeft: 'auto',
  },
  openDetailPillText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: 'bold',
  },
  emptySessionsCard: {
    backgroundColor: Colors.surface,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    marginVertical: 10,
  },
  emptySessionsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 4,
  },
  emptySessionsSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  reportsSection: {},
  assignmentsSection: {},
  cardLoadingBox: {
    backgroundColor: Colors.surface,
    padding: 30,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginVertical: 14,
  },
  centerSection: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  loadingText: {
    marginTop: 8,
    color: Colors.textSecondary,
    fontSize: 13,
  },
  emptyCard: {
    backgroundColor: Colors.surface,
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  classCard: {
    backgroundColor: Colors.surface,
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  classHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  className: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.text,
  },
  periodsBadge: {
    backgroundColor: Colors.background,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  periodsBadgeText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: 'bold',
  },
  subjectsLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  subjectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  bullet: {
    color: Colors.primary,
    fontSize: 16,
    marginRight: 6,
  },
  subjectName: {
    fontSize: 14,
    color: Colors.text,
    flex: 1,
  },
  codePill: {
    backgroundColor: Colors.background,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  codePillText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: 'bold',
  },
  classCardActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  viewReportBtn: {
    flex: 1,
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  viewReportBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
  },
  openAttendanceBtn: {
    backgroundColor: Colors.background,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  openAttendanceBtnText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  errorBox: {
    padding: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  errorText: {
    color: Colors.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },
  retryButton: {
    backgroundColor: Colors.error,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
