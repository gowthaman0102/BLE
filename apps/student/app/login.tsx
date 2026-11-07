import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useAuth } from '../store/AuthContext';
import { router } from 'expo-router';
import Colors from '../constants/Colors';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [registerNumber, setRegisterNumber] = useState('');
  const { login, authState } = useAuth();
  
  const isLoading = authState === 'AUTHENTICATING';

  useEffect(() => {
    if (authState === 'AUTHENTICATED') {
      router.replace('/(tabs)');
    }
  }, [authState]);

  const handleLogin = async () => {
    const trimmedUsername = username.trim();
    const trimmedRegisterNumber = registerNumber.trim();

    if (!trimmedUsername || !trimmedRegisterNumber) {
      Alert.alert('Validation Error', 'Both Username and Register Number are required.');
      return;
    }
    
    if (trimmedUsername !== trimmedRegisterNumber) {
      Alert.alert('Validation Error', 'Username and Register Number must match.');
      return;
    }

    try {
      await login(trimmedUsername, trimmedRegisterNumber);
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Login Failed', e.message);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Smart Attendance</Text>
        <Text style={styles.subtitle}>Student Portal</Text>
        
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter Register Number"
            placeholderTextColor={Colors.textSecondary}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            editable={!isLoading}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Register Number</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter Register Number"
            placeholderTextColor={Colors.textSecondary}
            value={registerNumber}
            onChangeText={setRegisterNumber}
            autoCapitalize="none"
            editable={!isLoading}
          />
        </View>

        <Text style={styles.helperText}>
          Use your college register number for both fields.
        </Text>
        
        <TouchableOpacity 
          style={[styles.button, isLoading && styles.buttonDisabled]} 
          onPress={handleLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: Colors.primary,
    textAlign: 'center',
    marginBottom: 40,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    color: Colors.text,
    fontSize: 14,
    marginBottom: 8,
    fontWeight: '500',
  },
  input: {
    backgroundColor: Colors.surface,
    color: Colors.text,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  helperText: {
    color: Colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    backgroundColor: Colors.primary,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    height: 56, // fixed height to avoid jitter when showing spinner
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: Colors.background,
    fontWeight: 'bold',
    fontSize: 16,
  }
});
