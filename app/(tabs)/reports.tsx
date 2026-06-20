import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../src/store/AppContext';
import { makeStyles, radius, spacing, useTheme } from '../../src/theme';
import {
  Card,
  Chip,
  EmptyState,
  ScreenTitle,
  SectionTitle,
} from '../../src/components/ui';
import {
  addDays,
  formatDurationLong,
  isSameDay,
  startOfDay,
} from '../../src/utils/time';

type Range = 'today' | 'week' | 'all';

const LOG_DAYS = [
  { label: 'Today', offset: 0 },
  { label: 'Yesterday', offset: -1 },
  { label: '2 days ago', offset: -2 },
  { label: '3 days ago', offset: -3 },
];
const LOG_HOURS = [6, 8, 9, 10, 12, 14, 16, 18, 20];
const LOG_DURATIONS = [15, 30, 45, 60, 90, 120];

export default function ReportsScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const { timeEntries, tasks, deleteEntry, addManualEntry } = useApp();
  const [range, setRange] = useState<Range>('week');

  // Manual log form state.
  const [showLog, setShowLog] = useState(false);
  const [logLabel, setLogLabel] = useState('');
  const [logDay, setLogDay] = useState(0);
  const [logHour, setLogHour] = useState(9);
  const [logDuration, setLogDuration] = useState(30);

  const now = new Date();
  const rangeStart = useMemo(() => {
    if (range === 'today') return startOfDay(now);
    if (range === 'week') return startOfDay(addDays(now, -6));
    return new Date(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const entriesInRange = useMemo(
    () =>
      timeEntries.filter((e) => new Date(e.startedAt).getTime() >= rangeStart.getTime()),
    [timeEntries, rangeStart],
  );

  const totalSeconds = entriesInRange.reduce((s, e) => s + e.durationSeconds, 0);
  const focusSessions = entriesInRange.filter((e) => e.source === 'focus').length;
  const completedInRange = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.completed &&
          t.completedAt &&
          new Date(t.completedAt).getTime() >= rangeStart.getTime(),
      ).length,
    [tasks, rangeStart],
  );

  const dailyTotals = useMemo(() => {
    const days: { date: Date; seconds: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = startOfDay(addDays(now, -i));
      const seconds = timeEntries
        .filter((e) => isSameDay(new Date(e.startedAt), date))
        .reduce((s, e) => s + e.durationSeconds, 0);
      days.push({ date, seconds });
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeEntries]);
  const maxDaily = Math.max(1, ...dailyTotals.map((d) => d.seconds));

  const byLabel = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entriesInRange) {
      map.set(e.label, (map.get(e.label) ?? 0) + e.durationSeconds);
    }
    return [...map.entries()]
      .map(([label, seconds]) => ({ label, seconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 6);
  }, [entriesInRange]);
  const maxLabel = Math.max(1, ...byLabel.map((l) => l.seconds));

  const recent = useMemo(
    () =>
      [...entriesInRange]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 12),
    [entriesInRange],
  );

  const submitLog = () => {
    const label = logLabel.trim() || 'Untitled';
    const start = startOfDay(addDays(now, logDay));
    start.setHours(logHour, 0, 0, 0);
    const end = new Date(start.getTime() + logDuration * 60000);
    addManualEntry({
      label,
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      source: 'manual',
    });
    setLogLabel('');
    setLogDuration(30);
    setShowLog(false);
  };

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
    >
      <View style={{ paddingTop: insets.top }}>
        <ScreenTitle title="Reports" subtitle="Where your time goes" />
      </View>

      <View style={styles.rangeRow}>
        {(['today', 'week', 'all'] as Range[]).map((r) => (
          <Pressable
            key={r}
            onPress={() => setRange(r)}
            style={[styles.rangeTab, range === r && styles.rangeTabActive]}
          >
            <Text
              style={[styles.rangeText, range === r && styles.rangeTextActive]}
            >
              {r === 'today' ? 'Today' : r === 'week' ? '7 Days' : 'All Time'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.statGrid}>
        <SummaryCard
          icon="time-outline"
          value={formatDurationLong(totalSeconds)}
          label="Tracked"
          color={colors.primary}
        />
        <SummaryCard
          icon="checkmark-done-outline"
          value={String(completedInRange)}
          label="Completed"
          color={colors.success}
        />
        <SummaryCard
          icon="timer-outline"
          value={String(focusSessions)}
          label="Focus sessions"
          color={colors.focus}
        />
      </View>

      <View style={styles.section}>
        <Pressable
          onPress={() => setShowLog((s) => !s)}
          style={styles.logToggle}
        >
          <Ionicons
            name={showLog ? 'chevron-up' : 'add-circle-outline'}
            size={20}
            color={colors.primary}
          />
          <Text style={styles.logToggleText}>Log time manually</Text>
        </Pressable>

        {showLog && (
          <Card style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            <TextInput
              value={logLabel}
              onChangeText={setLogLabel}
              placeholder="What did you work on?"
              placeholderTextColor={colors.textFaint}
              style={styles.logInput}
            />
            <Text style={styles.logLabel}>Day</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.logScroll}
            >
              {LOG_DAYS.map((d) => (
                <Chip
                  key={d.offset}
                  label={d.label}
                  active={logDay === d.offset}
                  onPress={() => setLogDay(d.offset)}
                />
              ))}
            </ScrollView>
            <Text style={styles.logLabel}>Start time</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.logScroll}
            >
              {LOG_HOURS.map((h) => (
                <Chip
                  key={h}
                  label={labelForHour(h)}
                  active={logHour === h}
                  color={colors.accent}
                  onPress={() => setLogHour(h)}
                />
              ))}
            </ScrollView>
            <Text style={styles.logLabel}>Duration</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.logScroll}
            >
              {LOG_DURATIONS.map((d) => (
                <Chip
                  key={d}
                  label={d < 60 ? `${d}m` : `${d / 60}h`}
                  active={logDuration === d}
                  color={colors.success}
                  onPress={() => setLogDuration(d)}
                />
              ))}
            </ScrollView>
            <Pressable style={styles.logSubmit} onPress={submitLog}>
              <Ionicons name="checkmark" size={18} color={colors.onColor} />
              <Text style={styles.logSubmitText}>Add entry</Text>
            </Pressable>
          </Card>
        )}
      </View>

      <View style={styles.section}>
        <SectionTitle>Last 7 days</SectionTitle>
        <Card>
          <View style={styles.chart}>
            {dailyTotals.map((d, i) => {
              const h = 8 + (d.seconds / maxDaily) * 110;
              const today = isSameDay(d.date, now);
              return (
                <View key={i} style={styles.barCol}>
                  <Text style={styles.barValue}>
                    {d.seconds > 0 ? Math.round(d.seconds / 60) : ''}
                  </Text>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: h,
                        backgroundColor: today ? colors.primary : colors.primaryDim,
                      },
                    ]}
                  />
                  <Text style={styles.barLabel}>
                    {d.date.toLocaleDateString(undefined, { weekday: 'narrow' })}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.chartCaption}>minutes tracked per day</Text>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionTitle>Breakdown by activity</SectionTitle>
        {byLabel.length === 0 ? (
          <EmptyState
            icon="pie-chart-outline"
            title="No time tracked yet"
            message="Run a focus session or log time to see your breakdown."
          />
        ) : (
          <Card style={{ gap: spacing.md }}>
            {byLabel.map((l) => (
              <View key={l.label}>
                <View style={styles.breakdownHead}>
                  <Text style={styles.breakdownLabel} numberOfLines={1}>
                    {l.label}
                  </Text>
                  <Text style={styles.breakdownValue}>
                    {formatDurationLong(l.seconds)}
                  </Text>
                </View>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.trackFill,
                      { width: `${(l.seconds / maxLabel) * 100}%` },
                    ]}
                  />
                </View>
              </View>
            ))}
          </Card>
        )}
      </View>

      {recent.length > 0 && (
        <View style={styles.section}>
          <SectionTitle>Recent entries</SectionTitle>
          <Card style={{ gap: spacing.sm }}>
            {recent.map((e) => (
              <View key={e.id} style={styles.entryRow}>
                <Ionicons
                  name={e.source === 'focus' ? 'timer-outline' : 'stopwatch-outline'}
                  size={18}
                  color={colors.textMuted}
                />
                <View style={styles.flex}>
                  <Text style={styles.entryLabel} numberOfLines={1}>
                    {e.label}
                  </Text>
                  <Text style={styles.entryMeta}>
                    {new Date(e.startedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}{' '}
                    · {formatDurationLong(e.durationSeconds)}
                  </Text>
                </View>
                <Pressable onPress={() => deleteEntry(e.id)} hitSlop={8}>
                  <Ionicons name="close" size={18} color={colors.textFaint} />
                </Pressable>
              </View>
            ))}
          </Card>
        </View>
      )}
    </ScrollView>
  );
}

function labelForHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

function SummaryCard({
  icon,
  value,
  label,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  color: string;
}) {
  const styles = useStyles();
  return (
    <Card style={styles.summaryCard}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </Card>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1, backgroundColor: colors.background },
  rangeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  rangeTab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  rangeTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  rangeText: { color: colors.textMuted, fontWeight: '700', fontSize: 14 },
  rangeTextActive: { color: colors.onColor },
  statGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  summaryCard: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.lg },
  summaryValue: { color: colors.text, fontSize: 20, fontWeight: '800' },
  summaryLabel: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },
  section: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  logToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  logToggleText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  logInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 15,
  },
  logLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  logScroll: { gap: spacing.sm, paddingVertical: 2 },
  logSubmit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  logSubmitText: { color: colors.onColor, fontSize: 15, fontWeight: '700' },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 150,
  },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: 22, borderRadius: 6, marginTop: 4 },
  barValue: { color: colors.textMuted, fontSize: 10, marginBottom: 2 },
  barLabel: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm },
  chartCaption: {
    color: colors.textFaint,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  breakdownHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  breakdownLabel: { color: colors.text, fontSize: 15, flex: 1, marginRight: spacing.sm },
  breakdownValue: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  trackFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  entryLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  entryMeta: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
}));
