import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useAuth } from '../store/AuthContext';
import { router } from 'expo-router';
import Colors from '../constants/Colors';

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
    if (!email.trim() || !password.trim()) {
      setError('Please enter your college email and password.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e?.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError(null);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Smart Attendance</Text>
          <Text style={styles.subtitle}>Professor Portal</Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <Text style={styles.inputLabel}>College Email</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. hod.it@sonatech.ac.in"
            placeholderTextColor={Colors.textSecondary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.inputLabel}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter password"
            placeholderTextColor={Colors.textSecondary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={Colors.background} size="small" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Quick Demo Helpers for development testing */}
        <View style={styles.quickHelperContainer}>
          <Text style={styles.quickHelperTitle}>Quick Demo Sign-In</Text>
          <View style={styles.quickHelperRow}>
            <TouchableOpacity
              style={styles.quickHelperChip}
              onPress={() => handleQuickFill('hod.it@sonatech.ac.in', '123456789012')}
            >
              <Text style={styles.quickHelperChipText}>👑 Dr. Akilandeswari (HOD)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickHelperChip}
              onPress={() => handleQuickFill('admin@sonatech.ac.in', '123456789012')}
            >
              <Text style={styles.quickHelperChipText}>⚡ System Admin</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
    justifyContent: 'center',
    padding: 24,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 30,
    fontWeight: 'bold',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 18,
    color: Colors.primary,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: Colors.error + '22',
    borderWidth: 1,
    borderColor: Colors.error,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: Colors.error,
    fontSize: 14,
    textAlign: 'center',
  },
  form: {
    backgroundColor: Colors.surface,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 6,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.background,
    color: Colors.text,
    padding: 14,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: 15,
  },
  button: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: Colors.background,
    fontWeight: 'bold',
    fontSize: 16,
  },
  quickHelperContainer: {
    alignItems: 'center',
    paddingTop: 8,
  },
  quickHelperTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: Colors.textSecondary,
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  quickHelperRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  quickHelperChip: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  quickHelperChipText: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
});
