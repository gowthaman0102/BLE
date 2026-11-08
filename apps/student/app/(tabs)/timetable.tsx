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
import Colors from '../../constants/Colors';
import { TimetableEntry } from '@smart-attendance/shared';
import { timetableService } from '../../services/api/timetableService';
import { Card, SectionHeader, EmptyState, ErrorState } from '../../components/ui';
import { Ionicons } from '@expo/vector-icons';

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
      setError(err?.message || 'Unable to load timetable. Please pull to refresh.');
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

  const renderContent = () => {
    if (loading) {
      return (
        <Card style={styles.centerSection}>
          <ActivityIndicator size="small" color={Colors.teal} />
          <Text style={styles.loadingText}>Loading class timetable...</Text>
        </Card>
      );
    }

    if (error) {
      return (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            fetchTimetable();
          }}
        />
      );
    }

    if (entries.length === 0) {
      return (
        <Card>
          <EmptyState
            icon="calendar-outline"
            title="No Timetable Scheduled"
            description="Timetable entries have not been scheduled for your class yet."
          />
        </Card>
      );
    }

    if (selectedDay !== 'ALL' && (groupedByDay[selectedDay]?.length || 0) === 0) {
      return (
        <Card>
          <EmptyState
            icon="cafe-outline"
            title="No Classes Scheduled"
            description={`No academic periods are scheduled on ${selectedDay.toLowerCase()}.`}
          />
        </Card>
      );
    }

    return daysToShow.map((day) => {
      const dayEntries = groupedByDay[day] || [];
      if (dayEntries.length === 0) return null;

      return (
        <View key={day} style={styles.dayGroup}>
          <SectionHeader title={day} badge={`${dayEntries.length} Classes`} />
          {dayEntries.map((entry, index) => {
            return (
              <Card key={entry.id || index} style={styles.periodCard}>
                <View style={styles.periodHeader}>
                  <View style={styles.periodBadge}>
                    <Text style={styles.periodBadgeText}>
                      {entry.periodName || `P${entry.periodNumber || index + 1}`}
                    </Text>
                  </View>
                  <View style={styles.timeWrap}>
                    <Ionicons name="time-outline" size={13} color={Colors.textSecondary} style={{ marginRight: 4 }} />
                    <Text style={styles.timeText}>
                      {entry.periodStartTime && entry.periodEndTime
                        ? `${entry.periodStartTime} – ${entry.periodEndTime}`
                        : entry.periodStartTime || 'Scheduled'}
                    </Text>
                  </View>
                </View>

                <View style={styles.subjectRow}>
                  <Text style={styles.subjectText}>{entry.subjectName || 'Subject'}</Text>
                  {entry.subjectCode ? (
                    <View style={styles.codeTag}>
                      <Text style={styles.codeTagText}>{entry.subjectCode}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.footerRow}>
                  <View style={styles.facultyMeta}>
                    <Ionicons name="person-outline" size={13} color={Colors.textSecondary} style={{ marginRight: 4 }} />
                    <Text style={styles.facultyText} numberOfLines={1}>
                      {entry.staffName || 'Faculty: Not assigned'}
                    </Text>
                  </View>
                  <View style={styles.roomMeta}>
                    <Ionicons name="location-outline" size={13} color={Colors.textMuted} style={{ marginRight: 3 }} />
                    <Text style={styles.roomText}>Assigned Hall</Text>
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
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
        {/* Day Selector Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillsScroll}
        >
          <TouchableOpacity
            style={[styles.pill, selectedDay === 'ALL' && styles.pillActive]}
            onPress={() => setSelectedDay('ALL')}
            activeOpacity={0.8}
          >
            <Text style={[styles.pillText, selectedDay === 'ALL' && styles.pillTextActive]}>
              All Days
            </Text>
          </TouchableOpacity>

          {DAYS_OF_WEEK.map((day) => {
            const isSelected = selectedDay === day;
            const shortDay = day.slice(0, 3);
            return (
              <TouchableOpacity
                key={day}
                style={[styles.pill, isSelected && styles.pillActive]}
                onPress={() => setSelectedDay(day)}
                activeOpacity={0.8}
              >
                <Text style={[styles.pillText, isSelected && styles.pillTextActive]}>
                  {shortDay}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

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
  scrollContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  pillsScroll: {
    paddingBottom: 14,
    gap: 8,
  },
  pill: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  pillActive: {
    backgroundColor: Colors.teal,
    borderColor: Colors.teal,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  pillTextActive: {
    color: Colors.textInverse,
  },
  centerSection: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  dayGroup: {
    marginBottom: 12,
  },
  periodCard: {
    marginBottom: 10,
    padding: 14,
  },
  periodHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  periodBadge: {
    backgroundColor: Colors.tealLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  periodBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.tealDark,
  },
  timeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  subjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  subjectText: {
    fontSize: 16,
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
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  facultyMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  facultyText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  roomMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  roomText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
});
