import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '../../constants/Colors';
import { Ionicons } from '@expo/vector-icons';

export default function NoSessionCard() {
  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Ionicons name="radio-outline" size={36} color={Colors.textMuted} />
      </View>
      <Text style={styles.title}>No Active Session</Text>
      <Text style={styles.subtitle}>
        There is no live attendance session broadcasting for your class right now.
      </Text>
      <View style={styles.hintWrap}>
        <Ionicons name="information-circle-outline" size={15} color={Colors.teal} style={{ marginRight: 6 }} />
        <Text style={styles.hintText}>
          When your professor starts attendance in classroom, this screen will activate automatically.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    padding: 28,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1.5,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 300,
    marginBottom: 16,
  },
  hintWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.tealSubtle,
    borderWidth: 1,
    borderColor: Colors.teal + '30',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    maxWidth: 320,
  },
  hintText: {
    fontSize: 12,
    color: Colors.tealDark,
    flex: 1,
    lineHeight: 16,
  },
});
