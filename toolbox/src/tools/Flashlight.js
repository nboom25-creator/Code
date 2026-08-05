import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useKeepAwake } from "expo-keep-awake";
import ToolScreen from "../components/ToolScreen";
import Button from "../components/Button";
import { colors, radius, space } from "../theme";

const HAS_TORCH = Platform.OS !== "web";
const STROBE_RATES = [2, 5, 10]; // Hz
const LAMP_COLORS = ["#ffffff", "#ffe9c4", "#ff5f5f", "#5f8bff"];

// SOS in morse: ... --- ... Durations in ms, alternating on/off.
const DOT = 180;
const DASH = DOT * 3;
const GAP = DOT; // between symbols in a letter
const LETTER_GAP = DOT * 3;
const WORD_GAP = DOT * 7;

function sosSequence() {
  const letters = [
    [DOT, DOT, DOT],
    [DASH, DASH, DASH],
    [DOT, DOT, DOT],
  ];
  const steps = [];
  letters.forEach((symbols, li) => {
    symbols.forEach((on, si) => {
      steps.push({ on: true, ms: on });
      const last = si === symbols.length - 1;
      steps.push({
        on: false,
        ms: last ? (li === letters.length - 1 ? WORD_GAP : LETTER_GAP) : GAP,
      });
    });
  });
  return steps;
}

export default function Flashlight({ onBack }) {
  useKeepAwake();

  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState("off"); // off | steady | strobe | sos
  const [rate, setRate] = useState(5);
  const [torch, setTorch] = useState(false);
  const [lamp, setLamp] = useState(null); // full-screen colour, or null

  const timer = useRef(null);

  // One effect owns the torch for every mode, so switching modes can never
  // leave a stray interval blinking in the background.
  useEffect(() => {
    const clear = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        clearInterval(timer.current);
        timer.current = null;
      }
    };
    clear();

    if (!HAS_TORCH || mode === "off") {
      setTorch(false);
      return clear;
    }

    if (mode === "steady") {
      setTorch(true);
      return clear;
    }

    if (mode === "strobe") {
      setTorch(true);
      timer.current = setInterval(
        () => setTorch((t) => !t),
        Math.round(1000 / (rate * 2))
      );
      return clear;
    }

    // SOS: walk the morse sequence, rescheduling one step at a time.
    const steps = sosSequence();
    let i = 0;
    const step = () => {
      const cur = steps[i % steps.length];
      setTorch(cur.on);
      i += 1;
      timer.current = setTimeout(step, cur.ms);
    };
    step();
    return clear;
  }, [mode, rate]);

  const needsPermission = HAS_TORCH && permission && !permission.granted;

  if (lamp) {
    return (
      <Pressable
        style={[styles.lamp, { backgroundColor: lamp }]}
        onPress={() => setLamp(null)}
      >
        <Text style={styles.lampHint}>tap to close</Text>
      </Pressable>
    );
  }

  return (
    <ToolScreen
      title="FLASHLIGHT"
      hint={
        HAS_TORCH
          ? "Torch, strobe, and a morse SOS beacon."
          : "The browser can't drive the camera torch — screen lamp only."
      }
      onBack={onBack}
    >
      {HAS_TORCH && permission?.granted ? (
        <CameraView style={styles.hiddenCam} facing="back" enableTorch={torch} />
      ) : null}

      <View style={[styles.bulb, torch && styles.bulbOn]}>
        <Text style={[styles.bulbGlyph, torch && styles.bulbGlyphOn]}>
          {torch ? "☀" : "☾"}
        </Text>
      </View>

      {needsPermission ? (
        <View style={styles.block}>
          <Text style={styles.note}>
            The torch is part of the camera, so Android and iOS need camera
            access before it can be switched on.
          </Text>
          <Button
            label="Grant camera access"
            tone="accent"
            onPress={requestPermission}
          />
        </View>
      ) : HAS_TORCH ? (
        <View style={styles.block}>
          <View style={styles.row}>
            <Button
              label={mode === "steady" ? "On" : "Off"}
              tone={mode === "steady" ? "accent" : "default"}
              onPress={() => setMode(mode === "steady" ? "off" : "steady")}
            />
            <Button
              label="Strobe"
              tone={mode === "strobe" ? "accent" : "default"}
              onPress={() => setMode(mode === "strobe" ? "off" : "strobe")}
            />
            <Button
              label="SOS"
              tone={mode === "sos" ? "danger" : "default"}
              onPress={() => setMode(mode === "sos" ? "off" : "sos")}
            />
          </View>

          {mode === "strobe" ? (
            <View style={styles.row}>
              {STROBE_RATES.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRate(r)}
                  style={[styles.chip, rate === r && styles.chipActive]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      rate === r && styles.chipTextActive,
                    ]}
                  >
                    {r} Hz
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.section}>Screen lamp</Text>
      <View style={styles.row}>
        {LAMP_COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => setLamp(c)}
            style={[styles.swatch, { backgroundColor: c }]}
          />
        ))}
      </View>
    </ToolScreen>
  );
}

const styles = StyleSheet.create({
  hiddenCam: { width: 1, height: 1, opacity: 0, position: "absolute" },
  bulb: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  bulbOn: {
    backgroundColor: "#fff7d6",
    borderColor: "#ffe9a8",
  },
  bulbGlyph: { fontSize: 64, color: colors.textDim },
  bulbGlyphOn: { color: "#c98a00" },
  block: {
    alignItems: "center",
    gap: space.md,
    marginTop: space.lg,
  },
  row: {
    flexDirection: "row",
    gap: space.sm,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  chip: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.surfaceHi },
  chipText: { color: colors.textDim, fontWeight: "700" },
  chipTextActive: { color: colors.text },
  note: {
    color: colors.textDim,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    paddingHorizontal: space.md,
  },
  section: {
    color: colors.textDim,
    fontSize: 13,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  swatch: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lamp: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: space.xl,
  },
  lampHint: {
    color: "rgba(0,0,0,0.35)",
    fontSize: 13,
    fontWeight: "600",
  },
});
