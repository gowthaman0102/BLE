import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useAuth } from '../../store/AuthContext';
import Colors from '../../constants/Colors';

export default function ProfileScreen() {
  const { user } = useAuth();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.screenTitle}>Faculty Profile</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>{user?.name || 'Faculty Member'}</Text>

          <Text style={styles.label}>Staff Code</Text>
          <Text style={styles.value}>{user?.staffCode || 'IT-FAC-01'}</Text>

          <Text style={styles.label}>College Email</Text>
          <Text style={styles.value}>{user?.collegeEmail || 'Not available'}</Text>

          <Text style={styles.label}>Department</Text>
          <Text style={styles.value}>Information Technology</Text>

          <Text style={styles.label}>Assigned System Roles</Text>
          <View style={styles.roleContainer}>
            {(user?.roles || ['STAFF']).map((r) => (
              <View key={r} style={styles.roleBadge}>
                <Text style={styles.roleText}>{r}</Text>
              </View>
            ))}
          </View>
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
    padding: 16,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 16,
  },
  card: {
    backgroundColor: Colors.surface,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  label: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 17,
    color: Colors.text,
    marginBottom: 16,
    fontWeight: '600',
  },
  roleContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  roleBadge: {
    backgroundColor: Colors.primary + '22',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  roleText: {
    color: Colors.primary,
    fontWeight: 'bold',
    fontSize: 12,
  },
});
