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
      console.error('Failed to load timetable:', err);
      setError(err?.message || 'Unable to load timetable. Please try again.');
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

  // Group entries by dayOfWeek
  const groupedByDay = useMemo(() => {
    const map: Record<string, TimetableEntry[]> = {};
    for (const day of DAYS_OF_WEEK) {
      map[day] = entries
        .filter((e) => e.dayOfWeek === day)
        .sort((a, b) => (a.periodNumber || 0) - (b.periodNumber || 0));
    }
    return map;
  }, [entries]);

  // Available days that have classes
  const daysToShow = useMemo(() => {
    if (selectedDay === 'ALL') {
      return DAYS_OF_WEEK.filter((day) => (groupedByDay[day]?.length || 0) > 0);
    }
    return [selectedDay];
  }, [selectedDay, groupedByDay]);

  const renderCard = (entry: TimetableEntry) => {
    return (
      <View key={entry.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.period}>{entry.periodName || 'Period'}</Text>
          <Text style={styles.time}>
            {entry.periodStartTime && entry.periodEndTime
              ? `${entry.periodStartTime} – ${entry.periodEndTime}`
              : entry.periodStartTime || entry.periodEndTime || ''}
          </Text>
        </View>

        <View style={styles.subjectRow}>
          <Text style={styles.subject}>{entry.subjectName || 'Subject'}</Text>
          {entry.subjectCode ? (
            <View style={styles.codeBadge}>
              <Text style={styles.codeText}>{entry.subjectCode}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.staff}>{entry.staffName ? `Faculty: ${entry.staffName}` : 'Faculty: To be assigned'}</Text>
      </View>
    );
  };

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading timetable...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.errorTitle}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setLoading(true);
              fetchTimetable();
            }}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (entries.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyTitle}>No Timetable Scheduled</Text>
          <Text style={styles.emptySubtitle}>
            There are no timetable slots assigned to your class yet.
          </Text>
        </View>
      );
    }

    return (
      <>
        {/* Day selection tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsContainer}
          style={styles.tabsScrollView}
        >
          <TouchableOpacity
            style={[styles.dayTab, selectedDay === 'ALL' && styles.dayTabActive]}
            onPress={() => setSelectedDay('ALL')}
          >
            <Text style={[styles.dayTabText, selectedDay === 'ALL' && styles.dayTabTextActive]}>
              All Days
            </Text>
          </TouchableOpacity>
          {DAYS_OF_WEEK.map((day) => {
            const count = groupedByDay[day]?.length || 0;
            const isSelected = selectedDay === day;
            return (
              <TouchableOpacity
                key={day}
                style={[styles.dayTab, isSelected && styles.dayTabActive]}
                onPress={() => setSelectedDay(day)}
              >
                <Text style={[styles.dayTabText, isSelected && styles.dayTabTextActive]}>
                  {day.slice(0, 3)}
                  {count > 0 ? ` (${count})` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Timetable entries grouped by day */}
        {daysToShow.map((day) => {
          const dayEntries = groupedByDay[day] || [];
          return (
            <View key={day} style={styles.daySection}>
              <Text style={styles.dayTitle}>{day}</Text>
              {dayEntries.length === 0 ? (
                <View style={styles.emptyDayCard}>
                  <Text style={styles.emptyDayText}>No classes scheduled for {day.toLowerCase()}.</Text>
                </View>
              ) : (
                dayEntries.map(renderCard)
              )}
            </View>
          );
        })}
      </>
    );
  };

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
        <Text style={styles.screenTitle}>Weekly Timetable</Text>
        {renderContent()}
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
  screenTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 16,
  },
  tabsScrollView: {
    marginBottom: 16,
    maxHeight: 44,
  },
  tabsContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  dayTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dayTabActive: {
    backgroundColor: Colors.primary + '22',
    borderColor: Colors.primary,
  },
  dayTabText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  dayTabTextActive: {
    color: Colors.primary,
    fontWeight: 'bold',
  },
  daySection: {
    marginBottom: 20,
  },
  dayTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.primary,
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: Colors.surface,
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  period: {
    fontSize: 13,
    color: Colors.primary,
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
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.text,
    flex: 1,
  },
  codeBadge: {
    backgroundColor: Colors.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  codeText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  staff: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  emptyDayCard: {
    backgroundColor: Colors.surface,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyDayText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontStyle: 'italic',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 280,
  },
  loadingText: {
    marginTop: 16,
    color: Colors.textSecondary,
    fontSize: 16,
  },
  errorTitle: {
    fontSize: 16,
    color: Colors.error,
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  retryText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: 'bold',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
