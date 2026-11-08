import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert,
  StatusBar,
} from 'react-native';
import { useAuth } from '../../store/AuthContext';
import { router } from 'expo-router';
import Colors from '../../constants/Colors';
import { Card, SectionHeader, PrimaryButton } from '../../components/ui';
import { Ionicons } from '@expo/vector-icons';

export default function SettingsScreen() {
  const { logout, user } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out of the Smart Attendance professor portal?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setLoggingOut(true);
            try {
              await logout();
              router.replace('/login');
            } finally {
              setLoggingOut(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.card} />
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Account Details Card */}
        <SectionHeader title="Signed In Faculty Account" badge="Active Session" />
        <Card style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Faculty Name</Text>
            <Text style={styles.infoValue}>{user?.name || 'Faculty Member'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Official Email</Text>
            <Text style={styles.infoValue}>{user?.collegeEmail || 'Not available'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Staff Code</Text>
            <Text style={styles.infoValue}>{user?.staffCode || 'Staff code not assigned'}</Text>
          </View>
        </Card>

        {/* BLE Attendance Engine Configuration */}
        <SectionHeader title="Classroom BLE Central Engine" badge="Hardware Ready" />
        <Card style={styles.card}>
          <View style={styles.infoRow}>
            <View style={styles.labelWithIcon}>
              <Ionicons name="bluetooth" size={16} color={Colors.teal} style={{ marginRight: 6 }} />
              <Text style={styles.infoLabel}>Scanner Mode</Text>
            </View>
            <Text style={[styles.infoValue, { color: Colors.teal, fontWeight: '700' }]}>
              Active Central Scanner
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <View style={styles.labelWithIcon}>
              <Ionicons name="timer-outline" size={16} color={Colors.teal} style={{ marginRight: 6 }} />
              <Text style={styles.infoLabel}>Signal Timeout</Text>
            </View>
            <Text style={styles.infoValue}>35 seconds</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <View style={styles.labelWithIcon}>
              <Ionicons name="wifi-outline" size={16} color={Colors.teal} style={{ marginRight: 6 }} />
              <Text style={styles.infoLabel}>RSSI Proximity Filter</Text>
            </View>
            <Text style={styles.infoValue}>-85 dBm (Classroom Range)</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <View style={styles.labelWithIcon}>
              <Ionicons name="lock-closed-outline" size={16} color={Colors.teal} style={{ marginRight: 6 }} />
              <Text style={styles.infoLabel}>Token Storage</Text>
            </View>
            <Text style={[styles.infoValue, { color: Colors.teal, fontWeight: '700' }]}>
              Encrypted Native Store
            </Text>
          </View>
        </Card>

        {/* Application Metadata */}
        <SectionHeader title="Application Details" />
        <Card style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Release Version</Text>
            <Text style={styles.infoValue}>1.0.0 (Production Release)</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Framework</Text>
            <Text style={styles.infoValue}>Expo SDK 57 • React Native 0.86</Text>
          </View>
        </Card>

        {/* Sign Out Button */}
        <PrimaryButton
          title="Sign Out of Professor Portal"
          onPress={handleLogout}
          variant="danger"
          loading={loggingOut}
          icon="log-out-outline"
          style={{ marginTop: 12, marginBottom: 24 }}
        />
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
  card: {
    padding: 16,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  labelWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: 4,
  },
});
