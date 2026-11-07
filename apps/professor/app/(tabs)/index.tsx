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
import { useAuth } from '../../store/AuthContext';
import Colors from '../../constants/Colors';
import { router } from 'expo-router';
import { TimetableEntry, AttendanceSession } from '@smart-attendance/shared';
import { timetableService } from '../../services/api/timetableService';
import { attendanceService } from '../../services/api/attendanceService';

function getTodayWeekdayInKolkata(): string {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
  }).toUpperCase();
}

function getTodayDateString(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
}

export default function HomeScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [todaySchedule, setTodaySchedule] = useState<TimetableEntry[]>([]);
  const [allTimetable, setAllTimetable] = useState<TimetableEntry[]>([]);
  const [activeSessions, setActiveSessions] = useState<AttendanceSession[]>([]);

  const todayDay = useMemo(() => getTodayWeekdayInKolkata(), []);

  const loadDashboardData = useCallback(async () => {
    try {
      setError(null);
      const todayDate = getTodayDateString();

      const [allEntries, sessions] = await Promise.all([
        timetableService.getMyTimetable(),
        attendanceService.getSessions({ date: todayDate }),
      ]);

      setAllTimetable(allEntries);

      // Filter for today
      const currentDay = getTodayWeekdayInKolkata();
      const filteredToday = allEntries
        .filter((entry) => entry.dayOfWeek === currentDay)
        .sort((a, b) => {
          if (a.periodStartTime && b.periodStartTime) {
            return a.periodStartTime.localeCompare(b.periodStartTime);
          }
          return (a.periodNumber || 0) - (b.periodNumber || 0);
        });

      setTodaySchedule(filteredToday);
      setActiveSessions(sessions.filter((s) => s.status === 'ACTIVE'));
    } catch (err: any) {
      console.error('Failed to load professor dashboard data:', err);
      setError(err?.message || 'Unable to load dashboard data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  }, [loadDashboardData]);

  // Unique assigned classes
  const assignedClassesCount = useMemo(() => {
    const classIds = new Set(allTimetable.map((t) => t.classId).filter(Boolean));
    return classIds.size;
  }, [allTimetable]);

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
        {/* Professor Identity Card */}
        <View style={styles.card}>
          <Text style={styles.name}>{user?.name || 'Professor'}</Text>
          <Text style={styles.detail}>
            {user?.staffCode ? `${user.staffCode} • ` : ''}
            {user?.collegeEmail || ''}
          </Text>

          <View style={styles.roleContainer}>
            {(user?.roles || ['STAFF']).map((r) => (
              <View key={r} style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>{r}</Text>
              </View>
            ))}
          </View>

          {/* Quick Metrics */}
          <View style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <Text style={styles.metricNumber}>{assignedClassesCount}</Text>
              <Text style={styles.metricLabel}>Assigned Classes</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricNumber}>{todaySchedule.length}</Text>
              <Text style={styles.metricLabel}>Classes Today</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={[styles.metricNumber, activeSessions.length > 0 && styles.activeNumber]}>
                {activeSessions.length}
              </Text>
              <Text style={styles.metricLabel}>Active Sessions</Text>
            </View>
          </View>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={loadDashboardData}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Live Active Attendance Banner (if active session running) */}
        {activeSessions.length > 0 ? (
          <View style={styles.activeBannerCard}>
            <View style={styles.activeHeaderRow}>
              <View style={styles.activeDot} />
              <Text style={styles.activeBannerTitle}>ATTENDANCE SESSION IN PROGRESS</Text>
            </View>
            <Text style={styles.activeBannerSubtitle}>
              {activeSessions[0].subjectName || 'Class Session'} • {activeSessions[0].className || ''}
            </Text>
            <TouchableOpacity
              style={styles.resumeButton}
              onPress={() => router.push('/(tabs)/attendance')}
            >
              <Text style={styles.resumeButtonText}>Open Live Attendance Scanner</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Today's Timetable Section */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Today's Schedule</Text>
          <Text style={styles.dayBadge}>{todayDay}</Text>
        </View>

        {loading ? (
          <View style={styles.centerSection}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading schedule...</Text>
          </View>
        ) : todaySchedule.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No classes scheduled for today.</Text>
            <Text style={styles.emptySubtitle}>
              Enjoy your day! Tap Timetable to view your complete weekly teaching schedule.
            </Text>
          </View>
        ) : (
          todaySchedule.map((entry) => (
            <View key={entry.id} style={styles.classCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.periodName}>{entry.periodName || 'Period'}</Text>
                <Text style={styles.time}>
                  {entry.periodStartTime && entry.periodEndTime
                    ? `${entry.periodStartTime} – ${entry.periodEndTime}`
                    : entry.periodStartTime || ''}
                </Text>
              </View>

              <Text style={styles.subject}>{entry.subjectName}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.classDetail}>{entry.className || 'Assigned Class'}</Text>
                {entry.subjectCode ? (
                  <View style={styles.codeBadge}>
                    <Text style={styles.codeText}>{entry.subjectCode}</Text>
                  </View>
                ) : null}
              </View>

              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => {
                  router.push('/(tabs)/attendance');
                }}
              >
                <Text style={styles.actionButtonText}>Start / Manage Attendance</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
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
  card: {
    backgroundColor: Colors.surface,
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 4,
  },
  detail: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  roleContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 16,
  },
  roleBadge: {
    backgroundColor: Colors.primary + '22',
    borderWidth: 1,
    borderColor: Colors.primary + '55',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  roleBadgeText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: 'bold',
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 14,
  },
  metricItem: {
    alignItems: 'center',
  },
  metricNumber: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.text,
  },
  activeNumber: {
    color: Colors.primary,
  },
  metricLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  metricDivider: {
    width: 1,
    height: 30,
    backgroundColor: Colors.border,
  },
  activeBannerCard: {
    backgroundColor: Colors.primary + '18',
    borderWidth: 1,
    borderColor: Colors.primary,
    padding: 16,
    borderRadius: 10,
    marginBottom: 20,
  },
  activeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  activeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
    marginRight: 8,
  },
  activeBannerTitle: {
    color: Colors.primary,
    fontWeight: 'bold',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  activeBannerSubtitle: {
    fontSize: 16,
    color: Colors.text,
    fontWeight: '600',
    marginBottom: 12,
  },
  resumeButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
  },
  resumeButtonText: {
    color: Colors.background,
    fontWeight: 'bold',
    fontSize: 14,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.text,
  },
  dayBadge: {
    fontSize: 12,
    fontWeight: 'bold',
    color: Colors.primary,
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  centerSection: {
    padding: 32,
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.textSecondary,
    marginTop: 10,
    fontSize: 14,
  },
  emptyCard: {
    backgroundColor: Colors.surface,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  classCard: {
    backgroundColor: Colors.surface,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  periodName: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  time: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  subject: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  classDetail: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  codeBadge: {
    backgroundColor: Colors.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  codeText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  actionButton: {
    backgroundColor: Colors.surface,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
  },
  actionButtonText: {
    color: Colors.primary,
    fontWeight: 'bold',
    fontSize: 14,
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
    marginBottom: 10,
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
});
