import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../src/store/AppContext';
import { Task } from '../../src/types';
import { colors, priorityColor, radius, spacing } from '../../src/theme';
import { Card, Chip, EmptyState, SectionTitle } from '../../src/components/ui';
import {
  addDays,
  formatClock,
  isSameDay,
  relativeDayLabel,
  startOfDay,
} from '../../src/utils/time';

const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const DURATIONS = [15, 30, 45, 60, 90, 120];

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const { tasks, updateTask } = useApp();

  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [pickHour, setPickHour] = useState(9);
  const [pickDuration, setPickDuration] = useState(30);

  const scheduled = useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            t.scheduledStart &&
            isSameDay(new Date(t.scheduledStart), selectedDate),
        )
        .sort((a, b) =>
          (a.scheduledStart ?? '').localeCompare(b.scheduledStart ?? ''),
        ),
    [tasks, selectedDate],
  );

  const unscheduled = useMemo(
    () => tasks.filter((t) => !t.completed && !t.scheduledStart),
    [tasks],
  );

  const totalScheduledMin = scheduled.reduce((sum, t) => {
    if (!t.scheduledStart || !t.scheduledEnd) return sum;
    return (
      sum +
      (new Date(t.scheduledEnd).getTime() -
        new Date(t.scheduledStart).getTime()) /
        60000
    );
  }, 0);

  const confirmSchedule = (task: Task) => {
    const start = new Date(selectedDate);
    start.setHours(pickHour, 0, 0, 0);
    const end = new Date(start.getTime() + pickDuration * 60000);
    updateTask(task.id, {
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
    });
    setSchedulingId(null);
  };

  const unschedule = (task: Task) => {
    updateTask(task.id, { scheduledStart: undefined, scheduledEnd: undefined });
  };

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.navRow}>
        <Pressable
          onPress={() => setSelectedDate(addDays(selectedDate, -1))}
          hitSlop={10}
          style={styles.navButton}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Pressable onPress={() => setSelectedDate(startOfDay(new Date()))}>
          <Text style={styles.navTitle}>{relativeDayLabel(selectedDate)}</Text>
          <Text style={styles.navSub}>
            {selectedDate.toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSelectedDate(addDays(selectedDate, 1))}
          hitSlop={10}
          style={styles.navButton}
        >
          <Ionicons name="chevron-forward" size={24} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <SectionTitle>
          Scheduled
          {totalScheduledMin > 0
            ? ` · ${Math.round((totalScheduledMin / 60) * 10) / 10}h planned`
            : ''}
        </SectionTitle>

        {scheduled.length === 0 ? (
          <EmptyState
            icon="calendar-clear-outline"
            title="Nothing scheduled"
            message="Schedule a task below to plan out your day."
          />
        ) : (
          <View style={styles.timeline}>
            {scheduled.map((task) => (
              <Card key={task.id} style={styles.scheduledCard}>
                <View
                  style={[
                    styles.timeBar,
                    { backgroundColor: priorityColor[task.priority] },
                  ]}
                />
                <View style={styles.flex}>
                  <Text style={styles.timeRange}>
                    {formatClock(new Date(task.scheduledStart!))} –{' '}
                    {formatClock(new Date(task.scheduledEnd!))}
                  </Text>
                  <Text
                    style={[
                      styles.scheduledTitle,
                      task.completed && styles.doneTitle,
                    ]}
                  >
                    {task.title}
                  </Text>
                </View>
                <Pressable onPress={() => unschedule(task)} hitSlop={8}>
                  <Ionicons name="close" size={20} color={colors.textFaint} />
                </Pressable>
              </Card>
            ))}
          </View>
        )}

        <View style={{ height: spacing.xl }} />

        <SectionTitle>Unscheduled tasks</SectionTitle>
        {unscheduled.length === 0 ? (
          <Text style={styles.allScheduled}>
            Every open task has a home. Nice.
          </Text>
        ) : (
          unscheduled.map((task) => (
            <View key={task.id} style={styles.unscheduledWrap}>
              <Pressable
                onPress={() =>
                  setSchedulingId(schedulingId === task.id ? null : task.id)
                }
                style={styles.unscheduledRow}
              >
                <View
                  style={[
                    styles.priorityDot,
                    { backgroundColor: priorityColor[task.priority] },
                  ]}
                />
                <Text style={styles.unscheduledTitle} numberOfLines={1}>
                  {task.title}
                </Text>
                <Ionicons
                  name={schedulingId === task.id ? 'chevron-up' : 'add-circle-outline'}
                  size={22}
                  color={colors.primary}
                />
              </Pressable>

              {schedulingId === task.id && (
                <View style={styles.picker}>
                  <Text style={styles.pickerLabel}>Start time</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.pickerScroll}
                  >
                    {HOURS.map((h) => (
                      <Chip
                        key={h}
                        label={labelForHour(h)}
                        active={pickHour === h}
                        onPress={() => setPickHour(h)}
                      />
                    ))}
                  </ScrollView>

                  <Text style={styles.pickerLabel}>Duration</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.pickerScroll}
                  >
                    {DURATIONS.map((d) => (
                      <Chip
                        key={d}
                        label={d < 60 ? `${d}m` : `${d / 60}h`}
                        active={pickDuration === d}
                        color={colors.accent}
                        onPress={() => setPickDuration(d)}
                      />
                    ))}
                  </ScrollView>

                  <Pressable
                    style={styles.scheduleButton}
                    onPress={() => confirmSchedule(task)}
                  >
                    <Ionicons name="calendar" size={18} color="#0F1115" />
                    <Text style={styles.scheduleButtonText}>
                      Schedule for {relativeDayLabel(selectedDate)} at{' '}
                      {labelForHour(pickHour)}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </View>
  );
}

function labelForHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  navButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  navTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  navSub: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  timeline: { gap: spacing.sm },
  scheduledCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  timeBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  timeRange: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  scheduledTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 2,
  },
  doneTitle: { color: colors.textFaint, textDecorationLine: 'line-through' },
  allScheduled: { color: colors.textMuted, fontSize: 14 },
  unscheduledWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  unscheduledRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  priorityDot: { width: 10, height: 10, borderRadius: 5 },
  unscheduledTitle: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '600' },
  picker: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  pickerLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pickerScroll: { gap: spacing.sm, paddingVertical: 2 },
  scheduleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  scheduleButtonText: { color: '#0F1115', fontSize: 15, fontWeight: '700' },
});
