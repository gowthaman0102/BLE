import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
} from 'react-native';
import Colors from '../../constants/Colors';
import {
  AttendanceSession,
  StudentAttendanceHistoryItem,
  StudentAttendanceRecordStatus,
} from '@smart-attendance/shared';
import { attendanceService } from '../../services/api/attendanceService';
import { devActiveSessionFixture } from '../../services/dev/studentAttendanceFixture';
import NoSessionCard from '../../components/attendance/NoSessionCard';
import ActiveSessionCard from '../../components/attendance/ActiveSessionCard';

function formatHistoryDate(dateStr: string): string {
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      return d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

function formatMarkedTime(isoStr?: string | null): string | null {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return null;
  }
}

function getStatusBadgeConfig(status: StudentAttendanceHistoryItem['status']) {
  switch (status) {
    case 'PRESENT':
      return { label: 'PRESENT', bg: '#00E6761A', text: Colors.primary, border: Colors.primary };
    case 'LATE':
      return { label: 'LATE', bg: '#FFD7401A', text: Colors.warning, border: Colors.warning };
    case 'ABSENT':
      return { label: 'ABSENT', bg: '#FF52521A', text: Colors.error, border: Colors.error };
    case 'ON_DUTY':
      return { label: 'ON DUTY', bg: '#00E5FF1A', text: '#00E5FF', border: '#00E5FF' };
    case 'MANUAL':
      return { label: 'MANUAL', bg: '#00E6761A', text: Colors.primary, border: Colors.primary };
    default:
      return { label: status, bg: '#333333', text: Colors.textSecondary, border: Colors.border };
  }
}

