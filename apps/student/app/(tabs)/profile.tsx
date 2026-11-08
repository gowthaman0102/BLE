import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, StatusBar } from 'react-native';
import { useAuth } from '../../store/AuthContext';
import Colors from '../../constants/Colors';
import { Card, SectionHeader } from '../../components/ui';
import { Ionicons } from '@expo/vector-icons';

function getInitials(name?: string): string {
  if (!name) return 'S';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export default function ProfileScreen() {
  const { user } = useAuth();

  const departmentDisplay =
    user?.departmentCode === 'IT'
      ? 'Information Technology'
      : user?.departmentCode || 'Department of Technology';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.card} />
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Profile Identity Card */}
        <Card style={styles.avatarCard}>
          <View style={styles.avatarWrap}>
            <Text style={styles.avatarText}>{getInitials(user?.name)}</Text>
          </View>
          <Text style={styles.name}>{user?.name || 'Enrolled Student'}</Text>
          <View style={styles.regBadge}>
            <Text style={styles.regBadgeText}>{user?.registerNumber || 'Register Number'}</Text>
          </View>
          <Text style={styles.departmentSubtitle}>{departmentDisplay}</Text>
        </Card>

        {/* Academic Details Section */}
        <SectionHeader title="Academic Credentials" badge="Verified" />
        <Card style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <View style={styles.iconCol}>
              <Ionicons name="school-outline" size={18} color={Colors.teal} />
            </View>
            <View style={styles.textCol}>
              <Text style={styles.detailLabel}>Assigned Class</Text>
              <Text style={styles.detailValue}>{user?.className || 'Class not assigned'}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.iconCol}>
              <Ionicons name="business-outline" size={18} color={Colors.teal} />
            </View>
            <View style={styles.textCol}>
              <Text style={styles.detailLabel}>Department</Text>
              <Text style={styles.detailValue}>{departmentDisplay}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.iconCol}>
              <Ionicons name="mail-outline" size={18} color={Colors.teal} />
            </View>
            <View style={styles.textCol}>
              <Text style={styles.detailLabel}>College Email</Text>
              <Text style={styles.detailValue}>{user?.collegeEmail || 'Not available'}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.iconCol}>
              <Ionicons name="shield-checkmark-outline" size={18} color={Colors.teal} />
            </View>
            <View style={styles.textCol}>
              <Text style={styles.detailLabel}>Enrollment Status</Text>
              <Text style={[styles.detailValue, { color: Colors.success, fontWeight: '700' }]}>
                {user?.status === 'ACTIVE' ? 'Active & Verified' : user?.status || 'Active'}
              </Text>
            </View>
          </View>
        </Card>

        {/* Attendance Verification Policy Card */}
        <Card style={styles.policyCard}>
          <View style={styles.policyHeader}>
            <Ionicons name="information-circle" size={18} color={Colors.teal} style={{ marginRight: 6 }} />
            <Text style={styles.policyTitle}>Two-Factor Verification Policy</Text>
          </View>
          <Text style={styles.policyBody}>
            Attendance records require physical classroom BLE beacon detection and single-frame biometric liveness confirmation in accordance with college academic regulations.
          </Text>
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
  scrollContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  avatarCard: {
    alignItems: 'center',
    padding: 24,
    marginBottom: 16,
  },
  avatarWrap: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: Colors.tealLight,
    borderWidth: 1,
    borderColor: Colors.teal + '40',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  avatarText: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.tealDark,
  },
  name: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.primary,
    marginBottom: 6,
    textAlign: 'center',
  },
  regBadge: {
    backgroundColor: Colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 6,
  },
  regBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  departmentSubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  detailsCard: {
    padding: 16,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  iconCol: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.tealLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textCol: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: 4,
  },
  policyCard: {
    backgroundColor: Colors.tealSubtle,
    borderColor: Colors.teal + '30',
    padding: 16,
  },
  policyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  policyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.tealDark,
  },
  policyBody: {
    fontSize: 12,
    color: Colors.tealDark,
    lineHeight: 18,
    opacity: 0.9,
  },
});
