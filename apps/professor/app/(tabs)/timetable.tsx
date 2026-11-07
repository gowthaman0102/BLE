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
import { TimetableEntry } from '@smart-attendance/shared';
import { timetableService } from '../../services/api/timetableService';

const DAYS_OF_WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

function getInitialDay(): string {
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const day = days[new Date().getDay()];
  return day === 'SUNDAY' ? 'MONDAY' : day;
}

export default function TimetableScreen() {
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>(getInitialDay());

  const fetchTimetable = useCallback(async () => {
    try {
      setError(null);
      const data = await timetableService.getMyTimetable();
      setEntries(data);
    } catch (err: any) {
      console.error('Failed to load professor timetable:', err);
      setError(err?.message || 'Unable to load timetable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTimetable();
  }, [fetchTimetable]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTimetable();
    setRefreshing(false);
  }, [fetchTimetable]);

  const groupedByDay = useMemo(() => {
    const map: Record<string, TimetableEntry[]> = {};
    for (const day of DAYS_OF_WEEK) {
      map[day] = entries
        .filter((e) => e.dayOfWeek === day)
        .sort((a, b) => {
          if (a.periodStartTime && b.periodStartTime) {
            return a.periodStartTime.localeCompare(b.periodStartTime);
          }
          return (a.periodNumber || 0) - (b.periodNumber || 0);
        });
    }
    return map;
  }, [entries]);

  const daysToShow = useMemo(() => {
    if (selectedDay === 'ALL') {
      return DAYS_OF_WEEK.filter((day) => (groupedByDay[day]?.length || 0) > 0);
    }
    return [selectedDay];
  }, [selectedDay, groupedByDay]);

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
        <Text style={styles.screenTitle}>Teaching Timetable</Text>

        {/* Day Selector Pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillsScroll}>
          <TouchableOpacity
            style={[styles.pill, selectedDay === 'ALL' && styles.pillActive]}
            onPress={() => setSelectedDay('ALL')}
          >
            <Text style={[styles.pillText, selectedDay === 'ALL' && styles.pillTextActive]}>
              All Days
            </Text>
          </TouchableOpacity>

          {DAYS_OF_WEEK.map((day) => {
            const count = groupedByDay[day]?.length || 0;
            const isSelected = selectedDay === day;
            return (
              <TouchableOpacity
                key={day}
                style={[styles.pill, isSelected && styles.pillActive]}
                onPress={() => setSelectedDay(day)}
              >
                <Text style={[styles.pillText, isSelected && styles.pillTextActive]}>
                  {day.slice(0, 3)} {count > 0 ? `(${count})` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={fetchTimetable}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centerSection}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading timetable...</Text>
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No teaching periods assigned</Text>
            <Text style={styles.emptySubtitle}>
              Contact your academic coordinator or HOD to configure your timetable assignments.
            </Text>
          </View>
        ) : (
          daysToShow.map((day) => {
            const dayEntries = groupedByDay[day] || [];
            return (
              <View key={day} style={styles.daySection}>
                <View style={styles.dayHeaderRow}>
                  <Text style={styles.dayTitle}>{day}</Text>
                  <Text style={styles.dayCount}>{dayEntries.length} periods</Text>
                </View>

                {dayEntries.length === 0 ? (
                  <View style={styles.emptyDayCard}>
                    <Text style={styles.emptyDayText}>No classes scheduled for {day}</Text>
                  </View>
                ) : (
                  dayEntries.map((entry) => (
                    <View key={entry.id} style={styles.card}>
                      <View style={styles.cardHeader}>
                        <Text style={styles.periodBadge}>{entry.periodName || 'Period'}</Text>
                        <Text style={styles.time}>
                          {entry.periodStartTime && entry.periodEndTime
                            ? `${entry.periodStartTime} – ${entry.periodEndTime}`
                            : entry.periodStartTime || ''}
                        </Text>
                      </View>

                      <View style={styles.subjectRow}>
                        <Text style={styles.subject}>{entry.subjectName}</Text>
                        {entry.subjectCode ? (
                          <View style={styles.codeBadge}>
                            <Text style={styles.codeText}>{entry.subjectCode}</Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.metaRow}>
                        <Text style={styles.classDetail}>Class: {entry.className || 'Assigned Class'}</Text>
                        <Text style={styles.roomDetail}>Room: A-204</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            );
          })
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
    paddingBottom: 40,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 12,
  },
  pillsScroll: {
    marginBottom: 16,
  },
  pill: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pillActive: {
    backgroundColor: Colors.primary + '22',
    borderColor: Colors.primary,
  },
  pillText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  pillTextActive: {
    color: Colors.primary,
    fontWeight: 'bold',
  },
  daySection: {
    marginBottom: 20,
  },
  dayHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  dayTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  dayCount: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  card: {
    backgroundColor: Colors.surface,
    padding: 16,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  periodBadge: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  time: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  subjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  subject: {
    fontSize: 17,
    fontWeight: 'bold',
    color: Colors.text,
    flex: 1,
  },
  codeBadge: {
    backgroundColor: Colors.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  codeText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border + '55',
    paddingTop: 8,
    marginTop: 4,
  },
  classDetail: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  roomDetail: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  emptyDayCard: {
    backgroundColor: Colors.surface,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyDayText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontStyle: 'italic',
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
  centerSection: {
    padding: 32,
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.textSecondary,
    marginTop: 10,
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
});