export default function AttendanceScreen() {
  const [sessionLoading, setSessionLoading] = useState<boolean>(true);
  const [sessionError, setSessionError] = useState<boolean>(false);
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [initialRecord, setInitialRecord] = useState<StudentAttendanceRecordStatus | null>(null);

  const [historyLoading, setHistoryLoading] = useState<boolean>(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [history, setHistory] = useState<StudentAttendanceHistoryItem[]>([]);

  const [refreshing, setRefreshing] = useState<boolean>(false);

  const fetchSession = useCallback(async () => {
    try {
      setSessionError(false);
      const res = await attendanceService.getCurrentSession();
      setSession(res.session);
      setInitialRecord(res.record);
    } catch (error) {
      console.error('Failed to load active session:', error);
      setSessionError(true);
    } finally {
      setSessionLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      setHistoryError(null);
      const data = await attendanceService.getHistory();
      setHistory(data);
    } catch (error: any) {
      console.error('Failed to load attendance history:', error);
      setHistoryError(error?.message || 'Unable to load attendance history.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    setSessionLoading(true);
    setHistoryLoading(true);
    fetchSession();
    fetchHistory();
  }, [fetchSession, fetchHistory]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchSession(), fetchHistory()]);
    setRefreshing(false);
  }, [fetchSession, fetchHistory]);

  const renderSessionCard = () => {
    if (sessionLoading) {
      return (
        <View style={styles.cardLoading}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.loadingText}>Checking active attendance session...</Text>
        </View>
      );
    }

    if (sessionError) {
      return (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Unable to check active session.</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setSessionLoading(true);
              fetchSession();
            }}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (session) {
      return (
        <>
          {process.env.EXPO_PUBLIC_DEV_LOGIN_MODE === 'true' && (
            <View style={styles.devBanner}>
              <Text style={styles.devBannerText}>DEV PREVIEW</Text>
            </View>
          )}
          <ActiveSessionCard
            session={session}
            initialRecord={initialRecord}
            onAttendanceConfirmed={() => {
              fetchHistory();
            }}
          />
        </>
      );
    }

    return (
      <>
        <NoSessionCard />
        {process.env.EXPO_PUBLIC_DEV_LOGIN_MODE === 'true' && (
          <View style={styles.devPreviewCard}>
            <Text style={styles.devPreviewText}>
              DEV PREVIEW: No live classroom session is currently active in the database.
            </Text>
            <TouchableOpacity
              style={styles.devPreviewButton}
              onPress={() => setSession(devActiveSessionFixture)}
            >
              <Text style={styles.devPreviewButtonText}>Preview Active Session & BLE Flow</Text>
            </TouchableOpacity>
          </View>
        )}
      </>
    );
  };

  const renderHistoryContent = () => {
    if (historyLoading) {
      return (
        <View style={styles.centerSection}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading attendance history...</Text>
        </View>
      );
    }

    if (historyError) {
      return (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{historyError}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setHistoryLoading(true);
              fetchHistory();
            }}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (history.length === 0) {
      return (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No past records found</Text>
          <Text style={styles.emptySubtitle}>
            Completed attendance records will appear here once conducted.
          </Text>
        </View>
      );
    }

    return history.map((item) => {
      const badge = getStatusBadgeConfig(item.status);
      const markedTime = formatMarkedTime(item.markedAt);

      return (
        <View key={item.id} style={styles.historyCard}>
          {/* Top Row: Date and Status Badge */}
          <View style={styles.historyHeader}>
            <Text style={styles.historyDate}>{formatHistoryDate(item.sessionDate)}</Text>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: badge.bg, borderColor: badge.border },
              ]}
            >
              <Text style={[styles.statusBadgeText, { color: badge.text }]}>{badge.label}</Text>
            </View>
          </View>

          {/* Subject & Code */}
          <View style={styles.subjectRow}>
            <Text style={styles.subjectName}>{item.subjectName || 'Subject'}</Text>
            {item.subjectCode ? (
              <View style={styles.codeBadge}>
                <Text style={styles.codeText}>{item.subjectCode}</Text>
              </View>
            ) : null}
          </View>

          {/* Period & Time */}
          <View style={styles.detailsRow}>
            <Text style={styles.periodText}>
              {item.periodName || (item.periodNumber ? `Period ${item.periodNumber}` : 'Period')}
              {item.periodStartTime && item.periodEndTime
                ? ` • ${item.periodStartTime} – ${item.periodEndTime}`
                : item.periodStartTime
                ? ` • ${item.periodStartTime}`
                : ''}
            </Text>
          </View>

          {/* Faculty & Source Details */}
          <View style={styles.metaRow}>
            <Text style={styles.facultyText}>
              {item.staffName ? `Faculty: ${item.staffName}` : 'Faculty: Assigned Staff'}
            </Text>
            {item.source ? (
              <Text style={styles.sourceText}>
                {item.source === 'BLE' ? 'Via BLE' : 'Manual'}
                {markedTime ? ` at ${markedTime}` : ''}
              </Text>
            ) : markedTime ? (
              <Text style={styles.sourceText}>Marked at {markedTime}</Text>
            ) : null}
          </View>
        </View>
      );
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        <Text style={styles.screenTitle}>Attendance</Text>

        {/* Live Active Session Section */}
        {renderSessionCard()}

        {/* History Section Header */}
        <View style={styles.historySectionHeader}>
          <Text style={styles.sectionTitle}>Attendance History</Text>
          {!historyLoading && history.length > 0 && (
            <Text style={styles.countBadge}>{history.length} records</Text>
          )}
        </View>

        {/* History Records List */}
        {renderHistoryContent()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContainer: {
    padding: 16,
    flexGrow: 1,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 8,
  },
  historySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.text,
  },
  countBadge: {
    fontSize: 13,
    color: Colors.textSecondary,
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardLoading: {
    backgroundColor: Colors.surface,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
    minHeight: 120,
  },
  centerSection: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: Colors.textSecondary,
    fontSize: 14,
  },
  errorBox: {
    backgroundColor: Colors.surface,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  errorText: {
    color: Colors.error,
    fontSize: 15,
    marginBottom: 12,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: Colors.background,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  retryText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: Colors.surface,
    padding: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  historyCard: {
    backgroundColor: Colors.surface,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  historyDate: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  subjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  subjectName: {
    fontSize: 17,
    fontWeight: 'bold',
    color: Colors.text,
    flex: 1,
  },
  codeBadge: {
    backgroundColor: Colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginLeft: 8,
  },
  codeText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  detailsRow: {
    marginBottom: 8,
  },
  periodText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border + '66',
    paddingTop: 8,
    marginTop: 2,
  },
  facultyText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  sourceText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '500',
  },
  devBanner: {
    backgroundColor: Colors.warning + '33',
    padding: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.warning,
    alignItems: 'center',
    marginBottom: 8,
  },
  devBannerText: {
    color: Colors.warning,
    fontWeight: 'bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  devPreviewCard: {
    backgroundColor: Colors.surface,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.warning + '66',
    marginVertical: 12,
    alignItems: 'center',
  },
  devPreviewText: {
    color: Colors.warning,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
  },
  devPreviewButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 6,
  },
  devPreviewButtonText: {
    color: Colors.background,
    fontWeight: 'bold',
    fontSize: 13,
  },
});
