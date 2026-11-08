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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, authState } = useAuth();

  useEffect(() => {
    if (authState === 'AUTHENTICATED') {
      router.replace('/(tabs)');
    }
  }, [authState]);

  const handleLogin = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Please enter your college email address and password.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await login(trimmedEmail, password);
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e?.message || 'Login failed. Please verify your credentials or network connection.');
    } finally {
      setLoading(false);
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
          {/* Institutional Branding Header */}
          <View style={styles.brandContainer}>
            <View style={styles.logoBadge}>
              <Ionicons name="briefcase" size={32} color={Colors.teal} />
            </View>
            <Text style={styles.appTitle}>Smart Attendance</Text>
            <View style={styles.portalBadge}>
              <Text style={styles.portalBadgeText}>FACULTY & PROFESSOR PORTAL</Text>
            </View>
            <Text style={styles.tagline}>
              Classroom Attendance Management & BLE Scanning System
            </Text>
          </View>

          {/* Login Form Card */}
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Faculty Sign In</Text>
            <Text style={styles.formSubtitle}>
              Sign in with your authorized college staff credentials
            </Text>

            {error ? <ErrorState message={error} style={{ marginBottom: 16 }} /> : null}

            <InputField
              label="College Email"
              placeholder="e.g. hod.it@sonatech.ac.in"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (error) setError(null);
              }}
              icon="mail-outline"
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!loading}
            />

            <InputField
              label="Password"
              placeholder="Enter your account password"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (error) setError(null);
              }}
              icon="lock-closed-outline"
              secureTextEntry
              editable={!loading}
            />

            <PrimaryButton
              title="Sign In to Faculty Portal"
              onPress={handleLogin}
              loading={loading}
              disabled={loading || !email.trim() || !password}
              icon="arrow-forward"
              style={{ marginTop: 8 }}
            />
          </View>

          {/* Security & Institutional Footer */}
          <View style={styles.footer}>
            <View style={styles.securityRow}>
              <Ionicons name="shield-checkmark-outline" size={16} color={Colors.teal} style={{ marginRight: 6 }} />
              <Text style={styles.footerText}>Role-Based Academic Security (RBAC)</Text>
            </View>
            <Text style={styles.versionText}>Smart Attendance v1.0.0 • Faculty Edition</Text>
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
    maxWidth: 300,
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
