import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, StatusBar } from 'react-native';
import { useAuth } from '../../store/AuthContext';
import Colors from '../../constants/Colors';
import { Card, SectionHeader } from '../../components/ui';
import { Ionicons } from '@expo/vector-icons';

function getInitials(name?: string): string {
  if (!name) return 'F';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export default function ProfileScreen() {
  const { user } = useAuth();

  const primaryRole = user?.roles?.[0] || 'FACULTY';
  const roleDisplay = primaryRole === 'DEPUTY_HOD' ? 'Deputy HOD' : primaryRole === 'CLASS_COUNSELOR' ? 'Class Counselor' : primaryRole === 'ADMIN' ? 'Administrator' : 'Faculty Member';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.card} />
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Profile Card Header */}
        <Card style={styles.avatarCard}>
          <View style={styles.avatarWrap}>
            <Text style={styles.avatarText}>{getInitials(user?.name)}</Text>
          </View>
          <Text style={styles.name}>{user?.name || 'Faculty Member'}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{roleDisplay}</Text>
          </View>
          <Text style={styles.departmentSubtitle}>Department of Information Technology</Text>
        </Card>

        {/* Official Faculty Information */}
        <SectionHeader title="Official Credentials" badge="Verified Staff" />
        <Card style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <View style={styles.iconCol}>
              <Ionicons name="id-card-outline" size={18} color={Colors.teal} />
            </View>
            <View style={styles.textCol}>
              <Text style={styles.detailLabel}>Staff Identification Code</Text>
              <Text style={styles.detailValue}>{user?.staffCode || 'Staff code not assigned'}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.iconCol}>
              <Ionicons name="mail-outline" size={18} color={Colors.teal} />
            </View>
            <View style={styles.textCol}>
              <Text style={styles.detailLabel}>Official College Email</Text>
              <Text style={styles.detailValue}>{user?.collegeEmail || 'Not available'}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.iconCol}>
              <Ionicons name="business-outline" size={18} color={Colors.teal} />
            </View>
            <View style={styles.textCol}>
              <Text style={styles.detailLabel}>Department</Text>
              <Text style={styles.detailValue}>Information Technology</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.iconCol}>
              <Ionicons name="shield-checkmark-outline" size={18} color={Colors.teal} />
            </View>
            <View style={styles.textCol}>
              <Text style={styles.detailLabel}>Assigned Roles (RBAC)</Text>
              <View style={styles.rolesRow}>
                {(user?.roles || ['FACULTY']).map((role) => (
                  <View key={role} style={styles.roleChip}>
                    <Text style={styles.roleChipText}>{role}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </Card>

        {/* Operational Security Notice */}
        <Card style={styles.policyCard}>
          <View style={styles.policyHeader}>
            <Ionicons name="shield-checkmark" size={18} color={Colors.teal} style={{ marginRight: 6 }} />
            <Text style={styles.policyTitle}>Classroom Audit Compliance</Text>
          </View>
          <Text style={styles.policyBody}>
            Session initiation, BLE token generation, proximity detections, and manual attendance modifications are audited and logged with cryptographic integrity.
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
  roleBadge: {
    backgroundColor: Colors.tealLight,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 6,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.tealDark,
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
    color: Colors.primary,
  },
  rolesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  roleChip: {
    backgroundColor: Colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roleChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
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
