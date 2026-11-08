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
  StatusBar,
} from 'react-native';
import { useAuth } from '../../store/AuthContext';
import Colors from '../../constants/Colors';
import { TimetableEntry, StudentAttendanceSummary, TodayAttendanceStatus } from '@smart-attendance/shared';
import { timetableService } from '../../services/api/timetableService';
import { attendanceService } from '../../services/api/attendanceService';
import { Card, SectionHeader, StatusBadge, MetricCard, ErrorState, EmptyState } from '../../components/ui';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

function getTodayDayOfWeekInKolkata(): string {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
  }).toUpperCase();
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function getInitials(name?: string): string {
  if (!name) return 'S';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

function formatTodayStatus(status?: TodayAttendanceStatus): { label: string; type: 'success' | 'warning' | 'error' | 'info' | 'neutral' } {
  switch (status) {
    case 'PRESENT':
      return { label: 'Marked Present', type: 'success' };
    case 'LATE':
      return { label: 'Marked Late', type: 'warning' };
    case 'ON_DUTY':
      return { label: 'On Duty', type: 'info' };
    case 'IN_PROGRESS':
      return { label: 'Active Session', type: 'info' };
    case 'ABSENT':
      return { label: 'Marked Absent', type: 'error' };
    case 'NOT_STARTED':
      return { label: 'Not Started', type: 'warning' };
    case 'NO_SESSION':
    default:
      return { label: 'No Class Scheduled', type: 'neutral' };
  }
}

export default function HomeScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [todayTimetable, setTodayTimetable] = useState<TimetableEntry[]>([]);
  const [summary, setSummary] = useState<StudentAttendanceSummary | null>(null);
  const [hasActiveSession, setHasActiveSession] = useState<boolean>(false);

  const todayDay = useMemo(() => getTodayDayOfWeekInKolkata(), []);
  const formattedDate = useMemo(() => getFormattedDate(), []);

  const loadHomeData = useCallback(async () => {
    try {
      setError(null);
      const [allTimetable, attendanceSummary, activeRes] = await Promise.all([
        timetableService.getMyTimetable().catch(() => []),
        attendanceService.getSummary().catch(() => null),
        attendanceService.getCurrentSession().catch(() => ({ session: null })),
      ]);

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
      setHasActiveSession(!!activeRes?.session);
    } catch (err: any) {
      setError(err?.message || 'Unable to refresh dashboard data.');
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

  const todayStatus = formatTodayStatus(summary?.today?.status);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.card} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.teal}
            colors={[Colors.teal]}
          />
        }
      >
        {/* Student Profile Greeting Header */}
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.greetingText}>Welcome back,</Text>
              <Text style={styles.studentName} numberOfLines={1}>
                {user?.name || 'Student'}
              </Text>
              <View style={styles.studentMetaRow}>
                <View style={styles.metaChip}>
                  <Text style={styles.metaChipText}>{user?.registerNumber || 'Reg No'}</Text>
                </View>
                <View style={styles.metaChip}>
                  <Text style={styles.metaChipText}>{user?.className || 'Assigned Class'}</Text>
                </View>
              </View>
            </View>
            <View style={styles.avatarWrap}>
              <Text style={styles.avatarText}>{getInitials(user?.name)}</Text>
            </View>
          </View>
          <View style={styles.headerFooter}>
            <View style={styles.dateWrap}>
              <Ionicons name="calendar-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.dateText}>{formattedDate} • {todayDay}</Text>
            </View>
            <StatusBadge status={todayStatus.label} type={todayStatus.type} />
          </View>
        </Card>

        {/* Live Attendance Alert Banner (when session is active) */}
        {hasActiveSession ? (
          <TouchableOpacity
            style={styles.activeSessionBanner}
            onPress={() => router.push('/(tabs)/attendance')}
            activeOpacity={0.85}
          >
            <View style={styles.activeBannerIconWrap}>
              <Ionicons name="radio" size={20} color={Colors.tealDark} />
            </View>
            <View style={styles.activeBannerContent}>
              <Text style={styles.activeBannerTitle}>Active Classroom Session</Text>
              <Text style={styles.activeBannerSubtitle}>Attendance beacon is broadcasting. Tap to verify.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.tealDark} />
          </TouchableOpacity>
        ) : null}

        {error ? <ErrorState message={error} onRetry={() => { setLoading(true); loadHomeData(); }} /> : null}

        {/* Attendance Summary Metric Cards */}
        <SectionHeader title="Attendance Metrics" badge="Academic Year" />
        <View style={styles.metricRow}>
          <MetricCard
            label="Overall Attendance"
            value={summary?.overall.hasData ? `${summary.overall.percentage}%` : 'N/A'}
            subtitle={
              summary?.overall.hasData
                ? `${summary.overall.attendedSessions} of ${summary.overall.totalSessions} sessions`
                : 'No sessions yet'
            }
            icon="analytics-outline"
            color={Colors.teal}
          />
          <MetricCard
            label="Attended Periods"
            value={summary?.overall.hasData ? summary.overall.attendedSessions : 0}
            subtitle={summary?.overall.hasData ? `Present in classes` : 'Awaiting data'}
            icon="checkmark-done-circle-outline"
            color={Colors.indigo}
          />
        </View>

        {/* Today's Schedule Section */}
        <SectionHeader
          title="Today's Timetable"
          badge={todayDay}
          actionText="View Full Week"
          onAction={() => router.push('/(tabs)/timetable')}
        />

        <Card style={styles.scheduleCard}>
          {loading ? (
            <View style={styles.centerSmall}>
              <ActivityIndicator size="small" color={Colors.teal} />
              <Text style={styles.loadingText}>Loading today's schedule...</Text>
            </View>
          ) : todayTimetable.length === 0 ? (
            <EmptyState
              icon="calendar-outline"
              title="No Classes Scheduled"
              description={`There are no timetable periods scheduled for ${todayDay.toLowerCase()}.`}
            />
          ) : (
            todayTimetable.map((entry, index) => {
              const isLast = index === todayTimetable.length - 1;
              return (
                <View key={entry.id || index} style={[styles.periodItem, !isLast && styles.periodDivider]}>
                  <View style={styles.periodTimeCol}>
                    <Text style={styles.periodTimeText}>
                      {entry.periodStartTime || 'P' + (entry.periodNumber || index + 1)}
                    </Text>
                    {entry.periodEndTime ? (
                      <Text style={styles.periodEndTimeText}>{entry.periodEndTime}</Text>
                    ) : null}
                  </View>

                  <View style={styles.periodDetailsCol}>
                    <View style={styles.periodHeaderRow}>
                      <Text style={styles.subjectNameText} numberOfLines={1}>
                        {entry.subjectName || 'Scheduled Class'}
                      </Text>
                      {entry.subjectCode ? (
                        <View style={styles.codeTag}>
                          <Text style={styles.codeTagText}>{entry.subjectCode}</Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.facultyMetaRow}>
                      <Ionicons name="person-circle-outline" size={14} color={Colors.textSecondary} />
                      <Text style={styles.facultyText} numberOfLines={1}>
                        {entry.staffName || 'Faculty not assigned'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </Card>
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
    paddingBottom: 32,
  },
  headerCard: {
    padding: 20,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flex: 1,
    marginRight: 12,
  },
  greetingText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
    marginBottom: 2,
  },
  studentName: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  studentMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaChip: {
    backgroundColor: Colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  metaChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  avatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: Colors.tealLight,
    borderWidth: 1,
    borderColor: Colors.teal + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.tealDark,
  },
  headerFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  dateWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  activeSessionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.tealLight,
    borderWidth: 1,
    borderColor: Colors.teal + '40',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  activeBannerIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  activeBannerContent: {
    flex: 1,
  },
  activeBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.tealDark,
    marginBottom: 2,
  },
  activeBannerSubtitle: {
    fontSize: 12,
    color: Colors.tealDark,
    opacity: 0.85,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  scheduleCard: {
    padding: 0,
    overflow: 'hidden',
  },
  centerSmall: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  periodItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  periodDivider: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  periodTimeCol: {
    width: 72,
    marginRight: 14,
  },
  periodTimeText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  periodEndTimeText: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  periodDetailsCol: {
    flex: 1,
  },
  periodHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  subjectNameText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
    flex: 1,
    marginRight: 8,
  },
  codeTag: {
    backgroundColor: Colors.indigoLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  codeTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.indigo,
  },
  facultyMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  facultyText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
});
