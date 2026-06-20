import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useApp, ExportData } from '../../src/store/AppContext';
import {
  makeStyles,
  radius,
  spacing,
  ThemePref,
  useTheme,
} from '../../src/theme';
import { Button, Card, ScreenTitle, SectionTitle } from '../../src/components/ui';
import {
  ensureNotificationPermission,
  getNotificationPermission,
} from '../../src/utils/notifications';

const THEME_OPTIONS: { pref: ThemePref; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { pref: 'light', label: 'Light', icon: 'sunny-outline' },
  { pref: 'dark', label: 'Dark', icon: 'moon-outline' },
  { pref: 'system', label: 'System', icon: 'phone-portrait-outline' },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors, pref, setPref } = useTheme();
  const { tasks, timeEntries, exportData, importData, clearAllData } = useApp();

  const [notifGranted, setNotifGranted] = useState(false);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    getNotificationPermission().then(setNotifGranted);
  }, []);

  const enableNotifications = async () => {
    const granted = await ensureNotificationPermission();
    setNotifGranted(granted);
    if (!granted) {
      Alert.alert(
        'Notifications disabled',
        'Enable notifications for TimeFlow in your device settings to receive task reminders.',
      );
    }
  };

  const handleExport = async () => {
    const json = JSON.stringify(exportData(), null, 2);
    try {
      await Share.share({ message: json });
    } catch {
      // user dismissed the share sheet
    }
  };

  const handleCopy = async () => {
    await Clipboard.setStringAsync(JSON.stringify(exportData(), null, 2));
    Alert.alert('Copied', 'Your backup JSON is on the clipboard.');
  };

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    setImportText(text);
  };

  const handleImport = () => {
    let parsed: ExportData;
    try {
      parsed = JSON.parse(importText);
    } catch {
      Alert.alert('Invalid data', "That doesn't look like valid backup JSON.");
      return;
    }
    if (!parsed || !Array.isArray(parsed.tasks)) {
      Alert.alert('Invalid data', 'No TimeFlow tasks found in that backup.');
      return;
    }
    Alert.alert(
      'Replace all data?',
      'Importing will overwrite your current tasks and time entries.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          style: 'destructive',
          onPress: () => {
            importData(parsed);
            setImportText('');
            setShowImport(false);
            Alert.alert('Imported', 'Your data has been restored.');
          },
        },
      ],
    );
  };

  const handleClear = () => {
    Alert.alert(
      'Erase everything?',
      'This permanently deletes all tasks, schedule, and tracked time on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Erase', style: 'destructive', onPress: clearAllData },
      ],
    );
  };

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
    >
      <View style={{ paddingTop: insets.top }}>
        <ScreenTitle title="Settings" subtitle="Make TimeFlow yours" />
      </View>

      <View style={styles.section}>
        <SectionTitle>Appearance</SectionTitle>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((o) => {
            const active = pref === o.pref;
            return (
              <Pressable
                key={o.pref}
                onPress={() => setPref(o.pref)}
                style={[styles.themeOption, active && styles.themeOptionActive]}
              >
                <Ionicons
                  name={o.icon}
                  size={22}
                  color={active ? colors.onColor : colors.textMuted}
                />
                <Text
                  style={[
                    styles.themeLabel,
                    { color: active ? colors.onColor : colors.textMuted },
                  ]}
                >
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle>Reminders</SectionTitle>
        <Card style={styles.rowCard}>
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>Task notifications</Text>
            <Text style={styles.rowSub}>
              {notifGranted
                ? 'Enabled — due tasks will notify you.'
                : 'Get a reminder when a task is due.'}
            </Text>
          </View>
          {notifGranted ? (
            <View style={styles.badge}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text style={[styles.badgeText, { color: colors.success }]}>On</Text>
            </View>
          ) : (
            <Button label="Enable" onPress={enableNotifications} variant="secondary" />
          )}
        </Card>
      </View>

      <View style={styles.section}>
        <SectionTitle>Backup &amp; data</SectionTitle>
        <Text style={styles.dataInfo}>
          {tasks.length} task{tasks.length === 1 ? '' : 's'} ·{' '}
          {timeEntries.length} time entr{timeEntries.length === 1 ? 'y' : 'ies'}
        </Text>
        <View style={{ gap: spacing.sm }}>
          <Button label="Export / Share backup" icon="share-outline" onPress={handleExport} />
          <Button
            label="Copy backup to clipboard"
            icon="copy-outline"
            variant="secondary"
            onPress={handleCopy}
          />
          <Button
            label={showImport ? 'Cancel import' : 'Restore from backup'}
            icon="download-outline"
            variant="secondary"
            onPress={() => setShowImport((s) => !s)}
          />
        </View>

        {showImport && (
          <Card style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            <TextInput
              value={importText}
              onChangeText={setImportText}
              placeholder="Paste your backup JSON here…"
              placeholderTextColor={colors.textFaint}
              style={styles.importInput}
              multiline
            />
            <View style={styles.importButtons}>
              <Button
                label="Paste"
                icon="clipboard-outline"
                variant="ghost"
                onPress={handlePaste}
                style={styles.flex}
              />
              <Button label="Import" onPress={handleImport} style={styles.flex} />
            </View>
          </Card>
        )}
      </View>

      <View style={styles.section}>
        <SectionTitle>Danger zone</SectionTitle>
        <Button label="Erase all data" icon="trash-outline" variant="danger" onPress={handleClear} />
      </View>

      <Text style={styles.footer}>TimeFlow · v1.1 · data stays on your device</Text>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1, backgroundColor: colors.background },
  section: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  themeRow: { flexDirection: 'row', gap: spacing.sm },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  themeOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  themeLabel: { fontSize: 13, fontWeight: '700' },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowSub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeText: { fontSize: 14, fontWeight: '700' },
  dataInfo: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.md },
  importInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: 13,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  importButtons: { flexDirection: 'row', gap: spacing.sm },
  footer: {
    color: colors.textFaint,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
}));
