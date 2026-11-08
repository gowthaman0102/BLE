import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  KeyboardTypeOptions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';

export interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  highlight?: boolean;
}

export function Card({ children, style, highlight }: CardProps) {
  return (
    <View style={[styles.card, highlight && styles.cardHighlight, style]}>
      {children}
    </View>
  );
}

export interface SectionHeaderProps {
  title: string;
  badge?: string;
  actionText?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function SectionHeader({ title, badge, actionText, onAction, style }: SectionHeaderProps) {
  return (
    <View style={[styles.sectionHeaderRow, style]}>
      <View style={styles.sectionHeaderLeft}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {badge ? (
          <View style={styles.sectionBadge}>
            <Text style={styles.sectionBadgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {actionText && onAction ? (
        <TouchableOpacity onPress={onAction} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.sectionActionText}>{actionText}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export interface StatusBadgeProps {
  status: string;
  type?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  style?: ViewStyle;
}

export function StatusBadge({ status, type = 'neutral', style }: StatusBadgeProps) {
  let bg = Colors.surfaceSubtle;
  let text = Colors.textSecondary;
  let border = Colors.border;

  switch (type) {
    case 'success':
      bg = Colors.successBackground;
      text = Colors.success;
      border = Colors.successBorder;
      break;
    case 'warning':
      bg = Colors.warningBackground;
      text = Colors.warning;
      border = Colors.warningBorder;
      break;
    case 'error':
      bg = Colors.errorBackground;
      text = Colors.error;
      border = Colors.errorBorder;
      break;
    case 'info':
      bg = Colors.infoBackground;
      text = Colors.info;
      border = '#BFDBFE';
      break;
    case 'neutral':
    default:
      bg = Colors.surfaceSubtle;
      text = Colors.textSecondary;
      border = Colors.border;
      break;
  }

  return (
    <View style={[styles.statusBadge, { backgroundColor: bg, borderColor: border }, style]}>
      <View style={[styles.statusDot, { backgroundColor: text }]} />
      <Text style={[styles.statusBadgeText, { color: text }]}>{status}</Text>
    </View>
  );
}

export interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'teal' | 'danger' | 'secondary';
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function PrimaryButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  icon,
  variant = 'teal',
  style,
  textStyle,
}: PrimaryButtonProps) {
  let bgColor = Colors.teal;
  let textColor = Colors.textInverse;

  if (variant === 'primary') {
    bgColor = Colors.primary;
  } else if (variant === 'danger') {
    bgColor = Colors.error;
  } else if (variant === 'secondary') {
    bgColor = Colors.card;
    textColor = Colors.primary;
  }

  const isOutlined = variant === 'secondary';

  return (
    <TouchableOpacity
      style={[
        styles.primaryButton,
        { backgroundColor: isOutlined ? Colors.card : bgColor },
        isOutlined && { borderWidth: 1, borderColor: Colors.border },
        disabled && styles.buttonDisabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <View style={styles.buttonContentRow}>
          {icon ? (
            <Ionicons name={icon} size={18} color={textColor} style={{ marginRight: 8 }} />
          ) : null}
          <Text style={[styles.primaryButtonText, { color: textColor }, textStyle]}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export interface InputFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  editable?: boolean;
  error?: string | null;
  helperText?: string;
  style?: ViewStyle;
}

export function InputField({
  label,
  value,
  onChangeText,
  placeholder,
  icon,
  secureTextEntry,
  keyboardType = 'default',
  autoCapitalize = 'none',
  editable = true,
  error,
  helperText,
  style,
}: InputFieldProps) {
  const [isFocused, setIsFocused] = React.useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = React.useState(!secureTextEntry);

  return (
    <View style={[styles.inputGroup, style]}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View
        style={[
          styles.inputContainer,
          isFocused && styles.inputContainerFocused,
          error ? styles.inputContainerError : null,
          !editable && styles.inputContainerDisabled,
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={20}
            color={isFocused ? Colors.teal : Colors.textMuted}
            style={styles.inputLeadingIcon}
          />
        ) : null}
        <TextInput
          style={styles.textInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          secureTextEntry={secureTextEntry && !isPasswordVisible}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          editable={editable}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        {secureTextEntry ? (
          <TouchableOpacity
            onPress={() => setIsPasswordVisible(!isPasswordVisible)}
            style={styles.inputTrailingIcon}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={Colors.textMuted}
            />
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? <Text style={styles.inputErrorText}>{error}</Text> : null}
      {helperText && !error ? <Text style={styles.inputHelperText}>{helperText}</Text> : null}
    </View>
  );
}

export interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  style?: ViewStyle;
}

export function MetricCard({ label, value, subtitle, icon, color = Colors.teal, style }: MetricCardProps) {
  return (
    <View style={[styles.metricCard, style]}>
      <View style={styles.metricCardHeader}>
        <View style={[styles.metricIconWrap, { backgroundColor: color + '15' }]}>
          <Ionicons name={icon} size={20} color={color} />
        </View>
        <Text style={styles.metricLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={[styles.metricValue, { color: Colors.primary }]}>{value}</Text>
      {subtitle ? <Text style={styles.metricSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
    </View>
  );
}

export interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function EmptyState({ icon, title, description, actionText, onAction, style }: EmptyStateProps) {
  return (
    <View style={[styles.emptyContainer, style]}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name={icon} size={36} color={Colors.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {actionText && onAction ? (
        <PrimaryButton
          title={actionText}
          onPress={onAction}
          variant="secondary"
          style={{ marginTop: 14, minWidth: 140 }}
        />
      ) : null}
    </View>
  );
}

export interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  style?: ViewStyle;
}

export function ErrorState({ message, onRetry, style }: ErrorStateProps) {
  return (
    <View style={[styles.errorBox, style]}>
      <Ionicons name="alert-circle" size={22} color={Colors.error} style={{ marginRight: 10 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.errorText}>{message}</Text>
      </View>
      {onRetry ? (
        <TouchableOpacity onPress={onRetry} style={styles.errorRetryBtn}>
          <Text style={styles.errorRetryText}>Retry</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#172033',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1.5,
  },
  cardHighlight: {
    borderColor: Colors.teal + '40',
    backgroundColor: Colors.tealSubtle,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 6,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: -0.2,
  },
  sectionBadge: {
    backgroundColor: Colors.tealLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  sectionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.tealDark,
    textTransform: 'uppercase',
  },
  sectionActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.teal,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    flexDirection: 'row',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
    marginBottom: 7,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  inputContainerFocused: {
    borderColor: Colors.teal,
    borderWidth: 1.5,
  },
  inputContainerError: {
    borderColor: Colors.error,
  },
  inputContainerDisabled: {
    backgroundColor: Colors.surfaceSubtle,
    opacity: 0.7,
  },
  inputLeadingIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 12,
  },
  inputTrailingIcon: {
    padding: 4,
  },
  inputErrorText: {
    fontSize: 12,
    color: Colors.error,
    marginTop: 5,
  },
  inputHelperText: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 5,
  },
  metricCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    flex: 1,
    minWidth: 140,
    shadowColor: '#172033',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 5,
    elevation: 1,
  },
  metricCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  metricIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    flex: 1,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  metricSubtitle: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  emptyContainer: {
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 4,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
  errorBox: {
    backgroundColor: Colors.errorBackground,
    borderWidth: 1,
    borderColor: Colors.errorBorder,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  errorText: {
    color: Colors.error,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  errorRetryBtn: {
    backgroundColor: Colors.card,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.errorBorder,
    marginLeft: 8,
  },
  errorRetryText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.error,
  },
});
