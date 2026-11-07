import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView } from 'react-native';
import { useAuth } from '../../store/AuthContext';
import { router } from 'expo-router';
import Colors from '../../constants/Colors';

export default function SettingsScreen() {
  const { logout, user } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.screenTitle}>Settings</Text>

        <View style={styles.card}>
          <Text style={styles.sectionHeader}>BLE Attendance Configuration</Text>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Scanner Mode</Text>
            <Text style={styles.settingValue}>Active BLE Central</Text>
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Signal Timeout</Text>
            <Text style={styles.settingValue}>35 seconds</Text>
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>RSSI Threshold</Text>
            <Text style={styles.settingValue}>-85 dBm (Classroom range)</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionHeader}>System & Account</Text>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Active User</Text>
            <Text style={styles.settingValue}>{user?.collegeEmail || 'Not signed in'}</Text>
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Version</Text>
            <Text style={styles.settingValue}>1.0.0 (Expo Web)</Text>
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Preview Mode</Text>
            <Text style={styles.settingValue}>Chrome Web</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Sign Out of Professor Portal</Text>
        </TouchableOpacity>
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
    paddingBottom: 40,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 16,
  },
  card: {
    backgroundColor: Colors.surface,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Colors.primary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '55',
  },
  settingLabel: {
    fontSize: 14,
    color: Colors.text,
  },
  settingValue: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  logoutButton: {
    backgroundColor: Colors.error + '22',
    borderWidth: 1,
    borderColor: Colors.error,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  logoutButtonText: {
    color: Colors.error,
    fontWeight: 'bold',
    fontSize: 15,
  },
});
