import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { Priority } from './types';
import { loadJSON, saveJSON, STORAGE_KEYS } from './storage/storage';

/**
 * Neutral colors differ per theme; the saturated accent colors are shared
 * between light and dark so that `onColor` (dark text) reads well on top of
 * every colored surface in both themes.
 */
const accents = {
  primary: '#6C8CFF',
  accent: '#4ECDC4',
  success: '#5BD675',
  warning: '#FFC857',
  danger: '#FF6B6B',
  focus: '#FF6B6B',
  break: '#4ECDC4',
  onColor: '#0F1115',
};

export const darkColors = {
  ...accents,
  background: '#0F1115',
  surface: '#181B22',
  surfaceAlt: '#21252E',
  border: '#2B303B',
  text: '#F2F4F8',
  textMuted: '#9AA3B2',
  textFaint: '#5B6472',
  primaryDim: '#324089',
};

export const lightColors: typeof darkColors = {
  ...accents,
  background: '#F4F6FA',
  surface: '#FFFFFF',
  surfaceAlt: '#EAEDF3',
  border: '#DEE3EB',
  text: '#1A1D24',
  textMuted: '#5C6470',
  textFaint: '#A2AAB7',
  primaryDim: '#C3CEFF',
};

export type Colors = typeof darkColors;

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

// Priority colors are fixed so they read on both themes.
export const priorityColor: Record<Priority, string> = {
  low: '#8A93A3',
  medium: '#FFC857',
  high: '#FF6B6B',
};

export const priorityLabel: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export type ThemePref = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  colors: Colors;
  scheme: 'light' | 'dark';
  pref: ThemePref;
  setPref: (pref: ThemePref) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>('dark');

  useEffect(() => {
    loadJSON<ThemePref>(STORAGE_KEYS.theme, 'dark').then(setPrefState);
  }, []);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    saveJSON(STORAGE_KEYS.theme, next);
  }, []);

  const scheme: 'light' | 'dark' =
    pref === 'system' ? (systemScheme ?? 'dark') : pref;
  const colors = scheme === 'light' ? lightColors : darkColors;

  const value = useMemo(
    () => ({ colors, scheme, pref, setPref }),
    [colors, scheme, pref, setPref],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

/**
 * Builds a themed StyleSheet hook. Usage:
 *   const useStyles = makeStyles((c) => ({ box: { backgroundColor: c.surface } }));
 *   // inside a component:
 *   const styles = useStyles();
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (c: Colors) => T,
) {
  return function useThemedStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
