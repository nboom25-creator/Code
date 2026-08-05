import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import ToolScreen from "../components/ToolScreen";
import Button from "../components/Button";
import { colors, radius, space } from "../theme";

// Elapsed time is always derived from timestamps, never accumulated per tick,
// so a throttled or dropped interval can't make the clock drift.
function format(ms) {
  const total = Math.max(0, Math.floor(ms));
  const cs = Math.floor((total % 1000) / 10);
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0
    ? `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`
    : `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

export default function Stopwatch({ onBack }) {
  useKeepAwake();

  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [laps, setLaps] = useState([]);

  const startedAt = useRef(0); // wall clock when the current run began
  const banked = useRef(0); // time from previous runs, before this resume

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setElapsed(banked.current + (Date.now() - startedAt.current));
    }, 33);
    return () => clearInterval(id);
  }, [running]);

  const buzz = (style = Haptics.ImpactFeedbackStyle.Light) =>
    Haptics.impactAsync(style).catch(() => {});

  const toggle = () => {
    if (running) {
      banked.current += Date.now() - startedAt.current;
      setElapsed(banked.current);
      setRunning(false);
    } else {
      startedAt.current = Date.now();
      setRunning(true);
    }
    buzz(Haptics.ImpactFeedbackStyle.Medium);
  };

  const lapOrReset = () => {
    if (running) {
      const now = banked.current + (Date.now() - startedAt.current);
      const prev = laps.length ? laps[0].at : 0;
      setLaps((ls) => [{ n: ls.length + 1, at: now, split: now - prev }, ...ls]);
      buzz();
    } else {
      banked.current = 0;
      setElapsed(0);
      setLaps([]);
      buzz();
    }
  };

  const best = laps.length
    ? Math.min(...laps.map((l) => l.split))
    : null;
  const worst = laps.length > 1
    ? Math.max(...laps.map((l) => l.split))
    : null;

  return (
    <ToolScreen title="STOPWATCH" onBack={onBack}>
      <Text style={styles.clock}>{format(elapsed)}</Text>

      <View style={styles.row}>
        <Button
          label={running ? "Lap" : "Reset"}
          onPress={lapOrReset}
          style={styles.btn}
        />
        <Button
          label={running ? "Stop" : elapsed > 0 ? "Resume" : "Start"}
          tone={running ? "danger" : "accent"}
          onPress={toggle}
          style={styles.btn}
        />
      </View>

      <ScrollView
        style={styles.laps}
        contentContainerStyle={styles.lapsContent}
        showsVerticalScrollIndicator={false}
      >
        {laps.map((l) => {
          const tone =
            laps.length > 1 && l.split === best
              ? colors.accent
              : laps.length > 1 && l.split === worst
                ? colors.danger
                : colors.text;
          return (
            <View key={l.n} style={styles.lapRow}>
              <Text style={styles.lapNum}>Lap {l.n}</Text>
              <Text style={[styles.lapSplit, { color: tone }]}>
                {format(l.split)}
              </Text>
              <Text style={styles.lapTotal}>{format(l.at)}</Text>
            </View>
          );
        })}
      </ScrollView>
    </ToolScreen>
  );
}

const styles = StyleSheet.create({
  clock: {
    color: colors.text,
    fontSize: 60,
    fontWeight: "300",
    fontVariant: ["tabular-nums"],
    letterSpacing: 1,
  },
  row: {
    flexDirection: "row",
    gap: space.md,
    marginTop: space.lg,
    marginBottom: space.lg,
  },
  btn: { minWidth: 130 },
  laps: {
    alignSelf: "stretch",
    flex: 1,
  },
  lapsContent: {
    paddingBottom: space.lg,
  },
  lapRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lapNum: {
    color: colors.textDim,
    fontSize: 15,
    fontWeight: "600",
    width: 70,
  },
  lapSplit: {
    fontSize: 17,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  lapTotal: {
    color: colors.textDim,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
    width: 90,
    textAlign: "right",
  },
});
