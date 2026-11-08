import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
} from 'react-native';
import { useAuth } from '../store/AuthContext';
import { router } from 'expo-router';
import Colors from '../constants/Colors';
import { InputField, PrimaryButton, ErrorState } from '../components/ui';
import { Ionicons } from '@expo/vector-icons';

export default function LoginScreen() {
  const [registerNumber, setRegisterNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { login, authState } = useAuth();

  const isLoading = authState === 'AUTHENTICATING';

  useEffect(() => {
    if (authState === 'AUTHENTICATED') {
      router.replace('/(tabs)');
    }
  }, [authState]);

  const handleLogin = async () => {
    const trimmed = registerNumber.trim();
    if (!trimmed) {
      setError('Please enter your college Register Number.');
      return;
    }

    setError(null);
    try {
      await login(trimmed);
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e?.message || 'Unable to connect to the authentication server.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header & Academic Branding */}
          <View style={styles.brandContainer}>
            <View style={styles.logoBadge}>
              <Ionicons name="school" size={32} color={Colors.teal} />
            </View>
            <Text style={styles.appTitle}>Smart Attendance</Text>
            <View style={styles.portalBadge}>
              <Text style={styles.portalBadgeText}>STUDENT PORTAL</Text>
            </View>
            <Text style={styles.tagline}>
              Institutional Attendance & BLE Classroom Verification
            </Text>
          </View>

          {/* Login Card */}
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Sign In</Text>
            <Text style={styles.formSubtitle}>
              Enter your college Register Number to access your classes
            </Text>

            {error ? <ErrorState message={error} style={{ marginBottom: 16 }} /> : null}

            <InputField
              label="Register Number"
              placeholder="e.g. 61782324106031"
              value={registerNumber}
              onChangeText={(text) => {
                setRegisterNumber(text);
                if (error) setError(null);
              }}
              icon="id-card-outline"
              autoCapitalize="characters"
              keyboardType="default"
              editable={!isLoading}
              helperText="Institutional register number assigned by your department"
            />

            <PrimaryButton
              title="Sign In to Student Portal"
              onPress={handleLogin}
              loading={isLoading}
              disabled={isLoading || !registerNumber.trim()}
              icon="arrow-forward"
              style={{ marginTop: 8 }}
            />
          </View>

          {/* Footer note */}
          <View style={styles.footer}>
            <View style={styles.securityRow}>
              <Ionicons name="shield-checkmark-outline" size={16} color={Colors.teal} style={{ marginRight: 6 }} />
              <Text style={styles.footerText}>Secure BLE & Biometric Verified Session</Text>
            </View>
            <Text style={styles.versionText}>Smart Attendance v1.0.0 • Academic Edition</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  appTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  portalBadge: {
    backgroundColor: Colors.tealLight,
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 12,
    marginBottom: 8,
  },
  portalBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.tealDark,
    letterSpacing: 0.8,
  },
  tagline: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 18,
  },
  formCard: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
    marginBottom: 24,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 4,
  },
  formSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 20,
    lineHeight: 18,
  },
  footer: {
    alignItems: 'center',
    gap: 6,
  },
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.teal,
  },
  versionText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
});
