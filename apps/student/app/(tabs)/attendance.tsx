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
  StatusBar,
} from 'react-native';
import Colors from '../../constants/Colors';
import {
  AttendanceSession,
  StudentAttendanceHistoryItem,
  StudentAttendanceRecordStatus,
} from '@smart-attendance/shared';
import { attendanceService } from '../../services/api/attendanceService';
import NoSessionCard from '../../components/attendance/NoSessionCard';
import ActiveSessionCard from '../../components/attendance/ActiveSessionCard';
import { Card, SectionHeader, StatusBadge, EmptyState, ErrorState } from '../../components/ui';
import { Ionicons } from '@expo/vector-icons';

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

function getStatusBadgeConfig(status: StudentAttendanceHistoryItem['status']): {
  label: string;
  type: 'success' | 'warning' | 'error' | 'info' | 'neutral';
} {
  switch (status) {
    case 'PRESENT':
      return { label: 'PRESENT', type: 'success' };
    case 'LATE':
      return { label: 'LATE', type: 'warning' };
    case 'ABSENT':
      return { label: 'ABSENT', type: 'error' };
    case 'ON_DUTY':
      return { label: 'ON DUTY', type: 'info' };
    case 'MANUAL':
      return { label: 'MANUAL', type: 'success' };
    default:
      return { label: status, type: 'neutral' };
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
        <Card style={styles.cardLoading}>
          <ActivityIndicator size="small" color={Colors.teal} />
          <Text style={styles.loadingText}>Checking active classroom session...</Text>
        </Card>
      );
    }

    if (sessionError) {
      return (
        <ErrorState
          message="Unable to verify active session status."
          onRetry={() => {
            setSessionLoading(true);
            fetchSession();
          }}
        />
      );
    }

    if (session) {
      return (
        <ActiveSessionCard
          session={session}
          initialRecord={initialRecord}
          onAttendanceConfirmed={() => {
            fetchHistory();
          }}
        />
      );
    }

    return <NoSessionCard />;
  };

  const renderHistoryContent = () => {
    if (historyLoading) {
      return (
        <Card style={styles.centerSection}>
          <ActivityIndicator size="small" color={Colors.teal} />
          <Text style={styles.loadingText}>Loading attendance history...</Text>
        </Card>
      );
    }

    if (historyError) {
      return (
        <ErrorState
          message={historyError}
          onRetry={() => {
            setHistoryLoading(true);
            fetchHistory();
          }}
        />
      );
    }

    if (history.length === 0) {
      return (
        <Card>
          <EmptyState
            icon="document-text-outline"
            title="No Attendance Records"
            description="Completed attendance records for this semester will be listed here."
          />
        </Card>
      );
    }

    return history.map((item) => {
      const badge = getStatusBadgeConfig(item.status);
      const markedTime = formatMarkedTime(item.markedAt);

      return (
        <Card key={item.id} style={styles.historyCard}>
          {/* Top Row: Date and Status Badge */}
          <View style={styles.historyHeader}>
            <View style={styles.dateRow}>
              <Ionicons name="calendar-outline" size={14} color={Colors.textSecondary} style={{ marginRight: 5 }} />
              <Text style={styles.historyDate}>{formatHistoryDate(item.sessionDate)}</Text>
            </View>
            <StatusBadge status={badge.label} type={badge.type} />
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
            <Ionicons name="time-outline" size={13} color={Colors.textMuted} style={{ marginRight: 4 }} />
            <Text style={styles.periodText}>
              {item.periodName || (item.periodNumber ? `Period ${item.periodNumber}` : 'Period')}
              {item.periodStartTime && item.periodEndTime
                ? ` (${item.periodStartTime} – ${item.periodEndTime})`
                : item.periodStartTime
                ? ` (${item.periodStartTime})`
                : ''}
            </Text>
          </View>

          {/* Faculty & Source Details */}
          <View style={styles.metaRow}>
            <Text style={styles.facultyText} numberOfLines={1}>
              {item.staffName ? `Faculty: ${item.staffName}` : 'Faculty: Department Staff'}
            </Text>
            {item.source ? (
              <Text style={styles.sourceText}>
                {item.source === 'BLE' ? 'Verified BLE' : 'Manual'}
                {markedTime ? ` • ${markedTime}` : ''}
              </Text>
            ) : markedTime ? (
              <Text style={styles.sourceText}>Marked at {markedTime}</Text>
            ) : null}
          </View>
        </Card>
      );
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.card} />
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.teal}
            colors={[Colors.teal]}
          />
        }
      >
        {/* Active Session Section */}
        <SectionHeader title="Active Classroom Session" badge="Live Presence" />
        {renderSessionCard()}

        {/* History Section */}
        <SectionHeader
          title="Past Attendance Records"
          badge={`${history.length} Records`}
          style={{ marginTop: 12 }}
        />
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
    paddingBottom: 32,
  },
  cardLoading: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  centerSection: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 13,
  },
  historyCard: {
    marginBottom: 10,
    padding: 14,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyDate: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  subjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  subjectName: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  codeBadge: {
    backgroundColor: Colors.indigoLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  codeText: {
    color: Colors.indigo,
    fontSize: 11,
    fontWeight: '700',
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  periodText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  facultyText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  sourceText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
});
