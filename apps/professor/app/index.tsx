import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../store/AuthContext';
import Colors from '../constants/Colors';

export default function Index() {
  const { authState } = useAuth();

  if (authState === 'INITIALIZING') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (authState === 'AUTHENTICATED') {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/login" />;
}
