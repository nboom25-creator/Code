import { Priority } from './types';

export const colors = {
  background: '#0F1115',
  surface: '#181B22',
  surfaceAlt: '#21252E',
  border: '#2B303B',
  primary: '#6C8CFF',
  primaryDim: '#324089',
  accent: '#4ECDC4',
  text: '#F2F4F8',
  textMuted: '#9AA3B2',
  textFaint: '#5B6472',
  success: '#5BD675',
  warning: '#FFC857',
  danger: '#FF6B6B',
  focus: '#FF6B6B',
  break: '#4ECDC4',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const priorityColor: Record<Priority, string> = {
  low: colors.textMuted,
  medium: colors.warning,
  high: colors.danger,
};

export const priorityLabel: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};
