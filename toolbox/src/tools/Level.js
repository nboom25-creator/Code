import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Accelerometer } from "expo-sensors";
import * as Haptics from "expo-haptics";
import ToolScreen from "../components/ToolScreen";
import { colors, radius, space } from "../theme";

const DEG = 180 / Math.PI;
const SMOOTHING = 0.2; // low-pass on raw samples; higher = twitchier
const LEVEL_EPS = 0.4; // degrees within which we call it level
const BUBBLE = 46;
const DIAL = 240;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default function Level({ onBack }) {
  const [available, setAvailable] = useState(null);
  const [mode, setMode] = useState("surface"); // "surface" | "edge"
  const [g, setG] = useState({ x: 0, y: 0, z: 1 });
  const smoothed = useRef({ x: 0, y: 0, z: 1 });
  const wasLevel = useRef(false);

  useEffect(() => {
    let sub;
    let cancelled = false;

    Accelerometer.isAvailableAsync().then((ok) => {
      if (cancelled) return;
      setAvailable(ok);
      if (!ok) return;
      Accelerometer.setUpdateInterval(50);
      sub = Accelerometer.addListener((raw) => {
        const s = smoothed.current;
        s.x += (raw.x - s.x) * SMOOTHING;
        s.y += (raw.y - s.y) * SMOOTHING;
        s.z += (raw.z - s.z) * SMOOTHING;
        setG({ x: s.x, y: s.y, z: s.z });
      });
    });

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  // Normalise so readings stay correct under acceleration, not just at rest.
  const mag = Math.hypot(g.x, g.y, g.z) || 1;
  const nx = g.x / mag;
  const ny = g.y / mag;
  const nz = g.z / mag;

  // Surface: how far the phone's plane is off horizontal, split per axis.
  const pitch = Math.asin(clamp(ny, -1, 1)) * DEG;
  const roll = Math.asin(clamp(nx, -1, 1)) * DEG;
  const offLevel = Math.acos(clamp(Math.abs(nz), -1, 1)) * DEG;

  // Edge: rotation away from plumb when the phone is held upright.
  const edgeAngle = Math.atan2(nx, Math.abs(ny) || 1e-6) * DEG;

  const primary = mode === "surface" ? offLevel : edgeAngle;
  const isLevel = Math.abs(primary) <= LEVEL_EPS;

  // Buzz once on the transition into level, not continuously while held there.
  useEffect(() => {
    if (isLevel && !wasLevel.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    wasLevel.current = isLevel;
  }, [isLevel]);

  if (available === false) {
    return (
      <ToolScreen title="LEVEL" onBack={onBack}>
        <Text style={styles.unsupported}>
          This device has no accelerometer, so there's nothing to read.
        </Text>
      </ToolScreen>
    );
  }

  const tone = isLevel ? colors.accent : colors.textDim;

  return (
    <ToolScreen
      title="LEVEL"
      hint={
        mode === "surface"
          ? "Lay the phone on the surface. Centre the bubble."
          : "Hold the phone's long edge against the surface."
      }
      onBack={onBack}
    >
      <View style={styles.modes}>
        <ModeTab
          label="Surface"
          active={mode === "surface"}
          onPress={() => setMode("surface")}
        />
        <ModeTab
          label="Edge"
          active={mode === "edge"}
          onPress={() => setMode("edge")}
        />
      </View>

      {mode === "surface" ? (
        <View style={[styles.dial, isLevel && styles.dialLevel]}>
          <View style={styles.crossH} />
          <View style={styles.crossV} />
          <View style={styles.target} />
          <View
            style={[
              styles.bubble,
              isLevel && styles.bubbleLevel,
              {
                transform: [
                  { translateX: clamp(nx, -1, 1) * (DIAL / 2 - BUBBLE / 2) },
                  { translateY: clamp(ny, -1, 1) * (DIAL / 2 - BUBBLE / 2) },
                ],
              },
            ]}
          />
        </View>
      ) : (
        <View style={styles.dial}>
          <View
            style={[
              styles.horizon,
              isLevel && styles.horizonLevel,
              { transform: [{ rotate: `${-edgeAngle}deg` }] },
            ]}
          />
          <View style={styles.horizonRef} />
        </View>
      )}

      <Text style={[styles.reading, { color: tone }]}>
        {Math.abs(primary).toFixed(1)}°
      </Text>
      <Text style={styles.caption}>
        {mode === "surface"
          ? `pitch ${pitch.toFixed(1)}°   roll ${roll.toFixed(1)}°`
          : edgeAngle >= 0
            ? "leaning right"
            : "leaning left"}
      </Text>
    </ToolScreen>
  );
}

function ModeTab({ label, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.modeTab, active && styles.modeTabActive]}
    >
      <Text style={[styles.modeText, active && styles.modeTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modes: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: space.xs,
    marginBottom: space.lg,
  },
  modeTab: {
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
  },
  modeTabActive: { backgroundColor: colors.surfaceHi },
  modeText: { color: colors.textDim, fontWeight: "700" },
  modeTextActive: { color: colors.text },
  dial: {
    width: DIAL,
    height: DIAL,
    borderRadius: DIAL / 2,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  dialLevel: { borderColor: colors.accent },
  crossH: {
    position: "absolute",
    width: DIAL,
    height: 1,
    backgroundColor: colors.border,
  },
  crossV: {
    position: "absolute",
    width: 1,
    height: DIAL,
    backgroundColor: colors.border,
  },
  target: {
    position: "absolute",
    width: BUBBLE + 10,
    height: BUBBLE + 10,
    borderRadius: (BUBBLE + 10) / 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubble: {
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    backgroundColor: colors.textDim,
    opacity: 0.9,
  },
  bubbleLevel: { backgroundColor: colors.accent },
  horizon: {
    position: "absolute",
    width: DIAL * 1.4,
    height: 3,
    backgroundColor: colors.textDim,
    borderRadius: 2,
  },
  horizonLevel: { backgroundColor: colors.accent },
  horizonRef: {
    position: "absolute",
    width: DIAL * 0.5,
    height: 1,
    backgroundColor: colors.border,
  },
  reading: {
    fontSize: 56,
    fontWeight: "800",
    marginTop: space.lg,
    fontVariant: ["tabular-nums"],
  },
  caption: {
    color: colors.textDim,
    fontSize: 14,
    marginTop: space.xs,
    fontVariant: ["tabular-nums"],
  },
  unsupported: {
    color: colors.textDim,
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
});
