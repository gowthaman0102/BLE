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
  StatusBar,
} from 'react-native';
import { useAuth } from '../../store/AuthContext';
import Colors from '../../constants/Colors';
import { router } from 'expo-router';
import { TimetableEntry, AttendanceSession } from '@smart-attendance/shared';
import { timetableService } from '../../services/api/timetableService';
import { attendanceService } from '../../services/api/attendanceService';
import { Card, SectionHeader, StatusBadge, MetricCard, EmptyState, ErrorState, PrimaryButton } from '../../components/ui';
import { Ionicons } from '@expo/vector-icons';

function getTodayWeekdayInKolkata(): string {
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

function getTodayDateString(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
}

function getInitials(name?: string): string {
  if (!name) return 'F';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export default function HomeScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [timetableError, setTimetableError] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [todaySchedule, setTodaySchedule] = useState<TimetableEntry[]>([]);
  const [allTimetable, setAllTimetable] = useState<TimetableEntry[]>([]);
  const [activeSessions, setActiveSessions] = useState<AttendanceSession[]>([]);

  const todayDay = useMemo(() => getTodayWeekdayInKolkata(), []);
  const formattedDate = useMemo(() => getFormattedDate(), []);

  const loadDashboardData = useCallback(async () => {
    try {
      setError(null);
      setTimetableError(null);
      setSessionsError(null);
      const todayDate = getTodayDateString();

      const [timetableRes, sessionsRes] = await Promise.allSettled([
        timetableService.getMyTimetable(),
        attendanceService.getSessions({ date: todayDate }),
      ]);

      let hadSuccess = false;

      // 1. Process Timetable
      if (timetableRes.status === 'fulfilled') {
        const allEntries = timetableRes.value;
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
        hadSuccess = true;
      } else {
        const msg = timetableRes.reason?.message || 'Unable to load teaching timetable.';
        setTimetableError(msg);
      }

      // 2. Process Sessions
      if (sessionsRes.status === 'fulfilled') {
        const sessions = sessionsRes.value;
        setActiveSessions(sessions.filter((s) => s.status === 'ACTIVE'));
        hadSuccess = true;
      } else {
        const msg = sessionsRes.reason?.message || 'Unable to load attendance sessions.';
        setSessionsError(msg);
      }

      // If all calls failed, trigger global error
      if (!hadSuccess) {
        const primaryErr =
          (timetableRes.status === 'rejected' && timetableRes.reason?.message) ||
          (sessionsRes.status === 'rejected' && sessionsRes.reason?.message) ||
          'Unable to load faculty dashboard data.';
        setError(primaryErr);
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to load dashboard data. Please pull to refresh.');
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

  const assignedClassesCount = useMemo(() => {
    const classIds = new Set(allTimetable.map((t) => t.classId).filter(Boolean));
    return classIds.size;
  }, [allTimetable]);

  const primaryRole = user?.roles?.[0] || 'FACULTY';
  const roleDisplay = primaryRole === 'DEPUTY_HOD' ? 'Deputy HOD' : primaryRole === 'CLASS_COUNSELOR' ? 'Class Counselor' : primaryRole === 'ADMIN' ? 'Administrator' : 'Faculty Member';

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
        {/* Professor Profile Greeting Card */}
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.greetingText}>Faculty Session Active</Text>
              <Text style={styles.professorName} numberOfLines={1}>
                {user?.name || 'Faculty Member'}
              </Text>
              <View style={styles.roleMetaRow}>
                <View style={styles.roleBadge}>
                  <Text style={styles.roleBadgeText}>{roleDisplay}</Text>
                </View>
                <View style={styles.metaChip}>
                  <Text style={styles.metaChipText}>{user?.collegeEmail || ''}</Text>
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
            <StatusBadge
              status={activeSessions.length > 0 ? `${activeSessions.length} Active Session` : 'No Live Session'}
              type={activeSessions.length > 0 ? 'success' : 'neutral'}
            />
          </View>
        </Card>

        {/* Active Session Action Banner */}
        {activeSessions.length > 0 ? (
          <TouchableOpacity
            style={styles.activeSessionBanner}
            onPress={() => router.push('/(tabs)/attendance')}
            activeOpacity={0.85}
          >
            <View style={styles.activeBannerIconWrap}>
              <Ionicons name="radio" size={20} color={Colors.tealDark} />
            </View>
            <View style={styles.activeBannerContent}>
              <Text style={styles.activeBannerTitle}>Active Attendance In Progress</Text>
              <Text style={styles.activeBannerSubtitle}>
                {activeSessions[0].subjectName} • {activeSessions[0].className || 'Classroom'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.tealDark} />
          </TouchableOpacity>
        ) : null}

        {error ? <ErrorState message={error} onRetry={() => { setLoading(true); loadDashboardData(); }} /> : null}

        {/* Operational Overview Metrics */}
        <SectionHeader title="Operational Metrics" badge="Semester Scope" />
        <View style={styles.metricRow}>
          <MetricCard
            label="Assigned Classes"
            value={timetableError ? '!' : assignedClassesCount}
            subtitle={timetableError ? 'Unable to load' : 'Academic Sections'}
            icon="school-outline"
            color={timetableError ? Colors.error : Colors.teal}
          />
          <MetricCard
            label="Today's Classes"
            value={timetableError ? '!' : todaySchedule.length}
            subtitle={timetableError ? 'Unable to load' : `${todayDay.slice(0, 3)} Teaching Schedule`}
            icon="calendar-outline"
            color={timetableError ? Colors.error : Colors.indigo}
          />
        </View>

        {/* Today's Teaching Schedule */}
        <SectionHeader
          title="Today's Teaching Schedule"
          badge={todayDay}
          actionText="Open Timetable"
          onAction={() => router.push('/(tabs)/timetable')}
        />

        <Card style={styles.scheduleCard}>
          {loading ? (
            <View style={styles.centerSmall}>
              <ActivityIndicator size="small" color={Colors.teal} />
              <Text style={styles.loadingText}>Loading today's classes...</Text>
            </View>
          ) : timetableError ? (
            <ErrorState
              message={timetableError}
              onRetry={() => {
                setLoading(true);
                loadDashboardData();
              }}
            />
          ) : todaySchedule.length === 0 ? (
            <EmptyState
              icon="calendar-outline"
              title="No Classes Today"
              description={`You have no assigned teaching periods scheduled on ${todayDay.toLowerCase()}.`}
            />
          ) : (
            todaySchedule.map((entry, index) => {
              const isLast = index === todaySchedule.length - 1;
              return (
                <View key={entry.id || index} style={[styles.periodItem, !isLast && styles.periodDivider]}>
                  <View style={styles.periodTimeCol}>
                    <Text style={styles.periodTimeText}>
                      {entry.periodStartTime || `P${entry.periodNumber || index + 1}`}
                    </Text>
                    {entry.periodEndTime ? (
                      <Text style={styles.periodEndTimeText}>{entry.periodEndTime}</Text>
                    ) : null}
                  </View>

                  <View style={styles.periodDetailsCol}>
                    <View style={styles.periodHeaderRow}>
                      <Text style={styles.subjectNameText} numberOfLines={1}>
                        {entry.subjectName || 'Teaching Period'}
                      </Text>
                      {entry.subjectCode ? (
                        <View style={styles.codeTag}>
                          <Text style={styles.codeTagText}>{entry.subjectCode}</Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.periodMetaRow}>
                      <View style={styles.metaWithIcon}>
                        <Ionicons name="people-outline" size={13} color={Colors.textSecondary} style={{ marginRight: 4 }} />
                        <Text style={styles.metaClassText}>{entry.className || 'Assigned Class'}</Text>
                      </View>
                      <View style={styles.metaWithIcon}>
                        <Ionicons name="location-outline" size={13} color={Colors.textMuted} style={{ marginRight: 3 }} />
                        <Text style={styles.metaRoomText}>Assigned Hall</Text>
                      </View>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.sessionActionBtn}
                    onPress={() => router.push('/(tabs)/attendance')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="radio-outline" size={18} color={Colors.teal} />
                  </TouchableOpacity>
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
    fontSize: 12,
    color: Colors.teal,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  professorName: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  roleMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  roleBadge: {
    backgroundColor: Colors.tealLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.tealDark,
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
  periodMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  metaWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaClassText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  metaRoomText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  sessionActionBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: Colors.tealLight,
    marginLeft: 8,
  },
});
