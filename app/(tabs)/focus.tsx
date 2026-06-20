import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { colors, radius, spacing } from '../../src/theme';
import { Card, SectionTitle } from '../../src/components/ui';
import { formatDuration } from '../../src/utils/time';

type Phase = 'focus' | 'shortBreak' | 'longBreak';

const PHASE_META: Record<Phase, { label: string; color: string }> = {
  focus: { label: 'Focus', color: colors.focus },
  shortBreak: { label: 'Short break', color: colors.break },
  longBreak: { label: 'Long break', color: colors.accent },
};

export default function FocusScreen() {
  const insets = useSafeAreaInsets();
  const { pomodoro, updatePomodoro, activeTimer, cancelTimer, addManualEntry } =
    useApp();

  // Adopt a task selected from the Tasks tab, if any.
  const [subject, setSubject] = useState<{ taskId?: string; label: string }>(
    () =>
      activeTimer
        ? { taskId: activeTimer.taskId, label: activeTimer.label }
        : { label: 'Focus session' },
  );
  useEffect(() => {
    if (activeTimer) {
      setSubject({ taskId: activeTimer.taskId, label: activeTimer.label });
      cancelTimer(); // the stopwatch hand-off; Pomodoro tracks from here
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTimer?.startedAt]);

  const phaseDuration = (p: Phase): number => {
    switch (p) {
      case 'focus':
        return pomodoro.focusMinutes * 60;
      case 'shortBreak':
        return pomodoro.shortBreakMinutes * 60;
      case 'longBreak':
        return pomodoro.longBreakMinutes * 60;
    }
  };

  const [phase, setPhase] = useState<Phase>('focus');
  const [secondsLeft, setSecondsLeft] = useState(() => pomodoro.focusMinutes * 60);
  const [running, setRunning] = useState(false);
  const [completedFocus, setCompletedFocus] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const total = phaseDuration(phase);
  const elapsed = total - secondsLeft;
  const progress = total > 0 ? Math.min(1, elapsed / total) : 0;

  // Keep the displayed time in sync if settings change while idle.
  useEffect(() => {
    if (!running) setSecondsLeft(phaseDuration(phase));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pomodoro, phase]);

  // The countdown loop.
  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          handlePhaseComplete();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, phase]);

  const logFocus = (focusSeconds: number) => {
    if (focusSeconds < 60) return; // ignore tiny sessions
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - focusSeconds * 1000);
    addManualEntry({
      taskId: subject.taskId,
      label: subject.label,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      source: 'focus',
    });
  };

  const handlePhaseComplete = () => {
    setRunning(false);
    if (phase === 'focus') {
      logFocus(phaseDuration('focus'));
      const nextRounds = completedFocus + 1;
      setCompletedFocus(nextRounds);
      const nextPhase: Phase =
        nextRounds % pomodoro.roundsBeforeLongBreak === 0
          ? 'longBreak'
          : 'shortBreak';
      setPhase(nextPhase);
      setSecondsLeft(phaseDuration(nextPhase));
    } else {
      setPhase('focus');
      setSecondsLeft(phaseDuration('focus'));
    }
  };

  const toggleRun = () => setRunning((r) => !r);

  const reset = () => {
    setRunning(false);
    setSecondsLeft(phaseDuration(phase));
  };

  const endSession = () => {
    if (phase === 'focus') logFocus(elapsed);
    setRunning(false);
    setPhase('focus');
    setSecondsLeft(phaseDuration('focus'));
  };

  const switchPhase = (p: Phase) => {
    setRunning(false);
    setPhase(p);
    setSecondsLeft(phaseDuration(p));
  };

  const meta = PHASE_META[phase];

  const dots = useMemo(
    () =>
      Array.from({ length: pomodoro.roundsBeforeLongBreak }).map(
        (_, i) => i < completedFocus % pomodoro.roundsBeforeLongBreak,
      ),
    [completedFocus, pomodoro.roundsBeforeLongBreak],
  );

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
    >
      <View style={styles.phaseTabs}>
        {(Object.keys(PHASE_META) as Phase[]).map((p) => (
          <Pressable
            key={p}
            onPress={() => switchPhase(p)}
            style={[
              styles.phaseTab,
              phase === p && { backgroundColor: PHASE_META[p].color },
            ]}
          >
            <Text
              style={[
                styles.phaseTabText,
                phase === p && { color: '#0F1115' },
              ]}
            >
              {PHASE_META[p].label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.timerWrap}>
        <View
          style={[
            styles.ring,
            { borderColor: colors.border },
          ]}
        >
          <View
            style={[
              styles.ringFill,
              {
                borderColor: meta.color,
                transform: [{ rotate: `${progress * 360}deg` }],
                opacity: 0.18 + progress * 0.5,
              },
            ]}
          />
          <Text style={styles.timeText}>{formatDuration(secondsLeft)}</Text>
          <Text style={[styles.phaseLabel, { color: meta.color }]}>
            {meta.label}
          </Text>
        </View>
      </View>

      <Text style={styles.subjectLabel} numberOfLines={1}>
        {phase === 'focus' ? `Working on: ${subject.label}` : 'Take a breather'}
      </Text>

      <View style={styles.dotsRow}>
        {dots.map((filled, i) => (
          <View
            key={i}
            style={[
              styles.roundDot,
              { backgroundColor: filled ? colors.focus : colors.border },
            ]}
          />
        ))}
      </View>

      <View style={styles.controls}>
        <Pressable onPress={reset} style={styles.secondaryControl} hitSlop={8}>
          <Ionicons name="refresh" size={24} color={colors.text} />
        </Pressable>

        <Pressable
          onPress={toggleRun}
          style={[styles.playControl, { backgroundColor: meta.color }]}
        >
          <Ionicons
            name={running ? 'pause' : 'play'}
            size={38}
            color="#0F1115"
          />
        </Pressable>

        <Pressable onPress={endSession} style={styles.secondaryControl} hitSlop={8}>
          <Ionicons name="stop" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.statRow}>
        <Stat label="Sessions today" value={String(completedFocus)} />
        <Stat
          label="Focus time"
          value={`${Math.round((completedFocus * pomodoro.focusMinutes) / 6) / 10}h`}
        />
      </View>

      <SectionTitle>Timer settings</SectionTitle>
      <Card style={{ gap: spacing.md }}>
        <Stepper
          label="Focus length"
          value={pomodoro.focusMinutes}
          unit="min"
          step={5}
          min={5}
          max={90}
          onChange={(v) => updatePomodoro({ focusMinutes: v })}
        />
        <Stepper
          label="Short break"
          value={pomodoro.shortBreakMinutes}
          unit="min"
          step={1}
          min={1}
          max={30}
          onChange={(v) => updatePomodoro({ shortBreakMinutes: v })}
        />
        <Stepper
          label="Long break"
          value={pomodoro.longBreakMinutes}
          unit="min"
          step={5}
          min={5}
          max={60}
          onChange={(v) => updatePomodoro({ longBreakMinutes: v })}
        />
        <Stepper
          label="Rounds before long break"
          value={pomodoro.roundsBeforeLongBreak}
          unit=""
          step={1}
          min={2}
          max={8}
          onChange={(v) => updatePomodoro({ roundsBeforeLongBreak: v })}
        />
      </Card>
      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

function Stepper({
  label,
  value,
  unit,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          onPress={() => onChange(Math.max(min, value - step))}
          style={styles.stepperButton}
          hitSlop={6}
        >
          <Ionicons name="remove" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.stepperValue}>
          {value}
          {unit ? ` ${unit}` : ''}
        </Text>
        <Pressable
          onPress={() => onChange(Math.min(max, value + step))}
          style={styles.stepperButton}
          hitSlop={6}
        >
          <Ionicons name="add" size={20} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const RING = 260;

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg },
  phaseTabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  phaseTab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  phaseTabText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  timerWrap: { alignItems: 'center', marginVertical: spacing.xl },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  ringFill: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 12,
    borderLeftColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  timeText: {
    color: colors.text,
    fontSize: 60,
    fontWeight: '200',
    fontVariant: ['tabular-nums'],
  },
  phaseLabel: {
    fontSize: 15,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.xs,
  },
  subjectLabel: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  roundDot: { width: 10, height: 10, borderRadius: 5 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    marginBottom: spacing.xl,
  },
  secondaryControl: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playControl: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl },
  stat: { flex: 1, alignItems: 'center', paddingVertical: spacing.lg },
  statValue: { color: colors.text, fontSize: 26, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperLabel: { color: colors.text, fontSize: 15, flex: 1 },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepperButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    minWidth: 64,
    textAlign: 'center',
  },
});
