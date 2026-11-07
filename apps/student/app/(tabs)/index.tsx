import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { useAuth } from '../../store/AuthContext';
import Colors from '../../constants/Colors';
import { TimetableEntry, StudentAttendanceSummary, TodayAttendanceStatus } from '@smart-attendance/shared';
import { timetableService } from '../../services/api/timetableService';
import { attendanceService } from '../../services/api/attendanceService';

function getTodayDayOfWeekInKolkata(): string {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
  }).toUpperCase();
}

function formatTodayStatus(status?: TodayAttendanceStatus): { label: string; color: string } {
  switch (status) {
    case 'PRESENT':
      return { label: 'Marked Present', color: Colors.primary };
    case 'LATE':
      return { label: 'Marked Late', color: Colors.warning };
    case 'ON_DUTY':
      return { label: 'On Duty', color: Colors.primary };
    case 'IN_PROGRESS':
      return { label: 'Attendance Active', color: Colors.primary };
    case 'ABSENT':
      return { label: 'Absent', color: Colors.error };
    case 'NOT_STARTED':
      return { label: 'Not Started', color: Colors.warning };
    case 'NO_SESSION':
    default:
      return { label: 'No Sessions Scheduled', color: Colors.textSecondary };
  }
}

export default function HomeScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [todayTimetable, setTodayTimetable] = useState<TimetableEntry[]>([]);
  const [summary, setSummary] = useState<StudentAttendanceSummary | null>(null);

  const todayDay = useMemo(() => getTodayDayOfWeekInKolkata(), []);

  const loadHomeData = useCallback(async () => {
    try {
      setError(null);
      const [allTimetable, attendanceSummary] = await Promise.all([
        timetableService.getMyTimetable(),
        attendanceService.getSummary(),
      ]);

      // Filter flat timetable array by today's day of week in Asia/Kolkata timezone
      const currentDay = getTodayDayOfWeekInKolkata();
      const filteredToday = allTimetable
        .filter((entry) => entry.dayOfWeek === currentDay)
        .sort((a, b) => {
          if (a.periodStartTime && b.periodStartTime) {
            return a.periodStartTime.localeCompare(b.periodStartTime);
          }
          return (a.periodNumber || 0) - (b.periodNumber || 0);
        });

      setTodayTimetable(filteredToday);
      setSummary(attendanceSummary);
    } catch (err: any) {
      console.error('Failed to load dashboard data:', err);
      setError(err?.message || 'Unable to load dashboard data. Please pull to refresh.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHomeData();
  }, [loadHomeData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadHomeData();
    setRefreshing(false);
  }, [loadHomeData]);

  const todayStatusInfo = formatTodayStatus(summary?.today?.status);

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
        {/* Student Profile Identity Card */}
        <View style={styles.card}>
          <Text style={styles.name}>{user?.name || 'Student'}</Text>
          <Text style={styles.detail}>{user?.registerNumber}</Text>
          <Text style={styles.detail}>{user?.className || 'Class not assigned'}</Text>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => { setLoading(true); loadHomeData(); }}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Today's Timetable Section */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Today's Timetable</Text>
          <Text style={styles.dayBadge}>{todayDay}</Text>
        </View>

        <View style={styles.card}>
          {loading ? (
            <View style={styles.centerSmall}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.loadingText}>Loading schedule...</Text>
            </View>
          ) : todayTimetable.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No classes scheduled for today.</Text>
            </View>
          ) : (
            todayTimetable.map((entry) => (
              <View key={entry.id} style={styles.periodRow}>
                <View style={styles.periodLeft}>
                  <Text style={styles.periodBadgeText}>{entry.periodName || 'P'}</Text>
                  <Text style={styles.time}>
                    {entry.periodStartTime && entry.periodEndTime
                      ? `${entry.periodStartTime} – ${entry.periodEndTime}`
                      : entry.periodStartTime || ''}
                  </Text>
                </View>
                <View style={styles.periodCenter}>
                  <Text style={styles.subject}>{entry.subjectName}</Text>
                  <Text style={styles.staff}>{entry.staffName || 'Faculty'}</Text>
                </View>
                {entry.subjectCode ? (
                  <View style={styles.codeBadge}>
                    <Text style={styles.codeText}>{entry.subjectCode}</Text>
                  </View>
                ) : null}
              </View>
            ))
          )}
        </View>

        {/* Attendance Summary Section */}
        <Text style={styles.sectionTitle}>Attendance Summary</Text>
        <View style={styles.card}>
          {loading ? (
            <View style={styles.centerSmall}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.loadingText}>Loading attendance summary...</Text>
            </View>
          ) : (
            <>
              {/* Overall Attendance */}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Overall Attendance</Text>
                {summary?.overall.hasData ? (
                  <View style={styles.summaryValueContainer}>
                    <Text style={styles.highlight}>{summary.overall.percentage}%</Text>
                    <Text style={styles.subDetail}>
                      {summary.overall.attendedSessions} of {summary.overall.totalSessions} sessions attended
                    </Text>
                  </View>
                ) : (
                  <View style={styles.summaryValueContainer}>
                    <Text style={[styles.highlight, { color: Colors.textSecondary }]}>No Data</Text>
                    <Text style={styles.subDetail}>No completed sessions recorded yet</Text>
                  </View>
                )}
              </View>

              <View style={styles.divider} />

              {/* Today's Attendance */}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Today's Attendance</Text>
                <View style={styles.summaryValueContainer}>
                  <Text style={[styles.highlight, { color: todayStatusInfo.color }]}>
                    {todayStatusInfo.label}
                  </Text>
                  {summary?.today.sessionName ? (
                    <Text style={styles.subDetail}>
                      {summary.today.sessionName}
                      {summary.today.periodTime ? ` • ${summary.today.periodTime}` : ''}
                    </Text>
                  ) : null}
                </View>
              </View>
            </>
          )}
        </View>
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
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: 16,
    flexGrow: 1,
  },
  card: {
    backgroundColor: Colors.surface,
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 4,
  },
  detail: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 10,
  },
  dayBadge: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: 'bold',
    backgroundColor: Colors.primary + '22',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.primary + '55',
    marginBottom: 10,
  },
  highlight: {
    color: Colors.primary,
    fontWeight: 'bold',
    fontSize: 18,
  },
  subDetail: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  summaryRow: {
    paddingVertical: 6,
  },
  summaryLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 4,
    fontWeight: '500',
  },
  summaryValueContainer: {
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 10,
  },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  periodLeft: {
    width: 100,
  },
  periodBadgeText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: 'bold',
  },
  time: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  periodCenter: {
    flex: 1,
    paddingHorizontal: 8,
  },
  subject: {
    color: Colors.text,
    fontWeight: 'bold',
    fontSize: 15,
  },
  staff: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  codeBadge: {
    backgroundColor: Colors.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  codeText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  centerSmall: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 8,
    color: Colors.textSecondary,
    fontSize: 13,
  },
  emptyContainer: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontStyle: 'italic',
  },
  errorCard: {
    backgroundColor: Colors.error + '22',
    borderWidth: 1,
    borderColor: Colors.error,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    color: Colors.error,
    fontSize: 13,
    flex: 1,
  },
  retryButton: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    marginLeft: 8,
  },
  retryButtonText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
});
